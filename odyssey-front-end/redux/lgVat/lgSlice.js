import { createSlice } from '@reduxjs/toolkit';
import moment from 'moment';
import { reportFrom, reportTo } from 'functions/reportDates';

const initialState = {
  lg_reportType: 'LG VAT',
  lg_sdate: reportFrom(),
  lg_edate: reportTo(),
  lg_type: ['Recievable', 'Payble'],
  lg_customer: undefined,
  lg_shipper: undefined,
  lg_tax: "None",
  lg_hsCode: undefined,
  lg_report: 1,
  lg_opType: [],
  lg_taxes: [],
  lg_clients: [],
  lg_shippers: [],
};


export const lgSlice = createSlice({
  name: 'records',
  initialState,
  reducers: {
    setLgField(state, action) {
        const { field, value } = action.payload;
        if (field in state) {
            state[field] = value;
        } else {
            console.warn(`P/R Field "${field}" does not exist in the state.`);
        }
    },
    lgResetState(state, action) {
      console.log("reset")
      return initialState;
      // state = initialState
    },
  },
  
  
});


export const { setLgField, lgResetState } = lgSlice.actions;

export default lgSlice.reducer;