const { planJobs, mapJob, jobIdFrom } = require('../../functions/jobMigrationPlan');

const job = (Id, over = {}) => ({
  Id,
  JobNumber: `SEA-${Id}/24`,
  ClientId: 10,
  SubCompanyId: 1,
  CommodityId: 20,
  VesselId: 30,
  VoyageNo: 'V1',
  SalesRepId: 40,
  ...over,
});

const resolvers = (over = {}) => ({
  clients: new Map([['10', 'client-1']]),
  commodities: new Map([['20', 'commodity-1']]),
  vessels: new Map([['30', 'vessel-1']]),
  companies: new Map([['1', 'company-1']]),
  employees: new Map([['40', 'employee-1']]),
  voyages: new Map([['vessel-1|V1', 'voyage-1']]),
  createdById: 'migration-user',
  ...over,
});

describe('jobIdFrom', () => {
  it('takes the trailing number of a job number', () => {
    expect(jobIdFrom('SEA-123/45')).toBe('123');
    expect(jobIdFrom('SE-99')).toBe('99');
  });

  it('returns null rather than throwing on a missing job number', () => {
    // The old receiver did job.JobNumber.split() inline, so a job with no
    // number threw a TypeError and took its whole batch down.
    expect(jobIdFrom(null)).toBeNull();
    expect(jobIdFrom('')).toBeNull();
    expect(jobIdFrom('   ')).toBeNull();
    expect(() => jobIdFrom(undefined)).not.toThrow();
  });
});

describe('mapJob - foreign keys', () => {
  it('resolves every relationship through the legacy id', () => {
    const m = mapJob(job(1), 'SE', resolvers());
    expect(m.ClientId).toBe('client-1');
    expect(m.commodityId).toBe('commodity-1');
    expect(m.vesselId).toBe('vessel-1');
    expect(m.VoyageId).toBe('voyage-1');
    expect(m.companyId).toBe('company-1');
    expect(m.salesRepresentatorId).toBe('employee-1');
    expect(m.createdById).toBe('migration-user');
    expect(m.climaxId).toBe(1);
  });

  it('does not throw when a vessel does not resolve', () => {
    // The receiver read `vessel.id` with no guard. A sea job whose VesselId
    // missed threw a TypeError, and the loop wrapping the request took the
    // other nine jobs in the batch with it.
    const r = resolvers({ vessels: new Map() });
    expect(() => mapJob(job(1), 'SE', r)).not.toThrow();
    const m = mapJob(job(1), 'SE', r);
    expect(m.vesselId).toBeNull();
    expect(m.VoyageId).toBeNull();      // no vessel means no voyage key
  });

  it('leaves an unresolvable link null rather than inventing one', () => {
    const m = mapJob(job(1), 'SE', resolvers({ clients: new Map(), companies: new Map() }));
    expect(m.ClientId).toBeNull();
    expect(m.companyId).toBeNull();
  });

  it('keys a voyage by vessel and number together', () => {
    // The legacy voyage number is only unique within a vessel.
    const m = mapJob(job(1, { VoyageNo: 'V2' }), 'SE', resolvers());
    expect(m.VoyageId).toBeNull();
  });
});

describe('mapJob - sea vs air', () => {
  it('reads sea ports straight off the job', () => {
    const m = mapJob(
      job(1, { PortOfLoadingCode: 'NLRTM', PortOfDischargeCode: 'PKKHI' }), 'SE', resolvers(),
    );
    expect(m.pol).toBe('NLRTM');
    expect(m.pod).toBe('PKKHI');
    expect(m.flightNo).toBeNull();
  });

  it('reads air ports from the scalars the client resolved', () => {
    // The legacy lookups total 8.9 MB, so they are resolved once on the client
    // and each job arrives carrying only what it needs on _resolved.
    const m = mapJob(
      job(1, {
        FlightNo: 'EK601',
        _resolved: { polAirport: 'LHR', fdName: 'LONDON' },
      }),
      'AE', resolvers(),
    );
    expect(m.pol).toBe('LHR');
    expect(m.fd).toBe('LONDON');
    expect(m.flightNo).toBe('EK601');
    // Air jobs have no vessel or voyage at all.
    expect(m.vesselId).toBeNull();
    expect(m.VoyageId).toBeNull();
  });

  it('stamps the operation it was told', () => {
    for (const op of ['SE', 'SI', 'AE', 'AI']) {
      expect(mapJob(job(1), op, resolvers()).operation).toBe(op);
    }
  });
});

describe('planJobs', () => {
  const ctx = (over = {}) => ({ existingClimaxIds: [], resolvers: resolvers(), ...over });

  it('skips jobs already imported instead of duplicating them', () => {
    const plan = planJobs([job(1), job(2)], 'SE', ctx({ existingClimaxIds: [1] }));
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((j) => j.climaxId)).toEqual([2]);
  });

  it('refuses a job with no job number', () => {
    // jobNo is how every screen finds a job; a blank one is unusable.
    const plan = planJobs([job(1, { JobNumber: null }), job(2)], 'SE', ctx());
    expect(plan.problems.missingJobNo).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('counts unresolved links per relationship, not as one number', () => {
    // A row count cannot see a null foreign key, and which lookup table is
    // short matters - "the companies stage did not run" is a different problem
    // from "some sales reps are roles rather than people".
    const plan = planJobs(
      [job(1), job(2)], 'SE',
      ctx({ resolvers: resolvers({ clients: new Map(), commodities: new Map() }) }),
    );
    expect(plan.unresolved.client).toBe(2);
    expect(plan.unresolved.commodity).toBe(2);
    expect(plan.unresolved.company).toBe(0);
    expect(plan.stats.withoutClient).toBe(2);
  });

  it('does not count a link the source never had', () => {
    const plan = planJobs([job(1, { CommodityId: null })], 'SE', ctx());
    expect(plan.unresolved.commodity).toBe(0);
  });

  it('calls out jobs with no company, which are invisible on every screen', () => {
    const plan = planJobs([job(1)], 'SE', ctx({ resolvers: resolvers({ companies: new Map() }) }));
    expect(plan.stats.withoutCompany).toBe(1);
    expect(plan.canApply).toBe(true);     // reported, not fatal
  });

  it('counts rows with no usable id and duplicated ids', () => {
    const plan = planJobs([{ JobNumber: 'X' }, job('abc'), job(2), job(2)], 'SE', ctx());
    expect(plan.problems.missingId).toBe(2);
    expect(plan.problems.duplicateClimaxIds).toEqual([2]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('refuses an unknown operation rather than importing under a wrong one', () => {
    expect(() => planJobs([], 'XX', ctx())).toThrow(/Unknown job operation "XX"/);
  });

  it('does not throw on an empty source', () => {
    expect(planJobs([], 'SE', ctx()).stats.source).toBe(0);
    expect(planJobs(undefined, 'SE', ctx()).canApply).toBe(true);
  });

  it('emits rows of a uniform shape, so bulkCreate does not drop columns', () => {
    // bulkCreate builds its column list from the first row; a row missing a
    // key would silently lose that column for the whole batch.
    const plan = planJobs([job(1), job(2, { FlightNo: 'X' })], 'AE', ctx());
    const keys = plan.toCreate.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
  });
});
