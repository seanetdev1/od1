import React from 'react';
import { jobDocRights } from 'functions/jobDocRights';

// Everything allowed - for a caller that does not say.
const ALL_RIGHTS = jobDocRights(() => true);
import { Table } from 'react-bootstrap';
import { Collapse, Select, Input, InputNumber, Tag, Empty, Checkbox } from 'antd';
import { CloseCircleOutlined, CheckCircleFilled, ClockCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import Cookies from 'js-cookie';
import moment from 'moment';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import PopConfirm from 'Components/Shared/PopConfirm';
import { AuditTip } from 'Components/Shared/AuditStamp';
// Pricing lives in its own module so it can be tested, and so the rules the
// screen shows are the same ones the backend stores - see the file.
import {
  RECEIVABLE, PAYABLE, PER_UNIT, PER_SHIPMENT, num,
  isPerShipment, isTaxed, isInvoiced, isInvoiceLocked, isApproved, rateFor, exRateFor,
  computeBaseAmount, taxAmountOf, computeNetAmount, computeLocalAmount,
} from 'functions/aviationPricing';
// Rates close with the flight's fortnight; everything else on a charge stays
// editable. See the module.
import { ratesOpen, fortnightEnd, showDate } from 'functions/aviationFortnight';
// Charge_Head.charge and .partyId are STRING columns pointing at integer
// masters - see the file for why that has to be reconciled on read.
import { asId } from 'functions/chargeIds';
// A new payable starts against the carrier's party - see addCharge. Which
// party a charge's registered TYPE resolves to is chargeMasterPatch's job.
import { carrierPartyFor } from 'functions/aviationParty';
// How a charge row is built - blank, and with a registered charge applied to
// it. Shared with the Consignments grid, which raises the Air Freight pair on
// approval through the SAME code, so an automatic row and a hand-picked one
// can never be built differently. See the module.
import {
  blankCharge, chargeMasterPatch,
  GOVERNS, isAwbRateField, repriceForAwb, lockingInvoice,
} from 'functions/aviationChargeRow';

// Charges, one collapsible section per AWB.
//
// An aviation charge IS a Charge_Head - the same table the freight side uses -
// so the field names here are Charge_Head's, not aviation-specific ones. That
// is what lets an aviation charge be invoiced, posted to the ledger and
// printed by exactly the same code as a freight charge.
//
//   qty          = chargeable weight     rate_charge = rate
//   discount     = adhoc                 net_amount  = the charge
//   ex_rate      = exchange rate         local_amount = net_amount x ex_rate
//   charge       = Charges.id            particular   = its name
//   tax_apply    = tax on/off            taxPerc      = its percentage
//
// HOW A CHARGE IS PRICED
//
//   rate         = the AWB's selling rate for a receivable, buying rate for a payable
//   base         = Per Unit     -> qty x (rate - discount)
//                  Per Shipment -> qty x the typed fee; rate is the fee and
//                                  the discount plays no part
//   net amount   = base + tax, tax being base x taxPerc when the row's toggle
//                  is on - see WHAT SETUP > CHARGES BRINGS
//   local amount = net amount x the charge's ex-rate, which defaults to the
//                  AWB's SELL ex-rate on a receivable and its BUY ex-rate on a
//                  payable - see GOVERNS
//
// Adhoc/discount comes off the RATE, so it scales with the weight: 1 on a
// 100 kg AWB is 100 off, not 1 off.
//
// PER SHIPMENT IS A FEE TIMES A COUNT, not one flat figure. The same handling
// charge is raised once per shipment, per pallet, per document - so the fee is
// typed in Rate and how many of them in Qty. A charge stored before the count
// existed carries qty 1, which is exactly what it meant, so it prices
// unchanged.
//
// TAX IS FOLDED INTO THE NET AMOUNT rather than shown beside it: an invoice's
// total is the sum of its charges' net amounts, so tax left out of it would be
// printed on the line and missing from the document. The Tax Amt column shows
// it on its own, and it is stored on its own as Charge_Head.tax_amount.
//
// WHAT SETUP > CHARGES BRINGS. Picking a charge pushes what it was REGISTERED
// with onto the row: its currency, its basis, which party it falls to, whether
// it is taxed and at what percentage, and its fixed amount if it has one.
// Every one of those is a DEFAULT - the row stays editable, because the one
// shipment that is exempt, or priced differently, is exactly the case a
// registered charge cannot express.
//
// The rates on the AWB are DEFAULTS pushed down onto its charges - changing
// one reprices every charge it governs. Individual rows can be adjusted after.
//
// TYPE VALUES ARE THE APP'S OWN MISSPELLINGS - 'Recievable' and 'Payble'.
// makeInvoiceNew and the ledger branch on those exact strings, so spelling
// them correctly here would silently misclassify every aviation invoice.


// The same set Setup > Charges and the Direct Job screen offer, so a currency
// picked here is one the rest of the app already understands.
const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF']
  .map((c) => ({ value: c, label: c }));

// Abbreviated the way the freight charges table shows it.
const BASIS_OPTIONS = [
  { value: PER_UNIT, label: 'P/Unit' },
  { value: PER_SHIPMENT, label: 'P/Shpt' },
];

// rights: charges and the invoices raised from them, apart (the user's request,
// 2026-10-20 - functions/jobDocRights); canceled: the flight is cancelled.
// `disabled` is "may not change charges", which is not "may not raise".
const Charges = ({ lines, setLines, values, disabled, onInvoice, invoicing, related = {}, job = {}, rights = ALL_RIGHTS, canceled = false }) => {

  // Which charges are ticked for invoicing. Keyed by Charge_Head id, so an
  // unsaved charge simply cannot be selected - it has no id to invoice.
  const [selected, setSelected] = React.useState(() => new Set());

  const dispatchTab = useDispatch();

  // Open the invoice a charge was billed on, the same way Accounts >
  // Invoice/Bills and the Job Balancing report do it: navigate to the invoice
  // detail page AND register the tab, so it behaves like every other invoice
  // link in the app rather than a dead-end page load.
  const openInvoice = (c) => {
    const invoiceId = c.InvoiceId ?? c.Invoice?.id;
    if (!invoiceId) return;
    Router.push(`/reports/invoice/${invoiceId}`);
    dispatchTab(incrementTab({
      label: 'Invoice details',
      key: '3-17',
      id: `${invoiceId}`,
    }));
  };

  // Labelled "(code) short" - how the freight charge screens label a charge and
  // how the office recognises one. `label` and `name` were the SAME field until
  // 1.2.2, which is why charges raised before then stored "(2) AF" as their
  // particular, where an invoice prints the charge name. Falls back to `name`
  // so a browser holding a pre-1.2.2 response still labels its dropdown.
  const chargeOptions = React.useMemo(
    () => (values.charge || []).map((c) => ({ value: c.id, label: c.label || c.name })),
    [values.charge]
  );
  const partyOptions = React.useMemo(
    () => (values.party || []).map((c) => ({ value: c.id, label: c.name })),
    [values.party]
  );

  const allCharges = (line) => line.Charge_Heads || line.charges || [];
  const chargesOf = (line, type) => allCharges(line).filter((c) => c.type === type);

  // Rates stay correctable until the flight's fortnight closes - see the
  // module. Whole-flight, so it is worked out once rather than per charge row.
  const rateWindowOpen = ratesOpen(job?.flightDate);
  const rateClosedOn = rateWindowOpen ? '' : showDate(fortnightEnd(job?.flightDate));

  const setCharges = (lineIndex, next) => {
    const updated = [...lines];
    updated[lineIndex] = {
      ...updated[lineIndex],
      charges: next,
      // Keep the server-shaped key in step so a re-render after save and a
      // re-render after an edit show the same thing.
      Charge_Heads: next,
    };
    setLines(updated);
  };


  // The AWB's rates live on the consignment but are edited here, because they
  // only mean anything next to the charges they price. Changing one REPRICES
  // the charges it governs, through the SAME rule the Consignments grid uses -
  // the four fields are on both tabs and both have to do the same thing with
  // them. See repriceForAwb.
  const setLineField = (lineIndex, field, value) => {
    const line = lines[lineIndex];
    const nextLine = { ...line, [field]: value };

    if (isAwbRateField(field)) {
      const next = repriceForAwb(allCharges(line), nextLine, field);
      nextLine.charges = next;
      nextLine.Charge_Heads = next;
    }

    const updated = [...lines];
    updated[lineIndex] = nextLine;
    setLines(updated);
  };

  // A new PAYABLE starts against the carrier: the airline sold the space, so
  // it is who this is owed to in all but the exceptional case. Receivables get
  // no default - who is being billed genuinely varies line to line. Either can
  // be changed on the row, and picking a charge whose Setup > Charges default
  // names a different party overrides it.
  const addCharge = (lineIndex, type) => {
    const line = lines[lineIndex];
    setCharges(lineIndex, [
      ...allCharges(line),
      blankCharge(
        type, line.chargeableWeight, rateFor(line, type), exRateFor(line, type),
        type === PAYABLE ? carrierPartyFor(line, values.carrier, values.party) : null
      ),
    ]);
  };

  // Applies several fields in ONE update. Two chained single-field calls do
  // not work: rows are matched by object identity, so the second would be
  // looking for a charge the first has already replaced.
  const setFields = (lineIndex, charge, patch) => {
    const next = allCharges(lines[lineIndex]).map((c) => {
      if (c !== charge) return c;
      const updated = { ...c, ...patch };

      /* ------------------ changing what the row is priced on --------------
       * Qty and Rate mean different things on either side of the switch -
       * kilos and a per-kg rate one way, a count and a fee the other - so the
       * figures are re-seeded rather than reinterpreted. Leaving them alone
       * turned a 25,600 kg AWB into 25,600 shipments the moment somebody
       * changed the basis.
       *
       * Anything the PATCH itself sets wins: picking a charge sends its basis
       * and its registered fixed amount together, and that amount is the
       * point of picking it.
       * ------------------------------------------------------------------ */
      if ('basis' in patch && isPerShipment(updated) && !isPerShipment(c)) {
        // The figure the row was already showing becomes the fee for ONE of
        // them, so the amount does not jump as the basis changes.
        if (!('qty' in patch)) updated.qty = 1;
        if (!('rate_charge' in patch)) updated.rate_charge = computeBaseAmount(c, lines[lineIndex]);
        // Adhoc discounts a per-kg rate, so it has nothing to discount here.
        updated.discount = null;
      }
      if ('basis' in patch && !isPerShipment(updated) && isPerShipment(c)) {
        // Back to weight x rate: the count is not a weight and the fee is not
        // a rate, so the AWB's own figures are the honest starting point.
        if (!('qty' in patch)) updated.qty = lines[lineIndex]?.chargeableWeight ?? null;
        if (!('rate_charge' in patch)) updated.rate_charge = null;
      }

      updated.net_amount = computeNetAmount(updated, lines[lineIndex]);
      updated.tax_amount = taxAmountOf(updated, lines[lineIndex]);
      updated.local_amount = computeLocalAmount(updated, lines[lineIndex]);
      return updated;
    });
    setCharges(lineIndex, next);
  };

  const setField = (lineIndex, charge, field, value) =>
    setFields(lineIndex, charge, { [field]: value });

  // Approving stamps who and when; withdrawing clears both, so a name never
  // sits against a charge nobody currently backs. The backend applies the same
  // rule.
  const toggleApproval = (lineIndex, charge) => {
    setFields(lineIndex, charge, isApproved(charge)
      ? { status: '0', approved_by: null, approval_date: null }
      : {
          status: '1',
          approved_by: Cookies.get('username') || Cookies.get('loginId') || '',
          approval_date: moment().format('YYYY-MM-DD HH:mm'),
        });
  };

  const removeCharge = (lineIndex, charge) => {
    PopConfirm('Confirmation', 'Remove this charge?', () => {
      setCharges(lineIndex, allCharges(lines[lineIndex]).filter((c) => c !== charge));
    });
  };

  // --- selection ----------------------------------------------------------
  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Only a saved, approved, not-yet-invoiced charge can go on an invoice.
  const canInvoice = (c) => c.id && isApproved(c) && !isInvoiced(c);

  const selectableIn = (rows) => rows.filter(canInvoice).map((c) => c.id);

  // Every charge id that could be invoiced RIGHT NOW.
  //
  // Saving replaces uninvoiced charge rows, so their ids change - and a
  // removed charge's id disappears entirely. Without this the tick state kept
  // counting ids that no longer exist, so the button offered to invoice more
  // charges than are on the screen, and would have posted dead ids to the
  // server. The set is the source of intent; this is the source of truth.
  // Includes the other legs of a split AWB: those charges are on a different
  // flight but belong on the same invoice, so they must survive the pruning
  // that keeps the selection honest.
  const relatedCharges = React.useMemo(
    () => Object.values(related || {}).flatMap((legs) => legs.flatMap((l) => l.charges || [])),
    [related]
  );

  const liveSelectableIds = React.useMemo(
    () => new Set(
      [...lines.flatMap((l) => allCharges(l)), ...relatedCharges]
        .filter(canInvoice)
        .map((c) => c.id)
    ),
    [lines, relatedCharges]
  );

  const effectiveSelection = React.useMemo(
    () => [...selected].filter((id) => liveSelectableIds.has(id)),
    [selected, liveSelectableIds]
  );

  /* ------------------ the other legs of a split AWB --------------------
   * A shipment too big for one aircraft is split across flights, and the
   * customer still gets ONE invoice. So charges belonging to another flight
   * have to be tickable from here - and, far more important, have to be hard
   * to walk past. Raising the invoice without them is not an error anything
   * catches: it produces a perfectly valid invoice for half the shipment, and
   * the rest is found weeks later when the AWB will not reconcile.
   *
   * So the same fact is said three times, in rising order of insistence:
   * a count on the AWB's own header, the panel below it, and - if the invoice
   * is raised anyway - a confirmation naming what is being left behind.
   * ------------------------------------------------------------------ */
  const legsOf = (line) => related?.[(line.awb || '').trim()] || [];

  /** Charges on OTHER flights for this AWB that could go on this invoice. */
  const billableElsewhere = (line) =>
    legsOf(line).flatMap((leg) => (leg.charges || []).filter(canInvoice));

  /** ...of those, the ones nobody has ticked. */
  const missedElsewhere = (line) =>
    billableElsewhere(line).filter((c) => !selected.has(c.id));

  // Across the whole flight, for the bar above the invoice button.
  const missedTotal = React.useMemo(
    () => lines.reduce((t, l) => t + missedElsewhere(l).length, 0),
    [lines, related, selected]
  );

  const toggleSelectAll = (rows) => {
    const ids = selectableIn(rows);
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const raiseInvoice = () => {
    if (!effectiveSelection.length) return;
    const go = () => onInvoice(effectiveSelection, () => setSelected(new Set()));

    // Only warn about AWBs actually being invoiced. An untouched AWB with
    // charges on another flight is not something this invoice is getting
    // wrong, and warning about it would make the confirmation noise that gets
    // clicked through.
    const chosen = new Set(effectiveSelection);
    const stranded = lines
      .filter((l) => allCharges(l).some((c) => chosen.has(c.id)))
      .flatMap((l) => missedElsewhere(l).map((c) => ({ awb: l.awb, c })));

    if (!stranded.length) return go();

    const awbs = [...new Set(stranded.map((x) => x.awb).filter(Boolean))];
    PopConfirm(
      'Charges on other flights are not selected',
      `${stranded.length} charge(s) on ${awbs.length === 1 ? 'AWB' : 'AWBs'} ` +
      `${awbs.join(', ')} sit on OTHER flights and can go on this same invoice, ` +
      'but have not been ticked. Raising it now bills half the shipment and ' +
      'leaves the rest to be found later. Raise it anyway?',
      go
    );
  };

  // --- pricing ------------------------------------------------------------
  const amountOf = (line, c) => computeNetAmount(c, line);
  const sectionTotal = (line, rows) => rows.reduce((t, c) => t + amountOf(line, c), 0);
  const sectionLocalTotal = (line, rows) =>
    rows.reduce((t, c) => t + computeLocalAmount(c, line), 0);

  // In LOCAL terms, so an AWB's tag is comparable with the flight summary.
  const netOf = (line) =>
    sectionLocalTotal(line, chargesOf(line, RECEIVABLE)) -
    sectionLocalTotal(line, chargesOf(line, PAYABLE));

  const fmt = (n) =>
    Number.isFinite(n)
      ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '0.00';

  const summary = React.useMemo(() => {
    let receivable = 0;
    let payable = 0;
    let count = 0;
    let uninvoiced = 0;
    const byCurrency = new Map();
    // DISTINCT invoices, not charge counts: one invoice carries several
    // charges, so counting rows would badly overstate how many documents
    // exist. Receivables become Job Invoices, payables Job Bills.
    const invoiceIds = new Set();
    const billIds = new Set();

    for (const line of lines) {
      for (const c of allCharges(line)) {
        const local = computeLocalAmount(c, line);
        count++;
        if (c.InvoiceId) (c.type === PAYABLE ? billIds : invoiceIds).add(c.InvoiceId);
        else uninvoiced++;
        if (c.type === PAYABLE) payable += local; else receivable += local;

        const key = (c.currency || '').trim().toUpperCase() || '—';
        if (!byCurrency.has(key)) byCurrency.set(key, { currency: key, rec: 0, pay: 0 });
        const bucket = byCurrency.get(key);
        const amount = computeNetAmount(c, line);
        if (c.type === PAYABLE) bucket.pay += amount; else bucket.rec += amount;
      }
    }

    return {
      receivable,
      payable,
      profit: receivable - payable,
      margin: receivable ? ((receivable - payable) / receivable) * 100 : null,
      count,
      uninvoiced,
      invoices: invoiceIds.size,
      bills: billIds.size,
      currencies: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  }, [lines]);

  // --- rendering ----------------------------------------------------------
  const rateInput = (line, lineIndex, field, label, hint) => {
    /* Shut PER SIDE by an issued invoice, or on both sides by the fortnight
     * this flight was reconciled in - and it says which, because a box that
     * ignores typing with no explanation reads as a fault.
     *
     * A receivable on an approved invoice shuts the selling pair and leaves
     * buying open. One invoiced charge on either side used to shut all four,
     * so correcting what a customer is billed meant unapproving the bill to
     * the airline as well. Same rule the Consignments grid applies. */
    const type = GOVERNS[field].type;
    const billed = lockingInvoice(allCharges(line), type);
    const shut = disabled || Boolean(billed) || !rateWindowOpen;
    const side = type === RECEIVABLE ? 'receivable' : 'payable';
    const other = type === RECEIVABLE ? 'buying' : 'selling';
    return (
      <div className='rate-field'>
        <span className='label'>{label}</span>
        <InputNumber
          size='small' controls={false} step={0.01} style={{ width: 96 }}
          value={line[field]} disabled={shut}
          placeholder={hint}
          title={
            billed
              ? `A ${side} charge is on ${billed.invoice_id || 'an approved invoice'} — ` +
                `unapprove it to change this side. The ${other} side is unaffected.`
              : !rateWindowOpen ? `Rates closed with the fortnight ending ${rateClosedOn}`
              : undefined
          }
          onChange={(e) => setLineField(lineIndex, field, e)}
        />
      </div>
    );
  };

  const section = (line, lineIndex, type) => {
    const rows = chargesOf(line, type);
    const receivable = type === RECEIVABLE;
    const rate = rateFor(line, type);
    const selectable = selectableIn(rows);
    const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));
    return (
      <div className={`charge-section ${receivable ? 'is-rec' : 'is-pay'}`}>
        <div className='charge-section-bar'>
          <b>{receivable ? 'Receivable' : 'Payable'}</b>
          <span className='grey-txt'>
            @ {rate ? fmt(rate) : <i>no {receivable ? 'selling' : 'buying'} rate set</i>}
          </span>
          {rows.length > 0 && (
            <span className='grey-txt'>
              {rows.filter(isApproved).length}/{rows.length} approved
            </span>
          )}
          <button type='button' className='btn-custom fw-8 charge-add' disabled={disabled}
            onClick={() => addCharge(lineIndex, type)}>
            Add +
          </button>
          <span className='charge-section-total'>
            Total <b>{fmt(sectionTotal(line, rows))}</b>
            {sectionLocalTotal(line, rows) !== sectionTotal(line, rows) && (
              <span className='local'>
                local <b>{fmt(sectionLocalTotal(line, rows))}</b>
              </span>
            )}
          </span>
        </div>

        <Table size='sm' className='mb-0 charge-table'>
          <colgroup>
            <col style={{ width: '3%'  }} />{/* select        */}
            <col style={{ width: '9%'  }} />{/* charge        */}
            <col style={{ width: '9%'  }} />{/* party         */}
            <col style={{ width: '6%'  }} />{/* description   */}
            <col style={{ width: '6%'  }} />{/* basis         */}
            <col style={{ width: '6%'  }} />{/* qty / weight  */}
            <col style={{ width: '6%'  }} />{/* rate / fee    */}
            <col style={{ width: '5%'  }} />{/* adhoc         */}
            <col style={{ width: '5%'  }} />{/* currency      */}
            <col style={{ width: '8%'  }} />{/* tax + %       */}
            <col style={{ width: '6%'  }} />{/* tax amount    */}
            <col style={{ width: '8%'  }} />{/* net amount    */}
            <col style={{ width: '5%'  }} />{/* ex rate       */}
            <col style={{ width: '8%'  }} />{/* local amount  */}
            <col style={{ width: '5%'  }} />{/* status        */}
            {/* Who entered the line and who last changed it: an icon, its
                three points one each from charge, party and description. */}
            <col style={{ width: '3%'  }} />{/* audit         */}
            <col style={{ width: '2%'  }} />{/* remove        */}
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
              <th>Party</th>
              <th>Description</th>
              <th>Basis</th>
              {/* Kilos on a Per Unit charge, a COUNT on a Per Shipment one -
                  so the header names both rather than only the freight one. */}
              <th className='num' title='Chargeable weight on a Per Unit charge; how many on a Per Shipment one'>
                Qty / WT
              </th>
              <th className='num' title='Rate per kg on a Per Unit charge; the fee for one on a Per Shipment charge'>
                Rate / Fee
              </th>
              <th className='num'>Adhoc</th>
              <th>Curr.</th>
              {/* Ticked and its percentage, both seeded from Setup > Charges
                  and both adjustable for the one shipment that is exempt. */}
              <th className='num' title='Tax, at the percentage this charge was registered with'>Tax %</th>
              <th className='num'>Tax Amt</th>
              <th className='num'>Net Amount</th>
              <th className='num'>Ex. Rate</th>
              <th className='num'>Local Amount</th>
              <th className='text-center'>Status</th>
              <th title='Who entered each line, and who last changed it'></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const billed = isInvoiced(c);
              // Frozen by an ISSUED invoice. A charge on an invoice that has
              // been unapproved is editable again - that is what unapproving
              // is for. See isInvoiceLocked.
              // On an unapproved invoice the line is part of that document:
              // changing it is editing the invoice, a right of its own.
              const locked = disabled || isInvoiceLocked(c) || (billed && !rights.editInvoices);
              // The rate cells close with the flight's fortnight even when
              // nothing has been invoiced: the period has been reconciled.
              const rateLocked = locked || !rateWindowOpen;
              return (
              <tr className={`f ${isApproved(c) ? 'approved' : ''} ${billed ? 'billed' : ''}`} key={i}>
                <td className='text-center'>
                  <Checkbox
                    checked={selected.has(c.id)}
                    disabled={!canInvoice(c)}
                    onChange={() => toggleSelect(c.id)}
                    title={
                      billed ? 'Already invoiced'
                        : !c.id ? 'Save the flight before invoicing this charge'
                        : !isApproved(c) ? 'Approve the charge before invoicing it'
                        : 'Include in invoice'
                    }
                  />
                </td>
                <td>
                  <Select size='small' style={{ width: '100%' }} value={asId(c.charge)} allowClear showSearch
                    placeholder='Charge'
                    optionFilterProp='label' disabled={locked}
                    onChange={(e) => {
                      // Everything Setup > Charges holds about the picked
                      // charge, applied by the SAME function that builds the
                      // Air Freight rows an approved AWB raises - see
                      // functions/aviationChargeRow. Two constructions of "a
                      // charge row for this master" would drift, and the drift
                      // would show as an automatic charge priced differently
                      // from the identical one added by hand.
                      const picked = (values.charge || []).find((x) => x.id === e);
                      setFields(lineIndex, c, chargeMasterPatch(picked, line, values, receivable));
                    }}
                    options={chargeOptions} />
                </td>
                <td>
                  <Select size='small' style={{ width: '100%' }} value={asId(c.partyId)} allowClear showSearch
                    placeholder={receivable ? 'Bill to' : 'Pay to'}
                    optionFilterProp='label' disabled={locked}
                    onChange={(e) => {
                      const party = (values.party || []).find((p) => p.id === e);
                      // name is stored alongside the id because an invoice
                      // prints the party as it was at the time it was raised.
                      setFields(lineIndex, c, { partyId: e ?? null, name: party?.name || null });
                    }}
                    options={partyOptions} />
                </td>
                <td>
                  <Input size='small' style={{ width: '100%' }} value={c.description || ''} disabled={locked}
                    onChange={(e) => setField(lineIndex, c, 'description', e.target.value)} />
                </td>
                <td>
                  <Select size='small' style={{ width: '100%' }} value={c.basis || PER_UNIT}
                    disabled={locked}
                    onChange={(e) => setField(lineIndex, c, 'basis', e)}
                    options={BASIS_OPTIONS} />
                </td>
                {/* Weight on a Per Unit charge; on a Per Shipment one it is
                    HOW MANY - shipments, pallets, documents - and blank means
                    one, which is what every row stored before the count meant. */}
                <td className='num'>
                  <InputNumber size='small' controls={false} style={{ width: '100%' }}
                    step={isPerShipment(c) ? 1 : 0.01}
                    min={isPerShipment(c) ? 0 : undefined}
                    placeholder={isPerShipment(c) ? '1' : (line.chargeableWeight ?? '')}
                    value={c.qty}
                    disabled={locked}
                    title={isPerShipment(c)
                      ? 'How many of this charge — shipments, pallets, documents. Blank counts as one.'
                      : "Chargeable weight this charge is priced on — the AWB's unless overridden"}
                    onChange={(e) => setField(lineIndex, c, 'qty', e)} />
                </td>
                {/* The per-kg rate, or on a Per Shipment charge the fee for
                    ONE of them. A fee has no AWB rate to fall back to, so the
                    placeholder does not offer one. */}
                <td className='num'>
                  <InputNumber size='small' controls={false} style={{ width: '100%' }} step={0.01}
                    placeholder={isPerShipment(c) ? 'fee' : (rate || '')}
                    value={c.rate_charge}
                    disabled={locked}
                    title={isPerShipment(c)
                      ? 'The fee for one — multiplied by the count beside it'
                      : undefined}
                    onChange={(e) => setField(lineIndex, c, 'rate_charge', e)} />
                </td>
                <td className='num'>
                  <InputNumber size='small' controls={false} style={{ width: '100%' }} step={0.01}
                    placeholder={isPerShipment(c) ? 'n/a' : '0'}
                    value={isPerShipment(c) ? null : c.discount}
                    disabled={locked || isPerShipment(c)}
                    title={isPerShipment(c) ? 'Not used - adhoc discounts a per-kg rate' : undefined}
                    onChange={(e) => setField(lineIndex, c, 'discount', e)} />
                </td>
                <td>
                  <Select size='small' style={{ width: '100%' }} value={c.currency || undefined}
                    allowClear showSearch optionFilterProp='label' disabled={locked}
                    placeholder='Curr.'
                    onChange={(e) => setField(lineIndex, c, 'currency', e ?? '')}
                    options={
                      c.currency && !CURRENCIES.some((x) => x.value === c.currency)
                        ? [...CURRENCIES, { value: c.currency, label: c.currency }]
                        : CURRENCIES
                    } />
                </td>
                {/* Tax: on or off, and at what percentage. Both arrive from
                    Setup > Charges when the charge is picked; the percentage
                    is only editable while the toggle is on, so a row can never
                    be taxed by a figure that is not being applied. */}
                <td className='num tax-cell'>
                  <Checkbox
                    checked={isTaxed(c)}
                    disabled={locked}
                    title={isTaxed(c)
                      ? 'Taxed — untick to exempt this charge'
                      : 'Not taxed — tick to apply tax to this charge'}
                    onChange={(e) => {
                      const on = e.target.checked;
                      // Ticking it back on re-reads the percentage the charge
                      // was REGISTERED with. Saving an untaxed row stores
                      // taxPerc as 0, deliberately - nothing downstream should
                      // be able to apply a rate that is not being charged - so
                      // without this, re-ticking the box would leave the row
                      // taxed at nought and look like the box did nothing.
                      const registered = num(
                        (values.charge || []).find((x) => x.id === asId(c.charge))?.taxPerc
                      );
                      setFields(lineIndex, c, {
                        tax_apply: on,
                        ...(on && !num(c.taxPerc) && registered ? { taxPerc: registered } : {}),
                      });
                    }}
                  />
                  <InputNumber size='small' controls={false} step={0.01} min={0}
                    style={{ width: 54 }}
                    placeholder='%'
                    value={c.taxPerc}
                    disabled={locked || !isTaxed(c)}
                    title={isTaxed(c)
                      ? 'Percentage of the charge, before conversion'
                      : 'Tick the box to apply tax'}
                    onChange={(e) => setField(lineIndex, c, 'taxPerc', e)} />
                </td>
                <td className='num derived' title='The tax on this charge, included in the net amount'>
                  {fmt(taxAmountOf(c, line))}
                </td>
                <td className='num derived'
                  title={`${isPerShipment(c) ? 'Qty x Fee' : 'Chargeable WT x (Rate - Adhoc)'}${isTaxed(c) ? ' + tax' : ''}`}>
                  {fmt(computeNetAmount(c, line))}
                </td>
                <td className='num'>
                  <InputNumber size='small' controls={false} style={{ width: '100%' }} step={0.0001}
                    placeholder={exRateFor(line, c.type)}
                    title={c.ex_rate == null
                      ? `Using the AWB's ${c.type === PAYABLE ? 'buying' : 'selling'} ex-rate (${exRateFor(line, c.type)})`
                      : undefined}
                    value={c.ex_rate} disabled={rateLocked}
                    onChange={(e) => setField(lineIndex, c, 'ex_rate', e)} />
                </td>
                <td className='num derived' title='Net Amount x Ex. Rate'>
                  {fmt(computeLocalAmount(c, line))}
                </td>
                <td className='text-center'>
                  {billed ? (
                    /* BLUE for an issued document, RED for one that has been
                       unapproved.
                       Being on an invoice and being frozen by one are not the
                       same thing, and until now they looked the same. An
                       unapproved invoice has had its voucher destroyed and is
                       out of the ledger: it is an open item, its figures are
                       still being corrected, and it is not billed to anybody
                       until somebody approves it again. A row that reads
                       exactly like a settled one is how a half-corrected
                       invoice gets left that way.
                       An invoice that was not loaded with the charge shows
                       BLUE - isInvoiceLocked defaults to frozen, and guessing
                       "open" about an issued document is the worse mistake. */
                    <Tag
                      color={isInvoiceLocked(c) ? 'blue' : 'red'}
                      className='invoice-tag'
                      onClick={() => openInvoice(c)}
                      title={isInvoiceLocked(c)
                        ? `On invoice ${c.invoice_id || c.Invoice?.invoice_No || ''} — click to open it`
                        : `On invoice ${c.invoice_id || c.Invoice?.invoice_No || ''}, which has been ` +
                          'UNAPPROVED — it is out of the ledger and this charge can still be ' +
                          'corrected. Click to open it.'}
                    >
                      {c.invoice_id || c.Invoice?.invoice_No || 'Invoiced'}
                    </Tag>
                  ) : (
                    <Tag
                      color={isApproved(c) ? 'success' : 'default'}
                      className='status-tag'
                      icon={isApproved(c) ? <CheckCircleFilled /> : <ClockCircleOutlined />}
                      onClick={() => { if (!locked && rights.approveCharges) toggleApproval(lineIndex, c); }}
                      title={!rights.approveCharges ? 'Approving charges needs the right to approve job charges' : isApproved(c)
                        ? `Approved${c.approved_by ? ` by ${c.approved_by}` : ''}` +
                          `${c.approval_date ? ` on ${c.approval_date}` : ''} — click to withdraw`
                        : 'Not approved — click to approve'}
                    >
                      {isApproved(c) ? 'Approved' : 'Pending'}
                    </Tag>
                  )}
                </td>
                <td className='text-center'><AuditTip record={c} /></td>
                <td className='text-center'>
                  <CloseCircleOutlined
                    className='cross-icon'
                    title={billed ? 'Invoiced charges cannot be removed' : 'Remove this charge'}
                    style={billed ? { opacity: 0.25, cursor: 'not-allowed' } : undefined}
                    onClick={() => { if (!locked) removeCharge(lineIndex, c); }} />
                </td>
              </tr>
            );})}
            {rows.length === 0 && (
              <tr>
                <td colSpan={17} className='text-center grey-txt fs-12 charge-empty'>
                  No {receivable ? 'receivable' : 'payable'} charges.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>
    );
  };

  /**
   * The same AWB on other flights.
   *
   * A shipment too big for one aircraft is split: 400 kg of an 800 kg AWB
   * here, the rest on the next flight. Both consignments carry the same AWB
   * number, and the customer gets ONE invoice - so those charges have to be
   * tickable from here, even though they belong to another flight.
   *
   * Read-only otherwise: editing a charge belongs on the flight that owns it,
   * and offering it here would mean two screens writing the same row.
   */
  const otherLegs = (line) => {
    const legs = legsOf(line);
    if (!legs.length) return null;
    const missed = missedElsewhere(line).length;
    return (
      <div className={`other-legs ${missed ? 'has-missed' : ''}`}>
        <div className='other-legs-bar'>
          <b>Also on AWB {line.awb}</b>
          <span className='grey-txt'>
            {legs.length} other flight{legs.length === 1 ? '' : 's'} — tick to bill together
          </span>
          {missed > 0 && (
            <Tag color='gold' style={{ marginLeft: 'auto' }}>
              {missed} not selected
            </Tag>
          )}
        </div>
        {legs.map((leg) => (
          <div key={leg.consignmentId} className='leg'>
            <div className='leg-head'>
              <b>{leg.jobNo}</b>
              <span className='grey-txt'>
                {leg.flightNo}{leg.flightDate ? ` · ${leg.flightDate}` : ''}
              </span>
              <span className='grey-txt' style={{ marginLeft: 'auto' }}>
                AWB chargeable WT {fmt(num(leg.chargeableWeight))}
              </span>
            </div>
            {(leg.charges || []).length === 0 && (
              <div className='grey-txt fs-12 leg-empty'>No charges on that flight yet.</div>
            )}
            {(leg.charges || []).map((c) => {
              const billed = isInvoiced(c);
              return (
                <div key={c.id} className='leg-row'>
                  <Checkbox
                    checked={selected.has(c.id)}
                    disabled={!canInvoice(c)}
                    onChange={() => toggleSelect(c.id)}
                    title={
                      billed ? 'Already invoiced'
                        : !isApproved(c) ? 'Approve it on that flight first'
                        : 'Include in this invoice'
                    }
                  />
                  <Tag color={c.type === PAYABLE ? 'volcano' : 'green'}>
                    {c.type === PAYABLE ? 'P' : 'R'}
                  </Tag>
                  <span className='particular'>{c.particular || c.description || '(no charge)'}</span>
                  <span className='grey-txt'>{c.name || ''}</span>
                  <span className='qty grey-txt'>
                    {fmt(num(c.qty))}{isPerShipment(c) ? '' : ' kg'}
                  </span>
                  <span className='amt'>{fmt(num(c.net_amount))} {c.currency || ''}</span>
                  {billed
                    /* Same rule as the grid above: red is an invoice that has
                       been unapproved and is out of the ledger. */
                    ? <Tag color={isInvoiceLocked(c) ? 'blue' : 'red'} className='invoice-tag'
                        onClick={() => openInvoice(c)}
                        title={isInvoiceLocked(c)
                          ? `Open invoice ${c.invoice_id || ''}`
                          : `Invoice ${c.invoice_id || ''} has been unapproved`}>
                        {c.invoice_id || 'Invoiced'}
                      </Tag>
                    : <Tag color={isApproved(c) ? 'success' : 'default'}>
                        {isApproved(c) ? 'Approved' : 'Pending'}
                      </Tag>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  // Only saved AWBs can carry charges: a charge needs a consignment id to hang
  // off, and an unsaved row has none.
  //
  // DIRECT consignments are excluded outright. The airline was approached from
  // outside to fly someone else's load, on someone else's air waybill - the
  // weight counts on the manifest, but there is nothing here to bill and no
  // party of ours to bill it to. The server clears any uninvoiced charge left
  // on such a line, so nothing hidden here stays live.
  const billable = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.id && !line.direct);

  const directCount = lines.filter((l) => l.direct).length;

  if (!billable.length) {
    return (
      <Empty
        description={
          directCount && !lines.some((l) => l.id && !l.direct)
            ? `Nothing to bill — ${directCount === 1 ? 'the only AWB on this flight is' : `all ${directCount} AWBs on this flight are`} direct.`
            : lines.some((l) => l.awb || l.shipperId)
              ? 'Save the flight first — charges attach to a saved AWB.'
              : 'Add consignments on the Consignments tab, then charge them here.'
        }
      />
    );
  }

  const mixed = summary.currencies.length > 1;

  return (
    <div className='aviation-charges'>
      <div className='charge-summary'>
        <div className='stat'>
          <span className='label'>Receivable</span>
          <span className='value rec'>{fmt(summary.receivable)}</span>
        </div>
        <div className='stat'>
          <span className='label'>Payable</span>
          <span className='value pay'>{fmt(summary.payable)}</span>
        </div>
        <div className='stat divider'>
          <span className='label'>Profit</span>
          <span className={`value big ${summary.profit < 0 ? 'neg' : 'pos'}`}>
            {fmt(summary.profit)}
          </span>
        </div>
        <div className='stat'>
          <span className='label'>Margin</span>
          <span className={`value ${summary.profit < 0 ? 'neg' : 'pos'}`}>
            {summary.margin === null ? '—' : `${summary.margin.toFixed(1)}%`}
          </span>
        </div>
        <div className='stat'>
          <span className='label'>AWBs / Charges</span>
          <span className='value muted'>{billable.length} / {summary.count}</span>
        </div>
        {/* Said out loud rather than left as a silent difference: the flight
            has more AWBs than this tab shows, and the reason is not a bug. */}
        {directCount > 0 && (
          <div className='stat' title="Direct AWBs are someone else's load - on the manifest, not billed here">
            <span className='label'>Direct (not billed)</span>
            <span className='value muted'>{directCount}</span>
          </div>
        )}
        <div className='stat' title='Distinct documents raised from this flight&apos;s charges'>
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
        {/* The third and loudest place the split-AWB fact is said - right
            beside the button that would otherwise bill half a shipment. See
            billableElsewhere. */}
        {missedTotal > 0 && (
          <div className='stat split-warn'
            title='These belong on the same invoice as this flight&apos;s charges — open the AWB to tick them'>
            <span className='label'>On other flights</span>
            <span className='value'>{missedTotal} not selected</span>
          </div>
        )}
        <div className='stat invoice-action'>
          {rights.raiseInvoices && <button
            type='button'
            className={effectiveSelection.length && !canceled && !invoicing
              ? 'btn-custom fw-8'
              : 'btn-custom fw-8 is-disabled'}
            disabled={!effectiveSelection.length || canceled || invoicing}
            onClick={raiseInvoice}
          >
            <FileTextOutlined style={{ marginRight: 6 }} />
            {invoicing
              ? 'Raising…'
              : effectiveSelection.length
                ? `Invoice ${effectiveSelection.length} charge(s)`
                : 'Invoice selected'}
          </button>}
          <span className='hint'>
            {effectiveSelection.length
              ? 'Grouped by party, direction and currency — one invoice each.'
              : 'Tick approved charges to invoice them.'}
          </span>
        </div>
      </div>

      {mixed && (
        <div className='charge-currency-note'>
          <b>Charges are in {summary.currencies.length} currencies.</b> The totals above are
          in your books&apos; currency, each charge converted at its own ex-rate. Original amounts:
          <div className='charge-currency-rows'>
            {summary.currencies.map((c) => (
              <span key={c.currency}>
                <b>{c.currency}</b> rec {fmt(c.rec)} · pay {fmt(c.pay)} ·
                <b className={c.rec - c.pay < 0 ? 'neg' : 'pos'}> {fmt(c.rec - c.pay)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <Collapse accordion>
        {billable.map(({ line, index }) => {
          const rec = chargesOf(line, RECEIVABLE);
          const pay = chargesOf(line, PAYABLE);
          const net = netOf(line);
          const pending = allCharges(line).filter((c) => !isApproved(c)).length;
          // Distinct documents this AWB's charges sit on - the same rule as
          // the flight totals above, scoped to one consignment.
          const invoicesOn = new Set(rec.filter(isInvoiced).map((c) => c.InvoiceId)).size;
          const billsOn = new Set(pay.filter(isInvoiced).map((c) => c.InvoiceId)).size;
          return (
            <Collapse.Panel
              key={line.id}
              header={
                <div className='d-flex align-items-center fs-12' style={{ gap: '0.5rem' }}>
                  <b>{line.awb || '(no AWB #)'}</b>
                  <span className='grey-txt text-truncate' style={{ maxWidth: 260 }}>
                    {line.shipper?.name || ''}
                  </span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                    <Tag color='green'>R {rec.length}</Tag>
                    <Tag color='volcano'>P {pay.length}</Tag>
                    {/* Only once something has been raised - an AWB with no
                        invoices yet does not need two zeroes in its header. */}
                    {invoicesOn > 0 && (
                      <Tag color='blue' title={`${invoicesOn} invoice(s) raised from this AWB`}>
                        I {invoicesOn}
                      </Tag>
                    )}
                    {billsOn > 0 && (
                      <Tag color='geekblue' title={`${billsOn} bill(s) raised from this AWB`}>
                        B {billsOn}
                      </Tag>
                    )}
                    {pending > 0 && (
                      <Tag color='orange' title={`${pending} charge(s) not approved`}>
                        {pending} pending
                      </Tag>
                    )}
                    {/* The same AWB is being carried on another flight and
                        those charges belong on this invoice. On the HEADER,
                        because the panel that says so is collapsed by default
                        - which is exactly how they get forgotten. */}
                    {missedElsewhere(line).length > 0 && (
                      <Tag color='gold' className='other-legs-tag'
                        title='Charges for this AWB on other flights are not selected — open this AWB to tick them'>
                        +{missedElsewhere(line).length} on other flights
                      </Tag>
                    )}
                    <Tag color={net < 0 ? 'red' : 'blue'}>Net {fmt(net)}</Tag>
                  </span>
                </div>
              }
            >
              {/* THE SAME FOUR FIELDS the Consignments grid shows. Not a
                  copy: both edit one Aviation_Consignment row, so they cannot
                  disagree. They are in both places because the rates are known
                  when the AWB is entered and are needed again when its charges
                  are priced - making either screen the only home meant walking
                  to the other one mid-entry.

                  Grouped per SIDE - rate then its conversion - because that is
                  the pair that produces one side's figure in the books. */}
              <div className='awb-rates'>
                {rateInput(line, index, 'sellingRate', 'Selling rate', 'receivable')}
                {rateInput(line, index, 'sellingExRate', 'Sell ex. rate', '1')}
                {rateInput(line, index, 'buyingRate', 'Buying rate', 'payable')}
                {rateInput(line, index, 'buyingExRate', 'Buy ex. rate', '1')}
                <div className='rate-field spread'>
                  <span className='label'>Spread per kg</span>
                  <span className={`value ${num(line.sellingRate) - num(line.buyingRate) < 0 ? 'neg' : 'pos'}`}>
                    {fmt(num(line.sellingRate) - num(line.buyingRate))}
                  </span>
                </div>
                <div className='rate-field'>
                  <span className='label'>AWB chargeable WT</span>
                  <span className='value muted'>{fmt(num(line.chargeableWeight))}</span>
                </div>
              </div>

              {section(line, index, RECEIVABLE)}
              {section(line, index, PAYABLE)}
              {otherLegs(line)}
            </Collapse.Panel>
          );
        })}
      </Collapse>

      <style jsx global>{`
        .aviation-charges .ant-collapse-header {
          padding: 5px 12px !important;
          align-items: center !important;
        }
        .aviation-charges .ant-collapse-content-box { padding: 8px 10px !important; }
        .aviation-charges .ant-tag { margin-right: 0; line-height: 18px; }

        .aviation-charges .awb-rates {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 6px 22px;
          padding: 6px 10px;
          margin-bottom: 8px;
          background: #f6f9fc;
          border: 1px solid #e6eef5;
          border-radius: 5px;
        }
        .aviation-charges .rate-field { display: flex; flex-direction: column; gap: 1px; }
        .aviation-charges .rate-field .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #8a97a3;
        }
        .aviation-charges .rate-field .value {
          font-size: 13px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          line-height: 24px;
        }
        .aviation-charges .rate-field.spread { padding-left: 10px; border-left: 1px solid #e0e8ef; }

        .aviation-charges .charge-section {
          border: 1px solid #eee;
          border-left-width: 3px;
          border-radius: 5px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        .aviation-charges .charge-section.is-rec { border-left-color: #52c41a; }
        .aviation-charges .charge-section.is-pay { border-left-color: #fa541c; }
        .aviation-charges .charge-section .charge-table { margin-bottom: 0; }

        .aviation-charges .charge-section-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 4px 4px 0 0;
        }
        .aviation-charges .charge-section.is-rec .charge-section-bar { background: #f6ffed; }
        .aviation-charges .charge-section.is-pay .charge-section-bar { background: #fff2e8; }
        .aviation-charges .charge-section-bar .grey-txt::before {
          content: '·';
          margin-right: 8px;
          color: #c8c8c8;
        }
        .aviation-charges .charge-section-total {
          margin-left: auto;
          font-size: 12px;
          color: #666;
          font-variant-numeric: tabular-nums;
        }
        .aviation-charges .charge-section-total .local {
          margin-left: 10px;
          padding-left: 10px;
          border-left: 1px solid #e0e0e0;
        }
        .aviation-charges .charge-add {
          padding: 0 8px;
          font-size: 11px;
          line-height: 20px;
        }

        .aviation-charges .charge-table { table-layout: fixed; width: 100%; }
        .aviation-charges .charge-table th {
          padding: 0 4px 2px !important;
          font-size: 11px;
          font-weight: 600;
          color: #888;
          border-top: none;
          border-bottom: 1px solid #eee;
          white-space: nowrap;
        }
        .aviation-charges .charge-table td {
          padding: 2px 4px !important;
          vertical-align: middle;
          border-top: none;
        }
        .aviation-charges .charge-table .charge-empty { padding: 6px 4px !important; }
        .aviation-charges .charge-table tbody tr { border-bottom: 1px solid #f2f2f2; }
        .aviation-charges .charge-table tbody tr:last-child { border-bottom: none; }
        .aviation-charges .charge-table tbody tr:hover td { background: #fafcff; }

        .aviation-charges .charge-table th.num { text-align: right; }
        .aviation-charges .charge-table td.num .ant-input-number-input { text-align: right; }
        .aviation-charges .charge-table td.derived {
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          color: #222;
          font-size: 12px;
        }

        /* The tax toggle and its percentage read as one control, because they
           are one decision: whether this charge is taxed, and by how much. */
        /* NOT display:flex - a flex <td> stops being a table-cell, and this
           table is table-layout:fixed, so the column would lose its width. */
        .aviation-charges .charge-table td.tax-cell { white-space: nowrap; text-align: right; }
        .aviation-charges .charge-table td.tax-cell .ant-checkbox-wrapper,
        .aviation-charges .charge-table td.tax-cell .ant-input-number { vertical-align: middle; }
        .aviation-charges .charge-table td.tax-cell .ant-checkbox-wrapper { margin-right: 4px; }
        /* styles/clientLayout.scss stretches every label to 170px to line up
           the party form, and an antd Checkbox renders as a <label> - inside
           this grid that drags the column out and pins the tick to the left of
           all that space. Undone here only, the same fix the consignments grid
           carries. !important is needed to beat !important. */
        .aviation-charges .charge-table .ant-checkbox-wrapper {
          min-width: 0 !important;
          margin: 0;
        }

        .aviation-charges .status-tag {
          cursor: pointer;
          margin-right: 0;
          font-size: 11px;
          line-height: 18px;
          user-select: none;
        }
        .aviation-charges .status-tag:hover { opacity: 0.75; }
        /* The invoice number is a link - underlined on hover so it reads as
           one rather than as a label that happens to be clickable. */
        .aviation-charges .invoice-tag {
          cursor: pointer;
          margin-right: 0;
          font-size: 11px;
          line-height: 18px;
          user-select: none;
        }
        .aviation-charges .invoice-tag:hover { text-decoration: underline; }
        .aviation-charges .charge-table tbody tr.approved td { background: #f6ffed; }
        .aviation-charges .charge-table tbody tr.approved:hover td { background: #eaffd8; }
        .aviation-charges .charge-table tbody tr.approved td:first-child {
          box-shadow: inset 3px 0 0 #52c41a;
        }
        /* An invoiced charge is part of an issued document - read-only, and
           visibly so, rather than looking like an editable row that ignores
           you. */
        /* A SPLIT AWB, said three times over. Gold rather than red: nothing is
           wrong yet, but raising the invoice without these would be - and the
           only moment to notice is before the click. */
        .aviation-charges .split-warn .label { color: #7a5b00; }
        .aviation-charges .split-warn .value {
          color: #7a5b00;
          background: #fffbe6;
          border: 1px solid #ffe58f;
          border-radius: 4px;
          padding: 1px 6px;
          font-weight: 600;
        }
        .aviation-charges .other-legs-tag { font-weight: 600; }
        .aviation-charges .other-legs.has-missed {
          border-color: #ffe58f;
          background: #fffdf5;
        }
        .aviation-charges .charge-table tbody tr.billed td { background: #f0f5ff; }
        .aviation-charges .charge-table tbody tr.billed:hover td { background: #e6efff; }
        .aviation-charges .charge-table tbody tr.billed td:first-child {
          box-shadow: inset 3px 0 0 #2f54eb;
        }

        .aviation-charges .charge-table .ant-input-number-disabled,
        .aviation-charges .charge-table .ant-input-number-disabled input {
          background: #fbfbfb !important;
          border-style: dashed !important;
          color: #bbb !important;
        }
        .aviation-charges .ant-input-number-handler-wrap { display: none !important; }
        .aviation-charges .ant-input-number-input { padding-right: 6px !important; }

        .aviation-charges .charge-summary {
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
        .aviation-charges .charge-summary .stat {
          display: flex;
          flex-direction: column;
          justify-content: center;
          min-width: 92px;
        }
        .aviation-charges .charge-summary .stat.divider {
          border-left: 1px solid #e4e4e4;
          padding-left: 28px;
        }
        .aviation-charges .charge-summary .stat.invoice-action {
          margin-left: auto;
          align-items: flex-end;
          gap: 3px;
        }
        .aviation-charges .charge-summary .stat.invoice-action .hint {
          font-size: 10px;
          color: #999;
        }
        .aviation-charges .charge-summary .stat.invoice-action .btn-custom {
          padding: 3px 14px;
          font-size: 12px;
          white-space: nowrap;
        }
        /* Disabled has to LOOK disabled: btn-custom carries no disabled state
           of its own, so without this it stays fully styled and invites a
           click that does nothing. */
        .aviation-charges .charge-summary .btn-custom.is-disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .aviation-charges .charge-summary .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
        }
        .aviation-charges .charge-summary .value {
          font-size: 15px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          line-height: 1.3;
        }
        .aviation-charges .charge-summary .value.big { font-size: 19px; }
        .aviation-charges .charge-summary .value.rec { color: #389e0d; }
        .aviation-charges .charge-summary .value.pay { color: #d4380d; }
        .aviation-charges .charge-summary .value.muted { color: #666; font-weight: 500; }
        /* Sits under the count rather than beside it, so the figure stays
           aligned with the other stats in the row. */
        .aviation-charges .charge-summary .pending-note {
          display: block;
          font-size: 10px;
          font-weight: 500;
          color: #d48806;
          line-height: 1.2;
        }
        .aviation-charges .pos { color: #389e0d; }
        .aviation-charges .neg { color: #cf1322; }

        /* The other legs of a split AWB. Visually distinct from this flight's
           own sections - it is another flight's data, shown here only so it
           can be billed together. */
        .aviation-charges .other-legs {
          border: 1px dashed #d9d9d9;
          border-radius: 5px;
          background: #fcfcfd;
          padding: 6px 8px;
          margin-bottom: 10px;
        }
        .aviation-charges .other-legs-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          margin-bottom: 4px;
        }
        .aviation-charges .leg { margin-top: 4px; }
        .aviation-charges .leg-head {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          padding: 2px 4px;
          background: #f4f6f8;
          border-radius: 3px;
        }
        .aviation-charges .leg-empty { padding: 3px 6px; }
        .aviation-charges .leg-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          padding: 2px 4px;
          border-bottom: 1px solid #f4f4f4;
        }
        .aviation-charges .leg-row:last-child { border-bottom: none; }
        .aviation-charges .leg-row .particular { min-width: 140px; }
        .aviation-charges .leg-row .qty { margin-left: auto; font-variant-numeric: tabular-nums; }
        .aviation-charges .leg-row .amt {
          min-width: 110px;
          text-align: right;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }

        .aviation-charges .charge-currency-note {
          font-size: 11px;
          line-height: 1.5;
          color: #7a5b00;
          background: #fffbe6;
          border: 1px solid #ffe58f;
          border-radius: 6px;
          padding: 6px 10px;
          margin-bottom: 8px;
        }
        .aviation-charges .charge-currency-rows {
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

export default React.memo(Charges);
