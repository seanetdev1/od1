const { whyNotListed, notListed } = require('../../functions/invoiceNotListed');

/* Why an invoice a Payments & Receipts search named is not on the list - the
 * SNS-AI-620/26 case (2026-11-16): an agent bill paid in full, searched for
 * on a payment to its party, and "not found". */
describe('whyNotListed', () => {
  const ctx = { partyIds: ['1273', '6083'], pay: 'Payble', currency: 'USD' };
  const bill = (over = {}) => ({
    id: 42649, invoice_No: 'SNS-AI-620/26', party_Id: '6083', party_Name: 'PETER RATHMANN & CO. GMBH',
    approved: '1', payType: 'Payble', currency: 'USD', total: '496.49', roundOff: '0', paid: '0', recieved: '0',
    ...over,
  });

  test('paid in full: settled', () => {
    expect(whyNotListed(bill({ paid: '496.49' }), ctx)).toBe('settled');
  });

  test('still owed and matching everything: no reason - it should have been listed', () => {
    expect(whyNotListed(bill(), ctx)).toBeNull();
    expect(whyNotListed(bill({ paid: '200' }), ctx)).toBeNull();
  });

  test('the party id may be the client or its ledger account', () => {
    expect(whyNotListed(bill({ party_Id: '1273' }), ctx)).toBeNull();
    expect(whyNotListed(bill({ party_Id: 6083 }), ctx)).toBeNull();
  });

  test('each condition, and the first that applies wins', () => {
    expect(whyNotListed(bill({ party_Id: '999' }), ctx)).toBe('otherParty');
    expect(whyNotListed(bill({ party_Id: '999', approved: '0' }), ctx)).toBe('otherParty');
    expect(whyNotListed(bill({ approved: '0', currency: 'PKR' }), ctx)).toBe('unapproved');
    expect(whyNotListed(bill({ payType: 'Recievable', currency: 'PKR' }), ctx)).toBe('otherSide');
    expect(whyNotListed(bill({ currency: 'PKR', paid: '496.49' }), ctx)).toBe('otherCurrency');
  });

  test("'Both' sides, or none given, is never the other side", () => {
    expect(whyNotListed(bill({ payType: 'Recievable' }), { ...ctx, pay: 'Both' })).toBeNull();
    expect(whyNotListed(bill({ payType: 'Recievable' }), { ...ctx, pay: undefined })).toBeNull();
  });

  test('a receivable is settled by what was received, round off included', () => {
    const inv = bill({ payType: 'Recievable', total: '100', roundOff: '0.4', recieved: '100.4' });
    expect(whyNotListed(inv, { ...ctx, pay: 'Recievable' })).toBe('settled');
    expect(whyNotListed({ ...inv, recieved: '100' }, { ...ctx, pay: 'Recievable' })).toBeNull();
  });
});

describe('notListed', () => {
  const ctx = { partyIds: ['6083'], pay: 'Payble', currency: 'USD' };
  test('only the explained ones, with the vouchers that settled a settled one', () => {
    const rows = [
      { id: 1, invoice_No: 'A-1', party_Id: '6083', approved: '1', payType: 'Payble', currency: 'USD', total: '10', paid: '10', party_Name: 'P' },
      { id: 2, invoice_No: 'A-2', party_Id: '6083', approved: '1', payType: 'Payble', currency: 'USD', total: '10', paid: '0', party_Name: 'P' },
      { id: 3, invoice_No: 'A-3', party_Id: '6083', approved: '1', payType: 'Payble', currency: 'PKR', total: '10', paid: '0', party_Name: 'P' },
    ];
    expect(notListed(rows, ctx, new Map([[1, ['SNS-ADJ-P-31/27']]]))).toEqual([
      { id: 1, invoice_No: 'A-1', party_Name: 'P', payType: 'Payble', currency: 'USD', reason: 'settled', settledBy: ['SNS-ADJ-P-31/27'] },
      { id: 3, invoice_No: 'A-3', party_Name: 'P', payType: 'Payble', currency: 'PKR', reason: 'otherCurrency' },
    ]);
  });

  test('nothing given: nothing', () => {
    expect(notListed(undefined, ctx)).toEqual([]);
  });
});
