import moment from 'moment';

/**
 * The ledger's rows - on screen, in print and in the Excel file.
 *
 * THE FIRST ROW IS THE OPENING BALANCE: everything posted before `from`,
 * worked out by LedgerReport. It replaces a row that was the account's OP
 * voucher whenever one was dated before `from` - its own amount shown as the
 * balance, so a 2024 opening voucher headed a ledger run for 2026 with a
 * balance that was neither the voucher's place in the ledger nor the opening
 * balance. That voucher is already IN the opening balance; an OP voucher
 * dated inside the period is an ordinary row, with its Debit or Credit.
 *
 * The opening row's figure is in the BALANCE column only (the user,
 * 2026-11-10). It is not a transaction - nothing was debited or credited on
 * `from` - so Debit and Credit stay empty, and their totals are the period's
 * own movement.
 */
export const OPENING_KEY = 'opening';

export const openingRow = (opening, from) => {
  const n = Number(opening) || 0;
  return {
    key: OPENING_KEY,
    voucher: '',
    // A plain date, read as local - a timestamp would be the previous day in UTC.
    date: from ? moment(from, 'DD-MM-YYYY').format('YYYY-MM-DD') : null,
    narration: 'Opening Balance',
    cheque: '',
    debit: null,
    credit: null,
    balance: n,
  };
};

export const ledgerDataSource = ({ ledger = [], opening = 0, from }) => [
  openingRow(opening, from),
  ...ledger.map((x, i) => ({
    key: `${x.voucherId}-${i}`,
    voucher: x.voucher,
    date: x.date,
    narration: x.narration,
    cheque: x.checkDets,
    debit: x.type === 'debit' ? x.amount : null,
    credit: x.type === 'credit' ? x.amount : null,
    balance: x.balance,
    voucherId: x.voucherId,
    voucherType: x.voucherType,
    vouchervType: x.vouchervType,
  })),
];

/**
 * The Debit and Credit columns added up - the period's movement. The opening
 * row has nothing in either column, so opening + debit - credit is the closing
 * balance. Added in cents, so a long ledger's total is right to the paisa.
 */
export const ledgerTotals = (dataSource = []) => {
  const cents = (v) => Math.round((Number(v) || 0) * 100);
  const sum = dataSource.reduce((t, row) => ({
    debit: t.debit + cents(row.debit),
    credit: t.credit + cents(row.credit),
  }), { debit: 0, credit: 0 });
  return { debit: sum.debit / 100, credit: sum.credit / 100 };
};

/** A balance as the figure and its side, for two columns. */
export const balanceSide = (v) => {
  const n = Number(v) || 0;
  return { amount: Math.abs(n), side: n >= 0 ? 'Dr' : 'Cr' };
};

export const SHEET_HEADER = ['#', 'Voucher #', 'Date', 'Particular', 'Cheque No | Date', 'Debit', 'Credit', 'Balance', 'Dr/Cr'];

/**
 * The table as the Excel sheet lays it out: figures as numbers, and the
 * balance's Dr/Cr in a column of its own instead of "1,234.00 Dr" as text -
 * which Excel could neither add up nor sort. The opening row is unnumbered.
 */
export const ledgerSheetRows = (dataSource) => {
  let n = 0;
  return dataSource.map((row) => {
    const { amount, side } = balanceSide(row.balance);
    const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
    return [
      row.key === OPENING_KEY ? '' : (n += 1),
      row.voucher || '',
      row.date ? moment(row.date).format('DD-MM-YYYY') : '',
      row.narration || '',
      row.cheque || '',
      num(row.debit),
      num(row.credit),
      amount,
      side,
    ];
  });
};
