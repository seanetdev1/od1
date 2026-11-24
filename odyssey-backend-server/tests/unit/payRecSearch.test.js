const { Op, Sequelize } = require('sequelize');
const { searchedDay, searchedAmount, payRecSearchWhere } = require('../../functions/payRecSearch');

// The Payments & Receipts list's search box (the user, 2026-11-06).
describe('searchedDay', () => {
  test("the list's own DD-MM-YYYY is day first - the office's whole day, UTC+5", () => {
    expect(searchedDay('05-11-2026')).toEqual({
      from: new Date('2026-11-04T19:00:00.000Z'), to: new Date('2026-11-05T19:00:00.000Z'),
    });
    expect(searchedDay('5/11/2026').from).toEqual(new Date('2026-11-04T19:00:00.000Z'));
    expect(searchedDay('2026-11-05').from).toEqual(new Date('2026-11-04T19:00:00.000Z'));
  });

  test('what new Date() took for a date is not one', () => {
    ['429', 'BRV 1', 'ACS 2', 'hasnain', '31-02-2026', ''].forEach((s) => expect(searchedDay(s)).toBeNull());
  });
});

describe('searchedAmount', () => {
  test('a number, commas allowed, to the paisa', () => {
    expect(searchedAmount('1775000')).toBe(1775000);
    expect(searchedAmount('1,775,000')).toBe(1775000);
    expect(searchedAmount('1234.5')).toBe(1234.5);
  });
  test('anything else is not an amount', () => {
    ['BRV-429', '12.345', '-5', '0', 'abc', ''].forEach((s) => expect(searchedAmount(s)).toBeNull());
  });
});

describe('payRecSearchWhere', () => {
  const tools = { Op, Sequelize, sequelize: { escape: (v) => String(v) } };
  const fields = (w) => (w[Op.or] || []).map((c) => Object.keys(c)[0] || 'where');

  test('nothing typed: no condition', () => {
    expect(payRecSearchWhere('  ', tools)).toEqual({});
  });

  test('text looks in the voucher no, name, type, currency, cheque no and the invoices it settled', () => {
    const w = payRecSearchWhere('SNS-AI-620/26', tools);
    expect(fields(w)).toEqual(['voucher_Id', 'partyName', 'type', 'currency', 'chequeNo', 'id']);
    const sql = w[Op.or][5].id[Op.in].val;
    expect(sql).toMatch(/"Invoice_Transactions"/);
    expect(sql).toMatch(/"invoice_No" ILIKE %SNS-AI-620\/26%/);
  });

  test('a number also looks at the voucher number and the amounts', () => {
    const f = fields(payRecSearchWhere('429', tools));
    expect(f).toEqual(expect.arrayContaining(['chequeNo', 'id']));
    expect(f).toHaveLength(8);
  });

  test("a date also finds that day's vouchers", () => {
    expect(fields(payRecSearchWhere('05-11-2026', tools))).toContain('createdAt');
  });
});
