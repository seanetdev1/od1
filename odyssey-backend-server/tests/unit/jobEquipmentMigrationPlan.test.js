const { planJobEquipment, mapEquipment } = require('../../functions/jobEquipmentMigrationPlan');

const equip = (Id, over = {}) => ({
  Id, SEJobId: 100, EquipCode: '40HC', Quantity: 2,
  PerUnitWeight: 3800, dDGNonDGId: 2, ...over,
});

const sizeTypes = new Map([
  ['40HC', { EquipCode: '40HC', Teus: 2, PerUnitWeight: 3750 }],
  ['20GP', { EquipCode: '20GP', Teus: 1, PerUnitWeight: 2200 }],
]);

const ctx = (over = {}) => ({
  jobIdByLegacyId: new Map([['100', 'job-1']]),
  jobsDone: [],
  sizeTypes,
  ...over,
});

describe('mapEquipment', () => {
  it('prefers the weight on the row over the size catalogue default', () => {
    // The old import always took Gen_EquipmentSizeType.PerUnitWeight, so a job
    // whose containers were actually weighed got the catalogue figure.
    const m = mapEquipment(equip(1, { PerUnitWeight: 3800 }), { sizeTypes, jobId: 'job-1' });
    expect(m.gross).toBe(3800);
  });

  it('falls back to the catalogue weight when the row has none', () => {
    const m = mapEquipment(equip(1, { PerUnitWeight: null }), { sizeTypes, jobId: 'job-1' });
    expect(m.gross).toBe(3750);
  });

  it('does not throw when the size code is not in the catalogue', () => {
    // The old import read equip.Gen_EquipmentSizeType.PerUnitWeight unguarded,
    // so one unknown size code threw inside the job's transaction and took the
    // job and the rest of its batch with it.
    const row = equip(1, { EquipCode: 'NOSUCH', PerUnitWeight: null });
    expect(() => mapEquipment(row, { sizeTypes, jobId: 'job-1' })).not.toThrow();
    const m = mapEquipment(row, { sizeTypes, jobId: 'job-1' });
    expect(m.gross).toBeNull();
    expect(m.teu).toBeNull();
    expect(m.size).toBe('NOSUCH');     // the row still imports
  });

  it('takes TEU from the catalogue, which the equipment row does not carry', () => {
    expect(mapEquipment(equip(1), { sizeTypes, jobId: 'job-1' }).teu).toBe(2);
    expect(mapEquipment(equip(1, { EquipCode: '20GP' }), { sizeTypes, jobId: 'job-1' }).teu).toBe(1);
  });

  it('records the legacy id, which the old import never set', () => {
    expect(mapEquipment(equip(42), { sizeTypes, jobId: 'job-1' }).climaxId).toBe(42);
  });

  it('maps the dangerous-goods flag', () => {
    expect(mapEquipment(equip(1, { dDGNonDGId: 2 }), { sizeTypes }).dg).toBe('non-DG');
    expect(mapEquipment(equip(1, { dDGNonDGId: 1 }), { sizeTypes }).dg).toBe('DG');
  });

  it('survives a missing size-type map entirely', () => {
    expect(() => mapEquipment(equip(1), {})).not.toThrow();
  });
});

describe('planJobEquipment', () => {
  it('attaches equipment to its job', () => {
    const plan = planJobEquipment([equip(1), equip(2)], 'SE', ctx());
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toCreate.every((r) => r.SEJobId === 'job-1')).toBe(true);
    expect(plan.stats.jobs).toBe(1);
  });

  it('uses the right job column per operation', () => {
    // An SI row carries SIJobId; reading SEJobId would orphan every row.
    const plan = planJobEquipment([{ Id: 1, SIJobId: 100, EquipCode: '40HC' }], 'SI', ctx());
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.problems.orphaned).toEqual([]);
  });

  it('skips equipment whose job is not in Odyssey', () => {
    const plan = planJobEquipment([equip(1), equip(2, { SEJobId: 999 })], 'SE', ctx());
    expect(plan.problems.orphaned).toEqual([999]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('skips a job that already has equipment', () => {
    const plan = planJobEquipment([equip(1)], 'SE', ctx({ jobsDone: ['job-1'] }));
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.stats.skippedJobs).toBe(1);
  });

  it('reports unknown size codes without dropping the rows', () => {
    const plan = planJobEquipment([equip(1, { EquipCode: 'NOSUCH' }), equip(2)], 'SE', ctx());
    expect(plan.stats.unknownSizeType).toBe(1);
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.canApply).toBe(true);
  });

  it('refuses an air operation, which has no equipment at all', () => {
    for (const op of ['AE', 'AI']) {
      expect(() => planJobEquipment([], op, ctx())).toThrow(/only for sea operations/);
    }
  });

  it('counts rows with no id and no job reference', () => {
    const plan = planJobEquipment(
      [null, { SEJobId: 100 }, { Id: 5 }, equip(2)], 'SE', ctx(),
    );
    expect(plan.problems.missingId).toBe(1);      // { SEJobId: 100 } has no Id
    expect(plan.problems.missingJobRef).toBe(2);  // null, and { Id: 5 }
    expect(plan.toCreate).toHaveLength(1);
  });

  it('emits rows of a uniform shape', () => {
    const plan = planJobEquipment([equip(1), equip(2, { PerUnitWeight: null })], 'SE', ctx());
    const keys = plan.toCreate.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
  });

  it('accepts the maps as plain objects', () => {
    const plan = planJobEquipment([equip(1)], 'SE', {
      jobIdByLegacyId: { 100: 'job-1' },
      sizeTypes: { '40HC': { Teus: 2 } },
    });
    expect(plan.toCreate[0].SEJobId).toBe('job-1');
    expect(plan.toCreate[0].teu).toBe(2);
  });

  it('does not throw on an empty source', () => {
    expect(planJobEquipment([], 'SE', ctx()).stats.source).toBe(0);
    expect(planJobEquipment(undefined, 'SE', ctx()).canApply).toBe(true);
  });
});
