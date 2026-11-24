import { invoiceApprovalTargets, isSettled } from 'functions/invoiceBulkApproval';

const inv = (id, over = {}) => ({
  id, invoice_No: `CL-JI-${id}/27`, type: 'Job Invoice', approved: '1',
  payType: 'Recievable', recieved: '0', paid: '0', ...over,
});
const line = (id, invoice) => ({ id, InvoiceId: invoice?.id ?? null, Invoice: invoice || null });

describe('invoiceApprovalTargets', () => {
  it('takes each document once, however many of its lines are ticked', () => {
    const a = inv(1);
    const r = invoiceApprovalTargets([line(10, a), line(11, a), line(12, a)], [10, 11, 12]);
    expect(r.toUnapprove.map((d) => d.id)).toEqual([1]);
  });

  it('only looks at ticked lines', () => {
    const r = invoiceApprovalTargets([line(10, inv(1)), line(11, inv(2))], [11]);
    expect(r.toUnapprove.map((d) => d.invoice_No)).toEqual(['CL-JI-2/27']);
  });

  it('sorts approved from unapproved', () => {
    const r = invoiceApprovalTargets(
      [line(10, inv(1)), line(11, inv(2, { approved: '0' })), line(12, inv(3, { approved: 0 }))],
      new Set([10, 11, 12]),
    );
    expect(r.toUnapprove.map((d) => d.id)).toEqual([1]);
    expect(r.toApprove.map((d) => d.id)).toEqual([2, 3]);
  });

  it('never offers to unapprove a settled document', () => {
    // Its voucher would go and the receipt that settled it would stay.
    const r = invoiceApprovalTargets([
      line(10, inv(1, { recieved: '500' })),
      line(11, inv(2, { type: 'Job Bill', payType: 'Payble', paid: '120' })),
      line(12, inv(3)),
    ], [10, 11, 12]);
    expect(r.settled.map((d) => d.id)).toEqual([1, 2]);
    expect(r.toUnapprove.map((d) => d.id)).toEqual([3]);
  });

  it('ignores lines that are not on any document', () => {
    const r = invoiceApprovalTargets([line(10, null)], [10]);
    expect(r).toEqual({ toUnapprove: [], toApprove: [], settled: [] });
  });
});

describe('isSettled', () => {
  it('reads the side the document falls on', () => {
    expect(isSettled(inv(1, { recieved: '1' }))).toBe(true);
    expect(isSettled(inv(1, { paid: '1' }))).toBe(false); // a receivable is settled by recieved
    expect(isSettled(inv(1, { payType: 'Payble', paid: '1' }))).toBe(true);
    expect(isSettled(null)).toBe(false);
  });

  it('reads the amount as a number - "0.00" is nothing settled', () => {
    // A receipt edit that takes an invoice off writes the rounded amount
    // back: "0.00", not "0". Compared as text, the invoice screen kept the
    // CFO's invoice locked as if settled (2026-11-10).
    expect(isSettled(inv(1, { recieved: '0.00' }))).toBe(false);
    expect(isSettled(inv(1, { payType: 'Payble', paid: '0.00' }))).toBe(false);
    expect(isSettled(inv(1, { recieved: '' }))).toBe(false);
    expect(isSettled(inv(1, { recieved: null }))).toBe(false);
    expect(isSettled(inv(1, { recieved: '0.01' }))).toBe(true);
    expect(isSettled(inv(1, { recieved: '-150.00' }))).toBe(true);
  });
});
