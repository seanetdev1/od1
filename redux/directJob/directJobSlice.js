import { createSlice } from '@reduxjs/toolkit';
import { Rate } from 'antd';
import moment from 'moment';

const initialState = {
    directJob_Id: '',
    directJob_EntryNumber: '',
    directJob_JobId:0,
    directJob_JobNumber:"",
    directJob_ExRate: 1,
    directJob_EntryDate: moment().toISOString(),
    directJob_FileNumber:"",
    directJob_TransMode:"Bank",
    // Expense, as the server's default is - see directJob_DefaultType.
    directJob_Type:"expense",
    directJob_SubType:"cheque",
    directJob_Account: undefined,
    directJob_Reference:"",
    directJob_ChequeNo:"",
    directJob_Operation:"logistics",
    directJob_ChequeDate: moment().toISOString(),
    directJob_PaidTo: undefined,
    directJob_JobType:"single",
    directJob_Currency:"PKR",
    directJob_DrawnAt: "",
    directJob_ClosingBalance: 0.0,
    directJob_Edit: false,
    directJob_VoucherId: '',
    directJob_VoucherNumber: '',
    directJob_SettlementAccounts: [],
    directJob_CAccounts: [],
    directJob_Charges: [],
    directJob_Jobs: [],
    directJob_Total: 0,
    directJob: [
      {
        id: 0,
        JobId: 0,
        JobNumber: '',
        Charge: '',
        FileNumber: '',
        Basis: '',
        Currency: '',
        RateGroup: 'None',
        SizeType: '',
        Quantity: 0.0,
        Rate: 0.0,
        Amount: 0.0,
        Discount: 0.0,
        NetAmount: 0.0,
        TaxApply: false,
        TaxShare: 0.0,
        TaxAmount: 0.0,
        VATCategory: '',
        NetIncTaxAmount: 0.0,
        ExRate: 1.0,
        LocalAmount: 0.0,
        Description: '',
      },
    ],
    directJob_CompanyId:1,
    directJob_TotalAmount: 0.0,
    directJob_TotalNetAmount: 0.0,
    directJob_TotalNetAmountIncTax: 0.0,
    directJob_TotalDiscount: 0.0,
    directJob_TotalTaxAmount: 0.0,
    directJob_TotalLocalAmount: 0.0,
    directJob_Remarks: '',
    // The entry's voucher's cost centre - read back for the print.
    directJob_CostCenter: '',
    // What a NEW entry starts as - Configuration > Direct Job. An install
    // setting, not part of the entry, so a reset keeps it. Expense until the
    // install says revenue (the user's call, 2026-10-20) - the server's
    // default too, so the form opens on it before the setting has arrived.
    directJob_DefaultType: 'expense',

}

export const directJobSlice = createSlice({
  name: 'records',
  initialState,
  reducers: {
    setDJField(state, action) {
        const { field, value } = action.payload;
        if (field in state) {
          state[field] = value;
        } else {
          console.warn(`DirectJob Field "${field}" does not exist in the state.`);
        }
      },
    updateDirectJobItem(state, action) {
      const { index, field, value } = action.payload;

      if (state.directJob[index]) {
        state.directJob[index][field] = value;
      } else {
        console.warn(`Index ${index} does not exist in directJob array.`);
      }
    },
    /* Clears the ENTRY, not the lookup lists.
     *
     * It used to return initialState outright, which also emptied the jobs,
     * charges and accounts the screen had just fetched - and the screen only
     * fetches them on mount or when the job search changes. Opening the screen
     * from the sidebar, or loading an existing entry, resets; so the job picker
     * came up empty, or showed a search's results for an instant and then lost
     * them. Those lists describe the install, not the entry, and survive. */
    resetDirectJob(state) {
      return {
        ...initialState,
        directJob_EntryDate: moment().toISOString(),
        directJob_ChequeDate: moment().toISOString(),
        directJob_SettlementAccounts: state.directJob_SettlementAccounts,
        directJob_CAccounts: state.directJob_CAccounts,
        directJob_Charges: state.directJob_Charges,
        directJob_Jobs: state.directJob_Jobs,
        directJob_Total: state.directJob_Total,
        directJob_DefaultType: state.directJob_DefaultType,
        directJob_Type: state.directJob_DefaultType,
      };
    },
    /* The configured default, once read from the server. Also applied to the
     * form when it is a new entry still showing the old default - the first
     * time the screen opens, the reset ran before the setting arrived. A type
     * somebody picked, or a saved entry's, is left alone. */
    setDefaultType(state, action) {
      const type = action.payload === 'revenue' ? 'revenue' : 'expense';
      if (type === state.directJob_DefaultType) return;
      if (!state.directJob_Id && state.directJob_Type === state.directJob_DefaultType) {
        state.directJob_Type = type;
      }
      state.directJob_DefaultType = type;
    },
  },
});

export const { setDJField, resetDirectJob, updateDirectJobItem, setDefaultType } = directJobSlice.actions;

export default directJobSlice.reducer;