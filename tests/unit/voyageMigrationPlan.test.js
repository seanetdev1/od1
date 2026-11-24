const {
  planVessels, planVoyages, mapVessel, mapVoyage, voyageType, voyageKey,
} = require('../../functions/voyageMigrationPlan');

const vessel = (Id, over = {}) => ({ Id, VesselName: `SHIP ${Id}`, VesselCode: String(Id), ...over });
const voyage = (Id, VesselId, over = {}) => ({
  Id, VesselId, VoyageNo: `V${Id}`, TypeId: 3, ...over,
});

describe('mapVessel', () => {
  it('puts the legacy id in code, as an integer', () => {
    // Vessel.code is INTEGER and /vessel/create issues codes with max(code)+1,
    // so it must stay numeric and above anything assigned by hand.
    const m = mapVessel(vessel('42'));
    expect(m.code).toBe(42);
    expect(m.climaxId).toBe(42);
    expect(m.name).toBe('SHIP 42');
  });

  it('defaults the type, because the legacy table has no type column', () => {
    // Vessel.type is NOT NULL with a notEmpty validator.
    expect(mapVessel(vessel(1)).type).toBe('Both');
  });

  it('does not migrate the owner into carrier', () => {
    // Owner is the ship's owner, not the carrier, and the carrier field is
    // commented out of the Vessel screen anyway.
    expect(mapVessel(vessel(1, { Owner: 'SOMEONE' })).carrier).toBeNull();
  });
});

describe('mapVoyage / voyageType', () => {
  it('trims the voyage number, which is half the key Jobs matches on', () => {
    // 11 voyage numbers are space-padded in the real export. Jobs look up
    // `${vesselId}|${voyageNo.trim()}`, so a padded one can never be resolved.
    expect(mapVoyage(voyage(1, 1, { VoyageNo: '  080E  ' }), 'v1').voyage).toBe('080E');
  });

  it('maps the route columns the old import dropped', () => {
    const m = mapVoyage(
      voyage(1, 1, { PortOfLoadingCode: 'PKKHI', PortOfDischarge: 'AEJEA' }), 'v1',
    );
    expect(m.pol).toBe('PKKHI');
    expect(m.pod).toBe('AEJEA');
  });

  it('stores climaxId as a string, because that column is a string', () => {
    // Voyage.climaxId is STRING, unlike every other model's INTEGER.
    expect(mapVoyage(voyage(7, 1), 'v1').climaxId).toBe('7');
  });

  it('maps the two type ids that are known and defaults the rest', () => {
    expect(voyageType(3)).toBe('Export');
    expect(voyageType(2)).toBe('Import');
    // There is no Gen_VoyageType table to check id 1 against - 350 voyages.
    expect(voyageType(1)).toBe('Both');
    expect(voyageType(null)).toBe('Both');
  });

  it('attaches the voyage to the Odyssey vessel id it was given', () => {
    expect(mapVoyage(voyage(1, 99), 'odyssey-vessel-1').VesselId).toBe('odyssey-vessel-1');
  });
});

describe('voyageKey', () => {
  it('is the exact key the Jobs stage resolves on', () => {
    expect(voyageKey('v1', ' 080E ')).toBe('v1|080E');
    expect(voyageKey('v1', null)).toBe('v1|');
  });
});

describe('planVessels', () => {
  const ctx = (over = {}) => ({ existingClimaxIds: [], ...over });

  it('skips vessels already imported instead of duplicating them', () => {
    // The old import had NO idempotency check, so a second run duplicated all
    // 2,063 vessels - and a duplicated vessel splits its voyages in two.
    const plan = planVessels([vessel(1), vessel(2)], ctx({ existingClimaxIds: [1] }));
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((v) => v.climaxId)).toEqual([2]);
  });

  it('refuses a vessel with no name', () => {
    const plan = planVessels([vessel(1, { VesselName: '  ' }), vessel(2)], ctx());
    expect(plan.problems.missingName).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('reports two vessels sharing a name without blocking them', () => {
    const plan = planVessels([vessel(1, { VesselName: 'TWIN' }), vessel(2, { VesselName: 'twin' })], ctx());
    expect(plan.problems.duplicateNames).toEqual(['twin']);
    expect(plan.toCreate).toHaveLength(2);
  });

  it('counts rows with no usable id and duplicated ids', () => {
    const plan = planVessels([{ VesselName: 'X' }, vessel('abc'), vessel(2), vessel(2)], ctx());
    expect(plan.problems.missingId).toBe(2);
    expect(plan.problems.duplicateClimaxIds).toEqual([2]);
    expect(plan.toCreate).toHaveLength(1);
  });
});

describe('planVoyages', () => {
  const ctx = (over = {}) => ({
    existingClimaxIds: [],
    existingVoyageKeys: [],
    vesselIdByClimaxId: new Map([['1', 'v1'], ['2', 'v2']]),
    ...over,
  });

  it('attaches each voyage to its Odyssey vessel', () => {
    const plan = planVoyages([voyage(1, 1), voyage(2, 2)], ctx());
    expect(plan.toCreate.map((v) => v.VesselId)).toEqual(['v1', 'v2']);
  });

  it('skips a voyage whose vessel is not in Odyssey', () => {
    // There is nothing to attach it to, and VesselId would be null.
    const plan = planVoyages([voyage(1, 1), voyage(2, 999)], ctx());
    expect(plan.problems.orphaned).toEqual([2]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('refuses a voyage with no number', () => {
    // voyage is NOT NULL notEmpty AND half the key Jobs matches on.
    const plan = planVoyages([voyage(1, 1, { VoyageNo: '   ' }), voyage(2, 1)], ctx());
    expect(plan.problems.missingVoyageNo).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('counts padded voyage numbers it had to trim', () => {
    const plan = planVoyages([voyage(1, 1, { VoyageNo: ' 080E ' }), voyage(2, 1)], ctx());
    expect(plan.stats.paddedVoyageNo).toBe(1);
    expect(plan.toCreate[0].voyage).toBe('080E');
  });

  it('flags two voyages sharing a vessel and number as ambiguous', () => {
    // The Jobs stage keeps whichever it sees first, so which one a job gets is
    // not deterministic. Two such pairs exist in the real export.
    const plan = planVoyages([voyage(1, 1, { VoyageNo: 'DUP' }), voyage(2, 1, { VoyageNo: 'DUP' })], ctx());
    expect(plan.problems.ambiguousKeys).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(2);      // reported, not blocked
    expect(plan.canApply).toBe(true);
  });

  it('flags a collision with a voyage already in the system', () => {
    const plan = planVoyages(
      [voyage(1, 1, { VoyageNo: 'TAKEN' })],
      ctx({ existingVoyageKeys: ['v1|TAKEN'] }),
    );
    expect(plan.problems.ambiguousKeys).toHaveLength(1);
  });

  it('skips voyages already imported', () => {
    const plan = planVoyages([voyage(1, 1), voyage(2, 1)], ctx({ existingClimaxIds: ['1'] }));
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('counts type ids it had to guess at', () => {
    const plan = planVoyages([
      voyage(1, 1, { TypeId: 3 }), voyage(2, 1, { TypeId: 2 }), voyage(3, 1, { TypeId: 1 }),
    ], ctx());
    expect(plan.stats.guessedType).toBe(1);
  });

  it('accepts the vessel map as a plain object', () => {
    const plan = planVoyages([voyage(1, 1)], ctx({ vesselIdByClimaxId: { 1: 'v1' } }));
    expect(plan.toCreate[0].VesselId).toBe('v1');
  });

  it('does not throw on an empty source', () => {
    expect(planVoyages([], ctx()).stats.source).toBe(0);
    expect(planVoyages(undefined, ctx()).canApply).toBe(true);
    expect(planVessels(undefined, {}).canApply).toBe(true);
  });
});
