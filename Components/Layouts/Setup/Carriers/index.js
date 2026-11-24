import React, { useEffect, useState } from 'react';
import { Select, Input, Tag, Spin, Checkbox, Tooltip } from 'antd';
import { Row, Col } from 'react-bootstrap';
import PopConfirm from 'Components/Shared/PopConfirm';
import openNotification from 'Components/Shared/Notification';
import { CARRIER_CATEGORIES, CATEGORY_COLOR } from 'functions/carrierCategory';
import { usePageActions } from 'Components/Shared/PageActions';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import axiosClient from 'apis/axiosClient';
import { getCarriers, saveCarrier, deleteCarrier, getAviationValues } from 'apis/aviationJobs';

// Setup > Carriers. Aviation only.
//
// A carrier is registered once and then picked per consignment. It holds three
// things a consignment must not carry itself:
//
//   prefix    the IATA 3-digit AWB prefix, which IS the carrier's code - there
//             is no separate one. An AWB is prefix + serial, so typing it per
//             consignment would let one carrier end up with two different
//             prefixes. It also labels the carrier in every dropdown, so a
//             user can find a carrier by prefix or by name.
//
//   category  GAM / IFA / Other - the tag the monthly sector report counts
//             uplift by. Tagging the carrier is what turned GAM Uplift, IFA
//             Loads and Other Carrier from typed figures into counted ones.
//
//             GAM WAS SPELLED 'ER' UNTIL 1.2.3. Nothing here knows that: the
//             server translates a carrier registered before the rename on the
//             way out, so this screen only ever sees the three current tags.
//             See the backend's functions/carrierCategory.js.
//
//   party     WHO THE CARRIER IS IN THE BOOKS. A charge is billed to a party,
//             never to a master - /makeInvoice resolves a charge's party to a
//             ledger account, so a carrier with no party is a carrier nothing
//             can be paid to. Registering the carrier and registering that
//             party are one act here, rather than a second trip to Setup >
//             Parties that only announces itself weeks later as an invoice
//             that will not raise.
// From functions/carrierCategory, not a copy: the consignment grid offers the
// same three as a per-AWB override, and two lists of one thing drift.
const CATEGORIES = CARRIER_CATEGORIES;
const EMPTY = {
  id: null, name: '', prefix: '', category: 'Other', active: true,
  // The party side of the form. createParty defaults ON: a carrier you cannot
  // pay is almost never what was wanted, so the useful thing happens unless
  // it is turned off.
  createParty: true, partyId: null, parentAccountId: null,
  // What the books call this carrier, when its short name is not it. Blank
  // means "same as the carrier name".
  partyName: '',
};

// The chart-of-accounts parent a carrier's ledger account is created under.
// ACCOUNT PAYABLE, not ACCOUNT RECEIVABLE (which is what Setup > Parties
// defaults to): an airline sells you space, so the balance normally owed runs
// the other way. Matched on title, the same way the party form finds its own
// default, and simply left unset if the install names its accounts otherwise.
const PREFERRED_PARENTS = ['ACCOUNT PAYABLE', 'ACCOUNTS PAYABLE'];

const Carriers = () => {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Existing parties, so a carrier that is ALREADY in the books can be linked
  // to the account it already has rather than given a second one.
  const [parties, setParties] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [defaultParent, setDefaultParent] = useState(null);
  const dispatch = useDispatch();

  const load = async () => {
    try {
      const res = await getCarriers();
      setRows(Array.isArray(res?.result) ? res.result : []);
    } catch (e) {
      openNotification('Error', 'Could not load carriers.', 'red');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    // The party list. getAviationValues already returns billable parties for
    // the flight screen, so this reuses it rather than adding an endpoint.
    getAviationValues()
      .then((res) => setParties(Array.isArray(res?.result?.party) ? res.result.party : []))
      .catch(() => setParties([]));

    // The chart-of-accounts parents a ledger account can hang off. Same
    // endpoint Setup > Parties uses, so the two offer the same choices.
    axiosClient
      .get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNTS_FOR_PARTY_SETUP, { headers: { id: '1' } })
      .then((x) => {
        const list = Array.isArray(x?.data?.result) ? x.data.result : [];
        setAccounts(list);
        const preferred = list.find((a) =>
          PREFERRED_PARENTS.includes(String(a.title || '').trim().toUpperCase()));
        if (preferred) {
          setDefaultParent(preferred.id);
          setForm((f) => (f.parentAccountId ? f : { ...f, parentAccountId: preferred.id }));
        }
      })
      .catch(() => setAccounts([]));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Open the party behind a carrier. Same tab key ('2-7', "Party") Setup >
  // Parties uses - MainLayout builds the tab's URL from it, so anything else
  // would open a tab that navigates nowhere.
  const openParty = (party) => {
    if (!party?.id) return;
    dispatch(incrementTab({ label: 'Party', key: '2-7', id: `${party.id}` }));
    Router.push(`/setup/client/${party.id}`);
  };

  // Editing starts from the carrier as saved, with the party controls put back
  // to their defaults - the parent account is only ever used to CREATE an
  // account, so carrying the last one typed into the next carrier would be
  // misleading rather than helpful.
  const edit = (row) => setForm({
    ...EMPTY,
    ...row,
    parentAccountId: defaultParent,
    // Open the party block for the two carriers that need attention: one with
    // no party at all, and one whose party has no ledger account. The second
    // is the fix path for the "No ledger" flag in the table - the party is
    // pre-selected, so picking a parent account is all that is left to do.
    createParty: !row.partyId || !row.hasLedger,
    partyId: row.partyId ?? null,
  });

  const submit = async () => {
    if (!form.name.trim()) {
      openNotification('Error', 'Carrier name is required.', 'red');
      return;
    }
    setSaving(true);
    try {
      const res = await saveCarrier(form);
      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not save.', 'red');
        return;
      }
      // Say what happened to the PARTY, not just the carrier. "Linked to the
      // existing PIA" and "created a new party PIA" are very different
      // outcomes for the books, and the difference is invisible otherwise.
      const p = res.party;
      const partyMsg = !p ? ''
        : p.action === 'created'
          ? ` A new party ${p.name} was created${p.ledgerCreated ? ' with a ledger account' : ''}.`
          : ` Linked to the existing party ${p.name}${p.ledgerCreated ? ', and given a ledger account' : ''}.`;
      openNotification('Success', form.name + ' saved.' + partyMsg, 'green');
      // A server-side caveat - most often "you may not create a ledger" - is
      // its own notification rather than a clause nobody reads.
      if (res.note) openNotification('Note', res.note, 'orange');
      setForm({ ...EMPTY, parentAccountId: defaultParent });
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
        const res = await deleteCarrier(row.id);
        // The server DEACTIVATES rather than deletes a carrier already used by
        // consignments, and says so - pass that message on rather than
        // reporting a delete that did not happen.
        openNotification('Done', res.result || 'Carrier removed.', 'green');
        if (form.id === row.id) setForm({ ...EMPTY, parentAccountId: defaultParent });
        load();
      } catch (e) {
        openNotification('Error', e?.response?.data?.result || 'Could not remove.', 'red');
      }
    });
  };

  /* Same shape as Setup > Aircraft: the form's Save is the page's Save, and
     the per-row Remove stays on its row. */
  usePageActions({
    title: 'Carriers',
    subtitle: form.id ? 'Editing a carrier' : undefined,
    new: {
      onClick: () => setForm({ ...EMPTY, parentAccountId: defaultParent }),
      label: 'New carrier',
      disabled: !form.id,
      title: form.id ? 'Clear the form and start a new carrier' : 'The form is already empty',
    },
    save: {
      onClick: submit,
      busy: saving,
      label: form.id ? 'Save changes' : 'Add carrier',
      title: form.id ? 'Save this carrier' : 'Add this carrier',
    },
  }, [saving, form.id]);

  return (
    <div className='base-page-layout carriers-page'>
      <div className='carrier-form'>
        <div className='fw-7 mb-2'>{form.id ? 'Edit carrier' : 'Add a carrier'}</div>
        <Row>
          <Col md={3} className='mb-2'>
            <div className='lbl'>Name *</div>
            <Input value={form.name} placeholder='PIA'
              onChange={(e) => set('name', e.target.value)} />
          </Col>
          <Col md={2} className='mb-2'>
            <div className='lbl'>AWB Prefix</div>
            <Input value={form.prefix} placeholder='214' maxLength={4}
              title='Unique - one prefix identifies one carrier'
              onChange={(e) => set('prefix', e.target.value.replace(/[^0-9]/g, ''))} />
          </Col>
          <Col md={3} className='mb-2'>
            <div className='lbl'>Reporting tag *</div>
            <Select style={{ width: '100%' }} value={form.category}
              onChange={(v) => set('category', v)}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Col>
        </Row>
        {/* THE PARTY. Separated from the fields above because it is a
            different kind of decision: those describe the airline, this
            decides how money moves. */}
        <div className='party-block'>
          <Checkbox
            checked={form.createParty}
            onChange={(e) => set('createParty', e.target.checked)}
          >
            <b>Register this carrier in the books</b>
            <span className='grey-txt fs-11'>
              {' '}— needed before anything can be billed to or paid to it
            </span>
          </Checkbox>

          {form.createParty && (
            <Row className='mt-2'>
              <Col md={4} className='mb-2'>
                <div className='lbl'>Existing party</div>
                <Select
                  style={{ width: '100%' }}
                  value={form.partyId ?? undefined}
                  allowClear showSearch optionFilterProp='label'
                  placeholder='Create a new one'
                  onChange={(v) => set('partyId', v ?? null)}
                  options={parties.map((p) => ({ value: p.id, label: p.name }))}
                />
              </Col>
              {/* Only when a party is being CREATED. Linking an existing one
                  must never rename it - its name is on every invoice already
                  raised against it, and this is not the screen to change
                  that. */}
              <Col md={4} className='mb-2'>
                <div className='lbl'>
                  Party name
                  {form.partyId && <span className='grey-txt'> — set on the party itself</span>}
                </div>
                <Input
                  value={form.partyId ? '' : form.partyName}
                  disabled={Boolean(form.partyId)}
                  placeholder={form.name.trim() || 'Same as the carrier name'}
                  onChange={(e) => set('partyName', e.target.value)}
                />
              </Col>
              <Col md={4} className='mb-2'>
                <div className='lbl'>Parent account</div>
                <Select
                  style={{ width: '100%' }}
                  value={form.parentAccountId ?? undefined}
                  allowClear showSearch optionFilterProp='label'
                  placeholder='No ledger account'
                  onChange={(v) => set('parentAccountId', v ?? null)}
                  options={accounts.map((a) => ({ value: a.id, label: a.title }))}
                />
              </Col>
              <Col md={12}>
                <div className='hint mb-1'>
                  The carrier is known by its short name; the books usually want the full
                  one — <b>PIA</b> the carrier, <b>Pakistan International Airlines</b> the
                  party. Leave <b>Party name</b> blank to use the carrier name. Either way,
                  if a party of that name already exists it is linked rather than duplicated —
                  a second one would split its ledger history across two accounts.
                </div>
              </Col>
            </Row>
          )}
        </div>

        <div className='hint'>
          The <b>prefix</b> is unique — one prefix identifies one carrier, and it is what
          the consignment dropdown is searched by. The <b>reporting tag</b> decides which
          column of the monthly sector report this carrier&apos;s cargo counts toward:
          GAM Uplift, IFA Loads or Other Carrier.
        </div>
      </div>

      {loading ? <div className='text-center py-5'><Spin /></div> : (
        <table className='carrier-table mt-3'>
          <thead>
            <tr>
              <th>Prefix</th>
              <th>Name</th>
              <th>Reporting tag</th>
              <th>Billed as</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'inactive'}>
                <td className='mono'><b>{r.prefix || '—'}</b></td>
                <td>{r.name}</td>
                <td><Tag color={CATEGORY_COLOR[r.category] || 'default'}>{r.category}</Tag></td>
                {/* Three states, and the difference between the last two
                    matters: a party with no ledger account looks connected but
                    fails at the moment of invoicing, which is the worst time
                    to find out. */}
                <td>
                  {!r.party ? (
                    <Tooltip title='Nothing can be billed to or paid to this carrier until it has a party. Edit it and tick "Register this carrier in the books".'>
                      <Tag color='orange'>Not in the books</Tag>
                    </Tooltip>
                  ) : (
                    <>
                      {/* A quick link to the party itself. Registers the tab
                          the way Setup > Parties does, so it opens as a real
                          tab rather than a dead-end page load. */}
                      <a className='party-link' onClick={() => openParty(r.party)}>
                        {r.party.name}
                      </a>
                      {r.party.code && <span className='grey-txt fs-11'> ({r.party.code})</span>}
                      {!r.hasLedger && (
                        <Tooltip title='The party exists but has no ledger account, so an invoice raised against it would post nowhere. Edit the carrier and pick a parent account.'>
                          <Tag color='red' className='ms-2'>No ledger</Tag>
                        </Tooltip>
                      )}
                    </>
                  )}
                </td>
                <td>{r.active ? <Tag color='green'>Active</Tag> : <Tag>Inactive</Tag>}</td>
                <td className='text-end'>
                  <a onClick={() => edit(r)}>Edit</a>
                  <a className='danger' onClick={() => remove(r)}>Remove</a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className='text-center grey-txt py-4'>
                No carriers yet. Add the airlines whose cargo you fly.
              </td></tr>
            )}
          </tbody>
        </table>
      )}

      <style jsx global>{`
        .carriers-page .carrier-form {
          border: 1px solid #e6eef5;
          background: #f6f9fc;
          border-radius: 6px;
          padding: 12px 14px 6px;
        }
        .carriers-page .lbl { font-size: 11px; color: #8a97a3; margin-bottom: 2px; }
        /* The books side of the form, set off from the fields that merely
           describe the airline. */
        .carriers-page .party-block {
          margin-top: 4px;
          padding: 8px 10px 2px;
          background: #fff;
          border: 1px solid #e6eef5;
          border-radius: 5px;
        }
        .carriers-page .party-block .hint { margin-top: 0; line-height: 1.5; }
        /* The link to the party itself - in the table's own link colour, but
           inline rather than in the actions column. */
        .carriers-page .carrier-table a.party-link { margin-left: 0; }
        .carriers-page .hint { font-size: 11px; color: #8a97a3; margin-top: 4px; }
        .carriers-page .carrier-table { width: 100%; font-size: 13px; }
        .carriers-page .carrier-table th {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          border-bottom: 1px solid #eee;
          padding: 4px 8px;
        }
        .carriers-page .carrier-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #f5f5f5;
          vertical-align: middle;
        }
        .carriers-page .carrier-table tr.inactive td { opacity: 0.5; }
        .carriers-page .carrier-table .mono { font-variant-numeric: tabular-nums; }
        .carriers-page .carrier-table a { cursor: pointer; margin-left: 12px; }
        .carriers-page .carrier-table a.danger { color: #cf1322; }
      `}</style>
    </div>
  );
};

export default Carriers;
