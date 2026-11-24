import React, { useEffect, useState } from 'react';
import { Table } from 'react-bootstrap';
import { Select, Input, InputNumber, Checkbox, Tag, Tooltip, Tabs } from 'antd';
import { chargeRowForKey, chargeRowShortcutLabel } from 'functions/tabShortcuts';
import {
  CloseCircleOutlined, CheckCircleFilled, ClockCircleOutlined, FileTextOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import Cookies from 'js-cookie';
import {
  RECEIVABLE, PAYABLE, PER_UNIT, PER_SHIPMENT,
  num, isPerShipment, isInvoiced, isInvoiceLocked, isApproved,
  computeNetAmount, computeLocalAmount, copiesAcross, perUnitQty, chargeCopyKey,
  directLineAsCharge, isTaxed, taxPercOf, computeTaxAmount,
} from 'functions/customsPricing';
import { money, reimbursableDuty } from 'functions/customsDuty';
import ChargePicker from './ChargePicker';
import ChargeCodeInput from './ChargeCodeInput';
// Charge_Head.charge and .partyId are STRING columns pointing at integer
// masters - see the file for why that has to be reconciled on read.
import { asId, sameId } from 'functions/chargeIds';
import RowAction from 'Components/Shared/RowAction';
import { AuditTip } from 'Components/Shared/AuditStamp';
import { DeleteOutlined } from '@ant-design/icons';
import openNotification from 'Components/Shared/Notification';
import { Dropdown } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import axiosClient from 'apis/axiosClient';
import { invoiceApprovalTargets } from 'functions/invoiceBulkApproval';
import { jobDocRights } from 'functions/jobDocRights';
import { receivableWaitsForVessel, billableLabels } from 'functions/customsStatus';
import { useCustomsStatuses } from 'functions/customsStatuses';
import { getCustomsChargeSummary } from 'apis/customsJobs';
import { useMyPermissions } from 'functions/myPermissions';
import { useUniqueJobCharges, otherLineWithCharge } from 'functions/uniqueJobCharges';
import { openDirectJobEntry, newDirectJobFor } from 'Components/Layouts/AccountsComp/directJob/openDirectJob';

// The charge sheet for one goods declaration.
//
// Charges hang off the JOB, not off a child line - unlike aviation, where a
// flight carries many AWBs for many different customers and its charges have
// to be per-AWB. A GD is one declaration for one client, so everything on the
// file is billed to the same party and the job is the right grain.
//
// A customs charge IS a Charge_Head, the same shared table the freight side
// uses, so once it is on an invoice every downstream screen - invoice print,
// ledger, payments, ageing - handles it with no customs-specific branch.

// EXPORTED, because the declaration's commercial-invoice currency has to be
// the same set. Two hardcoded lists in one module is how they drift, and a
// currency offered on the charge sheet but not on the GD - or the reverse -
// is a difference nobody would think to look for.
// CNY, JPY and SAR added for the trade lanes this book actually runs on -
// China, Japan and Saudi Arabia - which had no code to be recorded under, so a
// value in one of them was either left blank or filed under the wrong currency
// and converted at the wrong rate.
export const CURRENCY_CODES = [
  'PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF', 'CNY', 'JPY', 'SAR',
];

const CURRENCIES = CURRENCY_CODES.map((c) => ({ value: c, label: c }));

// The currency the books are kept in.
//
// A charge in this currency has no conversion to do, so its ex-rate is 1 by
// definition - not a figure anyone should be typing, and not one they should
// be able to get wrong. A charge in ANY OTHER currency has a real conversion,
// so an ex-rate of 1 there is not a rate at all: it is the field nobody filled
// in, and it books a USD charge into the ledger at its USD face value.
const BOOKS_CURRENCY = 'PKR';

// An unset currency is treated as the books' currency - that is what the
// column's placeholder already tells the user - but only an EXPLICIT pick
// locks the rate, so opening an old charge never silently rewrites it.
const isBooksCurrency = (currency) =>
  String(currency || '').trim().toUpperCase() === BOOKS_CURRENCY;

/**
 * What is wrong with this charge's exchange rate, as a sentence, or null.
 *
 * Blank currency is not a problem: it means the books' currency, and the rate
 * is irrelevant. Everything else has to convert at something other than 1.
 *
 * THE REMEDY CHANGED WHEN THE EX-RATE COLUMN WENT. There is nowhere left to
 * type a rate - not on the charge, and not on the job, which has an exRate
 * field that no page renders - so the message can no longer ask for one. What
 * it asks for instead is the only thing that can actually be done: record the
 * charge in the books' currency.
 *
 * The GUARD stays, and that is the point of keeping it. Without it a charge
 * picked as USD would convert at 1 and book into a rupee ledger at its dollar
 * face value - out by a factor of nearly three hundred, silently. Nothing on
 * this book is in a foreign currency (0 of 143,370 customs charges), so this
 * blocks nobody today; it is here so that the day somebody picks USD the
 * answer is a refusal they can see rather than a number nobody checks.
 */
const exRateProblem = (c) => {
  if (!c.currency || isBooksCurrency(c.currency)) return null;
  const rate = num(c.ex_rate);
  if (!rate || rate === 1) {
    return `This charge is in ${c.currency} and there is no exchange rate to convert it, `
      + `so it would post to the ledger at its ${c.currency} face value. `
      + `Record it in ${BOOKS_CURRENCY}, or ask for the exchange-rate field to be put back.`;
  }
  return null;
};

// Abbreviated the way the freight charges table shows it.
const BASIS_OPTIONS = [
  { value: PER_SHIPMENT, label: 'P/Shpt' },
  { value: PER_UNIT, label: 'P/Unit' },
];

// A charge's default party TYPE (Setup > Charges) named against the field on
// the JOB that holds that party. Picking a charge fills its party in from here.
//
// THE KEYS ARE THE ROLES SETUP > CHARGES ACTUALLY OFFERS. This map used to
// read 'Shipper' and 'Consignee', copied across from the aviation sheet - and
// those two are the AVIATION vocabulary (see AVIATION_PARTY_TYPE_OPTIONS in
// functions/terminology). A customs install is not in aviation mode, so its
// charge master offers the FREIGHT roles below and can never store either of
// the old keys. Every lookup missed, and the party never auto-filled once.
//
// 'Overseas-Agent' is deliberately absent: a goods declaration names no such
// party, so a charge defaulted to it fills nothing rather than filling in
// whichever party happens to be nearest.
const PARTY_FIELD_BY_ROLE = {
  'Client': 'clientId',
  'Local-Agent': 'localVendorId',
  'Custom-Agent': 'chaChbId',
  'Forwarding-Agent': 'chaChbId',
  'Transport-Agent': 'transporterId',
  'Shipping-Line': 'shippingLineId',
};

/**
 * The currency a line imported from a charge group takes: the group's, or -
 * left empty in the group - the charge master's, which is what picking the
 * charge by hand gives. It was left blank, so an imported line and a
 * hand-picked one of the same charge differed - and the server raised them on
 * separate invoices for the one client.
 */
export const importedLineCurrency = (line, master) =>
  String(line?.currency || '').trim().toUpperCase() || master?.currency || null;

// Per Shipment is the default, because most clearance work is a flat fee for
// the file: an agency fee, a documentation charge, a duty reimbursement.
export const blankCharge = (type, exRate = null) => ({
  type,
  charge: null,
  particular: '',
  partyId: null,
  name: '',
  partyType: null,
  description: '',
  basis: PER_SHIPMENT,
  // ONE, not empty. A Per Shipment charge is one of something by definition,
  // and a Per Unit line is far more often one container or one consignment
  // than any other number - so the common case is typed for you, and the
  // uncommon one is a single edit. An empty box priced a Per Unit charge at
  // zero until somebody noticed the quantity was the field they had missed.
  qty: 1,
  rate_charge: null,
  discount: null,
  net_amount: null,
  currency: '',
  ex_rate: exRate ?? null,
  local_amount: null,
  // Untaxed until a charge is picked - the charge master says whether its
  // fee carries sales tax, and at what rate.
  tax_apply: false,
  taxPerc: 0,
  tax_amount: 0,
  // Charges start unapproved and uninvoiced - both are deliberate acts.
  status: '0',
  approved_by: null,
  approval_date: null,
  InvoiceId: null,
});

// Everything allowed - for a caller that does not say (functions/jobDocRights).
const ALL_RIGHTS = jobDocRights(() => true);

const Charges = ({
  job, jobId, charges, setCharges, values, disabled, onInvoice, invoicing,
  onInvoiceApproval, approvingInvoices,
  // The user's rights on charges and on the invoices raised from them, apart
  // (the user's request, 2026-10-20), and whether the job is cancelled -
  // `disabled` is "may not change charges", which is not "may not raise".
  rights = ALL_RIGHTS, canceled = false,
  // Is the Charges tab the one showing? Its shortcuts listen only then.
  active = true,
  // Receivable, Payable and Summary each on a tab of their own, rather than
  // one under another - Configuration > Customs, "Charges in tabs".
  tabbed = false,
}) => {
  const dispatchTab = useDispatch();
  // Direct Job rights, for the Summary's entry links and its Add Direct E/R.
  const can = useMyPermissions();
  // One of each charge per side - see applyPickedCharge.
  const oneOfEach = useUniqueJobCharges();

  // Which of the three tabs is showing, when `tabbed`. Kept here, not in the
  // tabs themselves, so a shortcut can bring up the side it adds a line to.
  const [sideTab, setSideTab] = React.useState('rec');

  // Which charges are ticked for invoicing. Keyed by Charge_Head id, so an
  // unsaved charge simply cannot be selected - it has no id to invoice.
  const [selected, setSelected] = React.useState(() => new Set());

  // The charge LINE whose charge is being chosen, or null. Held by identity
  // rather than by index for the same reason setFields addresses a row by
  // identity: the two sections are filtered views of one array.
  const [picking, setPicking] = React.useState(null);
  // What was typed in the line's charge box when Enter opened the picker.
  const [pickQuery, setPickQuery] = React.useState('');
  const searchCharge = (row, text) => { setPickQuery(text || ''); setPicking(row); };

  // No chargeOptions memo any more - the charge is chosen in ChargePicker,
  // which takes the master records themselves because it shows three fields of
  // each rather than one flattened label.
  const partyOptions = React.useMemo(
    () => (values.party || []).map((c) => ({ value: c.id, label: c.name })),
    [values.party]
  );

  /* WHAT THE FILE EARNED, per charge head - the Summary section at the foot.
   *
   * Fetched rather than derived, because two of its three inputs are not on
   * this screen: how much of each invoice has actually been SETTLED, and the
   * DIRECT JOB lines booked against the job. That second one is why the
   * section exists. Money entered through Accounts > Direct Job E / R posts
   * straight to the ledger against this file and never becomes a charge here,
   * so a cost paid that way was invisible to every total on this page and the
   * profit read high by exactly that amount.
   *
   * Re-read whenever the charges change, so raising an invoice or approving a
   * line moves the figures without a reload. */
  const [chargeSummary, setChargeSummary] = React.useState(null);
  const [summaryError, setSummaryError] = React.useState(null);
  const [loadingSummary, setLoadingSummary] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    /* `jobId`, the route's, NOT job.id - `job` is the form's state and the id
       is deliberately kept off it so that it never travels back in a save
       payload. Reading job.id here meant the section said "save the job to see
       what it earned" on a job that had been saved for months. */
    if (!jobId || jobId === 'new') { setChargeSummary(null); return undefined; }
    setLoadingSummary(true);
    setSummaryError(null);
    getCustomsChargeSummary(jobId)
      .then((res) => { if (alive) setChargeSummary(res?.result || null); })
      .catch((e) => {
        if (!alive) return;
        // Shown in the section rather than as a toast: the rest of the charge
        // sheet is fine and must stay usable, and a summary that silently
        // shows nothing reads as "this job earned nothing".
        setSummaryError(e?.response?.data?.result || 'Could not work out the summary.');
      })
      .finally(() => { if (alive) setLoadingSummary(false); });
    return () => { alive = false; };
  }, [jobId, charges]);

  /* WHICH SUMMARY ROWS ARE TICKED, by charge head - their Direct Job lines are
   * copied by the same two Copy buttons the sheet's own ticks feed. Keyed by
   * the head rather than by line because the Summary shows one row per head.
   * Cleared with the job, so a tick never carries over to another file. */
  const [selectedDirect, setSelectedDirect] = React.useState(() => new Set());
  React.useEffect(() => { setSelectedDirect(new Set()); }, [jobId]);
  const directKey = (charge) => String(asId(charge) ?? '');

  // The Direct Job lines as charges of their own side - see directLineAsCharge.
  // Particular is the master's full name, as picking the charge would give.
  const directAsCharges = (chargeSummary?.directLines || []).map((l) => {
    const master = (values.charge || []).find((x) => sameId(x.id, l.charge));
    return { ...directLineAsCharge(l), particular: master?.fullName || master?.name || null };
  });

  /** Ticked for copying - a sheet line by its id, a Direct Job line by its head. */
  const isTicked = (c) => (c?.directLineId != null
    ? selectedDirect.has(directKey(c.charge))
    : c?.id != null && selected.has(c.id));

  const rowsOf = (type) => (charges || []).filter((c) => c.type === type);

  /**
   * The full charge name - what an invoice prints as the line description.
   *
   * Stored on the charge when it was picked, so it is the name AS IT WAS at
   * that moment and a later rename in Setup > Charges cannot rewrite history
   * on an issued invoice. Falls back to the master only for a row saved before
   * the full name was carried, so an old charge still reads as something.
   */
  /** The charge master record a line points at, or undefined. */
  const chargeOf = (c) => (values.charge || []).find((x) => sameId(x.id, c.charge));

  const particularOf = (c) => {
    if (c.particular) return c.particular;
    const master = (values.charge || []).find((x) => sameId(x.id, c.charge));
    return master?.fullName || master?.name || '';
  };

  // Edits address a charge by IDENTITY, not by its index within its section:
  // the two sections are filtered views of one array, so a row that is third
  // in the Payable table is not the third element of `charges`.
  const setFields = (target, patch) => {
    setCharges((charges || []).map((c) => {
      if (c !== target) return c;
      const next = { ...c, ...patch };
      // A migrated line's tax rate is read back out of its tax amount (see
      // taxPercOf). Pin it BEFORE this edit changes the figures it was read
      // from, or changing the amount would quietly change the rate instead of
      // the tax.
      if (isTaxed(c) && !num(c.taxPerc) && !('taxPerc' in patch)) next.taxPerc = taxPercOf(c);
      // Derived figures are recomputed on every edit rather than on save, so
      // the screen can never show a net amount that its own inputs disagree
      // with. The backend recomputes them again from the same rules.
      next.tax_amount = computeTaxAmount(next);
      next.net_amount = computeNetAmount(next);
      next.local_amount = computeLocalAmount(next, job);
      return next;
    }));
  };

  // The line Add + (or its shortcut) just made: its charge box takes the
  // cursor when it appears. Held by identity, like `picking`.
  const freshRow = React.useRef(null);
  const addCharge = (type) => {
    const row = blankCharge(type, job?.exRate);
    freshRow.current = row;
    setCharges([...(charges || []), row]);
    // On tabs, the new line shows where it was added: Alt+B pressed on the
    // Receivable tab opens Payable, rather than adding a line out of sight.
    if (tabbed) setSideTab(type === RECEIVABLE ? 'rec' : 'pay');
  };

  /* ALT+R / ALT+B - a Receivable / Payable line, exactly as that section's
   * Add + (functions/tabShortcuts chargeRowForKey). Only while this tab is the
   * one showing: the job page keeps its other tabs mounted, and this with
   * them, so without `active` the keys would add lines to a tab nobody is
   * looking at. And only where Add + itself is pressable.
   *
   * Works with the cursor in a field - adding the next line mid-entry is the
   * point - since Alt+R and Alt+B type nothing on Windows. Through a ref, so
   * the listener always adds to the charges as they are now. */
  const addChargeRef = React.useRef(addCharge);
  addChargeRef.current = addCharge;
  useEffect(() => {
    if (!active || disabled) return undefined;
    const onKeyDown = (e) => {
      const type = chargeRowForKey(e);
      if (!type) return;
      e.preventDefault();
      e.stopPropagation();
      addChargeRef.current(type);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, disabled]);

  /**
   * Everything that follows from choosing a charge for a line.
   *
   * Picking a charge does not only set the charge: it names the line on the
   * invoice, and it carries the currency, the basis, the quantity and the
   * party the charge master says this kind of work falls to. All of that used
   * to sit inline in the dropdown's onChange, which is fine while there is one
   * way to pick - and there are two now.
   *
   * `row` is the charge line; `picked` is the master record, or null to clear.
   */
  const applyPickedCharge = (row, picked) => {
    /* ONE OF EACH CHARGE PER SIDE, when the install has it on (Configuration >
       Direct Job, asked 2026-11-17): a charge this side already has is turned
       back here, on the line. The server refuses the save as well. */
    if (oneOfEach && otherLineWithCharge(charges, row, picked?.id, sameId)) {
      openNotification('Charge already on this job',
        `${picked?.fullName || picked?.name || 'This charge'} is already on the ${row.type === RECEIVABLE ? 'Receivable' : 'Payable'} side `
        + 'of this job - a charge goes on once per side (Configuration > Direct Job).', 'orange', 8);
      return;
    }
    // The basis the row will HAVE once this lands: the charge's own if it
    // names one, otherwise whatever the row already had. Reading only the
    // picked charge's would treat a charge with no calculationType as Per
    // Shipment and quietly restate a Per Unit row.
    const perUnit = (picked?.calculationType || row.basis) === PER_UNIT;
    setFields(row, {
      charge: picked?.id ?? null,
      // The FULL name, not the picker label. particular is what an invoice
      // prints as the line description, and "(THC) Terminal" is a picker
      // label - not something a client should be reading on a bill.
      particular: picked?.fullName || picked?.name || null,
      ...(picked?.currency ? { currency: picked.currency } : {}),
      ...(picked?.calculationType ? { basis: picked.calculationType } : {}),
      // A Per Unit charge is for a number of PIECES on this module - see
      // defaultQty.
      //
      // NOT guarded on the quantity being empty. It never is: a new row starts
      // at 1, so `!num(c.qty)` was false on every row that had not been
      // touched and the seed could not fire at all. Picking a charge is an
      // explicit act and restating the quantity with it is what the freight
      // sheet does too; typing over it afterwards is the way to a number of
      // your own.
      ...(perUnit ? { qty: defaultQty() } : {}),
      // Which party this charge falls to, per Setup > Charges.
      ...defaultPartyFor(picked?.id ?? null, row.type === RECEIVABLE),
      // Sales tax on the fee, per Setup > Charges: the box and the rate. A
      // line with the box ticked is what the Sale Tax Invoice prints.
      ...(picked ? { tax_apply: Boolean(picked.taxApply), taxPerc: picked.taxApply ? num(picked.taxPerc) : 0 } : {}),
    });
  };

  /** The charge master's own rate, for a box ticked on a line that has none. */
  const masterTaxPerc = (row) => {
    const master = (values.charge || []).find((x) => sameId(x.id, row.charge));
    return master?.taxApply ? num(master.taxPerc) : 0;
  };

  /**
   * Which party a charge falls to, and what to call them.
   *
   * Per Setup > Charges, which names a default party ROLE per side - and the
   * roles differ: the client is billed the agency fee, the shipping line is
   * paid the terminal handling. Returns {} when the charge names no role, so
   * spreading it leaves whatever the row already had.
   *
   * Factored out of the charge picker because copying a line across to the
   * other side has to ask the SAME question of the OTHER side - a receivable
   * billed to the client does not become a payable to the client.
   */
  const defaultPartyFor = (chargeId, receivable) => {
    const picked = (values.charge || []).find((x) => sameId(x.id, chargeId));
    const role = receivable ? picked?.defaultRecivableParty : picked?.defaultPaybleParty;
    const partyField = PARTY_FIELD_BY_ROLE[role];
    if (!partyField) return {};
    const partyId = job?.[partyField] ?? null;
    const party = (values.party || []).find((p) => p.id === partyId);
    return { partyId, name: party?.name || null, partyType: role };
  };

  /**
   * How many units a Per Unit charge is for - the GD's Quantity (PCS). See
   * perUnitQty, where the rule lives so it can be tested.
   *
   * A SEED, not a binding: it fills the box when the charge or the basis is
   * chosen and can be typed over. Nothing recalculates it afterwards, so
   * editing the packages on the GD never silently reprices a charge that has
   * already been agreed.
   */
  const defaultQty = () => perUnitQty(job);

  /**
   * Copy this side's charges over from the other one.
   *
   * The rules - what is carried, what is re-derived, what is skipped - live in
   * functions/customsPricing so they can be tested on their own. See
   * copiesAcross, and note in particular that the PARTY is not copied.
   */
  const copyAcross = (type) => {
    /* The sheet's lines AND the Direct Job lines booked to the other side.
       Only the other side's: a Direct Job line of THIS side's type is not on
       the sheet, and counting it as "already here" would skip a copy. */
    const sources = [
      ...(charges || []),
      ...directAsCharges.filter((c) => c.type !== type),
    ];
    const copies = copiesAcross(sources, type, {
      blank: () => blankCharge(type, job?.exRate),
      partyFor: defaultPartyFor,
      // Only what was ticked on the other side. The tick boxes are keyed by
      // Charge_Head id, so a row that has never been saved has nothing to be
      // selected BY and cannot be copied - see the button's title.
      isSelected: isTicked,
    });

    /* SAY SO WHEN NOTHING CAME ACROSS.
     *
     * copiesAcross skips a line whose charge and description already exist on
     * this side - copying a sheet twice should not double it. But it did that
     * silently: press the button, watch nothing happen, conclude the feature
     * is broken. That is exactly what was reported, and the fix is to explain
     * rather than to copy the duplicates. */
    if (!copies.length) {
      const from = sources.filter((c) => c?.type !== type && isTicked(c));
      openNotification(
        'Nothing to copy',
        from.length
          ? `All ${from.length} ticked line(s) are already on this side — a line with the `
            + 'same charge and description is only copied once.'
          : `Tick the ${type === RECEIVABLE ? 'payable' : 'receivable'} lines you want first, `
            + `or a Direct Job ${type === RECEIVABLE ? 'expense' : 'revenue'} in the Summary.`,
        'orange',
      );
      return;
    }

    setCharges([...(charges || []), ...copies]);
    openNotification(
      'Copied',
      `${copies.length} line(s) copied. They are not saved yet — press Save Job.`,
      'green',
    );
  };

  /* ------------------------- CHARGE GROUPS -------------------------
   *
   * A group is a named set of default charges for a kind of client, kept in
   * Setup > Charge Groups. If this job's CLIENT is in one, its lines can be
   * brought onto the sheet in a click instead of being retyped - which is
   * where a head gets missed, and a missed payable is profit the file never
   * shows.
   *
   * The client's groups are fetched once the client is known, and again when
   * it changes: a job re-assigned to a different client should offer that
   * client's tariff, not the previous one's.
   *
   * A party may be in SEVERAL groups - the same client buying two different
   * services - so one group imports straight away and several offer a menu.
   * Merging them would produce a sheet matching neither tariff. */
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    const partyId = job?.clientId;
    if (!partyId) { setGroups([]); return; }
    let alive = true;
    axiosClient.get('/customsChargeGroups/forParty', { headers: { partyid: String(partyId) } })
      .then(({ data }) => { if (alive) setGroups(data?.result || []); })
      // Never fatal: the charge sheet must open whether or not a tariff can be
      // read, and the button simply does not appear.
      .catch(() => { if (alive) setGroups([]); });
    return () => { alive = false; };
  }, [job?.clientId]);

  /**
   * Bring a group's defaults onto the sheet.
   *
   * Each line becomes an ordinary charge row - the same shape `Add +` makes -
   * so nothing downstream can tell an imported line from a typed one, and
   * editing the group later does not reach back into a job.
   *
   * The PARTY is resolved here, not stored in the group: defaultPartyFor asks
   * the charge master whose this head is and fills it from THIS job's client,
   * shipping line or transporter. Same question `Add +` and `Copy across` ask.
   *
   * Lines already on the sheet are skipped by charge and description, the same
   * key copyAcross uses - importing twice should not double the sheet.
   */
  const masterFullName = (chargeId) => {
    const picked = (values.charge || []).find((x) => sameId(x.id, chargeId));
    return picked?.fullName || picked?.name || null;
  };
  const masterOf = (chargeId) => (values.charge || []).find((x) => sameId(x.id, chargeId));

  const importGroup = (group) => {
    const lines = group?.Customs_Charge_Group_Lines || [];
    const already = new Set((charges || []).map(chargeCopyKey));

    const additions = lines
      .filter((l) => !already.has(chargeCopyKey(l)))
      .map((l) => {
        const receivable = l.type !== PAYABLE;
        return {
          ...blankCharge(receivable ? RECEIVABLE : PAYABLE, job?.exRate),
          charge: l.charge ?? null,
          // The master's FULL name when the group does not override it -
          // the same field picking a charge by hand writes, because
          // `particular` is what an invoice prints as the line description.
          particular: l.particular || masterFullName(l.charge),
          description: l.description || '',
          basis: l.basis || PER_SHIPMENT,
          // A group that says nothing about qty or rate leaves the blank
          // charge's own defaults - one, and nothing - rather than a zero,
          // which would read as free.
          ...(l.qty === null || l.qty === undefined ? {} : { qty: l.qty }),
          ...(l.rate_charge === null || l.rate_charge === undefined
            ? {} : { rate_charge: l.rate_charge }),
          ...(l.discount === null || l.discount === undefined ? {} : { discount: l.discount }),
          ...(importedLineCurrency(l, masterOf(l.charge)) ? { currency: importedLineCurrency(l, masterOf(l.charge)) } : {}),
          ...defaultPartyFor(l.charge, receivable),
        };
      })
      /* Priced on the way in, like every other edit on this sheet - setFields
         recomputes these on each change, and a line that arrived without
         passing through it would show a blank net amount until somebody
         touched it. */
      .map((c) => ({
        ...c,
        net_amount: computeNetAmount(c),
        local_amount: computeLocalAmount(c, job),
      }));

    if (!additions.length) {
      openNotification(
        'Nothing to import',
        lines.length
          ? `Every line in ${group.name} is already on this sheet.`
          : `${group.name} has no default charges yet.`,
        'orange',
      );
      return;
    }

    setCharges([...(charges || []), ...additions]);
    openNotification(
      'Imported',
      `${additions.length} line(s) from ${group.name}. Not saved yet — press Save Job.`,
      'green',
    );
  };

  const removeCharge = (target) => {
    setCharges((charges || []).filter((c) => c !== target));
  };

  /**
   * Add the duty reimbursement as a charge line, in one click.
   *
   * Duty the agent paid is money owed back, and the ONLY way it reaches an
   * invoice is as an ordinary charge - the figures on the GD are a record of
   * an assessment, not a receivable. Typing that total by hand into a charge
   * is where it gets mistyped, so the button copies it.
   *
   * Priced at ex-rate 1 regardless of the job's: duty is assessed and paid in
   * local currency, so converting it a second time would inflate it.
   */
  const reimbursable = reimbursableDuty(job);
  const addDutyReimbursement = () => {
    setCharges([...(charges || []), {
      ...blankCharge(RECEIVABLE),
      description: `Duty & taxes reimbursement${job?.gdNumber ? ` - GD ${job.gdNumber}` : ''}`,
      basis: PER_SHIPMENT,
      net_amount: reimbursable,
      currency: 'PKR',
      ex_rate: 1,
      local_amount: reimbursable,
      // Billed to the client the file is being cleared for, which is who the
      // money is owed by. Left blank if the job has no client yet rather than
      // guessed.
      partyId: job?.clientId || null,
      name: (values.party || []).find((p) => p.id === job?.clientId)?.name || null,
    }]);
  };

  // --- selection ------------------------------------------------------------

  /* THE TICK BOX DOES TWO JOBS, and they do not want the same rule.
   *
   * INVOICING needs a saved, approved, unbilled charge - anything else has
   * nothing to invoice, or has been invoiced already.
   *
   * COPYING to the other side needs none of that. A copy is a NEW, unbilled
   * line on the opposite side; it does not touch the line it was copied from.
   * Refusing to copy an invoiced charge - which is what tying the tick box to
   * canInvoice did - stopped an agent mirroring a receivable they had just
   * billed onto the payable side, which is the ordinary way a clearing file is
   * built.
   *
   * So the box is tickable for any SAVED row, and each action applies its own
   * rule to what was ticked. Unsaved rows stay untickable because there is
   * nothing to key them by: the ids are Charge_Head ids, and keying by array
   * position would move a tick onto another row the moment one is added. */
  const canSelect = (c) => Boolean(c.id);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectableIn = (rows) => rows.filter(canSelect).map((c) => c.id);

  const toggleSelectAll = (rows) => {
    const ids = selectableIn(rows);
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.length > 0 && ids.every((id) => next.has(id));
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  /* THE DOCUMENTS BEHIND THE TICKS, to take out of the books and put back.
   *
   * Editing an invoiced job means unapproving its invoices and bills first -
   * an approved one freezes its charges - and that used to be a trip to each
   * document. Tick the lines to change, unapprove their documents here, edit,
   * and approve them again. See functions/invoiceBulkApproval: each document
   * counts once, and a settled one is never offered for unapproving.
   *
   * For whoever may approve job invoices, as on the invoice screen's own
   * Approve / Unapprove toggle (functions/jobDocRights). */
  const approvalTargets = invoiceApprovalTargets(charges, selected);
  const canApproveInvoices = rights.approveInvoices;
  // Taking an approval back is its own right (2026-10-24).
  const canUnapproveInvoices = rights.unapproveInvoices;
  // Raising, apart from changing the charges: a job may be raised from by
  // someone who cannot edit its sheet, and not by someone who can.
  const raiseBlocked = canceled || !rights.raiseInvoices;
  const setInvoiceApproval = (approve) => {
    const docs = approve ? approvalTargets.toApprove : approvalTargets.toUnapprove;
    if (!docs.length) return;
    onInvoiceApproval?.(docs, approve, approve ? [] : approvalTargets.settled, () => setSelected(new Set()));
  };

  // Approving is a deliberate act and is recorded with who did it, because
  // approval is what makes a charge invoiceable.
  const approvalPatch = (approve) => (approve
    ? {
        status: '1',
        approved_by: Cookies.get('loginId') || null,
        approval_date: new Date().toISOString().slice(0, 10),
      }
    : { status: '0', approved_by: null, approval_date: null });

  /* A RECEIVABLE IS APPROVED ONLY ONCE THE JOB IS AT A BILLABLE STATUS - On
     Vessel or DrayOff unless Configuration > Customs says otherwise; that is
     when the client is billed. The server refuses it too; this says why
     before a save is tried. Withdrawing an approval is always allowed. */
  const jobStatuses = useCustomsStatuses().job;
  const waitsForVessel = (c) => receivableWaitsForVessel(c, job?.status, jobStatuses);
  const sayWaitForVessel = () => openNotification(
    'Not yet',
    `Receivable charges can be approved once the job is ${billableLabels(jobStatuses)} - set the Status on the Job Details page.`,
    'orange',
  );

  const toggleApproved = (c) => {
    if (!rights.approveCharges) return;
    if (!isApproved(c) && waitsForVessel(c)) { sayWaitForVessel(); return; }
    setFields(c, approvalPatch(!isApproved(c)));
  };

  /* A charge on an ISSUED document - an approved invoice - is not ours to
     withdraw approval from. One on an UNAPPROVED invoice is: that invoice has
     been taken back out of the ledger, and re-approving it recomputes its
     total from whatever the charges then say. */
  // And only for someone who may approve charges - the server holds approvals
  // back from anyone else (functions/chargeRights).
  const canSetApproval = (c) => !disabled && rights.approveCharges && !isInvoiceLocked(c);

  /* INVOICING APPROVES ON THE WAY (the user, 2026-11-11: create, save,
   * approve, save, invoice was too many steps). A ticked line that is not yet
   * approved goes on the invoice too, approved as it is raised - when the
   * Approve tag itself would approve it for this user: the right to approve
   * charges, no exchange-rate problem, and a receivable only once the job is
   * at a billable status. The server holds it to the same rules
   * (approveChargeIds, routes/customsJobs /makeInvoice). Anyone else's
   * unapproved ticks wait, as before, for someone who may approve them. */
  const approvesAsInvoiced = (c) => !isApproved(c) && canSetApproval(c) && !exRateProblem(c) && !waitsForVessel(c);
  const canInvoice = (c) => Boolean(c.id) && !isInvoiced(c) && (isApproved(c) || approvesAsInvoiced(c));

  /* Invoicing takes the ticked lines that CAN be invoiced, not every ticked
   * line: the same ticks may have been made to copy a billed charge across,
   * or be a line this user may not approve. Nothing is silently dropped - the
   * button counts only the invoiceable ones, so what it says is what it sends. */
  const invoiceableLines = (charges || []).filter((c) => selected.has(c.id) && canInvoice(c));
  const invoiceableCount = invoiceableLines.length;
  // Of those, the ones that will be approved as they are invoiced.
  const approvingCount = invoiceableLines.filter((c) => !isApproved(c)).length;
  // Ticked, not approved, and not this user's to approve now - said under the button.
  const waitingTicks = (charges || []).filter((c) => selected.has(c.id) && c.id && !isInvoiced(c) && !canInvoice(c));

  // approve: raised approved - "Invoice & approve" (the user's request,
  // 2026-10-15); otherwise unapproved, for the director to approve. Either
  // way the unapproved ticks are approved first (approveChargeIds), and the
  // job screen saves anything unsaved before it raises (onInvoice).
  const invoiceSelected = (approve = false) => {
    if (!invoiceableLines.length) return;
    onInvoice?.(invoiceableLines.map((c) => c.id), () => setSelected(new Set()), {
      approve,
      approveChargeIds: invoiceableLines.filter((c) => !isApproved(c)).map((c) => c.id),
    });
  };

  /**
   * Approve or withdraw a whole section at once.
   *
   * A clearance file carries a dozen charges that are all checked together and
   * all approved together; ticking them one at a time is the kind of
   * repetition that gets abandoned half way through, leaving a section that
   * looks approved and is not.
   *
   * A charge with a bad exchange rate is SKIPPED rather than approved - the
   * whole point of the rate rule is that approval is the gate.
   */
  const setSectionApproval = (rows, approve) => {
    if (approve && rows.some((c) => !isApproved(c) && waitsForVessel(c))) {
      sayWaitForVessel();
    }
    const targets = new Set(
      rows.filter((c) => canSetApproval(c)
        && isApproved(c) !== approve
        && (!approve || (!exRateProblem(c) && !waitsForVessel(c))))
    );
    if (!targets.size) return;
    const patch = approvalPatch(approve);
    setCharges((charges || []).map((c) => (targets.has(c) ? { ...c, ...patch } : c)));
  };

  // Open the invoice a charge was billed on, the same way Accounts >
  // Invoice/Bills and the Job Balancing report do it: navigate to the invoice
  // detail page AND register the tab, so it behaves like every other invoice
  // link in the app rather than a dead-end page load.
  const openInvoice = (c) => {
    const invoiceId = c.InvoiceId ?? c.Invoice?.id;
    if (!invoiceId) return;
    Router.push(`/reports/invoice/${invoiceId}`);
    dispatchTab(incrementTab({ label: 'Invoice details', key: '3-17', id: `${invoiceId}` }));
  };

  // --- totals ---------------------------------------------------------------

  const sectionTotal = (rows) => rows.reduce((t, c) => t + computeNetAmount(c), 0);
  const sectionLocalTotal = (rows) => rows.reduce((t, c) => t + computeLocalAmount(c, job), 0);

  const receivableTotal = sectionLocalTotal(rowsOf(RECEIVABLE));
  const payableTotal = sectionLocalTotal(rowsOf(PAYABLE));
  const profit = receivableTotal - payableTotal;

  // The figures the summary bar reports. The same set the aviation sheet
  // shows, minus the per-AWB count a GD has no equivalent of - one
  // declaration, one client, one charge sheet.
  const summary = React.useMemo(() => {
    let count = 0;
    let uninvoiced = 0;
    let badRates = 0;
    const byCurrency = new Map();
    // DISTINCT documents, not charge rows: one invoice carries several charges,
    // so counting rows would badly overstate how many were raised. Receivables
    // become Job Invoices, payables Job Bills.
    const invoiceIds = new Set();
    const billIds = new Set();

    for (const c of charges || []) {
      count++;
      if (exRateProblem(c)) badRates++;
      if (c.InvoiceId ?? c.Invoice?.id) {
        (c.type === PAYABLE ? billIds : invoiceIds).add(c.InvoiceId ?? c.Invoice?.id);
      } else {
        uninvoiced++;
      }
      const key = (c.currency || '').trim().toUpperCase() || '-';
      if (!byCurrency.has(key)) byCurrency.set(key, { currency: key, rec: 0, pay: 0 });
      const bucket = byCurrency.get(key);
      const amount = computeNetAmount(c);
      if (c.type === PAYABLE) bucket.pay += amount; else bucket.rec += amount;
    }

    return {
      // Margin is on the receivable, so it answers "how much of what we bill
      // do we keep" rather than marking up the cost.
      margin: receivableTotal ? (profit / receivableTotal) * 100 : null,
      count,
      uninvoiced,
      badRates,
      invoices: invoiceIds.size,
      bills: billIds.size,
      currencies: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  }, [charges, receivableTotal, profit]);

  const mixed = summary.currencies.length > 1;

  // --- rendering ------------------------------------------------------------

  /* THE SUMMARY - one row per charge head, revenue against cost.
   *
   * REALIZED means settled, not invoiced. A charge sitting on an approved
   * invoice nobody has paid is unrealized; the moment a payment lands it moves
   * across, in proportion to how much of that invoice was settled. Settlement
   * is recorded against the invoice rather than the line, so apportioning by
   * each line's share is the only division the figures support.
   *
   * A DIRECT JOB line is always realized: it is not a document waiting to be
   * paid, it is a voucher that already moved the money.
   */
  const summaryColumns = [
    ['realizedRevenue', 'Realized Revenue'],
    ['unrealizedRevenue', 'Unrealized Revenue'],
    ['totalRevenue', 'Total Revenue'],
    ['realizedCost', 'Realized Cost'],
    ['unrealizedCost', 'Unrealized Cost'],
    ['totalCost', 'Total Cost'],
    ['realizedNet', 'Realized Net'],
    ['unrealizedNet', 'Unrealized Net'],
    ['totalNet', 'Total Net'],
  ];

  const summaryRows = chargeSummary?.rows || [];
  const summaryTotals = chargeSummary?.totals;
  /* THE DIRECT JOB ENTRIES, each opening its entry (asked 2026-11-17) - with
   * its id from directEntryRefs; a server from before that sends the bare
   * numbers, shown as they always were. */
  const directEntries = chargeSummary?.directEntryRefs
    || (chargeSummary?.directEntries || []).map((entryNo) => ({ id: null, entryNo }));

  /* A NEW DIRECT E/R ON THIS FILE, from the Summary (asked 2026-11-17): the
   * Direct Job screen opens with its line already on this job - its number,
   * and the File # that screen would fill for it (see newDirectJobFor). */
  const saved = Boolean(jobId) && jobId !== 'new';
  const mayOpenDirect = can('directJob', 'view');
  const mayAddDirect = can('directJob', 'edit');
  const addDirectEntry = () => newDirectJobFor(dispatchTab, { id: parseInt(jobId, 10), jobNo: job?.jobNo });

  /* TICKING A SUMMARY ROW COPIES ITS DIRECT JOB LINES - see copyAcross. Only a
   * row with Direct Job money can be ticked: a head that is on the sheet alone
   * is ticked on the sheet, where the line itself is. The column is left off
   * altogether when the file has no Direct Job lines. */
  const directPickable = summaryRows.filter((r) => r.fromDirect > 0).map((r) => directKey(r.charge));
  const allDirectPicked = directPickable.length > 0
    && directPickable.every((k) => selectedDirect.has(k));
  const toggleDirect = (key) => setSelectedDirect((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleAllDirect = () => setSelectedDirect(
    allDirectPicked ? new Set() : new Set(directPickable)
  );

  /* EACH ROW'S OWN ENTRIES, beside its charge (the user, 2026-11-20: "the
   * direct job number should be beside the charge itself") - the entries with
   * a line filed under that head, matched by number and type through the lines
   * the server already sends. The note under the table still lists them all. */
  const summaryDirectLines = chargeSummary?.directLines || [];
  const entriesOfRow = (r) => directEntries.filter((e) => summaryDirectLines.some((l) =>
    directKey(l.charge) === directKey(r.charge) && l.entryNo === e.entryNo && (!e.type || l.type === e.type)));
  /** An entry number - a link that opens the entry, for someone who may. */
  const entryLink = (e) => (e.id != null && mayOpenDirect ? (
    <a className='cs-entry' role='link' tabIndex={0}
      title={`Open Direct Job ${e.type === 'revenue' ? 'revenue' : e.type === 'expense' ? 'expense' : 'entry'} ${e.entryNo}`}
      onClick={() => openDirectJobEntry(dispatchTab, e.id)}
      onKeyDown={(ev) => { if (ev.key === 'Enter') openDirectJobEntry(dispatchTab, e.id); }}>
      {e.entryNo}
    </a>
  ) : e.entryNo);
  const entryLinks = (list) => list.map((e, i) => (
    <React.Fragment key={e.id ?? e.entryNo}>{i > 0 && ', '}{entryLink(e)}</React.Fragment>
  ));

  const summarySection = (
    <div className='charge-section is-summary'>
      <div className='charge-section-bar'>
        <b>Summary</b>
        <span className='grey-txt'>
          What this file earned — realized is money settled, not money invoiced
        </span>
        {saved && mayAddDirect && (
          <Tooltip title={`A new Direct Job expense or revenue on ${job?.jobNo || 'this job'}`}>
            <button type='button' className='btn-custom fw-8 charge-add cs-add-direct' onClick={addDirectEntry}>
              Add Direct E/R +
            </button>
          </Tooltip>
        )}
      </div>

      {summaryError ? (
        <div className='charge-rate-note'>
          <ExclamationCircleOutlined /> <b>{summaryError}</b>{' '}
          The charges above are unaffected.
        </div>
      ) : (!jobId || jobId === 'new') ? (
        <div className='cs-empty'>Save the job to see what it earned.</div>
      ) : loadingSummary && !summaryRows.length ? (
        <div className='cs-empty'>Working it out…</div>
      ) : !summaryRows.length ? (
        <div className='cs-empty'>No charges on this file yet.</div>
      ) : (
        <>
          <Table size='sm' className='mb-0 cs-table'>
            <thead>
              <tr>
                {directPickable.length > 0 && (
                  <th className='cs-pick'>
                    <Checkbox
                      checked={allDirectPicked}
                      indeterminate={!allDirectPicked && directPickable.some((k) => selectedDirect.has(k))}
                      disabled={disabled}
                      onChange={toggleAllDirect}
                      title='Tick every row with Direct Job money, to copy it to the charge sheet'
                    />
                  </th>
                )}
                {directPickable.length > 0 && <th className='cs-entries'>Direct Job #</th>}
                <th className='cs-name'>Charge</th>
                {summaryColumns.map(([key, label]) => (
                  <th key={key} className='cs-num'>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((r) => (
                <tr key={r.charge}>
                  {directPickable.length > 0 && (
                    <td className='cs-pick'>
                      <Checkbox
                        checked={selectedDirect.has(directKey(r.charge))}
                        disabled={disabled || !(r.fromDirect > 0)}
                        onChange={() => toggleDirect(directKey(r.charge))}
                        title={r.fromDirect > 0
                          ? 'Tick to copy this head’s Direct Job line(s) to the charge sheet — '
                            + 'an expense with Copy from Payable, a revenue with Copy from Receivable'
                          : 'Nothing from Direct Job here — tick this charge on the sheet above to copy it'}
                      />
                    </td>
                  )}
                  {directPickable.length > 0 && <td className='cs-entries'>{entryLinks(entriesOfRow(r))}</td>}
                  <td className='cs-name'>
                    {/* A Direct Job line booked with no charge head printed
                        a bare "#" here. */}
                    {r.name || (directKey(r.charge) ? `#${r.charge}` : <span className='grey-txt'>No charge head</span>)}
                    {/* WHERE THE MONEY CAME FROM. A row the charge sheet above
                        does not contain is not a mistake - it is the Direct
                        Job money this section exists to surface - but without
                        saying so it reads as one. */}
                    {r.fromDirect > 0 && (
                      <span className='cs-tag' title={'Includes ' + r.fromDirect
                        + ' line(s) entered through Accounts > Direct Job E / R'}>
                        {r.fromCharges ? 'incl. direct job' : 'direct job only'}
                      </span>
                    )}
                  </td>
                  {summaryColumns.map(([key]) => (
                    <td key={key} className={`cs-num${r[key] < 0 ? ' neg' : ''}`}>
                      {money(r[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className='cs-total'>
                {directPickable.length > 0 && <td className='cs-pick' />}
                {directPickable.length > 0 && <td className='cs-entries' />}
                <td className='cs-name'><b>Total</b></td>
                {summaryColumns.map(([key]) => (
                  <td key={key} className={`cs-num${summaryTotals?.[key] < 0 ? ' neg' : ''}`}>
                    <b>{money(summaryTotals?.[key] || 0)}</b>
                  </td>
                ))}
              </tr>
            </tfoot>
          </Table>
          {/* The note listing every Direct Job entry under the table went
              (the user, 2026-11-20): each row names its own beside the charge. */}
        </>
      )}

      <style jsx global>{`
        /* ITS OWN TABLE, deliberately not .charge-table.
           That class is styled for rows of INPUTS - 4px of cell padding and
           a fixed layout pinned by a colgroup - which is right when every
           cell holds a control sized by the browser. Here every cell is text,
           and 4px between a nowrap name and a nowrap figure is no gap at all:
           the charge name ran straight into its first column. */
        .customs-charges .cs-table {
          table-layout: auto;
          width: 100%;
          margin-top: 2px;
          font-size: 12px;
        }
        .customs-charges .cs-table th {
          padding: 4px 14px 6px;
          font-size: 10.5px;
          font-weight: 600;
          color: #8a949e;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          white-space: nowrap;
          border-top: none;
          border-bottom: 1px solid #eceff2;
        }
        .customs-charges .cs-table td {
          padding: 6px 14px;
          vertical-align: middle;
          border-top: none;
        }
        .customs-charges .cs-table tbody tr { border-bottom: 1px solid #f4f6f8; }
        .customs-charges .cs-table tbody tr:last-child { border-bottom: none; }
        .customs-charges .cs-table tbody tr:hover td { background: #fafcff; }

        /* The name takes only what it needs and the figures share the rest, so
           the numbers sit in even columns instead of bunching against it. */
        .customs-charges .cs-table th.cs-name,
        .customs-charges .cs-table td.cs-name {
          text-align: left;
          width: 1%;
          padding-left: 8px;
          padding-right: 24px;
          white-space: nowrap;
          color: #1f2937;
        }
        .customs-charges .cs-table th.cs-num,
        .customs-charges .cs-table td.cs-num {
          text-align: right;
          /* Figures are read down the column and compared, so the digits have
             to line up - proportional numerals do not. */
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        /* The tick column, before the name - as on the sheet above. */
        .customs-charges .cs-table th.cs-pick,
        .customs-charges .cs-table td.cs-pick {
          width: 1%;
          padding-left: 8px;
          padding-right: 0;
          text-align: center;
        }
        /* ONLY AS WIDE AS THE BOX. antd draws a Checkbox inside a <label>, and
           .client-styles gives every label a 170px minimum (styles/
           clientLayout.scss) - which held this column 170px wide, a blank gap
           before the Direct Job # (the user, 2026-11-20). The sheet above has
           fixed column widths, so there it only overflows unseen. */
        .customs-charges .cs-table .ant-checkbox-wrapper {
          min-width: 0 !important;
        }
        /* The row's Direct Job entries, beside its charge - only as wide as
           the numbers. */
        .customs-charges .cs-table th.cs-entries,
        .customs-charges .cs-table td.cs-entries {
          text-align: left;
          width: 1%;
          padding-left: 12px;
          padding-right: 8px;
          white-space: nowrap;
        }
        .customs-charges .cs-table td.cs-num { color: #303a45; }
        .customs-charges .cs-table td.cs-num.neg { color: #c0392b; }
        .customs-charges .cs-table tfoot .cs-total td {
          border-top: 2px solid #e3e7eb;
          background: #fafbfc;
          padding-top: 7px;
          padding-bottom: 7px;
        }

        /* ON ITS OWN LINE, under the name. Inline it had to fit between a long
           charge name and a right-aligned figure, which is exactly where the
           two collided. */
        .customs-charges .cs-tag {
          display: block;
          margin-top: 1px;
          color: #8a949e;
          font-size: 9.5px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .customs-charges .cs-empty {
          padding: 14px 8px; color: #8a949e; font-size: 12px;
        }
        /* At the bar's far end, clear of its caption. */
        .customs-charges .cs-add-direct { margin-left: auto; }
        /* An entry number that opens its Direct E/R. */
        .customs-charges .cs-entry {
          color: #1677ff;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .customs-charges .cs-entry:hover { color: #0958d9; }
      `}</style>
    </div>
  );


  const section = (type) => {
    const rows = rowsOf(type);
    const receivable = type === RECEIVABLE;
    // What is TICKED on the other side - which is what Copy would bring over.
    // Counted rather than merely tested so the button can say the number, and
    // so a disabled button explains itself instead of appearing to do nothing.
    // The Direct Job lines on the other side count too - ticked in the Summary.
    const otherSide = [
      ...rowsOf(receivable ? PAYABLE : RECEIVABLE),
      ...directAsCharges.filter((c) => c.type === (receivable ? PAYABLE : RECEIVABLE)),
    ];
    const otherSideCount = otherSide.length;
    const otherSideSelected = otherSide.filter(isTicked).length;
    const selectable = selectableIn(rows);
    const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
    const netTotal = sectionTotal(rows);
    const localTotal = sectionLocalTotal(rows);

    // The state of the section's approvals, worked out once for the button.
    // `blocked` are the ones a bad exchange rate is holding back - they are
    // counted separately so the button can say so instead of appearing to do
    // nothing when it skips them.
    const settable = rows.filter(canSetApproval);
    const blocked = settable.filter((c) => !isApproved(c) && exRateProblem(c));
    const pending = settable.filter((c) => !isApproved(c) && !exRateProblem(c));
    const allApproved = settable.length > 0 && settable.every(isApproved);
    const bulk = {
      total: settable.length,
      pending: pending.length,
      allApproved,
      disabled: disabled || (allApproved ? settable.length === 0 : pending.length === 0),
      title: allApproved
        ? 'Withdraw approval from every charge in this section'
        : blocked.length
          ? `${pending.length} can be approved; ${blocked.length} need an exchange rate first`
          : 'Approve every charge in this section',
    };

    return (
      <div className={`charge-section ${receivable ? 'is-rec' : 'is-pay'}`}>
        <div className='charge-section-bar'>
          <b>{receivable ? 'Receivable' : 'Payable'}</b>
          {rows.length > 0 && (
            <span className='grey-txt'>
              {rows.filter(isApproved).length}/{rows.length} approved
            </span>
          )}
          {/* The shortcut on hover (the user's request, 2026-10-22). */}
          <Tooltip title={`Add a ${receivable ? 'Receivable' : 'Payable'} line (${chargeRowShortcutLabel(type)})`}>
            <button type='button' className='btn-custom fw-8 charge-add' disabled={disabled}
              onClick={() => addCharge(type)}>
              Add +
            </button>
          </Tooltip>
          {/* IMPORT THE CLIENT'S DEFAULTS - see importGroup.
              Shown on the Receivable bar only, once, because a group carries
              BOTH sides: one on each bar would be two buttons doing the same
              thing, and pressing the second after the first would report
              everything as already imported.
              Straight in when the client is in one group, a menu when it is in
              several - a client can buy two different services, and merging
              two tariffs makes a sheet matching neither. */}
          {receivable && groups.length > 0 && (
            groups.length === 1 ? (
              <button
                type='button'
                className='btn-custom fw-8 charge-add'
                disabled={disabled}
                title={`Bring in the ${groups[0].name} defaults for this client`}
                onClick={() => importGroup(groups[0])}
              >
                <DownloadOutlined /> Import defaults
              </button>
            ) : (
              <Dropdown
                disabled={disabled}
                menu={{
                  items: groups.map((g) => ({
                    key: String(g.id),
                    label: (
                      <span>
                        {g.name}
                        <span className='grey-txt' style={{ marginLeft: 8, fontSize: 11 }}>
                          {(g.Customs_Charge_Group_Lines || []).length} line(s)
                          {g.description ? ` · ${g.description}` : ''}
                        </span>
                      </span>
                    ),
                  })),
                  onClick: ({ key }) => {
                    const picked = groups.find((g) => String(g.id) === String(key));
                    if (picked) importGroup(picked);
                  },
                }}
              >
                <button type='button' className='btn-custom fw-8 charge-add' disabled={disabled}>
                  <DownloadOutlined /> Import defaults ({groups.length})
                </button>
              </Dropdown>
            )
          )}
          {/* Bring the TICKED heads across from the other side - see
              copyAcross. Shown whenever the other side has anything on it, and
              disabled until some of it is ticked: a button that disappears
              leaves nobody anywhere to find out what ticking is for, where a
              disabled one carries the reason in its tooltip. */}
          {otherSideCount > 0 && (
            <button
              type='button'
              className={`btn-custom fw-8 charge-add${otherSideSelected ? '' : ' is-disabled'}`}
              disabled={disabled || otherSideSelected === 0}
              title={otherSideSelected
                ? `Copy the ${otherSideSelected} ticked `
                  + `${receivable ? 'payable' : 'receivable'} line(s) to this side, `
                  + 'with this side’s party. Lines already here are left alone.'
                : `Tick the ${receivable ? 'payable' : 'receivable'} lines to copy first, `
                  + `or a Direct Job ${receivable ? 'expense' : 'revenue'} in the Summary. `
                  + 'A line can only be ticked once the job is saved.'}
              onClick={() => copyAcross(type)}>
              Copy from {receivable ? 'Payable' : 'Receivable'}
              {otherSideSelected > 0 && ` (${otherSideSelected})`}
            </button>
          )}
          {/* Approve the section in one action. Reads as one control with two
              states rather than two buttons, because at any moment only one of
              them does anything. */}
          {bulk.total > 0 && (
            <button
              type='button'
              className={`btn-custom fw-8 charge-add bulk-approve${bulk.disabled ? ' is-disabled' : ''}`}
              disabled={bulk.disabled}
              title={bulk.title}
              onClick={() => setSectionApproval(rows, !bulk.allApproved)}
            >
              {bulk.allApproved
                ? `Unapprove all (${bulk.total})`
                : bulk.pending
                  ? `Approve all (${bulk.pending})`
                  /* Nothing approvable left, but not everything is approved -
                     the rest are held back by their exchange rate. Saying
                     "Approve all (0)" would read as a bug. */
                  : 'Approve all'}
            </button>
          )}
          {/* Only offered on the receivable side, and only when the agent
              actually paid the duty - a reimbursement is money owed TO the
              agent, so it can never be a payable. */}
          {receivable && reimbursable > 0 && (
            <button type='button' className='btn-custom fw-8 charge-add' disabled={disabled}
              title='Add the duty this agent paid as a reimbursable charge'
              onClick={addDutyReimbursement}>
              + Duty reimbursement ({money(reimbursable)})
            </button>
          )}
          <span className='charge-section-total'>
            Total <b>{money(netTotal)}</b>
            {localTotal !== netTotal && (
              <span className='local'>local <b>{money(localTotal)}</b></span>
            )}
          </span>
        </div>

        <Table size='sm' className='mb-0 charge-table'>
          {/* Sums to exactly 100. The table is table-layout:fixed, so these
              ARE the columns - a set adding to 109 would be silently rescaled
              and none of them would be what it says.

              STATUS AND REMOVE WERE 3% EACH, and that is what put the Pending
              tag on top of the remove button. Under table-layout:fixed a cell
              does not grow to fit its contents: an 'Approved' tag with an icon
              is far wider than 3% of this table, so it simply overflowed to
              the right, across the column next door. The two were widened -
              status enough for the longest tag, remove enough for the button
              with its label showing - and the 7% taken back from the three
              free-text columns, which are the ones that can spare it. */}
          <colgroup>
            {/* The three tax columns took their 15% from the free-text
                columns and one point each from basis, qty, currency and net;
                status and remove keep the widths the overflow fix gave them. */}
            <col style={{ width: '3%'  }} />{/* select      */}
            <col style={{ width: '9%'  }} />{/* charge      */}
            <col style={{ width: '9%'  }} />{/* particular  */}
            <col style={{ width: '9%'  }} />{/* party       */}
            <col style={{ width: '7%'  }} />{/* description */}
            <col style={{ width: '6%'  }} />{/* basis       */}
            <col style={{ width: '5%'  }} />{/* qty         */}
            <col style={{ width: '8%'  }} />{/* amount      */}
            <col style={{ width: '5%'  }} />{/* currency    */}
            <col style={{ width: '3%'  }} />{/* tax         */}
            <col style={{ width: '5%'  }} />{/* tax %       */}
            <col style={{ width: '7%'  }} />{/* tax amount  */}
            <col style={{ width: '8%'  }} />{/* net         */}
            <col style={{ width: '8%'  }} />{/* status      */}
            {/* Who entered the line and who last changed it: an icon, its
                three points one each from charge, particular and description. */}
            <col style={{ width: '3%'  }} />{/* audit       */}
            <col style={{ width: '5%'  }} />{/* remove      */}
          </colgroup>
          <thead>
            <tr>
              <th className='text-center'>
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && selectable.some((id) => selected.has(id))}
                  disabled={!selectable.length}
                  onChange={() => toggleSelectAll(rows)}
                  title='Select all invoiceable charges in this section'
                />
              </th>
              <th>Charge</th>
              {/* The charge's full name, as the invoice will print it. Read
                  only - it follows the charge rather than being typed. */}
              <th>Particular</th>
              <th>Party</th>
              <th>Description</th>
              <th>Basis</th>
              {/* Enterable on every line now, whatever the basis - see
                  computeNetAmount. */}
              <th className='num'>Qty</th>
              <th className='num' title='The rate per unit, or the flat fee when the quantity is one. Qty x Amount = Net Amount'>
                Amount
              </th>
              <th>Curr.</th>
              {/* Sales tax on the fee. A line with Tax ticked is what the Sale
                  Tax Invoice prints; the rate comes from Setup > Charges. */}
              <th className='text-center' title='Sales tax on this line - ticked lines go on the Sales Tax Invoice'>Tax</th>
              <th className='num'>Tax %</th>
              <th className='num'>Tax Amt</th>
              <th className='num' title='Qty x Amount, plus tax'>Net Amount</th>
              <th className='text-center'>Status</th>
              <th title='Who entered each line, and who last changed it'></th>
              {/* No width here: under table-layout:fixed the colgroup above
                  decides, and a width on the header would be quietly ignored
                  - which is exactly what happened when it was tried. */}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              /* ON an invoice, against FROZEN BY one - two different
                 questions with two different answers once the invoice has been
                 unapproved. `billed` still says which document the line
                 belongs to, which is what the status chip and the tick's
                 wording are about; `frozen` is what stops it being edited, and
                 an unapproved invoice freezes nothing. */
              const billed = isInvoiced(c);
              const frozen = isInvoiceLocked(c);
              // On an unapproved invoice the line is part of that document:
              // changing it is editing the invoice, a right of its own.
              const locked = disabled || frozen || (billed && !rights.editInvoices);
              const flat = isPerShipment(c);
              // PKR (or nothing picked yet) converts at 1 and is not typed.
              const rateProblem = exRateProblem(c);
              return (
                <tr className={`f ${isApproved(c) ? 'approved' : ''} ${frozen ? 'billed' : ''} ${billed && !frozen ? 'reopened' : ''}`} key={c.id ?? `new-${i}`}>
                  <td className='text-center'>
                    <Checkbox
                      checked={selected.has(c.id)}
                      disabled={!canSelect(c)}
                      onChange={() => toggleSelect(c.id)}
                      title={
                        !c.id ? 'Save the job before ticking this charge'
                          : frozen ? 'Already invoiced — tick it to copy it to the other side'
                          : billed ? 'On an unapproved invoice — edit it here, or tick it to copy it across'
                          : !isApproved(c) ? 'Approve it to invoice it, or tick it to copy it across'
                          : 'Include in invoice, or copy to the other side'
                      }
                    />
                  </td>
                  {/* The charge's SHORT NAME - type a code or short name, or
                      press Enter to search. This column is a tenth of the
                      table - room for the short name, which identifies the
                      line at a glance; the Particular column beside it carries
                      the full name. See ChargeCodeInput and ChargePicker. */}
                  <td>
                    <ChargeCodeInput
                      charge={chargeOf(c)}
                      charges={values.charge}
                      disabled={locked}
                      autoFocus={c === freshRow.current}
                      onPick={(picked) => applyPickedCharge(c, picked)}
                      onSearch={(text) => searchCharge(c, text)}
                    />
                  </td>
                  <td className='particular' title={particularOf(c) || undefined}>
                    {particularOf(c) || <span className='none'>&mdash;</span>}
                  </td>
                  <td>
                    <Select size='small' style={{ width: '100%' }} value={asId(c.partyId)}
                      allowClear showSearch placeholder='Party' optionFilterProp='label'
                      disabled={locked}
                      onChange={(e) => {
                        const party = (values.party || []).find((p) => p.id === e);
                        setFields(c, { partyId: e ?? null, name: party?.name || null });
                      }}
                      options={partyOptions} />
                  </td>
                  <td>
                    <Input size='small' value={c.description || ''} disabled={locked}
                      onChange={(e) => setFields(c, { description: e.target.value })} />
                  </td>
                  <td>
                    <Select size='small' style={{ width: '100%' }}
                      value={flat ? PER_SHIPMENT : PER_UNIT} disabled={locked}
                      onChange={(e) => setFields(c, {
                        basis: e,
                        // Same seed as picking a Per Unit charge - see
                        // defaultQty - so the two routes to the same state
                        // leave the row saying the same thing.
                        //
                        // Moving the other way leaves the quantity alone. It is
                        // a real figure on a flat fee now, and wiping one
                        // somebody typed because they corrected the basis
                        // afterwards would be the screen destroying their work.
                        ...(e === PER_UNIT ? { qty: defaultQty() } : {}),
                      })}
                      options={BASIS_OPTIONS} />
                  </td>
                  {/* BOTH ENTERABLE ON EVERY LINE. They used to be greyed out
                      on a flat fee, because the flat fee was typed into Net
                      Amount and the quantity played no part in it. The
                      quantity is now a real field on every line and the
                      arithmetic is one formula - see computeNetAmount - so a
                      flat fee is simply a line whose quantity is one.

                      Leave the quantity empty and it counts as one, so nothing
                      about entering an ordinary flat fee has changed: type the
                      figure into Amount and it is the net. */}
                  <td className='num'>
                    <InputNumber size='small' controls={false} style={{ width: '100%' }}
                      value={c.qty} disabled={locked} placeholder='1'
                      onChange={(e) => setFields(c, { qty: e })} />
                  </td>
                  <td className='num'>
                    <InputNumber size='small' controls={false} step={0.01} style={{ width: '100%' }}
                      value={c.rate_charge} disabled={locked}
                      onChange={(e) => setFields(c, { rate_charge: e })} />
                  </td>
                  <td>
                    <Select size='small' style={{ width: '100%' }} value={c.currency || undefined}
                      allowClear placeholder={BOOKS_CURRENCY} disabled={locked}
                      onChange={(e) => {
                        const currency = e ?? '';
                        if (isBooksCurrency(currency)) {
                          // Converts at 1 by definition. Set it, and the column
                          // beside this one stops offering it as something to type.
                          setFields(c, { currency, ex_rate: 1 });
                          return;
                        }
                        // Moving to a foreign currency: a rate of 1 is the
                        // BOOKS_CURRENCY rate and certainly not this one, so
                        // clear it rather than leave a wrong number sitting
                        // there looking deliberate.
                        setFields(c, {
                          currency,
                          ex_rate: num(c.ex_rate) === 1 ? null : c.ex_rate,
                        });
                      }}
                      options={CURRENCIES} />
                  </td>
                  <td className='text-center'>
                    <Checkbox
                      checked={isTaxed(c)}
                      disabled={locked}
                      onChange={(e) => setFields(c, e.target.checked
                        // Ticking a line with no rate of its own starts it at
                        // the charge master's.
                        ? { tax_apply: true, taxPerc: num(c.taxPerc) || masterTaxPerc(c) }
                        : { tax_apply: false })}
                    />
                  </td>
                  <td className='num'>
                    <InputNumber size='small' controls={false} step={0.01} style={{ width: '100%' }}
                      value={isTaxed(c) ? taxPercOf(c) : null}
                      disabled={locked || !isTaxed(c)}
                      onChange={(e) => setFields(c, { taxPerc: e ?? 0 })} />
                  </td>
                  <td className='num'>
                    <span className='derived'>{isTaxed(c) ? money(computeTaxAmount(c)) : ''}</span>
                  </td>
                  {/* DERIVED ON EVERY LINE. It was a typed box on a flat fee -
                      the one input that changed meaning with the basis - and
                      there is nothing left for it to mean now that Qty and
                      Amount are both entered: a figure typed here could only
                      disagree with them. */}
                  <td className='num' title={rateProblem || undefined}>
                    <span className={`derived${rateProblem ? ' ex-rate-bad' : ''}`}>
                      {money(computeNetAmount(c))}
                    </span>
                  </td>
                  {/* One tag that reads as state, the same control the
                      aviation sheet uses: invoiced shows the document number
                      and opens it, otherwise the tag IS the approve toggle. */}
                  <td className='text-center'>
                    {billed ? (
                      <Tag
                        color={frozen ? 'blue' : 'gold'}
                        className='invoice-tag'
                        onClick={() => openInvoice(c)}
                        title={frozen
                          ? `Open invoice ${c.Invoice?.invoice_No || ''}`
                          : `Invoice ${c.Invoice?.invoice_No || ''} is unapproved — this charge can be`
                            + ' edited, and re-approving the invoice will use the corrected figures'}
                      >
                        {c.Invoice?.invoice_No || 'Invoiced'}
                        {!frozen && <span className='reopened-note'>unapproved</span>}
                      </Tag>
                    ) : rateProblem ? (
                      /* Approval is what makes a charge invoiceable, so it is
                         the right gate for a rate that cannot be correct - the
                         charge says why rather than silently refusing. */
                      <Tag
                        color='error'
                        className='status-tag is-blocked'
                        icon={<ExclamationCircleOutlined />}
                        title={rateProblem}
                      >
                        Ex-rate
                      </Tag>
                    ) : (
                      <Tag
                        color={isApproved(c) ? 'success' : 'default'}
                        className='status-tag'
                        icon={isApproved(c) ? <CheckCircleFilled /> : <ClockCircleOutlined />}
                        onClick={() => { if (!disabled && !frozen) toggleApproved(c); }}
                        title={!rights.approveCharges ? 'Approving charges needs the right to approve job charges' : isApproved(c)
                          ? `Approved${c.approved_by ? ` by ${c.approved_by}` : ''}` +
                            `${c.approval_date ? ` on ${c.approval_date}` : ''} - click to withdraw`
                          : 'Not approved - click to approve'}
                      >
                        {isApproved(c) ? 'Approved' : 'Pending'}
                      </Tag>
                    )}
                  </td>
                  <td className='text-center'><AuditTip record={c} /></td>
                  <td className='text-center'>
                    {/* Disabled rather than removed on an invoiced charge:
                        deleting it would leave an issued invoice pointing at a
                        line that no longer exists (the server refuses it too),
                        and a control that vanishes reads as a rendering fault
                        where a greyed one reads as a rule.

                        A dustbin, not the black circled cross this used to be:
                        a near-black ✕ is the heaviest mark on a row of figures
                        and reads as "close" rather than "delete". Same
                        component as every other row action - see
                        Components/Shared/RowAction. */}
                    <RowAction
                      Icon={DeleteOutlined}
                      label='Remove'
                      kind='danger'
                      disabled={locked}
                      title={frozen
                        ? 'Invoiced charges cannot be removed'
                        : billed && !rights.editInvoices
                          ? 'On an invoice - removing it needs the right to edit job invoices'
                          : billed
                            ? 'Remove it from this unapproved invoice'
                            : 'Remove this charge'}
                      onClick={() => removeCharge(c)}
                    />
                  </td>
                </tr>
              );
            })}
            {/* colSpan 16 - the number of columns in the colgroup. A wrong
                count is silently clamped by the browser, so nothing looks
                wrong - keep it in step when a column is added. */}
            {!rows.length && (
              <tr><td colSpan={16} className='text-center grey-txt py-3'>
                No {receivable ? 'receivable' : 'payable'} charges yet.
              </td></tr>
            )}
          </tbody>
        </Table>
      </div>
    );
  };

  return (
    <div className='customs-charges'>
      {/* ONE picker for the whole sheet, not one per row: it is a modal, only
          ever open for a single line, and mounting eighty of them to have
          seventy-nine closed is eighty copies of the charge master. */}
      <ChargePicker
        open={Boolean(picking)}
        charges={values.charge}
        value={picking?.charge}
        initialQuery={pickQuery}
        onCancel={() => setPicking(null)}
        onPick={(picked) => { applyPickedCharge(picking, picked); setPicking(null); }}
      />

      {/* The same summary bar the aviation charge sheet carries. Stated as
          labelled figures rather than a run-on line: these are the numbers
          anyone opening this tab is looking for, and they should be readable
          without parsing a sentence. */}
      <div className='charge-summary'>
        <div className='stat'>
          <span className='label'>Receivable</span>
          <span className='value rec'>{money(receivableTotal)}</span>
        </div>
        <div className='stat'>
          <span className='label'>Payable</span>
          <span className='value pay'>{money(payableTotal)}</span>
        </div>
        {/* Named Profit even when it is negative, and coloured rather than
            relabelled: "Loss 12,000" and "Profit -12,000" are the same fact,
            and only one of them can be scanned down a column. */}
        <div className='stat divider'>
          <span className='label'>Profit</span>
          <span className={`value big ${profit < 0 ? 'neg' : 'pos'}`}>{money(profit)}</span>
        </div>
        <div className='stat'>
          <span className='label'>Margin</span>
          <span className={`value ${profit < 0 ? 'neg' : 'pos'}`}>
            {summary.margin === null ? '—' : `${summary.margin.toFixed(1)}%`}
          </span>
        </div>
        <div className='stat'>
          <span className='label'>Charges</span>
          <span className='value muted'>{summary.count}</span>
        </div>
        <div className='stat' title='Distinct documents raised from this declaration&apos;s charges'>
          <span className='label'>Invoices / Bills</span>
          <span className='value muted'>
            {summary.invoices} / {summary.bills}
            {summary.uninvoiced > 0 && (
              <span className='pending-note'>{summary.uninvoiced} uninvoiced</span>
            )}
          </span>
        </div>
        {/* btn-custom, not antd's Button: the app's global styles override
            .ant-btn-primary to the point of invisibility, which is why every
            other button on this screen uses the project class. */}
        <div className='stat invoice-action'>
          {/* COUNTS THE INVOICEABLE TICKS, not every tick. A tick can also
              mean "copy this across", and a button reading "Invoice 5" that
              raises three is worse than one that says three. */}
          {rights.raiseInvoices && <button
            type='button'
            className={invoiceableCount && !raiseBlocked && !invoicing
              ? 'btn-custom fw-8'
              : 'btn-custom fw-8 is-disabled'}
            disabled={!invoiceableCount || raiseBlocked || invoicing}
            onClick={() => invoiceSelected(false)}
            title={'Saves your changes, approves the ticked charges not yet approved, and raises their invoices '
              + 'and bills - unapproved, for the director to approve'}
          >
            <FileTextOutlined style={{ marginRight: 6 }} />
            {invoicing
              ? 'Raising…'
              : invoiceableCount
                ? `Invoice ${invoiceableCount} charge(s)`
                : 'Invoice selected'}
          </button>}
          {/* INVOICE & APPROVE - raised approved, posted to the ledger as they
              are made, for whoever may approve them (the same people who see
              Approve / Unapprove below). Without it they wait for approval. */}
          {canApproveInvoices && rights.raiseInvoices && (
            <button
              type='button'
              className={invoiceableCount && !raiseBlocked && !invoicing ? 'btn-custom fw-8' : 'btn-custom fw-8 is-disabled'}
              disabled={!invoiceableCount || raiseBlocked || invoicing}
              onClick={() => invoiceSelected(true)}
              title={'Saves your changes, approves the ticked charges not yet approved, and raises their invoices '
                + 'and bills already approved - posted to the ledger straight away'}
              style={{ marginLeft: 8 }}
            >
              <FileTextOutlined style={{ marginRight: 6 }} />
              {invoiceableCount ? `Invoice & approve ${invoiceableCount}` : 'Invoice & approve'}
            </button>
          )}
          {/* Unapprove / approve the invoices and bills the ticked lines are
              on - see setInvoiceApproval. Shown only once something ticked is
              on a document, so a sheet with nothing invoiced is unchanged. */}
          {(canApproveInvoices || canUnapproveInvoices) && (approvalTargets.toUnapprove.length > 0
            || approvalTargets.toApprove.length > 0 || approvalTargets.settled.length > 0) && (
            <>
              {canUnapproveInvoices && <button
                type='button'
                className={approvalTargets.toUnapprove.length && !disabled && !approvingInvoices
                  ? 'btn-custom fw-8' : 'btn-custom fw-8 is-disabled'}
                disabled={!approvalTargets.toUnapprove.length || disabled || approvingInvoices}
                title={approvalTargets.settled.length
                  ? `${approvalTargets.settled.map((d) => d.invoice_No).join(', ')} `
                    + 'cannot be unapproved: payments or receipts have been made against them.'
                  : 'Take these invoices and bills out of the ledger so their charges can be edited'}
                onClick={() => setInvoiceApproval(false)}
                style={{ marginLeft: 8 }}
              >
                {approvingInvoices ? 'Working…' : `Unapprove ${approvalTargets.toUnapprove.length} invoice(s)`}
              </button>}
              {canApproveInvoices && <button
                type='button'
                className={approvalTargets.toApprove.length && !disabled && !approvingInvoices
                  ? 'btn-custom fw-8' : 'btn-custom fw-8 is-disabled'}
                disabled={!approvalTargets.toApprove.length || disabled || approvingInvoices}
                title='Approve these invoices and bills again - each is re-totalled from its charges and posted to the ledger'
                onClick={() => setInvoiceApproval(true)}
                style={{ marginLeft: 8 }}
              >
                {`Approve ${approvalTargets.toApprove.length} invoice(s)`}
              </button>}
            </>
          )}
          <span className='hint'>
            {invoiceableCount
              ? `One invoice per party and direction.${approvingCount
                ? ` ${approvingCount} not yet approved - approved as they are invoiced.` : ''}`
              : selected.size
                ? 'None of the ticked charges can be invoiced — they are already '
                  + 'invoiced, or waiting for someone to approve them.'
                : rights.approveCharges
                  ? 'Tick charges to invoice them - any not yet approved are approved as they are invoiced.'
                  : 'Tick approved charges to invoice them.'}
            {invoiceableCount > 0 && waitingTicks.length > 0 && (
              ` ${waitingTicks.length} ticked charge(s) left out: `
              + (waitingTicks.some(waitsForVessel)
                ? `a receivable is approved once the job is ${billableLabels(jobStatuses)}.`
                : waitingTicks.some((c) => exRateProblem(c))
                  ? 'a charge needs an exchange rate before it can be approved.'
                  : 'not approved, and not yours to approve.')
            )}
          </span>
        </div>
      </div>

      {/* Stated once at the top rather than only as red boxes down the
          table: the rows that need fixing may be scrolled out of view, and the
          reason invoicing is refusing to include them should not have to be
          hunted for. */}
      {summary.badRates > 0 && (
        <div className='charge-rate-note'>
          <ExclamationCircleOutlined />{' '}
          <b>
            {summary.badRates} charge{summary.badRates === 1 ? '' : 's'}
            {summary.badRates === 1 ? ' needs' : ' need'} an exchange rate.
          </b>{' '}
          A charge in any currency other than {BOOKS_CURRENCY} converts at its own rate -
          1 is the {BOOKS_CURRENCY} rate, so it would book the charge at its face value.
          These cannot be approved or invoiced until the rate is set.
        </div>
      )}

      {/* Totals above are in the books' currency. If the charges are not all
          in one currency that conversion is doing real work, and the original
          amounts are worth showing rather than hiding behind a single figure. */}
      {mixed && (
        <div className='charge-currency-note'>
          <b>Charges are in {summary.currencies.length} currencies.</b> The totals above are
          in your books&apos; currency, each charge converted at its own ex-rate. Original amounts:
          <div className='charge-currency-rows'>
            {summary.currencies.map((c) => (
              <span key={c.currency}>
                <b>{c.currency}</b> rec {money(c.rec)} · pay {money(c.pay)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ONE PAGE, or THREE TABS (Configuration > Customs). The same three
          parts either way, with the bar of totals above them; ticks, edits
          and the selection for invoicing are the sheet's, so they hold as you
          move between tabs - tick payable lines, open Receivable, copy them
          across. Each tab says how many lines it holds. */}
      {tabbed ? (
        <Tabs
          className='charge-side-tabs'
          activeKey={sideTab}
          onChange={setSideTab}
          items={[
            { key: 'rec', label: `Receivable (${rowsOf(RECEIVABLE).length})`, children: section(RECEIVABLE) },
            { key: 'pay', label: `Payable (${rowsOf(PAYABLE).length})`, children: section(PAYABLE) },
            { key: 'summary', label: 'Summary', children: summarySection },
          ]}
        />
      ) : (
        <>
          {section(RECEIVABLE)}
          {section(PAYABLE)}
          {summarySection}
        </>
      )}

      {/* The visual language is the AVIATION charge sheet's, deliberately.
          A charge row is the same object in both modules - a Charge_Head - and
          the same person works both screens in a day, so a receivable that is
          green there and blue here is a difference that carries no meaning and
          has to be re-learned. Only the rules that describe something customs
          actually has are kept; nothing about AWBs or split legs came over. */}
      <style jsx global>{`
        .customs-charges .ant-tag { margin-right: 0; line-height: 18px; }
        .customs-charges .charge-side-tabs > .ant-tabs-nav { margin-bottom: 8px; }
        .customs-charges .charge-side-tabs .ant-tabs-tab { font-weight: 600; }

        .customs-charges .charge-section {
          border: 1px solid #eee;
          border-left-width: 3px;
          border-radius: 5px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        /* The two sides are told apart by colour, not by reading the heading -
           a payable typed into the receivable table is the one mistake here
           that reaches the ledger unnoticed. Green/red, matching aviation. */
        .customs-charges .charge-section.is-rec { border-left-color: #52c41a; }
        .customs-charges .charge-section.is-pay { border-left-color: #fa541c; }
        .customs-charges .charge-section .charge-table { margin-bottom: 0; }

        .customs-charges .charge-section-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 4px 4px 0 0;
        }
        .customs-charges .charge-section.is-rec .charge-section-bar { background: #f6ffed; }
        .customs-charges .charge-section.is-pay .charge-section-bar { background: #fff2e8; }
        .customs-charges .charge-section-bar .grey-txt::before {
          content: '·';
          margin-right: 8px;
          color: #c8c8c8;
        }
        .customs-charges .charge-section-total {
          margin-left: auto;
          font-size: 12px;
          color: #666;
          font-variant-numeric: tabular-nums;
        }
        .customs-charges .charge-section-total .local {
          margin-left: 10px;
          padding-left: 10px;
          border-left: 1px solid #e0e0e0;
        }
        .customs-charges .charge-add {
          padding: 0 8px;
          font-size: 11px;
          line-height: 20px;
        }

        .customs-charges .charge-table { table-layout: fixed; width: 100%; }
        .customs-charges .charge-table th {
          padding: 0 4px 2px !important;
          font-size: 11px;
          font-weight: 600;
          color: #888;
          border-top: none;
          border-bottom: 1px solid #eee;
          white-space: nowrap;
        }
        .customs-charges .charge-table td {
          padding: 2px 4px !important;
          vertical-align: middle;
          border-top: none;
        }
        .customs-charges .charge-table tbody tr { border-bottom: 1px solid #f2f2f2; }
        .customs-charges .charge-table tbody tr:last-child { border-bottom: none; }
        .customs-charges .charge-table tbody tr:hover td { background: #fafcff; }

        .customs-charges .charge-table th.num { text-align: right; }
        .customs-charges .charge-table td.num .ant-input-number-input { text-align: right; }
        .customs-charges .charge-table td.num .derived,
        .customs-charges .charge-table td.derived {
          display: block;
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: #222;
          font-size: 12px;
        }

        .customs-charges .status-tag {
          cursor: pointer;
          margin-right: 0;
          font-size: 11px;
          line-height: 18px;
          user-select: none;
        }
        .customs-charges .status-tag:hover { opacity: 0.75; }
        /* The invoice number is a link - underlined on hover so it reads as
           one rather than as a label that happens to be clickable. */
        .customs-charges .invoice-tag {
          cursor: pointer;
          margin-right: 0;
          font-size: 11px;
          line-height: 18px;
          user-select: none;
        }
        .customs-charges .invoice-tag:hover { text-decoration: underline; }

        .customs-charges .charge-table tbody tr.approved td { background: #f6ffed; }
        .customs-charges .charge-table tbody tr.approved:hover td { background: #eaffd8; }
        .customs-charges .charge-table tbody tr.approved td:first-child {
          box-shadow: inset 3px 0 0 #52c41a;
        }
        /* An invoiced charge is part of an issued document - read-only, and
           visibly so, rather than looking like an editable row that ignores
           you. */
        /* A REOPENED line is on a document but editable, so it reads as
           neither an ordinary line nor a frozen one. */
        .customs-charges .charge-table tbody tr.reopened td { background: #fffbf0; }
        .customs-charges .charge-table tbody tr.reopened:hover td { background: #fff6e0; }
        .customs-charges .invoice-tag .reopened-note {
          margin-left: 6px;
          font-size: 9.5px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.03em;
          opacity: 0.85;
        }
        .customs-charges .charge-table tbody tr.billed td { background: #f0f5ff; }
        .customs-charges .charge-table tbody tr.billed:hover td { background: #e6efff; }
        .customs-charges .charge-table tbody tr.billed td:first-child {
          box-shadow: inset 3px 0 0 #2f54eb;
        }

        .customs-charges .charge-table .ant-input-number-disabled,
        .customs-charges .charge-table .ant-input-number-disabled input {
          background: #fbfbfb !important;
          border-style: dashed !important;
          color: #bbb !important;
        }
        .customs-charges .ant-input-number-handler-wrap { display: none !important; }
        .customs-charges .ant-input-number-input { padding-right: 6px !important; }

        .customs-charges .charge-summary {
          display: flex;
          align-items: stretch;
          flex-wrap: wrap;
          gap: 4px 28px;
          padding: 8px 14px;
          margin-bottom: 8px;
          background: #fafafa;
          border: 1px solid #eee;
          border-radius: 6px;
        }
        .customs-charges .charge-summary .stat {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 92px;
        }
        .customs-charges .charge-summary .stat.divider {
          border-left: 1px solid #e4e4e4;
          padding-left: 28px;
        }
        .customs-charges .charge-summary .stat.invoice-action {
          margin-left: auto;
          align-items: flex-end;
          gap: 3px;
        }
        .customs-charges .charge-summary .stat.invoice-action .hint {
          font-size: 10px;
          color: #999;
        }
        .customs-charges .charge-summary .stat.invoice-action .btn-custom {
          padding: 3px 14px;
          font-size: 12px;
          white-space: nowrap;
        }
        /* Disabled has to LOOK disabled: btn-custom carries no disabled state
           of its own, so without this it stays fully styled and invites a
           click that does nothing. */
        .customs-charges .charge-summary .btn-custom.is-disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .customs-charges .charge-summary .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
        }
        .customs-charges .charge-summary .value {
          font-size: 15px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          line-height: 1.3;
        }
        .customs-charges .charge-summary .value.big { font-size: 19px; }
        .customs-charges .charge-summary .value.rec { color: #389e0d; }
        .customs-charges .charge-summary .value.pay { color: #d4380d; }
        /* The charge cell: the line's short name, typed or picked
           (ChargeCodeInput). Bold and blue, so it reads as the line's charge. */
        .customs-charges .charge-code input {
          font-size: 12px;
          font-weight: 600;
          color: #1677ff;
        }
        .customs-charges .charge-code input::placeholder {
          font-weight: 400;
          font-family: inherit;
          color: #bfbfbf;
        }
        .customs-charges .charge-summary .value.muted { color: #666; font-weight: 500; }
        /* Sits under the count rather than beside it, so the figure stays
           aligned with the other stats in the row. */
        .customs-charges .charge-summary .pending-note {
          display: block;
          font-size: 10px;
          font-weight: 500;
          color: #d48806;
          line-height: 1.2;
        }
        .customs-charges .pos { color: #389e0d; }
        .customs-charges .neg { color: #cf1322; }

        /* The full charge name. Read-only text in a table of inputs, so it
           is set in the body colour rather than the muted grey used for hints -
           it is data, not a label - and truncates rather than wrapping, which
           would make one row twice the height of its neighbours. */
        .customs-charges .charge-table td.particular {
          font-size: 12px;
          color: #333;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .customs-charges .charge-table td.particular .none { color: #c8c8c8; }

        /* A rate that cannot be right. Red border rather than a red value:
           the problem is usually that the box is EMPTY, and there is no value
           to colour. */
        .customs-charges .charge-table .ex-rate-bad,
        .customs-charges .charge-table .ex-rate-bad .ant-input-number-input {
          border-color: #ff4d4f !important;
          background: #fff2f0 !important;
        }
        .customs-charges .charge-table .ex-rate-bad:focus-within {
          box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.2) !important;
        }
        /* Not a toggle - it says why the row cannot be approved. */
        .customs-charges .status-tag.is-blocked { cursor: help; }
        .customs-charges .status-tag.is-blocked:hover { opacity: 1; }

        .customs-charges .bulk-approve { margin-left: 2px; }
        .customs-charges .charge-add.is-disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .customs-charges .charge-rate-note {
          font-size: 11px;
          line-height: 1.5;
          color: #a8071a;
          background: #fff2f0;
          border: 1px solid #ffccc7;
          border-radius: 6px;
          padding: 6px 10px;
          margin-bottom: 8px;
        }

        .customs-charges .charge-currency-note {
          font-size: 11px;
          line-height: 1.5;
          color: #7a5b00;
          background: #fffbe6;
          border: 1px solid #ffe58f;
          border-radius: 6px;
          padding: 6px 10px;
          margin-bottom: 8px;
        }
        .customs-charges .charge-currency-rows {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 18px;
          margin-top: 3px;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
};

export default Charges;
