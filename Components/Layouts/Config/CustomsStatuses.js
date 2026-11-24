import React, { useEffect, useState } from 'react';
import { Spin, Input, Select, Checkbox, Radio, Tag } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined } from '@ant-design/icons';
import openNotification from 'Components/Shared/Notification';
import { getCustomsStatuses, saveCustomsStatuses } from 'apis/customsStatuses';
import {
  STATUS_RULES, STATUS_COLORS, BUILT_IN_STATUSES, asStatuses, setCustomsStatuses,
} from 'functions/customsStatuses';
import { Section, SubHead } from './parts';

// Admin: the statuses a customs JOB and a Program Book PLAN can be at, and the
// rules each follows (functions/customsStatuses; the server's is the rule).
//
// Each status has a name, a colour and the rules ticked for it; a new one can
// be added, any moved up or down - the order the dropdowns and the filter tags
// follow. A status is never deleted from under the rows that carry it: a
// built-in one, or one still in use, is RETIRED instead by unticking Offered -
// it stays on its rows, and nobody can pick it again. The server refuses the
// rest (two with one name, none to start at, nothing billable or movable) with
// a message saying which.
//
// Saved separately from the Customs Jobs switches, by its own Save.

const KINDS = [
  { kind: 'job', title: 'Job statuses', hint: 'What a customs job\'s Status can be - the job screen, the jobs list and its filter.' },
  { kind: 'plan', title: 'Program Book statuses', hint: 'What a plan\'s Job Status can be, before it is moved to the jobs list.' },
];

const strip = (list) => list.map(({ value, label, color, rules, hidden }) => ({
  ...(value ? { value } : {}), label, color, rules, hidden: Boolean(hidden),
}));

const StatusTable = ({ kind, list, onChange }) => {
  const rules = STATUS_RULES[kind];
  const builtIn = BUILT_IN_STATUSES[kind];
  const set = (i, patch) => onChange(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const toggleRule = (i, rule, on) => {
    const s = list[i];
    set(i, { rules: on ? [...s.rules, rule] : s.rules.filter((r) => r !== rule) });
  };
  // One status starts: picking it takes the rule from whichever had it, and
  // offers it - a status nobody can pick cannot be where new rows start.
  const pickStart = (i) => onChange(list.map((s, j) => ({
    ...s,
    rules: j === i ? [...new Set([...s.rules, 'start'])] : s.rules.filter((r) => r !== 'start'),
    hidden: j === i ? false : s.hidden,
  })));
  const move = (i, by) => {
    const next = [...list];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    onChange(next);
  };

  return (
    <table className='cs-table'>
      <thead>
        <tr>
          <th aria-label='Order' />
          <th>Name</th>
          <th>Colour</th>
          {rules.map((r) => <th key={r.id} className='cs-rule'>{r.label}</th>)}
          <th className='cs-rule'>Offered</th>
          <th aria-label='Remove' />
        </tr>
      </thead>
      <tbody>
        {list.map((s, i) => {
          const fixed = builtIn.includes(s.value);
          const starts = s.rules.includes('start');
          return (
            // eslint-disable-next-line react/no-array-index-key
            <tr key={s.value || `new-${i}`} className={s.hidden ? 'cs-retired' : undefined}>
              <td className='cs-order'>
                <button type='button' disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${s.label} up`}>
                  <ArrowUpOutlined />
                </button>
                <button type='button' disabled={i === list.length - 1} onClick={() => move(i, 1)}
                  aria-label={`Move ${s.label} down`}>
                  <ArrowDownOutlined />
                </button>
              </td>
              <td>
                <Input size='small' value={s.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })}
                  aria-label={`${kind === 'job' ? 'Job' : 'Program Book'} status ${i + 1} name`} />
                {fixed && s.label !== s.value && <div className='cs-stored'>stored as {s.value}</div>}
              </td>
              <td>
                <Select size='small' value={s.color} onChange={(v) => set(i, { color: v })} style={{ width: 120 }}
                  aria-label={`${s.label} colour`}
                  options={STATUS_COLORS.map((c) => ({ value: c, label: <Tag color={c}>{c === 'default' ? 'grey' : c}</Tag> }))} />
              </td>
              {rules.map((r) => (
                <td key={r.id} className='cs-rule'>
                  {r.one
                    ? <Radio checked={starts} onChange={() => pickStart(i)} aria-label={`${s.label}: ${r.label}`} />
                    : <Checkbox checked={s.rules.includes(r.id)} onChange={(e) => toggleRule(i, r.id, e.target.checked)}
                      aria-label={`${s.label}: ${r.label}`} />}
                </td>
              ))}
              <td className='cs-rule'>
                <Checkbox checked={!s.hidden} disabled={starts} onChange={(e) => set(i, { hidden: !e.target.checked })}
                  title={starts ? 'New rows start here, so it is always offered' : 'Untick to retire it - it stays on the rows that have it'}
                  aria-label={`${s.label}: offered`} />
              </td>
              <td>
                <button type='button' className='cs-remove' disabled={fixed}
                  title={fixed ? 'Built in - untick Offered to stop it being picked' : 'Remove this status'}
                  onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove ${s.label}`}>
                  <DeleteOutlined />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const CustomsStatuses = () => {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getCustomsStatuses()
      .then((res) => {
        if (!alive) return;
        if (res?.status !== 'success') throw new Error(res?.result);
        const value = asStatuses(res.result);
        setSaved(value);
        setDraft(value);
      })
      .catch(() => openNotification('Error', 'Could not load the statuses.', 'red'));
    return () => { alive = false; };
  }, []);

  const dirty = Boolean(draft && saved) && JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveCustomsStatuses({ job: strip(draft.job), plan: strip(draft.plan) });
      if (res?.status !== 'success') throw new Error(res?.result);
      const value = asStatuses(res.result);
      setSaved(value);
      setDraft(value);
      // Every screen open shows the new names, colours and rules.
      setCustomsStatuses(value);
      openNotification('Success', 'Statuses saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save the statuses.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const addStatus = (kind) => setDraft((d) => ({
    ...d, [kind]: [...d[kind], { label: '', color: 'default', rules: [], hidden: false }],
  }));

  return (
    <Section
      className='customs-statuses'
      title='Statuses'
      hint={'Rename, colour and order the statuses, add your own, and tick the rules each follows. A status '
        + 'in use is never removed - untick Offered to retire it: the jobs and plans at it keep it, and it is '
        + 'no longer offered.'}
    >
      {!draft ? <Spin /> : (
        <>
          {KINDS.map(({ kind, title, hint }) => (
            <div key={kind} className='cs-kind'>
              <SubHead hint={hint} style={{ marginTop: 0 }}>{title}</SubHead>
              <div className='cs-frame'>
                <StatusTable kind={kind} list={draft[kind]} onChange={(list) => setDraft((d) => ({ ...d, [kind]: list }))} />
              </div>
              <button type='button' className='cs-add' onClick={() => addStatus(kind)}>+ Add status</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8 }} className='mt-3'>
            <button type='button' className='btn-custom' onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            {dirty && (
              <button type='button' className='btn-custom' onClick={() => setDraft(saved)} disabled={saving}>Undo changes</button>
            )}
          </div>
        </>
      )}
      <style jsx global>{`
        .customs-statuses .cs-kind + .cs-kind { margin-top: 20px; }
        .customs-statuses .cs-frame { max-width: 100%; overflow-x: auto; }
        .customs-statuses .cs-table { border-collapse: collapse; font-size: 13px; }
        .customs-statuses .cs-table th {
          font-size: 11px; font-weight: 600; color: #555; text-align: left; padding: 4px 6px;
          border-bottom: 1px solid #e8e8e8; vertical-align: bottom;
        }
        .customs-statuses .cs-table td { padding: 4px 6px; border-bottom: 1px solid #f3f3f3; vertical-align: top; }
        .customs-statuses .cs-table .cs-rule { text-align: center; width: 104px; }
        .customs-statuses .cs-table td:nth-child(2) { width: 200px; }
        .customs-statuses .cs-order { white-space: nowrap; }
        .customs-statuses .cs-order button, .customs-statuses .cs-remove {
          background: none; border: 0; padding: 2px 4px; cursor: pointer; color: #555;
        }
        .customs-statuses .cs-order button:disabled, .customs-statuses .cs-remove:disabled { color: #ccc; cursor: default; }
        .customs-statuses .cs-stored { font-size: 11px; color: #999; margin-top: 2px; }
        .customs-statuses .cs-retired td:nth-child(2) input { color: #999; text-decoration: line-through; }
        .customs-statuses .cs-add {
          margin-top: 6px; background: none; border: 1px dashed #bbb; border-radius: 6px;
          padding: 2px 12px; color: #555; cursor: pointer; font-size: 13px;
        }
      `}</style>
    </Section>
  );
};

export default CustomsStatuses;
