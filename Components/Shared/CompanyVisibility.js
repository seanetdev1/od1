import React, { useEffect, useState } from 'react';
import { Select, Tooltip } from 'antd';
import axiosClient from 'apis/axiosClient';
import { allCompanies } from 'functions/companyBranding';

/**
 * "Visible in: [companies]" for one master record - an account, party,
 * charge, charge group, commodity or vessel.
 *
 * Shown only where Seanet keeps that table per company (Config > Per-company
 * data); renders nothing otherwise, and nothing for a record not saved yet -
 * a new record starts out as the company it is created in, and can be shared
 * from here once it exists. Empty = every company. Saves on change: it is its
 * own setting, not part of the record's form.
 *
 * @param table     'coa' | 'parties' | 'charges' | 'chargeGroups' | 'commodity' | 'vessels'
 * @param recordId  the saved record's id
 */
let separationCache = null;
const loadSeparation = () => {
  separationCache = separationCache || axiosClient.get('/settings/companySeparation')
    .then(({ data }) => data.result || {})
    .catch(() => { separationCache = null; return {}; });
  return separationCache;
};

const CompanyVisibility = ({ table, recordId, style }) => {
  const companies = allCompanies();   // the companies this user works in
  const [on, setOn] = useState(false);
  const [value, setValue] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    loadSeparation().then((sep) => { if (alive) setOn(Boolean(sep[table])); });
    return () => { alive = false; };
  }, [table]);

  useEffect(() => {
    if (!on || !recordId) return;
    axiosClient.get('/companies/visibility', { params: { table, recordId } })
      .then(({ data }) => setValue((data.result || []).map(String)))
      .catch(() => {});
  }, [on, table, recordId]);

  if (!on || !recordId) return null;

  const change = async (next) => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/companies/visibility', { table, recordId, companyIds: next });
      setValue((data.result || []).map(String));
    } catch (_) {
      // axiosClient has said why (403 / 5xx); keep what the server has.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={style}>
      <Tooltip title='Which companies see this record in their lists. None picked = every company.'>
        <span style={{ fontSize: 12 }}>Visible in</span>
      </Tooltip>
      <Select mode='multiple' allowClear size='small' style={{ width: '100%' }} placeholder='Every company'
        value={value} onChange={change} loading={saving}
        options={companies.map((c) => ({ value: String(c.id), label: c.title }))} />
    </div>
  );
};

export default CompanyVisibility;
