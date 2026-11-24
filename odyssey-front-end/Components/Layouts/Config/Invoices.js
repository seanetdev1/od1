import React, { useEffect, useState } from 'react';
import { Spin, Switch, Input } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { getMode } from 'functions/terminology';
import { Section, SettingRow, SubHead } from './parts';

// Admin: how invoices behave install-wide.
//
// Round off automatically - every invoice in rupees is rounded to a whole
// rupee, as if its Round Off box were ticked: on its page as it opens, and
// worked out again from the final total when it is approved (the server's
// functions/invoiceRoundOff). Agent invoices are in their agent's currency and
// are never rounded. Off, only the invoices whose box is ticked are.
//
// Hide the sign line - Printing Options' "Hide Sign Line" starts ticked, on
// the invoice page and the bulk print alike; it can still be unticked for one
// print.
//
// Hide the tax column (customs) - Printing Options' "Hide Tax Column" starts
// ticked: no Tax column on a customs invoice, its service charges before tax,
// and no Total For Sales Tax line. Unticked for one print as the sign line.
//
// Essani's (2026-11-14), each off or empty until set, so other installs print
// as they did: Hide Bank Details by default; Container Nos in the Note box
// (customs); a disclaimer where the sign line was; the GST number's format.
//
// Changed here, kept by Save - as the other Configuration tabs.
const SETTINGS = [
  {
    key: 'auto',
    url: '/settings/invoiceRoundOff',
    label: 'Round off invoices automatically',
    hint: 'Every invoice and bill in rupees is rounded to a whole rupee - its Round Off box ticked for you - and rounded again from its final total when it is approved. Agent invoices, in their agent\'s currency, are not rounded. Off, only invoices with the box ticked are.',
  },
  {
    key: 'hideSignLine',
    url: '/settings/invoicePrint',
    label: 'Hide the sign line by default',
    hint: 'Printing Options start with Hide Sign Line ticked - the signature line and the company name under it left off the invoice print. It can still be unticked for one print.',
  },
  {
    key: 'signDisclaimer',
    url: '/settings/invoicePrint',
    type: 'text',
    label: 'Disclaimer instead of the sign line',
    hint: 'Printed where the sign line was whenever Hide Sign Line is ticked - "This is a computer generated invoice and needs no signature", say. Empty, nothing is printed there.',
  },
  {
    key: 'hideBankDetails',
    url: '/settings/invoicePrint',
    label: 'Hide bank details by default',
    hint: 'Printing Options start with Hide Bank Details ticked - the Bank Details box left off the invoice print and its Excel. It can still be unticked for one print.',
  },
  {
    key: 'hideTax',
    url: '/settings/invoicePrint',
    mode: 'customs',
    label: 'Hide the tax column by default',
    hint: 'Printing Options start with Hide Tax Column ticked: the invoice print has no Tax column, its service charges show their value before tax, and Total For Sales Tax is left off - under them come Sales Tax @ 15 %, Total Without Tax and Total With Tax. It can still be unticked for one print.',
  },
  {
    key: 'containerNosInNote',
    url: '/settings/invoicePrint',
    mode: 'customs',
    label: 'Container numbers in place of the note',
    hint: 'A customs invoice\'s Note box is headed Container Nos and lists its job\'s container numbers - on the print, the emailed PDF and the Excel. The invoice\'s own note is then not printed.',
  },
  {
    key: 'format',
    url: '/settings/gstNumberFormat',
    type: 'gst',
    label: 'GST invoice number format',
    hint: 'How a new GST (sales tax) invoice number is made. {CODE} is the company\'s short code; the number goes where #### is, one # per digit, filled with noughts - or write it regex-style, \\d{4}. {CODE}-#### makes ABC-0001. The numbers carry on from the last one whatever the format; only numbers issued after a change take the new shape. Blank is {CODE}-#, as numbers always were.',
  },
];

const readValue = (s, result) => {
  if (s.type === 'text' || s.type === 'gst') return String(result?.[s.key] ?? '');
  return Boolean(result?.[s.key]);
};

const Invoices = () => {
  // A setting with a mode is offered on that mode's install only.
  const mode = getMode();
  const settings = SETTINGS.filter((s) => !s.mode || s.mode === mode);
  const [saved, setSaved] = useState({});   // as the server has them
  const [form, setForm] = useState({});     // as on screen
  const [example, setExample] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    // Each route read once, however many settings it holds.
    const urls = [...new Set(settings.map((s) => s.url))];
    Promise.all(urls.map((u) => axiosClient.get(u).then(({ data }) => [u, data?.result])))
      .then((pairs) => {
        if (!alive) return;
        const byUrl = Object.fromEntries(pairs);
        const values = Object.fromEntries(settings.map((s) => [s.key, readValue(s, byUrl[s.url])]));
        setSaved(values);
        setForm(values);
        setExample(byUrl['/settings/gstNumberFormat']?.example || '');
      })
      .catch(() => openNotification('Error', 'Could not load the invoice settings.', 'red'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = settings.filter((s) => form[s.key] !== saved[s.key]);
  const dirty = changed.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      // Only what changed, a route at a time with what it holds.
      const urls = [...new Set(changed.map((s) => s.url))];
      for (const url of urls) {
        const body = Object.fromEntries(changed.filter((s) => s.url === url).map((s) => [s.key, form[s.key]]));
        const { data } = await axiosClient.post(url, body);
        if (data.status !== 'success') throw new Error(data.result);
        const mine = settings.filter((s) => s.url === url);
        setSaved((v) => ({ ...v, ...Object.fromEntries(mine.filter((s) => s.key in body).map((s) => [s.key, readValue(s, data.result)])) }));
        setForm((v) => ({ ...v, ...Object.fromEntries(mine.filter((s) => s.key in body).map((s) => [s.key, readValue(s, data.result)])) }));
        if (url === '/settings/gstNumberFormat') setExample(data.result?.example || '');
      }
      openNotification('Success', 'Invoice settings saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const control = (s) => {
    if (s.type === 'text') {
      return (
        <Input.TextArea value={form[s.key]} rows={2} maxLength={500} style={{ width: 300 }} aria-label={s.label}
          placeholder='None' onChange={(e) => setForm((f) => ({ ...f, [s.key]: e.target.value }))} />
      );
    }
    if (s.type === 'gst') {
      return (
        <div style={{ textAlign: 'right' }}>
          <Input value={form[s.key]} maxLength={40} style={{ width: 220 }} aria-label={s.label}
            placeholder='{CODE}-#' onChange={(e) => setForm((f) => ({ ...f, [s.key]: e.target.value }))} />
          {/* The saved format's next number, by the server's own rule. */}
          {example && form[s.key] === saved[s.key] && (
            <div style={{ fontSize: 12, color: '#8a97a3', marginTop: 4 }}>e.g. {example}</div>
          )}
        </div>
      );
    }
    return (
      <Switch
        checked={Boolean(form[s.key])}
        onChange={(next) => setForm((f) => ({ ...f, [s.key]: next }))}
        aria-label={s.label}
      />
    );
  };

  return (
    <Section title='Invoices'>
      {loading ? <Spin /> : (
        <>
          {settings.filter((s) => s.type !== 'gst').map((s) => (
            <SettingRow key={s.key} label={s.label} hint={s.hint}>{control(s)}</SettingRow>
          ))}
          <SubHead>Numbering</SubHead>
          {settings.filter((s) => s.type === 'gst').map((s) => (
            <SettingRow key={s.key} label={s.label} hint={s.hint}>{control(s)}</SettingRow>
          ))}
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </>
      )}
    </Section>
  );
};

export default Invoices;
