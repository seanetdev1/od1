import React, { useEffect, useMemo, useState } from 'react';
import { Switch, Input } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section } from './parts';

/**
 * Admin: how job, invoice and voucher numbers read - Config > Document Numbers.
 *
 * Separately for JOBS, INVOICES and VOUCHERS:
 *   - whether the company's short code leads the number (SNS-SEJ-140/27) or
 *     is left off (SEJ-140/27);
 *   - whether the year comes after the number (140/27) or before it (27/140);
 *   - the code each kind prints - SE / SI / AE / AI / CC jobs, the four
 *     invoice types, bank / cash / adjustment receipts and payments.
 *
 * NOTHING HERE CAN RESTART A SEQUENCE OR REUSE A NUMBER, and the screen says
 * so because it is the question anyone changing it will have. The server finds
 * the last number by the document's kind and its sequence, never by the text
 * these settings change (functions/documentNumber). Numbers already issued
 * keep the ones they have.
 *
 * The preview beside each class is worked out here as you type, from the same
 * rule the server uses; after saving, the server's own examples replace it.
 */
const CLASS_LABEL = { jobs: 'Jobs', invoices: 'Invoices & Bills', vouchers: 'Vouchers' };
// The kind each class's preview is shown for.
const PREVIEW_KIND = { jobs: 'SE', invoices: 'Job Invoice', vouchers: 'BPV' };

export const previewNumber = (settings, klass, code) => {
  const head = settings.companyPrefix[klass] ? `ABC-${code}` : code;
  return `${head}-${settings.yearFirst[klass] ? '27/140' : '140/27'}`;
};

const DocumentNumbers = () => {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [meta, setMeta] = useState({ classes: [], configurable: {} });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axiosClient.get('/settings/documentNumbering')
      .then(({ data }) => {
        setSaved(data.result);
        setForm(data.result);
        setMeta({ classes: data.classes || [], configurable: data.configurable || {} });
      })
      .catch(() => openNotification('Error', 'Could not load the document number settings.', 'red'));
  }, []);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  const setFlag = (field, klass, value) =>
    setForm((f) => ({ ...f, [field]: { ...f[field], [klass]: value } }));
  const setCode = (klass, key, value) =>
    setForm((f) => ({ ...f, codes: { ...f.codes, [klass]: { ...f.codes[klass], [key]: value.toUpperCase() } } }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/documentNumbering', form);
      if (data.status === 'success') {
        setSaved(data.result);
        setForm(data.result);
        openNotification('Success', 'Saved. The next job, invoice and voucher will be numbered this way.', 'green');
      } else {
        openNotification('Error', data.result || 'Could not save.', 'red');
      }
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  if (!form) return null;

  return (
    <Section
      title='Document Numbers'
      hint={'How job, invoice and voucher numbers are laid out, set separately for each. Numbers already '
        + 'issued keep the ones they have; this changes what the next document is called. The number itself '
        + 'always carries on - changing a code, the order or the short name never restarts it or repeats '
        + 'one. Without the company short name, every company shares one sequence, so two companies can '
        + 'never be given the same number. Numbering still starts again at 1 in each new fiscal year.'}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {meta.classes.map((klass) => (
          <div key={klass} style={classStyle} data-testid={`numbering-${klass}`}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{CLASS_LABEL[klass] || klass}</div>
            <div style={previewStyle} data-testid={`preview-${klass}`}>
              {previewNumber(form, klass, form.codes[klass][PREVIEW_KIND[klass]])}
            </div>

            <label style={rowStyle}>
              <Switch
                size="small"
                checked={form.companyPrefix[klass]}
                style={switchStyle(form.companyPrefix[klass])}
                onChange={(v) => setFlag('companyPrefix', klass, v)}
                aria-label={`${CLASS_LABEL[klass]}: company short name in front`}
              />
              <span>Company short name in front</span>
            </label>
            <label style={rowStyle}>
              <Switch
                size="small"
                checked={form.yearFirst[klass]}
                style={switchStyle(form.yearFirst[klass])}
                onChange={(v) => setFlag('yearFirst', klass, v)}
                aria-label={`${CLASS_LABEL[klass]}: year before the number`}
              />
              <span>Year before the number</span>
            </label>

            <div style={{ marginTop: 10 }}>
              {(meta.configurable[klass] || []).map((c) => (
                <div key={c.key} style={{ ...rowStyle, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>{c.label}</span>
                  <Input
                    size="small"
                    value={form.codes[klass][c.key]}
                    onChange={(e) => setCode(klass, c.key, e.target.value)}
                    maxLength={8}
                    style={{ width: 90, textTransform: 'uppercase', fontVariantNumeric: 'tabular-nums' }}
                    aria-label={`${c.label} code`}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving || !dirty}
        className="btn-custom"
        style={{ marginTop: 16 }}
      >
        {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
      </button>
    </Section>
  );
};

const classStyle = {
  flex: '1 1 260px',
  border: '1px solid #f0f0f0',
  borderRadius: 6,
  padding: 14,
};
const previewStyle = {
  fontWeight: 700,
  fontSize: 15,
  fontVariantNumeric: 'tabular-nums',
  marginBottom: 10,
  color: '#1f3b57',
};
// Coloured explicitly: on this page the switch rendered almost white on white,
// on or off, and could not be told apart from the background.
const switchStyle = (on) => ({ backgroundColor: on ? '#1f3b57' : '#bfbfbf', minWidth: 32 });
const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', cursor: 'pointer' };

export default DocumentNumbers;
