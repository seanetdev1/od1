import React, { useEffect, useMemo, useState } from 'react';
import { Input, Select, InputNumber, Switch, Empty, Spin, Tag } from 'antd';
import { Row, Col } from 'react-bootstrap';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import RowAction from 'Components/Shared/RowAction';
import { usePageActions } from 'Components/Shared/PageActions';
import { getCustomsValues } from 'apis/customsJobs';

/**
 * Setup > Charge Groups.
 *
 * A group is a named set of default charges for a kind of client: the parties
 * it applies to, and the receivable and payable lines a job's charge sheet
 * imports in one click. A clearing agent bills the same dozen heads to the
 * same client over and over, and the retyping is where a head gets missed - a
 * missed payable is profit the file never shows.
 *
 * THE PARTY IS NOT SET HERE, on purpose. Each charge already knows whose it is
 * through the master's default receivable / payable role, which resolves
 * against the JOB's own client, shipping line or transporter. An imported line
 * fills its party exactly as a hand-added one does, so a party stored here
 * would be the same fact twice - and would disagree the first time a client
 * changed on a job.
 *
 * A PARTY MAY BE IN SEVERAL GROUPS. The same client genuinely buys two
 * different services; the job's import button asks which set to bring when
 * that happens rather than merging two tariffs into a sheet matching neither.
 */
/* THE APP'S OWN SPELLINGS, imported rather than retyped.
 *
 * Charge_Head.type holds 'Recievable' and 'Payble' - both misspelled, both
 * load-bearing, and every row in the book carries them. A group storing a
 * tidied 'Receivable' would import lines onto a side the charge sheet does not
 * recognise, and they would show on neither. The basis is spelled 'Per
 * Shipment' for the same reason; 'P/Shpt' is only what the column header
 * says. */
import { RECEIVABLE, PAYABLE, PER_UNIT, PER_SHIPMENT } from 'functions/customsPricing';
import CompanyVisibility from 'Components/Shared/CompanyVisibility';

const BASES = [PER_UNIT, PER_SHIPMENT];

// What each side is CALLED, as against what it is stored as.
const SIDE_LABEL = { [RECEIVABLE]: 'Receivable', [PAYABLE]: 'Payable' };

const EMPTY_GROUP = {
  id: null, name: '', description: '', active: true, parties: [], lines: [],
};

const blankLine = (type) => ({
  type, charge: null, particular: '', description: '',
  basis: PER_SHIPMENT, qty: null, rate_charge: null, currency: null,
});

const ChargeGroups = () => {
  const [groups, setGroups] = useState([]);
  const [form, setForm] = useState(EMPTY_GROUP);
  const [charges, setCharges] = useState([]);
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axiosClient.get('/customsChargeGroups');
      setGroups(data.result || []);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not read the groups.', 'red');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    /* The charge master and the party list, from the SAME endpoint the job's
       charge sheet reads - so a head named here is the head that lands there,
       and a party offered here is one a charge can actually be billed to.
       `party` is the unfiltered list on purpose: a group's client need not be
       tagged as anything in particular. */
    getCustomsValues()
      .then((v) => {
        setCharges(v?.result?.charge || []);
        setParties(v?.result?.party || []);
      })
      .catch(() => openNotification('Error', 'Could not read the charge and party lists.', 'red'));
  }, []);

  const editing = Boolean(form.id);

  const save = async () => {
    if (!String(form.name || '').trim()) {
      openNotification('Not saved', 'A group needs a name.', 'red');
      return;
    }
    setSaving(true);
    try {
      const { data } = await axiosClient.post('/customsChargeGroups/save', { data: form });
      if (data.status !== 'success') {
        openNotification('Not saved', data.result || 'Could not save.', 'red');
        return;
      }
      openNotification('Saved', `${data.result.name} saved.`, 'green');
      setForm(EMPTY_GROUP);
      load();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (group) => {
    try {
      await axiosClient.post('/customsChargeGroups/delete', { id: group.id });
      openNotification('Deleted', `${group.name} deleted.`, 'green');
      if (form.id === group.id) setForm(EMPTY_GROUP);
      load();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not delete.', 'red');
    }
  };

  // The server sends the children under their model names; the form works in
  // plain `parties` and `lines`, which is also what /save expects back.
  const edit = (g) => setForm({
    id: g.id,
    name: g.name || '',
    description: g.description || '',
    active: g.active !== false,
    parties: (g.Customs_Charge_Group_Parties || []).map((p) => ({
      partyId: String(p.partyId), partyName: p.partyName || '',
    })),
    lines: (g.Customs_Charge_Group_Lines || []).map((l) => ({
      type: l.type, charge: l.charge, particular: l.particular || '',
      description: l.description || '', basis: l.basis || PER_SHIPMENT,
      qty: l.qty, rate_charge: l.rate_charge, currency: l.currency,
    })),
  });

  usePageActions({
    title: 'Charge Groups',
    subtitle: editing ? `Editing ${form.name || 'a group'}` : undefined,
    new: {
      onClick: () => setForm(EMPTY_GROUP),
      label: 'New group',
      disabled: !editing && !form.name && !form.lines.length,
      title: 'Clear the form and start a new group',
    },
    save: {
      onClick: save,
      busy: saving,
      label: editing ? 'Save changes' : 'Add group',
    },
  }, [editing, form.name, form.lines.length, saving]);

  const partyOptions = useMemo(
    () => (parties || []).map((p) => ({ value: String(p.id), label: p.name })),
    [parties],
  );
  /* Code, short name and full name, the way the job's charge picker shows
     them: two heads can read identically on any one of the three, and this is
     the list somebody is choosing a tariff from. */
  const chargeOptions = useMemo(
    () => (charges || []).map((c) => ({
      value: String(c.id),
      label: [c.code, c.short, c.fullName].filter(Boolean).join(' · ') || String(c.id),
    })),
    [charges],
  );

  const setLine = (index, patch) => setForm((f) => ({
    ...f,
    lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
  }));

  const addLine = (type) => setForm((f) => ({ ...f, lines: [...f.lines, blankLine(type)] }));
  const dropLine = (index) => setForm((f) => ({
    ...f, lines: f.lines.filter((_, i) => i !== index),
  }));

  const section = (type) => {
    const rows = form.lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.type === type);

    return (
      <div className={`cg-section ${type === RECEIVABLE ? 'is-rec' : 'is-pay'}`}>
        <div className='cg-section-bar'>
          {/* The stored value is 'Recievable' / 'Payble' - misspelled and
              load-bearing, since every charge row in the book carries it. What
              is READ says the word properly; only the data keeps the typo. */}
          <b>{SIDE_LABEL[type] || type}</b>
          <span className='grey-txt'>{rows.length} line{rows.length === 1 ? '' : 's'}</span>
          <button type='button' className='btn-custom fw-8 cg-add' onClick={() => addLine(type)}>
            <PlusOutlined /> Add
          </button>
        </div>

        {rows.length === 0 ? (
          <div className='cg-empty'>
            No default {(SIDE_LABEL[type] || type).toLowerCase()} charges yet.
          </div>
        ) : (
          <table className='cg-table'>
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Charge *</th><th>Description</th><th>Basis</th>
                <th className='num'>Qty</th><th className='num'>Rate</th>
                <th>Currency</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, i }) => (
                <tr key={i}>
                  <td>
                    <Select
                      size='small' showSearch allowClear style={{ width: '100%' }}
                      optionFilterProp='label' placeholder='Pick a charge'
                      value={l.charge ? String(l.charge) : undefined}
                      options={chargeOptions}
                      onChange={(v) => setLine(i, { charge: v ?? null })}
                    />
                  </td>
                  <td>
                    <Input size='small' value={l.description}
                      onChange={(e) => setLine(i, { description: e.target.value })} />
                  </td>
                  <td>
                    <Select size='small' style={{ width: '100%' }} value={l.basis}
                      options={BASES.map((b) => ({ value: b, label: b }))}
                      onChange={(v) => setLine(i, { basis: v })} />
                  </td>
                  <td className='num'>
                    {/* Blank, not 0. A group that says nothing about the rate
                        is asking for it to be typed per job; a 0 reads as
                        free, and free is a decision. */}
                    <InputNumber size='small' controls={false} style={{ width: '100%' }}
                      placeholder='—' value={l.qty}
                      onChange={(v) => setLine(i, { qty: v })} />
                  </td>
                  <td className='num'>
                    <InputNumber size='small' controls={false} style={{ width: '100%' }}
                      placeholder='—' step={0.01} value={l.rate_charge}
                      onChange={(v) => setLine(i, { rate_charge: v })} />
                  </td>
                  <td>
                    {/* Empty means the charge's own currency, from Setup >
                        Charges - which is what an imported line then takes.
                        The placeholder read "PKR", so an empty box looked set. */}
                    <Input size='small' placeholder="Charge's" value={l.currency || ''}
                      title="Leave empty to use the charge's own currency (Setup > Charges)"
                      onChange={(e) => setLine(i, { currency: e.target.value.trim().toUpperCase() || null })} />
                  </td>
                  <td className='text-center'>
                    <RowAction Icon={DeleteOutlined} label='Remove' kind='danger'
                      onClick={() => dropLine(i)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  return (
    <div className='base-page-layout charge-groups'>
      <div className='cg-form'>
        <div className='fw-7 mb-2'>{editing ? 'Edit group' : 'Add a group'}</div>
        {editing && <CompanyVisibility table='chargeGroups' recordId={form.id} style={{ maxWidth: 420, marginBottom: 8 }} />}
        <Row>
          <Col md={3} className='mb-2'>
            <div className='lbl'>Name *</div>
            <Input value={form.name} placeholder='Standard Importers'
              onChange={(e) => set('name', e.target.value)} />
          </Col>
          <Col md={5} className='mb-2'>
            <div className='lbl'>What it is for</div>
            <Input value={form.description} placeholder='Container importers on standard terms'
              onChange={(e) => set('description', e.target.value)} />
          </Col>
          <Col md={2} className='mb-2'>
            <div className='lbl'>Active</div>
            <div style={{ paddingTop: 4 }}>
              <Switch checked={form.active} onChange={(v) => set('active', v)} />
              <span className='grey-txt fs-12' style={{ marginLeft: 8 }}>
                {form.active ? 'Offered on jobs' : 'Archived'}
              </span>
            </div>
          </Col>
        </Row>

        <Row>
          <Col md={10} className='mb-2'>
            <div className='lbl'>Parties in this group</div>
            <Select
              mode='multiple' allowClear showSearch style={{ width: '100%' }}
              optionFilterProp='label' placeholder='The clients these defaults apply to'
              value={form.parties.map((p) => p.partyId)}
              options={partyOptions}
              onChange={(ids) => set('parties', ids.map((id) => ({
                partyId: String(id),
                partyName: partyOptions.find((o) => o.value === String(id))?.label || '',
              })))}
            />
            <div className='hint'>
              A party can be in more than one group. When it is, the job&apos;s charge sheet
              asks which set to bring in.
            </div>
          </Col>
        </Row>

        {section(RECEIVABLE)}
        {section(PAYABLE)}
      </div>

      <div className='fw-7 mt-4 mb-2'>Groups</div>
      {loading ? <div className='text-center py-4'><Spin /></div> : !groups.length ? (
        <Empty description='No charge groups yet.' />
      ) : (
        <table className='cg-list'>
          <thead>
            <tr>
              <th>Name</th><th>For</th><th className='num'>Parties</th>
              <th className='num'>Receivable</th><th className='num'>Payable</th>
              <th></th><th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const lines = g.Customs_Charge_Group_Lines || [];
              return (
                <tr key={g.id} className={g.active === false ? 'is-archived' : ''}>
                  <td>
                    <b>{g.name}</b>
                    {g.active === false && <Tag className='mx-2'>Archived</Tag>}
                  </td>
                  <td className='grey-txt'>{g.description || '—'}</td>
                  <td className='num'>{(g.Customs_Charge_Group_Parties || []).length}</td>
                  <td className='num'>{lines.filter((l) => l.type === RECEIVABLE).length}</td>
                  <td className='num'>{lines.filter((l) => l.type === PAYABLE).length}</td>
                  <td className='text-center'>
                    <RowAction Icon={PlusOutlined} label='Edit' kind='primary'
                      onClick={() => edit(g)} />
                  </td>
                  <td className='text-center'>
                    <RowAction
                      Icon={DeleteOutlined} label='Delete' kind='danger'
                      confirm={{
                        what: 'charge group', name: g.name,
                        body: 'Charges already imported onto jobs are not affected.',
                      }}
                      onClick={() => remove(g)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <style jsx global>{`
        .charge-groups .lbl {
          font-size: 11px; color: #8a97a3; margin-bottom: 3px;
          text-transform: uppercase; letter-spacing: 0.03em;
        }
        .charge-groups .hint { font-size: 11px; color: #8a97a3; margin-top: 4px; }
        .charge-groups .cg-form {
          background: #fff; border: 1px solid #e9edf2; border-radius: 8px;
          padding: 16px; margin-bottom: 8px;
        }
        .charge-groups .cg-section { margin-top: 14px; border-radius: 6px; overflow: hidden; }
        .charge-groups .cg-section.is-rec { border-left: 3px solid #2f855a; }
        .charge-groups .cg-section.is-pay { border-left: 3px solid #c05621; }
        .charge-groups .cg-section-bar {
          display: flex; align-items: center; gap: 10px;
          padding: 6px 10px; background: #f7f9fb;
        }
        .charge-groups .cg-add { font-size: 11px; padding: 2px 10px; }
        .charge-groups .cg-empty { padding: 10px; font-size: 12px; color: #8a97a3; }
        .charge-groups .cg-table, .charge-groups .cg-list {
          width: 100%; font-size: 12px; background: #fff;
        }
        .charge-groups .cg-table th, .charge-groups .cg-list th {
          font-weight: 600; color: #5f6b7a; padding: 6px 6px;
          border-bottom: 1px solid #e9edf2; text-align: left;
        }
        .charge-groups .cg-table td, .charge-groups .cg-list td {
          padding: 4px 6px; border-bottom: 1px solid #f4f6f8; vertical-align: middle;
        }
        .charge-groups .num { text-align: right; }
        .charge-groups th.num { text-align: right; }
        .charge-groups .cg-list tr.is-archived td { color: #9aa4b0; }
      `}</style>
    </div>
  );
};

export default ChargeGroups;
