import React, { useEffect, useState } from 'react';
import { Input, InputNumber, Tag, Spin } from 'antd';
import { Row, Col } from 'react-bootstrap';
import PopConfirm from 'Components/Shared/PopConfirm';
import openNotification from 'Components/Shared/Notification';
import { getAircraft, saveAircraft, deleteAircraft } from 'apis/aviationJobs';
import { usePageActions } from 'Components/Shared/PageActions';

// Setup > Aircraft. Aviation only.
//
// Registered once, then picked on a flight instead of typing the type in.
// The monthly sector report splits every sector by aircraft - LHE-DXB 737 and
// LHE-DXB A330 are separate sheets - so the value has to come from a known
// set. Typed by hand, "A330", "A-330" and "a330" each became their own row.
//
// `name` is what the report groups and labels by, which is why it is unique.
const EMPTY = { id: null, name: '', description: '', maxPayload: null, active: true };

const Aircraft = () => {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await getAircraft();
      setRows(Array.isArray(res?.result) ? res.result : []);
    } catch (e) {
      openNotification('Error', 'Could not load aircraft.', 'red');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) {
      openNotification('Error', 'Aircraft name is required.', 'red');
      return;
    }
    setSaving(true);
    try {
      const res = await saveAircraft(form);
      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not save.', 'red');
        return;
      }
      openNotification('Success', form.name + ' saved.', 'green');
      setForm(EMPTY);
      load();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const remove = (row) => {
    PopConfirm('Confirmation', 'Remove ' + row.name + '?', async () => {
      try {
        const res = await deleteAircraft(row.id);
        // The server DEACTIVATES rather than deletes one already flown, and
        // says which happened - pass that on rather than claiming a delete.
        openNotification('Done', res.result || 'Aircraft removed.', 'green');
        if (form.id === row.id) setForm(EMPTY);
        load();
      } catch (e) {
        openNotification('Error', e?.response?.data?.result || 'Could not remove.', 'red');
      }
    });
  };

  const fmt = (n) =>
    n === null || n === undefined || n === ''
      ? '—'
      : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });

  /* Save sits in the toolbar with every other page's Save. The per-row Remove
     stays ON THE ROW: the Delete slot acts on the page's subject, and a list
     of aircraft has no single one - a toolbar Delete here could only mean
     "whichever row you last looked at", which is how the wrong master record
     gets removed. */
  usePageActions({
    title: 'Aircraft',
    subtitle: form.id ? 'Editing an aircraft' : undefined,
    new: {
      onClick: () => setForm(EMPTY),
      label: 'New aircraft',
      disabled: !form.id,
      title: form.id ? 'Clear the form and start a new aircraft' : 'The form is already empty',
    },
    save: {
      onClick: submit,
      busy: saving,
      label: form.id ? 'Save changes' : 'Add aircraft',
      title: form.id ? 'Save this aircraft' : 'Add this aircraft',
    },
  }, [saving, form.id]);

  return (
    <div className='base-page-layout aircraft-page'>
      <div className='aircraft-form'>
        <div className='fw-7 mb-2'>{form.id ? 'Edit aircraft' : 'Add an aircraft'}</div>
        <Row>
          <Col md={2} className='mb-2'>
            <div className='lbl'>Name *</div>
            <Input value={form.name} placeholder='A330'
              title='What the report groups and labels by — must be unique'
              onChange={(e) => set('name', e.target.value)} />
          </Col>
          <Col md={4} className='mb-2'>
            <div className='lbl'>Description</div>
            <Input value={form.description} placeholder='Airbus A330-200F'
              onChange={(e) => set('description', e.target.value)} />
          </Col>
          <Col md={2} className='mb-2'>
            <div className='lbl'>Max payload (kg)</div>
            <InputNumber controls={false} style={{ width: '100%' }} step={100}
              value={form.maxPayload} placeholder='65000'
              onChange={(v) => set('maxPayload', v)} />
          </Col>
        </Row>
        <div className='hint'>
          <b>Name</b> is what a flight shows and what the monthly report groups by, so keep it
          short and consistent — <b>A330</b>, <b>B737</b>. It must be unique.
        </div>
      </div>

      {loading ? <div className='text-center py-5'><Spin /></div> : (
        <table className='aircraft-table mt-3'>
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th className='num'>Max payload</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'inactive'}>
                <td><b>{r.name}</b></td>
                <td>{r.description || '—'}</td>
                <td className='num'>{fmt(r.maxPayload)}</td>
                <td>{r.active ? <Tag color='green'>Active</Tag> : <Tag>Inactive</Tag>}</td>
                <td className='text-end'>
                  <a onClick={() => setForm({ ...EMPTY, ...r })}>Edit</a>
                  <a className='danger' onClick={() => remove(r)}>Remove</a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className='text-center grey-txt py-4'>
                No aircraft yet. Add the types you fly, e.g. A330 and B737.
              </td></tr>
            )}
          </tbody>
        </table>
      )}

      <style jsx global>{`
        .aircraft-page .aircraft-form {
          border: 1px solid #e6eef5;
          background: #f6f9fc;
          border-radius: 6px;
          padding: 12px 14px 6px;
        }
        .aircraft-page .lbl { font-size: 11px; color: #8a97a3; margin-bottom: 2px; }
        .aircraft-page .hint { font-size: 11px; color: #8a97a3; margin-top: 4px; }
        .aircraft-page .aircraft-table { width: 100%; font-size: 13px; }
        .aircraft-page .aircraft-table th {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          border-bottom: 1px solid #eee;
          padding: 4px 8px;
        }
        .aircraft-page .aircraft-table th.num,
        .aircraft-page .aircraft-table td.num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .aircraft-page .aircraft-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #f5f5f5;
          vertical-align: middle;
        }
        .aircraft-page .aircraft-table tr.inactive td { opacity: 0.5; }
        .aircraft-page .aircraft-table a { cursor: pointer; margin-left: 12px; }
        .aircraft-page .aircraft-table a.danger { color: #cf1322; }
      `}</style>
    </div>
  );
};

export default Aircraft;
