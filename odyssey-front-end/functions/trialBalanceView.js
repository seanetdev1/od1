// The trial balance's columns, as the screen and its Excel export head them.
//
// The report arrives built (routes/misc/trialBalance on the server): its
// `columns` are the figures the chosen report type shows, in order - all six
// for the 6-column view, the Closing pair for the 2-column one, one for a
// Debitors or Creditors list. This turns them into the two header rows.

export const COLUMN_LABELS = {
  opDebit: { group: 'Opening', side: 'Debit' },
  opCredit: { group: 'Opening', side: 'Credit' },
  trDebit: { group: 'Transactions', side: 'Debit' },
  trCredit: { group: 'Transactions', side: 'Credit' },
  clDebit: { group: 'Closing', side: 'Debit' },
  clCredit: { group: 'Closing', side: 'Credit' },
};

/** [{ label: 'Opening', keys: ['opDebit', 'opCredit'] }, ...] - neighbours of one group together. */
export function columnGroups(columns = []) {
  const groups = [];
  columns.forEach((k) => {
    const label = COLUMN_LABELS[k]?.group;
    if (!label) return;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.keys.push(k);
    else groups.push({ label, keys: [k] });
  });
  return groups;
}

/** 1234567.5 -> "1, 234, 567.50", as the report has always printed money. */
export const commas = (a) => {
  const n = parseFloat(a);
  return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ', ');
};

/** The query string the report page is opened with - dates as the days picked. */
export function trialBalanceQuery({ from, to, company, reportType, currency, accountid, options }, moment) {
  return {
    from: moment(from).format('YYYY-MM-DD'),
    to: moment(to).format('YYYY-MM-DD'),
    // The days are the reader's; the server needs the zone to know when each
    // begins.
    utcoffset: moment(from).utcOffset(),
    company,
    reportType,
    currency,
    accountid: accountid ?? null,
    options,
  };
}
