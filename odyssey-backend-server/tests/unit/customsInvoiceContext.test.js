/**
 * Declaration context on customs invoices.
 *
 * The shared job-column reports read `Invoice.SE_Job`. A customs invoice has
 * none, so without this its row is blank and anything dereferencing the job
 * throws. The contract that matters is the one about NOT changing anything
 * else: a freight invoice must come back exactly as it went in.
 */
const { attachCustomsContext } = require('../../functions/customsInvoiceContext');

// A stand-in for a Sequelize instance: the function writes to dataValues, the
// way the reports read it back.
const invoice = (props) => ({ dataValues: {}, ...props });

const JOB = {
  id: 4, jobNo: 'SNS-CCJ-1/26', jobDate: '2026-08-17', gdNumber: 'KAPW-HC-1234', gdDate: '2026-08-19',
  blNo: 'MAEU12345', direction: 'Import', transportMode: 'Sea', invoiceNo: 'AMA-18792-26', clientRef: 'AMA-REF',
};

const models = (jobs = [JOB]) => ({
  Customs_Job: { findAll: jest.fn().mockResolvedValue(jobs) },
});

describe('attaching the declaration', () => {
  test('fills the block in for a customs invoice', async () => {
    const rows = [invoice({ id: 9, SEJobId: null, Charge_Heads: [{ CustomsJobId: 4 }] })];
    await attachCustomsContext(rows, models());
    expect(rows[0].dataValues.customs).toEqual({
      jobId: 4,
      jobNo: 'SNS-CCJ-1/26',
      jobDate: '2026-08-17',
      gdNumber: 'KAPW-HC-1234',
      gdDate: '2026-08-19',
      blNo: 'MAEU12345',
      direction: 'Import',
      transportMode: 'Sea',
      clientInvoiceNo: 'AMA-18792-26',
    });
  });

  test('the client invoice falls back to clientRef, where older jobs kept it', async () => {
    const rows = [invoice({ id: 9, SEJobId: null, Charge_Heads: [{ CustomsJobId: 4 }] })];
    await attachCustomsContext(rows, models([{ ...JOB, invoiceNo: null }]));
    expect(rows[0].dataValues.customs.clientInvoiceNo).toBe('AMA-REF');
  });

  test('leaves a freight invoice alone, with customs explicitly null', async () => {
    // Explicitly null rather than absent: the report checks the key, and an
    // undefined would read the same as "not looked up yet".
    const rows = [invoice({ id: 1, SEJobId: 3, Charge_Heads: [{ SEJobId: 3 }] })];
    const m = models();
    await attachCustomsContext(rows, m);
    expect(rows[0].dataValues.customs).toBeNull();
    // And it costs nothing: a freight-only month must not pay for a query.
    expect(m.Customs_Job.findAll).not.toHaveBeenCalled();
  });

  test('answers null for an aviation invoice, which has no SE_Job either', async () => {
    // Both modules produce invoices with a null SEJobId, so "no freight job"
    // is not enough on its own to call one a customs invoice.
    const rows = [invoice({ id: 9, SEJobId: null, Charge_Heads: [{ AviationConsignmentId: 7 }] })];
    const m = models();
    await attachCustomsContext(rows, m);
    expect(rows[0].dataValues.customs).toBeNull();
    expect(m.Customs_Job.findAll).not.toHaveBeenCalled();
  });

  test('answers null when the job it names no longer exists', async () => {
    const rows = [invoice({ id: 9, SEJobId: null, Charge_Heads: [{ CustomsJobId: 4 }] })];
    await attachCustomsContext(rows, models([]));
    expect(rows[0].dataValues.customs).toBeNull();
  });

  test('costs ONE query however many invoices there are', async () => {
    const rows = [
      invoice({ id: 9,  SEJobId: null, Charge_Heads: [{ CustomsJobId: 4 }] }),
      invoice({ id: 10, SEJobId: null, Charge_Heads: [{ CustomsJobId: 4 }] }),
      invoice({ id: 11, SEJobId: 3,    Charge_Heads: [] }),
    ];
    const m = models();
    await attachCustomsContext(rows, m);
    expect(m.Customs_Job.findAll).toHaveBeenCalledTimes(1);
    expect(rows[0].dataValues.customs.jobId).toBe(4);
    expect(rows[1].dataValues.customs.jobId).toBe(4);
    expect(rows[2].dataValues.customs).toBeNull();
  });

  test('reports one of two jobs rather than throwing on a cross-file invoice', async () => {
    // Not reachable from the screen. If it ever happens, failing here - in a
    // report, long after the invoice was raised - would be the worst possible
    // place to find out.
    const rows = [invoice({
      id: 9, SEJobId: null,
      Charge_Heads: [{ CustomsJobId: 4 }, { CustomsJobId: 5 }],
    })];
    await attachCustomsContext(rows, models());
    expect(rows[0].dataValues.customs.jobId).toBe(4);
  });

  test('handles an empty list and a non-list without touching the database', async () => {
    const m = models();
    await expect(attachCustomsContext([], m)).resolves.toEqual([]);
    await expect(attachCustomsContext(null, m)).resolves.toEqual([]);
    expect(m.Customs_Job.findAll).not.toHaveBeenCalled();
  });

  test('blanks a missing field rather than emitting null into a report column', async () => {
    const rows = [invoice({ id: 9, SEJobId: null, Charge_Heads: [{ CustomsJobId: 4 }] })];
    await attachCustomsContext(rows, models([{ id: 4, jobNo: 'SNS-CCJ-2/26' }]));
    expect(rows[0].dataValues.customs).toEqual({
      jobId: 4, jobNo: 'SNS-CCJ-2/26', jobDate: '', gdNumber: '', gdDate: '',
      blNo: '', direction: '', transportMode: '', clientInvoiceNo: '',
    });
  });
});
