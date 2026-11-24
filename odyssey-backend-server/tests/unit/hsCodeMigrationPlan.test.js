/**
 * The HS tariff master -> Commodity.
 *
 * The stage has no legacy id to lean on: Gen_UnCommodity's primary key IS the
 * HS code. So everything worth testing here is about that key - matching it
 * across punctuation, not importing it twice, and not dropping a tariff line
 * because its description is blank.
 */
const { planHsCodes, mapHsCode, hsKey } = require('../../functions/hsCodeMigrationPlan');

const row = (HsCode, HsDescription = 'Something') => ({ HsCode, HsDescription });

describe('mapHsCode', () => {
  it('puts the description in the name and the code in hs', () => {
    // The picker displays `name`, so the description has to land there or the
    // list is 6,607 bare numbers.
    const m = mapHsCode(row('010120', 'Asses, mules and hinnies, live'));
    expect(m.name).toBe('Asses, mules and hinnies, live');
    expect(m.hs).toBe('010120');
  });

  it('falls back to the code when there is no description', () => {
    // `name` is NOT NULL and a code with no text is still a usable tariff line.
    expect(mapHsCode(row('010120', '')).name).toBe('010120');
    expect(mapHsCode(row('010120', null)).name).toBe('010120');
  });

  it('carries no climaxId, because the source has no id column', () => {
    expect(mapHsCode(row('010120')).climaxId).toBeNull();
  });

  it('does not invent a hazmat or cargo classification', () => {
    // The tariff master says nothing about either. Guessing here would label
    // goods dangerous, or not, on no evidence.
    const m = mapHsCode(row('010120'));
    expect(m.isHazmat).toBe('0');
    expect(m.hazmatCode).toBe('');
    expect(m.cargoType).toBe('GL');
  });
});

describe('hsKey', () => {
  it('matches the same tariff line written different ways', () => {
    expect(hsKey('0101.20')).toBe(hsKey('010120'));
    expect(hsKey('0101 20')).toBe(hsKey('010120'));
    expect(hsKey('  010120 ')).toBe(hsKey('010120'));
  });

  it('is null for nothing usable', () => {
    expect(hsKey('')).toBeNull();
    expect(hsKey(null)).toBeNull();
    expect(hsKey('   ')).toBeNull();
  });
});

describe('planHsCodes', () => {
  it('imports what is not already there', () => {
    const plan = planHsCodes([row('010120'), row('010130')], { existingHs: [] });
    expect(plan.stats.toCreate).toBe(2);
    expect(plan.stats.alreadyImported).toBe(0);
    expect(plan.canApply).toBe(true);
  });

  it('skips codes already in the commodity list, however they were written', () => {
    // Re-running must not duplicate, and a code the commodity stage already
    // brought in from Gen_Commodity counts as present.
    const plan = planHsCodes(
      [row('010120'), row('010130')],
      { existingHs: ['0101.20'] },
    );
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((c) => c.hs)).toEqual(['010130']);
  });

  it('collapses a code that appears twice in the source', () => {
    const plan = planHsCodes([row('010120'), row('0101.20'), row('010130')], {});
    expect(plan.stats.toCreate).toBe(2);
    expect(plan.problems.duplicateCodes).toHaveLength(1);
  });

  it('counts rows with no usable code rather than importing them', () => {
    const plan = planHsCodes([row(''), row(null), null, row('010120')], {});
    expect(plan.problems.missingCode).toBe(3);
    expect(plan.stats.toCreate).toBe(1);
  });

  it('reports a blank description but still imports the code', () => {
    const plan = planHsCodes([row('010120', '')], {});
    expect(plan.stats.toCreate).toBe(1);
    expect(plan.stats.withoutDescription).toBe(1);
  });

  it('does not throw on an empty source', () => {
    expect(planHsCodes([], {}).stats.source).toBe(0);
    expect(planHsCodes(undefined, {}).canApply).toBe(true);
  });
});
