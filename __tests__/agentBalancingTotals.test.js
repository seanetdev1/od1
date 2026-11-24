/**
 * Agent Invoice Balancing: Currency All - every currency as invoiced - and the
 * Total lines (functions/agentBalancing).
 */
import { agentBalancingFigures, agentBalancingTotals, isAllCurrencies, ALL_CURRENCIES, withCnSign } from 'functions/agentBalancing';

const row = (fields, currency) => ({ ...fields, ...agentBalancingFigures(fields, currency) });
const usdInv = { payType: 'Recievable', currency: 'USD', ex_rate: '280', total: '100', recieved: '40', paid: '0' };
const usdBill = { payType: 'Payble', currency: 'USD', ex_rate: '280', total: '30', recieved: '0', paid: '10' };
const eurInv = { payType: 'Recievable', currency: 'EUR', ex_rate: '300', total: '50', recieved: '0', paid: '0' };

test('All is the default choice, and is told apart from PKR', () => {
  expect(ALL_CURRENCIES).toBe('All');
  expect(isAllCurrencies('All')).toBe(true);
  expect(isAllCurrencies('all')).toBe(true);
  expect(isAllCurrencies('PKR')).toBe(false);
});

test('All leaves every invoice in its own currency, unconverted', () => {
  expect(agentBalancingFigures(eurInv, ALL_CURRENCIES)).toMatchObject({ total: 50, balance: 50, debit: 50 });
});

test('All totals each currency on its own line', () => {
  const rows = [usdInv, usdBill, eurInv].map((x) => row(x, 'All'));
  expect(agentBalancingTotals(rows, 'All')).toEqual([
    { currency: 'EUR', debit: 50, credit: 0, paidRec: 0, balance: 50 },
    // Receivable less payable: received 40 less paid 10; balance 60 less 20.
    { currency: 'USD', debit: 100, credit: 30, paidRec: 30, balance: 40 },
  ]);
});

test('one currency is one line', () => {
  const rows = [usdInv, usdBill].map((x) => row(x, 'USD'));
  expect(agentBalancingTotals(rows, 'USD')).toEqual([{ currency: 'USD', debit: 100, credit: 30, paidRec: 30, balance: 40 }]);
});

test('PKR converts once - the Paid / Rcvd total was converted twice', () => {
  const rows = [usdInv, usdBill, eurInv].map((x) => row(x, 'PKR'));
  expect(agentBalancingTotals(rows, 'PKR')).toEqual([{
    currency: 'PKR',
    debit: 28000 + 15000,
    credit: 8400,
    paidRec: 11200 - 2800,
    balance: (28000 - 11200) + 15000 - (8400 - 2800),
  }]);
});

test('no rows, no lines', () => {
  expect(agentBalancingTotals([], 'All')).toEqual([]);
});

/* A CN's figures below zero - ALWAYS since 2026-11-16 ("we need to show
   credit values in negative"; it was an option, off by default). Its Credit,
   invoice total, paid and balance; and `amount` for the one-column layout.
   Display only. */
describe('a CN below zero', () => {
  test('a CN row: its Credit, Amount, invoice total, paid and balance all below zero', () => {
    const cn = row(usdBill, 'USD');
    expect(withCnSign(cn)).toMatchObject({ amount: -30, credit: -30, total: -30, paidRec: -10, balance: -20 });
  });

  test('a DN row: its Amount is its debit, nothing else changes', () => {
    const dn = row(usdInv, 'USD');
    expect(withCnSign(dn)).toEqual({ ...dn, amount: 100 });
  });

  test('the shown Paid/Rcvd and Balance add up to the net Total line', () => {
    const rows = [row(usdInv, 'USD'), row(usdBill, 'USD')];
    const [plain] = agentBalancingTotals(rows, 'USD');
    // 60 owed to us, 20 we owe: 40 - the totals are from the figures as they are.
    expect(plain).toMatchObject({ balance: 40, credit: 30, debit: 100 });
    const shown = rows.map((r) => withCnSign(r));
    expect(shown.reduce((t, r) => t + r.balance, 0)).toBe(plain.balance);
    expect(shown.reduce((t, r) => t + r.paidRec, 0)).toBe(plain.paidRec);
    // The merged Amount column adds up to DN less CN.
    expect(shown.reduce((t, r) => t + r.amount, 0)).toBe(70);
  });
});
