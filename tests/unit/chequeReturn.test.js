const { returnRefusal, returnNarration, returnLines, returnedRefusal } = require('../../functions/chequeReturn');

/* The cheque return's rules and lines - functions/chequeReturn. */
describe('cheque return', () => {
  const brv = { voucher_Id: 'SNS-BRV-12/27', type: 'Job Reciept', vType: 'BRV', voucherNarration: 'Received Cheque 123' };

  test('only a bank payment or receipt, and only once', () => {
    expect(returnRefusal(brv, null)).toBeNull();
    expect(returnRefusal({ ...brv, type: 'Job Payment', vType: 'BPV' }, null)).toBeNull();
    expect(returnRefusal({ ...brv, vType: 'CRV' }, null)).toMatch(/Only a bank/);
    expect(returnRefusal({ ...brv, vType: 'ADJ-R' }, null)).toMatch(/Only a bank/);
    expect(returnRefusal({ ...brv, type: 'JOURNAL VOUCHER', vType: 'JV' }, null)).toMatch(/not a payment or receipt/);
    expect(returnRefusal({ ...brv, vType: 'CR', returnOfId: 4 }, null)).toMatch(/cheque return itself/);
    expect(returnRefusal(brv, { voucher_Id: 'SNS-CR-1/27' })).toBe('This cheque was already returned - SNS-CR-1/27.');
    expect(returnRefusal(null, null)).toBe('Voucher not found.');
  });

  test("the narration is the original's, as Climax wrote it", () => {
    expect(returnNarration(brv)).toBe('Reversal: Received Cheque 123');
    expect(returnNarration({ voucher_Id: 'SNS-BRV-12/27' })).toBe('Reversal: SNS-BRV-12/27');
  });

  test('every line on the other side, at the same amounts and accounts', () => {
    const heads = [
      { type: 'debit', amount: '400', defaultAmount: '112000', accountType: 'payAccount', ChildAccountId: 9 },
      { type: 'credit', amount: '395', defaultAmount: '110600', accountType: 'partyAccount', ChildAccountId: 7 },
      { type: 'credit', amount: '5', defaultAmount: '1400', accountType: 'Gain/Loss Account', ChildAccountId: 3 },
    ];
    expect(returnLines(heads, 'R')).toEqual([
      { type: 'credit', amount: '400', defaultAmount: '112000', accountType: 'payAccount', ChildAccountId: 9, narration: 'R' },
      { type: 'debit', amount: '395', defaultAmount: '110600', accountType: 'partyAccount', ChildAccountId: 7, narration: 'R' },
      { type: 'debit', amount: '5', defaultAmount: '1400', accountType: 'Gain/Loss Account', ChildAccountId: 3, narration: 'R' },
    ]);
  });

  test('a returned receipt says which return holds it', () => {
    expect(returnedRefusal({ voucher_Id: 'SNS-CR-1/27' })).toMatch(/returned - SNS-CR-1\/27/);
    expect(returnedRefusal(null)).toBeNull();
  });
});
