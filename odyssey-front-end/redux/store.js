import { configureStore } from '@reduxjs/toolkit';
import counterReducer from './counter/counterSlice';
import tabsReducer from './tabs/tabSlice';
import companyReducer from './company/companySlice';
import fiscalYearReducer from './fiscalYear/fiscalYearSlice';
import blCreationReducer from './BlCreation/blCreationSlice';
import persistValuesReducer from './persistValues/persistValuesSlice';
import { seJobValues } from './apis/seJobValues';
import filterValuesReducer from './filters/filterSlice';
import ledgerReducer from './ledger/ledgerSlice';
import invoiceReducer from './invoice/invoiceSlice';
import profitLossReducer from './profitLoss/profitLossSlice'
import openingInvoiceSlice from './openingInvoices/openingInvoicesSlice';
import paymentRecieptSlice from './paymentReciept/paymentRecieptSlice';
import voucherSlice from './vouchers/voucherSlice';
import directJobReducer from './directJob/directJobSlice';
import directJobSlice from './directJob/directJobSlice';
import ageingSlice from './ageing/ageingSlice';
import auditSlice from './audit/auditSlice';
import lgSlice from './lgVat/lgSlice';
import notificationsReducer from './notifications/notificationSlice';
import partyDraftReducer from './partyDraft/partyDraftSlice';
import customsJobDraftReducer from './customsJobDraft/customsJobDraftSlice';

export const store = configureStore({
  reducer: {
    [seJobValues.reducerPath]: seJobValues.reducer,
    counter: counterReducer,
    filterValues:filterValuesReducer,
    company: companyReducer,
    fiscalYear: fiscalYearReducer,
    ledger: ledgerReducer,
    invoice: invoiceReducer,
    profitloss:profitLossReducer,
    tabs: tabsReducer,
    blCreationValues: blCreationReducer,
    persistValues: persistValuesReducer,
    openingInvoice:openingInvoiceSlice,
    paymentReciept:paymentRecieptSlice,
    vouchers:voucherSlice,
    directJob: directJobSlice,
    ageing: ageingSlice,
    audit: auditSlice,
    lgVat: lgSlice,
    notifications: notificationsReducer,
    // Half-filled party forms, so a tab switch does not discard them.
    partyDrafts: partyDraftReducer,
    // The same, for half-filled customs jobs.
    customsJobDrafts: customsJobDraftReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(seJobValues.middleware),
})