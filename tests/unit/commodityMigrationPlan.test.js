const {
  planCommodities, mapCommodity, buildCargoTypeMap, isReadableHazmat,
} = require('../../functions/commodityMigrationPlan');

const commodity = (Id, CommodityName, extra = {}) => ({
  Id, CommodityName, HSCode: '770000', CCargoTypeID: '1',
  IsInActive: false, IsHazmatProduct: false, ...extra,
});

const CARGO_TYPES = [
  { Id: 1, CCargoTypeName: 'General' },
  { Id: 2, CCargoTypeName: 'Car' },
];

describe('mapCommodity', () => {
  it('stores the hazmat flag in the only form the screens can read', () => {
    // THE defect in the old import: isHazmat is a string column and the source
    // is a boolean, so it stored "true". Every screen tests `isHazmat == 1`,
    // and "true" == 1 is false, so a hazardous commodity rendered as safe.
    expect(mapCommodity(commodity(1, 'ACID', { IsHazmatProduct: true })).isHazmat).toBe('1');
    expect(mapCommodity(commodity(2, 'STEEL')).isHazmat).toBe('0');
    // The exact comparison every screen makes.
    expect(mapCommodity(commodity(1, 'ACID', { IsHazmatProduct: true })).isHazmat == 1).toBe(true);
    expect(mapCommodity(commodity(2, 'STEEL')).isHazmat == 1).toBe(false);
  });

  it('decodes the cargo type when the lookup is available', () => {
    const map = buildCargoTypeMap(CARGO_TYPES);
    expect(mapCommodity(commodity(1, 'X', { CCargoTypeID: '1' }), map).cargoType).toBe('GL');
    expect(mapCommodity(commodity(2, 'Y', { CCargoTypeID: '2' }), map).cargoType).toBe('CAR');
  });

  it('falls back to GL when the lookup is missing or the id is unknown', () => {
    // Exactly what the old import did unconditionally - the difference is that
    // the plan says how many rows took the fallback.
    expect(mapCommodity(commodity(1, 'X')).cargoType).toBe('GL');
    expect(mapCommodity(commodity(1, 'X', { CCargoTypeID: null }), buildCargoTypeMap(CARGO_TYPES))
      .cargoType).toBe('GL');
    expect(mapCommodity(commodity(1, 'X', { CCargoTypeID: '99' }), buildCargoTypeMap(CARGO_TYPES))
      .cargoType).toBe('GL');
  });

  it('maps the packing group onto the three the form offers', () => {
    expect(mapCommodity(commodity(1, 'X', { HazmatPackingGroupID: 3 })).packageGroup).toBe('GRP 3');
    expect(mapCommodity(commodity(1, 'X', { HazmatPackingGroupID: 1 })).packageGroup).toBe('GRP 1');
    // Null on all but two rows of the real export, and 9 is not a group.
    expect(mapCommodity(commodity(1, 'X', { HazmatPackingGroupID: null })).packageGroup).toBe('');
    expect(mapCommodity(commodity(1, 'X', { HazmatPackingGroupID: 9 })).packageGroup).toBe('');
  });

  it('records the retired flag the old import dropped', () => {
    expect(mapCommodity(commodity(1, 'X')).active).toBe('1');
    expect(mapCommodity(commodity(1, 'X', { IsInActive: true })).active).toBe('0');
  });

  it('keeps the legacy id and the HS code', () => {
    const m = mapCommodity(commodity('42', 'STEEL', { HSCode: '720610' }));
    expect(m.climaxId).toBe(42);
    expect(m.hs).toBe('720610');
    expect(m.name).toBe('STEEL');
  });

  it('leaves a blank HS code null rather than an empty string', () => {
    expect(mapCommodity(commodity(1, 'X', { HSCode: '' })).hs).toBeNull();
    expect(mapCommodity(commodity(1, 'X', { HSCode: null })).hs).toBeNull();
  });

  it('does not invent a commodity group or hazmat class', () => {
    // Both source columns are null across all 10,649 rows - there is nothing
    // to migrate, so '' is honest rather than a stub.
    const m = mapCommodity(commodity(1, 'X', { CommodityGroupId: null, HazmatClassTypeID: null }));
    expect(m.commodityGroup).toBe('');
    expect(m.hazmatClass).toBe('');
  });
});

describe('buildCargoTypeMap', () => {
  it('matches on the name, since the id means nothing outside the legacy database', () => {
    const map = buildCargoTypeMap([
      { Id: 1, CCargoTypeName: 'General' },
      { Id: 7, CCargoTypeName: 'CAR / VEHICLE' },
    ]);
    expect(map.get('1')).toBe('GL');
    expect(map.get('7')).toBe('CAR');
  });

  it('ignores rows it cannot use, and survives no lookup at all', () => {
    expect(buildCargoTypeMap([{ Id: null, CCargoTypeName: 'X' }, { Id: 1 }]).size).toBe(0);
    expect(buildCargoTypeMap(undefined).size).toBe(0);
    expect(buildCargoTypeMap([]).size).toBe(0);
  });
});

describe('isReadableHazmat', () => {
  it('accepts only what the screens can match', () => {
    expect(isReadableHazmat('1')).toBe(true);
    expect(isReadableHazmat('0')).toBe(true);
    expect(isReadableHazmat('')).toBe(true);
    expect(isReadableHazmat(null)).toBe(true);      // never set is not a mislabel
    expect(isReadableHazmat('true')).toBe(false);   // what the old import wrote
    expect(isReadableHazmat('false')).toBe(false);
  });
});

describe('planCommodities', () => {
  const ctx = (over = {}) => ({ existingClimaxIds: [], importedHazmatFlags: [], ...over });

  it('skips commodities already imported instead of duplicating them', () => {
    const plan = planCommodities(
      [commodity(1, 'A'), commodity(2, 'B')],
      ctx({ existingClimaxIds: [1] }),
    );
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((c) => c.climaxId)).toEqual([2]);
  });

  it('corrects an already-imported hazmat flag the screens cannot read', () => {
    // The old import wrote "true"/"false" into a string column. Those rows are
    // in the system, in use, and silently mislabelled.
    const plan = planCommodities(
      [commodity(1, 'ACID', { IsHazmatProduct: true })],
      ctx({
        existingClimaxIds: [1],
        importedHazmatFlags: [{ climaxId: 1, isHazmat: 'true' }],
      }),
    );
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toRepair).toEqual([{ climaxId: 1, isHazmat: '1', was: 'true' }]);
  });

  it('corrects a flag that is readable but wrong', () => {
    const plan = planCommodities(
      [commodity(1, 'ACID', { IsHazmatProduct: true })],
      ctx({ existingClimaxIds: [1], importedHazmatFlags: [{ climaxId: 1, isHazmat: '0' }] }),
    );
    expect(plan.toRepair).toEqual([{ climaxId: 1, isHazmat: '1', was: '0' }]);
  });

  it('leaves an already-correct flag alone', () => {
    const plan = planCommodities(
      [commodity(1, 'ACID', { IsHazmatProduct: true }), commodity(2, 'STEEL')],
      ctx({
        existingClimaxIds: [1, 2],
        importedHazmatFlags: [{ climaxId: 1, isHazmat: '1' }, { climaxId: 2, isHazmat: '0' }],
      }),
    );
    expect(plan.toRepair).toEqual([]);
    expect(plan.stats.toRepair).toBe(0);
  });

  it('counts how many cargo types took the fallback, and whether a lookup existed', () => {
    const withLookup = planCommodities(
      [commodity(1, 'A', { CCargoTypeID: '1' }), commodity(2, 'B', { CCargoTypeID: null })],
      ctx({ cargoTypes: CARGO_TYPES }),
    );
    expect(withLookup.stats.cargoTypeLookupAvailable).toBe(true);
    expect(withLookup.stats.undecodedCargoType).toBe(1);

    const without = planCommodities([commodity(1, 'A')], ctx());
    expect(without.stats.cargoTypeLookupAvailable).toBe(false);
    expect(without.stats.undecodedCargoType).toBe(1);
  });

  it('refuses a commodity with no name', () => {
    const plan = planCommodities([commodity(1, '   '), commodity(2, 'REAL')], ctx());
    expect(plan.problems.missingName).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('counts rows with no usable id and duplicated ids', () => {
    const plan = planCommodities([
      { CommodityName: 'NO ID' },
      commodity('x', 'BAD ID'),
      commodity(2, 'A'),
      commodity(2, 'B'),
    ], ctx());
    expect(plan.problems.missingId).toBe(2);
    expect(plan.problems.duplicateClimaxIds).toEqual([2]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('counts blank HS codes, hazmat and inactive rows', () => {
    const plan = planCommodities([
      commodity(1, 'A', { HSCode: '' }),
      commodity(2, 'B', { IsHazmatProduct: true }),
      commodity(3, 'C', { IsInActive: true }),
    ], ctx());
    expect(plan.stats.missingHsCode).toBe(1);
    expect(plan.stats.hazmat).toBe(1);
    expect(plan.stats.inactive).toBe(1);
    expect(plan.stats.source).toBe(3);
    expect(plan.stats.toCreate).toBe(3);
  });

  it('never emits a row that would violate the NOT NULL name column', () => {
    const plan = planCommodities(
      [commodity(1, 'A'), commodity(2, ''), commodity(3, null)],
      ctx(),
    );
    for (const row of plan.toCreate) {
      expect(row.name).toBeTruthy();
      expect(Number.isInteger(row.climaxId)).toBe(true);
    }
  });

  it('does not throw on an empty source', () => {
    expect(planCommodities([], ctx()).stats.source).toBe(0);
    expect(planCommodities(undefined, ctx()).canApply).toBe(true);
  });
});
