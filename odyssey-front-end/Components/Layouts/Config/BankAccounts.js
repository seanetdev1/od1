import React, { useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { useDispatch } from 'react-redux';
import { addCompanies } from 'redux/company/companySlice';
import { Section, SubHead } from './parts';

// Admin: manage the bank accounts that appear on a company's invoices.
const EMPTY = { label: '', bankName: '', accountTitle: '', accountNo: '', iban: '', branch: '', swift: '' };

const BankAccounts = () => {
  const dispatch = useDispatch();
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  // The account the form is changing; null = the form adds a new one.
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    axiosClient.get('/companies/getAllCompanies')
      .then(({ data }) => {
        const list = Array.isArray(data?.result) ? data.result : [];
        setCompanies(list);
        if (list.length && companyId == null) setCompanyId(list[0].id);
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  const loadAccounts = (cid) => {
    if (cid == null) return;
    axiosClient.get(`/companies/bankAccount/byCompany/${cid}`)
      .then(({ data }) => setAccounts(Array.isArray(data?.result) ? data.result : []))
      .catch(() => {});
  };

  /**
   * Push the change into redux as well as this screen.
   *
   * Invoices, vouchers and BLs read bank details out of
   * state.company.companies via functions/companyBranding - not from this
   * component's list. MainLayout fills that store ONCE on mount, so without
   * this a newly added account did not appear on an invoice until the whole
   * page was reloaded, which looked like the account had not saved.
   */
  const refreshCompaniesInStore = () => {
    axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_COMPANIES)
      .then(({ data }) => {
        if (Array.isArray(data?.result)) dispatch(addCompanies(data.result));
      })
      .catch(() => {});
  };
  useEffect(() => { loadAccounts(companyId); }, [companyId]);
  // Another company's accounts: whatever was being changed is not on screen.
  useEffect(() => { setEditing(null); setForm(EMPTY); }, [companyId]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // An account's details into the form below, to change in place - its id,
  // and so its default, stay (the user, 2026-11-02).
  const startEdit = (a) => {
    setEditing(a);
    setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, a[k] || ''])));
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  };
  const cancelEdit = () => { setEditing(null); setForm(EMPTY); };

  const save = async () => {
    if (companyId == null) { openNotification('Error', 'Pick a company first.', 'red'); return; }
    if (!form.bankName.trim() && !form.iban.trim()) {
      openNotification('Error', 'Enter at least a bank name or IBAN.', 'red'); return;
    }
    const failed = editing ? 'Could not save the changes.' : 'Could not add.';
    setSaving(true);
    try {
      const { data } = editing
        ? await axiosClient.post('/companies/bankAccount/edit', { ...form, id: editing.id })
        : await axiosClient.post('/companies/bankAccount/create', { ...form, CompanyId: companyId });
      if (data.status === 'success') {
        openNotification('Success', editing ? 'Bank account saved.' : 'Bank account added.', 'green');
        setEditing(null);
        setForm(EMPTY);
        loadAccounts(companyId);
        refreshCompaniesInStore();
      } else openNotification('Error', data.result || failed, 'red');
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || failed, 'red');
    } finally { setSaving(false); }
  };

  /* Which account a client's invoice (JI / JB) or an agent's (AI / AB) prints
   * until someone picks another on the invoice. One of each per company; the
   * server moves it off whichever account had it. */
  const makeDefault = async (id, kind) => {
    try {
      const { data } = await axiosClient.post('/companies/bankAccount/setDefault', { id, kind });
      if (data.status === 'success') {
        loadAccounts(companyId);
        refreshCompaniesInStore();
      } else openNotification('Error', data.result || 'Could not set the default.', 'red');
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not set the default.', 'red');
    }
  };

  const del = async (id) => {
    if (!window.confirm('Delete this bank account?')) return;
    try {
      await axiosClient.post('/companies/bankAccount/delete', { id });
      if (editing?.id === id) cancelEdit();
      loadAccounts(companyId);
      refreshCompaniesInStore();
    } catch (err) {
      openNotification('Error', 'Could not delete.', 'red');
    }
  };

  return (
    <Section title='Bank Accounts' hint='The bank accounts printed on a company’s invoices.'>
      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Company</label>
        <Select
          style={{ width: 280 }}
          value={companyId}
          onChange={setCompanyId}
          options={companies.map(c => ({ value: c.id, label: c.title }))}
          placeholder="Select a company"
        />
      </div>

      {/* Existing accounts */}
      <SubHead hint={'A client’s invoice or bill (JI / JB) prints the client default, an agent’s (AI / AB) the '
        + 'agent default, until someone picks another account on the invoice. One of each per company.'}>
        Accounts ({accounts.length})
      </SubHead>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        {accounts.length === 0 && <span style={{ color: '#999', fontSize: 13 }}>No bank accounts yet for this company.</span>}
        {accounts.map(a => (
          <div key={a.id} style={editing?.id === a.id ? { ...acctCard, border: '1px solid #1d6b3a' } : acctCard}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{a.label || a.bankName || 'Account'}</div>
            {(a.clientDefault || a.agentDefault) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>
                {a.clientDefault && <span style={defaultTag}>Client default (JI/JB)</span>}
                {a.agentDefault && <span style={defaultTag}>Agent default (AI/AB)</span>}
              </div>
            )}
            <div style={acctLine}>{a.bankName}{a.branch ? ` — ${a.branch}` : ''}</div>
            {a.accountTitle && <div style={acctLine}>Title: {a.accountTitle}</div>}
            {a.accountNo && <div style={acctLine}>A/C #: {a.accountNo}</div>}
            {a.iban && <div style={acctLine}>IBAN: {a.iban}</div>}
            {a.swift && <div style={acctLine}>SWIFT: {a.swift}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn-custom" onClick={() => startEdit(a)}>Edit</button>
              {!a.clientDefault && (
                <button className="btn-custom" onClick={() => makeDefault(a.id, 'client')}>Make client default</button>
              )}
              {!a.agentDefault && (
                <button className="btn-custom" onClick={() => makeDefault(a.id, 'agent')}>Make agent default</button>
              )}
              <button className="btn-custom" onClick={() => del(a.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {/* Add form - or, with Edit pressed, the account being changed */}
      <SubHead hint={editing ? 'Saved in place: its defaults stay, and every invoice printed from now on - an old one reprinted too - shows the new details.' : undefined}>
        {editing ? `Edit account - ${editing.label || editing.bankName || 'Account'}` : 'Add account'}
      </SubHead>
      <div ref={formRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <F label="Label (e.g. Soneri - Main)" v={form.label} on={v => set('label', v)} w={220} />
        <F label="Bank name" v={form.bankName} on={v => set('bankName', v)} />
        <F label="Account title" v={form.accountTitle} on={v => set('accountTitle', v)} />
        <F label="Account no." v={form.accountNo} on={v => set('accountNo', v)} />
        <F label="IBAN" v={form.iban} on={v => set('iban', v)} w={260} />
        <F label="Branch" v={form.branch} on={v => set('branch', v)} />
        <F label="SWIFT" v={form.swift} on={v => set('swift', v)} w={140} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={save} disabled={saving} className="btn-custom">
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add bank account'}
        </button>
        {editing && <button onClick={cancelEdit} disabled={saving} className="btn-custom">Cancel</button>}
      </div>
    </Section>
  );
};

const F = ({ label, v, on, w = 180 }) => (
  <div style={{ flex: `0 0 ${w}px` }}>
    <label style={lbl}>{label}</label>
    <input style={{ width: '100%', padding: '7px 10px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14 }}
      value={v} onChange={e => on(e.target.value)} />
  </div>
);

const lbl = { display: 'block', fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 600 };
const acctCard = { border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, minWidth: 220, flex: '0 1 240px' };
const acctLine = { fontSize: 12, color: '#666', marginTop: 2, wordBreak: 'break-all' };
const defaultTag = {
  fontSize: 11, fontWeight: 600, color: '#1d6b3a', background: '#e8f5ec',
  border: '1px solid #b7dfc4', borderRadius: 4, padding: '1px 6px',
};

export default BankAccounts;
