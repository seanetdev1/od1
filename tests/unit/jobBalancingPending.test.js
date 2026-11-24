/**
 * Job Balancing > Pending - functions/jobBalancingPending (the user,
 * 2026-11-20: jobs without invoices against them). The query is checked
 * against the database in tests/integration/jobBalancing.test.js.
 */
const { wanted, pendingRow } = require('../../functions/jobBalancingPending');

describe('which jobs the Operation Types ask for', () => {
  test('nothing ticked: freight and customs', () => {
    expect(wanted({})).toEqual({ freightOps: ['SE', 'SI', 'AE', 'AI'], customs: true });
  });
  test('only the ticked freight types; customs only with CC', () => {
    expect(wanted({ jobtypes: 'SE,AI' })).toEqual({ freightOps: ['SE', 'AI'], customs: false });
    expect(wanted({ jobtypes: 'CC' })).toEqual({ freightOps: [], customs: true });
  });
  test('an overseas agent picked: no goods declarations - they have none', () => {
    expect(wanted({ overseasAgent: '12' }).customs).toBe(false);
  });
});

describe('a pending row', () => {
  test('a job with nothing owed and "Not invoiced" for its number', () => {
    const row = pendingRow({ id: 7, companyId: '1', createdAt: '2026-08-01', partyName: 'ACME', side: 'Recievable' },
      { SE_Job: { id: 7, jobNo: 'SNS-SEJ-7/27' } });
    expect(row).toMatchObject({
      id: 'pending-7', pending: true, invoice_No: 'Not invoiced', payType: 'Recievable',
      total: '0', paid: '0', recieved: '0', party_Name: 'ACME', Charge_Heads: [],
      SE_Job: { jobNo: 'SNS-SEJ-7/27' },
    });
  });
  test('names an unapproved invoice the job has, so a second is not raised', () => {
    expect(pendingRow({ id: 1, unapproved: 'CL-JI-12/27' }, {}).invoice_No).toBe('CL-JI-12/27 (unapproved)');
  });
  test('All when the report is run for both sides', () => {
    expect(pendingRow({ id: 1 }, {}).payType).toBe('All');
  });
});
