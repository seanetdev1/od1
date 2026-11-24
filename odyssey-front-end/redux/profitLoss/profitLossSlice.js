import { createSlice } from '@reduxjs/toolkit'
import moment from 'moment';
import { reportFrom, reportTo } from 'functions/reportDates';

  const initialState = {
    from: reportFrom(),
    to: moment(reportTo()).format("YYYY-MM-DD"),
    company: 'all',
    jobType: ['SE','SI','AE','AI'],
    subType: ["FCL","LCL","AIR"],
    reportType: "viewer",
    salesRepresentative:"",
    overSeasagent: "",
    client:"",
    metrics: 'vol,weight,shpVol,teu'
  };

  export const profitLossSlice = createSlice({
  name: 'profitloss',
  initialState,
  reducers: {
    setFrom(state, action) {
      state.from = action.payload;
    },
    setTo(state, action) {
      state.to = action.payload;
    },
    setFrom2(state, action) {
      state.from2 = action.payload;
    },
    setTo2(state, action) {
      state.to2 = action.payload;
    },
    setCompany(state, action) {
      state.company = action.payload;
    },
    setJobType(state, action) {
      state.jobType = action.payload;
    },
    setSubType(state, action) {
      state.subType = action.payload;
    },
    setReportType(state, action) {
      state.reportType = action.payload;
    },
    setSalesRepresentative(state, action) {
      state.salesRepresentative = action.payload;
    },
    setOverSeasagent(state, action) {
      state.overSeasagent = action.payload;
    },
    setClient(state, action) {
      state.client = action.payload;
    },
    setMetrics(state, action) {
      state.metrics = action.payload;
    }
  },
})

export const { setFrom, setTo, setFrom2, setTo2, setCompany,setClient,setJobType,setOverSeasagent,setReportType,setSalesRepresentative,setSubType, setMetrics } = profitLossSlice.actions

export default profitLossSlice.reducer