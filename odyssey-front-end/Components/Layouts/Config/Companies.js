import React, { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SubHead } from './parts';

// Admin: create/edit companies with everything the prints & reports need
// (name, short, address, contact, tax numbers, and two logos: screen + print).
const MAX_LOGO_BYTES = 1024 * 1024; // 1 MB

const EMPTY = {
  id: null, title: '', short: '', address: '', phone: '', email: '', web: '',
  ntn: '', strn: '', logo: null, printLogo: null,
};

const Companies = () => {
  const [form, setForm] = useState(EMPTY);
  const [companies, setCompanies] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = () => {
    axiosClient.get('/companies/getAllCompanies')
      .then(({ data }) => setCompanies(Array.isArray(data?.result) ? data.result : []))
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const onLogo = (field) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { openNotification('Error', 'Please choose an image file.', 'red'); return; }
    if (file.size > MAX_LOGO_BYTES) { openNotification('Error', 'Logo must be under 1 MB.', 'red'); return; }
    const reader = new FileReader();
    reader.onload = () => set(field, reader.result);
    reader.readAsDataURL(file);
  };

  const remove = async (c) => {
    const password = window.prompt(`Delete "${c.title}"? This also deletes its bank accounts.\n\nEnter the delete password to confirm:`);
    if (password == null) return; // cancelled
    try {
      const { data } = await axiosClient.post('/companies/deleteCompany', { id: c.id, password });
      if (data.status === 'success') {
        openNotification('Success', `Company "${c.title}" deleted.`, 'green');
        if (form.id === c.id) setForm(EMPTY);
        load();
      } else {
        openNotification('Error', data.result || 'Could not delete company.', 'red');
      }
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not delete company.', 'red');
    }
  };

  const startNew = () => setForm(EMPTY);
  const startEdit = (c) => setForm({
    id: c.id, title: c.title || '', short: c.short || '', address: c.address || '',
    phone: c.phone || '', email: c.email || '', web: c.web || '', ntn: c.ntn || '',
    strn: c.strn || '', logo: c.logo || null, printLogo: c.printLogo || null,
  });

  const save = async () => {
    if (!form.title.trim() || !form.short.trim()) {
      openNotification('Error', 'Company name and short name are required.', 'red');
      return;
    }
    setSaving(true);
    const url = form.id ? '/companies/editCompany' : '/companies/createCompany';
    try {
      const { data } = await axiosClient.post(url, form);
      if (data.status === 'success') {
        openNotification('Success', `Company "${data.result.title}" saved.`, 'green');
        startNew();
        load();
      } else if (data.status === 'exists') {
        openNotification('Error', data.result, 'orange');
      } else {
        openNotification('Error', data.result || 'Could not save company.', 'red');
      }
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not save company.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={form.id ? 'Edit company' : 'New company'}
      hint='Name, address, contact and tax numbers as the prints and reports show them, and two logos: one for the screen and one for print.'
      extra={form.id && <button className="btn-custom" onClick={startNew}>+ New company</button>}
    >

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <Field label="Company Name *"><input style={inp} value={form.title} onChange={e => set('title', e.target.value)} /></Field>
          <Field label="Short Name *"><input style={inp} maxLength={20} value={form.short} onChange={e => set('short', e.target.value)} /></Field>
          <Field label="Address"><textarea style={{ ...inp, height: 60 }} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
          <Field label="Phone"><input style={inp} value={form.phone} onChange={e => set('phone', e.target.value)} /></Field>
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          <Field label="Email"><input style={inp} value={form.email} onChange={e => set('email', e.target.value)} /></Field>
          <Field label="Website"><input style={inp} value={form.web} onChange={e => set('web', e.target.value)} /></Field>
          <Field label="NTN"><input style={inp} value={form.ntn} onChange={e => set('ntn', e.target.value)} /></Field>
          <Field label="STRN"><input style={inp} value={form.strn} onChange={e => set('strn', e.target.value)} /></Field>
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', gap: 16 }}>
          <LogoPicker label="Screen logo" value={form.logo} onChange={onLogo('logo')} />
          <LogoPicker label="Print logo" value={form.printLogo} onChange={onLogo('printLogo')} />
        </div>
      </div>

      <button onClick={save} disabled={saving} className="btn-custom" style={{ marginTop: 16 }}>
        {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create company'}
      </button>

      <SubHead style={{ marginTop: 24 }}>Companies ({companies.length})</SubHead>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {companies.length === 0 && <span style={{ color: '#999', fontSize: 13 }}>None yet.</span>}
        {companies.map((c) => (
          <div key={c.id} style={rowStyle}>
            <div style={{ ...logoBox, width: 44, height: 44, marginBottom: 0 }}>
              {c.logo ? <img src={c.logo} alt="" style={imgFit} /> : <span style={{ color: '#ccc', fontSize: 10 }}>{c.short}</span>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{c.short}{c.address ? ` · ${c.address.split('\n')[0]}` : ''}</div>
            </div>
            <button className="btn-custom" onClick={() => startEdit(c)}>Edit</button>
            <button
              onClick={() => remove(c)}
              style={{ border: '1px solid #ffa39e', background: '#fff1f0', color: '#cf1322', borderRadius: 6, padding: '4px 10px', fontSize: 13, cursor: 'pointer' }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
};

const Field = ({ label, children }) => (
  <div style={{ marginBottom: 10 }}>
    <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 600 }}>{label}</label>
    {children}
  </div>
);

const LogoPicker = ({ label, value, onChange }) => (
  <div>
    <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 4, fontWeight: 600 }}>{label}</label>
    <div style={logoBox}>{value ? <img src={value} alt="" style={imgFit} /> : <span style={{ color: '#bbb', fontSize: 11 }}>none</span>}</div>
    <input type="file" accept="image/*" onChange={onChange} style={{ marginTop: 6, fontSize: 11, width: 96 }} />
  </div>
);

const inp = { width: '100%', padding: '7px 10px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14 };
const logoBox = { width: 96, height: 96, border: '1px dashed #d9d9d9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#fafafa' };
const imgFit = { maxWidth: '100%', maxHeight: '100%' };
const rowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid #f0f0f0', borderRadius: 8, minWidth: 280, flex: '1 1 320px' };

export default Companies;
