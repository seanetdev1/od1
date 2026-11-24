// The MAWBs a migration registers in the freight AWB stock - see
// functions/awblMigration. The register is what the AE BL save checks a MAWB
// against, so a number registered to the wrong job, or registered when it
// should not have been, is a real shipment problem rather than a report glitch.
// These pin the planner; the route that runs it is a thin wrapper.

const {
  planMawbRegistration, MIGRATION_REMARK, tally,
} = require('../../functions/awblMigration');

// 125-1000000 1 is valid: 1000000 % 7 = 1.
const VALID = '12510000001';
const VALID_2 = '12510000012';

const bl = (over = {}) => ({
  blId: 1, mbl: '125-10000001', jobId: 10, jobNo: 'SNS-AE-1/27', operation: 'AE',
  airLineId: 7, blCreatedAt: '2026-08-01T00:00:00.000Z', ...over,
});

const counts = (entries) => new Map(entries);

describe('planMawbRegistration', () => {
  test('registers a clean number as used by its job, under the job\'s airline', () => {
    const plan = planMawbRegistration([bl()], { jobCountByNumber: counts([[VALID, 1]]) });
    expect(plan.toCreate).toEqual([expect.objectContaining({
      awbNumber: VALID, prefix: '125', serial: '1000000', checkDigit: '1',
      AirlineId: 7, SEJobId: 10, status: 'used', remarks: MIGRATION_REMARK,
    })]);
    expect(plan.outcomes[0].outcome).toBe('registered');
  });

  test('does not register a number that is not 11 digits', () => {
    const plan = planMawbRegistration([bl({ mbl: '125-123' })]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.outcomes[0].outcome).toBe('invalidFormat');
  });

  test('does not register a number on a job with no airline', () => {
    const plan = planMawbRegistration([bl({ airLineId: null })], { jobCountByNumber: counts([[VALID, 1]]) });
    expect(plan.outcomes[0].outcome).toBe('noAirline');
  });

  test('does not register a wrong check digit, and suggests the corrected last digit', () => {
    const plan = planMawbRegistration([bl({ mbl: '125-10000009' })], {
      jobCountByNumber: counts([['12510000009', 1]]),
    });
    expect(plan.toCreate).toEqual([]);
    expect(plan.outcomes[0]).toMatchObject({ outcome: 'wrongCheckDigit', suggested: '125-10000001' });
  });

  test('a number on two jobs is registered to NEITHER', () => {
    const rows = [bl({ jobId: 10 }), bl({ blId: 2, jobId: 11, jobNo: 'SNS-AE-2/27' })];
    const plan = planMawbRegistration(rows, { jobCountByNumber: counts([[VALID, 2]]) });
    expect(plan.toCreate).toEqual([]);
    expect(plan.outcomes.map((o) => o.outcome)).toEqual(['duplicate', 'duplicate']);
  });

  test('two BLs on the SAME job with one number register it once', () => {
    const rows = [bl(), bl({ blId: 2 })];
    const plan = planMawbRegistration(rows, { jobCountByNumber: counts([[VALID, 1]]) });
    expect(plan.toCreate).toHaveLength(1);
  });

  test('re-running leaves a number already registered to the same job alone', () => {
    const plan = planMawbRegistration([bl()], {
      jobCountByNumber: counts([[VALID, 1]]),
      registeredByNumber: counts([[VALID, { id: 5, SEJobId: 10, status: 'used', AirlineId: 7 }]]),
    });
    expect(plan.toCreate).toEqual([]);
    expect(plan.toClaim).toEqual([]);
    expect(plan.outcomes[0].outcome).toBe('already');
  });

  test('a number already in stock, unused, for the same airline is claimed by the job', () => {
    const plan = planMawbRegistration([bl()], {
      jobCountByNumber: counts([[VALID, 1]]),
      registeredByNumber: counts([[VALID, { id: 5, SEJobId: null, status: 'unused', AirlineId: 7 }]]),
    });
    expect(plan.toClaim).toEqual([expect.objectContaining({ id: 5, SEJobId: 10 })]);
    expect(plan.outcomes[0].outcome).toBe('claimed');
  });

  test('stock under a different airline is not claimed', () => {
    const plan = planMawbRegistration([bl()], {
      jobCountByNumber: counts([[VALID, 1]]),
      registeredByNumber: counts([[VALID, { id: 5, SEJobId: null, status: 'unused', AirlineId: 99 }]]),
    });
    expect(plan.toClaim).toEqual([]);
    expect(plan.outcomes[0].outcome).toBe('airlineMismatch');
  });

  test('stock already used by another job is not taken', () => {
    const plan = planMawbRegistration([bl()], {
      jobCountByNumber: counts([[VALID, 1]]),
      registeredByNumber: counts([[VALID, { id: 5, SEJobId: 44, status: 'used', AirlineId: 7 }]]),
    });
    expect(plan.outcomes[0].outcome).toBe('takenByOtherJob');
  });

  test('an earlier MIGRATION registration of a number now on two jobs is withdrawn', () => {
    const rows = [bl({ jobId: 10 }), bl({ blId: 2, jobId: 11 })];
    const plan = planMawbRegistration(rows, {
      jobCountByNumber: counts([[VALID, 2]]),
      registeredByNumber: counts([[VALID, { id: 5, SEJobId: 10, status: 'used', AirlineId: 7, remarks: MIGRATION_REMARK }]]),
    });
    expect(plan.toRelease).toEqual([VALID]);
  });

  test('...but one a PERSON registered is never withdrawn', () => {
    const rows = [bl({ jobId: 10 }), bl({ blId: 2, jobId: 11 })];
    const plan = planMawbRegistration(rows, {
      jobCountByNumber: counts([[VALID, 2]]),
      registeredByNumber: counts([[VALID, { id: 5, SEJobId: 10, status: 'used', AirlineId: 7, remarks: null }]]),
    });
    expect(plan.toRelease).toEqual([]);
  });

  test('tally counts every outcome, including the ones that did not happen', () => {
    const plan = planMawbRegistration(
      [bl(), bl({ blId: 2, jobId: 11, mbl: VALID_2 })],
      { jobCountByNumber: counts([[VALID, 1], [VALID_2, 1]]) },
    );
    expect(tally(plan.outcomes)).toMatchObject({ registered: 2, duplicate: 0, wrongCheckDigit: 0 });
  });
});
