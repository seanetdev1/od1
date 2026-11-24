import { createSlice } from '@reduxjs/toolkit';
import moment from 'moment';
import { reportFrom, reportTo } from 'functions/reportDates';

const initialState = {
  ageing_reportType: 'Ageing Summary',
  ageing_sdate: reportFrom(),
  ageing_edate: reportTo(),
  ageing_accounts: [],
  ageing_account: undefined,
  ageing_company: [1, 3],
  // All currencies, one of them, or All in PKR - see functions/ageingCurrency.
  ageing_currency: 'All',
  // One sales rep's parties, or All - the rep set on the party.
  ageing_salesRep: 'All',
  ageing_salesReps: [],
  ageing_RP: ["Recievable", "Payble"],
  ageing_partyType: "Local",
  ageing_reportData: [],
};



export const ageingSlice = createSlice({
  name: 'records',
  initialState,
  reducers: {
    setAgeingField(state, action) {
        const { field, value } = action.payload;
        if (field in state) {
            state[field] = value;
        } else {
            console.warn(`P/R Field "${field}" does not exist in the state.`);
        }
    },
    ageingResetState(state, action) {
      console.log("reset")
      return initialState;
      // state = initialState
    },
  },
  
  
});


export const { setAgeingField, ageingResetState } = ageingSlice.actions;

export default ageingSlice.reducer;
