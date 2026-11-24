import React, { useEffect, useState } from 'react';
import { Input, InputNumber, Switch, Alert, Tag } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SubHead, FieldLabel, Hint } from './parts';

/**
 * Admin: the mail server this installation sends through.
 *
 * These used to live only in the backend's .env, which meant a leased customer
 * with their own mail server had to send us the password, wait for a redeploy,
 * and do it again whenever the password changed. Now they are set here.
 *
 * THE ENVIRONMENT REMAINS THE FALLBACK. An install that has always been
 * configured through .env keeps working untouched, and this page says which of
 * the two is actually sending rather than leaving an admin to guess - see the
 * banner, and functions/emailConfig on the server.
 *
 * THE PASSWORD IS WRITE-ONLY. The server never sends it back, so the field is
 * blank on every visit and blank means "leave it as it is". That is stated on
 * the field rather than left to be discovered, because the natural reading of
 * an empty password box is that there isn't one.
 */
const EMPTY = {
  host: '', port: 587, secure: false, user: '',
  fromName: '', fromEmail: '',
};

const Email = () => {
  const [form, setForm] = useState(EMPTY);
  const [pass, setPass] = useState('');
  const [meta, setMeta] = useState({ hasPassword: false, active: 'none', envConfigured: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = () => {
    setLoading(true);
    axiosClient.get('/settings/emailConfig')
      .then(({ data }) => {
        const r = data.result || {};
        setForm({
          host: r.host || '', port: r.port || 587, secure: Boolean(r.secure),
          user: r.user || '', fromName: r.fromName || '', fromEmail: r.fromEmail || '',
        });
        setMeta({
          hasPassword: Boolean(r.hasPassword),
          active: r.active || 'none',
          envConfigured: Boolean(r.envConfigured),
        });
      })
      .catch((e) => openNotification(
        'Error', e?.response?.data?.result || 'Could not read the email settings.', 'red',
      ))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/emailConfig', { ...form, pass });
      if (data.status !== 'success') {
        openNotification('Not saved', data.result || 'Could not save.', 'red');
        return;
      }
      // Cleared rather than left in the box: it is not what the server holds,
      // it is what was just sent, and leaving it there invites a second save
      // that changes nothing.
      setPass('');
      openNotification('Saved', 'Email settings saved.', 'green');
      load();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const { data } = await axiosClient.post('/settings/emailConfig/test', { to: testTo.trim() });
      openNotification('Sent', data.result || 'Test message sent.', 'green');
    } catch (e) {
      // The SMTP error is the whole point of the test - authentication
      // refused, host unreachable, certificate rejected. Shown in full.
      openNotification('Test failed', e?.response?.data?.result || 'Could not send.', 'red');
    } finally {
      setTesting(false);
    }
  };

  const row = { display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' };
  const banner = { maxWidth: 720, marginBottom: 16 };

  if (loading) return <div style={{ color: '#888' }}>Loading…</div>;

  return (
    <Section title='Email' hint='The mail server invoices are emailed through. Until it is set here, the server environment is used if it has one.'>
      {/* Which of the two is sending. "Saved settings exist but the
          environment is what is actually in use" is a real state and the one
          most likely to waste somebody's afternoon - so it stays on the page;
          only what to do about it is behind the hint. */}
      {meta.active === 'settings' && (
        <Alert type='success' showIcon style={banner}
          message='Mail is being sent through the settings below.' />
      )}
      {meta.active === 'environment' && (
        <Alert type='info' showIcon style={banner}
          message={<>Mail is being sent through the server environment, not these settings.
            <Hint text='Fill in the host, username and password below and save to take over from it.' /></>} />
      )}
      {meta.active === 'none' && (
        <Alert type='warning' showIcon style={banner}
          message={<>Outgoing mail is not configured.
            <Hint text='Invoice emails will fail until a host, username and password are saved here.' /></>} />
      )}

      <SubHead style={{ marginTop: 0 }}>Mail server</SubHead>
      <div style={{ maxWidth: 720 }}>
        <div style={row}>
          <div style={{ flex: '2 1 260px' }}>
            <FieldLabel>Host *</FieldLabel>
            <Input value={form.host} placeholder='smtp.office365.com'
              onChange={(e) => set('host', e.target.value)} />
          </div>
          <div style={{ flex: '0 0 110px' }}>
            <FieldLabel>Port *</FieldLabel>
            <InputNumber style={{ width: '100%' }} controls={false} min={1} max={65535}
              value={form.port} onChange={(v) => set('port', v)} />
          </div>
          <div style={{ flex: '0 0 110px' }}>
            {/* The pairing people actually get wrong: 465 wants this on, 587
                wants it off and upgrades the connection itself. */}
            <FieldLabel hint='On for port 465. Off for port 587, which upgrades the connection itself.'>TLS</FieldLabel>
            <div style={{ paddingTop: 4 }}>
              <Switch checked={form.secure} onChange={(v) => set('secure', v)} aria-label='TLS' />
            </div>
          </div>
        </div>

        <div style={row}>
          <div style={{ flex: '1 1 260px' }}>
            <FieldLabel>Username *</FieldLabel>
            <Input value={form.user} placeholder='billing@yourcompany.com'
              onChange={(e) => set('user', e.target.value)} />
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <FieldLabel hint={meta.hasPassword ? 'Never shown. Leave blank to keep the stored password.' : undefined}>
              Password {meta.hasPassword ? <Tag color='green' style={{ marginLeft: 4 }}>stored</Tag> : '*'}
            </FieldLabel>
            <Input.Password value={pass} onChange={(e) => setPass(e.target.value)}
              placeholder={meta.hasPassword ? 'Leave blank to keep the stored password' : 'Required'} />
          </div>
        </div>
      </div>

      {/* Worth saying, because it is the commonest reason a correctly
          configured server still refuses to send. */}
      <SubHead hint={'Invoice emails are sent as the individual employee’s own address where they have one. '
        + 'These are the fallback, and some mail servers refuse any From address that is not the account above.'}>
        Sender
      </SubHead>
      <div style={{ ...row, maxWidth: 720 }}>
        <div style={{ flex: '1 1 260px' }}>
          <FieldLabel>From name</FieldLabel>
          <Input value={form.fromName} placeholder='Your Company Ltd'
            onChange={(e) => set('fromName', e.target.value)} />
        </div>
        <div style={{ flex: '1 1 260px' }}>
          <FieldLabel>From address</FieldLabel>
          <Input value={form.fromEmail} placeholder='billing@yourcompany.com'
            onChange={(e) => set('fromEmail', e.target.value)} />
        </div>
      </div>

      <button type='button' className={saving ? 'btn-custom-disabled px-4' : 'btn-custom px-4'}
        disabled={saving} onClick={save}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      <SubHead hint={'Checks the settings here, rather than by raising a real invoice and watching it fail. '
        + 'Save first - the test uses the saved settings.'}>
        Send a test message
      </SubHead>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Input style={{ maxWidth: 320 }} value={testTo} placeholder='you@yourcompany.com'
          onChange={(e) => setTestTo(e.target.value)}
          onPressEnter={() => testTo.trim() && sendTest()} />
        <button type='button'
          className={(testing || !testTo.trim()) ? 'btn-custom-disabled px-4' : 'btn-custom px-4'}
          disabled={testing || !testTo.trim()} onClick={sendTest}>
          {testing ? 'Sending…' : 'Send test'}
        </button>
      </div>
    </Section>
  );
};

export default Email;
