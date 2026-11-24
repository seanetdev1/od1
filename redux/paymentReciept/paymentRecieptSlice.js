import { createSlice } from '@reduxjs/toolkit';
import moment from 'moment';

const initialState = {
  // Which parties the picker asks for. 'all' now that the Client/Vendor/Agent
  // selector is gone - see the `all` branch in routes/misc/parties. What a
  // party IS is derived per party into `partytype`, not chosen up front.
  type: 'all',
  payType: 'Recievable',
  currency: 'PKR',
  search: '',
  searchAccount: '',
  PRaccounts: [],
  oldVouchers: [],
  oldVouchersList: [],
  selectedAccount: undefined,
  voucherNarration: "",
  edit: false,
  // Refresh pressed on an open voucher: SETTLING it - the ticks are knocked
  // off against it and nothing else changes (functions/advanceSettlement).
  editing: false,
  voucherId: undefined,
  // The open voucher as the server sent it - its number, who made and last
  // changed it, a cheque return. Held here, not looked up in the list's
  // loaded page: a voucher opened from the Ledger is usually not on it.
  openedVoucher: null,
  // The open voucher's money on the party, as posted - what settling it can
  // knock off at most. totalReceivable follows the ticks; this does not.
  voucherAmount: 0,
  invoices: [],
  PRload: false,
  // The INVOICE list's own loading flag. PRload is shared by the receiving and
  // adjust account fetches, and the invoice fetch only ever cleared it - so
  // "still loading" and "nothing to show" looked identical on the one list
  // where the difference matters.
  invoicesLoading: false,
  /* HOW FAR BACK THE INVOICE LIST LOOKS, and where in it we are.
   *
   * Some parties carry thousands of open invoices; fetching all of them was
   * slow and then left enough rows on screen that scrolling and typing lagged.
   * The fortnight was the default for that reason.
   *
   * ALL is the default now. What the fortnight was protecting against was the
   * number of ROWS, and the list is paged (invoicePageSize) - so opening on
   * everything outstanding still puts one page on screen. Opening on a
   * fortnight meant the list usually opened EMPTY: the invoices were there,
   * just older than two weeks.
   *
   * The other periods are CALENDAR periods, the same half-month the books
   * reconcile in (see functions/reportPeriods on the server). Early in a
   * period they are short, which is why `invoicePeriodRange` is kept and
   * shown: an empty list should be able to say what window it looked in. */
  invoicePeriod: 'all',
  invoiceFrom: null,
  invoiceTo: null,
  invoicePage: 1,
  invoicePageSize: 50,
  invoiceCount: 0,
  invoicePeriodRange: null,
  /* The search the invoice list was last fetched WITH - not the text in the
   * box while someone is still typing. Non-empty means the list is a search
   * result across every period rather than a browse of one. */
  invoiceSearch: '',
  /* When that search found nothing: the invoices its number names that the
   * list left off, each with why - paid, another currency, another party...
   * From the server (functions/invoiceNotListed there). */
  invoiceNotListed: [],
  /* WHAT THE RECEIPT PAYS: { [invoiceId]: invoice + receiving }, kept apart
   * from `invoices`, which is only the page of the list on screen. See
   * functions/paymentReceiptSelection. */
  selectedInvoices: {},
  transactionMode: 'Cash',
  receivingAccounts: [],
  receivingAccount: undefined,
  adjustAccounts: [],
  bankChargesAccount: undefined,
  bankChargesAmount: 0.0,
  taxAccount: undefined,
  taxAmount: 0.0,
  taxPercent: 0.0,
  // Who pays each: 'us' (as it always posted) or 'party'. See
  // functions/paymentReceiptCosts.
  taxBy: 'us',
  bankChargesBy: 'us',
  gainLossAccount: undefined,
  gainLossAmount: 0.0,
  subType: 'Cash',
  autoKnockOff: false,
  percent: false,
  checkNo: "",
  checkDate: moment().toISOString(),
  date: moment().toISOString(),
  totalReceivable: 0.0,
  exRate: 1.0,
  modal: false,
  transactions: [],
  onAccount: 'client',
  delete: false,
  advance: false,
  knockOffAmount: 0.0
};

/* KEPT WHEN A SAVED VOUCHER IS OPENED - what the screen has fetched and how the
 * user has it set up. Everything else is the voucher's own, and is cleared
 * before the next one is applied: opening a receipt with no invoices (an
 * advance), or no bank charges, used to leave the PREVIOUS receipt's in place,
 * so a second party's receipt showed the first party's transaction. */
const KEPT_ON_OPEN = [
  'type', 'search', 'searchAccount', 'PRaccounts', 'oldVouchers', 'oldVouchersList',
  'receivingAccounts', 'adjustAccounts', 'invoicePeriod', 'invoicePageSize',
];

export const paymentRecieptSlice = createSlice({
  name: 'records',
  initialState,
  reducers: {
    setPRField(state, action) {
        const { field, value } = action.payload;
        if (field in state) {
          state[field] = value;
        } else {
          console.warn(`P/R Field "${field}" does not exist in the state.`);
        }
      },
    setType(state, action) {
      state.type = action.payload;
    },
    setPayType(state, action) {
      state.payType = action.payload;
    },
    // Before a saved voucher is applied - see KEPT_ON_OPEN.
    clearVoucher(state) {
      const kept = Object.fromEntries(KEPT_ON_OPEN.map((k) => [k, state[k]]));
      return { ...initialState, ...kept };
    },
    resetState(state, action) {
      console.log("reset")
      return initialState;
      // state = initialState
    },
  },
});

export const { setPRField, resetState, clearVoucher } = paymentRecieptSlice.actions;

export default paymentRecieptSlice.reducer;
