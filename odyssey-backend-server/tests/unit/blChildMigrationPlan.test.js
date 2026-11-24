const {
  planBlChildren, mapContainer, mapStamp, mapDimension, mapItemBlocks, tareOf,
} = require('../../functions/blChildMigrationPlan');

const equip = (Id, over = {}) => ({
  Id, SEBLId: 1, ContainerNo: `CONT-${Id}`, SealNo: `SEAL-${Id}`,
  EquipCode: '40HC', GrossWt: 1000, NetWt: 800, WTUnitId: 2, LoadTypeId: 2, ...over,
});
const stampRow = (Id, over = {}) => ({ Id, SEBLId: 1, StampId: 7, StampGroupId: 3, ...over });
const dimRow = (Id, over = {}) => ({
  Id, AEBLId: 1, dLength: '10', dWidth: '5', dHeight: '2', NoOfPcs: '3',
  Volume: '100', VolumetricWeight: '50', ...over,
});
const awb = (Id, over = {}) => ({ Id, NoOfPcs1: 5, UnitOfPcs1: 'CTN', GrossWeight1: '120',
  UnitOfWeightId1: 2, RateClass1: 'Q', ItemNumber1: 'IT-1', ChargeableWeight1: '130',
  RatePerCharge1: '2.5', ItemTotal1: '325', LineWeight1: '120', ...over });

const ctx = (over = {}) => ({
  blIdByParentId: new Map([['1', 'bl-1']]),
  parentsDone: [],
  packing: new Map([['CTN', 'CARTON']]),
  stamps: new Map([['7', { StampCode: 'ST7', StampName: 'ORIGINAL' }]]),
  ...over,
});

describe('tareOf', () => {
  it('prefers the real TareWt column', () => {
    // The old import always subtracted, ignoring the column that holds it.
    expect(tareOf({ TareWt: 150, GrossWt: 1000, NetWt: 800 })).toBe(150);
  });

  it('falls back to gross minus net only when both are numbers', () => {
    expect(tareOf({ GrossWt: 1000, NetWt: 800 })).toBe(200);
  });

  it('returns null rather than NaN when a weight is missing', () => {
    // GrossWt - NetWt with either null is NaN, which the old import wrote
    // straight into the column.
    expect(tareOf({ GrossWt: 1000, NetWt: null })).toBeNull();
    expect(tareOf({ GrossWt: null, NetWt: null })).toBeNull();
    expect(tareOf({})).toBeNull();
    expect(Number.isNaN(tareOf({ GrossWt: 'x', NetWt: 'y' }))).toBe(false);
  });
});

describe('mapContainer', () => {
  it('migrates the free-day counts the old import hardcoded to blank', () => {
    // These are what a container is actually billed against.
    const m = mapContainer(equip(1, {
      dFreeDaysDetention: 7, dFreeDaysDemurrage: 5, dFreeDaysPlugIn: 2,
    }), ctx());
    expect(m.detention).toBe(7);
    expect(m.demurge).toBe(5);
    expect(m.plugin).toBe(2);
  });

  it('pairs the form E number with the form E date, not the B/L timestamp', () => {
    const m = mapContainer(equip(1, {
      dFormENumber: 'FE-1', dFormEDate: '2024-03-01',
    }), ctx());
    expect(m.number).toBe('FE-1');
    expect(m.date).toBe('2024-03-01');
  });

  it('records the legacy id, which the old import never set', () => {
    expect(mapContainer(equip(42), ctx()).climaxId).toBe(42);
  });

  it('resolves the package unit through the packing lookup', () => {
    expect(mapContainer(equip(1, { PackagesCode: 'CTN' }), ctx()).unit).toBe('CARTON');
    expect(mapContainer(equip(1, { PackagesCode: 'NOPE' }), ctx()).unit).toBeNull();
  });

  it('maps the coded flags', () => {
    expect(mapContainer(equip(1, { WTUnitId: 2 }), ctx()).wtUnit).toBe('KGS');
    expect(mapContainer(equip(1, { WTUnitId: 1 }), ctx()).wtUnit).toBe('');
    expect(mapContainer(equip(1, { LoadTypeId: 2 }), ctx()).loadType).toBe('FULL');
    expect(mapContainer(equip(1, { LoadTypeId: 1 }), ctx()).loadType).toBe('EMPTY');
    expect(mapContainer(equip(1, { dDGNonDGId: 2 }), ctx()).dg).toBe('non-DG');
    expect(mapContainer(equip(1, { dDGNonDGId: 1 }), ctx()).dg).toBe('DG');
  });
});

describe('mapStamp / mapDimension', () => {
  it('resolves the stamp code and name through the lookup', () => {
    const m = mapStamp(stampRow(1), ctx());
    expect(m.code).toBe('ST7');
    expect(m.stamps).toBe('ORIGINAL');
    expect(m.stamp_group).toBe(3);
    expect(m.climaxId).toBe(1);
  });

  it('does not throw when the stamp is not in the lookup', () => {
    const m = mapStamp(stampRow(1, { StampId: 999 }), ctx());
    expect(m.code).toBeNull();
    expect(m.stamps).toBeNull();
  });

  it('maps a dimension row', () => {
    // Never imported at all by the old path.
    expect(mapDimension(dimRow(1))).toEqual({
      length: '10', width: '5', height: '2', qty: '3', vol: '100', weight: '50',
    });
  });
});

describe('mapItemBlocks', () => {
  it('expands one inline block into a rate line', () => {
    const out = mapItemBlocks(awb(1));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      noOfPcs: '5', unit: 'CTN', grossWt: '120', kh_lb: 'Kg',
      r_class: 'Q', itemNo: 'IT-1', total: '325',
    });
  });

  it('expands up to four blocks and skips empty ones', () => {
    const out = mapItemBlocks(awb(1, {
      NoOfPcs2: 3, NoOfPcs3: 0, NoOfPcs4: null,
    }));
    expect(out).toHaveLength(2);
  });

  it('returns nothing for a waybill with no rate lines', () => {
    expect(mapItemBlocks({ Id: 1 })).toEqual([]);
    expect(mapItemBlocks({ Id: 1, NoOfPcs1: 0 })).toEqual([]);
  });

  it('maps the weight unit per block', () => {
    expect(mapItemBlocks(awb(1, { UnitOfWeightId1: 2 }))[0].kh_lb).toBe('Kg');
    expect(mapItemBlocks(awb(1, { UnitOfWeightId1: 1 }))[0].kh_lb).toBe('Lb');
  });
});

describe('planBlChildren', () => {
  it('attaches children to their B/L', () => {
    const plan = planBlChildren('containers', [equip(1), equip(2)], 'SE', ctx());
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toCreate.every((r) => r.BlId === 'bl-1')).toBe(true);
    expect(plan.stats.parents).toBe(1);
  });

  it('skips rows whose B/L is not in Odyssey', () => {
    const plan = planBlChildren('containers', [equip(1), equip(2, { SEBLId: 999 })], 'SE', ctx());
    expect(plan.problems.orphaned).toEqual([999]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('skips a B/L that already has children of this kind', () => {
    // Parent-scoped, because Item_Details and Dimensions have no legacy id to
    // match on and children are always written as a complete set per B/L.
    const plan = planBlChildren('containers', [equip(1)], 'SE', ctx({ parentsDone: ['bl-1'] }));
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.stats.skippedParents).toBe(1);
  });

  it('expands air rate lines, so it emits more rows than it consumes', () => {
    const plan = planBlChildren('items', [awb(1, { NoOfPcs2: 3, NoOfPcs3: 1 })], 'AE', ctx());
    expect(plan.stats.source).toBe(1);
    expect(plan.stats.toCreate).toBe(3);
  });

  it('counts waybills that carry no rate lines at all', () => {
    const plan = planBlChildren('items', [{ Id: 1 }], 'AE', ctx());
    expect(plan.stats.emptyBlocks).toBe(1);
    expect(plan.toCreate).toHaveLength(0);
  });

  it('uses the right parent column per kind and operation', () => {
    // A container points at SEBLId on sea export and SIBLId on sea import;
    // reading the wrong one would orphan every row.
    const si = planBlChildren('containers', [{ Id: 1, SIBLId: 1, ContainerNo: 'C' }], 'SI', ctx());
    expect(si.toCreate).toHaveLength(1);

    const ae = planBlChildren('stamps', [{ Id: 1, AEBLId: 1, StampId: 7 }], 'AE', ctx());
    expect(ae.toCreate).toHaveLength(1);
  });

  it('resolves air-import dimensions through the job, not the B/L', () => {
    // AImp_AirImportJob_BLDimension is keyed by AIJobId. The route maps that
    // job to its waybill; the planner just uses whatever map it is given.
    const plan = planBlChildren('dimensions', [{ Id: 1, AIJobId: 1, dLength: '5' }], 'AI', ctx());
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].BlId).toBe('bl-1');
  });

  it('refuses a kind that does not exist for an operation', () => {
    // Containers are sea only; dimensions and rate lines are air only.
    expect(() => planBlChildren('containers', [], 'AE', ctx()))
      .toThrow(/no source for operation "AE"/);
    expect(() => planBlChildren('dimensions', [], 'SE', ctx()))
      .toThrow(/no source for operation "SE"/);
  });

  it('refuses an unknown kind', () => {
    expect(() => planBlChildren('nonsense', [], 'SE', ctx())).toThrow(/Unknown B\/L child kind/);
  });

  it('counts rows with no parent reference', () => {
    const plan = planBlChildren('containers', [null, { Id: 1 }, equip(2)], 'SE', ctx());
    expect(plan.problems.missingParentRef).toBe(2);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('emits rows of a uniform shape', () => {
    const plan = planBlChildren('containers', [equip(1), equip(2, { PackagesCode: 'CTN' })], 'SE', ctx());
    const keys = plan.toCreate.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
  });

  it('does not throw on an empty source', () => {
    expect(planBlChildren('containers', [], 'SE', ctx()).stats.source).toBe(0);
    expect(planBlChildren('containers', undefined, 'SE', ctx()).canApply).toBe(true);
  });
});
