import React, { useEffect, useState } from 'react';
import { Button, Checkbox, Spin } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, Hint } from './parts';
import { labelOf } from './designations';

// A grid of what (rows) against which designation sees it (columns) - the
// Configuration sections set per designation: Dashboard Widgets, Bell Alerts
// (2026-11-23). The server sends the rows, the designations, what is saved and
// the defaults (functions/designationGrid on the backend) and checks the save;
// this only ticks.
//
// Changed here, kept by Save - as the other Configuration sections.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DesignationGrid = ({ endpoint, title, hint, rowHeader, what, defaultTip }) => {
  const [widgets, setWidgets] = useState([]);           // [{ key, label, hint }]
  const [designations, setDesignations] = useState([]); // ['ceo', ...]
  const [defaults, setDefaults] = useState({});
  const [saved, setSaved] = useState({});               // as the server has it
  const [grid, setGrid] = useState({});                 // as on screen
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    axiosClient.get(endpoint)
      .then(({ data }) => {
        if (!alive) return;
        if (data?.status !== 'success') throw new Error(data?.result);
        setWidgets(data.widgets || []);
        setDesignations(data.designations || []);
        setDefaults(data.defaults || {});
        setSaved(data.result || {});
        setGrid(data.result || {});
      })
      .catch(() => openNotification('Error', `Could not load the ${what}.`, 'red'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpoint, what]);

  const has = (w, d) => (grid[w] || []).includes(d);
  // Kept in the server's designation order, so an unchanged grid compares equal.
  const toggle = (w, d, on) => setGrid((g) => ({
    ...g,
    [w]: designations.filter((x) => (x === d ? on : (g[w] || []).includes(x))),
  }));
  const column = (d) => widgets.every((w) => has(w.key, d));
  const toggleColumn = (d, on) => setGrid((g) => Object.fromEntries(widgets.map((w) => [
    w.key, designations.filter((x) => (x === d ? on : (g[w.key] || []).includes(x))),
  ])));

  const dirty = !same(grid, saved);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post(endpoint, { widgets: grid });
      if (data.status !== 'success') throw new Error(data.result);
      setSaved(data.result);
      setGrid(data.result);
      openNotification('Success', `${what[0].toUpperCase()}${what.slice(1)} saved.`, 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title={title}
      hint={hint}
      extra={!loading && (
        <Button size='small' disabled={same(grid, defaults)}
          onClick={() => setGrid(defaults)} title={defaultTip}>
          Back to the default
        </Button>
      )}
    >
      {loading ? <Spin /> : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className='dw-grid'>
              <thead>
                <tr>
                  <th className='dw-widget'>{rowHeader}</th>
                  {designations.map((d) => (
                    <th key={d}>
                      <div>{labelOf(d)}</div>
                      <Checkbox
                        aria-label={`${labelOf(d)}: every ${rowHeader.toLowerCase()}`}
                        checked={column(d)}
                        indeterminate={!column(d) && widgets.some((w) => has(w.key, d))}
                        onChange={(e) => toggleColumn(d, e.target.checked)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {widgets.map((w) => (
                  <tr key={w.key}>
                    <td className='dw-widget'>{w.label}{w.hint && <Hint text={w.hint} />}</td>
                    {designations.map((d) => (
                      <td key={d}>
                        <Checkbox
                          aria-label={`${w.label} - ${labelOf(d)}`}
                          checked={has(w.key, d)}
                          onChange={(e) => toggle(w.key, d, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type='button' className='btn-custom mt-3' onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </>
      )}
      <style jsx>{`
        .dw-grid { border-collapse: collapse; font-size: 13px; }
        .dw-grid th, .dw-grid td { padding: 8px 10px; text-align: center; border-bottom: 1px solid #f0f2f5; white-space: nowrap; }
        .dw-grid th { font-weight: 600; color: #4a5561; vertical-align: bottom; }
        .dw-grid th > div { margin-bottom: 4px; }
        .dw-grid .dw-widget { text-align: left; min-width: 200px; }
        .dw-grid tbody tr:hover td { background: #fafbfc; }
      `}</style>
    </Section>
  );
};

export default DesignationGrid;
