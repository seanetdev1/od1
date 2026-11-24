import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  value: '',
  companies:[],
  // True when this user may work in only some companies (backend
  // Employee_Company): `companies` is then just those, and there is no
  // "All companies" anywhere.
  restricted: false,
}

export const companySlice = createSlice({
  name: 'company',
  initialState,
  reducers: {
    companySelect: (state, action) => {
      state.value = action.payload
    },
    addCompanies: (state, action) => {
      state.companies = action.payload
    },
    setCompaniesRestricted: (state, action) => {
      state.restricted = Boolean(action.payload)
    },
  },
})

export const { companySelect, addCompanies, setCompaniesRestricted } = companySlice.actions

export default companySlice.reducer