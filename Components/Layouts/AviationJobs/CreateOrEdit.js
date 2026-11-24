import React, { useEffect, useState } from 'react';
import { isCompanySelected, NO_COMPANY_TO_SAVE } from 'functions/selectedCompany';
import { Tabs, Input, InputNumber, DatePicker, TimePicker, Select, Spin } from 'antd';
import { Row, Col } from 'react-bootstrap';
import Router from 'next/router';
import Cookies from 'js-cookie';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import moment from 'moment';
import Consignments, { blankLine } from './Consignments';
import Charter from './Charter';
import Charges from './Charges';
import PopConfirm from 'Components/Shared/PopConfirm';
import openNotification from 'Components/Shared/Notification';
import {
  getAviationValues, getAviationJobById,
  createAviationJob, editAviationJob, deleteAviationJob, makeAviationInvoice,
  getRelatedCharges,
} from 'apis/aviationJobs';
// Registered AWB numbers, so the Consignments grid picks a number out of stock
// rather than having one typed at it. Fetched once for the flight and narrowed
// per row - the register is a few thousand rows at most, and a request per
// grid cell would be far worse than holding them.
import { getAvailableAwbs } from 'apis/awbStock';
// One definition of what a leg was asked to carry and what actually flew,
// shared with the consignment grid and mirrored on the backend.
import { flownWeight, carryInOf, withSplitExRates, isInvoiceLocked } from 'functions/aviationPricing';
// A charter prices the whole aircraft as one deal, pre-filled onto the AWBs
// carried for the operating airline. See the module.
import { applyCharterToAll } from 'functions/aviationCharter';
// Rates close with the flight's fortnight - see the module.
import { ratesOpen } from 'functions/aviationFortnight';
// The flight's status, and the fact that flights entered before 1.2.2 spell
// Operated as 'Active'. See the module.
import { STATUSES, OPERATED, statusLabel } from 'functions/aviationStatus';
import { usePageActions } from 'Components/Shared/PageActions';
// The PFM - the plan this flight is built from. A flight no longer accepts a
// typed flight number: it picks a confirmed, unflown, still-future plan and
// takes everything but the weights from it. See functions/aviationPfmImport
// for exactly what crosses over and what deliberately does not.
import { getSelectablePfms, getPfmById } from 'apis/aviationPfm';
import AuditStamp from 'Components/Shared/AuditStamp';
import { useMyPermissions } from 'functions/myPermissions';
import { jobDocRights } from 'functions/jobDocRights';
import { useDocuments } from 'Components/Shared/Documents';
import {
  pfmHeaderPatch, pfmLinesToConsignments, plannedChargeable, realLineCount,
} from 'functions/aviationPfmImport';
// What a flight and its AWBs must carry before they can be saved. Held in one
// module so the grid's header markers, this check and the tests cannot drift.
import {
  isRealLine, missingFlightFields, missingConsignmentFields, rateOrderError,
  charterRateOrderError, awbFormatError, chargeableWeightError,
} from 'functions/aviationValidation';

// Create / edit one aviation job (a flight).
//
// Plain useState rather than react-hook-form + yup, unlike the freight job
// form. The header here is a dozen flat fields and the real content is the
// consignment grid, which react-hook-form would not manage anyway - the
// freight form's resolver also demands ClientId/shipperId/commodityId, none of
// which exist on a flight.
const emptyJob = {
  /* THE PLAN THIS FLIGHT WAS BUILT FROM.
   *
   * A real foreign key rather than a flight number matched by string: flight
   * numbers repeat every week, so matching on one would pair a flight with the
   * plan for the same service a fortnight earlier. Null on every flight
   * entered before the PFM module existed - those are grandfathered and keep
   * the number they were typed with. See the Flight No. field below. */
  AviationPfmId: null,
  flightNo: '', AviationAircraftId: null,
  // The operating airline - whose flight this is. NOT the carrier on each
  // consignment, which says whose cargo that AWB is: a PIA flight carries
  // PIA's own load alongside AWBs for other carriers, so the two are
  // different questions and neither is derived from the other.
  operatingCarrierId: null,
  origin: '', destination: '',
  flightDate: '', departureDate: '',
  // ETD is the plan, ATD is what happened. `departureTime` IS the ATD - the
  // column keeps its old name because renaming it would cost every past flight
  // its departure time to the aviation alter-sync. See the model.
  etd: '', departureTime: '',
  status: OPERATED,
  // The whole aircraft sold as one deal. The three figures are the common
  // rates it is priced at; they reach the AWBs carried for operatingCarrierId
  // and are pre-filled onto them - see functions/aviationCharter.
  charter: false,
  charterBuyingRate: null,
  charterSellingRate: null,
  // One conversion per side, as a consignment carries - see aviationCharter.
  charterBuyingExRate: 1,
  charterSellingExRate: 1,
  // PLA and PFM are the only load figures left on the flight - see LOAD_FIELDS.
  pla: null,
  pfm: null,
  remarks: '',
};

// What is still TYPED on the flight: the plan, and nothing else.
//
// Everything else that used to sit here has moved to the AWB it is actually
// about. GAM Uplift / IFA Loads / Other Carrier were replaced by figures
// counted off the consignments via each carrier's reporting tag, and are shown
// on the monthly sector report rather than repeated on the flight. GAM Offload
// and Other Offload have become a per-AWB Offload column on the Consignments
// tab, because an offload happens to a particular consignment - as two figures
// on the flight they named no cargo and reconciled with nothing.
//
// PFM stays because it is a PLAN rather than an outcome: there is nothing on
// the flight to derive it from. PLA joins it for the same reason and is typed
// per flight rather than read off the aircraft's Max Payload: what the
// airframe can lift is a constant, what is available on the day is what is
// left after fuel for the route and the temperature, and the same aircraft
// leaves with a different figure on different sectors.
//
// PLA first: the two read as a funnel down the row - what could be carried,
// what was planned, what was asked for, what actually flew.
const LOAD_FIELDS = [
  ['pla', 'PLA', 'Payload available on this flight, in kg'],
  // PFM is now FILLED IN by building the flight from a plan - it is the
  // plan's total chargeable weight, which is exactly what this field has
  // always meant. Left editable: a plan is agreed days ahead and the figure
  // is sometimes revised by telephone before the aircraft goes, and the
  // alternative - a read-only box showing a superseded number - is worse than
  // one somebody can correct. The PFM itself keeps the original.
  ['pfm', 'PFM', "Planned figure — filled from the PFM's total chargeable weight"],
];

// antd here is v4, whose pickers take MOMENT objects, not dayjs. Stored as a
// plain string in the shape the rest of the app writes dates, and displayed
// DD-MM-YYYY to match Components/Shared/Form/DateComp.
const D_STORE = 'YYYY-MM-DD';
const D_SHOW  = 'DD-MM-YYYY';
const T = 'HH:mm';

/* How late the flight actually left: ATD minus ETD, as something to read.
 *
 * A plain function rather than anything computed in the component, because the
 * flight screen returns early while it loads - a hook below that return would
 * change the hook order on the render where loading flips.
 *
 * NULL UNLESS BOTH TIMES ARE THERE. A flight with an ETD and no ATD has not
 * gone yet, and calling that "on time" would be a claim about something that
 * has not happened.
 *
 * A NEGATIVE difference is read as EARLY, not as a mistake. Aircraft do leave
 * before their slot, and the alternative - treating anything under zero as a
 * rollover past midnight - would turn a five-minute early departure into a
 * 23h 55m delay. A flight that genuinely leaves after midnight against a
 * late-evening ETD is the real crossover case, and it is entered on the
 * following day's flight; guessing between the two from two clock times alone
 * is what this deliberately does not do.
 */
const departureDelay = (etdText, atdText) => {
  if (!etdText || !atdText) return null;
  const etd = moment(etdText, T, true);
  const atd = moment(atdText, T, true);
  if (!etd.isValid() || !atd.isValid()) return null;

  const mins = atd.diff(etd, 'minutes');
  if (mins === 0) return { late: false, text: 'On time' };

  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const span = `${h ? `${h}h ` : ''}${m}m`;
  return mins > 0
    ? { late: true, text: `${span} late` }
    : { late: false, text: `${span} early` };
};

/**
 * The consignments of a flight, as the grid wants them.
 *
 * A saved flight with no lines still shows one blank row, so the grid is never
 * a dead end with nothing to type into.
 *
 * withSplitExRates seeds the per-side ex-rates from the legacy single one, so
 * an AWB entered before buying and selling had separate conversions opens
 * showing that figure in both boxes rather than two blanks over a value that
 * is still quietly pricing its charges. Saving writes them, and the row has
 * migrated itself - there is no schema migration to run.
 */
const linesFrom = (r) => (r?.Aviation_Consignments?.length
  ? r.Aviation_Consignments.map(withSplitExRates)
  : [{ ...blankLine }]);

const CreateOrEdit = ({ id, companyId }) => {
  const dispatchTab = useDispatch();
  // Treat a missing/garbage id as a new flight rather than trying to load it.
  // A tab registered without an id used to put the literal string "undefined"
  // in the URL, which then reached /edit as the row to update.
  const isNew = !id || id === 'new' || id === 'undefined' || id === 'null';

  const [job, setJob] = useState(emptyJob);
  const [lines, setLines] = useState([{ ...blankLine }]);
  const [values, setValues] = useState({
    party: [], shipper: [], consignee: [], masterAgent: [],
    commodity: [], airport: [], carrier: [], aircraft: [], charge: [],
    // Registered AWB stock, from Setup > AWB Stock.
    awb: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  // Charges for the same AWBs on other flights - the other legs of a split
  // shipment, shown so they can be billed on one invoice.
  const [related, setRelated] = useState({});
  const [jobNo, setJobNo] = useState('');
  const [canceled, setCanceled] = useState(false);
  // Who entered the flight and who last changed it (functions/auditStamp).
  const [stamp, setStamp] = useState({});
  // The user's rights on job charges - see functions/myPermissions.
  const can = useMyPermissions();
  /* The plans this flight may be built from - confirmed, not yet flown, and
   * still dated ahead. The server decides that; see /pfm/selectable, which
   * also puts THIS flight's own plan at the head of the list whatever it
   * fails. Without that, every saved flight would open with an empty flight
   * number box. */
  const [pfmOptions, setPfmOptions] = useState([]);
  // The plan as it was read back with the flight - what the View PFM button
  // opens, and what names the number under the selector.
  const [linkedPfm, setLinkedPfm] = useState(null);
  const [importing, setImporting] = useState(false);

  const set = (field, value) => setJob((j) => ({ ...j, [field]: value }));

  /* ---------------------------- the charter ----------------------------
   * Ticking Charter, or changing one of its three rates, RE-PRICES the AWBs
   * the charter reaches - the ones carried for this flight's own airline. A
   * common rate that had to be copied onto twenty rows by hand would not be a
   * common rate; it would be twenty chances to get one of them wrong.
   *
   * Pre-filled, not imposed: the rows stay editable afterwards, so a rebate
   * or a short-shipped leg can still be expressed without turning the charter
   * off. Rows an approved invoice or a closed fortnight has frozen are left
   * alone - putting a figure on screen that the save is going to drop is
   * worse than leaving the old one visible.
   * ------------------------------------------------------------------ */
  const setCharter = (nextJob) => {
    setJob(nextJob);
    if (!nextJob.charter) return;
    setLines((current) => applyCharterToAll(current, nextJob, ratesFrozen(nextJob)));
  };

  // Rows whose rates may not be touched, as a predicate the charter can skip
  // by. Same two rules the grid greys the cells out on.
  const ratesFrozen = (forJob) => {
    const windowOpen = ratesOpen(forJob?.flightDate);
    return (line) =>
      !windowOpen || (line.Charge_Heads || line.charges || []).some(isInvoiceLocked);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [v, existing, rel, stock] = await Promise.all([
          getAviationValues(),
          getAviationJobById({ id: isNew ? 'new' : id }),
          getRelatedCharges({ jobId: isNew ? null : id }),
          // Never fatal to opening a flight: if the register cannot be read,
          // the AWB cell falls back to being typed rather than the whole
          // screen refusing to load over a Setup list.
          getAvailableAwbs().catch(() => ({ status: 'error', result: [] })),
        ]);
        if (!alive) return;
        if (v?.status === 'success') {
          setValues({ ...v.result, awb: stock?.status === 'success' ? stock.result : [] });
        }
        if (rel?.status === 'success') setRelated(rel.result || {});
        if (existing?.result) {
          const r = existing.result;
          setJobNo(r.jobNo || '');
          setCanceled(Boolean(r.canceled));
          setStamp(r);
          setJob({ ...emptyJob, ...pickHeader(r) });
          setLines(linesFrom(r));
          setLinkedPfm(r.Aviation_Pfm || null);
        }

        /* The selectable plans, fetched AFTER the flight rather than beside
         * it: the request has to carry this flight's own plan as `currentId`,
         * and that is not known until the flight has arrived. One extra
         * round trip on a screen that already makes four, in exchange for a
         * dropdown that cannot silently drop the flight's own number.
         *
         * Never fatal to opening a flight. A flight that will not load
         * because a dropdown could not be filled is a worse failure than a
         * flight whose number cannot be changed until the next reload. */
        const pfms = await getSelectablePfms({
          companyId,
          currentId: existing?.result?.AviationPfmId ?? undefined,
        }).catch(() => null);
        if (!alive) return;
        if (pfms?.status === 'success') setPfmOptions(pfms.result || []);
      } catch (e) {
        openNotification('Error', e?.response?.data?.result || 'Could not load this flight.', 'red');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  /* ------------------ building this flight from a plan ------------------
   * Picking a PFM is not choosing a flight number. It is the statement that
   * THIS FLIGHT IS THAT PLAN - so the header, the consignments and the planned
   * weight all come across in one act. Anything less would leave someone
   * re-typing an airline and twelve AWBs that the office has already agreed
   * once.
   *
   * WHAT CROSSES OVER, AND WHAT DOES NOT, is decided in
   * functions/aviationPfmImport and nowhere else - most importantly the
   * per-line weights, which do NOT: a plan's weights are what an agent says is
   * coming, a flight's are what the warehouse weighed, and copying the first
   * into the second would put a figure nobody measured onto a billable
   * document and make it look done.
   *
   * IT ASKS BEFORE IT REPLACES. A flight that already has consignments has
   * work on it, and the count is in the question rather than a vague "are you
   * sure" - "replace 8 consignments with the 5 on this PFM" is a decision
   * someone can actually take. An empty flight is filled without a prompt,
   * which is the ordinary case: pick the plan, get the flight.
   *
   * The whole plan is fetched here rather than carried in the dropdown. The
   * dropdown holds a dozen lightweight rows; fetching every line of every
   * candidate plan to satisfy one pick would be the wrong shape of request.
   * ------------------------------------------------------------------ */
  const applyPfm = async (pfmId) => {
    setImporting(true);
    try {
      const res = await getPfmById({ id: pfmId });
      if (res?.status !== 'success' || !res.result) {
        openNotification('Error', res?.result || 'Could not read that PFM.', 'red');
        return;
      }
      const plan = res.result;
      const apply = () => {
        setJob((current) => ({ ...current, ...pfmHeaderPatch(plan, current) }));
        setLines(pfmLinesToConsignments(plan, blankLine));
        setLinkedPfm(plan);
        const planned = plannedChargeable(plan);
        openNotification(
          'Built from PFM',
          `${plan.pfmNo} — ${(plan.Aviation_Pfm_Lines || []).length} consignment(s) imported, ` +
          `PFM weight ${planned.toLocaleString()} kg. Pieces and weights are not imported: ` +
          `enter what is actually weighed.`,
          'green'
        );
      };

      const existing = realLineCount(lines, isRealLine);
      if (!existing) { apply(); return; }
      PopConfirm(
        'Replace the consignments on this flight?',
        `This flight has ${existing} consignment(s). Building it from ${plan.pfmNo} replaces ` +
        `them with the ${(plan.Aviation_Pfm_Lines || []).length} on that plan. ` +
        `Anything already invoiced would have to be un-approved first.`,
        apply,
        { okText: 'Replace' }
      );
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not read that PFM.', 'red');
    } finally {
      setImporting(false);
    }
  };

  /* A number typed before PFMs existed keeps showing as itself, rather than
   * this flight opening with a blank where its number was. The same escape,
   * and the same prefix, the consignment grid uses for a legacy AWB. */
  const TYPED_FLIGHT = 't:';

  const pfmSelectOptions = React.useMemo(() => {
    const options = pfmOptions.map((p) => ({
      value: String(p.id),
      // The three facts needed to tell two plans for the same service apart:
      // the flight number, the date it is for, and the document number. The
      // user asked for the job number and the date; the flight number leads
      // because that is what the box is labelled.
      label: [p.flightNo || '(no flight no.)', p.flightDate, p.pfmNo]
        .filter(Boolean).join('  ·  '),
      current: p.current,
    }));
    // A grandfathered flight: entered before PFMs, so there is no plan to
    // point at and its typed number is all there is. Shown, and selectable as
    // itself, so nothing about the flight changes until somebody deliberately
    // attaches a plan.
    if (!job.AviationPfmId && job.flightNo) {
      options.unshift({
        value: `${TYPED_FLIGHT}${job.flightNo}`,
        label: `${job.flightNo}  ·  entered before PFMs`,
        typed: true,
      });
    }
    return options;
  }, [pfmOptions, job.AviationPfmId, job.flightNo]);

  const pickPfm = (key) => {
    // allowClear is off, so this is only ever reached by re-picking the
    // flight's own legacy value - which must change nothing.
    if (!key || String(key).startsWith(TYPED_FLIGHT)) return;
    if (Number(key) === Number(job.AviationPfmId)) return;   // already on it
    applyPfm(Number(key));
  };

  /* -------------------------- refusing to save -------------------------
   * Everything wrong with the flight is collected and reported AT ONCE,
   * rather than stopping at the first problem. A twenty-column grid checked
   * one field per attempt is how someone ends up pressing Save eight times.
   *
   * Blank rows are skipped on the same rule the server drops them by - see
   * isRealLine - so a flight is never refused over an "Add Consignment +"
   * that was never going to be stored.
   * ------------------------------------------------------------------ */
  const problemsWith = () => {
    const problems = [];

    /* A NEW FLIGHT IS BUILT FROM A PLAN. Not an arbitrary rule: the flight
     * number is no longer typed anywhere on this screen, so a new flight
     * without a PFM is a flight with no number and nothing to give it one.
     *
     * EXISTING FLIGHTS ARE GRANDFATHERED, and must be. Every flight entered
     * before this module has no plan and never will, and refusing to save one
     * would make a year of history read-only over a rule it predates. Those
     * keep their typed number and can be attached to a plan later.
     *
     * AND IT IS REPORTED ON ITS OWN. All four required header fields - number,
     * airline, origin, date - are exactly the four the import fills, so a new
     * flight with no plan fails all of them at once. Listing them would send
     * someone looking for a Flight No. box that no longer exists to be typed
     * in. One sentence naming the one thing to do is the whole message. */
    if (isNew && !job.AviationPfmId) {
      problems.push('Flight Info — pick the PFM this flight is built from');
    } else {
      const missingHeader = missingFlightFields(job);
      if (missingHeader.length) {
        problems.push(`Flight Info — ${missingHeader.join(', ')}`);
      }
    }

    // The charter's common pair is checked on the same rule as an AWB's own -
    // it prices every consignment it reaches, so getting it backwards is the
    // same mistake multiplied.
    const charterRates = charterRateOrderError(job);
    if (charterRates) problems.push(`Charter — ${charterRates}`);

    // Numbered by position in the GRID, not among the real rows, so the
    // message points at the row the user can actually see.
    lines.forEach((line, i) => {
      if (!isRealLine(line)) return;
      const missing = missingConsignmentFields(line);
      if (missing.length) {
        problems.push(`Consignment ${i + 1} — ${missing.join(', ')}`);
      }
      const rates = rateOrderError(line);
      if (rates) problems.push(`Consignment ${i + 1} — ${rates}`);
      // A chargeable weight of nought prices every charge on the AWB at
      // nothing, and only one situation earns it - see chargeableWeightError.
      const chargeable = chargeableWeightError(line);
      if (chargeable) problems.push(`Consignment ${i + 1} — ${chargeable}`);
      // Only a DIRECT AWB is typed; everything else was picked from the
      // register and checked when it was registered.
      const awb = awbFormatError(line);
      if (awb) problems.push(`Consignment ${i + 1} — ${awb}`);
    });

    return problems;
  };

  const save = async () => {
    // No company picked: refused here, and by the server - see functions/selectedCompany.
    if (!isCompanySelected(companyId)) {
      openNotification('Error', NO_COMPANY_TO_SAVE, 'red');
      return;
    }
    const problems = problemsWith();
    if (problems.length) {
      openNotification(
        'This flight cannot be saved yet',
        problems.join(' · '),
        'red'
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...job,
        id: isNew ? undefined : id,
        companyId: `${companyId ?? ''}`,
        // Without the right to change a job's charges (the user's request,
        // 2026-10-10) the lines go without them - absent, the route leaves
        // each consignment's charges as they are.
        consignments: can('jobCharges', 'edit') ? lines : lines.map(({ charges, ...line }) => line),
      };
      const employeeId = Cookies.get('loginId');
      const res = isNew
        ? await createAviationJob(payload, employeeId)
        : await editAviationJob(payload, employeeId);

      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not save this flight.', 'red');
        return;
      }
      // The server refuses to change an AWB that has been invoiced. Say so -
      // an edit that was silently dropped is worse than one that was refused.
      openNotification(
        res.warning ? 'Partly saved' : 'Success',
        `Flight ${res.result.jobNo} saved.` + (res.warning ? ` ${res.warning}` : ''),
        res.warning ? 'orange' : 'green'
      );
      if (isNew) {
        // Re-point the tab at the saved flight. It was opened as id:'new', and
        // MainLayout builds this key's URL from tab.id - leaving it would send
        // the next click on that tab back to /aviationJobs/new.
        dispatchTab(incrementTab({ label: res.result.jobNo, key: '10-2', id: res.result.id }));
        Router.push(`/aviationJobs/${res.result.id}`);
        return;
      }
      setJobNo(res.result.jobNo || '');
      setStamp(res.result);
      setLines(linesFrom(res.result));
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save this flight.', 'red');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Raise invoices from the ticked charges.
   *
   * Reloads the flight afterwards rather than patching state by hand: the
   * server decides the invoice numbers and stamps them onto the charges, so
   * re-reading is the only way the screen and the books agree.
   */
  const invoiceCharges = async (chargeIds, onDone) => {
    setInvoicing(true);
    try {
      const res = await makeAviationInvoice({
        chargeIds,
        companyId,
        fiscalYearId: Cookies.get('fiscalYearId'),
        employeeId: Cookies.get('loginId'),
      });
      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not raise the invoice.', 'red');
        return;
      }
      const made = res.result || [];
      // An invoice can be raised but fail to post to the ledger - usually a
      // missing account. It still exists and is approvable by hand, so say so
      // rather than reporting a clean success.
      const unposted = made.filter((m) => m.approved === false);
      openNotification(
        unposted.length ? 'Partly done' : 'Success',
        (made.length === 1
          ? `Invoice ${made[0].invoice_No} raised for ${made[0].lines} charge(s).`
          : `${made.length} invoices raised: ${made.map((m) => m.invoice_No).join(', ')}.`) +
        (unposted.length
          ? ` NOT posted to the ledger: ${unposted.map((m) => m.invoice_No).join(', ')} — ${unposted[0].postError}`
          : ''),
        unposted.length ? 'orange' : 'green'
      );
      onDone?.();
      // Reload the other legs too: an invoice can cover charges from another
      // flight, and those rows are now billed - leaving them tickable would
      // invite a second invoice against the same charge.
      const [fresh, rel] = await Promise.all([
        getAviationJobById({ id }),
        getRelatedCharges({ jobId: id }),
      ]);
      if (fresh?.result) setLines(linesFrom(fresh.result));
      if (rel?.status === 'success') setRelated(rel.result || {});
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not raise the invoice.', 'red');
    } finally {
      setInvoicing(false);
    }
  };

  const cancelFlight = () => {
    PopConfirm('Confirmation', 'Cancel this flight?', async () => {
      try {
        const res = await deleteAviationJob(id, Cookies.get('loginId'));
        if (res.status !== 'success') {
          openNotification('Error', res.result || 'Could not cancel this flight.', 'red');
          return;
        }
        openNotification('Success', 'Flight cancelled.', 'green');
        Router.push('/aviationJobs/list');
      } catch (e) {
        openNotification('Error', e?.response?.data?.result || 'Could not cancel.', 'red');
      }
    });
  };

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  // The per-tag split is NOT shown here any more - it is the monthly sector
  // report's business, and repeating it on the flight only invited the
  // question of which one was authoritative. What is still worth knowing on
  // this screen is how much of the flight is counted at all: an AWB with
  // neither a tag of its own nor a tagged carrier lands in no column of that
  // report. That is the `untagged` figure, and it is a fixable mistake rather
  // than a number to read.
  const upliftByTag = React.useMemo(() => {
    const t = { tagged: 0, untagged: 0 };
    for (const l of lines) {
      // THE AWB'S OWN TAG COUNTS FIRST, matching what the report does (see the
      // server's carrierCategory.tagFor). Without this the warning would call
      // a deliberately tagged AWB untagged whenever its carrier has no tag -
      // sending someone to fix the one case this column was added for.
      const tag = l.reportingTag
        || l.Aviation_Carrier?.category
        || (values.carrier || []).find((c) => c.id === l.AviationCarrierId)?.category;
      // What FLEW: booked less offloaded. Manifest below sums the booked
      // figure, which is why the two are different numbers.
      const w = flownWeight(l);
      if (tag) t.tagged += w;
      else if (w) t.untagged += w;
    }
    return t;
  }, [lines, values.carrier]);

  const totalUplift = upliftByTag.tagged;
  // Offload is recorded per AWB now, so the flight-level figure is a total of
  // its consignments rather than something typed - it cannot disagree with the
  // AWBs it is a total of.
  const totalOffload = lines.reduce((t, l) => t + num(l.offload), 0);
  // What this flight was ASKED to carry - the sum of each AWB's carry-in, NOT
  // of the Gross WT column. Gross is the air waybill's documented total and is
  // repeated on every leg of a split shipment, so summing it would count a
  // 1,000 kg AWB again on the flight that carried the last 300 kg of it. A
  // continuation leg is read against the leg before it instead; see carryInOf,
  // which mirrors the rule the reports use.
  //
  // Derived rather than typed so it can never disagree with the consignments it
  // is a total of; add an AWB and it moves.
  const manifestWeight = lines.reduce((t, l) => t + carryInOf(l), 0);
  const fmtKg = (n) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Charges across every AWB on the flight. Reads whichever key is current:
  // Charge_Heads as the server sends it, charges once the user has edited.
  const chargeCount = lines.reduce(
    (t, l) => t + (l.Charge_Heads || l.charges || []).length, 0
  );

  /* ---------------- a master registered from the grid ------------------
   * The Consignments grid can register a commodity or a master agent without
   * leaving the flight (see AviationJobs/QuickRegister). The new record is
   * dropped into the lists this screen is already holding rather than
   * re-fetching them: /getValues also returns the parties, airports, carriers,
   * aircraft and charges, and asking for all of it again to learn about one
   * new row is the wrong shape of request - and re-setting `values` wholesale
   * would drop the AWB stock, which arrives from a different endpoint.
   *
   * LABELLED EXACTLY AS /getValues LABELS IT, because that is what the row
   * will show after the next reload. A commodity reads "name (HS)" and a party
   * "name (code)"; building either differently here would have the same record
   * named two ways depending on when it was created.
   *
   * A master agent goes into BOTH lists it belongs in: `masterAgent`, which
   * the grid's column picks from, and `party`, which the Charges tab bills
   * from - it was registered with a ledger, so it is billable. A carrier and
   * its party are the same story: the payable side of an AWB defaults to the
   * carrier's party, so a carrier whose party the screen has never heard of
   * would be registered and then still not price a payable.
   *
   * AN AWB NUMBER IS THE ONE EXCEPTION, and is re-read rather than built here.
   * A stock row carries more than a label - the serial and check digit the
   * grid writes onto the line, whether the number still owes cargo, and the
   * whole prefill a continuation leg is filled in from - and /awb/available is
   * what works all of that out. Building a half-row here would produce a
   * number that could be picked but not carried forward. It is one small
   * aviation-only endpoint, so re-reading it is both cheap and exact.
   * ------------------------------------------------------------------ */
  // useCallback because Consignments is React.memo'd and this is one of its
  // props: a new function every render would re-render a twenty-column grid on
  // every keystroke in the flight header. `setValues` is stable, so there is
  // nothing to depend on.
  const addMaster = React.useCallback(async (kind, row, party) => {
    if (kind === 'awb') {
      const stock = await getAvailableAwbs().catch(() => null);
      if (stock?.status === 'success') setValues((v) => ({ ...v, awb: stock.result }));
      return;
    }
    if (!row?.id) return;
    setValues((v) => {
      if (kind === 'commodity') {
        const option = { id: row.id, name: row.hs ? `${row.name} (${row.hs})` : row.name };
        return { ...v, commodity: [...(v.commodity || []), option] };
      }
      if (kind === 'masterAgent') {
        const option = { id: row.id, name: `${row.name} (${row.code})` };
        return {
          ...v,
          masterAgent: [...(v.masterAgent || []), option],
          party: [...(v.party || []), option],
        };
      }
      if (kind === 'airport') {
        // `id` IS the airport CODE - a destination is stored as the code, not
        // as a foreign key, the same shape the freight air jobs put in
        // pol/pod. The flight header's Origin and Destination read this same
        // list, so a newly registered airport reaches those too.
        const option = {
          id: row.airportCode,
          name: `${row.airportName} (${row.airportCode})`,
          city: row.city,
        };
        return { ...v, airport: [...(v.airport || []), option] };
      }
      if (kind === 'carrier') {
        // Shaped as /getValues shapes a carrier: partyId is there because the
        // Charges tab defaults a payable to the airline and resolves it
        // through this field - see carrierPartyFor.
        const carrier = {
          id: row.id, name: row.name, prefix: row.prefix,
          category: row.category, partyId: row.partyId ?? null,
        };
        // Its party, when one was created or linked - but only if the screen
        // does not already hold it. Linking an EXISTING party is the common
        // case, and adding it again would show the same name twice in every
        // charge row's dropdown.
        const known = party?.id && (v.party || []).some((p) => p.id === party.id);
        return {
          ...v,
          carrier: [...(v.carrier || []), carrier],
          party: party?.id && !known
            ? [...(v.party || []), { id: party.id, name: `${party.name} (${party.code})` }]
            : v.party,
        };
      }
      return v;
    });
  }, []);

  // Built once rather than per picker - the airport master runs to thousands
  // of rows on a real install.
  const airportOptions = React.useMemo(
    () => (values.airport || []).map((a) => ({ value: a.id, label: a.name })),
    [values.airport]
  );

  /* ABOVE THE LOADING GUARD, and it has to be.
   *
   * This screen returns a spinner while it fetches, and a hook below that
   * return runs on the renders that get past it and not on the ones that do
   * not - "Rendered more hooks than during the previous render". The actions
   * themselves are happy to be registered early: the handlers are already
   * defined, and a flight that has not arrived yet simply registers a Save
   * that is disabled until it has. */
  /* Save and Cancel Flight move to the toolbar above the tab, where every
     page's Save is. Cancel Flight takes the DELETE slot, and the label says
     what it really does: nothing here is ever deleted - a flight is part of
     the schedule and its number has been quoted - so the destructive verb on
     this screen is cancellation. It asks first, and the toolbar is what asks:
     see Components/Shared/PageActions. */
  // The flight's documents: the paperclip in the toolbar (2026-11-13).
  const docs = useDocuments({ entity: 'Aviation_Job', recordId: isNew ? null : id, title: `Documents - Aviation Job ${jobNo}` });
  usePageActions({
    title: isNew ? 'New Aviation Job' : `Aviation Job ${jobNo}`,
    subtitle: canceled ? 'Cancelled' : undefined,
    save: {
      onClick: save,
      busy: saving,
      disabled: canceled || loading,
      label: 'Save Flight',
      title: canceled ? 'A cancelled flight cannot be edited' : 'Save this flight',
    },
    delete: isNew ? undefined : {
      onClick: cancelFlight,
      disabled: canceled,
      label: 'Cancel Flight',
      confirm: { title: 'Cancel this flight?', body: 'Its cargo figures stop counting toward the month.' },
      title: canceled ? 'This flight is already cancelled' : 'Cancel this flight',
    },
    /* VIEW PFM - the way back to the plan this flight was built from.
     *
     * An extra rather than one of the five fixed slots: those are the verbs
     * every screen has, and this one belongs to the flight alone. Extras are
     * drawn after them, so the five keep their positions - see PageActions.
     *
     * Only offered when there IS a plan. A grandfathered flight has none, and
     * the button is simply absent rather than present and dead: the second leg
     * and the load plan it would show do not exist for that flight either. */
    extras: [docs.extra, ...(job.AviationPfmId ? [{
      key: 'viewPfm',
      // The document's own code as the glyph, not an icon. There is no picture
      // of a PFM, and the toolbar's fallback - the label's first letter - put a
      // bare "V" in the row, which names nothing. See PageActions.
      glyph: 'PFM',
      label: linkedPfm?.pfmNo ? `View ${linkedPfm.pfmNo}` : 'View PFM',
      title: 'Open the PFM this flight was built from — the plan, the load plan and the second leg',
      onClick: () => {
        const label = linkedPfm?.pfmNo || 'PFM';
        dispatchTab(incrementTab({ label, key: '10-4', id: job.AviationPfmId }));
        Router.push(`/aviationPfm/${job.AviationPfmId}`);
      },
    }] : [])],
  }, [saving, canceled, isNew, jobNo, loading, job.AviationPfmId, linkedPfm?.pfmNo, docs.count, docs.saved]);

  if (loading) return <div className='base-page-layout'><Spin /> Loading…</div>;

  const asMoment = (v, fmt) => {
    if (!v) return null;
    const m = moment(v, fmt, true);
    return m.isValid() ? m : null;
  };
  const date = (field) => ({
    value: asMoment(job[field], D_STORE),
    onChange: (d) => set(field, d && d.isValid() ? d.format(D_STORE) : ''),
    format: D_SHOW, style: { width: '100%' }, disabled: canceled,
  });
  const time = (field) => ({
    value: asMoment(job[field], T),
    onChange: (t) => set(field, t && t.isValid() ? t.format(T) : ''),
    format: T, style: { width: '100%' }, disabled: canceled,
  });
  const text = (field) => ({
    value: job[field] || '',
    onChange: (e) => set(field, e.target.value),
    disabled: canceled,
  });

  // How late the flight actually left - see departureDelay.
  const delay = departureDelay(job.etd, job.departureTime);
  // Airport pickers. The stored value is the airport CODE, so a flight saved
  // before its airport was added to the master list still shows that code
  // rather than blanking - Select keeps an unmatched value visible.
  const airport = (field) => ({
    value: job[field] || undefined,
    onChange: (e) => set(field, e ?? ''),
    options: airportOptions,
    showSearch: true, allowClear: true, optionFilterProp: 'label',
    style: { width: '100%' }, disabled: canceled,
  });


  return (
    <div className='client-styles aviation-load' style={{ overflowY: 'auto', overflowX: 'hidden' }}>
      {docs.modal}
      <Tabs defaultActiveKey='1' tabBarExtraContent={!isNew && <AuditStamp record={stamp} />}>
        <Tabs.TabPane tab='Flight Info' key='1'>
          <Row>
            {/* THE FLIGHT NUMBER IS PICKED, NOT TYPED.
                
                Every flight number in the system now originates on a PFM -
                see the field of that name on the PFM form, which is the one
                remaining place one is entered by hand. What is offered here
                is what /pfm/selectable allows: confirmed, not yet flown, and
                still dated ahead. The option shows the flight number, the
                date and the PFM number, because two plans for the same
                weekly service are told apart by the date and by nothing else.
                
                allowClear is OFF. Clearing would leave the flight with no
                number and no way to get one, and "undo the import" is not
                something this control can honestly offer - the consignments
                it brought in are already being worked on. */}
            <Col md={3} className='mt-2'>
              <div title='Picked from a confirmed PFM — see the PFM screen'>
                Flight No. *
              </div>
              <Select
                showSearch
                style={{ width: '100%' }}
                optionFilterProp='label'
                placeholder='Pick the PFM this flight is built from'
                loading={importing}
                value={job.AviationPfmId ? String(job.AviationPfmId)
                  : (job.flightNo ? `${TYPED_FLIGHT}${job.flightNo}` : undefined)}
                disabled={canceled || importing}
                onChange={pickPfm}
                options={pfmSelectOptions}
                notFoundContent={
                  <div className='pfm-empty'>
                    No PFM is available. A flight is built from one that is
                    <b> confirmed</b>, <b>not yet flown</b> and dated <b>today or later</b>.
                  </div>
                }
              />
              {/* What was taken from the plan, said once rather than left to be
                  noticed field by field - but kept to ONE LINE. This sits in a
                  four-across grid row, and a note that wraps makes its column
                  taller than the three beside it and pushes the whole row
                  down. The sentence that will not fit is the tooltip. */}
              {job.AviationPfmId ? (
                <div className='pfm-note'
                  title={'Airline, aircraft, origin, flight date and the consignment list came '
                    + 'from this PFM. Pieces and weights did not - enter what is actually weighed.'}>
                  From <b>{linkedPfm?.pfmNo || 'PFM'}</b> · weights not imported
                </div>
              ) : job.flightNo ? (
                <div className='pfm-note legacy' title='Pick a PFM above to build this flight from a plan'>
                  Entered before PFMs
                </div>
              ) : null}
            </Col>
            <Col md={3} className='mt-2'>
              <div title="The airline operating this flight — not who each AWB belongs to">
                Airline *
              </div>
              {/* Registered in Setup > Carriers, the same master the
                  consignments pick from - but answering a different question.
                  This is whose flight it is; the Carrier column on the
                  Consignments tab is whose cargo each AWB is, and a flight
                  routinely carries other carriers' loads. Picking one here
                  does NOT default the other: the monthly report's ER / IFA /
                  Other split is counted off the consignments, and guessing it
                  from the operating airline would mis-tag the month. */}
              <Select
                showSearch allowClear
                style={{ width: '100%' }}
                optionFilterProp='label'
                placeholder='Whose flight is this?'
                value={job.operatingCarrierId ?? undefined}
                disabled={canceled}
                onChange={(v) => set('operatingCarrierId', v ?? null)}
                options={(values.carrier || []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Col>
            <Col md={3} className='mt-2'>
              <div>Aircraft</div>
              {/* Registered in Setup > Aircraft. The monthly report splits
                  each sector by aircraft, so this cannot be free text. */}
              <Select
                showSearch allowClear
                style={{ width: '100%' }}
                optionFilterProp='label'
                placeholder='Aircraft'
                value={job.AviationAircraftId ?? undefined}
                disabled={canceled}
                onChange={(v) => set('AviationAircraftId', v ?? null)}
                options={(values.aircraft || []).map((a) => ({
                  value: a.id,
                  label: a.description ? `${a.name} — ${a.description}` : a.name,
                }))}
              />
            </Col>
            <Col md={3} className='mt-2'>
              <div>Status</div>
              {/* statusLabel, not job.status: a flight saved before 1.2.2 holds
                  'Active', which is not in the list any more and would render
                  as an empty box. Reading it as Operated shows what it means,
                  and saving writes the new spelling. */}
              <Select style={{ width: '100%' }} value={statusLabel(job.status)} disabled={canceled}
                onChange={(e) => set('status', e)}
                options={STATUSES.map((s) => ({ value: s, label: s }))} />
            </Col>

            <Col md={3} className='mt-2'>
              <div>Origin *</div>
              <Select {...airport('origin')} />
            </Col>
            <Col md={3} className='mt-2'>
              <div>Destination</div>
              <Select {...airport('destination')} />
            </Col>
            <Col md={3} className='mt-2'>
              <div>Flight Date *</div>
              <DatePicker {...date('flightDate')} />
            </Col>
            <Col md={3}></Col>

            <Col md={3} className='mt-2'>
              <div>Departure Date</div>
              <DatePicker {...date('departureDate')} />
            </Col>
            <Col md={3} className='mt-2'>
              <div title='Estimated Time of Departure - the scheduled slot'>ETD</div>
              <TimePicker {...time('etd')} />
            </Col>
            <Col md={3} className='mt-2'>
              {/* The stored field is still `departureTime` - see emptyJob. */}
              <div title='Actual Time of Departure - when the aircraft left'>ATD</div>
              <TimePicker {...time('departureTime')} />
            </Col>
            {/* The delay, said out loud rather than left to be worked out from
                two clock times. It is the reason for keeping both, and reading
                "17:40 / 19:15" and subtracting is exactly the step nobody
                takes when scanning a screen. */}
            <Col md={3} className='mt-2'>
              {delay && (
                <>
                  <div>&nbsp;</div>
                  <div className={delay.late ? 'etd-delay late' : 'etd-delay early'}>
                    {delay.text}
                  </div>
                </>
              )}
            </Col>

            {/* Load sheet. PFM is the only figure typed on a flight now: the
                rest are totals of the AWBs on it, so they cannot disagree with
                the consignments they summarise. */}
            <Col md={12} className='mt-3'>
              <div className='load-box'>
                <div className='load-box-head'>
                  <b>Load Figures</b>
                  <span className='grey-txt'>kg &middot; totalled from the Consignments tab</span>
                </div>
                <Row>
                  {LOAD_FIELDS.map(([field, label, hint]) => (
                    <Col md={2} sm={4} xs={6} key={field} className='mb-2'>
                      <div title={hint}>{label}</div>
                      <InputNumber
                        controls={false}
                        style={{ width: '100%' }}
                        step={0.01}
                        placeholder='0.00'
                        value={job[field]}
                        disabled={canceled}
                        onChange={(v) => set(field, v)}
                      />
                    </Col>
                  ))}
                  {upliftByTag.untagged > 0 && (
                    <Col md={6} sm={8} xs={12} className='mb-2'>
                      <div className='untagged-warn'>
                        <b>{fmtKg(upliftByTag.untagged)} kg</b> on AWBs with no reporting tag —
                        set the carrier, or the AWB&apos;s own Report Tag, on the Consignments
                        tab. Until then that weight counts toward nothing on the monthly report.
                      </div>
                    </Col>
                  )}
                </Row>
                {/* All three derived, none typed. Manifest is everything on
                    the flight; uplift is the part that carries a reporting tag
                    and so actually reaches the monthly report; offload is what
                    was left behind, totalled off the AWBs it happened to. */}
                <div className='load-total'>
                  <span className='label'>Manifest</span>
                  <span className='value'>{fmtKg(manifestWeight)}</span>
                  <span className='formula'>what each AWB was asked to carry</span>

                  <span className='label sep'>Total Uplift</span>
                  <span className='value'>{fmtKg(totalUplift)}</span>
                  <span className='formula'>what flew, less Offload &middot; AWBs with a carrier</span>

                  <span className='label sep'>Offload</span>
                  <span className='value'>{fmtKg(totalOffload)}</span>
                  <span className='formula'>sum of Offload on Consignments</span>
                </div>
              </div>
            </Col>

            <Col md={12} className='mt-2'>
              <div>Remarks</div>
              <Input.TextArea rows={3} {...text('remarks')} />
            </Col>
          </Row>
        </Tabs.TabPane>

        <Tabs.TabPane tab={`Consignments (${lines.filter((x) => x.awb || x.shipperId).length})`} key='2'>
          <Charter
            job={job} lines={lines} carriers={values.carrier} disabled={canceled}
            onChange={setCharter}
          />
          <Consignments lines={lines} setLines={setLines} values={values}
            disabled={canceled} job={job} onRegister={addMaster} />
        </Tabs.TabPane>

        {can('jobCharges', 'view') && (
        <Tabs.TabPane tab={`Charges (${chargeCount})`} key='3'>
          <Charges lines={lines} setLines={setLines} values={values} disabled={canceled || !can('jobCharges', 'edit')}
            rights={jobDocRights(can)} canceled={canceled}
            onInvoice={invoiceCharges} invoicing={invoicing} related={related} job={job} />
        </Tabs.TabPane>
        )}
      </Tabs>

      <style jsx global>{`
        .aviation-load .load-box {
          border: 1px solid #e6eef5;
          border-radius: 6px;
          background: #f6f9fc;
          padding: 10px 12px 6px;
        }
        .aviation-load .load-box-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 8px;
        }
        .aviation-load .load-box-head .grey-txt { font-size: 11px; color: #8a97a3; }
        /* Derived, so it reads as a result rather than a field left disabled. */
        .aviation-load .load-total {
          display: flex;
          align-items: baseline;
          gap: 10px;
          border-top: 1px solid #e6eef5;
          margin-top: 2px;
          padding-top: 7px;
        }
        .aviation-load .load-total .label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #8a97a3;
        }
        .aviation-load .load-total .value {
          font-size: 17px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        /* Two derived figures on one line, each followed by the rule that
           produced it. The formula sits right after its own value rather than
           pushed to the far edge, so it cannot be read against the wrong one. */
        .aviation-load .load-total .formula {
          font-size: 10px;
          color: #aab4be;
          margin-right: 4px;
        }
        .aviation-load .load-total .label.sep {
          margin-left: auto;
          padding-left: 14px;
          border-left: 1px solid #e0e8ef;
        }
        .aviation-load .ant-input-number-handler-wrap { display: none !important; }
        /* Counted, not typed - shown as a value so it does not read as a
           field someone forgot to enable. */
        .aviation-load .derived-figure {
          height: 32px;
          line-height: 30px;
          padding: 0 8px;
          border: 1px dashed #d6e2ec;
          border-radius: 4px;
          background: #fff;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          text-align: right;
        }
        /* The delay reads as a status, not as another field: no box, no
           border, just the sentence where a value would be. */
        .etd-delay { font-size: 12px; font-weight: 600; padding-top: 5px; }
        .etd-delay.late { color: #cf1322; }
        .etd-delay.early { color: #237804; }
        /* What the import did, under the control that did it - so the
           consignments appearing below have an explanation attached to their
           cause rather than only in a notification that has gone. */
        .aviation-load .pfm-note {
          font-size: 10.5px;
          line-height: 1.4;
          color: #5b6b7c;
          margin-top: 3px;
          /* One line, always. A long PFM number must not be able to wrap this
             and make the column taller than the three beside it. */
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .aviation-load .pfm-note.legacy { color: #8a97a3; }
        .aviation-load .pfm-empty {
          font-size: 11px;
          line-height: 1.5;
          padding: 6px 4px;
          color: #8a97a3;
        }
        .aviation-load .untagged-warn {
          margin-top: 18px;
          font-size: 11px;
          line-height: 1.4;
          color: #7a5b00;
          background: #fffbe6;
          border: 1px solid #ffe58f;
          border-radius: 4px;
          padding: 5px 8px;
        }
      `}</style>
    </div>
  );
};

// Only the header fields belong in form state - the row also carries id,
// jobNo, timestamps and its consignments, none of which the inputs own.
const pickHeader = (r) => Object.fromEntries(
  Object.keys(emptyJob).map((k) => [k, r[k] ?? emptyJob[k]])
);

export default CreateOrEdit;
