import React, { useEffect, useState } from 'react';
import { Switch, Select, InputNumber, Input, TimePicker, Alert, Spin, Table, Tag, Button, Radio, Modal, Space } from 'antd';
import moment from 'moment';
import { useSelector } from 'react-redux';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SubHead, SettingRow, FieldLabel } from './parts';

/* CREDIT CONTROL - Config (the user's request, 2026-10-23: "optional in the
 * config so I can enable it whenever I want with full controls"). The rules
 * are the backend's functions/creditControl; the approvers' screen is
 * Accounts > Credit Control.
 *
 * Off until switched on. "Try it" composes the emails without sending
 * (Preview), sends every one to one address instead of its people (Send a
 * test), or runs it for real now (Send now) - so it can be seen working before
 * the first 9am.
 */
/* Why a run had nothing to send - said, not left as an empty table (the
 * user pressed Preview and "it did nothing": the one party with a limit had
 * no open receivable, only a bill). */
export const nothingToSend = (run) => {
  if (!run || run.emails > 0) return null;
  if (run.kind === 'weekly') return `Nothing to send: no open invoice is over ${run.ageDays ?? 90} days old.`;
  if (!run.checked) return 'Nothing to send: no party has a credit limit yet. Set Credit Limit (Days) or (Amount) on a party in Setup > Parties > Account Info.';
  return `Nothing to send: ${run.checked} part${run.checked === 1 ? 'y has' : 'ies have'} a credit limit, and none has an open invoice past its credit days or owes more than its limit. Only approved receivable invoices count - bills are what you owe.`;
};

const label = (d) => (['ceo', 'cfo', 'hr'].includes(d) ? d.toUpperCase() : d.replace(/\b\w/g, (c) => c.toUpperCase()));
const errorOf = (e, fallback) => e?.response?.data?.result || e?.message || fallback;

const CreditControl = () => {
  const companies = useSelector((state) => state.company?.companies || []);
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [meta, setMeta] = useState({ designations: [], weekdays: [], state: {}, emailReady: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState('daily');
  const [testTo, setTestTo] = useState('');
  const [running, setRunning] = useState('');
  const [run, setRun] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [viewPart, setViewPart] = useState('email');
  const [log, setLog] = useState([]);

  const loadLog = () => axiosClient.get('/creditControl/log').then(({ data }) => setLog(data.result || [])).catch(() => {});

  useEffect(() => {
    axiosClient.get('/creditControl/settings')
      .then(({ data }) => {
        const r = data.result;
        setForm(r.settings); setSaved(r.settings);
        setMeta({ designations: r.designations, weekdays: r.weekdays, state: r.state || {}, emailReady: r.emailReady });
      })
      .catch((e) => openNotification('Error', errorOf(e, 'Could not load the credit control settings.'), 'red'))
      .finally(() => setLoading(false));
    loadLog();
  }, []);

  if (loading) return <Section title='Credit Control'><Spin /></Section>;
  if (!form) return <Section title='Credit Control'><Alert type='error' message='Could not load the settings.' /></Section>;

  const set = (path, value) => setForm((f) => {
    const [a, b] = path.split('.');
    return b ? { ...f, [a]: { ...f[a], [b]: value } } : { ...f, [a]: value };
  });
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const designationOptions = meta.designations.map((d) => ({ value: d, label: label(d) }));
  const time = (path) => {
    const [a, b] = path.split('.');
    return (
      <TimePicker format='HH:mm' minuteStep={5} allowClear={false} value={moment(form[a][b], 'HH:mm')}
        onChange={(m) => set(path, m ? m.format('HH:mm') : form[a][b])} />
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/creditControl/settings', { settings: form });
      if (data.status !== 'success') throw new Error(data.result);
      setForm(data.result); setSaved(data.result);
      openNotification('Saved', data.result.enabled ? 'Credit control is on.' : 'Credit control settings saved (it is off).', 'green');
    } catch (e) {
      openNotification('Error', errorOf(e, 'Could not save.'), 'red');
    } finally {
      setSaving(false);
    }
  };

  const go = async (mode) => {
    if (dirty) { openNotification('Save first', 'A run uses the saved settings - save your changes first.', 'orange'); return; }
    setRunning(mode);
    try {
      const { data } = await axiosClient.post('/creditControl/run', { kind, mode, testTo });
      setRun(data.result);
      if (mode === 'preview') {
        openNotification('Preview', nothingToSend(data.result) || `${data.result.emails} email(s) would be sent - listed below.`, 'blue');
      } else {
        openNotification('Done', `${data.result.sent} sent, ${data.result.failed} failed, ${data.result.skipped} with nobody to send to.`, data.result.failed ? 'orange' : 'green');
        loadLog();
      }
    } catch (e) {
      openNotification('Error', errorOf(e, 'The run failed.'), 'red');
    } finally {
      setRunning('');
    }
  };

  const sendNow = () => Modal.confirm({
    title: `Run the ${kind} ${kind === 'daily' ? 'check' : 'report'} now, for real?`,
    content: kind === 'daily'
      ? 'Every email goes to its sales rep, admin and management, and parties over their limit are blocked. The 9am run still happens as usual.'
      : 'Every email goes to its sales rep, admin and management. The scheduled run still happens as usual.',
    okText: 'Send now',
    onOk: () => go('send'),
  });

  const resultColumns = [
    { title: 'To', render: (_, r) => (r.sentTo || r.to || []).join(', ') || <Tag color='red'>nobody</Tag> },
    { title: 'CC', render: (_, r) => (r.cc || []).join(', ') },
    { title: 'Subject', dataIndex: 'subject' },
    { title: 'Parties', dataIndex: 'parties', align: 'right' },
    { title: 'Invoices', dataIndex: 'invoices', align: 'right' },
    { title: 'Status', render: (_, r) => <Tag color={{ sent: 'green', failed: 'red', skipped: 'orange', preview: 'blue' }[r.status]}>{r.status}</Tag> },
    { title: 'Note', render: (_, r) => r.error || r.problem || '' },
    { title: '', render: (_, r) => r.html && <Button size='small' type='link' onClick={() => { setViewing(r); setViewPart('email'); }}>View</Button> },
  ];

  return (
    <>
      <Section title='Credit Control'
        hint='A daily check of every party with a credit limit - overdue invoices and parties over their limit, emailed to the sales rep with management on CC, until paid - and a weekly ageing report to each sales rep. Parties over their limit are blocked as the client on new jobs until an approver lets them through. The approvers work in Accounts > Credit Control.'>
        {!meta.emailReady && (
          <Alert type='warning' showIcon style={{ marginBottom: 12 }}
            message='Email is not set up - nothing can be sent until it is (Configuration > Email).' />
        )}
        <SettingRow label='Credit control' hint='Off: nothing is checked, emailed or blocked. Switching it on after today’s time has passed starts with the next run, not one now.'>
          <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} aria-label='Credit control' />
        </SettingRow>

        <SubHead hint='Each party with a Credit Limit (Days) or (Amount) on Setup > Parties > Account Info. Repeated every day until the invoices are paid.'>Daily check</SubHead>
        <SettingRow label='Run the daily check'><Switch checked={form.daily.enabled} onChange={(v) => set('daily.enabled', v)} /></SettingRow>
        <SettingRow label='At'>{time('daily.time')}</SettingRow>
        <SettingRow label='Email overdue invoices' hint='Open invoices older than the party’s Credit Limit (Days), in their own currency.'>
          <Switch checked={form.daily.overdue} onChange={(v) => set('daily.overdue', v)} />
        </SettingRow>
        <SettingRow label='Email parties over their limit' hint='Its NET: all of a party’s open invoices less the open bills we owe it, in rupees (a foreign one at its own rate), against its Credit Limit (Amount). The emails list its bills beside its invoices.'>
          <Switch checked={form.daily.overLimit} onChange={(v) => set('daily.overLimit', v)} />
        </SettingRow>

        <SubHead hint='Set by the daily check, lifted by it once the party is back under. A pick is checked again there and then, so a party that paid this morning is let through.'>Blocking</SubHead>
        <SettingRow label='Block parties over their limit' hint='As the CLIENT on a new freight or customs job. Not the shipper or consignee, and not invoices. A job that already has the client keeps saving.'>
          <Switch checked={form.block.enabled} onChange={(v) => set('block.enabled', v)} />
        </SettingRow>
        <SettingRow label='An approval lasts (days)' hint='How long an approver’s "let it through" runs unless they pick another date.'>
          <InputNumber min={1} max={365} value={form.block.approvalDays} onChange={(v) => set('block.approvalDays', v ?? 1)} />
        </SettingRow>

        <SubHead hint='Every party with invoices over the age - with a credit limit or not - to its sales rep, with the open bills we owe it and the net.'>Weekly ageing</SubHead>
        <SettingRow label='Send the weekly report'><Switch checked={form.weekly.enabled} onChange={(v) => set('weekly.enabled', v)} /></SettingRow>
        <SettingRow label='On'>
          <Select style={{ width: 140 }} value={form.weekly.day} onChange={(v) => set('weekly.day', v)}
            options={meta.weekdays.map((d, i) => ({ value: i, label: d }))} />
        </SettingRow>
        <SettingRow label='At'>{time('weekly.time')}</SettingRow>
        <SettingRow label='Invoices older than (days)'>
          <InputNumber min={1} max={3650} value={form.weekly.ageDays} onChange={(v) => set('weekly.ageDays', v ?? 90)} />
        </SettingRow>

        <SubHead hint='By designation, from the email on each employee in Setup > Employees - plus any addresses typed here.'>Who gets them</SubHead>
        <div style={{ maxWidth: 640 }}>
          <FieldLabel hint='CC on every email.'>Management (CC)</FieldLabel>
          <Select mode='multiple' style={{ width: '100%' }} value={form.recipients.management} options={designationOptions}
            onChange={(v) => set('recipients.management', v)} />
          <FieldLabel>More CC addresses</FieldLabel>
          <Select mode='tags' style={{ width: '100%' }} value={form.recipients.extraCc} tokenSeparators={[',', ';', ' ']}
            onChange={(v) => set('recipients.extraCc', v)} placeholder='Type an address and press Enter' />
          <FieldLabel hint='A party with no sales rep is emailed here, asking for one to be set on it.'>No sales rep - send to</FieldLabel>
          <Select mode='multiple' style={{ width: '100%' }} value={form.recipients.admin} options={designationOptions}
            onChange={(v) => set('recipients.admin', v)} />
          <FieldLabel>More no-sales-rep addresses</FieldLabel>
          <Select mode='tags' style={{ width: '100%' }} value={form.recipients.extraAdmin} tokenSeparators={[',', ';', ' ']}
            onChange={(v) => set('recipients.extraAdmin', v)} placeholder='Type an address and press Enter' />
          <FieldLabel hint='Approve or reject a request to unblock a party, unblock one themselves, pick a blocked party on a job, and omit invoices.'>Approvers</FieldLabel>
          <Select mode='multiple' style={{ width: '100%' }} value={form.approvers} options={designationOptions}
            onChange={(v) => set('approvers', v)} />
        </div>

        <SubHead>Which invoices</SubHead>
        <SettingRow label='Include agent invoices' hint='Off, as Job Balancing: agent invoices and bills are left out.'>
          <Switch checked={form.includeAgentInvoices} onChange={(v) => set('includeAgentInvoices', v)} />
        </SettingRow>
        <SettingRow label='Ignore invoices older than (days)'
          hint='Older invoices and bills are left out of everything here - the daily and weekly emails, the credit limits and the blocks - and the emails say so. For an old backlog nobody will chase. 0: none are ignored.'>
          <InputNumber min={0} max={36500} value={form.ignoreOlderThanDays ?? 0} onChange={(v) => set('ignoreOlderThanDays', v ?? 0)} />
        </SettingRow>
        <SettingRow label='Ignore balances below (PKR)'
          hint='An invoice or bill with less than this left on it is left out the same way - for small remainders nobody will chase. In rupees: a foreign one at its own rate, as the limit is. 0: none are ignored.'>
          <InputNumber min={0} max={100000000} step={100} value={form.ignoreBelowAmount ?? 0} onChange={(v) => set('ignoreBelowAmount', v ?? 0)} />
        </SettingRow>
        <div style={{ maxWidth: 640, padding: '10px 0' }}>
          <FieldLabel hint='Empty: every company.'>Companies</FieldLabel>
          <Select mode='multiple' allowClear style={{ width: '100%' }} placeholder='Every company'
            value={form.companies.map(String)} onChange={(v) => set('companies', v)}
            options={companies.map((c) => ({ value: String(c.id), label: c.title }))} />
        </div>
        <SettingRow label='Time zone' hint='The times above are in it. An IANA name, e.g. Asia/Karachi, Asia/Dubai.'>
          <Input style={{ width: 200 }} value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)} />
        </SettingRow>

        <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </Section>

      <Section title='Try it' style={{ marginTop: 16 }}
        hint='Preview composes every email without sending anything or changing any block. Send a test sends them all to one address instead. Send now is the real run.'>
        <Space wrap style={{ marginBottom: 12 }}>
          <Radio.Group value={kind} onChange={(e) => { setKind(e.target.value); setRun(null); }} optionType='button' buttonStyle='solid'
            options={[{ value: 'daily', label: 'Daily check' }, { value: 'weekly', label: 'Weekly ageing' }]} />
          <Button onClick={() => go('preview')} loading={running === 'preview'}>Preview</Button>
          <Input style={{ width: 230 }} placeholder='you@company.com' value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button onClick={() => go('test')} loading={running === 'test'} disabled={!testTo.trim()}>Send a test</Button>
          <Button danger onClick={sendNow} loading={running === 'send'}>Send now</Button>
        </Space>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          Last scheduled daily run: {meta.state.daily || 'none yet'} · weekly: {meta.state.weekly || 'none yet'}
        </div>
        {run && nothingToSend(run) && <Alert type='info' showIcon style={{ marginBottom: 8 }} message={nothingToSend(run)} />}
        {run && !nothingToSend(run) && (
          <>
            <div style={{ marginBottom: 8, fontSize: 13 }}>
              {run.emails} email(s) for {run.parties} part{run.parties === 1 ? 'y' : 'ies'}
              {run.kind === 'daily' ? ` · ${run.overdueInvoices} overdue invoice(s) · ${run.overLimit} over the limit` : ` · ${run.invoices} invoice(s)`}
              {run.mode === 'send' && run.kind === 'daily' ? ` · ${run.blocked} blocked, ${run.lifted} unblocked` : ''}
            </div>
            <Table size='small' rowKey={(r, i) => `${i}`} columns={resultColumns} dataSource={run.results} pagination={{ pageSize: 10 }} />
          </>
        )}
      </Section>

      <Section title='Run log' style={{ marginTop: 16 }} extra={<Button size='small' onClick={loadLog}>Refresh</Button>}>
        <Table size='small' rowKey={(r, i) => `${r.at}-${i}`} dataSource={log} pagination={{ pageSize: 10 }}
          expandable={{
            rowExpandable: (r) => (r.results || []).length > 0,
            expandedRowRender: (r) => <Table size='small' rowKey={(x, i) => `${i}`} columns={resultColumns.slice(0, -1)} dataSource={r.results} pagination={false} />,
          }}
          columns={[
            { title: 'When', render: (_, r) => moment(r.at).format('DD-MM-YYYY HH:mm') },
            { title: 'Run', dataIndex: 'kind' },
            { title: 'How', render: (_, r) => `${r.mode}${r.trigger === 'schedule' ? ' (scheduled)' : ''}` },
            { title: 'Emails', dataIndex: 'emails', align: 'right' },
            { title: 'Sent', dataIndex: 'sent', align: 'right' },
            { title: 'Failed', dataIndex: 'failed', align: 'right', render: (v) => (v ? <Tag color='red'>{v}</Tag> : v) },
            { title: 'Nobody to send to', dataIndex: 'skipped', align: 'right', render: (v) => (v ? <Tag color='orange'>{v}</Tag> : v) },
            { title: 'Blocked / unblocked', render: (_, r) => (r.kind === 'daily' && r.mode === 'send' ? `${r.blocked ?? 0} / ${r.lifted ?? 0}` : '') },
            { title: 'Error', dataIndex: 'error', render: (v) => (v ? <span style={{ color: '#b02a37' }}>{v}</span> : '') },
          ]} />
      </Section>

      <Modal open={Boolean(viewing)} title={viewing?.subject} width={900} footer={null} onCancel={() => setViewing(null)} destroyOnClose>
        {viewing && (
          <>
            <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
              To: {(viewing.to || []).join(', ') || 'nobody'}{viewing.cc?.length ? ` · CC: ${viewing.cc.join(', ')}` : ''}
              {viewing.attachments?.length ? ` · Attached: ${viewing.attachments.join(', ')}` : ''}
            </div>
            {viewing.reportHtml && (
              <Radio.Group value={viewPart} onChange={(e) => setViewPart(e.target.value)} optionType='button' size='small' style={{ marginBottom: 8 }}
                options={[{ value: 'email', label: 'Email' }, { value: 'report', label: 'PDF report' }]} />
            )}
            <iframe title={viewPart === 'report' && viewing.reportHtml ? 'Report preview' : 'Email preview'}
              srcDoc={viewPart === 'report' && viewing.reportHtml ? viewing.reportHtml : viewing.html}
              sandbox='' style={{ width: '100%', height: 560, border: '1px solid #e9edf2' }} />
          </>
        )}
      </Modal>
    </>
  );
};

export default CreditControl;
