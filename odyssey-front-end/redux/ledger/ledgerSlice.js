import { createSlice } from '@reduxjs/toolkit'
import moment from 'moment';
import { reportFrom, reportTo } from 'functions/reportDates';
import Cookies from 'js-cookie';

  const initialState = {
    from: reportFrom(),
    to: reportTo(),
    company: 1,
    currency: "PKR",
    records: [],
    account:null,
    name: "",
    first: true
  };

  export const ledgerSlice = createSlice({
  name: 'ledger',
  initialState,
  reducers: {
    setFrom(state, action) {
      state.from = action.payload;
    },
    setTo(state, action) {
      state.to = action.payload;
    },
    setCompany(state, action) {
      state.company = action.payload;
    },
    setCurrency(state, action) {
      state.currency = action.payload;
    },
    setRecords(state, action) {
      state.records = action.payload;
    },
    setAccount(state, action) {
      state.account = action.payload;
    },
    setName(state, action) {
      state.name = action.payload;
    },
    setFirst(state, action) {
      state.first = action.payload;
    },
    ledgerReset(state, action) {
      return initialState;
      // state = initialState
    },
  },
})

export const { setFrom, setTo, setCompany, setCurrency, setRecords, setAccount, setName, setFirst, ledgerReset } = ledgerSlice.actions

export default ledgerSlice.reducer