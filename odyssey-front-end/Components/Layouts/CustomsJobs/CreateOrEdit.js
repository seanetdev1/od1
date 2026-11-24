import React, { useEffect, useRef, useState } from 'react';
import { Tabs, Input, InputNumber, DatePicker, Select, AutoComplete, Spin, Tag, Collapse, Modal, Popover, Empty } from 'antd';
import { Row, Col } from 'react-bootstrap';
import Router from 'next/router';
import Cookies from 'js-cookie';
import { useDispatch, useStore } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import {
  saveCustomsJobDraft, clearCustomsJobDraft,
} from 'redux/customsJobDraft/customsJobDraftSlice';
import moment from 'moment';
import Charges, { CURRENCY_CODES } from './Charges';
import Containers from './Containers';
import PopConfirm from 'Components/Shared/PopConfirm';
import { describeSaveError } from 'functions/saveErrorMessage';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { STATUS_ORDER } from 'functions/customsStatus';
import { useCustomsStatuses, offeredStatuses, startOf } from 'functions/customsStatuses';
import { clientInvoiceNo, hasJobReference } from 'functions/customsJobReference';
import { isCompanySelected, NO_COMPANY_TO_SAVE } from 'functions/selectedCompany';
import { isAdminDesignation } from 'functions/adminDesignation';
import AuditStamp from 'Components/Shared/AuditStamp';
import useClientCreditGuard from 'Components/Shared/useClientCreditGuard';
import { useMyPermissions } from 'functions/myPermissions';
import { jobDocRights } from 'functions/jobDocRights';
import { useDocuments } from 'Components/Shared/Documents';
import {
  useCustomsJobForm, completeLayout, visibleTabs, tabOf, sameTab,
  isFreightForwarding, FREIGHT_FORWARDING, DEFAULT_REFERENCE_LABEL,
} from 'functions/customsJobForm';
import AddPortModal from './AddPortModal';
import { usePageActions } from 'Components/Shared/PageActions';
import { FormOutlined, ProfileOutlined, UnlockOutlined } from '@ant-design/icons';
import {
  getCustomsValues, getCustomsJobById,
  createCustomsJob, editCustomsJob, deleteCustomsJob, makeCustomsInvoice, unlockCustomsJob,
  getCustomsNotes, addCustomsNote,
} from 'apis/customsJobs';
// The curated port and terminal lists are SERVED, not imported - see
// DIRECTIONS / POL_SEA in routes/customsJobs. They used to be four JSON
// files under jsonData/, which .gitignore excludes, so they lived on one
// machine and broke every clean build.

// Create / edit one customs job (a goods declaration).
//
// Plain useState rather than react-hook-form + yup, matching the aviation
// screens: this is a flat set of fields plus a charge sheet, and the freight
// form's resolver demands ClientId/shipperId/commodityId in shapes a clearance
// file does not have.

const emptyJob = {
  // Export by default: CargoLinkers' book is 97% export (12,868 against 340).
  direction: 'Export', transportMode: 'Sea',
  gdNumber: '', gdDate: '', gdType: '', channel: '', collectorate: '',
  clientId: null, shipperId: null, consigneeId: null, CommodityId: null,
  blNo: '', blDate: '', vesselOrFlight: '', voyageNo: '',
  igmNo: '', indexNo: '', pol: '', pod: '', pofd: '',
  clientRef: '', jobRef: '', customFileNo: '',
  deliveryLocation: '', terminal: '', cargoType: '', incoTerms: '',
  netWeight: null, carrierBookingNo: '',
  mblNo: '', mblDate: '', shippingBillNo: '', shippingBillDate: '',
  gpDate: '', containerType: '', deliveryTerms: '', transporterId: null,
  localVendorId: null, chaChbId: null, shippingLineId: null,
  sailingDate: '', jobDate: '', jobType: '', regPageNo: '',
  etaDate: '', arrivalDate: '', deliveryDate: '',
  packages: null, pkgUnit: '', grossWeight: null, containers: '',
  invoiceNo: '', invoiceDate: '', invoiceValue: null, invoiceCurrency: '',
  lcNo: '', formENo: '',
  // The declaration's headline customs value. The duty itself is assessed per
  // item and lives in `dutyLines` state, not on the job.
  assessedValue: null,
  psid: '', dutyPaidDate: '', dutyPaidBy: '',
  // Blank: the status new jobs start at (Configuration > Customs), which the
  // Status box shows and the server writes.
  status: '', goodsDescription: '', remarks: '', exRate: '1',
  // The Program Book's three (see Customs_Plan): moved in with a plan, and
  // kept up on the job after.
  gateInTime: '', cutOff: '', currentStatus: '',
};

// What service this file is for. NOT the legacy booking taxonomy it replaced
// (Booked / Nomination / Direct), which described where a freight booking came
// from and means nothing to a clearing agent. These three are the services
// CargoLinkers actually sells, and the Transporter field keys off them.
// Freight Forwarding is a fourth where Configuration > Customs offers it
// (Essani, 2026-11-14) - see functions/customsJobForm.
const JOB_TYPES = ['Clearing', 'Transport', 'Clearing + Transport'];

// Offered, not enforced. The six the customer asked for cover 14,504 of the
// 15,209 legacy jobs that name a unit - but the other 705 use CASE, BAGS,
// BOXES, PACKETS, DRUMS and a dozen more, so this is a combo box rather than a
// closed list. Restricting it would blank a unit somebody recorded.
//
// Cases is the seventh, asked for after the fact: it was one of the units
// people were typing by hand, which is exactly the evidence that it belonged
// on the list. Bags is the eighth, on the same evidence - 404 jobs on
// CargoLinkers' book say BAGS.
const PACK_UNITS = ['Cartons', 'Cases', 'Bags', 'Roll', 'Bale', 'Pallet', 'Packages', 'PCS'];

// Fallbacks for the pick lists the server serves alongside the values. Used
// only if /getValues fails - the form still renders with working dropdowns
// rather than four empty selects that look like a broken screen.
const FALLBACK_VOCABULARY = {
  directions: ['Import', 'Export'],
  transportModes: ['Sea', 'Air', 'By Road'],
  gdTypes: ['Home Consumption', 'Into-Bond', 'Ex-Bond', 'Export', 'Re-Export', 'Transhipment'],
  channels: ['Green', 'Yellow', 'Red', 'Blue'],
  statuses: STATUS_ORDER,
  dutyPaidBy: ['Client', 'Agent'],
  // Empty rather than a copy of the served lists: a stale duplicate that
  // silently disagrees with the server is worse than a dropdown that is
  // visibly empty because the values call failed.
  polSea: [], polAir: [], terminalSea: [], terminalAir: [],
  cargoTypesSea: ['FCL', 'LCL', 'Part', 'General Cargo', 'Empty'],
  cargoTypesAir: ['LCL', 'Chartered', 'FCL', 'Empty'],
  incoTerms: [],
};

// A card around one part of the document.
//
// The form is 58 fields. As one undifferentiated run of inputs there was no
// way to see where the declaration ended and the consignment began - so each
// group gets its own surface, with the heading attached to it rather than
// floating above a rule. Grouping people can SEE beats grouping they have to
// infer, and it is what makes a long form skimmable.
//
// `hint` is for the one line of context that would otherwise live in a
// comment nobody reads.
const Card = ({ title, hint, children, defaultOpen = true }) => {
  // Collapsible, and open by default. A clerk working a whole file wants
  // everything visible; one correcting a single figure wants the other eight
  // sections out of the way. Their own state rather than a controlled group,
  // so closing one never moves another.
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className={`cj-card${open ? '' : ' cj-card-closed'}`}>
      <button
        type='button'
        className='cj-card-head'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`cj-chevron${open ? ' cj-chevron-open' : ''}`} aria-hidden='true'>›</span>
        <h6 className='cj-card-title'>{title}</h6>
        {hint && <span className='cj-card-hint'>{hint}</span>}
      </button>
      {open && (
        <div className='cj-card-body'>
          <Row>{children}</Row>
        </div>
      )}
    </section>
  );
};

// A labelled field. One component so every label in the form has identical
// weight, colour and spacing - which they did not before, because each was a
// bare <div> and the spacing came from whatever className was nearest.
/**
 * How many columns a field takes at each screen width.
 *
 * BOOTSTRAP MEASURES THE VIEWPORT, NOT THE CONTAINER, and the app's sider is
 * 200px wide. So on a 1024x768 monitor - which plenty of people here still
 * have - the viewport is "large" as far as Bootstrap is concerned while the
 * content area is only ~784px. A flat md={3} put four dropdowns in 784px:
 * 196px each, which is not enough to read a party name in.
 *
 * The ladder gives four across only from 1200px up, three from 992, and two
 * below that - so a 4:3 screen gets 3 x ~260px instead of 4 x 196px.
 */
const SPAN = {
  // A date, a weight, a count or a three-option select does not need a third
  // of the screen. Half-width fields pack two into the space one was taking,
  // which buys back vertical space - the scarce dimension on a 768px-tall
  // monitor - without shrinking any control.
  2:  { md: 4,  lg: 3,  xl: 2 },   // narrow: 6 across at xl, 4 at lg
  3:  { md: 6,  lg: 4,  xl: 3 },   // the normal field
  4:  { md: 6,  lg: 4,  xl: 4 },
  6:  { md: 12, lg: 6,  xl: 6 },
  9:  { md: 12, lg: 9,  xl: 9 },
  10: { md: 12, lg: 10, xl: 10 },
  12: { md: 12 },
};

const F = ({ label, md = 3, hint, children }) => (
  <Col {...(SPAN[md] || { md })} className='cj-field'>
    <label className='cj-label'>
      {label}
      {hint && <span className='cj-hint'>{hint}</span>}
    </label>
    {children}
  </Col>
);

const CHANNEL_COLORS = { Green: 'green', Yellow: 'gold', Red: 'red', Blue: 'blue' };

// antd here is v4, whose pickers take MOMENT objects, not dayjs. Stored as a
// plain string in the shape the rest of the app writes dates, and displayed
// DD-MM-YYYY to match Components/Shared/Form/DateComp.
const D_STORE = 'YYYY-MM-DD';
const D_SHOW  = 'DD-MM-YYYY';

const CreateOrEdit = ({ id, companyId }) => {
  const dispatchTab = useDispatch();
  // A client over its credit limit is not picked without approval -
  // functions/creditBlocks. Only the Client box: not the shipper or consignee.
  const credit = useClientCreditGuard();
  // Configuration > Customs' job statuses - the Status box offers them.
  const jobStatuses = useCustomsStatuses().job;
  // Treat a missing/garbage id as a new job rather than trying to load it. A
  // tab registered without an id used to put the literal string "undefined" in
  // the URL, which then reached /edit as the row to update.
  const isNew = !id || id === 'new' || id === 'undefined' || id === 'null';

  /* ---------------------- surviving a tab switch -----------------------
   * Switching tabs is a Router.push: this page unmounts and every useState
   * in it goes with it. A goods declaration is sixty fields over five pages,
   * so that is a lot of typing to lose to one glance at the job list.
   *
   * The same mechanism the party form uses - see redux/customsJobDraft, and
   * redux/partyDraft which it mirrors.
   *
   * useStore, deliberately, NOT useSelector: this form writes its own draft
   * every few hundred milliseconds while somebody types, and a selector would
   * subscribe to those writes and re-render the whole form on each one. The
   * draft is wanted exactly once, at mount, so it is read straight off the
   * store into a ref - no subscription, no feedback loop.
   * ------------------------------------------------------------------ */
  const reduxStore = useStore();
  const draftKey = isNew ? 'new' : String(id);
  const restored = useRef();
  if (restored.current === undefined) {
    restored.current = reduxStore.getState().customsJobDrafts?.drafts?.[draftKey] || null;
  }
  // Shown to the user, and turned off by Discard. A restored form must not
  // silently disagree with what the database holds.
  const [draftRestored, setDraftRestored] = useState(Boolean(restored.current));

  // Controlled, so a validation error can put the offending page in front of
  // whoever hit Save rather than reporting a field they cannot see. A tab's
  // key from the layout, 'charges', or '@jobDetails' - whichever tab has the
  // Job Details section (see currentTab). Blank: the first tab.
  const [activeTab, setActiveTab] = useState('');

  const [job, setJob] = useState(emptyJob);
  const [charges, setCharges] = useState([]);
  // The declaration's duty, one row per item. Its own state rather than a
  // field on `job`, because it is a list the grid owns - see DutyLines.
  const [dutyLines, setDutyLines] = useState([]);
  // The containers, as rows. Its own state for the same reason as dutyLines:
  // it is a list the grid owns, not a field on the job.
  const [containerRows, setContainerRows] = useState([]);
  const [values, setValues] = useState({
    party: [], client: [], shipper: [], consignee: [],
    commodity: [], port: [], charge: [], vocabulary: FALLBACK_VOCABULARY,
    localVendor: [], chaChb: [], transporter: [], shippingLine: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [approvingInvoices, setApprovingInvoices] = useState(false);
  const [jobNo, setJobNo] = useState('');
  const [canceled, setCanceled] = useState(false);
  // Whether any charge on this job has reached an invoice. The server freezes
  // everything but remarks and status once that is true, so the form does the
  // same rather than letting an edit be silently dropped.
  const [invoiced, setInvoiced] = useState(false);
  // Who opened the job and who last changed it (functions/auditStamp). A job
  // saved before the stamps has its creator from History (createdByName),
  // which a save's reply does not carry - so each part is kept until the
  // same job's reply replaces it.
  const [stamp, setStamp] = useState({});
  // The user's rights on job charges - see functions/myPermissions.
  const can = useMyPermissions();
  // Documents on the Goods Declaration tab rather than Booking Info -
  // Configuration > Customs (the user's request, 2026-10-10).
  const [documentsOnGd, setDocumentsOnGd] = useState(false);
  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/customsDocumentsOnGd')
      .then(({ data }) => { if (alive) setDocumentsOnGd(Boolean(data?.result?.enabled)); })
      .catch(() => { /* not set: Booking Info, as before */ });
    return () => { alive = false; };
  }, []);
  // The Charges tab's Receivable, Payable and Summary on tabs of their own
  // rather than one page - Configuration > Customs (the user, 2026-11-11).
  const [chargeTabs, setChargeTabs] = useState(false);
  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/customsChargeTabs')
      .then(({ data }) => { if (alive) setChargeTabs(Boolean(data?.result?.enabled)); })
      .catch(() => { /* not set: one page, as before */ });
    return () => { alive = false; };
  }, []);
  // How this install lays the screen out and names its parts - the tabs and
  // the sections on each, the S/R Page #'s name, Freight Forwarding, the
  // Commodity box, adding ports, the container size list (Configuration >
  // Customs; Essani's, 2026-11-14). Unset, the screen is as it was.
  const { form: jobForm, loaded: jobFormLoaded } = useCustomsJobForm();
  // The port heading whose Setup > Ports form is open: { field, loading }.
  const [addPort, setAddPort] = useState(null);
  // A CEO / CFO / admin has pressed Unlock on this invoiced job: the
  // declaration is open for ONE save, and re-locks when it is saved or
  // reloaded. The server checks the designation again on that save - see
  // /edit and /unlock in routes/customsJobs.
  const [unlocked, setUnlocked] = useState(false);

  // TRACING NOTES. A dated running log by whoever added it, distinct from the
  // single `remarks` field on the job - remarks gets overwritten, these
  // accumulate. Held in the shared Job_notes table under a customs type.
  const [notes, setNotes] = useState([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState({ title: '', note: '' });
  const [notesBusy, setNotesBusy] = useState(false);

  const set = (field, value) => setJob((j) => ({ ...j, [field]: value }));

  const loadNotes = async () => {
    if (isNew) return;
    setNotesBusy(true);
    try {
      const r = await getCustomsNotes(id);
      setNotes(r?.result || []);
    } catch (e) {
      openNotification('Error', 'Could not load the notes for this job.', 'red');
    } finally {
      setNotesBusy(false);
    }
  };

  const openViewNotes = async () => {
    setNotesOpen(true);
    await loadNotes();
  };

  const saveNote = async () => {
    const title = noteDraft.title.trim();
    const note = noteDraft.note.trim();
    // Both are NOT NULL on the model, so the form says so rather than letting
    // the server answer with a validation error.
    if (!title || !note) {
      openNotification('Error', 'A note needs a title and a body.', 'red');
      return;
    }
    setNotesBusy(true);
    try {
      const r = await addCustomsNote({
        id, title, note,
        createdBy: Cookies.get('username') || 'Unknown',
        employeeId: Cookies.get('loginId'),
      });
      if (r?.status !== 'success') {
        openNotification('Error', r?.result || 'Could not add the note.', 'red');
        return;
      }
      openNotification('Success', 'Note added.', 'green');
      setNoteDraft({ title: '', note: '' });
      setAddOpen(false);
      // Keep the list current whether or not it is open, so View Notes never
      // shows a stale set.
      await loadNotes();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not add the note.', 'red');
    } finally {
      setNotesBusy(false);
    }
  };

  /* INVOICED MEANS LOCKED, EVERYWHERE BUT CHARGES.
   *
   * Once any charge on this job has reached an invoice, every tab of the
   * declaration is read-only - Job Details, Loading Program, Transport,
   * Booking Info and the Goods Declaration - and only the Charges tab stays
   * open, because that is where invoicing itself happens.
   *
   * Remarks and status used to stay editable on the reasoning that neither is
   * a figure the invoice was computed from. They are locked now too: asked
   * for, and defensible - an invoiced declaration is a document somebody has
   * been billed against, and "locked except one tab" is a rule an operator can
   * hold in their head, where "locked except one tab and two fields on
   * another" is not.
   *
   * The cost is worth stating: a GD that is invoiced before it is cleared can
   * no longer be moved to Complete from this screen. If that turns out to be
   * the normal order of work, the narrow fix is to give those two fields
   * `disabled={canceled}` again rather than to unlock the tab. */
  // And for someone who may change this job's charges but not the job itself
  // (the user's request, 2026-10-10): the declaration is shown, its charge
  // sheet is theirs, and the server saves only that.
  const frozen = canceled || (invoiced && !unlocked) || (!isNew && !can('customs', 'edit'));

  // What the server says this job is, with no draft applied. Kept so Discard
  // has something to go back to.
  const savedValues = useRef(null);

  const applyLoaded = (r) => {
    setJobNo(r.jobNo || '');
    setCanceled(Boolean(r.canceled));
    setInvoiced(Boolean(r.invoiced));
    setStamp((prev) => {
      const kept = String(prev.id) === String(r.id) ? prev : {};
      return {
        id: r.id,
        createdBy: r.createdByName || r.createdBy || kept.createdBy,
        createdOn: r.createdOn || kept.createdOn,
        editedBy: r.editedBy || kept.editedBy,
        editedOn: r.editedOn || kept.editedOn,
      };
    });
    // Whatever was loaded or just saved is locked again: an unlock covers one
    // save, and the next special change is a new, recorded unlock.
    setUnlocked(false);
    const loaded = { ...emptyJob, ...pickFields(r) };
    const loadedContainers = r.Customs_Containers || [];
    // The charges too, as THE SAME ARRAY the sheet is given: every edit to
    // the sheet makes a new one, so "not this array" is "changed since it was
    // loaded" - which is how invoicing knows to save first (hasUnsavedChanges).
    const loadedCharges = r.Charge_Heads || [];
    savedValues.current = { job: loaded, containerRows: loadedContainers, charges: loadedCharges };
    setJob(loaded);
    setDutyLines(r.Customs_Duties || []);
    setContainerRows(loadedContainers);
    // CHARGES ALWAYS COME FROM THE SERVER, never from a draft - see the slice.
    // A charge is approved, invoiced and frozen there, and a stale copy
    // restored over the top would re-offer one that has since been billed.
    setCharges(loadedCharges);
  };

  // The draft wins over what was loaded: it is the newer of the two, and the
  // only copy of what was typed. Applied AFTER the load rather than instead of
  // it, so the fields nobody touched still show what the database holds.
  const applyDraft = (draft) => {
    if (!draft) return;
    if (draft.job) setJob((j) => ({ ...j, ...draft.job }));
    if (Array.isArray(draft.containerRows)) setContainerRows(draft.containerRows);
  };

  const discardDraft = () => {
    dispatchTab(clearCustomsJobDraft(draftKey));
    setDraftRestored(false);
    setJob(savedValues.current?.job || emptyJob);
    setContainerRows(savedValues.current?.containerRows || []);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [v, existing] = await Promise.all([
          getCustomsValues(),
          getCustomsJobById({ id: isNew ? 'new' : id }),
        ]);
        if (!alive) return;
        if (v?.status === 'success') {
          setValues({ ...v.result, vocabulary: v.result.vocabulary || FALLBACK_VOCABULARY });
        }
        if (existing?.result) applyLoaded(existing.result);
        // A NEW job has no server record, so applyLoaded never ran and there
        // is no baseline to compare a draft against. Without one the blank
        // form differs from nothing, every empty New Job writes a draft, and
        // the next one opens announcing that it restored an empty form.
        if (!savedValues.current) savedValues.current = { job: emptyJob, containerRows: [] };
        applyDraft(restored.current);
      } catch (e) {
        openNotification('Error', e?.response?.data?.result || 'Could not load this customs job.', 'red');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  /* Mirror the form into the store as it is typed, debounced - a dispatch per
   * keystroke would churn the devtools and re-render every subscriber for
   * nothing.
   *
   * ONLY WHEN IT DIFFERS from what was loaded. Without that test the first
   * render after a load would write the server's own values back as a draft,
   * and the next visit would announce a restored draft that restores nothing -
   * a banner that cries wolf is worse than no banner, because the one time it
   * matters nobody reads it. */
  const draftTimer = useRef(null);
  useEffect(() => {
    if (loading) return undefined;
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      const saved = savedValues.current;
      const same = saved
        && JSON.stringify(saved.job) === JSON.stringify(job)
        && JSON.stringify(saved.containerRows) === JSON.stringify(containerRows);
      if (same) dispatchTab(clearCustomsJobDraft(draftKey));
      else dispatchTab(saveCustomsJobDraft({ id: draftKey, values: { job, containerRows } }));
    }, 400);
    return () => clearTimeout(draftTimer.current);
  }, [job, containerRows, loading, draftKey, dispatchTab]);

  // Says whether it saved (true) or not (false) - invoicing saves first and
  // goes on only if it did. quiet: no "saved" message of its own (a warning
  // or an error is still shown), for a save made on the way to something else.
  const save = async ({ quiet = false } = {}) => {
    // No company picked: refused here, and by the server - see functions/selectedCompany.
    if (!isCompanySelected(companyId)) {
      openNotification('Error', NO_COMPANY_TO_SAVE, 'red');
      return false;
    }
    /* ANY ONE OF S/R PAGE #, CLIENT INVOICE # OR GD # - see
     * functions/customsJobReference. Until then it was the S/R page alone:
     *
     * THE S/R PAGE NUMBER IS THE ONE REQUIRED FIELD.
     *
     * It replaces a gate that demanded a GD number or a B/L number, which was
     * wrong twice over. A file is opened days before the declaration is filed
     * and often before the carrier's document arrives, so it refused to save
     * exactly the jobs people were working on; and the B/L half of it could
     * never be satisfied anyway, because blNo is not a field on this form -
     * so in practice it read "enter a GD number", and there was no way to open
     * a file without one.
     *
     * The shipping register page IS known when the file is opened - it is how
     * the file is opened - so requiring it costs nobody anything and gives
     * every job the reference the clerks actually look them up by. */
    if (!hasJobReference(job)) {
      openNotification('Error', `Enter the ${jobForm.referenceLabel || DEFAULT_REFERENCE_LABEL}, the `
        + `${isFreightForwarding(job) ? 'HBL #' : 'Client Invoice #'} or the GD # - any one will do.`, 'red');
      setActiveTab('@jobDetails');
      return false;
    }
    setSaving(true);
    try {
      const payload = {
        ...job,
        // A job is opened on the day it is opened. Filled in HERE rather than
        // when the form mounts, so an untouched date reads as "not set" while
        // the clerk is working and only becomes today at the moment it is
        // committed - and so editing an old job never quietly restamps it.
        jobDate: job.jobDate || moment().format('YYYY-MM-DD'),
        id: isNew ? undefined : id,
        companyId: `${companyId ?? ''}`,
        fiscalYearId: Cookies.get('fiscalYearId'),
        // Containers ARE sent - the Booking Info page has the grid. Duty is
        // not: no page shows it, and the route treats an ABSENT array as "the
        // screen did not send these" while an EMPTY one means "this GD has
        // none" and deletes them. Sending [] from a screen with no grid would
        // wipe the duty off every migrated job on first save.
        containerRows,
        // NOT dutyLines.
        //
        // The GD Entry screen does not show either grid, so this form has
        // nothing to say about them. The route treats an ABSENT array as "the
        // screen did not send these" and leaves the rows alone, where an EMPTY
        // array means "this GD has none" and deletes them. Sending [] from a
        // screen that simply has no grid would wipe the duty and containers off
        // every migrated job the first time someone opened it and pressed Save.
        // Left out when the user may not change a job's charges (the user's
        // request, 2026-10-10): absent, the route leaves them as they are.
        ...(can('jobCharges', 'edit') ? { charges } : {}),
        // Asks the server to save the declaration through the invoice lock -
        // which it does only for a CEO / CFO / admin, and records.
        ...(unlocked ? { unlocked: true } : {}),
      };
      const employeeId = Cookies.get('loginId');
      const res = isNew
        ? await createCustomsJob(payload, employeeId)
        : await editCustomsJob(payload, employeeId);

      if (res.status !== 'success') {
        openNotification('Error', describeSaveError(res.result, 'Could not save this customs job.'), 'red');
        return false;
      }
      // The server refuses to change a GD that has been invoiced. Say so - an
      // edit that was silently dropped is worse than one that was refused.
      if (!quiet || res.warning) {
        openNotification(
          res.warning ? 'Partly saved' : 'Success',
          `Customs job ${res.result.jobNo} saved.` + (res.warning ? ` ${res.warning}` : ''),
          res.warning ? 'orange' : 'green'
        );
      }
      // The draft has served its purpose - what it held is now in the database,
      // and leaving it would offer to restore it over the top next time.
      dispatchTab(clearCustomsJobDraft(draftKey));
      setDraftRestored(false);
      if (isNew) {
        // Re-point the tab at the saved job. It was opened as id:'new', and
        // MainLayout builds this key's URL from tab.id - leaving it would send
        // the next click on that tab back to /customsJobs/new.
        dispatchTab(incrementTab({ label: res.result.jobNo, key: '11-2', id: res.result.id }));
        Router.push(`/customsJobs/${res.result.id}`);
        return true;
      }
      applyLoaded(res.result);
      return true;
    } catch (e) {
      /* WHY, not just that. This read response.data.result alone, so anything
       * else - an expired session (401, whose body has no result), a request
       * the server's body parser refused, a reply carrying an error OBJECT
       * rather than text - all came out as the same bare "Could not save",
       * with nothing to act on. describeSaveError reads every one of those
       * shapes, as the freight job screen already does. */
      openNotification('Error', describeSaveError(e, 'Could not save this customs job.'), 'red');
      return false;
    } finally {
      setSaving(false);
    }
  };

  /* ANYTHING NOT SAVED YET - the job's fields, its containers, or its charges
   * (any edit to the sheet makes a new array; see applyLoaded). The charges
   * count only for someone whose save sends them: without the right to change
   * charges, a save leaves them out, and saving would not change them. */
  const hasUnsavedChanges = () => {
    const saved = savedValues.current;
    if (!saved) return false;
    return JSON.stringify(saved.job) !== JSON.stringify(job)
      || JSON.stringify(saved.containerRows) !== JSON.stringify(containerRows)
      || (can('jobCharges', 'edit') && saved.charges !== charges);
  };

  /**
   * Raise invoices from the ticked charges.
   *
   * SAVES FIRST when anything is unsaved, and goes on only if that worked (the
   * user, 2026-11-11: create, save, approve, save, invoice was too many
   * steps) - the server invoices what is stored, so an approval or a rate
   * still on screen would otherwise be invoiced as it was before.
   * approveChargeIds: the ticked charges to approve as they are invoiced -
   * see Charges' approvesAsInvoiced and the server's /makeInvoice.
   *
   * Reloads the job afterwards rather than patching state by hand: the server
   * decides the invoice numbers and stamps them onto the charges, so
   * re-reading is the only way the screen and the books agree.
   */
  // approve: "Invoice & approve" - raised approved, posted as they are made.
  const invoiceCharges = async (chargeIds, onDone, { approve = false, approveChargeIds = [] } = {}) => {
    // Busy from the first moment, the save included: a second click while it
    // saves would otherwise start a second save and a second raise.
    setInvoicing(true);
    try {
      if (hasUnsavedChanges() && !(await save({ quiet: true }))) return;
      const res = await makeCustomsInvoice({
        chargeIds,
        companyId,
        fiscalYearId: Cookies.get('fiscalYearId'),
        employeeId: Cookies.get('loginId'),
        approve,
        approveChargeIds,
      });
      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not raise the invoice.', 'red');
        return;
      }
      const made = res.result || [];
      // An invoice can be raised but fail to post to the ledger - usually a
      // missing account. It still exists and is approvable by hand, so say so
      // rather than reporting a clean success.
      //
      // Invoices AND bills are raised UNAPPROVED on purpose: the director
      // signs and sends an invoice (and checks a bill), then approves it to
      // post it. Said, so it is not taken for a failure.
      const awaiting = made.filter((m) => m.awaitingApproval);
      const unposted = made.filter((m) => m.approved === false && !m.awaitingApproval);
      openNotification(
        unposted.length ? 'Partly done' : 'Success',
        (made.length === 1
          ? `Invoice ${made[0].invoice_No} raised${made[0].approved ? ' and approved' : ''} for ${made[0].lines} charge(s).`
          : `${made.length} invoices raised${approve && !unposted.length ? ' and approved' : ''}: ${made.map((m) => m.invoice_No).join(', ')}.`) +
        (awaiting.length
          ? ` ${awaiting.map((m) => m.invoice_No).join(', ')} awaiting approval - nothing reaches the ledger until it is approved.`
          : '') +
        (unposted.length
          ? ` NOT posted to the ledger: ${unposted.map((m) => m.invoice_No).join(', ')} — ${unposted[0].postError}`
          : '') +
        (res.approvedCharges
          ? ` ${res.approvedCharges} charge(s) approved on the way.`
          : ''),
        unposted.length ? 'orange' : 'green'
      );
      onDone?.();
      const fresh = await getCustomsJobById({ id });
      if (fresh?.result) applyLoaded(fresh.result);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not raise the invoice.', 'red');
    } finally {
      setInvoicing(false);
    }
  };

  /* Unapprove, or approve again, the invoices and bills behind the ticked
   * charge lines - see Charges' setInvoiceApproval.
   *
   * ONE AT A TIME, through the same two routes the invoice screen's toggle
   * uses, so each document is approved or unapproved exactly as it would be
   * there: approval re-totals it from its charges and posts it, unapproval
   * takes its voucher out. A document that fails is reported by number and the
   * rest carry on - one refusal is no reason to leave the others half done. */
  const setInvoiceApproval = (docs, approve, settled, onDone) => {
    const run = async () => {
      setApprovingInvoices(true);
      const done = [];
      const failed = [];
      try {
        for (const d of docs) {
          try {
            const res = await axiosClient.post(
              `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/${approve ? 'approve' : 'unApprove'}`,
              { id: d.id, fiscalYearId: Cookies.get('fiscalYearId'), employeeId: Cookies.get('loginId') },
            );
            if (res.data?.status === 'success') done.push(d.invoice_No);
            else failed.push(`${d.invoice_No}: ${res.data?.result || 'refused'}`);
          } catch (e) {
            failed.push(`${d.invoice_No}: ${e?.response?.data?.result || e.message || 'failed'}`);
          }
        }
        const verb = approve ? 'approved' : 'unapproved';
        const skipped = (settled || []).map((d) => d.invoice_No);
        openNotification(
          failed.length ? (done.length ? 'Partly done' : 'Error') : 'Success',
          [
            done.length ? `${done.length} ${verb}: ${done.join(', ')}.` : '',
            failed.length ? `Not ${verb}: ${failed.join('; ')}` : '',
            skipped.length ? `Left approved - payments or receipts against them: ${skipped.join(', ')}.` : '',
          ].filter(Boolean).join(' '),
          failed.length ? (done.length ? 'orange' : 'red') : 'green',
        );
        if (done.length) onDone?.();
        const fresh = await getCustomsJobById({ id });
        if (fresh?.result) applyLoaded(fresh.result);
      } finally {
        setApprovingInvoices(false);
      }
    };

    if (approve) { run(); return; }
    PopConfirm(
      'Unapprove invoices',
      `Take ${docs.length} invoice(s) / bill(s) out of the ledger so their charges can be edited? `
        + `(${docs.map((d) => d.invoice_No).join(', ')}) `
        + 'Approve them again here once the job is corrected.',
      run,
      { okText: 'Unapprove' },
    );
  };

  /* UNLOCK - CEO, CFO and admin only. Opens an invoiced declaration for one
   * save without un-approving its invoice. The server records the unlock in
   * History, and records the save that follows as "Edit (unlocked)", so a
   * special change to an invoiced job can always be traced. */
  const unlockJob = () => {
    PopConfirm(
      'Unlock this invoiced job?',
      'The declaration will open for one save. The unlock and your changes are recorded in History under your name. '
        + 'Charges already on an approved invoice stay locked.',
      async () => {
        try {
          const res = await unlockCustomsJob(id, Cookies.get('loginId'));
          if (res.status !== 'success') {
            openNotification('Error', res.result || 'Could not unlock this job.', 'red');
            return;
          }
          setUnlocked(true);
          openNotification('Unlocked', `${jobNo || 'This job'} is open for editing until you save it.`, 'orange');
        } catch (e) {
          openNotification('Error', e?.response?.data?.result || 'Could not unlock this job.', 'red');
        }
      },
    );
  };

  const cancelJob = () => {
    PopConfirm('Confirmation', 'Cancel this customs job?', async () => {
      try {
        const res = await deleteCustomsJob(id, Cookies.get('loginId'));
        if (res.status !== 'success') {
          openNotification('Error', res.result || 'Could not cancel this job.', 'red');
          return;
        }
        openNotification('Success', 'Customs job cancelled.', 'green');
        Router.push('/customsJobs/list');
      } catch (e) {
        openNotification('Error', e?.response?.data?.result || 'Could not cancel.', 'red');
      }
    });
  };

  // Duty, as the server will compute it. Derived on every keystroke rather
  // than on save so the total can never disagree with the heads above it.
  // Reimbursable duty needs BOTH halves: the amount comes off the duty lines,
  // and whether it is owed back at all is dutyPaidBy on the job. The total and
  // NO DUTY TOTALS COMPUTED HERE. The duty grid is not mounted on this form -
  // CargoLinkers records duty as ordinary charge lines, and their
  // Log_DutyCalculation is empty - so `reimbursableDuty` was being called and
  // its answer thrown away. Customs_Duty and functions/customsDuty.js are kept
  // deliberately: the cascade is written and tested, and a customer who does
  // assess duty item by item gets it back cheaply.

  const portOptions = React.useMemo(
    () => (values.port || []).map((p) => ({ value: p.id, label: p.name })),
    [values.port]
  );

  // The invoices this declaration has been billed on. Derived from the charge
  // lines rather than fetched: every charge already carries the Invoice it
  // sits on, so the list is free and cannot disagree with the Charges tab.
  const invoiceList = React.useMemo(() => {
    const seen = new Map();
    for (const c of charges || []) {
      const inv = c?.Invoice;
      if (inv?.id && !seen.has(String(inv.id))) seen.set(String(inv.id), inv);
    }
    return [...seen.values()];
  }, [charges]);

  // The job's scans - the paperclip on the toolbar (2026-11-13).
  const docs = useDocuments({
    entity: 'Customs_Job',
    recordId: isNew ? null : id,
    title: `Documents - Job ${jobNo}`,
  });

  /* THE TOOLBAR - the app's own Save / Delete row (PageActions), where this
   * screen used to draw its own buttons in its sticky header. The header
   * keeps what it SHOWS - the pills, the GD and B/L, the invoices - and the
   * verbs moved up, where they sit on every other screen. The toolbar never
   * scrolls, so Save is as reachable from the cargo section as it was.
   *
   * Above the loading return: it is a hook. */
  usePageActions({
    title: isNew ? 'New Customs Job' : (jobNo || 'Customs Job'),
    subtitle: [job.direction, job.transportMode, canceled ? 'Cancelled' : (invoiced ? 'Invoiced' : '')]
      .filter(Boolean).join(' · ') || undefined,
    /* No New here: this form keeps its state when the address changes, so
     * a new job opened from it would start with this one's fields. The list's
     * New is the way in. */
    /* ENABLED on an invoiced job, because charges are saved through it -
     * they travel in the job's payload. The declaration fields are disabled
     * and the server refuses them anyway, so what this saves on an invoiced
     * job is exactly the charges, and it says so. On a cancelled job it saves
     * the status alone - the server reads nothing else there. */
    save: {
      onClick: () => save(),
      busy: saving,
      disabled: loading,
      label: 'Save Job',
      title: canceled
        ? 'Saves the status alone - any status but Canceled reopens the job'
        : (invoiced && !unlocked ? 'Saves the charges — the declaration is locked' : 'Save this job'),
    },
    // Cancelling is what a customs job has instead of deleting. It asks
    // first, itself (cancelJob).
    delete: isNew ? undefined : {
      onClick: cancelJob,
      disabled: canceled,
      label: 'Cancel Job',
      title: canceled ? 'This job is already cancelled' : 'Cancel this customs job',
    },
    // Notes and documents need a saved job to hang off.
    extras: [
      docs.extra,
      {
        key: 'addNote', label: 'Add Note', Icon: FormOutlined,
        onClick: () => setAddOpen(true), disabled: isNew,
        title: isNew ? 'Save the job first' : 'Add a note to this job',
      },
      {
        key: 'viewNotes', label: 'View Notes', Icon: ProfileOutlined,
        onClick: openViewNotes, disabled: isNew,
        title: isNew ? 'Save the job first' : "This job's notes",
      },
      // Offered to the three who may use it; the server refuses anyone
      // else whatever the screen shows.
      ...(!isNew && invoiced && !canceled && !unlocked && isAdminDesignation() ? [{
        key: 'unlock', label: 'Unlock', Icon: UnlockOutlined, onClick: unlockJob,
        title: 'Open the declaration for one save - recorded in History',
      }] : []),
    ],
  }, [isNew, jobNo, job.direction, job.transportMode, canceled, invoiced, unlocked, saving, loading, docs.count, docs.saved]);

  // The layout too: the tabs would otherwise be drawn the built-in way and
  // then rearranged under whoever had started on them.
  if (loading || !jobFormLoaded) return <div className='base-page-layout'><Spin /> Loading…</div>;

  const asMoment = (v) => {
    if (!v) return null;
    const m = moment(v, D_STORE, true);
    return m.isValid() ? m : null;
  };
  const date = (field) => ({
    value: asMoment(job[field]),
    onChange: (d) => set(field, d && d.isValid() ? d.format(D_STORE) : ''),
    format: D_SHOW, style: { width: '100%' }, disabled: frozen, size: 'large',
  });
  const text = (field) => ({
    value: job[field] || '',
    onChange: (e) => set(field, e.target.value),
    disabled: frozen, size: 'large',
  });
  // The Client Invoice #, on Job Details and on Booking Info alike: one
  // number, written to both columns that hold it. See clientInvoiceNo.
  const clientInvoice = {
    value: clientInvoiceNo(job),
    onChange: (e) => setJob((j) => ({ ...j, clientRef: e.target.value, invoiceNo: e.target.value })),
    disabled: frozen, size: 'large',
  };
  const number = (field) => ({
    value: job[field],
    onChange: (v) => set(field, v),
    controls: false, style: { width: '100%' }, disabled: frozen, size: 'large',
  });
  // A dropdown over one of the served vocabularies. `allowClear` because every
  // one of these is genuinely unknown when a file is first opened, and forcing
  // a guess is how a GD ends up filed under the wrong channel.
  const pick = (field, list, { clear = true } = {}) => {
    /* A vocabulary entry is either a plain string - value and label the same -
     * or a { value, label } pair where the two differ. The delivery terms are
     * the second kind: the dropdown shows "FOB - Free On Board" while the
     * column goes on holding 'FREE ON BOARD', which is what every job already
     * filed holds. Changing the stored value to match the label would orphan
     * all of them - see INCO_TERMS in routes/customsJobs. */
    const options = (list || []).map((x) => (
      typeof x === 'string' ? { value: x, label: x } : x
    ));
    /* WHATEVER IS ALREADY ON THE JOB STAYS IN THE LIST, the same rule the
     * party pickers follow. A migrated file can carry a value these curated
     * lists do not offer - a delivery term recorded as "FOB", an old GD type -
     * and without this the box renders empty on a job that plainly has a
     * value, and the next save writes that emptiness back. */
    const current = job[field];
    if (current && !options.some((o) => o.value === current)) {
      options.unshift({ value: current, label: current });
    }
    return {
      value: current || undefined,
      onChange: (v) => set(field, v ?? ''),
      options,
      style: { width: '100%' }, allowClear: clear, disabled: frozen, size: 'large',
    };
  };
  const party = (field, list) => {
    const options = (list || []).map((x) => ({ value: x.id, label: x.name }));
    // WHATEVER IS ALREADY ON THE JOB STAYS IN THE LIST. Each of these boxes is
    // filtered by party type, and a party can be missing its tag - an old file,
    // or one entered before anyone thought to tick 'Transporter'. Without this
    // the box renders empty on a job that plainly has a value, and saving would
    // then write that emptiness back.
    const current = job[field];
    if (current != null && current !== '' && !options.some((o) => o.value === current)) {
      const known = (values.party || []).find((x) => x.id === current);
      if (known) options.push({ value: known.id, label: known.name });
    }
    const isClient = field === 'clientId';
    return {
      value: current ?? undefined,
      onChange: isClient
        ? (v) => credit.pick(v, { allowed: () => set(field, v ?? null) })
        : (v) => set(field, v ?? null),
      options: isClient ? credit.mark(options, { nameKey: 'label', idKey: 'value' }) : options,
      showSearch: true, allowClear: true, optionFilterProp: 'label',
      style: { width: '100%' }, disabled: frozen, size: 'large',
    };
  };

  const vocab = values.vocabulary || FALLBACK_VOCABULARY;
  const isAir = job.transportMode === 'Air';

  // The haulier only belongs on a file that includes moving the goods. A
  // clearing-only job has no transport leg, so the field is noise on it.
  //
  // Hidden on 'Clearing' ALONE - not on a blank job type, and never on a job
  // that already names a transporter. Every migrated file arrives with a
  // transporter or without one regardless of what its job type says, and a
  // field that hides a value somebody recorded is worse than one that is
  // occasionally irrelevant: the value stays in the database, invisible,
  // and the next person to look wonders where the haulier went.
  const showTransporter = job.jobType !== 'Clearing' || Boolean(job.transporterId);

  /* THE TRANSPORT PAGE, on a file that includes moving the goods.
   *
   * A clearing-only job has no haulage leg, so the page is noise on it - the
   * same reasoning as showTransporter above, applied to the whole tab.
   *
   * And the same exception, for the same reason: a job that already NAMES a
   * haulier or a yard keeps its page whatever its job type says. Hiding a tab
   * is hiding the only way to see or correct what is on it, and a migrated
   * file arrives with those fields filled regardless of what its job type
   * claims. A page that is occasionally irrelevant is a smaller problem than a
   * value nobody can find. */
  const showTransportTab = job.jobType !== 'Clearing'
    || Boolean(job.transporterId) || Boolean(job.deliveryLocation);

  // A dropdown over one of the curated JSON lists. Stores the id, which for
  // these lists IS the code ("QICT", "PQE") - so what lands in the column is
  // the same shape pol/pod already hold.
  // The job's own value stays an option when the list no longer has it - a
  // port of loading unticked in Setup > Ports, say - rather than showing as a
  // bare code, or being lost on the next save.
  const listPick = (field, list) => ({
    value: job[field] || undefined,
    onChange: (v) => set(field, v ?? ''),
    options: [
      ...(list || []).map((x) => ({ value: x.id, label: x.name })),
      ...(job[field] && !(list || []).some((x) => x.id === job[field]) ? [{ value: job[field], label: job[field] }] : []),
    ],
    showSearch: true, allowClear: true, optionFilterProp: 'label',
    style: { width: '100%' }, disabled: frozen, size: 'large',
  });
  // Discharge and final destination stay on the migrated port master: they are
  // anywhere in the world, unlike a port of shipment, which for this agent is
  // one of three.
  // Port Of Final Destination follows Port Of Discharge.
  //
  // It stops following the moment somebody sets it to something else - the
  // test is whether it currently still equals the OLD discharge port, so a
  // deliberate divergence is never overwritten by a later edit to POD. On
  // this book the two agree on 7,339 of 7,409 jobs, so mirroring is the
  // common case and typing it twice was the tax.
  const setPod = (v) => {
    const next = v ?? '';
    setJob((j) => ({
      ...j,
      pod: next,
      pofd: (!j.pofd || j.pofd === j.pod) ? next : j.pofd,
    }));
  };

  const currencyPick = (field) => {
    const current = job[field];
    const options = CURRENCY_CODES.map((c) => ({ value: c, label: c }));
    if (current && !CURRENCY_CODES.includes(current)) {
      options.unshift({ value: current, label: current });
    }
    return {
      value: current || undefined,
      onChange: (v) => set(field, v ?? ''),
      options,
      showSearch: true, allowClear: true, optionFilterProp: 'label',
      style: { width: '100%' }, disabled: frozen, size: 'large',
    };
  };

  // The loading desks are not offered here (routes/customsJobs getValues);
  // a job saved with one before that keeps it, by its desk name.
  const portPick = (field) => ({
    value: job[field] || undefined,
    onChange: (v) => set(field, v ?? ''),
    options: job[field] && !portOptions.some((o) => o.value === job[field])
      ? [...portOptions, { value: job[field], label: (vocab.polSea || []).find((x) => x.id === job[field])?.name || job[field] }]
      : portOptions,
    showSearch: true, allowClear: true, optionFilterProp: 'label',
    style: { width: '100%' }, disabled: frozen, size: 'large',
  });

  /* ------------------------------------------------------------------------
   * THE SECTIONS, each drawn once and put on whichever tab Configuration >
   * Customs' layout says (functions/customsJobForm). Unset, that is the
   * built-in five, in the order the work happens - booked, loaded, moved,
   * documented, declared - with Charges always last.
   * ---------------------------------------------------------------------- */
  const refLabel = jobForm.referenceLabel || DEFAULT_REFERENCE_LABEL;
  const freightForwarding = isFreightForwarding(job);
  // Freight Forwarding where the install offers it, and on a job that already
  // is one whatever the setting says now.
  const jobTypes = (jobForm.freightForwarding || freightForwarding) ? [...JOB_TYPES, FREIGHT_FORWARDING] : JOB_TYPES;
  const layout = completeLayout(jobForm.layout, { documentsOnGd });
  // Haulage is the old Transport page's: left off a clearing-only file - see
  // showTransportTab - and the containers move up beside the route.
  const tabs = visibleTabs(layout, { showHaulage: showTransportTab });
  const chargesShown = !isNew && can('jobCharges', 'view');

  /* The page can go away from under whoever is standing on it: a clearing-only
   * file shows Haulage because it names a pickup yard, and clearing that field
   * is the last thing keeping its tab there. antd would then be left with an
   * activeKey matching no pane and render an empty body - a screen that looks
   * broken. Clamped on render, so there is never a frame of it; the stored key
   * is left alone, so putting the yard back returns you to the tab. */
  const tabKeys = [...tabs.map((t) => t.key), ...(chargesShown ? ['charges'] : [])];
  const wantedTab = activeTab === '@jobDetails' ? tabOf(tabs, 'jobDetails') : activeTab;
  const currentTab = tabKeys.includes(wantedTab) ? wantedTab : (tabKeys[0] || '');

  /* THE CLIENT INVOICE # - or, on a Freight Forwarding job, the HBL # in its
   * place (Essani, 2026-11-14; held in blNo, which the header has always
   * shown as HBL). On Job Details and on Documents alike: one number, written
   * to both columns that hold it - see clientInvoiceNo. Documents leaves it
   * off when the two sections share a tab, rather than show it twice. */
  const referenceBox = freightForwarding
    ? <F label='HBL #'><Input {...text('blNo')} /></F>
    : <F label='Client Invoice #'><Input {...clientInvoice} /></F>;

  /* ADD A PORT FROM ITS HEADING - Configuration > Customs (Essani,
   * 2026-11-14): Port Of Loading, Discharge and Final Destination open Setup >
   * Ports' form, and the job picks the port it made. Sea only - by air these
   * are airports - and only for whoever may add ports (the server checks). */
  const canAddPorts = jobForm.addPorts && !isAir && !frozen && can('locations', 'edit');
  const portHeading = (label, field, asLoading = false) => (canAddPorts ? (
    <button type='button' className='cj-label-link' onClick={() => setAddPort({ field, loading: asLoading })}
      title='Add a port to Setup > Ports and pick it here'>
      {label} <span className='cj-label-plus' aria-hidden='true'>+</span>
    </button>
  ) : label);
  const portAdded = async (port) => {
    const field = addPort?.field;
    // The lists again, so the new port is in them - a Port Of Loading only
    // once it is ticked as one.
    try {
      const v = await getCustomsValues();
      if (v?.status === 'success') setValues({ ...v.result, vocabulary: v.result.vocabulary || FALLBACK_VOCABULARY });
    } catch (e) { /* the job keeps the code; its name shows on the next load */ }
    if (field === 'pod') setPod(port.portId);
    else if (field) set(field, port.portId);
  };

  const sectionCards = {
    jobDetails: (
      <Card title='Job Details' hint='what kind of file this is'>
        <F label='Job No.'>
          <Input value={jobNo} disabled placeholder='Assigned on save' size='large' />
        </F>
        {/* The other thing a file is looked up by, beside Job No.: the number
            the customer quotes is the one on the invoice they raised - or the
            HBL # on a Freight Forwarding job. */}
        {referenceBox}
        <F label='Job Type *' md={2}>
          <Select {...pick('jobType', jobTypes)} />
        </F>
        {/* Defaults to today on save if left empty - see save(). */}
        <F label='Job Date' md={2} hint='today if left empty'>
          <DatePicker {...date('jobDate')} />
        </F>
        <F label='Direction *' md={2}>
          <Select {...pick('direction', vocab.directions, { clear: false })} />
        </F>
        <F label='Mode *' md={2}>
          <Select {...pick('transportMode', vocab.transportModes, { clear: false })} />
        </F>
        <F label='Shipment Type *' md={2}>
          {/* Sea and air are not the same question - FCL means nothing
              on a flight. Served per mode; see CARGO_TYPES_* . */}
          <Select {...pick('cargoType', isAir ? vocab.cargoTypesAir : vocab.cargoTypesSea)} />
        </F>
        {/* THE SHIPPING REGISTER PAGE - or whatever this install calls it
            (Configuration > Customs; Essani's is "File Job Number"). One of
            the three a job saves with - see save() - and searchable from the
            job list. Bound to jobRef, NOT regPageNo: regPageNo has never been
            populated by anything, while jobRef carries it on 8,932 legacy
            jobs. */}
        <F label={`${refLabel} *`} md={refLabel.length > 14 ? 3 : 2}><Input {...text('jobRef')} /></F>
        {/* THE SAME CLIENT as the Parties section's: both are bound to
            clientId, so choosing it in either sets it in both. */}
        <F label='Client *' md={4}><Select {...party('clientId', values.client)} /></F>
      </Card>
    ),
    status: (
      <Card title='Status'>
        <F label='Status' md={2}>
          {/* Configuration > Customs' statuses - those still offered,
              and the job's own should it be retired. */}
          <Select
            value={job.status || startOf(jobStatuses)}
            onChange={(v) => set('status', v)}
            options={offeredStatuses(jobStatuses, job.status)}
            style={{ width: '100%' }} size='large'
            // Open on a CANCELLED job - its status is the one thing that
            // can change there; any but Canceled reopens it.
            disabled={frozen && !canceled}
          />
        </F>
        {/* Where the shipment has got to, in words - "Gate In",
            "Loaded". The Program Book's column; Status beside it is
            the fixed list the job lists count by. */}
        <F label='Current Status' md={3}><Input {...text('currentStatus')} /></F>
        <F label='Remarks' md={7}>
          <Input.TextArea rows={3} value={job.remarks || ''} disabled={frozen}
            onChange={(e) => set('remarks', e.target.value)} />
        </F>
      </Card>
    ),
    parties: (
      <Card title='Parties' hint='who the file is for'>
        {/* Job Details has the Client already when the two share a tab. */}
        {!sameTab(tabs, 'parties', 'jobDetails') && (
          <F label='Client *'><Select {...party('clientId', values.client)} /></F>
        )}
        {/* Both names on the transport document. On an export the
            shipper is usually the client; on an import the consignee
            is. The GD names both, and 99.9% of the legacy book has
            them. */}
        <F label='Shipper'><Select {...party('shipperId', values.shipper)} /></F>
        <F label='Consignee'><Select {...party('consigneeId', values.consignee)} /></F>
        {/* NOT starred: only 271 of 15,364 legacy jobs name a carrier,
            so requiring one would make 15,093 migrated files
            unsaveable until somebody invented a shipping line. */}
        <F label='Shipping Line'><Select {...party('shippingLineId', values.shippingLine)} /></F>
        {/* The forwarder or clearing agent on the other side of the file -
            chaChbId, the legacy GD screen's "Freight Forwarder (CHA/CHB)". */}
        <F label='Freight Forwarder'><Select {...party('chaChbId', values.chaChb)} /></F>
      </Card>
    ),
    route: (
      <Card title='Route' hint='between which points'>
        <F label={isAir ? 'Origin' : portHeading('Port Of Loading', 'pol', true)}>
          <Select {...listPick('pol', isAir ? vocab.polAir : vocab.polSea)} />
        </F>
        <F label={isAir ? 'Destination' : portHeading('Port Of Discharge', 'pod')}>
          <Select {...portPick('pod')} onChange={setPod} />
        </F>
        {/* MIRRORS PORT OF DISCHARGE until somebody changes it. On this
            book the two are identical on 7,339 of the 7,409 jobs that
            carry both - 99.1% - so typing it twice is the normal case
            and diverging is the exception worth allowing for. */}
        <F label={portHeading('Port Of Final Destination', 'pofd')}>
          <Select {...portPick('pofd')} />
        </F>
        <F label={isAir ? 'Terminal / Shed' : 'Terminal / Yard'}>
          <Select {...listPick('terminal', isAir ? vocab.terminalAir : vocab.terminalSea)} />
        </F>
        {/* The sailing it is booked on. vesselOrFlight was always on
            the job (migrated files carry it) and had no box; the
            Program Book fills it, with the cut-off and gate-in. */}
        <F label={isAir ? 'Flight No.' : 'Vessel'}><Input {...text('vesselOrFlight')} /></F>
        {/* TEXT, as the program states them - "12-OCT 1800", "TBA" (the
            user's rule, 2026-10-10). They were date-time pickers. */}
        <F label='Cut-Off'><Input {...text('cutOff')} /></F>
        <F label='Gate-In Time'><Input {...text('gateInTime')} /></F>
      </Card>
    ),
    haulage: (
      <Card title='Haulage' hint='who moves it, and where to'>
        {showTransporter && (
          <F label='Transporter'><Select {...party('transporterId', values.transporter)} /></F>
        )}
        {/* WHERE THE CONTAINER IS COLLECTED FROM, as a local address -
            "D-53, TEXTILE AVENUE, SITE, KARACHI" - not a port. 12,156
            legacy jobs carry one. Distinct from Port Of Final Destination,
            a UN/LOCODE overseas, and from Terminal / Yard, the curated list
            of port terminals. */}
        <F label='Container Pickup Yard' md={9} hint='pickup address'>
          <Input {...text('deliveryLocation')} placeholder='Pickup address' />
        </F>
      </Card>
    ),
    containers: (
      <Card title='Containers' hint='one row per container'>
        <Col md={12} className='cj-field'>
          <Containers rows={containerRows} setRows={setContainerRows} disabled={frozen}
            transporters={showTransporter ? (values.transporter || []) : undefined}
            // Picked from the freight sizes - Configuration > Customs.
            sizeList={jobForm.containerSizeList} />
        </Col>
      </Card>
    ),
    documents: (
      <Card title='Documents' hint='what the file is evidenced by'>
        {/* THE CLIENT INVOICE # (or HBL #) - the same box as Job Details',
            one value in both places; left off here when the two share a tab.
            It was a separate "Commercial Invoice #" here; on almost every
            file the two held the same number. */}
        {!sameTab(tabs, 'documents', 'jobDetails') && referenceBox}
        <F label='Form-E / FI #'><Input {...text('formENo')} /></F>
        {/* The master document. MAWB by air, MBL by sea - one column,
            because a file is one or the other. */}
        <F label={isAir ? 'MAWB #' : 'MBL #'}><Input {...text('mblNo')} /></F>
        {/* The carrier's booking. Always a column; never a box until
            the Program Book brought it in. */}
        <F label='Booking #'><Input {...text('carrierBookingNo')} /></F>
      </Card>
    ),
    goodsDeclaration: (
      <Card title='Goods Declaration' hint='what the GD says'>
        <F label='GD #'><Input {...text('gdNumber')} /></F>
        <F label='GD Date' md={2}><DatePicker {...date('gdDate')} /></F>
        {/* DELIVERY TERMS is what the GD calls them and what everyone
            here says. Incoterms is the trade body's word for the same
            list, and it is the column name - incoTerms - which stays as
            it is. Not to be confused with the deliveryTerms column, which
            holds CY/CY, CY/DR and the rest, and which no page shows. */}
        <F label='Delivery Terms' md={3}>
          <Select {...pick('incoTerms', vocab.incoTerms || [])} />
        </F>
      </Card>
    ),
    goods: (
      <Card title='Goods' hint='what is in it, and what it weighs'>
        {/* COMMODITY FIRST, then the free text that qualifies it: the
            commodity is the classification, the description the detail
            under it. Left off where the install keeps no commodities
            (Configuration > Customs; Essani, 2026-11-14) - a job that has
            one keeps it, unseen. */}
        {jobForm.commodities && (
          <F label='Commodity'><Select {...party('CommodityId', values.commodity)} /></F>
        )}
        <F label='Goods Description' md={jobForm.commodities ? 9 : 12}>
          <Input {...text('goodsDescription')} />
        </F>
        <F label='Quantity (PCS)' md={2}><InputNumber {...number('packages')} /></F>
        <F label='Unit' md={2}>
          {/* Combo box, not a closed list - see PACK_UNITS. Anything
              already on the job stays, and a unit outside the list can
              still be typed. */}
          <AutoComplete
            value={job.pkgUnit || ''}
            onChange={(v) => set('pkgUnit', v ?? '')}
            options={PACK_UNITS.map((x) => ({ value: x }))}
            filterOption={(input, option) =>
              option.value.toLowerCase().includes(String(input).toLowerCase())}
            style={{ width: '100%' }} disabled={frozen} size='large'
            placeholder='Cartons / Pallet / PCS'
          />
        </F>
        <F label='Gross Weight' md={2}><InputNumber {...number('grossWeight')} step={0.01} /></F>
        <F label='Net Weight' md={2}><InputNumber {...number('netWeight')} step={0.01} /></F>
      </Card>
    ),
    commercialInvoice: (
      <Card title='Commercial invoice' hint='the value declared, and in what'>
        {/* FOB, said on the label: the figure declared here is the
            free-on-board value, which is not what the commercial invoice
            totals if it was raised on CIF - and the gap between the two is
            duty. */}
        <F label='Invoice Value (FOB)' md={3}>
          <InputNumber {...number('invoiceValue')} step={0.01} />
        </F>
        {/* 60% of this book is USD/EUR/GBP/AED, so a value without its
            currency is a figure nobody can read. The charge sheet's list
            (CURRENCY_CODES), and anything already on the job kept. */}
        <F label='Currency' md={2}>
          <Select {...currencyPick('invoiceCurrency')} />
        </F>
      </Card>
    ),
  };

  return (
    <div className='client-styles customs-job' style={{ overflowY: 'auto', overflowX: 'hidden' }}>
      {credit.modal}
      {/* STICKY, because this form is 58 fields and several screens tall. The
          job's identity, its state and the Save button were all at the very
          top: scroll to the cargo section and you could no longer see which
          declaration you were editing or reach Save without scrolling back. */}
      {docs.modal}
      {/* STICKY, because this form is 58 fields and several screens tall: which
          declaration this is stays in view. Its buttons are on the toolbar
          above the page (PageActions), which does not scroll at all. */}
      <header className='cj-header'>
        <div className='cj-header-main'>
          <div className='cj-title-row'>
            {job.direction && <span className='cj-pill'>{job.direction}</span>}
            {job.transportMode && <span className='cj-pill'>{job.transportMode}</span>}
            {job.channel && (
              <Tag color={CHANNEL_COLORS[job.channel]} className='cj-tag'>{job.channel}</Tag>
            )}
            {canceled && <span className='cj-pill cj-pill-danger'>Cancelled</span>}
            {invoiced && !canceled && <span className='cj-pill cj-pill-locked'>Invoiced</span>}
            {/* The three facts that identify a file at a glance, so you can tell
                WHICH declaration you are in without leaving the tab you are on. */}
            <span className='cj-subline'>
              {[
                job.gdNumber && `GD ${job.gdNumber}`,
                job.blNo && `HBL ${job.blNo}`,
                clientInvoiceNo(job) && `Client invoice ${clientInvoiceNo(job)}`,
              ].filter(Boolean).join('  ·  ') || 'No GD or B/L number yet'}
            </span>
          </div>
          {!isNew && <AuditStamp className='mt-1' style={{ fontSize: 12 }} record={stamp} />}
        </div>
        {!isNew && (
          <div className='cj-actions'>
            {/* The invoice NUMBERS on hover - the count alone tells you
                there are three, not which three. */}
            <Popover
              placement='bottomRight'
              title={invoiceList.length ? 'Invoices & bills' : null}
              content={
                invoiceList.length ? (
                  <div className='cj-invlist'>
                    {invoiceList.map((x) => (
                      <div key={x.id}>
                        <Tag color={x.type === 'Job Bill' ? 'volcano' : 'geekblue'}>
                          {x.invoice_No}
                        </Tag>
                        <span className='cj-invtype'>{x.type}</span>
                      </div>
                    ))}
                  </div>
                ) : 'Nothing has been billed on this declaration yet.'
              }
            >
              <button type='button' className='btn-plain'>
                Invoice/Bills ({invoiceList.length})
              </button>
            </Popover>
          </div>
        )}
      </header>

      {canceled && (
        <div className='frozen-banner'>
          <b>Cancelled.</b> Only its status can change: choose another status on Job Details and
          press Save Job on the toolbar to reopen it.
        </div>
      )}

      {/* Said once, at the top, rather than as a surprise on save. */}
      {invoiced && !canceled && unlocked && (
        <div className='frozen-banner'>
          <b>Unlocked.</b> This invoiced job is open for one save — the unlock and the changes
          are recorded in History under your name. Charges already on an approved invoice stay
          locked. It locks again when you save or reload.
        </div>
      )}
      {invoiced && !canceled && !unlocked && (
        <div className='frozen-banner'>
          This job has been invoiced, so the declaration is locked — the figures on it are
          what an issued invoice was computed from. <b>Charges can still be added, approved
          and invoiced</b>; the ones already on an invoice are locked individually.
        </div>
      )}

      {/* SAID, not silent. A form that quietly refills itself with what was
          typed an hour ago, on a job whose saved values are different, is a
          form nobody can trust - so it says what it did and offers the way
          back. See redux/customsJobDraft. */}
      {draftRestored && !frozen && (
        <div className='draft-banner'>
          Restored what you had typed on this job but not saved.
          <button type='button' className='draft-discard' onClick={discardDraft}>
            Discard and reload the saved job
          </button>
        </div>
      )}

      <Tabs activeKey={currentTab} onChange={setActiveTab}>
        {/* THE LAYOUT'S TABS, each with its sections in their order - see
            sectionCards. A tab with nothing to show this job is not shown. */}
        {tabs.map((t) => (
          <Tabs.TabPane tab={t.title} key={t.key}>
            <div className='gd-page'>
              {t.sections.map((key) => <React.Fragment key={key}>{sectionCards[key]}</React.Fragment>)}
            </div>
          </Tabs.TabPane>
        ))}

        {/* Charges appears once the job is saved: a charge needs a job to
            hang off. Always its own tab, last, whatever the layout. */}
        {chargesShown &&
        <Tabs.TabPane tab={`Charges${charges.length ? ` (${charges.length})` : ''}`} key='charges'>
          {/* CANCELLED, not FROZEN.
              An invoiced job keeps its Charges tab open: a clearing agent
              bills as costs arrive, so a job often has an invoice on its first
              few charges while more are still being entered, approved and
              billed on a second one. The charges that ARE on an invoice lock
              themselves row by row - see `billed` in Charges - which is the
              lock that belongs here. A cancelled job stays shut entirely. */}
          <Charges
            /* THE ROUTE'S id, not job.id. `job` is form state and `id` is in
               NOT_A_FIELD on purpose, so that it never travels back in a save
               payload - which means it is not on `job` to be read either. The
               charge summary needs the real row id to ask the server what this
               file earned. */
            jobId={id}
            job={job}
            charges={charges}
            setCharges={setCharges}
            values={values}
            disabled={canceled || !can('jobCharges', 'edit')}
            rights={jobDocRights(can)}
            canceled={canceled}
            onInvoice={invoiceCharges}
            invoicing={invoicing}
            onInvoiceApproval={setInvoiceApproval}
            approvingInvoices={approvingInvoices}
            // Alt+R / Alt+B listen only while this tab is showing - the other
            // tabs stay mounted, and this with them.
            active={currentTab === 'charges'}
            // Receivable, Payable and Summary on tabs of their own, or one
            // page - Configuration > Customs (chargeTabs, above).
            tabbed={chargeTabs}
          />
        </Tabs.TabPane>}

      </Tabs>

      {/* SETUP > PORTS' FORM, from a port heading - see portHeading. */}
      <AddPortModal
        open={Boolean(addPort)}
        loading={Boolean(addPort?.loading)}
        onClose={() => setAddPort(null)}
        onAdded={portAdded}
      />

      {/* ADD NOTE. Its own modal rather than a field on the page: a note is an
          event on the file, not part of the declaration, and it saves on its
          own without touching the job. */}
      <Modal
        title='Add a note'
        open={addOpen}
        onOk={saveNote}
        okText='Add note'
        confirmLoading={notesBusy}
        onCancel={() => setAddOpen(false)}
        maskClosable={false}
      >
        <div className='cj-label'>Title</div>
        <Input
          value={noteDraft.title}
          onChange={(e) => setNoteDraft((d) => ({ ...d, title: e.target.value }))}
          placeholder='e.g. Examination scheduled'
          size='large'
        />
        <div className='cj-label' style={{ marginTop: 12 }}>Note</div>
        <Input.TextArea
          rows={5}
          value={noteDraft.note}
          onChange={(e) => setNoteDraft((d) => ({ ...d, note: e.target.value }))}
        />
      </Modal>

      {/* VIEW NOTES. Newest first, each with who added it and when. */}
      <Modal
        title={`Notes${notes.length ? ` (${notes.length})` : ''}`}
        open={notesOpen}
        onCancel={() => setNotesOpen(false)}
        footer={null}
        width={640}
      >
        {notesBusy && <div className='cj-notes-busy'><Spin /> Loading…</div>}
        {!notesBusy && notes.length === 0 && (
          <Empty description='No notes on this declaration yet.' />
        )}
        {!notesBusy && notes.map((n) => (
          <div key={n.id} className='cj-note'>
            <div className='cj-note-head'>
              <b>{n.title}</b>
              <span className='cj-note-meta'>
                {n.createdBy}
                {n.createdAt ? ` · ${moment(n.createdAt).format('DD-MM-YYYY HH:mm')}` : ''}
              </span>
            </div>
            <div className='cj-note-body'>{n.note}</div>
          </div>
        ))}
      </Modal>

      <style jsx global>{`
        /* ------------------------------------------------------------------
           One spacing and type scale for the whole screen.

           The people entering these files are mostly over 50 and work in this
           form all day. That drives every choice below: 15px labels rather
           than 12, 40px controls rather than 32, generous row spacing, and
           contrast that does not depend on good eyesight. Density is not a
           virtue here - legibility is.
           ------------------------------------------------------------------ */
        .customs-job {
          --cj-gap: 20px;
          --cj-radius: 10px;
          --cj-border: #e8eaed;
          --cj-muted: #5f6368;
          --cj-faint: #80868b;
          --cj-surface: #ffffff;
          --cj-canvas: #f6f7f9;
          background: var(--cj-canvas);
          padding-bottom: 32px;
        }

        /* --- sticky header ------------------------------------------------ */
        .customs-job .cj-header {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          background: var(--cj-surface);
          border: 1px solid var(--cj-border);
          border-radius: var(--cj-radius);
          padding: 8px 14px;
          margin-bottom: 12px;
          box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
        }
        .customs-job .cj-title-row {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .customs-job .cj-title {
          margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -0.01em;
        }
        .customs-job .cj-subline {
          margin-left: 6px; font-size: 13px; color: var(--cj-faint);
        }
        .customs-job .cj-pill {
          font-size: 12px; font-weight: 600; line-height: 1;
          padding: 5px 10px; border-radius: 999px;
          background: #eef1f6; color: #3c4043;
        }
        .customs-job .cj-pill-danger { background: #fde8e8; color: #b02a37; }
        .customs-job .cj-pill-locked { background: #fff4e5; color: #a15c00; }
        .customs-job .cj-tag { margin: 0; }
        .customs-job .cj-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        /* A secondary action: present, but not competing with Save. */
        .customs-job .btn-plain {
          border: 1px solid var(--cj-border);
          background: #fff;
          color: #3c4043;
          border-radius: 8px;
          padding: 7px 14px;
          font-size: 13.5px;
          cursor: pointer;
        }
        .customs-job .btn-plain:hover { background: #f5f6f8; border-color: #d6d9dd; }
        .cj-invlist > div { margin: 4px 0; }
        .cj-invtype { font-size: 12px; color: #80868b; }
        .cj-notes-busy { padding: 12px 0; color: #5f6368; }
        .cj-note {
          border: 1px solid #eceef1; border-radius: 8px;
          padding: 10px 12px; margin-bottom: 10px; background: #fcfcfd;
        }
        .cj-note-head {
          display: flex; justify-content: space-between; align-items: baseline;
          gap: 10px; margin-bottom: 4px;
        }
        .cj-note-meta { font-size: 12px; color: #80868b; white-space: nowrap; }
        .cj-note-body { font-size: 13.5px; white-space: pre-wrap; }

        /* --- cards -------------------------------------------------------- */
        /* GD Entry: one page, four columns, fields stacked down each. */
        /* A react-bootstrap Row carries negative side margins (-12px) that
           are meant to be cancelled by a padded parent. Every other Row here
           lives inside .cj-card-body, which supplies that padding; these two
           sat directly in the tab, so the row hung 12px past each edge and the
           right-hand field was clipped. This is that missing parent. */
        .customs-job .gd-page { padding: 4px 12px 20px; }
        .customs-job .gd-grid {
          margin-top: 18px; padding: 14px 16px 16px;
          border: 1px solid var(--cj-border); border-radius: var(--cj-radius);
          background: var(--cj-surface);
        }
        .customs-job .gd-grid-title {
          font-size: 13px; font-weight: 650; color: #202124; margin-bottom: 8px;
        }
        .customs-job .gd-top { padding: 0; }
        .customs-job .gd-rule { margin: 14px 0 6px; border-top: 1px solid var(--cj-border); opacity: 1; }
        .customs-job .gd-col { padding: 0 6px; }
        .customs-job .gd-col .cj-label { margin-top: 12px; }
        .customs-job .gd-col .cj-label:first-child { margin-top: 4px; }

        .customs-job .cj-card {
          background: var(--cj-surface);
          border: 1px solid var(--cj-border);
          border-radius: var(--cj-radius);
          margin-bottom: 14px;
          overflow: hidden;
        }
        /* The whole heading is the toggle, so the hit target is the full
           width of the card rather than a small chevron. */
        .customs-job .cj-card-head {
          display: flex; align-items: center; gap: 10px;
          width: 100%;
          padding: 13px 18px;
          border: 0;
          border-bottom: 1px solid #f1f3f5;
          background: #fcfcfd;
          text-align: left;
          cursor: pointer;
        }
        .customs-job .cj-card-head:hover { background: #f7f8fa; }
        .customs-job .cj-card-head:focus-visible {
          outline: 2px solid #1876f2; outline-offset: -2px;
        }
        .customs-job .cj-card-closed .cj-card-head { border-bottom: 0; }
        .customs-job .cj-chevron {
          display: inline-block;
          font-size: 18px; line-height: 1; color: #9aa0a6;
          transform: rotate(0deg);
          transition: transform 0.15s ease;
        }
        .customs-job .cj-chevron-open { transform: rotate(90deg); }

        /* --- container grid ---------------------------------------------- */
        /* A table cannot reflow, so it scrolls inside its own box rather than
           pushing the page sideways on a narrow screen. */
        .customs-job .cj-grid { overflow-x: auto; }
        .customs-job .cj-table {
          width: 100%; min-width: 560px;
          border-collapse: separate; border-spacing: 0 6px;
        }
        .customs-job .cj-table th {
          font-size: 12px; font-weight: 600; color: var(--cj-faint);
          text-transform: uppercase; letter-spacing: 0.04em;
          padding: 0 8px 4px; text-align: left;
        }
        .customs-job .cj-table td { padding: 0 8px; vertical-align: middle; }
        .customs-job .cj-empty td {
          padding: 18px 8px; color: var(--cj-faint); font-size: 13.5px;
        }
        .customs-job .cj-rowdel { text-align: center; }
        .customs-job .cj-del {
          border: 0; background: transparent; color: #c5c8cc;
          font-size: 22px; line-height: 1; cursor: pointer; padding: 0 6px;
          border-radius: 6px;
        }
        .customs-job .cj-del:hover:not(:disabled) { color: #b02a37; background: #fdeaec; }
        .customs-job .cj-grid-foot {
          display: flex; align-items: center; gap: 12px; margin-top: 10px;
        }
        .customs-job .cj-count { font-size: 13px; color: var(--cj-faint); }
        .customs-job .cj-card-title {
          margin: 0; font-size: 14px; font-weight: 650; color: #202124;
        }
        .customs-job .cj-card-hint { font-size: 12.5px; color: var(--cj-faint); }
        .customs-job .cj-card-body { padding: 6px 12px 18px; }

        /* --- fields ------------------------------------------------------- */
        .customs-job .cj-field { padding: 10px 6px 0; }
        .customs-job .cj-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: var(--cj-muted);
          margin-bottom: 6px;
          line-height: 1.3;
        }
        .customs-job .cj-hint { margin-left: 6px; color: var(--cj-faint); font-weight: 400; }
        /* A heading that opens a form (a port heading - see portHeading):
           reads as the label it is, with a + to say it does something. */
        .customs-job .cj-label-link {
          border: 0; background: none; padding: 0; font: inherit; color: #1764c0;
          cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px;
        }
        .customs-job .cj-label-link:hover { color: #0b4fa0; }
        .customs-job .cj-label-plus { font-weight: 700; margin-left: 2px; }

        /* 40px controls, and a focus ring that is actually visible. */
        .customs-job .ant-input-lg,
        .customs-job .ant-picker-large,
        .customs-job .ant-input-number-lg,
        .customs-job .ant-select-lg .ant-select-selector {
          border-radius: 8px !important;
          font-size: 14.5px;
        }
        .customs-job .ant-input:focus,
        .customs-job .ant-input-focused,
        .customs-job .ant-picker-focused,
        .customs-job .ant-select-focused .ant-select-selector,
        .customs-job .ant-input-number-focused {
          box-shadow: 0 0 0 3px rgba(24, 118, 242, 0.14) !important;
          border-color: #1876f2 !important;
        }
        /* A disabled field should read as "locked", not as "broken". */
        .customs-job .ant-input[disabled],
        .customs-job .ant-select-disabled .ant-select-selector,
        .customs-job .ant-picker.ant-picker-disabled,
        .customs-job .ant-input-number-disabled {
          background: #f6f7f9 !important;
          color: #5f6368 !important;
          cursor: default;
        }

        /* --- small and short screens -------------------------------------
           A 1024x768 or 1280x1024 monitor is short as well as narrow. The
           controls stay large - the people using this are mostly over 50 and
           that was the point - so the space comes back out of chrome instead:
           the card hints are decorative, and the padding can afford to give up
           a few pixels per section. */
        @media (max-width: 1199px) {
          .customs-job .cj-card-hint { display: none; }
          .customs-job .cj-card-head { padding: 11px 14px; }
          .customs-job .cj-card-body { padding: 4px 8px 14px; }
          .customs-job .gd-page { padding: 4px 8px 16px; }
          .customs-job .cj-field { padding: 8px 6px 0; }
        }
        @media (max-height: 800px) {
          /* Keep the sticky header from eating a tenth of a short screen. */
          .customs-job .cj-header { padding: 8px 14px; }
          .customs-job .cj-title { font-size: 18px; }
          .customs-job .cj-subline { font-size: 12px; }
        }
        /* Below the md breakpoint every field is full width anyway, so the
           four-column reading of the page is gone - drop the pretence of a
           grid and let it read as one list. */
        @media (max-width: 767px) {
          .customs-job .cj-header { flex-direction: column; align-items: flex-start; }
          .customs-job .cj-actions { width: 100%; }
          .customs-job .cj-actions > * { flex: 1; }
        }

        /* --- tabs --------------------------------------------------------- */
        .customs-job .ant-tabs-nav { margin-bottom: 14px; }
        .customs-job .ant-tabs-tab { padding: 10px 4px; font-size: 14.5px; }
        .customs-job .ant-tabs-tab + .ant-tabs-tab { margin-left: 26px; }
        .customs-job .ant-tabs-tab-active .ant-tabs-tab-btn { font-weight: 650; }

        .customs-job .cj-rare { margin-top: 14px; }
        .customs-job .cj-rare {
          background: var(--cj-surface);
          border: 1px dashed var(--cj-border);
          border-radius: var(--cj-radius);
        }
        .customs-job .cj-rare .ant-collapse-header {
          font-size: 13px !important;
          color: var(--cj-muted) !important;
          padding: 12px 18px !important;
        }
        .customs-job .cj-rare .ant-collapse-content-box { padding: 0 12px 16px !important; }
        .customs-job .cj-section {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #8c8c8c;
          border-bottom: 1px solid #f0f0f0;
          padding-bottom: 6px;
          margin-top: 18px;
        }
        .customs-job .cj-section:first-of-type { margin-top: 4px; }
        .customs-job .frozen-banner {
          background: #fff8e6;
          border: 1px solid #ffe08a;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 13px;
          margin-bottom: 10px;
        }
        .customs-job .draft-banner {
          background: #eef6ff;
          border: 1px solid #b7d8ff;
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 13px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .customs-job .draft-discard {
          border: 1px solid #b7d8ff;
          background: #fff;
          border-radius: 4px;
          padding: 2px 10px;
          font-size: 12px;
          cursor: pointer;
        }
        .customs-job .draft-discard:hover { border-color: #1890ff; color: #1890ff; }
        .customs-job .duty-box {
          border: 1px solid #eee;
          border-radius: 8px;
          padding: 12px 14px;
          background: #fcfcfc;
        }
        .customs-job .duty-box-head {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin-bottom: 10px;
        }
        .customs-job .reimbursable-note {
          background: #f0f7ff;
          border: 1px solid #cfe4ff;
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
};

// The header fields, off a loaded job. Explicit rather than a spread of the
// whole row: the server sends associations (client, shipper, Charge_Heads) and
// derived figures (totalDuty, dutyBreakdown) alongside the columns, and
// spreading those into form state would post them straight back as if they
// were fields.
// What the server sends back that is NOT a form field: the associations, the
// audit columns, and the figures the route computes for display.
const NOT_A_FIELD = new Set([
  'id', 'jobNo', 'jobId', 'companyId', 'approved', 'canceled', 'invoiced',
  'createdAt', 'updatedAt',
  'client', 'shipper', 'consignee', 'Commodity',
  'Customs_Duties', 'Customs_Containers', 'Charge_Heads',
  // Derived by withTotals() on every read - never stored, never sent back.
  'totalDuty', 'dutyBreakdown', 'reimbursableDuty', 'effectiveDutyRate',
]);

/**
 * The saved job, as form state.
 *
 * THIS USED TO BE A WHITELIST over Object.keys(emptyJob), and that made adding
 * a field a THREE-place edit: the input, the route's jobValues(), and this
 * list. Miss the third and the field saves correctly and vanishes on the way
 * back - which is exactly what happened to localVendorId and chaChbId.
 *
 * Worse than the disappearance: a field missing from state is also missing
 * from the next save's payload, and jobValues() turns an absent key into null.
 * So every field this dropped was being WIPED on the first save of any job
 * that had one - costCenter, projectRef, grt, nrt and invoiceRemarks on every
 * migrated file.
 *
 * So it copies what it is given instead, and names the exceptions. A field
 * added to the model and the route now arrives here on its own.
 */
function pickFields(r) {
  const out = {};
  for (const [key, value] of Object.entries(r || {})) {
    if (NOT_A_FIELD.has(key)) continue;
    if (value === null || value === undefined) continue;
    // Any association not named above - keeping it out of the job payload
    // matters more than listing it.
    if (typeof value === 'object') continue;
    out[key] = value;
  }
  return out;
}

export default CreateOrEdit;
