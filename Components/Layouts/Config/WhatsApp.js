import React, { useEffect, useState } from 'react';
import { Switch, Input, InputNumber, Select, TimePicker, DatePicker, Alert, Spin, Table, Tag, Button, Modal, Space } from 'antd';
import { DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import moment from 'moment';
import { useSelector } from 'react-redux';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SubHead, SettingRow, FieldLabel } from './parts';

/* THE WHATSAPP DAILY UPDATE - Config (the user's request, 2026-10-24): the
 * day's new bookings and new invoices, job by job, with selling, buying and
 * profit, to designated people on WhatsApp every evening. Through Meta's
 * WhatsApp Cloud API: a message template Meta has approved, with the day's
 * totals in it and the full report attached as a PDF. The backend is
 * functions/whatsapp.
 *
 * The access token is write-only, as the mail password is: the server never
 * sends it back, and a blank box keeps the stored one.
 */
const errorOf = (e, fallback) => e?.response?.data?.result || e?.message || fallback;

const copy = (text) => {
  try {
    navigator.clipboard.writeText(text);
    openNotification('Copied', 'Paste it into the template body in WhatsApp Manager.', 'green');
  } catch (_) { /* no clipboard: the text is on screen to select */ }
};

const WhatsApp = () => {
  const companies = useSelector((state) => state.company?.companies || []);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [template, setTemplate] = useState(null);
  const [state, setState] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [day, setDay] = useState(moment());
  const [testTo, setTestTo] = useState('');
  const [running, setRunning] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);

  const loadLog = () => axiosClient.get('/whatsapp/log').then(({ data }) => setLog(data.result || [])).catch(() => {});

  useEffect(() => {
    axiosClient.get('/whatsapp/settings')
      .then(({ data }) => {
        const r = data.result;
        setForm(r.settings); setSaved(r.settings); setHasToken(r.hasToken); setTemplate(r.template); setState(r.state || {});
      })
      .catch((e) => openNotification('Error', errorOf(e, 'Could not load the WhatsApp settings.'), 'red'))
      .finally(() => setLoading(false));
    loadLog();
  }, []);

  if (loading) return <Section title='WhatsApp'><Spin /></Section>;
  if (!form) return <Section title='WhatsApp'><Alert type='error' message='Could not load the settings.' /></Section>;

  const set = (path, value) => setForm((f) => {
    const [a, b] = path.split('.');
    return b ? { ...f, [a]: { ...f[a], [b]: value } } : { ...f, [a]: value };
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved) || Boolean(token.trim());
  const setRecipient = (i, key, value) => set('recipients', form.recipients.map((r, n) => (n === i ? { ...r, [key]: value } : r)));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/whatsapp/settings', { settings: form, token: token.trim() || undefined });
      if (data.status !== 'success') throw new Error(data.result);
      setForm(data.result.settings); setSaved(data.result.settings); setHasToken(data.result.hasToken); setToken('');
      openNotification('Saved', data.result.settings.enabled ? `The daily update is on - every day at ${data.result.settings.time}.` : 'WhatsApp settings saved (the daily update is off).', 'green');
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not save.'), 'red');
    } finally {
      setSaving(false);
    }
  };

  const go = async (mode) => {
    if (dirty && mode !== 'preview' && mode !== 'pdf') { openNotification('Save first', 'Sending uses the saved settings - save your changes first.', 'orange'); return; }
    setRunning(mode);
    try {
      const { data } = await axiosClient.post('/whatsapp/run', { mode, testTo, date: day?.format('YYYY-MM-DD') });
      const r = data.result;
      if (mode === 'preview') setPreview(r);
      else if (mode === 'pdf') {
        const bytes = Uint8Array.from(atob(r.pdf), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url; a.download = r.filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        setResult(r);
        openNotification(r.failed ? 'Not all sent' : 'Sent', r.note || `${r.sent} sent${r.failed ? `, ${r.failed} failed - see below` : ''}.`, r.failed ? 'orange' : 'green');
        loadLog();
      }
    } catch (e) {
      openNotification('Error', errorOf(e, 'That did not work.'), 'red');
    } finally {
      setRunning('');
    }
  };

  const sendNow = () => Modal.confirm({
    title: `Send the update for ${day.format('DD-MM-YYYY')} to everyone now?`,
    content: `${form.recipients.length} recipient(s) get it on WhatsApp. The ${form.time} run still happens as usual.`,
    okText: 'Send now',
    onOk: () => go('send'),
  });

  const resultColumns = [
    { title: 'To', render: (_, r) => `${r.name} (${r.phone})` },
    { title: 'Status', render: (_, r) => <Tag color={r.status === 'sent' ? 'green' : 'red'}>{r.status}</Tag> },
    { title: 'Note', render: (_, r) => r.error || '' },
  ];

  return (
    <>
      <Section title='WhatsApp'
        hint="A daily WhatsApp to the people below: the day's new bookings and the invoices and bills raised, job by job, with selling, buying and profit - a short message with the totals, and the full report as a PDF.">
        <SettingRow label='Daily update' hint='Off: nothing is sent. Switching it on after today’s time has passed starts tomorrow.'>
          <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} aria-label='Daily update' />
        </SettingRow>

        <SubHead hint="From Meta: business.facebook.com > WhatsApp Manager > API Setup (the phone number ID and the account ID), and Business Settings > System users (a permanent access token with the whatsapp_business_messaging permission).">Connection</SubHead>
        <div style={{ maxWidth: 640 }}>
          <FieldLabel hint='Not the phone number itself - the long number Meta shows beside it.'>Phone number ID</FieldLabel>
          <Input value={form.connection.phoneNumberId} onChange={(e) => set('connection.phoneNumberId', e.target.value)} placeholder='e.g. 106540352242922' />
          <FieldLabel>WhatsApp Business Account ID (optional)</FieldLabel>
          <Input value={form.connection.businessAccountId} onChange={(e) => set('connection.businessAccountId', e.target.value)} />
          <FieldLabel hint='The Graph API version - leave as it is unless Meta retires it.'>API version</FieldLabel>
          <Input style={{ width: 120 }} value={form.connection.apiVersion} onChange={(e) => set('connection.apiVersion', e.target.value)} />
          <FieldLabel>Access token {hasToken && <Tag color='green' style={{ marginLeft: 6 }}>stored</Tag>}</FieldLabel>
          <Input.Password value={token} onChange={(e) => setToken(e.target.value)} autoComplete='new-password'
            placeholder={hasToken ? 'Stored - leave blank to keep it' : 'Paste the permanent token'} />
        </div>

        <SubHead hint='Meta only lets a business start a WhatsApp conversation with a template it has approved. Create this one once; approval usually takes minutes.'>Message template</SubHead>
        {template && (
          <div style={{ maxWidth: 640, fontSize: 13, background: '#f7f9fb', border: '1px solid #e9edf2', borderRadius: 6, padding: 12 }}>
            <div>In WhatsApp Manager &gt; Message templates &gt; Create, make:</div>
            <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
              <li>Category <b>Utility</b>, name <b>{template.name}</b>, language <b>English ({template.language})</b></li>
              <li>Header <b>Document</b> - for the sample, use Download PDF below</li>
              <li>Body, exactly:</li>
            </ul>
            <div style={{ background: '#fff', border: '1px solid #e9edf2', borderRadius: 4, padding: 8, fontFamily: 'monospace', fontSize: 12 }}>{template.body}</div>
            <Button size='small' icon={<CopyOutlined />} style={{ marginTop: 6 }} onClick={() => copy(template.body)}>Copy the body</Button>
            <div style={{ marginTop: 6 }}>Footer (optional): <b>{template.footer}</b>. The variables are: {template.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(', ')}.</div>
          </div>
        )}
        <div style={{ maxWidth: 640, display: 'flex', gap: 12, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel hint='As approved - change only if you named it differently.'>Template name</FieldLabel>
            <Input value={form.template.name} onChange={(e) => set('template.name', e.target.value)} />
          </div>
          <div style={{ width: 140 }}>
            <FieldLabel>Language code</FieldLabel>
            <Input value={form.template.language} onChange={(e) => set('template.language', e.target.value)} />
          </div>
        </div>

        <SubHead>When, and what</SubHead>
        <SettingRow label='Send at' hint="Every day, covering what was entered that day up to then.">
          <TimePicker format='HH:mm' minuteStep={5} allowClear={false} value={moment(form.time, 'HH:mm')}
            onChange={(m) => set('time', m ? m.format('HH:mm') : form.time)} />
        </SettingRow>
        <SettingRow label='Time zone' hint='An IANA name, e.g. Asia/Karachi.'>
          <Input style={{ width: 200 }} value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)} />
        </SettingRow>
        <SettingRow label='Send on a quiet day' hint='On: a day with no new bookings or invoices is still sent, with zeros. Off: nothing is sent that day.'>
          <Switch checked={form.sendWhenEmpty} onChange={(v) => set('sendWhenEmpty', v)} />
        </SettingRow>
        <div style={{ maxWidth: 640, padding: '10px 0' }}>
          <FieldLabel hint='Empty: every company.'>Companies</FieldLabel>
          <Select mode='multiple' allowClear style={{ width: '100%' }} placeholder='Every company'
            value={form.companies.map(String)} onChange={(v) => set('companies', v)}
            options={companies.map((c) => ({ value: String(c.id), label: c.title }))} />
        </div>

        <SubHead hint="A number without a country code takes the one here - 0300 1234567 becomes 92 300 1234567. While Meta's number is in test mode, each recipient must also be on its allowed list (API Setup).">Send to</SubHead>
        <div style={{ maxWidth: 640 }}>
          {form.recipients.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Input style={{ flex: 1 }} placeholder='Name' value={r.name} onChange={(e) => setRecipient(i, 'name', e.target.value)} />
              <Input style={{ width: 200 }} placeholder='WhatsApp number' value={r.phone} onChange={(e) => setRecipient(i, 'phone', e.target.value)} />
              <Button icon={<DeleteOutlined />} aria-label={`Remove ${r.name || 'recipient'}`} onClick={() => set('recipients', form.recipients.filter((_, n) => n !== i))} />
            </div>
          ))}
          <Space>
            <Button size='small' onClick={() => set('recipients', [...form.recipients, { name: '', phone: '' }])}>Add a person</Button>
            <span style={{ fontSize: 12, color: '#666' }}>Country code</span>
            <InputNumber size='small' style={{ width: 70 }} min={1} max={9999} value={Number(form.defaultCountryCode) || 92} onChange={(v) => set('defaultCountryCode', String(v ?? 92))} />
          </Space>
        </div>

        <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </Section>

      <Section title='Try it' style={{ marginTop: 16 }}
        hint='Preview shows the message and the report without sending. Download PDF gives the report itself - also the sample Meta asks for with the template. Send a test sends it to one number only.'>
        <Space wrap style={{ marginBottom: 12 }}>
          <DatePicker value={day} onChange={(d) => setDay(d || moment())} format='DD-MM-YYYY' allowClear={false} />
          <Button onClick={() => go('preview')} loading={running === 'preview'}>Preview</Button>
          <Button onClick={() => go('pdf')} loading={running === 'pdf'}>Download PDF</Button>
          <Input style={{ width: 190 }} placeholder='0300 1234567' value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button onClick={() => go('test')} loading={running === 'test'} disabled={!testTo.trim()}>Send a test</Button>
          <Button danger onClick={sendNow} loading={running === 'send'} disabled={!saved.recipients.length}>Send now</Button>
        </Space>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Last scheduled send: {state.daily || 'none yet'}</div>
        {result && <Table size='small' rowKey={(r) => r.phone} columns={resultColumns} dataSource={result.results} pagination={false} style={{ marginBottom: 12 }} />}
        {preview && (
          <>
            <FieldLabel>The message</FieldLabel>
            <div style={{ maxWidth: 520, background: '#dcf8c6', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>📄 daily-update-{preview.date}.pdf</div>
              {preview.text}
              {template?.footer && <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>{template.footer}</div>}
            </div>
            <FieldLabel>The attached report</FieldLabel>
            <iframe title='Report preview' srcDoc={preview.html} sandbox='' style={{ width: '100%', height: 520, border: '1px solid #e9edf2' }} />
          </>
        )}
      </Section>

      <Section title='Send log' style={{ marginTop: 16 }} extra={<Button size='small' onClick={loadLog}>Refresh</Button>}>
        <Table size='small' rowKey={(r, i) => `${r.at}-${i}`} dataSource={log} pagination={{ pageSize: 10 }}
          expandable={{
            rowExpandable: (r) => (r.results || []).length > 0,
            expandedRowRender: (r) => <Table size='small' rowKey={(x) => x.phone} columns={resultColumns} dataSource={r.results} pagination={false} />,
          }}
          columns={[
            { title: 'When', render: (_, r) => moment(r.at).format('DD-MM-YYYY HH:mm') },
            { title: 'Day', dataIndex: 'date' },
            { title: 'How', render: (_, r) => `${r.mode}${r.trigger === 'schedule' ? ' (scheduled)' : ''}` },
            { title: 'Bookings', align: 'right', render: (_, r) => r.totals?.bookings ?? '' },
            { title: 'Invoices', align: 'right', render: (_, r) => r.totals?.invoices ?? '' },
            { title: 'Sent', dataIndex: 'sent', align: 'right' },
            { title: 'Failed', dataIndex: 'failed', align: 'right', render: (v) => (v ? <Tag color='red'>{v}</Tag> : v) },
            { title: 'Note', render: (_, r) => (r.error ? <span style={{ color: '#b02a37' }}>{r.error}</span> : r.note || '') },
          ]} />
      </Section>
    </>
  );
};

export default WhatsApp;
