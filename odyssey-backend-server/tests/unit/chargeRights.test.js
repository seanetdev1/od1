/**
 * What a charge-sheet save changes that needs a right of its own -
 * functions/chargeRights (the user's request, 2026-10-20: someone may enter
 * charges and raise invoices without approving or editing them).
 */
const { chargeRightsNeeded, holdApprovals, openInvoiceLineIds, approvedInvoiceLock } = require('../../functions/chargeRights');

const line = (x = {}) => ({
  id: 1, charge: '5', description: '', type: 'Recievable', qty: '1', rate_charge: '2500',
  discount: '0', currency: 'PKR', ex_rate: '1', partyId: '7', tax_apply: false, taxPerc: '0',
  net_amount: '2500', status: '0', InvoiceId: null, Invoice: null, ...x,
});
const onOpen = (x = {}) => line({ InvoiceId: 40, Invoice: { id: 40, approved: '0' }, status: '1', ...x });
const onIssued = (x = {}) => line({ InvoiceId: 41, Invoice: { id: 41, approved: '1' }, status: '1', ...x });
const sentFrom = (r, x = {}) => { const { Invoice, ...rest } = r; return { ...rest, ...x }; };

describe('which rights a save needs', () => {
  test('an unchanged sheet needs neither - and asks for nothing', () => {
    const stored = [line(), onOpen({ id: 2 })];
    expect(chargeRightsNeeded(stored.map((r) => sentFrom(r)), stored)).toEqual({ approve: false, invoiced: false });
  });

  test('the same figures in another shape are not a change', () => {
    const stored = [onOpen({ id: 2, qty: '1', rate_charge: '2500.00', tax_apply: 'false' })];
    const sent = [sentFrom(stored[0], { qty: 1, rate_charge: 2500, tax_apply: false })];
    expect(chargeRightsNeeded(sent, stored).invoiced).toBe(false);
  });

  test('approving a line - or a new line arriving approved - needs Approve', () => {
    expect(chargeRightsNeeded([sentFrom(line(), { status: '1' })], [line()]).approve).toBe(true);
    expect(chargeRightsNeeded([line({ id: undefined, status: '1' })], []).approve).toBe(true);
    expect(chargeRightsNeeded([line({ id: undefined })], []).approve).toBe(false);
  });

  test('taking an approval back needs it too', () => {
    const stored = [line({ status: '1' })];
    expect(chargeRightsNeeded([sentFrom(stored[0], { status: '0' })], stored).approve).toBe(true);
  });

  test('changing a line on an unapproved invoice is editing that invoice', () => {
    const stored = [onOpen({ id: 2 })];
    expect(chargeRightsNeeded([sentFrom(stored[0], { rate_charge: '3000' })], stored).invoiced).toBe(true);
  });

  test('so is taking it off - left off the sheet, or in a delete list', () => {
    const stored = [line(), onOpen({ id: 2 })];
    expect(chargeRightsNeeded([sentFrom(stored[0])], stored).invoiced).toBe(true);
    expect(chargeRightsNeeded(stored.map((r) => sentFrom(r)), stored, { removed: [2] }).invoiced).toBe(true);
    // A line on no invoice deleted is the charges' own business.
    expect(chargeRightsNeeded([sentFrom(stored[1])], stored, { removed: [1] }).invoiced).toBe(false);
  });

  test('a line on an APPROVED invoice is frozen anyway, so it asks for nothing', () => {
    const stored = [onIssued({ id: 3 })];
    expect(chargeRightsNeeded([sentFrom(stored[0], { rate_charge: '1', status: '0' })], stored))
      .toEqual({ approve: false, invoiced: false });
  });

  test('changing a line on no invoice is just editing charges', () => {
    const stored = [line()];
    expect(chargeRightsNeeded([sentFrom(stored[0], { rate_charge: '9' })], stored)).toEqual({ approve: false, invoiced: false });
  });
});

describe('holding approvals for someone who may not approve', () => {
  test('a stored line keeps its approval, and who gave it', () => {
    const stored = [line({ status: '1', approved_by: 'dir', approval_date: '2026-10-19' })];
    const [held] = holdApprovals([sentFrom(stored[0], { status: '0', approved_by: null })], stored);
    expect(held).toMatchObject({ status: '1', approved_by: 'dir', approval_date: '2026-10-19' });
  });

  test('a new line comes in unapproved', () => {
    const [held] = holdApprovals([line({ id: undefined, status: '1', approved_by: 'me' })], []);
    expect(held).toMatchObject({ status: '0', approved_by: null, approval_date: null });
  });

  test('everything else on the line is kept as sent', () => {
    const stored = [line()];
    const [held] = holdApprovals([sentFrom(stored[0], { status: '1', rate_charge: '3000' })], stored);
    expect(held).toMatchObject({ status: '0', rate_charge: '3000' });
  });
});

test('the lines on unapproved invoices, by id', () => {
  expect([...openInvoiceLineIds([line(), onOpen({ id: 2 }), onIssued({ id: 3 })])]).toEqual(['2']);
});

/* A LINE ON AN APPROVED INVOICE IS FROZEN on the freight sheet's save -
 * ACS-AE-728/27 (SNS, 2026-11-13): a stale sheet showed ACS-JB-818/27
 * unapproved, its lines were removed and entered again on two new bills, and
 * the bill stayed approved with no lines - its cost counted twice. */
describe('lines on an approved invoice', () => {
  const billed = (x = {}) => onIssued({ particular: 'AIR FREIGHT', Invoice: { id: 41, approved: '1', invoice_No: 'ACS-JB-818/27' }, ...x });

  test('removing them is refused, naming the lines and the bill', () => {
    const stored = [billed({ id: 1 }), billed({ id: 2, particular: 'AWC' }), billed({ id: 3, particular: 'REFUND' })];
    const lock = approvedInvoiceLock([], stored, { removed: [1, 2, 3] });
    expect(lock.refusal).toBe('AIR FREIGHT, AWC and REFUND are on ACS-JB-818/27, which is approved, so they cannot be removed. '
      + 'Un-approve it first. Nothing was saved.');
  });

  test('one line removed reads as one', () => {
    expect(approvedInvoiceLock([], [billed()], { removed: ['1'] }).refusal)
      .toBe('AIR FREIGHT is on ACS-JB-818/27, which is approved, so it cannot be removed. Un-approve it first. Nothing was saved.');
  });

  test('a line on an unapproved invoice, or on none, may still be removed', () => {
    expect(approvedInvoiceLock([], [line(), onOpen({ id: 2 })], { removed: [1, 2] }).refusal).toBeNull();
  });

  test('a removed id that no longer exists is not a refusal', () => {
    expect(approvedInvoiceLock([], [], { removed: [99] }).refusal).toBeNull();
  });

  test('re-sent unchanged, they are left out of the save - not rewritten', () => {
    const stored = [line(), billed({ id: 2 })];
    const sent = stored.map((r) => sentFrom(r));
    const lock = approvedInvoiceLock(sent, stored);
    expect(lock.refusal).toBeNull();
    expect(lock.warning).toBeNull();
    expect(lock.keep.map((c) => c.id)).toEqual([1]);
  });

  test('a stale copy - off its invoice, unapproved - cannot write that back', () => {
    const stored = [billed({ id: 2 })];
    const lock = approvedInvoiceLock([sentFrom(stored[0], { InvoiceId: null, invoice_id: null, status: '0' })], stored);
    expect(lock.keep).toEqual([]);
    expect(lock.warning).toBeNull();
  });

  test('the sheet working out net_amount again is not an edit', () => {
    const stored = [billed({ id: 2, net_amount: '2500' })];
    const lock = approvedInvoiceLock([sentFrom(stored[0], { net_amount: '2499.99' })], stored);
    expect(lock.keep).toEqual([]);
    expect(lock.warning).toBeNull();
  });

  test('a real change is dropped, with a warning naming the bill', () => {
    const stored = [billed({ id: 2 })];
    const lock = approvedInvoiceLock([sentFrom(stored[0], { rate_charge: '3000' })], stored);
    expect(lock.keep).toEqual([]);
    expect(lock.warning).toBe('ACS-JB-818/27 is approved, so the changes to its line were not saved. Un-approve it to change them.');
  });

  test('a new party is refused, as moving an approved invoice always was', () => {
    const stored = [billed({ id: 2 })];
    const lock = approvedInvoiceLock([sentFrom(stored[0], { partyId: '8' })], stored);
    expect(lock.refusal).toBe('ACS-JB-818/27 is approved. Un-approve it before moving it to another party.');
  });

  test("the bill number falls back to the line's own when the invoice is not joined", () => {
    const stored = [onIssued({ id: 2, particular: 'AWC', invoice_id: 'SNS-JB-9/27' })];
    expect(approvedInvoiceLock([], stored, { removed: [2] }).refusal).toMatch(/^AWC is on SNS-JB-9\/27, which is approved/);
  });
});
