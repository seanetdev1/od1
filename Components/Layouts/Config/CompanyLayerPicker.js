import React, { useEffect, useState } from 'react';
import { Select } from 'antd';
import axiosClient from 'apis/axiosClient';
import { allCompanies } from 'functions/companyBranding';
import { Hint } from './parts';

/**
 * "Mapping for: Every company | <a company>" on Config > Ledger Accounts and
 * Party Accounts.
 *
 * Where the chart of accounts is kept per company (Config > Per-company
 * data), each company can have its own mapping laid over the install's - its
 * accounts are not the other companies'. Elsewhere there is one mapping and
 * this shows nothing.
 */
export function useCompanyLayer() {
  return useState('');
}

export const CompanyLayerPicker = ({ value, onChange, hint }) => {
  // From the store directly (functions/companyBranding): the Config tabs
  // render outside a react-redux Provider in their tests.
  const companies = allCompanies();
  const [separated, setSeparated] = useState(false);

  useEffect(() => {
    axiosClient.get('/settings/companySeparation')
      .then(({ data }) => setSeparated(Boolean(data?.result?.coa)))
      .catch(() => {});
  }, []);

  if (!separated && !value) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <span style={{ fontSize: 13, marginRight: 8 }}>Mapping for</span>
      <Select size='small' style={{ minWidth: 260 }} value={value} onChange={onChange}
        options={[
          { value: '', label: 'Every company (the default)' },
          ...companies.map((c) => ({ value: String(c.id), label: c.title })),
        ]} />
      {value && hint && <Hint text={hint} />}
    </div>
  );
};

export default CompanyLayerPicker;
