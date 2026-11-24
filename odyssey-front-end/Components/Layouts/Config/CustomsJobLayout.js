import React from 'react';
import { Input, Select, Button, Tooltip } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { SECTION_KEYS, sectionLabel, completeLayout } from 'functions/customsJobForm';

/**
 * THE JOB SCREEN'S TABS, arranged - Configuration > Customs > Job Screen
 * (Essani, 2026-11-14: "make the tab inside the job editable and the sections
 * movable from one tab to another via config").
 *
 * Each tab is a box: its name, then its sections in order, each with up /
 * down and a "move to" list. A tab can be added, renamed, moved, and removed
 * once it is empty. Charges is not here: it is always the job's last tab.
 *
 * `value` is the layout ({ tabs }) or null for the built-in one, which is then
 * shown - as `documentsOnGd` places Documents - ready to be changed. Any change
 * hands the whole layout back; "Back to built-in" hands back null.
 */
const box = {
  border: '1px solid #e3e8ee', borderRadius: 8, padding: 12, background: '#fafbfc',
  marginBottom: 10, maxWidth: 640,
};
const row = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
  borderTop: '1px solid #eef1f4',
};

const move = (list, i, by) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

const newKey = (tabs) => {
  let n = tabs.length + 1;
  while (tabs.some((t) => t.key === `t${n}`)) n += 1;
  return `t${n}`;
};

const CustomsJobLayout = ({ value, documentsOnGd = false, onChange }) => {
  const layout = completeLayout(value, { documentsOnGd });
  const tabs = layout.tabs;
  const custom = Boolean(value);
  const put = (next) => onChange({ tabs: next });

  const renameTab = (i, title) => put(tabs.map((t, n) => (n === i ? { ...t, title } : t)));
  const moveTab = (i, by) => put(move(tabs, i, by));
  const removeTab = (i) => put(tabs.filter((_, n) => n !== i));
  const addTab = () => put([...tabs, { key: newKey(tabs), title: `Tab ${tabs.length + 1}`, sections: [] }]);
  const moveSection = (i, s, by) => put(tabs.map((t, n) => (n === i ? { ...t, sections: move(t.sections, s, by) } : t)));
  const sendSection = (section, toKey) => put(tabs.map((t) => {
    if (t.key === toKey) return t.sections.includes(section) ? t : { ...t, sections: [...t.sections, section] };
    return { ...t, sections: t.sections.filter((x) => x !== section) };
  }));
  // Essani's: everything on one tab, beside Charges.
  const allOnOne = () => onChange({ tabs: [{ key: 'details', title: tabs[0]?.title || 'Job Details', sections: [...SECTION_KEYS] }] });

  const tabOptions = tabs.map((t) => ({ value: t.key, label: t.title || '(no name)' }));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Button onClick={allOnOne}>Everything on one tab</Button>
        <Button icon={<PlusOutlined />} onClick={addTab} disabled={tabs.length >= 12}>Add a tab</Button>
        {custom && <Button onClick={() => onChange(null)}>Back to built-in</Button>}
        <span style={{ alignSelf: 'center', color: '#8a97a3', fontSize: 12 }}>
          {custom ? 'Arranged for this install' : 'Built-in layout'} - Charges is always the last tab.
        </span>
      </div>
      {tabs.map((t, i) => (
        <div key={t.key} style={box} data-testid={`layout-tab-${i}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <Input value={t.title} onChange={(e) => renameTab(i, e.target.value)} maxLength={40}
              style={{ maxWidth: 280, fontWeight: 600 }} aria-label={`Tab ${i + 1} name`}
              status={String(t.title).trim() ? undefined : 'error'} />
            <Tooltip title='Move this tab earlier'>
              <Button size='small' icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => moveTab(i, -1)}
                aria-label={`Move tab ${i + 1} earlier`} />
            </Tooltip>
            <Tooltip title='Move this tab later'>
              <Button size='small' icon={<ArrowDownOutlined />} disabled={i === tabs.length - 1} onClick={() => moveTab(i, 1)}
                aria-label={`Move tab ${i + 1} later`} />
            </Tooltip>
            <Tooltip title={t.sections.length ? 'Move its sections to another tab first' : 'Remove this tab'}>
              <Button size='small' danger icon={<DeleteOutlined />} disabled={t.sections.length > 0 || tabs.length === 1}
                onClick={() => removeTab(i)} aria-label={`Remove tab ${i + 1}`} />
            </Tooltip>
          </div>
          {t.sections.length === 0 && (
            <div style={{ color: '#8a97a3', fontSize: 12, padding: '4px 0' }}>
              Empty - not shown on the job.
            </div>
          )}
          {t.sections.map((s, n) => (
            <div key={s} style={row}>
              <span style={{ flex: '1 1 auto' }}>{sectionLabel(s)}</span>
              <Button size='small' icon={<ArrowUpOutlined />} disabled={n === 0} onClick={() => moveSection(i, n, -1)}
                aria-label={`Move ${sectionLabel(s)} up`} />
              <Button size='small' icon={<ArrowDownOutlined />} disabled={n === t.sections.length - 1}
                onClick={() => moveSection(i, n, 1)} aria-label={`Move ${sectionLabel(s)} down`} />
              <Select size='small' value={t.key} options={tabOptions} style={{ width: 180 }}
                onChange={(k) => sendSection(s, k)} aria-label={`${sectionLabel(s)} tab`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default CustomsJobLayout;
