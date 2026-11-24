import moment from 'moment';
import { LOCAL_CURRENCY } from './invoiceRate';

/**
 * How old an invoice is, and in what order the accounts are listed - the
 * ageing report's Summary and Weekly alike.
 *
 * BY THE INVOICE'S DATE, as on TODAY. It was the invoice's updatedAt - which
 * moves whenever anything touches the invoice: a part payment yesterday made a
 * year-old invoice "1-30 days", and every invoice migrated from Climax read as
 * dated the day of the migration. The server picks the invoices by the same
 * date (/invoice/ageingSummary): From is the cut-off, To the last date taken
 * in - the user's request, 2026-10-09.
 *
 * Aged as on today, not the To date (the user, 2026-11-02): To only picks
 * the invoices. Some are dated forward, and a To date far enough out to take
 * them in aged every invoice as on that date - all of them "over 120". A
 * forward-dated invoice is current until its date comes.
 *
 * No React - unit tested.
 */

/** Whole days from the invoice's date to today; 0 = dated today or later. */
export function ageingDays(invoice, today = moment()) {
  const on = moment(invoice?.createdAt);
  if (!on.isValid()) return 0;
  return Math.max(0, moment(today).startOf('day').diff(on.startOf('day'), 'days'));
}

/**
 * Largest first - the user's request, 2026-10-09: by the size of what is
 * owed, receivable or payable (a payable is negative). Within each currency,
 * local first, as the currency totals are: 1,000 USD and 50,000 PKR are not
 * one list. Ties by account name.
 */
export function sortAgeingRows(rows) {
  const size = (r) => Math.abs(Number(r?.total) || 0);
  const local = (r) => ((r?.Currency || LOCAL_CURRENCY) === LOCAL_CURRENCY ? 0 : 1);
  return [...(rows || [])].sort((a, b) =>
    local(a) - local(b)
    || String(a?.Currency || '').localeCompare(String(b?.Currency || ''))
    || size(b) - size(a)
    || String(a?.AccountTitle || '').localeCompare(String(b?.AccountTitle || '')));
}
