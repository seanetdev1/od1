import React from 'react';
import { Table } from 'react-bootstrap';
import { Select, Input, InputNumber, Tag, Checkbox } from 'antd';
import { CloseCircleOutlined, LockOutlined, PlusCircleOutlined } from '@ant-design/icons';
import PopConfirm from 'Components/Shared/PopConfirm';
import openNotification from 'Components/Shared/Notification';
// Registering a commodity or a master agent without leaving the flight - see
// the module for why the short form is the right one here.
import {
  CommodityModal, PartyModal, AwbModal, CarrierModal, AirportModal,
} from './QuickRegister';
// Approving an AWB raises its Air Freight charge on both sides, and
// un-approving takes it back off. Built by the same code that builds a
// hand-picked charge row - see the module.
import {
  findAirFreight, airFreightRows, withoutAirFreight, hasAirFreight,
  repriceAirFreight, invoicedAirFreight,
  isAwbRateField, repriceForAwb, repriceAll,
  sellingLocked, buyingLocked, lockingInvoice,
} from 'functions/aviationChargeRow';
import { RECEIVABLE, PAYABLE } from 'functions/aviationPricing';
// GAM / IFA / Other - the one list every screen that offers them reads.
import { CARRIER_CATEGORIES, CATEGORY_HINT } from 'functions/carrierCategory';
import { formatNumber, digitsOnly, validateAwbNumber, normalizeAwb } from 'functions/awbNumber';
// Chargeable weight is gross less offload - shared with the flight page and
// the report so one definition of what flew serves all three.
import { chargeableWeightFor, num, isInvoiceLocked, bookedFromOffload } from 'functions/aviationPricing';
// A chargeable weight of nought prices every charge on the AWB at nothing, and
// only one situation earns it - see the module.
import { chargeableWeightError } from 'functions/aviationValidation';
// A charter prices the whole aircraft as one deal; these say which AWBs that
// reaches and what it fills in. See the module.
import { charterAppliesTo, charterRates } from 'functions/aviationCharter';
// Rates stay open until the flight's fortnight closes - see the module.
import { ratesOpen, fortnightEnd, showDate } from 'functions/aviationFortnight';

// The consignments on a flight - the repeating part of an aviation job.
//
// A flight carries many AWBs for many customers, which is the whole reason
// this module exists separately from the freight job form: that one has a
// single Client / Commodity / Weight / Vol on the header, and an airline
// cannot express its work that way.
const blankLine = {
  AviationCarrierId: null,
  // Which column of the monthly sector report this AWB counts toward, when it
  // should not be the one its carrier implies. NULL means inherit the
  // carrier's tag, which is what almost every AWB does - see the model.
  reportingTag: null,
  // The registered number this AWB was taken out of stock as. `awb` below is
  // the 8 digits themselves; this is the register row they came from, and it
  // is what ties the flight back to Setup > AWB Stock.
  AviationAwbId: null,
  awb: '',
  shipperId: null,
  consigneeId: null,
  masterAgentId: null,
  CommodityId: null,
  pieces: null,
  grossWeight: null,
  // What stayed on the ground, in both units the manifest counts in: the
  // packages left behind and what they weighed. Only the weight drives the
  // chargeable figure - see WEIGHT_DRIVERS.
  offloadPieces: null,
  offload: null,
  // What this leg is carrying when it continues an earlier one. Null on a
  // first leg, where grossWeight is the answer.
  carriedForward: null,
  // Nothing on this AWB is waiting for a later aircraft - see the Close AWB
  // column. Only ever means anything alongside an offload.
  awbClosed: false,
  // The AWB has been checked and its Air Freight charge raised - see the
  // Approved column.
  awbApproved: false,
  chargeableWeight: null,
  // One ex-rate per side. The space an AWB sells is not always bought in the
  // same currency it is sold in, and even when it is, the two rates are struck
  // on different days - a single figure reported a margin that was partly an
  // artefact of the conversion. The legacy single `exRate` is deliberately
  // absent from a NEW line; it survives only as the fallback for consignments
  // entered before the split (see withSplitExRates).
  buyingExRate: 1,
  sellingExRate: 1,
  buyingRate: null,
  sellingRate: null,
  origin: '',
  destination: '',
  natureOfGoods: '',
  remarks: '',
  // Someone else's load, flown for them: counted on the manifest, never
  // billed, and its AWB is typed rather than picked. See the Direct column.
  direct: false,
};

// A legacy number - typed before the register existed - is kept selectable as
// itself rather than blanked. Prefixed so it can never collide with a stock
// row's numeric id.
const TYPED = 't:';

const Consignments = ({ lines, setLines, values, disabled, job = {}, onRegister }) => {

  /* ------------------ registering a master from this screen --------------
   * The Commodity and Master Agent headings open a short registration form -
   * those two are what an unfamiliar AWB most often names that Setup does not
   * have yet, and both are required before the flight will save, so without
   * this the half-typed flight is abandoned while somebody goes and creates
   * one. See ./QuickRegister.
   * ------------------------------------------------------------------- */
  const [registering, setRegistering] = React.useState('');

  /* --------------------------- the weights -----------------------------
   *   Gross WT     the AWB's DOCUMENTED total. On a continuation leg it is
   *                copied verbatim from the earlier one - the air waybill
   *                still says 1,000 kg however many aircraft move it.
   *   carriedForward  what THIS leg is actually taking, when it continues an
   *                earlier one. Not shown as a column; set when a pending AWB
   *                is picked. Null on a first leg, where gross is the answer.
   *   Offload WT   the part of that which stayed on the ground. Offload Pcs
   *                counts the same event in packages; it is recorded for the
   *                manifest and prices nothing, so it is not a driver below.
   *   Chargeable   (carriedForward ?? gross) - offload: what flew, and so what
   *                is billed.
   *
   * Chargeable is filled in whenever a driver changes, rather than typed. It
   * is arithmetic, and every charge on the AWB is priced off it - a chargeable
   * weight left at the booked figure after an offload bills the customer for
   * cargo that never left the ground.
   *
   * The field stays EDITABLE: chargeable weight is conventionally the greater
   * of actual and volumetric, so an airline sometimes has to raise it by hand.
   * Typing in it wins until a driver is touched again, at which point the rule
   * reasserts itself.
   * ------------------------------------------------------------------ */
  const WEIGHT_DRIVERS = ['grossWeight', 'offload', 'carriedForward'];

  /* The four cells that can complete "all of it was offloaded". Any of them
   * can be the last one filled in - an operator enters the offload pair in
   * either order - so the rule is tried after each rather than hung off one.
   *
   * ON BLUR, NOT ON CHANGE, and that is the whole point of this list being
   * separate from WEIGHT_DRIVERS.
   *
   * InputNumber fires onChange on EVERY KEYSTROKE, so typing "100" into
   * Offload WT arrives as 1, then 10, then 100. Run per keystroke, the rule
   * saw its four conditions satisfied by the very first digit - Offload Pcs
   * already complete, Pieces and Gross still blank - and booked the leg at a
   * gross of 1. Worse, filling those two cells in is exactly what stops the
   * rule matching again, so it could not correct itself as the remaining
   * digits arrived: the row settled at gross 1 against an offload of 100.
   *
   * A half-typed number is not a value yet. Blur is the first moment the cell
   * holds what the user meant, which is the only figure worth copying. */
  const BOOKING_FIELDS = ['pieces', 'grossWeight', 'offloadPieces', 'offload'];

  // The charges hanging off a line. Reads whichever key is current:
  // Charge_Heads as the server sends it, charges once anything has edited it.
  const chargesOf = (line) => line.Charge_Heads || line.charges || [];

  const setField = (i, field, value) => {
    const next = [...lines];
    next[i] = { ...next[i], [field]: value };
    if (WEIGHT_DRIVERS.includes(field)) {
      next[i].chargeableWeight = chargeableWeightFor(next[i]);
    }
    /* ---------------- the rates reach the charges from HERE too -----------
     * The four rate cells are on this grid AND on the Charges tab, and they
     * are the same four fields on the same consignment. Only the Charges tab
     * used to reprice, so changing a selling rate here moved the number on the
     * screen and left every charge it governs at the old one - which is not a
     * display bug: the AWB and its charges disagreed, and the invoice raised
     * from them carried the stale figure.
     *
     * Repriced through the SAME rule both tabs now share, so a charge frozen
     * by an approved invoice is skipped and a Per Shipment fee is not mistaken
     * for a per-kg rate. See repriceForAwb.
     * ------------------------------------------------------------------ */
    const priced = isAwbRateField(field)
      ? repriceForAwb(chargesOf(next[i]), next[i], field)
      // A weight change moves what every charge on the AWB is billed on, so
      // the amounts follow it even though no rate was touched.
      : (WEIGHT_DRIVERS.includes(field) ? repriceAll(chargesOf(next[i]), next[i]) : null);
    if (priced) {
      next[i].charges = priced;
      next[i].Charge_Heads = priced;
    }
    // Clearing the offload clears Close AWB with it. The tick says "this
    // offload is not waiting for an aircraft", so with no offload it says
    // nothing - and the box is disabled at nought, which would otherwise
    // leave a ticked one that could not be unticked.
    if (field === 'offload' && !num(value)) next[i].awbClosed = false;
    // Naming the flight's own airline on a chartered flight brings this AWB
    // INTO the charter, so it is priced at the common rates the moment it
    // joins - rather than sitting at whatever was typed before and having to
    // be noticed. Pre-filled, so it can still be adjusted afterwards.
    if (field === 'AviationCarrierId' && charterAppliesTo(next[i], job) && !ratesFrozen(next[i])) {
      next[i] = { ...next[i], ...charterRates(job) };
    }
    setLines(next);
  };

  /* A LOAD THAT FLEW NONE OF ITSELF books itself from what it left behind.
   *
   * Run when one of the four booking cells is LEFT, not as it is typed - see
   * BOOKING_FIELDS for what per-keystroke firing did to a gross weight.
   *
   * A no-op on all but the one row shape it is for, so it can hang off every
   * one of those cells without any of them having to know which.
   *
   * Chargeable weight is recomputed AFTER the fill, not before: putting a
   * gross on the row is what gives the leg something to have carried, and
   * chargeable is that less the offload - which on a full offload is the 0
   * that is the whole point. Computing it first would price the row off a
   * booking of nothing. The charges follow, because the weight every one of
   * them is billed on has just changed.
   */
  const completeBooking = (i) => {
    // Functional, unlike the handlers above: blur lands immediately after the
    // last onChange, and reading `lines` from this render's closure would
    // decide the rule on the row as it was one keystroke ago - which is the
    // whole class of bug this move was made to end.
    setLines((prev) => {
      const filled = bookedFromOffload(prev[i]);
      if (!filled) return prev;

      const next = [...prev];
      next[i] = { ...next[i], ...filled };
      next[i].chargeableWeight = chargeableWeightFor(next[i]);

      const priced = repriceAll(chargesOf(next[i]), next[i]);
      if (priced) {
        next[i].charges = priced;
        next[i].Charge_Heads = priced;
      }
      return next;
    });
  };

  // Several fields at once, for the pickers that fill in more than they were
  // clicked on - choosing an AWB also names its carrier and its master agent.
  // One setState, so the row cannot be rendered half updated.
  const setFields = (i, patch) => {
    const next = [...lines];
    next[i] = { ...next[i], ...patch };
    setLines(next);
  };

  /* ----------------------------- Direct -------------------------------
   * The airline was approached from outside to fly someone else's load. The
   * weight is ours to carry and so belongs on the manifest; the revenue is
   * not, so the AWB never reaches the Charges tab.
   *
   * Ticking it RELEASES THE AWB FIELD: the number belongs to whoever sold the
   * shipment, is not in our register, and must not claim a row there - so the
   * stock link is dropped and the digits are typed. Unticking puts the row
   * back on the picker, and the typed number goes with it rather than being
   * left behind to look like registered stock.
   * ------------------------------------------------------------------ */
  const setDirect = (i, line, on) => {
    const apply = () => setFields(i, {
      direct: on,
      // Either way the number stops being a claim on the register.
      AviationAwbId: null,
      awb: on ? line.awb || '' : '',
      // A direct consignment is not billed, so it cannot be approved - and
      // leaving the tick would have the row claiming an Air Freight charge the
      // server is about to clear.
      ...(on ? { awbApproved: false } : {}),
    });

    const chargeCount = (line.Charge_Heads || line.charges || []).length;
    if (on && chargeCount) {
      PopConfirm(
        'Confirmation',
        `This AWB has ${chargeCount} charge(s). A direct consignment is not billed, ` +
        'so any that have not been invoiced will be removed when you save. Continue?',
        apply
      );
      return;
    }
    apply();
  };

  /* ------------------------ approving an AWB ---------------------------
   * The AWB has been checked against the document, and its AIR FREIGHT charge
   * is raised on both sides: what the airline is paid to fly the cargo, and
   * what the customer is billed to have it flown.
   *
   * That one charge is on every AWB, it is the reason the AWB exists, and it
   * is priced entirely off figures this row already holds - chargeable weight
   * times the buying or selling rate. Typing it twice onto every consignment
   * was work with no decision in it, and the two rows that got missed were
   * only found when the flight would not reconcile.
   *
   * Built by the same code that builds a charge somebody picks by hand, so an
   * automatic Air Freight row and a typed one are the same row. Once created
   * they are ORDINARY charges: editable, approvable, invoiceable. A rate
   * negotiated for one shipment is normal, and a row that sprang back to the
   * AWB's rate whenever it was touched would be worse than one typed by hand.
   *
   * UN-APPROVING DELETES THEM, and re-approving raises them again from the
   * AWB's current figures. That is the point of the flag - it is how a
   * mispriced AWB is put right - but it does mean an edited Air Freight rate
   * is lost, so it is confirmed rather than done on a click.
   * ------------------------------------------------------------------- */
  const setCharges = (i, next) =>
    setFields(i, { awbApproved: next.approved, charges: next.charges, Charge_Heads: next.charges });

  const approve = (i, line) => {
    const af = findAirFreight(values.charge);
    if (!af) {
      // Said out loud rather than approving and raising nothing, which would
      // read as the feature being broken.
      openNotification(
        'No Air Freight charge is registered',
        'Approving an AWB raises its Air Freight charge, and there is none in ' +
        'Setup > Charges. Register one — short name AF — and try again.',
        'orange'
      );
      return;
    }
    /* NOTHING FLEW, SO THERE IS NOTHING TO CHARGE FOR.
     *
     * Air Freight is priced per kilo on the chargeable weight - it is what the
     * airline is paid to fly the cargo and what the customer is billed to have
     * it flown. On an AWB that was offloaded in its entirety both of those are
     * nought, and raising the pair anyway put two 0 x rate = 0 rows on the
     * Charges tab. They are not harmless: /makeInvoice picks up any uninvoiced
     * charge on the AWB, so they reach a real document as zero-value lines
     * that somebody then has to explain.
     *
     * REFUSED RATHER THAN APPROVED-WITH-NOTHING. The tick means "checked, and
     * its Air Freight charge raised on both sides" - with no charge to raise
     * it would be a claim about a row that does not exist, and un-approving
     * later would go looking for it. Said out loud for the same reason the
     * missing-charge case above is: an approval that silently did nothing
     * reads as the feature being broken.
     *
     * Only the AIR FREIGHT pair is affected. A handling or documentation
     * charge raised Per Shipment is a real cost of a shipment that did not
     * fly, and those are picked by hand on the Charges tab, which this does
     * not touch. */
    if (num(line.chargeableWeight) <= 0) {
      openNotification(
        'This AWB carried nothing',
        'Its whole load was offloaded, so the chargeable weight is 0 and there is no ' +
        'Air Freight to raise — approving would only add two zero-value rows that ' +
        'would end up on an invoice. Any charge that IS owed on a shipment that did ' +
        'not fly can be added by hand on the Charges tab.',
        'orange'
      );
      return;
    }

    const existing = chargesOf(line);
    /* RAISED ONCE, THEN REPRICED. An AWB that already carries the pair has
     * them brought back into line with its current rates rather than given a
     * second pair - which would bill the customer twice, and would leave the
     * invoice the first pair is on holding the figure being corrected.
     *
     * That is what makes "unapprove the invoice, fix the rate, re-approve"
     * work: the rows keep their ids, so they keep their place on the invoice,
     * and approveInvoice recomputes its total from them. */
    const next = hasAirFreight(existing, af)
      ? repriceAirFreight(existing, line, af)
      : [...existing, ...airFreightRows(line, values)];
    setCharges(i, { approved: true, charges: next });
  };

  const unapprove = (i, line) => {
    const af = findAirFreight(values.charge);
    const billed = invoicedAirFreight(chargesOf(line), af);
    if (billed.length) {
      /* ONCE INVOICED, NEVER DELETED. The charge's id is what puts it on the
       * invoice, so removing it empties the document - and it would not even
       * be removed cleanly: saveCharges only destroys rows with no invoice, so
       * this one would survive at the old figures and re-approving would add a
       * second pair beside it.
       *
       * And it is not needed. Correcting a rate does not go through the
       * approval flag at all - see the message. */
      openNotification(
        'This AWB is invoiced',
        `Its Air Freight charge is on ${billed[0].invoice_id || 'an invoice'}, so it ` +
        'cannot be removed. To correct a rate you do not need to unapprove the ' +
        'AWB at all: unapprove the invoice, change the rate here, and approve ' +
        'the invoice again — the charge is repriced in place and stays on it.',
        'orange'
      );
      return;
    }
    PopConfirm(
      'Unapprove this AWB?',
      'Its Air Freight charges have not been invoiced, so they will be removed ' +
      'when you save. Approving again raises them fresh from the rates on the ' +
      'AWB, so anything typed onto them by hand is lost.',
      () => setCharges(i, {
        approved: false,
        charges: withoutAirFreight(chargesOf(line), af),
      })
    );
  };

  const addLine = () => setLines([...lines, { ...blankLine }]);

  const removeLine = (i) => {
    PopConfirm('Confirmation', 'Are you sure you want to remove this consignment?', () => {
      const next = [...lines];
      next.splice(i, 1);
      setLines(next);
    });
  };

  // One list per role, filtered on the party's type by /aviationJob/getValues.
  // Built once per render rather than three times per row - on a real install
  // these run to thousands of entries.
  const opts = (list) => (list || []).map((c) => ({ value: c.id, label: c.name }));
  const roleOptions = React.useMemo(() => ({
    shipperId:     opts(values.shipper),
    consigneeId:   opts(values.consignee),
    masterAgentId: opts(values.masterAgent),
  }), [values.shipper, values.consignee, values.masterAgent]);

  // Destination holds the airport CODE, matching the flight header and the
  // freight air jobs' pol/pod.
  const airportOptions = React.useMemo(
    () => (values.airport || []).map((a) => ({ value: a.id, label: a.name })),
    [values.airport]
  );

  const carrierOptions = React.useMemo(
    () => (values.carrier || []).map((c) => ({
      value: c.id,
      // Prefix first: it is the carrier's code, and the dropdown filters
      // on this label, so typing 214 or PIA both find it.
      label: c.name,
    })),
    [values.carrier]
  );

  /* ------------------------- AWB numbers, from stock -----------------------
   * The AWB is PICKED, not typed. Every number the office holds is registered
   * in Setup > AWB Stock against the carrier that issued it and the master
   * agent it was given to, so choosing one here is what connects a flight back
   * to that register - and is why a number cannot quietly be invented.
   *
   * The two directions work as one:
   *
   *   pick the master agent first  -> the list narrows to that agent's numbers
   *   pick the number first        -> the master agent it belongs to fills in
   *
   * WHICH NUMBERS THE SERVER OFFERS: never-used stock, plus any AWB that was
   * offloaded and still owes cargo. A number that has flown and is fully
   * carried is NOT offered - that shipment is finished, and on a long-running
   * install the settled ones would drown the list. Picking a pending one
   * carries its details forward; see pickAwb.
   * -------------------------------------------------------------------- */
  const stock = values.awb || [];
  const stockById = React.useMemo(() => {
    const m = new Map();
    for (const s of stock) m.set(s.id, s);
    return m;
  }, [stock]);

  const awbOptionsFor = (line) => {
    const list = stock.filter((s) => {
      if (s.id === line.AviationAwbId) return true;   // never hide the current one
      // A number already given to someone else is not this AWB's to use.
      if (line.masterAgentId && s.masterAgentId !== line.masterAgentId) return false;
      if (line.AviationCarrierId && s.AviationCarrierId !== line.AviationCarrierId) return false;
      return true;
    });

    const options = list.map((s) => ({
      value: String(s.id),
      label: formatNumber(s.awbNumber),
      // Searching by digits, so 21410000001 and 214-10000001 both find it.
      search: digitsOnly(s.awbNumber),
      // A number still in the list despite having flown is one that owes
      // cargo - say how much, because picking it is a different act from
      // picking fresh stock.
      pending: s.pending || 0,
      agent: s.masterAgent,
    }));

    // A saved line whose AWB is now fully carried is no longer in the
    // available list - the endpoint drops settled numbers so they cannot be
    // picked again. Its own row must still show it, or opening an old flight
    // would blank the AWB and saving would wipe it.
    if (line.AviationAwbId && !list.some((s) => s.id === line.AviationAwbId)) {
      const own = line.Aviation_Awb;
      const label = own?.awbNumber
        ? formatNumber(own.awbNumber)
        : `${prefixOf(line)}${prefixOf(line) ? '-' : ''}${line.awb || ''}`;
      options.unshift({
        value: String(line.AviationAwbId),
        label,
        search: digitsOnly(own?.awbNumber || line.awb),
        settled: true,
      });
    }

    // A number typed before the register existed keeps showing as itself.
    if (!line.AviationAwbId && line.awb) {
      options.unshift({
        value: `${TYPED}${line.awb}`,
        label: line.awb,
        search: digitsOnly(line.awb),
        typed: true,
      });
    }
    return options;
  };

  const pickAwb = (i, line, key) => {
    if (!key) {
      setFields(i, { AviationAwbId: null, awb: '' });
      return;
    }
    if (String(key).startsWith(TYPED)) return;   // re-picking its own legacy value

    const s = stockById.get(Number(key));
    if (!s) return;

    const patch = {
      AviationAwbId: s.id,
      // The 8 digits printed on the document - the serial and its check digit.
      // The 3-digit prefix is not stored per line: it belongs to the carrier,
      // which the Prefix column reads it from.
      awb: `${s.serial}${s.checkDigit}`,
      // A number names its carrier, so picking one settles that too.
      AviationCarrierId: s.AviationCarrierId ?? line.AviationCarrierId,
      // ...and the master agent it was given out to, which is the second half
      // of the coupling described above.
      masterAgentId: s.masterAgentId ?? line.masterAgentId,
    };

    /* ------------------ carrying a pending load forward ------------------
     * This AWB was offloaded on an earlier flight and still owes cargo. The
     * new leg is the SAME shipment - same shipper, consignee, agent,
     * commodity, route, and priced at the same rates - so all of that is
     * copied rather than retyped, which is how two legs of one AWB end up
     * disagreeing with each other.
     *
     * The WEIGHTS are not copied. This leg carries what is left, not what was
     * originally booked: gross is the outstanding amount, nothing is offloaded
     * yet, and chargeable follows from the two.
     * ------------------------------------------------------------------ */
    if (s.pending > 0 && s.prefill) {
      const p = s.prefill;
      Object.assign(patch, {
        shipperId:     p.shipperId ?? line.shipperId,
        consigneeId:   p.consigneeId ?? line.consigneeId,
        masterAgentId: p.masterAgentId ?? patch.masterAgentId,
        CommodityId:   p.CommodityId ?? line.CommodityId,
        AviationCarrierId: p.AviationCarrierId ?? patch.AviationCarrierId,
        origin:        p.origin || line.origin,
        destination:   p.destination || line.destination,
        natureOfGoods: p.natureOfGoods || line.natureOfGoods,
        buyingExRate:  p.buyingExRate ?? p.exRate ?? line.buyingExRate,
        sellingExRate: p.sellingExRate ?? p.exRate ?? line.sellingExRate,
        buyingRate:    p.buyingRate ?? line.buyingRate,
        sellingRate:   p.sellingRate ?? line.sellingRate,
        // The shipment's own measurements, copied verbatim: the air waybill
        // still says the same pieces, gross and volumetric weight however many
        // aircraft it takes to move it.
        pieces:           p.pieces ?? line.pieces,
        grossWeight:      p.grossWeight ?? line.grossWeight,
        // What THIS flight is actually taking - the outstanding amount, not
        // the whole AWB. Held in its own field because gross above is now the
        // document's figure: without it every sum over this leg would read
        // 1,000 again and the AWB would report more carried than it weighs.
        carriedForward:   s.pending,
        /* The leg this one continues, so the grid can price it the way the
         * reports will BEFORE it has been saved.
         *
         * Every saved line gets this from the server (see withPrevLegs), but a
         * line picked from the pending list has never been near the server, and
         * without it the flight's totals would sit on the stored snapshot until
         * the page was reloaded. That is the gap that let an AWB be offloaded in
         * full, re-cut at a new weight, and go on reporting the old one.
         *
         * Same two figures the rule reads: the predecessor's gross, which says
         * whether this leg is a continuation or a re-cut, and its offload,
         * which is what this leg was asked to pick up. */
        prevLeg: { grossWeight: p.grossWeight, offload: s.pending },
        // Nothing has been left behind on THIS leg yet - the earlier flight's
        // offload is what put the AWB here in the first place.
        offloadPieces:    null,
        offload:          null,
        chargeableWeight: s.pending,
      });
      openNotification(
        'Pending load carried forward',
        `${formatNumber(s.awbNumber)} was left with ${s.pending} kg on ` +
        `${p.from?.jobNo || p.from?.flightNo || 'an earlier flight'}. ` +
        'Its details have been filled in and the weight set to what is outstanding.',
        'blue'
      );
    }

    setFields(i, patch);
  };

  /**
   * Changing the master agent when the chosen AWB is not theirs.
   *
   * The number goes back, because it never belonged to the new agent - but it
   * is SAID rather than done quietly. An AWB that vanished out of a row on its
   * own would be found later by whoever has to explain the missing number.
   */
  const pickMasterAgent = (i, line, agentId) => {
    const held = line.AviationAwbId ? stockById.get(line.AviationAwbId) : null;
    if (held && agentId && held.masterAgentId && held.masterAgentId !== agentId) {
      openNotification(
        'AWB cleared',
        `${formatNumber(held.awbNumber)} is assigned to ${held.masterAgent || 'another master agent'}, ` +
        'so it was removed from this consignment. Pick a number belonging to the new agent.',
        'orange'
      );
      setFields(i, { masterAgentId: agentId, AviationAwbId: null, awb: '' });
      return;
    }
    setField(i, 'masterAgentId', agentId);
  };

  // The prefix shown against an AWB. Read from the picked carrier in the
  // options list first so it updates the moment the carrier changes, falling
  // back to whatever the server sent for a line loaded from the database.
  /* What this AWB would count under if its own tag were left blank: the
   * carrier's. Read from the options list first so it follows a carrier change
   * immediately, falling back to the row the server sent.
   *
   * Shown as the PLACEHOLDER on the tag cell. An empty dropdown that silently
   * means "GAM, because of the carrier" is the version of this feature that
   * gets someone to set an override they did not need. */
  const inheritedTag = (line) => {
    const picked = (values.carrier || []).find((c) => c.id === line.AviationCarrierId);
    return picked?.category || line.Aviation_Carrier?.category || '';
  };

  const prefixOf = (line) => {
    // A DIRECT AWB carries its OWN prefix, typed as part of the number: the
    // document was issued by another airline, so our carrier master's prefix
    // is not the one printed on it. Showing the carrier's here would put a
    // prefix beside a number that disagrees with it.
    if (line.direct) {
      const check = validateAwbNumber(line.awb);
      return check.ok ? check.prefix : '';
    }
    const picked = (values.carrier || []).find((c) => c.id === line.AviationCarrierId);
    return picked?.prefix || line.Aviation_Carrier?.prefix || '';
  };

  /* ------------------------- what is read-only -------------------------
   * THREE LOCKS, and they freeze different things.
   *
   * THE WHOLE ROW is frozen when an APPROVED invoice exists on EITHER side.
   * The weights and the parties are what its charges were computed from and
   * who they were raised against, so changing one would leave the consignment
   * and an issued document disagreeing. Chargeable weight in particular prices
   * both sides at once, which is why it is not split the way the rates are.
   * Being ON an invoice is not the same as being frozen by one; unapproving
   * takes it back out of the books and the row opens again, which is the whole
   * point of unapproving. See isInvoiceLocked.
   *
   * THE RATES FREEZE PER SIDE. A receivable on an approved invoice shuts
   * Selling and Sell Ex. - those are the figures it was computed from - and
   * says nothing whatever about what the airline is paid, so Buying and Buy
   * Ex. stay open. And the other way round.
   *
   * That split is the difference between correcting one document and
   * disturbing two. One invoiced charge on either side used to shut all four,
   * so putting right what a customer is billed meant unapproving the bill to
   * the airline as well - a second document taken out of the books to fix a
   * figure it does not contain. The two sides of an AWB are separate deals,
   * invoiced separately; they freeze separately.
   *
   * A CLOSED FORTNIGHT freezes all four rate cells, invoiced or not. The
   * carrier and the master agent reconcile a half-month at a time, and once
   * that period has closed its figures have been reported. Everything else on
   * the row - weights, parties, remarks - stays editable, because correcting
   * a piece count is not restating a settled account.
   * ------------------------------------------------------------------ */
  const invoiceOf = (line) => chargesOf(line).find(isInvoiceLocked);
  const isLocked = (line) => Boolean(invoiceOf(line));

  // Whole-flight, so both are computed once rather than per row.
  const rateWindowOpen = ratesOpen(job?.flightDate);
  const closedOnDate = rateWindowOpen ? '' : showDate(fortnightEnd(job?.flightDate));

  /**
   * Whether ONE side's rate pair is shut, and by what.
   *
   * Returns the reason rather than a boolean so the cell can say which rule
   * closed it - a box that ignores typing with no explanation reads as a
   * fault, and "this side is invoiced" and "the fortnight has closed" are very
   * different things to be told.
   */
  const sideLock = (line, type) => {
    if (!rateWindowOpen) {
      return `Rates for this flight closed with its fortnight on ${closedOnDate} and can no longer be changed.`;
    }
    const billed = lockingInvoice(chargesOf(line), type);
    if (!billed) return '';
    const side = type === RECEIVABLE ? 'receivable' : 'payable';
    const other = type === RECEIVABLE ? 'buying' : 'selling';
    return `A ${side} charge on this AWB is on ${billed.invoice_id || 'an approved invoice'}, ` +
           `so this side is fixed. Unapprove that document to change it — the ${other} ` +
           'side is unaffected and stays open.';
  };

  // Whether the charter may pre-fill this row - it writes BOTH sides, so it
  // stands off if either is shut.
  const ratesFrozen = (line) =>
    !rateWindowOpen || sellingLocked(chargesOf(line)) || buyingLocked(chargesOf(line));

  // Malformed only - a blank or a not-yet-finished number is not an error to
  // show in red while someone is still typing it. Save reports the blank,
  // through REQUIRED_CONSIGNMENT_FIELDS.
  const awbError = (line) => {
    if (!line.direct || !String(line.awb || '').trim()) return null;
    const check = validateAwbNumber(line.awb);
    return check.ok ? null : check.error;
  };

  const sum = (field) => lines.reduce((t, x) => t + (parseFloat(x[field]) || 0), 0);
  const fmt = (n, dp = 2) => (Number.isFinite(n) ? n.toFixed(dp) : (0).toFixed(dp));

  return (
    <div>
      <button type='button' className='btn-custom fw-8' onClick={addLine} disabled={disabled}>
        Add Consignment +
      </button>
      {/* Said out loud rather than left as four boxes that ignore typing. The
          rates closed with the period they were reconciled in - which is a
          rule, not a fault, so it reads as information. */}
      {!rateWindowOpen && (
        <Tag color='default' className='mx-2 fortnight-tag'>
          Rates closed {closedOnDate ? `with the fortnight ending ${closedOnDate}` : 'for this flight'} —
          weights and details are still editable
        </Tag>
      )}

      <div style={{ overflowX: 'auto' }} className='consignments-grid'>
        <Table className='mt-2'>
          <thead>
            <tr style={{ whiteSpace: 'nowrap' }}>
              <th>#</th>
              <th className='col-direct'
                title="Someone else's load, flown for them: on the manifest, never billed">
                Direct
              </th>
              {/* col-req marks the nine fields every consignment must carry
                  before the flight will save - see REQUIRED_CONSIGNMENT_FIELDS
                  in functions/aviationValidation, which is the one list the
                  marker, the save check and the tests all read. */}
              {/* FIVE HEADINGS REGISTER THEIR MASTER - carrier, AWB number,
                  master agent, destination and commodity. Between them that is
                  every picked field a consignment cannot be saved without, so
                  a whole AWB can be entered without leaving the flight. See
                  ./QuickRegister. On the heading rather than beside every
                  dropdown: the answer is the same for the whole column, and
                  twenty plus-signs down a twenty-column grid is noise. */}
              <th className='col-req col-quick'
                onClick={() => !disabled && setRegistering('carrier')}
                title='Register a carrier without leaving this flight'>
                Carrier <PlusCircleOutlined className='quick-add' />
              </th>
              <th>Prefix</th>
              {/* Beside the carrier, because that is where the tag normally
                  comes from and this column is the exception to it. */}
              <th className='col-tag'
                title='Which column of the monthly report this AWB counts toward. Blank follows the carrier.'>
                Report Tag
              </th>
              <th className='col-req col-quick'
                onClick={() => !disabled && setRegistering('awb')}
                title='Register an AWB number without leaving this flight'>
                AWB # <PlusCircleOutlined className='quick-add' />
              </th>
              <th>Shipper</th>
              <th>Consignee</th>
              <th className='col-req col-quick'
                onClick={() => !disabled && setRegistering('masterAgent')}
                title='Register a master agent without leaving this flight'>
                Master Agent <PlusCircleOutlined className='quick-add' />
              </th>
              <th className='col-req col-quick'
                onClick={() => !disabled && setRegistering('airport')}
                title='Register an airport without leaving this flight'>
                Destination <PlusCircleOutlined className='quick-add' />
              </th>
              <th className='col-req col-quick'
                onClick={() => !disabled && setRegistering('commodity')}
                title='Register a commodity without leaving this flight'>
                Commodity <PlusCircleOutlined className='quick-add' />
              </th>
              <th className='col-req'>Pieces</th>
              <th className='col-req'>Gross WT</th>
              <th className='col-req'>Chargeable WT</th>
              {/* What did NOT fly, counted in packages as well as kilos. */}
              <th>Offload Pcs</th>
              <th>Offload WT</th>
              {/* What happens to the offload: waiting for the next aircraft,
                  or finished. See the cell. */}
              <th className='col-closed' title='Nothing on this AWB is waiting for a later flight'>
                Close AWB
              </th>
              <th>Buying</th>
              <th className='col-req'>Selling</th>
              {/* One conversion per side - see blankLine. */}
              <th>Buy Ex.</th>
              <th>Sell Ex.</th>
              <th>Remarks</th>
              {/* Last, because it is the last thing done to an AWB: the row is
                  complete and checked, and its Air Freight charge is raised. */}
              <th className='col-approved' title='Raises the Air Freight charge on both sides'>
                Approved
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((x, i) => {
              const rowLocked = isLocked(x);
              // PER SIDE - see the lock block. A receivable invoice shuts the
              // selling pair and leaves buying alone, and the other way round.
              // Each carries the reason it is shut, so a disabled box says why.
              const sellShut = sideLock(x, RECEIVABLE);
              const buyShut = sideLock(x, PAYABLE);
              const billedOn = invoiceOf(x);
              return (
              <tr className={`f ${rowLocked ? 'locked' : ''}`} key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {i + 1}
                  {rowLocked && (
                    <LockOutlined
                      className='lock-icon'
                      title={`Invoiced on ${billedOn.invoice_id || billedOn.Invoice?.invoice_No || 'an invoice'} — edit the invoice to change this AWB`}
                    />
                  )}
                </td>
                {/* Direct: on the manifest, off the invoice. */}
                <td className='col-direct'>
                  <Checkbox
                    checked={Boolean(x.direct)}
                    disabled={rowLocked || disabled}
                    title={rowLocked
                      ? 'This AWB is invoiced, so it cannot become a direct consignment'
                      : "Someone else's load, flown for them - not billed, and the AWB is typed"}
                    onChange={(e) => setDirect(i, x, e.target.checked)}
                  />
                </td>
                {/* Whose cargo this is. The carrier brings its AWB prefix and
                    its ER/IFA/Other tag, which is what the monthly report
                    counts the uplift by. */}
                <td>
                  <Select style={{ width: 160 }} value={x.AviationCarrierId || undefined}
                    allowClear showSearch optionFilterProp='label' disabled={rowLocked || disabled}
                    placeholder='Carrier'
                    onChange={(e) => setField(i, 'AviationCarrierId', e ?? null)}
                    options={carrierOptions} />
                </td>
                {/* Read-only: the prefix belongs to the carrier, and an AWB is
                    prefix + serial. Typing it per consignment would let the
                    same carrier end up with two different prefixes. */}
                <td className='awb-prefix'>{prefixOf(x) || <span className='muted'>—</span>}</td>
                {/* THE PER-AWB REPORTING TAG.
                    Empty is not "no tag" but "the carrier's", and the
                    placeholder says which one that is rather than leaving the
                    user to go and look: a blank cell that silently means GAM
                    is worse than no cell at all. Clearing it goes back to
                    inheriting, which is why it is allowClear. */}
                <td className='col-tag'>
                  <Select
                    style={{ width: 110 }}
                    value={x.reportingTag || undefined}
                    allowClear
                    disabled={rowLocked || disabled}
                    placeholder={inheritedTag(x) || 'none'}
                    title={x.reportingTag
                      ? CATEGORY_HINT[x.reportingTag]
                      : inheritedTag(x)
                        ? `Follows the carrier: ${inheritedTag(x)}. Pick one here to count this AWB somewhere else.`
                        : 'This carrier has no reporting tag, so this AWB counts toward no column. Pick one here, or tag the carrier in Setup.'}
                    onChange={(e) => setField(i, 'reportingTag', e ?? null)}
                    options={CARRIER_CATEGORIES.map((c) => ({
                      value: c, label: c, title: CATEGORY_HINT[c],
                    }))}
                  />
                </td>
                {/* Normally PICKED from the register - see the block above.
                    On a direct consignment the number belongs to whoever sold
                    the shipment and is not in our stock, so the field opens up
                    and is simply typed. */}
                <td>
                  {x.direct ? (
                  /* A DIRECT AWB is typed, not picked - it is another
                     airline's document and is not in our register. So it is
                     the one number here nothing else has already checked, and
                     it is checked against the IATA format as it is typed: 11
                     digits, and a check digit that is the serial modulo 7.
                     That arithmetic is what catches a transposed digit copied
                     off someone else's paperwork, which otherwise only shows
                     up when the manifest will not reconcile.
                     Red WHILE TYPING but not refused until Save - an
                     half-entered number is not yet a wrong one. */
                  <Input
                    style={{ width: 175 }}
                    value={x.awb || ''}
                    disabled={rowLocked || disabled}
                    status={awbError(x) ? 'error' : undefined}
                    placeholder='e.g. 214-10000001'
                    title={awbError(x) || "The full 11-digit number from the other airline's air waybill"}
                    onChange={(e) => setField(i, 'awb', e.target.value)}
                    /* Separators stripped the moment the field is left, so
                       what is on screen is what will be stored. The SERVER
                       does this too and is what decides - this is here so the
                       number does not appear to change under the user after a
                       save. Applied whether or not the number is valid yet: a
                       half-typed one still gets one spelling. */
                    onBlur={() => {
                      const tidy = normalizeAwb(x.awb);
                      if (tidy !== null && tidy !== x.awb) setField(i, 'awb', tidy);
                    }}
                  />
                  ) : (
                  <Select
                    style={{ width: 175 }}
                    value={
                      x.AviationAwbId ? String(x.AviationAwbId)
                        : x.awb ? `${TYPED}${x.awb}`
                        : undefined
                    }
                    allowClear showSearch disabled={rowLocked || disabled}
                    placeholder='AWB #'
                    notFoundContent='No AWBs in stock for this carrier / master agent'
                    // The closed cell shows the number alone; the open list
                    // shows what else is known about each one. Searching is on
                    // digits, so 214-10000001 and 21410000001 both find it.
                    optionLabelProp='label'
                    filterOption={(input, option) =>
                      String(option.search || '').includes(digitsOnly(input))}
                    onChange={(key) => pickAwb(i, x, key)}
                  >
                    {awbOptionsFor(x).map((o) => (
                      <Select.Option key={o.value} value={o.value} label={o.label} search={o.search}>
                        <span className='awb-opt'>
                          <b>{o.label}</b>
                          {o.typed && <em> · typed, not in the register</em>}
                          {o.pending > 0 && <b className='awb-pending'> · {o.pending} kg pending</b>}
                          {o.agent && <em> · {o.agent}</em>}
                        </span>
                      </Select.Option>
                    ))}
                  </Select>
                  )}
                </td>
                {/* Each role picks only from parties tagged with that type in
                    Setup > Parties. Master Agent is handled separately: it is
                    coupled to the AWB in both directions. */}
                {['shipperId', 'consigneeId'].map((field) => (
                  <td key={field}>
                    <Select style={{ width: 190 }} value={x[field] || undefined} allowClear showSearch
                      optionFilterProp='label' disabled={rowLocked || disabled}
                      onChange={(e) => setField(i, field, e ?? null)}
                      options={roleOptions[field]} />
                  </td>
                ))}
                <td>
                  <Select style={{ width: 190 }} value={x.masterAgentId || undefined} allowClear showSearch
                    optionFilterProp='label' disabled={rowLocked || disabled}
                    title='Narrows the AWB list to this agent&apos;s registered numbers'
                    onChange={(e) => pickMasterAgent(i, x, e ?? null)}
                    options={roleOptions.masterAgentId} />
                </td>
                <td>
                  <Select style={{ width: 170 }} value={x.destination || undefined} allowClear showSearch
                    optionFilterProp='label' disabled={rowLocked || disabled}
                    onChange={(e) => setField(i, 'destination', e ?? '')}
                    options={airportOptions} />
                </td>
                <td>
                  <Select style={{ width: 200 }} value={x.CommodityId || undefined} allowClear showSearch
                    optionFilterProp='label' disabled={rowLocked || disabled}
                    onChange={(e) => setField(i, 'CommodityId', e ?? null)}
                    options={(values.commodity || []).map((c) => ({ value: c.id, label: c.name }))} />
                </td>
                <td>
                  <InputNumber controls={false} style={{ width: 90 }} value={x.pieces} disabled={rowLocked || disabled}
                    onBlur={() => completeBooking(i)}
                    onChange={(e) => setField(i, 'pieces', e)} />
                </td>
                <td>
                  <InputNumber controls={false} style={{ width: 110 }} step={0.01} value={x.grossWeight} disabled={rowLocked || disabled}
                    onBlur={() => completeBooking(i)}
                    onChange={(e) => setField(i, 'grossWeight', e)} />
                </td>
                {/* Derived from Gross WT and Offload WT - see the note above
                    setField. Still editable, because chargeable weight is
                    conventionally the greater of actual and volumetric and
                    sometimes has to be raised by hand. */}
                <td>
                  {/* Red WHILE TYPING but not refused until Save, the same way
                      a direct AWB number is: a nought on a row still being
                      filled in is not yet a wrong one. The title carries the
                      reason, so a red box says what is wrong with it rather
                      than only that something is. */}
                  <InputNumber controls={false} style={{ width: 120 }} step={0.01} value={x.chargeableWeight} disabled={rowLocked || disabled}
                    status={chargeableWeightError(x) ? 'error' : undefined}
                    className={num(x.chargeableWeight) === num(chargeableWeightFor(x)) ? 'derived-weight' : undefined}
                    title={chargeableWeightError(x)
                      || 'Gross WT less Offload WT. Filled in automatically; type here to override.'}
                    onChange={(e) => setField(i, 'chargeableWeight', e)} />
                </td>
                {/* What did NOT fly, on this AWB. It used to be two figures on
                    the flight - ER Offload and Other Offload - which named no
                    cargo and could not be reconciled against anything. Gross
                    WT stays what the air waybill says.
                    Counted in packages AND kilos: an offload is a number of
                    boxes left on the ground, and the manifest is reconciled in
                    both units. Only the weight prices anything, so only it is
                    a WEIGHT_DRIVER. */}
                <td>
                  <InputNumber controls={false} style={{ width: 100 }} value={x.offloadPieces}
                    disabled={rowLocked || disabled} placeholder='0'
                    title='Packages on this AWB that did not make the flight'
                    onBlur={() => completeBooking(i)}
                    onChange={(e) => setField(i, 'offloadPieces', e)} />
                </td>
                <td>
                  <InputNumber controls={false} style={{ width: 105 }} step={0.01} value={x.offload}
                    disabled={rowLocked || disabled} placeholder='0.00'
                    title='Weight on this AWB that did not make the flight'
                    onBlur={() => completeBooking(i)}
                    onChange={(e) => setField(i, 'offload', e)} />
                </td>
                {/* CLOSE AWB: this offload is not waiting for an aircraft.
                    An offload normally means the cargo goes on a later flight,
                    and the AWB stays on the outstanding-loads list until one
                    carries it. Sometimes there is nothing to carry - perishables
                    go back to the master agent once the cold chain is broken, a
                    booking is withdrawn, a shipment goes out on another airline
                    - and the AWB would otherwise sit on that list for ever.
                    Ticked by hand, because which of those it is is a judgement
                    about the shipment. It replaced a rule that closed every
                    perishable commodity automatically, which could say neither
                    "this perishable is still going" nor "these machine parts
                    are not". Nothing about the money changes: the offload is
                    still recorded and the chargeable weight is still what flew. */}
                <td className='col-closed'>
                  {/* Shut until there is an offload to close. With nothing
                      left behind there is nothing for the tick to say, and an
                      AWB the register thinks is closed but that never left
                      anything on the ground reads as a fault later. */}
                  <Checkbox
                    checked={Boolean(x.awbClosed)}
                    disabled={rowLocked || disabled || !num(x.offload)}
                    title={num(x.offload) > 0
                      ? 'Nothing on this AWB is waiting for a later flight — take it off the outstanding-loads list'
                      : 'Nothing was offloaded, so there is nothing to close'}
                    onChange={(e) => setField(i, 'awbClosed', e.target.checked)}
                  />
                </td>
                {/* THE SAME FOUR FIELDS the Charges tab shows - one
                    consignment record, edited from either place, so they
                    cannot drift apart. Here because rates are known when the
                    AWB is entered, and having to open Charges to record them
                    meant they were often left until later and then guessed.
                    Charges are priced per kg off these: every receivable at
                    Selling and converted at Sell Ex., every payable at Buying
                    and converted at Buy Ex. */}
                <td>
                  <InputNumber controls={false} style={{ width: 100 }} step={0.01} value={x.buyingRate}
                    disabled={Boolean(buyShut) || disabled} placeholder='payable'
                    title={buyShut || 'Cost per kg — what every payable charge on this AWB is costed at'}
                    onChange={(e) => setField(i, 'buyingRate', e)} />
                </td>
                <td>
                  <InputNumber controls={false} style={{ width: 100 }} step={0.01} value={x.sellingRate}
                    disabled={Boolean(sellShut) || disabled} placeholder='receivable'
                    title={sellShut || 'Rate per kg — what every receivable charge on this AWB is billed at'}
                    onChange={(e) => setField(i, 'sellingRate', e)} />
                </td>
                {/* Two conversions, one per side of the ledger: the space was
                    bought and sold on different days and sometimes in
                    different currencies, so a single rate quietly moved the
                    margin. Each governs the charges on its own side - see
                    GOVERNS on the Charges tab. */}
                <td>
                  <InputNumber controls={false} style={{ width: 90 }} step={0.01} value={x.buyingExRate}
                    disabled={Boolean(buyShut) || disabled} placeholder='1'
                    title={buyShut || "Converts this AWB's PAYABLE currency to the books' currency"}
                    onChange={(e) => setField(i, 'buyingExRate', e)} />
                </td>
                <td>
                  <InputNumber controls={false} style={{ width: 90 }} step={0.01} value={x.sellingExRate}
                    disabled={Boolean(sellShut) || disabled} placeholder='1'
                    title={sellShut || "Converts this AWB's RECEIVABLE currency to the books' currency"}
                    onChange={(e) => setField(i, 'sellingExRate', e)} />
                </td>
                {/* Remarks stay OPEN on a locked AWB. They are notes about the
                    consignment, not figures the charges were computed from, so
                    editing them cannot put the invoice and the AWB at odds -
                    and a note explaining why an AWB was invoiced the way it was
                    is most wanted after the fact. The server saves this one
                    field on a locked line for the same reason. */}
                <td>
                  <Input style={{ width: 200 }} value={x.remarks || ''} disabled={disabled}
                    placeholder={rowLocked ? 'Notes (still editable)' : 'Notes for this AWB'}
                    onChange={(e) => setField(i, 'remarks', e.target.value)} />
                </td>
                {/* APPROVED: the AWB is checked, and its Air Freight charge is
                    raised on both sides - see the approve handler. A DIRECT
                    consignment cannot be approved: it is someone else's load on
                    someone else's air waybill, there is nothing of ours to bill
                    on it, and the server clears any charge left on one. */}
                <td className='col-approved'>
                  {/* NOT disabled by an invoice, unlike the cells around it.
                      Un-approving an invoiced AWB is refused - but by a message
                      that says why and points at the shorter way to correct a
                      rate, which is worth far more than a dead checkbox. */}
                  <Checkbox
                    checked={Boolean(x.awbApproved)}
                    disabled={disabled || x.direct}
                    title={x.direct
                      ? 'A direct consignment is not billed, so there is nothing to approve'
                      : x.awbApproved
                        ? 'Approved — untick to remove its Air Freight charges'
                        : 'Approve, raising the Air Freight charge on both sides'}
                    onChange={(e) => (e.target.checked ? approve(i, x) : unapprove(i, x))}
                  />
                  {/* APPROVED FIRST, OFFLOADED AFTERWARDS.
                      Approving is now refused on an AWB that carried nothing,
                      but an AWB approved while it still had a load keeps the
                      pair it was given, and a later full offload only reprices
                      those rows to 0 - it cannot delete them, because one of
                      them may already be invoiced. So the row sits there
                      billing nothing, and nothing else on this screen says so.
                      Flagged rather than fixed: untick to remove the charges,
                      which is the one safe answer that does not touch an
                      invoiced row. */}
                  {x.awbApproved && !x.direct && num(x.chargeableWeight) <= 0 && (
                    <span className='zero-charge-warn'
                      title={'Approved, but this AWB carried nothing - its Air Freight is 0 on '
                        + 'both sides. Untick to remove those rows, or they will reach an '
                        + 'invoice as zero-value lines.'}>!</span>
                  )}
                </td>
                <td>
                  <CloseCircleOutlined
                    className='mx-2 cross-icon'
                    title={rowLocked ? 'Invoiced AWBs cannot be removed' : 'Remove this consignment'}
                    style={rowLocked ? { opacity: 0.25, cursor: 'not-allowed' } : undefined}
                    onClick={() => { if (!rowLocked && !disabled) removeLine(i); }} />
                </td>
              </tr>
            );})}
            {lines.length === 0 && (
              <tr>
                <td colSpan={24} className='text-center grey-txt fs-12 py-4'>
                  No consignments on this flight yet. Use <b>Add Consignment +</b> to put an AWB on it.
                </td>
              </tr>
            )}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className='fw-7'>
                {/* #, Direct, Carrier, Prefix, Report Tag, AWB, Shipper,
                    Consignee, Master Agent, Destination, Commodity - then the
                    numeric columns worth totalling, then the four rates (a
                    total of a per-kg rate means nothing), then Remarks +
                    Modify. */}
                <td colSpan={11} className='text-end'>Flight totals</td>
                <td>{sum('pieces')}</td>
                <td>{fmt(sum('grossWeight'))}</td>
                <td>{fmt(sum('chargeableWeight'))}</td>
                <td>{sum('offloadPieces')}</td>
                <td>{fmt(sum('offload'))}</td>
                {/* How many AWBs on this flight are finished with, of the ones
                    that left something behind. Counted rather than blank: it is
                    the difference between a flight whose offloads are all
                    settled and one that has three AWBs still owing cargo. */}
                <td className='col-closed'>
                  {lines.filter((l) => l.awbClosed && num(l.offload) > 0).length || ''}
                </td>
                {/* Buying, Selling, Buy Ex., Sell Ex. */}
                <td colSpan={4}></td>
                {/* How many AWBs on this flight have been approved, of the
                    ones that could be. A flight with three unapproved AWBs is
                    three Air Freight charges short of complete. */}
                <td></td>
                <td className='col-approved'>
                  {lines.filter((l) => l.awbApproved).length || ''}
                </td>
                {/* Modify */}
                <td></td>
              </tr>
            </tfoot>
          )}
        </Table>
      </div>

      {/* Registering a master from here adds it to the list this screen is
          already holding, rather than reloading every pick list on the flight -
          a reload would also throw away the AWB stock and the charge masters,
          and re-fetching thousands of parties to learn about one is the wrong
          shape of request. The record is NOT selected onto a row: the heading
          belongs to the column, not to any one consignment. */}
      <CommodityModal
        open={registering === 'commodity'}
        onClose={() => setRegistering('')}
        onCreated={(row) => onRegister?.('commodity', row)}
      />
      <PartyModal
        open={registering === 'masterAgent'}
        onClose={() => setRegistering('')}
        type='Master Agent'
        onCreated={(row) => onRegister?.('masterAgent', row)}
      />
      <CarrierModal
        open={registering === 'carrier'}
        onClose={() => setRegistering('')}
        // The billable parties, so a carrier already in the books can be
        // linked to the account it has rather than given a second one.
        parties={values.party || []}
        onCreated={(row, party) => onRegister?.('carrier', row, party)}
      />
      {/* The AWB dialog needs both masters a number hangs off - it is
          registered against a carrier and handed to a master agent, and the
          grid offers a row only the numbers matching both. */}
      <AwbModal
        open={registering === 'awb'}
        onClose={() => setRegistering('')}
        carriers={values.carrier || []}
        masterAgents={values.masterAgent || []}
        onCreated={() => onRegister?.('awb')}
      />
      {/* The airports already known, so a code that is registered twice is
          caught here with a sentence rather than by a unique constraint. */}
      <AirportModal
        open={registering === 'airport'}
        onClose={() => setRegistering('')}
        airports={values.airport || []}
        onCreated={(row) => onRegister?.('airport', row)}
      />
      {lockStyles}
    </div>
  );
};

const lockStyles = (
  <style jsx global>{`
    /* An invoiced AWB is part of an issued document - read-only, and visibly
       so, rather than a row that ignores what you type into it. */
    .consignments-grid tr.locked td { background: #f0f5ff; }
    .consignments-grid tr.locked td:first-child { box-shadow: inset 3px 0 0 #2f54eb; }
    .consignments-grid .lock-icon { margin-left: 6px; color: #2f54eb; }
    /* The AWB dropdown carries more than the number: who it is assigned to,
       and whether it is already flying. Dimmed so the number still reads
       first. */
    .awb-opt em { font-style: normal; color: #8a97a3; font-size: 11px; }
    /* A heading that opens a registration form says so - it is a control, and
       a column title that silently reacts to a click is a trap. */
    .consignments-grid th.col-quick { cursor: pointer; white-space: nowrap; }
    .consignments-grid th.col-quick .quick-add { color: #2f54eb; margin-left: 2px; }
    .consignments-grid th.col-quick:hover { color: #2f54eb; }
    .consignments-grid th.col-approved,
    .consignments-grid td.col-approved,
    .consignments-grid th.col-closed,
    .consignments-grid td.col-closed {
      width: 1%;
      white-space: nowrap;
      text-align: center;
      padding-left: 6px;
      padding-right: 6px;
    }
    /* A checkbox needs no more room than its header word.
       THE 170px CAME FROM styles/clientLayout.scss:
         .client-styles label { min-width: 170px !important; }
       which is there to line up the form labels on the party screen. An antd
       Checkbox renders as a <label>, and this grid sits inside a
       .client-styles wrapper - so the box was being stretched to 170px,
       dragging the column out with it and pinning the tick to the left of all
       that space. Undone only inside this grid, so the party form keeps its
       aligned labels. !important is needed to beat !important. */
    .consignments-grid .ant-checkbox-wrapper {
      min-width: 0 !important;
      margin: 0;
    }
    .consignments-grid th.col-direct,
    .consignments-grid td.col-direct {
      width: 1%;
      white-space: nowrap;
      text-align: center;
      padding-left: 6px;
      padding-right: 6px;
    }
    /* An approved AWB that carried nothing. Small and orange rather than a
       banner: it is a state to notice on the row it belongs to, not an error
       about the flight. */
    .consignments-grid .zero-charge-warn {
      display: inline-block;
      margin-left: 6px;
      width: 14px;
      height: 14px;
      line-height: 14px;
      text-align: center;
      border-radius: 50%;
      background: #fa8c16;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      cursor: help;
    }
    /* The per-AWB reporting tag. An OVERRIDE, so it is deliberately quiet:
       a row that is simply following its carrier should not draw the eye
       across a twenty-column grid, and one that is not says so by having a
       value in it. */
    .consignments-grid th.col-tag,
    .consignments-grid td.col-tag {
      width: 1%;
      white-space: nowrap;
    }
    .consignments-grid td.col-tag .ant-select-selection-placeholder {
      font-style: italic;
      opacity: 0.55;
    }
    /* An AWB still owing cargo reads differently from fresh stock - picking
       it continues a shipment rather than starting one. */
    .awb-opt .awb-pending { color: #cf1322; font-size: 11px; }
    /* The fields a consignment cannot be saved without. Marked once on the
       header rather than on every cell - an asterisk repeated down twenty
       columns of a grid is noise, and the save check names the row and the
       field anyway. */
    .consignments-grid th.col-req::after {
      content: ' *';
      color: #cf1322;
      font-weight: 700;
    }
    /* Chargeable weight while it still matches gross - offload: shown as a
       result rather than something that was typed. Overriding it by hand
       clears the tint, which is the signal that the rule no longer holds. */
    .consignments-grid .derived-weight input { background: #f6f9fc; }
  `}</style>
);

export { blankLine };
export default React.memo(Consignments);
