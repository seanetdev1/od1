import React, { useEffect, useState } from 'react';
import { Button, Radio, Spin, Table, Popconfirm } from 'antd';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SettingRow, SubHead } from './parts';

// Seanet: whether this install enforces access control, and what it has
// refused (or would have).
//
// Every request is checked against the permissions on the employee screen
// (backend functions/permissions). An install upgraded from before that
// starts in Audit: nothing is refused, but whatever WOULD have been is logged
// below. Grant what people turn out to need, clear the log, and switch to
// Enforce once it stays empty.
const MODES = [
  { value: 'audit', label: 'Audit', hint: 'Nothing is refused. What would have been is logged below.' },
  { value: 'enforce', label: 'Enforce', hint: 'Requests without the permission are refused.' },
];

const AccessControl = () => {
  const [mode, setMode] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [m, d] = await Promise.all([
        axiosClient.get('/settings/permissionsMode'),
        axiosClient.get('/settings/permissionDenials'),
      ]);
      setMode(m.data.mode);
      setRows(d.data.result || []);
    } catch (_) {
      openNotification('Error', 'Could not load access control.', 'red');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const changeMode = async (value) => {
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/settings/permissionsMode', { mode: value });
      setMode(data.mode);
      openNotification('Saved', `Access control is now ${data.mode === 'enforce' ? 'enforced' : 'in audit'}.`, 'green');
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not change the mode.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    await axiosClient.post('/settings/permissionDenials/clear');
    load();
  };

  if (loading && mode === null) return <Spin />;

  const columns = [
    { title: 'User', dataIndex: 'employee', render: (v, r) => v || r.EmployeeId },
    { title: 'Designation', dataIndex: 'designation' },
    { title: 'Request', render: (_, r) => <code>{r.method} {r.path}</code> },
    { title: 'Needs any of', dataIndex: 'required', render: (v) => <span style={{ fontSize: 12 }}>{v}</span> },
    { title: 'Times', dataIndex: 'count', align: 'right' },
    { title: 'Last', dataIndex: 'lastAt', render: (v) => moment(v).format('DD-MM-YY HH:mm') },
    { title: 'Mode', dataIndex: 'mode' },
  ];

  return (
    <Section title='Access Control'>
      <SettingRow
        label='Mode'
        hint={MODES.map((m) => `${m.label}: ${m.hint}`).join(' ')
          + ' Grant what people turn out to need, clear the log, and switch to Enforce once it stays empty.'}
      >
        <Radio.Group value={mode} onChange={(e) => changeMode(e.target.value)} disabled={saving}>
          {MODES.map((m) => <Radio.Button key={m.value} value={m.value}>{m.label}</Radio.Button>)}
        </Radio.Group>
      </SettingRow>

      <div className='d-flex justify-content-between align-items-center mt-4 mb-2'>
        <SubHead style={{ margin: 0, padding: 0, border: 0 }}
          hint={mode === 'enforce'
            ? 'Requests refused for want of a permission, newest last.'
            : 'Requests that went through, but would be refused once access control is enforced.'}>
          {mode === 'enforce' ? 'Refused requests' : 'Requests that would be refused'} ({rows.length})
        </SubHead>
        <span>
          <Button size='small' onClick={load} className='me-2'>Refresh</Button>
          <Popconfirm title='Clear the log?' onConfirm={clear}><Button size='small' danger>Clear</Button></Popconfirm>
        </span>
      </div>
      <Table size='small' rowKey='id' columns={columns} dataSource={rows} loading={loading}
        pagination={{ pageSize: 20 }} locale={{ emptyText: 'Nothing refused.' }} />
    </Section>
  );
};

export default AccessControl;
