import {
  isSettling, voucherAmountOf, settlementFigures, settleProblems, settlementPayload, roomFor, capToVoucher,
} from 'functions/advanceSettlement';
import { setAllocation, setAllocations } from 'functions/paymentReceiptSelection';
import { jobColumns, jobKindOf, jobLink, docLink } from 'functions/invoiceJobColumns';

/* Settling an open payment / receipt on Payments & Receipts (Refresh, tick,
 * Save Settlement) - knock-offs only, capped at what the voucher brought in
 * (the user's choice, 2026-11-06). Hasnain Cargo's ACS-BRV-00856/24: 1,775,000
 * received, 96,386 knocked off. */
const sel = (...entries) => Object.fromEntries(entries.map((e) => [String(e.id), { payType: 'Recievable', currency: 'PKR', ...e }]));

describe('settling', () => {
  test('only once Refresh is pressed on an open voucher', () => {
    expect(isSettling({ edit: true, editing: true })).toBe(true);
    expect(isSettling({ edit: true, editing: false })).toBe(false);
    expect(isSettling({ edit: false, editing: true })).toBe(false);
  });

  test("the voucher's amount is its party lines, as posted", () => {
    expect(voucherAmountOf([
      { accountType: 'partyAccount', type: 'credit', amount: '1775000' },
      { accountType: 'payAccount', type: 'debit', amount: '1775000' },
    ])).toBe(1775000);
    expect(voucherAmountOf([{ accountType: 'partyAccount', type: 'debit', amount: '5000' }])).toBe(5000);
  });

  const state = { edit: true, editing: true, voucherId: 21920, voucherAmount: 1775000, exRate: 1 };

  test('what the ticks knock off, and what stays as advance', () => {
    const s = sel({ id: 10, receiving: 96386 }, { id: 20, receiving: 1263520.1 });
    expect(settlementFigures(state, s)).toEqual({ amount: 1775000, applied: 1359906.1, left: 415093.9 });
    expect(settleProblems(state, s)).toEqual([]);
  });

  test('more than the voucher has is a problem - it used to grow the receipt', () => {
    const s = sel({ id: 10, receiving: 96386 }, { id: 20, receiving: 1700000 });
    expect(settleProblems(state, s)).toEqual([
      "The invoices ticked come to 1,796,386.00 - 21,386.00 more than this voucher's 1,775,000.00",
    ]);
  });

  test('nothing ticked is fine - the whole voucher stays as advance', () => {
    expect(settleProblems(state, {})).toEqual([]);
    expect(settlementFigures(state, {}).left).toBe(1775000);
  });

  test('the save sends every invoice at its share, a taken-off one at 0', () => {
    const s = sel({ id: 10, receiving: 0, saved: true }, { id: 20, receiving: 100.005 });
    expect(settlementPayload(state, s, 'emp-1')).toEqual({
      voucherId: 21920, employeeId: 'emp-1',
      invoices: [{ id: 10, receiving: 0 }, { id: 20, receiving: 100.01 }],
    });
  });
});

describe('an advance row of Job Balancing', () => {
  const row = { advance: true, voucherId: 21920, id: 'advance-21920-5686', invoice_No: 'ACS-BRV-00856/24', SE_Job: null };

  test('no job: every job column empty but the type, "Advance"', () => {
    expect(jobKindOf(row)).toBe('advance');
    const cols = jobColumns(row);
    expect(cols.jobType).toBe('Advance');
    expect(cols.jobNo).toBe('');
    expect(cols.docPrimary).toBe('');
    expect(jobLink(row)).toBeNull();
  });

  test('its number opens the voucher; an invoice\'s opens the invoice', () => {
    expect(docLink(row)).toEqual({
      href: '/accounts/paymentReceipt/21920', tab: { label: 'Payment / Receipt', key: '3-4', id: '21920' },
    });
    expect(docLink({ id: 77 })).toEqual({
      href: '/reports/invoice/77', tab: { label: 'Invoice Details', key: '3-17', id: '77' },
    });
  });
});

/* Settling cannot go over (the user, 2026-11-06): ticks take what the voucher
 * still has, and the invoice that reaches the end takes what is left. */
describe('capped at what the voucher has left', () => {
  const settling = { edit: true, editing: true, voucherAmount: 1000, exRate: 1 };
  const inv = (id, total, payType = 'Recievable') => ({ id, invoice_No: `JI-${id}`, total: String(total), payType, currency: 'PKR' });
  const A = inv(1, 600); const B = inv(2, 700); const C = inv(3, 50);
  const shares = (sel) => Object.fromEntries(Object.values(sel).map((e) => [e.id, e.receiving]));

  test('select-all past the end: the oldest in full, the next takes what is left', () => {
    const next = setAllocations({}, [{ invoice: A, amount: 600 }, { invoice: B, amount: 700 }]);
    const { selection, capped } = capToVoucher(settling, {}, next);
    expect(shares(selection)).toEqual({ 1: 600, 2: 400 });
    expect(capped).toBe(true);
  });

  test('ticked once nothing is left: not ticked at all', () => {
    const full = setAllocations({}, [{ invoice: A, amount: 600 }, { invoice: B, amount: 400 }]);
    const { selection, capped } = capToVoucher(settling, full, setAllocation(full, C, 50));
    expect(shares(selection)).toEqual({ 1: 600, 2: 400 });
    expect(capped).toBe(true);
  });

  test('an amount typed over what is left comes down to it', () => {
    const prev = setAllocations({}, [{ invoice: A, amount: 600 }, { invoice: B, amount: 100 }]);
    const { selection } = capToVoucher(settling, prev, setAllocation(prev, B, 700));
    expect(shares(selection)).toEqual({ 1: 600, 2: 400 });
  });

  test('lowering or unticking is never capped', () => {
    const prev = setAllocations({}, [{ invoice: A, amount: 600 }, { invoice: B, amount: 400 }]);
    const next = setAllocation(prev, A, 100);
    expect(capToVoucher(settling, prev, next)).toEqual({ selection: next, capped: false });
  });

  test('a payment settling bills is capped the same way', () => {
    const pay = { ...settling, voucherAmount: 500 };
    const b1 = inv(4, 300, 'Payble'); const b2 = inv(5, 400, 'Payble');
    const next = setAllocations({}, [{ invoice: b1, amount: 300 }, { invoice: b2, amount: 400 }]);
    expect(shares(capToVoucher(pay, {}, next).selection)).toEqual({ 4: 300, 5: 200 });
    expect(roomFor(pay, {}, b2, 400)).toBe(400);
  });

  test('not settling: the selection is as given', () => {
    const next = setAllocations({}, [{ invoice: A, amount: 600 }, { invoice: B, amount: 700 }]);
    expect(capToVoucher({ ...settling, editing: false }, {}, next)).toEqual({ selection: next, capped: false });
  });
});

/* Job Balancing > Pending (2026-11-20): a job with no invoice has no document
 * of its own, so its Inv. No ("Not invoiced") opens the job. */
describe('a Pending row', () => {
  test('opens its job - a freight job or a goods declaration', () => {
    expect(docLink({ id: 'pending-7', pending: true, SE_Job: { id: 7, jobNo: 'SNS-SEJ-7/27', operation: 'SE' } }))
      .toEqual(jobLink({ SE_Job: { id: 7, jobNo: 'SNS-SEJ-7/27', operation: 'SE' } }));
    expect(docLink({ id: 'pending-9', pending: true, customs: { jobId: 9, jobNo: 'CL-CCJ-9/27' } }).href).toBe('/customsJobs/9');
  });
});
