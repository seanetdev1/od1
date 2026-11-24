const {
  planLoadingPrograms, mapLoadingProgram, decode,
} = require('../../functions/loadingProgramMigrationPlan');

const lp = (Id, over = {}) => ({
  Id, SEJobId: 100,
  LocalCustomId: 1, WharfId: 2,
  AllocAvailableId: 1, ContAvalableId: 1,
  LoadingFlagId: 7, StatusId: 0, ContainerWTId: 0,
  ContainerPickUpLocationId: null,
  OriginTerminalCode: 'KICT', DestinationTerminalCode: 'JEA',
  EGMNo: 'EGM-1', CRONumber: 'CRO-1', BookNo: 'BK-1',
  SpecialInstruction: 'Load carefully',
  IsLoadingTerms: true,
  ...over,
});

const ctx = (over = {}) => ({
  jobIdByLegacyId: new Map([['100', 'job-1']]),
  jobsDone: [],
  localCustoms: new Map([['1', 'KARACHI CUSTOM']]),
  wharfs: new Map([['2', 'WEST WHARF']]),
  // The real Gen_CommonLOV: a shared misc table, not a per-field lookup.
  lov: new Map([['1', 'Yes'], ['2', 'No'], ['7', '999999']]),
  locations: new Map([['9', 'DEPOT A']]),
  ...over,
});

describe('decode', () => {
  it('returns null on a miss rather than the raw id', () => {
    // These display as labels, so a raw id on screen is worse than a blank.
    const m = new Map([['1', 'ONE']]);
    expect(decode(m, 1)).toBe('ONE');
    expect(decode(m, 99)).toBeNull();
    expect(decode(m, null)).toBeNull();
    expect(decode(undefined, 1)).toBeNull();
  });
});

describe('mapLoadingProgram', () => {
  it('decodes the two lookups that resolve cleanly', () => {
    const m = mapLoadingProgram(lp(1), { ...ctx(), jobId: 'job-1' });
    expect(m.localCustom).toBe('KARACHI CUSTOM');
    expect(m.wharf).toBe('WEST WHARF');
  });

  it('decodes availability through the shared misc table', () => {
    const m = mapLoadingProgram(lp(1), { ...ctx(), jobId: 'job-1' });
    expect(m.allocAvailable).toBe('Yes');
    expect(m.contAvailable).toBe('Yes');
  });

  it('leaves availability blank when the source never set it', () => {
    // 0 is unset, not a reference.
    const m = mapLoadingProgram(
      lp(1, { AllocAvailableId: 0, ContAvalableId: 0 }), { ...ctx(), jobId: 'job-1' },
    );
    expect(m.allocAvailable).toBeNull();
    expect(m.contAvailable).toBeNull();
  });

  it('refuses to decode the three fields whose lookup is plainly wrong', () => {
    // LoadingFlagId is 7 on the real data, which the only candidate table maps
    // to "999999". Writing that would put a number where a flag name belongs.
    const m = mapLoadingProgram(lp(1, { LoadingFlagId: 7 }), { ...ctx(), jobId: 'job-1' });
    expect(m.loadingFlag).toBeNull();
    expect(m.status).toBeNull();
    expect(m.containerWt).toBeNull();
  });

  it('never writes the loading-terms flag into the terms text field', () => {
    // IsLoadingTerms is true on every row - it says terms apply, not what they
    // are, and loadingTerms is a long-text field that prints.
    const m = mapLoadingProgram(lp(1, { IsLoadingTerms: true }), { ...ctx(), jobId: 'job-1' });
    expect(m.loadingTerms).toBeNull();
    // The instruction text, which IS text, does come across.
    expect(m.instruction).toBe('Load carefully');
  });

  it('carries codes and free text straight across', () => {
    const m = mapLoadingProgram(lp(1), { ...ctx(), jobId: 'job-1' });
    expect(m.loadingTerminal).toBe('KICT');
    expect(m.dischargeTerminal).toBe('JEA');
    expect(m.egm).toBe('EGM-1');
    expect(m.cro).toBe('CRO-1');
    expect(m.book).toBe('BK-1');
    expect(m.SEJobId).toBe('job-1');
  });

  it('falls back to the via-port alias when there is no code', () => {
    expect(mapLoadingProgram(lp(1, { ViaPortCode: null, ViaPortNameAlias: 'COLOMBO' }),
      { ...ctx(), jobId: 'job-1' }).viaPort).toBe('COLOMBO');
  });
});

describe('planLoadingPrograms', () => {
  it('attaches each program to its job', () => {
    const plan = planLoadingPrograms([lp(1)], 'SE', ctx());
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].SEJobId).toBe('job-1');
  });

  it('skips a program whose job is not in Odyssey', () => {
    const plan = planLoadingPrograms([lp(1), lp(2, { SEJobId: 999 })], 'SE', ctx());
    expect(plan.problems.orphaned).toEqual([999]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('skips a job that already has one', () => {
    const plan = planLoadingPrograms([lp(1)], 'SE', ctx({ jobsDone: ['job-1'] }));
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.stats.skippedJobs).toBe(1);
  });

  it('keeps only one program per job, since the screen loads one', () => {
    const plan = planLoadingPrograms([lp(1), lp(2)], 'SE', ctx());
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.problems.duplicateJobs).toEqual([100]);
  });

  it('counts the fields it deliberately did not decode', () => {
    const plan = planLoadingPrograms([lp(1, { LoadingFlagId: 7, StatusId: 3 })], 'SE', ctx());
    expect(plan.notDecodable.loadingFlag).toBe(1);
    expect(plan.notDecodable.status).toBe(1);
    expect(plan.stats.notDecodableTotal).toBeGreaterThan(0);
  });

  it('counts lookups that were tried and missed, separately', () => {
    const plan = planLoadingPrograms([lp(1)], 'SE', ctx({ localCustoms: new Map() }));
    expect(plan.undecoded.localCustom).toBe(1);
    expect(plan.undecoded.wharf).toBe(0);
  });

  it('refuses any operation but sea export', () => {
    for (const op of ['SI', 'AE', 'AI']) {
      expect(() => planLoadingPrograms([], op, ctx())).toThrow(/only for sea export/);
    }
  });

  it('counts rows with no id or no job reference', () => {
    const plan = planLoadingPrograms([null, { Id: 5 }, { SEJobId: 100 }, lp(2)], 'SE', ctx());
    expect(plan.problems.missingId).toBe(1);
    expect(plan.problems.missingJobRef).toBe(2);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('emits rows of a uniform shape', () => {
    const plan = planLoadingPrograms(
      [lp(1), lp(2, { SEJobId: 101, Berth: 'B1' })], 'SE',
      ctx({ jobIdByLegacyId: new Map([['100', 'job-1'], ['101', 'job-2']]) }),
    );
    const keys = plan.toCreate.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
  });

  it('does not throw on an empty source', () => {
    expect(planLoadingPrograms([], 'SE', ctx()).stats.source).toBe(0);
    expect(planLoadingPrograms(undefined, 'SE', ctx()).canApply).toBe(true);
  });
});
