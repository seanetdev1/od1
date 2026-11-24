const { marksParty, lineAccountId } = require('../../functions/paymentLines');

/* Which account a Payments & Receipts line posts to. A bank account whose id
 * was the party's Clients id posted to the party (v1.2.88's tag run). */
describe('lineAccountId', () => {
  const ctx = (marked) => ({ partyId: 42, partyAccountId: 5686, marked });

  test("the party's account line always goes to the party's account", () => {
    expect(lineAccountId({ accountType: 'partyAccount', partyId: 42 }, ctx(true))).toBe(5686);
    expect(lineAccountId({ accountType: 'partyAccount', partyId: 42 }, ctx(false))).toBe(5686);
  });

  test("marked: a bank account that shares the party's id still goes to the bank", () => {
    expect(lineAccountId({ accountType: 'payAccount', partyId: 42, onParty: false }, ctx(true))).toBe(42);
    expect(lineAccountId({ accountType: 'payAccount', partyId: 42 }, ctx(true))).toBe(42);
  });

  test("marked: the party's own tax or gain / loss line goes to its account", () => {
    expect(lineAccountId({ accountType: 'Tax Account', partyId: 42, onParty: true }, ctx(true))).toBe(5686);
    expect(lineAccountId({ accountType: 'Tax Account', partyId: 77 }, ctx(true))).toBe(77);
  });

  test('a request with no marks (an older screen) is read as before', () => {
    expect(lineAccountId({ accountType: 'Gain/Loss Account', partyId: 42 }, ctx(false))).toBe(5686);
    expect(lineAccountId({ accountType: 'payAccount', partyId: 12 }, ctx(false))).toBe(12);
  });
});

describe('marksParty', () => {
  test('any line carrying the mark, true or false', () => {
    expect(marksParty([{ accountType: 'payAccount' }, { onParty: true }])).toBe(true);
    expect(marksParty([{ onParty: false }])).toBe(true);
    expect(marksParty([{ accountType: 'payAccount' }, { accountType: 'partyAccount' }])).toBe(false);
    expect(marksParty(undefined)).toBe(false);
  });
});
