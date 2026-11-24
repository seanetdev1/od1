import React from 'react';
import { Modal, Input, Select, Form, Alert, Checkbox } from 'antd';
import Cookies from 'js-cookie';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { registerAwbs } from 'apis/awbStock';
import { CARRIER_CATEGORIES } from 'functions/carrierCategory';
import { saveCarrier } from 'apis/aviationJobs';
import { createAirport } from 'apis/pickLists';
// The IATA numbering rules, shared with Setup > AWB Stock so a number
// registered from here is checked exactly as one registered there is.
import { previewSeries } from 'functions/awbNumber';
// Whether this user's designation may give a party a LEDGER. Mirrors
// requireDesignation on the backend, which is what actually enforces it.
import { checkPartyCreateAccess } from 'functions/checkPartyCreateAccess';

/* -------------------- registering a master from the job ------------------
 * A flight is entered against paperwork that has already happened. The AWB in
 * front of the operator names a carrier, a master agent, a commodity or a
 * number that nobody has put in Setup yet, and the consignment cannot be saved
 * without any of them - so without this the flight is abandoned half-typed,
 * someone opens Setup in another tab, and the grid is filled in again from the
 * beginning.
 *
 * So the four columns that need it register their master FROM the grid: click
 * the column heading, fill in the fields that matter, and the new record is in
 * that column's dropdown on every row, ready to pick.
 *
 * IT IS NOT SELECTED ANYWHERE. The heading belongs to the column, not to a
 * row, so there is no row this could mean - and picking one for the user
 * (the first blank? the last touched?) would quietly put a party on a
 * consignment nobody chose it for.
 *
 * DELIBERATELY THE SHORT FORM. These write the same rows as Setup > Commodity
 * and Setup > Parties through the same endpoints, but ask only for what a
 * consignment actually needs. Everything else keeps the master screens'
 * defaults, and the record can be completed there afterwards - which is the
 * right trade when the alternative is the full party form, on eight tabs,
 * opened in the middle of typing a flight.
 *
 * A MASTER AGENT REGISTERED HERE GETS A LEDGER, and will not be offered
 * without one.
 *
 * That is not a nicety. /aviationJob/getValues builds every party list -
 * shipper, consignee, master agent - out of `billable`, which excludes non-GL
 * parties, so a name-only party registered here would be selected once and
 * then VANISH from the column the next time the flight was opened, taking the
 * consignment's master agent with it. A quick registration that silently
 * un-registers itself on reload is worse than no button at all.
 *
 * So the ledger is created under the parent configured in Config > Party
 * Accounts (`receivable` - a master agent is billed, so it is a customer), and
 * where that is not configured, or the user's designation may not give a party
 * a ledger, THE BUTTON SAYS SO AND REFUSES rather than writing a party that
 * cannot be used. Both rules are the backend's own: /createClient strips
 * pAccountName from anyone outside CEO/CFO/admin (see canCreateLedger), and
 * without it there is no ledger.
 *
 * A CARRIER'S party is a different case and is NOT refused - the carrier list
 * is not filtered by it, so the carrier is usable at once and its party can be
 * given a ledger later. See CarrierModal.
 * ---------------------------------------------------------------------- */

// Both endpoints are absolute URLs held in .env, the way every other master
// save in the app names them. Posted through axiosClient so the token and the
// logout interceptor apply.
const CREATE_COMMODITY = process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_COMMODITY;
const CREATE_CLIENT = process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_CLIENT;

const trim = (v) => String(v ?? '').trim();

/**
 * A failed request's message, when it HAS one.
 *
 * Several of these Setup endpoints answer a 500 with `result: error` - the
 * Sequelize error object itself, not a string. Passing that straight to a
 * notification renders an object as a React child, which throws and replaces
 * "could not save" with a blank screen. So only a string is ever used, and
 * anything else falls back to the caller's own wording.
 */
const errText = (e, fallback) => {
  const r = e?.response?.data?.result;
  return typeof r === 'string' && r.trim() ? r : fallback;
};

// The chart-of-accounts parents a carrier's ledger hangs off. Copied from
// Setup > Carriers deliberately: the titles are matched case-insensitively and
// simply left unset on an install that names its accounts otherwise.
//
// The reporting tags are NOT copied - they come from functions/carrierCategory,
// which is the one list every screen that offers them reads.
const CARRIER_PARENTS = ['ACCOUNT PAYABLE', 'ACCOUNTS PAYABLE'];

/**
 * Quick-register a commodity.
 *
 * `onCreated` is handed the saved row so the caller can put it in the list and
 * select it. The dialog closes only on success - one that shut on a failed
 * save would take the typing with it.
 */
export const CommodityModal = ({ open, onClose, onCreated }) => {
  const [name, setName] = React.useState('');
  const [hs, setHs] = React.useState('');
  const [cargoType, setCargoType] = React.useState('');
  const [commodityType, setCommodityType] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  // Cleared as it OPENS, not as it closes: clearing on the way out would blank
  // the fields while the dialog is still fading.
  React.useEffect(() => {
    if (!open) return;
    setName('');
    setHs('');
    setCargoType('');
    setCommodityType('');
  }, [open]);

  const save = async () => {
    if (!trim(name)) {
      openNotification('Name is required', 'A commodity needs a name.', 'orange');
      return;
    }
    setSaving(true);
    try {
      const res = await axiosClient.post(CREATE_COMMODITY, {
        // The same shape Setup > Commodity posts. isHazmat is an ARRAY there -
        // the route counts its length to decide 0/1 - so an empty one is how
        // "not hazmat" is said, and leaving it out would take the route down.
        data: {
          name: trim(name),
          hs: trim(hs),
          cargoType,
          commodityGroup: '',
          commodityType,
          active: '',
          isHazmat: [],
          packageGroup: '',
          hazmatCode: '',
          hazmatClass: '',
          chemicalName: '',
          unoCode: '',
        },
        employeeId: Cookies.get('loginId'),
      });
      if (res?.data?.status !== 'success') {
        openNotification('Error', 'The commodity could not be registered.', 'red');
        return;
      }
      openNotification('Success', `${res.data.result.name} registered.`, 'green');
      onCreated(res.data.result);
      onClose();
    } catch (e) {
      openNotification(
        'Error',
        errText(e, 'The commodity could not be registered.'),
        'red'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title='Register a commodity'
      open={open}
      onCancel={saving ? undefined : onClose}
      onOk={save}
      okText='Register'
      confirmLoading={saving}
      destroyOnClose
      width={460}
    >
      <Form layout='vertical' size='small'>
        <Form.Item label='Name' required>
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onPressEnter={save} placeholder='As it is described on the air waybill' />
        </Form.Item>
        <Form.Item label='HS Code'>
          <Input value={hs} onChange={(e) => setHs(e.target.value)} onPressEnter={save} />
        </Form.Item>
        <Form.Item label='Cargo Type'>
          <Select value={cargoType || undefined} allowClear placeholder='Cargo type'
            onChange={(v) => setCargoType(v ?? '')}
            options={[{ value: 'GL', label: 'GL' }, { value: 'CAR', label: 'CAR' }]} />
        </Form.Item>
        {/* Descriptive: how the cargo has to be handled. It no longer decides
            whether an offloaded AWB is still outstanding - that is the Close
            AWB box on the consignment. */}
        <Form.Item label='Perishable / Dry'>
          <Select value={commodityType || undefined} allowClear placeholder='Dry'
            onChange={(v) => setCommodityType(v ?? '')}
            options={[{ value: 'Dry', label: 'Dry' }, { value: 'Perishable', label: 'Perishable' }]} />
        </Form.Item>
        <div className='grey-txt fs-12'>
          Registered with these details alone. The rest — hazmat, packaging,
          commodity group — can be filled in afterwards under Setup &gt; Commodity.
        </div>
      </Form>
    </Modal>
  );
};

/**
 * Quick-register a party of one type - here, a master agent.
 *
 * `type` is what the party is tagged as, and is what /aviationJob/getValues
 * filters its per-role lists on, so it has to be one of AVIATION_PARTY_TYPES
 * spelled exactly as that list spells it.
 */
export const PartyModal = ({ open, onClose, onCreated, type = 'Master Agent' }) => {
  const [name, setName] = React.useState('');
  const [city, setCity] = React.useState('');
  const [address1, setAddress1] = React.useState('');
  const [mobile1, setMobile1] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  // The parent account a new party's ledger is created under, from Config >
  // Party Accounts. `undefined` while it is being read, so the dialog does not
  // flash a refusal at an install that is perfectly well configured.
  const [parent, setParent] = React.useState(undefined);

  // Only this designation may give a party a ledger, and a party without one
  // is not offered on a consignment - see the note at the top of this file.
  const mayGiveLedger = checkPartyCreateAccess();

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setCity('');
    setAddress1('');
    setMobile1('');
    setParent(undefined);
    let alive = true;
    // Never fatal: an unreadable setting means the same as an unconfigured
    // one, which the dialog already explains rather than failing on.
    axiosClient.get('/settings/partyAccounts')
      .then((r) => { if (alive) setParent(r?.data?.result?.receivable || null); })
      .catch(() => { if (alive) setParent(null); });
    return () => { alive = false; };
  }, [open]);

  // Why this cannot be used here, in the words the user needs to act on. Null
  // while the setting is still being read - there is nothing to say yet.
  const blocked = !mayGiveLedger
    ? `Only CEO, CFO or admin can give a party a ledger, and a ${type.toLowerCase()} ` +
      'without one is not offered on a consignment. Ask accounts to register it ' +
      'under Setup > Parties.'
    : parent === null
      ? 'No receivable parent account is configured, so the ledger this party ' +
        'needs cannot be created. Set one under Config > Party Accounts, or ' +
        'register the party under Setup > Parties.'
      : '';

  const save = async () => {
    if (blocked) return;
    if (!trim(name)) {
      openNotification('Name is required', `A ${type.toLowerCase()} needs a name.`, 'orange');
      return;
    }
    setSaving(true);
    try {
      const res = await axiosClient.post(CREATE_CLIENT, {
        name: trim(name),
        city: trim(city),
        address1: trim(address1),
        mobile1: trim(mobile1),
        // Arrays, as the route expects - it joins them into the comma-separated
        // strings Clients.types/operations are stored as. An aviation install
        // asks for no operations at all, which is why that one is empty.
        types: [type],
        operations: [],
        // The parent the ledger is created under. Without it the party is
        // non-GL and would not appear in the column it was registered for -
        // see the note at the top of this file.
        pAccountName: parent,
        createdBy: Cookies.get('username') || '',
        employeeId: Cookies.get('loginId'),
      });
      // The endpoint answers 'exists' rather than failing when the name is
      // taken, and nothing was created - so say so instead of reporting a
      // success that put nothing in the list.
      if (res?.data?.status === 'exists') {
        openNotification('Already registered', `A party called "${trim(name)}" already exists.`, 'orange');
        return;
      }
      if (res?.data?.status !== 'success') {
        openNotification('Error', `The ${type.toLowerCase()} could not be registered.`, 'red');
        return;
      }
      openNotification('Success', `${res.data.result.name} registered.`, 'green');
      onCreated(res.data.result);
      onClose();
    } catch (e) {
      openNotification(
        'Error',
        errText(e, `The ${type.toLowerCase()} could not be registered.`),
        'red'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Register a ${type.toLowerCase()}`}
      open={open}
      onCancel={saving ? undefined : onClose}
      onOk={save}
      okText='Register'
      okButtonProps={{ disabled: Boolean(blocked) || parent === undefined }}
      confirmLoading={saving}
      destroyOnClose
      width={460}
    >
      {blocked ? (
        <Alert type='warning' showIcon message='This cannot be registered from here' description={blocked} />
      ) : (
        <Form layout='vertical' size='small'>
          <Form.Item label='Name' required>
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
              onPressEnter={save} placeholder='As it appears on the air waybill' />
          </Form.Item>
          <Form.Item label='City'>
            <Input value={city} onChange={(e) => setCity(e.target.value)} onPressEnter={save} />
          </Form.Item>
          <Form.Item label='Address'>
            <Input value={address1} onChange={(e) => setAddress1(e.target.value)} onPressEnter={save} />
          </Form.Item>
          <Form.Item label='Mobile'>
            <Input value={mobile1} onChange={(e) => setMobile1(e.target.value)} onPressEnter={save} />
          </Form.Item>
          <div className='grey-txt fs-12'>
            Registered with a ledger under the receivable parent from Config &gt;
            Party Accounts, so it can be named on a consignment and billed. The
            rest of its details can be filled in under Setup &gt; Parties.
          </div>
        </Form>
      )}
    </Modal>
  );
};

/**
 * Quick-register ONE air waybill number: whose it is, who it went to, and the
 * number itself.
 *
 * The three fields are not arbitrary - they are what makes a number usable
 * from the grid it was registered in. The consignment's AWB dropdown offers a
 * row only the numbers belonging to its carrier AND its master agent, so a
 * number registered without either would be invisible in the very column that
 * opened this dialog.
 *
 * THE PREFIX IS NOT TYPED. It belongs to the carrier - it is unique to one,
 * and an AWB is prefix + serial - so it is read off the carrier record and
 * shown. Only the 8 digits printed on the document are entered, and the check
 * digit is VERIFIED rather than assumed: it is the one part of the number that
 * can be derived from the rest, so a mismatch is a typo, and a mistyped AWB is
 * one no airline will accept.
 *
 * ONE NUMBER, not a series. A block arriving from the airline is stock to be
 * registered and handed out later, which is Setup > AWB Stock's job and has a
 * series option for exactly that. What reaches this dialog is the single
 * number on the document in front of the operator.
 */
export const AwbModal = ({ open, onClose, onCreated, carriers = [], masterAgents = [] }) => {
  const [carrierId, setCarrierId] = React.useState(undefined);
  const [masterAgentId, setMasterAgentId] = React.useState(undefined);
  const [code, setCode] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCarrierId(undefined);
    setMasterAgentId(undefined);
    setCode('');
  }, [open]);

  const carrier = carriers.find((c) => c.id === carrierId);
  const prefix = carrier?.prefix || '';

  // Checked by the same rule the server stores by, as it is typed. Null while
  // the number is still half-entered - a partial number is not a wrong one.
  const preview = carrierId ? previewSeries(prefix, code, false, 1) : null;

  const save = async () => {
    if (!carrierId) {
      openNotification('Carrier is required', 'The prefix comes from the carrier, so it has to be named.', 'orange');
      return;
    }
    if (!masterAgentId) {
      // Not pedantry: the grid narrows the AWB list to the row's own agent, so
      // an unassigned number would not appear in the column this was opened
      // from and would look like the registration had failed.
      openNotification(
        'Master agent is required',
        'A number is offered on a consignment only to the agent it was given to.',
        'orange'
      );
      return;
    }
    if (!preview || preview.error) {
      openNotification('Check the number', preview?.error || 'Enter the 8 digits from the air waybill.', 'orange');
      return;
    }
    setSaving(true);
    try {
      const res = await registerAwbs({
        carrierId, masterAgentId, code, series: false, count: 1,
        employeeId: Cookies.get('loginId'),
      });
      if (res?.status !== 'success') {
        openNotification('Not registered', res?.result || 'The number could not be registered.', 'red');
        return;
      }
      // Three different things can have happened, and they are worth telling
      // apart: a new number, one that was on the register and has now been
      // handed over, and one that was already this agent's all along.
      const { created, assigned, agent, from } = res.result;
      openNotification(
        'Registered',
        created ? `${from} registered to ${agent}.`
          : assigned ? `${from} was already on the register and is now assigned to ${agent}.`
          : `${from} is already registered to ${agent}.`,
        'green'
      );
      onCreated(res.result);
      onClose();
    } catch (e) {
      openNotification('Not registered', errText(e, 'The number could not be registered.'), 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title='Register an AWB number'
      open={open}
      onCancel={saving ? undefined : onClose}
      onOk={save}
      okText='Register'
      confirmLoading={saving}
      destroyOnClose
      width={480}
    >
      <Form layout='vertical' size='small'>
        <Form.Item label='Carrier' required>
          <Select value={carrierId} onChange={setCarrierId} showSearch optionFilterProp='label'
            placeholder='Which airline issued this number?'
            options={carriers.map((c) => ({
              value: c.id,
              label: c.prefix ? `${c.prefix} — ${c.name}` : c.name,
            }))} />
        </Form.Item>
        <Form.Item label='Master agent' required>
          <Select value={masterAgentId} onChange={setMasterAgentId} showSearch optionFilterProp='label'
            placeholder='Who was it given to?'
            options={masterAgents.map((a) => ({ value: a.id, label: a.name }))} />
        </Form.Item>
        <Form.Item label='AWB number' required
          help={prefix
            ? `Prefix ${prefix}, from the carrier — enter the 8 digits printed after it`
            : 'Pick the carrier first: the prefix comes from it'}>
          <Input
            value={code}
            maxLength={9}
            addonBefore={prefix || '—'}
            placeholder='10000001'
            disabled={!carrierId}
            onPressEnter={save}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
          />
        </Form.Item>
        {/* A carrier with no prefix gets the actionable message rather than
            previewSeries' version of the same fact - there is nothing to fix
            in the number, and the fix is on another screen. */}
        {carrierId && !prefix && (
          <Alert type='warning' showIcon
            message='This carrier has no AWB prefix'
            description='Set it in Setup > Carriers — a number cannot be registered without one.' />
        )}
        {prefix && preview?.error && <Alert type='error' showIcon message={preview.error} />}
        {preview && !preview.error && (
          <Alert type='success' showIcon message={`${preview.head[0]} will be registered.`} />
        )}
      </Form>
    </Modal>
  );
};

/**
 * Quick-register a carrier - the same fields Setup > Carriers asks for.
 *
 * All of them, not a subset, because none of the three is optional in
 * practice. The PREFIX is what an AWB is built from, and a carrier without one
 * cannot have a number registered against it at all. The REPORTING TAG decides
 * which column of the monthly sector report this carrier's uplift lands in, so
 * a carrier registered without thinking about it quietly moves a month's
 * figures. And the PARTY is who the carrier is in the books: payables on an
 * AWB are paid to the airline, and a charge is only billable against a party
 * with a ledger - a carrier without one is a carrier nothing can be paid to,
 * which announces itself weeks later as an invoice that will not raise.
 *
 * UNLIKE the master agent above, a carrier with no ledger is still USABLE
 * here: /getValues does not filter the carrier list, so it can be put on a
 * consignment straight away and given its ledger later. So this does not
 * refuse a user who may not create one - it saves, and passes on the server's
 * note saying what did not happen.
 */
export const CarrierModal = ({ open, onClose, onCreated, parties = [] }) => {
  const [name, setName] = React.useState('');
  const [prefix, setPrefix] = React.useState('');
  const [category, setCategory] = React.useState('Other');
  const [createParty, setCreateParty] = React.useState(true);
  const [partyId, setPartyId] = React.useState(undefined);
  const [partyName, setPartyName] = React.useState('');
  const [parentAccountId, setParentAccountId] = React.useState(undefined);
  const [accounts, setAccounts] = React.useState([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setPrefix('');
    setCategory('Other');
    setCreateParty(true);
    setPartyId(undefined);
    setPartyName('');
    setParentAccountId(undefined);

    let alive = true;
    // The chart-of-accounts parents a ledger can hang off - the same endpoint
    // Setup > Parties and Setup > Carriers use, so all three offer the same
    // choices. Never fatal: without it the carrier still saves, and its party
    // is created name-only.
    axiosClient
      .get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNTS_FOR_PARTY_SETUP, { headers: { id: '1' } })
      .then((x) => {
        if (!alive) return;
        const list = Array.isArray(x?.data?.result) ? x.data.result : [];
        setAccounts(list);
        // ACCOUNT PAYABLE, not receivable: an airline sells you space, so the
        // balance normally runs the other way. Matched on title and simply
        // left unset if the install names its accounts otherwise - the same
        // rule Setup > Carriers applies.
        const preferred = list.find((a) =>
          CARRIER_PARENTS.includes(String(a.title || '').trim().toUpperCase()));
        if (preferred) setParentAccountId(preferred.id);
      })
      .catch(() => { if (alive) setAccounts([]); });
    return () => { alive = false; };
  }, [open]);

  const save = async () => {
    if (!trim(name)) {
      openNotification('Name is required', 'A carrier needs a name.', 'orange');
      return;
    }
    setSaving(true);
    try {
      const res = await saveCarrier({
        id: null,
        name: trim(name),
        prefix,
        category,
        active: true,
        createParty,
        partyId: createParty ? (partyId ?? null) : null,
        partyName: createParty ? trim(partyName) : '',
        parentAccountId: createParty ? (parentAccountId ?? null) : null,
      });
      if (res?.status !== 'success') {
        openNotification('Not registered', res?.result || 'The carrier could not be registered.', 'red');
        return;
      }
      // Say what happened to the PARTY, not just the carrier: "linked to the
      // existing PIA" and "created a new party PIA" are very different
      // outcomes for the books, and the difference is invisible otherwise.
      const p = res.party;
      const partyMsg = !p ? ''
        : p.action === 'created'
          ? ` A new party ${p.name} was created${p.ledgerCreated ? ' with a ledger account' : ''}.`
          : ` Linked to the existing party ${p.name}${p.ledgerCreated ? ', and given a ledger account' : ''}.`;
      openNotification('Registered', `${res.result.name} registered.${partyMsg}`, 'green');
      // A server-side caveat - most often "you may not create a ledger" - is
      // its own notification rather than a clause nobody reads.
      if (res.note) openNotification('Note', res.note, 'orange');
      onCreated(res.result, p || null);
      onClose();
    } catch (e) {
      openNotification('Not registered', errText(e, 'The carrier could not be registered.'), 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title='Register a carrier'
      open={open}
      onCancel={saving ? undefined : onClose}
      onOk={save}
      okText='Register'
      confirmLoading={saving}
      destroyOnClose
      width={520}
    >
      <Form layout='vertical' size='small'>
        <Form.Item label='Name' required>
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onPressEnter={save} placeholder='PIA' />
        </Form.Item>
        <Form.Item label='AWB prefix'
          help='Unique — one prefix identifies one carrier, and every AWB is built from it'>
          <Input value={prefix} maxLength={4} placeholder='214'
            onChange={(e) => setPrefix(e.target.value.replace(/[^0-9]/g, ''))} />
        </Form.Item>
        <Form.Item label='Reporting tag' required
          help="Which column of the monthly sector report this carrier's uplift counts toward">
          <Select value={category} onChange={setCategory}
            options={CARRIER_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </Form.Item>

        {/* THE PARTY. Separated from the fields above because it is a
            different kind of decision: those describe the airline, this
            decides how money moves. */}
        <Checkbox checked={createParty} onChange={(e) => setCreateParty(e.target.checked)}>
          <b>Register this carrier in the books</b>
        </Checkbox>
        <div className='grey-txt fs-12 mb-2'>
          Needed before anything can be billed to or paid to it — a payable on
          an AWB is almost always paid to the airline.
        </div>

        {createParty && (
          <>
            <Form.Item label='Existing party'
              help='Leave blank to create one. A party of the same name is linked rather than duplicated.'>
              <Select value={partyId} allowClear showSearch optionFilterProp='label'
                placeholder='Create a new one'
                onChange={(v) => setPartyId(v ?? undefined)}
                options={parties.map((p) => ({ value: p.id, label: p.name }))} />
            </Form.Item>
            {/* Only when a party is being CREATED. Linking an existing one
                must never rename it - its name is on every invoice already
                raised against it. */}
            <Form.Item
              label={partyId ? 'Party name — set on the party itself' : 'Party name'}
              help={partyId ? undefined
                : 'The books usually want the full name — PIA the carrier, Pakistan International Airlines the party'}>
              <Input value={partyId ? '' : partyName} disabled={Boolean(partyId)}
                placeholder={trim(name) || 'Same as the carrier name'}
                onChange={(e) => setPartyName(e.target.value)} />
            </Form.Item>
            <Form.Item label='Parent account'>
              <Select value={parentAccountId} allowClear showSearch optionFilterProp='label'
                placeholder='No ledger account'
                onChange={(v) => setParentAccountId(v ?? undefined)}
                options={accounts.map((a) => ({ value: a.id, label: a.title }))} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

/**
 * Quick-register an airport, for the Destination column.
 *
 * A destination is stored as the airport CODE, not an id - the same shape the
 * freight air jobs put in pol/pod - so an unregistered airport is not a
 * missing link but a code with nothing behind it, and the consignment cannot
 * be saved without one.
 *
 * NO CITY FIELD. An aviation install does not record it: the code and the
 * country are what a flight is identified by, and Setup > Airports hides the
 * box in this mode for the same reason. The column is nullable and the server
 * writes null.
 *
 * THE CODE IS CHECKED AGAINST WHAT THIS SCREEN ALREADY HOLDS before posting.
 * airportCode is unique on the table, so a duplicate is refused - but by a
 * Postgres constraint violation that the route hands back as a raw error
 * object, not a sentence anyone can act on. The list is already in memory and
 * a re-registered airport is the likeliest mistake here, so it is worth
 * saying properly.
 */
export const AirportModal = ({ open, onClose, onCreated, airports = [] }) => {
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCode('');
    setName('');
    setCountry('');
  }, [open]);

  // Codes are held and compared upper case - an airport typed as "khi" and one
  // typed as "KHI" are the same airport, and the register must not hold both.
  const tidyCode = trim(code).toUpperCase();
  // `id` IS the code on an airport option - see the note above.
  const clash = airports.find((a) => String(a.id || '').toUpperCase() === tidyCode);

  const save = async () => {
    if (!tidyCode || !trim(name) || !trim(country)) {
      openNotification(
        'Code, name and country are required',
        'The server asks for all three - an airport identified by fewer is not identified.',
        'orange'
      );
      return;
    }
    if (clash) {
      openNotification('Already registered', `${clash.name} is already in the list.`, 'orange');
      return;
    }
    setSaving(true);
    try {
      const res = await createAirport({
        airportCode: tidyCode,
        airportName: trim(name),
        country: trim(country),
      });
      // This endpoint reports a validation failure as a 200 with status
      // 'error', so the answer has to be read rather than the request merely
      // not having thrown.
      if (res?.status !== 'success') {
        openNotification(
          'Not registered',
          typeof res?.result === 'string' ? res.result : 'The airport could not be registered.',
          'red'
        );
        return;
      }
      openNotification('Registered', `${res.result.airportName} (${res.result.airportCode}) registered.`, 'green');
      onCreated(res.result);
      onClose();
    } catch (e) {
      openNotification('Not registered', errText(e, 'The airport could not be registered.'), 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title='Register an airport'
      open={open}
      onCancel={saving ? undefined : onClose}
      onOk={save}
      okText='Register'
      confirmLoading={saving}
      destroyOnClose
      width={460}
    >
      <Form layout='vertical' size='small'>
        <Form.Item label='Code' required
          help='The IATA code — what a destination is actually stored as'>
          <Input value={code} maxLength={8} autoFocus placeholder='KHI'
            onPressEnter={save}
            onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Form.Item>
        <Form.Item label='Airport name' required>
          <Input value={name} placeholder='Jinnah International'
            onPressEnter={save} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
        <Form.Item label='Country' required>
          <Input value={country} placeholder='Pakistan'
            onPressEnter={save} onChange={(e) => setCountry(e.target.value)} />
        </Form.Item>
        {clash && (
          <Alert type='warning' showIcon
            message={`${tidyCode} is already registered`}
            description={`It is in the list as ${clash.name}.`} />
        )}
      </Form>
    </Modal>
  );
};
