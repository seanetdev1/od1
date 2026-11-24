/**
 * The ledger's rows - functions/ledgerRows.
 *
 * The opening balance is the table's first row; an OP voucher dated before
 * the period is no longer shown as a row of its own (a 2024 OP voucher headed
 * every 2026 ledger); and the Excel sheet carries figures as numbers with the
 * balance's Dr/Cr in its own column.
 */
import { ledgerDataSource, ledgerSheetRows, ledgerTotals, openingRow, balanceSide, OPENING_KEY, SHEET_HEADER } from '../functions/ledgerRows';

const ledger = [
  { voucherId: 1, voucher: 'SNS-BRV-12/27', date: '2026-07-05T00:00:00.000Z', narration: 'Received', type: 'credit', amount: 400, balance: 600 },
  { voucherId: 2, voucher: 'SNS-JI-40/27', date: '2026-07-09T00:00:00.000Z', narration: 'Invoice', type: 'debit', amount: 150, balance: 750 },
];

describe('the opening balance row', () => {
  test('is the first row, dated the start of the period, its figure in Balance only', () => {
    const rows = ledgerDataSource({ ledger, opening: 1000, from: '01-07-2026' });
    expect(rows[0]).toMatchObject({ key: OPENING_KEY, narration: 'Opening Balance', debit: null, credit: null, balance: 1000 });
    expect(rows[0].date).toBe('2026-07-01');
    expect(rows.slice(1).map((r) => r.voucher)).toEqual(['SNS-BRV-12/27', 'SNS-JI-40/27']);
  });

  test('a credit opening is a credit balance, with nothing in Debit or Credit', () => {
    expect(openingRow(-250, '01-07-2026')).toMatchObject({ debit: null, credit: null, balance: -250 });
  });

  test('an OP voucher inside the period keeps its Debit / Credit, like any entry', () => {
    const op = { voucherId: 9, voucher: 'SNS-OP-1/27', date: '2026-07-01T07:00:00.000Z', narration: 'Opening', type: 'debit', amount: 500, balance: 500 };
    const rows = ledgerDataSource({ ledger: [op], opening: 0, from: '01-07-2026' });
    expect(rows[1]).toMatchObject({ voucher: 'SNS-OP-1/27', debit: 500, credit: null, balance: 500 });
  });

  test('is there even when the period has no entries', () => {
    expect(ledgerDataSource({ ledger: [], opening: 1000, from: '01-07-2026' })).toHaveLength(1);
  });

  test('is the only thing an old OP voucher contributes - no row of its own', () => {
    const rows = ledgerDataSource({ ledger, opening: 1000, from: '01-07-2026' });
    expect(rows.filter((r) => /OP/.test(r.voucher || ''))).toHaveLength(0);
  });
});

describe('the Excel sheet', () => {
  const sheet = ledgerSheetRows(ledgerDataSource({ ledger, opening: 1000, from: '01-07-2026' }));

  test('has the balance and its Dr/Cr in separate columns', () => {
    expect(SHEET_HEADER.slice(-2)).toEqual(['Balance', 'Dr/Cr']);
    expect(sheet[1].slice(-2)).toEqual([600, 'Dr']);
    expect(ledgerSheetRows([{ key: 'x', balance: -40 }])[0].slice(-2)).toEqual([40, 'Cr']);
  });

  test('carries debit and credit as numbers, and does not number the opening row', () => {
    expect(sheet[0]).toEqual(['', '', '01-07-2026', 'Opening Balance', '', null, null, 1000, 'Dr']);
    expect(sheet[1]).toEqual([1, 'SNS-BRV-12/27', '05-07-2026', 'Received', '', null, 400, 600, 'Dr']);
    expect(sheet[2][0]).toBe(2);
  });

  test('balanceSide reads zero as Dr', () => {
    expect(balanceSide(0)).toEqual({ amount: 0, side: 'Dr' });
  });
});

describe('the grand total', () => {
  test('adds up the period\'s Debit and Credit - the opening is not in them', () => {
    // Opening 1,000 Dr; 400 received; 150 invoiced.
    const rows = ledgerDataSource({ ledger, opening: 1000, from: '01-07-2026' });
    expect(ledgerTotals(rows)).toEqual({ debit: 150, credit: 400 });
  });

  test('opening plus debit less credit is the closing balance', () => {
    const rows = ledgerDataSource({ ledger, opening: 1000, from: '01-07-2026' });
    const { debit, credit } = ledgerTotals(rows);
    expect(1000 + debit - credit).toBe(rows[rows.length - 1].balance);
  });

  test('an opening-only ledger totals nothing on either side', () => {
    expect(ledgerTotals(ledgerDataSource({ ledger: [], opening: -250, from: '01-07-2026' }))).toEqual({ debit: 0, credit: 0 });
  });

  test('added in cents', () => {
    expect(ledgerTotals([{ debit: 0.1 }, { debit: 0.2 }, { credit: '0.30' }])).toEqual({ debit: 0.3, credit: 0.3 });
  });
});
