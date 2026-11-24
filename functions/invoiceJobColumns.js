/**
 * The job columns of an invoice-driven report, in every operation mode.
 *
 * Job Balancing enumerates INVOICES and reads its job columns off
 * `Invoice.SE_Job`. Only a freight invoice has one: an aviation invoice's
 * charges hang off an AWB and a customs invoice's name a goods declaration, so
 * the server attaches an `aviation` or `customs` block instead (see the
 * backend's functions/aviationInvoiceContext and customsInvoiceContext).
 *
 * The report was reading SE_Job and nothing else, so under aviation and
 * customs every job column except Job No came out BLANK - the money was right
 * and the row was clickable, but the line said nothing about what it was for.
 * The server was already sending flight numbers, sectors, AWBs, GD numbers and
 * BL numbers; the screen simply never looked at them.
 *
 * ONE PLACE DECIDES. The report renders its rows three times - the table, the
 * CSV and the Excel export - and each had its own copy of `x.SE_Job?.…`. Three
 * copies of a mapping is three chances for the export to disagree with what is
 * on screen, which is the sort of thing nobody notices until a customer sends
 * the spreadsheet back.
 *
 * WHAT IS BLANK STAYS BLANK, deliberately. A flight has no arrival date, no
 * shipper on the invoice and no vessel; a goods declaration has no sector. An
 * empty cell is the honest answer where the concept does not exist - inventing
 * one, or repeating the flight number in three columns to look full, would be
 * worse than the gap it fills.
 */

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** Which kind of job this invoice is against. Exactly one, or none. */
export function jobKindOf(invoice) {
  if (!invoice) return 'none';
  // A payment / receipt's money not knocked off, as a row of Job Balancing -
  // no job of any kind (the server's functions/jobBalancingAdvances).
  if (invoice.advance) return 'advance';
  if (invoice.SE_Job) return 'freight';
  if (invoice.aviation) return 'aviation';
  if (invoice.customs) return 'customs';
  return 'none';
}

/* The two document columns are headed differently per mode, because the same
 * cell holds a different document in each. Left as one pair of headings for
 * the whole table - an install runs ONE mode, so this is never mixed on screen.
 *
 * The freight pair keeps its exact old wording, so a freight install sees no
 * change at all. */
const DOC_HEADINGS = {
  freight: { primary: 'HBL/HAWB', secondary: 'MBL/MAWB' },
  aviation: { primary: 'AWB(s)', secondary: 'Flight No.' },
  customs: { primary: 'BL No', secondary: 'GD No' },
};

/* WHICH JOB COLUMNS A MODE ACTUALLY FILLS.
 *
 * A flight has no shipper on the invoice, no vessel and no arrival date; a
 * goods declaration has no sector and no container list. Those columns were
 * rendering empty down the whole report - a dozen blank columns the reader
 * scrolls past to reach the money.
 *
 * So the mode does not just decide what goes IN a column, it decides whether
 * the column is there at all. Freight keeps every one of them, exactly as
 * before.
 *
 * KEPT IN STEP WITH jobColumns BY TEST, not by discipline: the suite feeds a
 * fully-populated invoice of each kind through jobColumns and asserts that
 * every column this list omits really does come back empty, and that every
 * column it claims really is filled. A list that drifts from the mapping
 * either hides a column that has data in it or leaves a blank one on screen.
 */
const JOB_COLUMNS = [
  'jobNo', 'jobDate', 'doDate', 'docPrimary', 'docSecondary', 'sailDate', 'arrivalDate',
  'finalDestination', 'jobType', 'vessel', 'shippingLine', 'shipper',
  'consignee', 'salesRep', 'clientCode', 'weight', 'volume', 'containers',
  'customerRef', 'freightType', 'gdDate', 'clientInvoiceNo', 'vendorTaxInvoiceNo',
];

// A goods declaration's own: its date, and the client's invoice it clears.
// And on a bill, the vendor's own tax invoice number - a clearing agent's
// vendors send one for the duty and charges they pass on (the user's request,
// 2026-10-09: Job Balancing on customs).
const CUSTOMS_ONLY = ['gdDate', 'clientInvoiceNo', 'vendorTaxInvoiceNo'];

const FILLED_BY_MODE = {
  freight: JOB_COLUMNS.filter((k) => !CUSTOMS_ONLY.includes(k)),
  // Job no, flight date, the AWBs, the flight number, the sector, and 'AV'.
  aviation: ['jobNo', 'jobDate', 'docPrimary', 'docSecondary', 'finalDestination', 'jobType'],
  // Job no and date, the BL, the GD number and date, the client's invoice,
  // the direction, and Sea/Air.
  customs: ['jobNo', 'jobDate', 'docPrimary', 'docSecondary', 'jobType', 'vessel', ...CUSTOMS_ONLY],
};

export const ALL_JOB_COLUMNS = JOB_COLUMNS;

/** Does this mode put anything in that column? Unknown mode = freight. */
export function usesColumn(mode, key) {
  return (FILLED_BY_MODE[mode] || FILLED_BY_MODE.freight).includes(key);
}

/** The job columns this mode fills, in report order. */
export function filledColumns(mode) {
  return JOB_COLUMNS.filter((k) => usesColumn(mode, k));
}

export function docHeadings(mode) {
  return DOC_HEADINGS[mode] || DOC_HEADINGS.freight;
}

/**
 * The job columns for one invoice row.
 *
 * Every field is a STRING, empty where the mode has no such concept, so a
 * caller can render it without guarding and an export cannot write `undefined`
 * into a cell.
 */
export function jobColumns(invoice) {
  const x = invoice || {};
  const kind = jobKindOf(x);

  if (kind === 'aviation') {
    const a = x.aviation || {};
    return {
      kind,
      jobId: a.jobId,
      jobNo: str(a.jobNo),
      jobDate: str(a.flightDate),
      doDate: '',
      // Every AWB the invoice actually billed. An invoice can cover several,
      // and there is no house/master pair on a flight the way there is on a
      // bill of lading - so they go in one column and the second names the
      // flight instead of repeating them.
      docPrimary: Array.isArray(a.awbs) ? a.awbs.join(', ') : str(a.awbs),
      docSecondary: str(a.flightNo),
      sailDate: '',
      arrivalDate: '',
      // 'KHI - JED'. The nearest thing a flight has to a final destination,
      // and more use in a balancing report than the arrival airport alone.
      finalDestination: str(a.sector),
      jobType: 'AV',
      // A flight has none of these on the invoice.
      vessel: '',
      shippingLine: '',
      shipper: '',
      consignee: '',
      salesRep: '',
      clientCode: '',
      weight: '',
      volume: '',
      containers: '',
      customerRef: '',
      freightType: '',
      gdDate: '',
      clientInvoiceNo: '',
      vendorTaxInvoiceNo: '',
    };
  }

  if (kind === 'customs') {
    const c = x.customs || {};
    return {
      kind,
      jobId: c.jobId,
      jobNo: str(c.jobNo),
      // The job's own date; the GD date has a column of its own. A job with no
      // date of its own shows its GD date, as this column always did.
      jobDate: str(c.jobDate || c.gdDate),
      gdDate: str(c.gdDate),
      // Job Details > Client Invoice (the backend falls back to clientRef).
      clientInvoiceNo: str(c.clientInvoiceNo),
      // The invoice's own, not the job's: entered on a bill's page once the
      // vendor's tax invoice arrives. Blank on an invoice.
      vendorTaxInvoiceNo: str(x.vendorTaxInvoiceNo),
      doDate: '',
      docPrimary: str(c.blNo),
      docSecondary: str(c.gdNumber),
      sailDate: '',
      arrivalDate: '',
      finalDestination: '',
      // Import or Export - the split a clearing agent actually works in, and
      // the one that decides which pair of accounts the job posts to.
      jobType: str(c.direction),
      // Sea or Air. Not a ship's name, but it is what this column means on a
      // clearance and the alternative is an empty cell.
      vessel: str(c.transportMode),
      shippingLine: '',
      shipper: '',
      consignee: '',
      salesRep: '',
      clientCode: '',
      weight: '',
      volume: '',
      containers: '',
      customerRef: '',
      freightType: '',
    };
  }

  // An advance: every job column empty but the type, which says what the row is.
  if (kind === 'advance') {
    return Object.fromEntries([['kind', kind], ['jobId', undefined],
      ...JOB_COLUMNS.map((k) => [k, k === 'jobType' ? 'Advance' : ''])]);
  }

  // Freight, and the no-job case. Reads exactly what the report always read,
  // so nothing about a freight install moves.
  const j = x.SE_Job || {};
  const equipment = Array.isArray(j.SE_Equipments) ? j.SE_Equipments : [];
  return {
    kind,
    jobId: j.id,
    jobNo: str(j.jobNo),
    jobDate: str(j.createdAt || j.jobDate),
    // The delivery order, on an import job that has one.
    doDate: str(j.Delivery_Order && j.Delivery_Order.date),
    docPrimary: str(j.Bl && j.Bl.hbl),
    docSecondary: str(j.Bl && j.Bl.mbl),
    sailDate: str(j.shipDate),
    arrivalDate: str(j.arrivalDate),
    finalDestination: str(j.fd),
    /* "Air" for an air job, as Climax printed it. Its subType is the sea
     * form's LCL default - every migrated air job carries it - so
     * showing subType called an air shipment LCL. Sea keeps FCL / LCL. */
    jobType: j.operation === 'AE' || j.operation === 'AI' ? 'Air' : str(j.subType),
    vessel: str(j.vessel && j.vessel.name),
    shippingLine: str(j.shipping_line && j.shipping_line.name),
    shipper: str(j.shipper && j.shipper.name),
    consignee: str(j.consignee && j.consignee.name),
    salesRep: str(j.sales_representator && j.sales_representator.name),
    clientCode: str(j.Client && j.Client.code),
    weight: str(j.weight),
    volume: str(j.vol),
    containers: equipment.map((e) => e.size).filter(Boolean).join(', '),
    customerRef: str(j.customerRef),
    freightType: str(j.freightType),
    gdDate: '',
    clientInvoiceNo: '',
    vendorTaxInvoiceNo: '',
  };
}

/**
 * Where clicking the Job No cell should go, and what to call the tab.
 *
 * Returned rather than decided in the cell, so the table and anything else
 * that offers the same click agree about it.
 */
export function jobLink(invoice) {
  const x = invoice || {};
  const kind = jobKindOf(x);

  if (kind === 'aviation') {
    return {
      href: `/aviationJobs/${x.aviation.jobId}`,
      tab: { label: x.aviation.jobNo || 'Aviation Job', key: '10-2', id: `${x.aviation.jobId}` },
    };
  }
  if (kind === 'customs') {
    return {
      href: `/customsJobs/${x.customs.jobId}`,
      tab: { label: x.customs.jobNo || 'Customs Job', key: '11-2', id: `${x.customs.jobId}` },
    };
  }
  if (kind === 'freight' && x.SE_Job.jobNo) {
    const type = x.SE_Job.operation;
    const href = type === 'SE' ? `/seaJobs/export/${x.SE_Job.id}`
      : type === 'SI' ? `/seaJobs/import/${x.SE_Job.id}`
        : type === 'AE' ? `/airJobs/export/${x.SE_Job.id}`
          : `/airJobs/import/${x.SE_Job.id}`;
    const label = type === 'SE' ? 'SE JOB' : type === 'SI' ? 'SI JOB' : type === 'AE' ? 'AE JOB' : 'AI JOB';
    const key = type === 'SE' ? '4-3' : type === 'SI' ? '4-6' : type === 'AE' ? '7-2' : '7-5';
    return { href, tab: { label, key, id: x.SE_Job.id } };
  }
  return null;
}

/**
 * Where clicking the document number (Inv. No) goes: the invoice - or, on an
 * advance row, the payment / receipt it is the leftover of, where its
 * invoices are settled (Refresh, tick, Save Settlement).
 */
export function docLink(invoice) {
  const x = invoice || {};
  // A Pending row (Job Balancing, jobs with no invoice) has no document of
  // its own: its Inv. No ("Not invoiced") opens the job.
  if (x.pending) return jobLink(x);
  if (x.advance) {
    return {
      href: `/accounts/paymentReceipt/${x.voucherId}`,
      tab: { label: 'Payment / Receipt', key: '3-4', id: `${x.voucherId}` },
    };
  }
  return {
    href: `/reports/invoice/${x.id}`,
    tab: { label: 'Invoice Details', key: '3-17', id: `${x.id}` },
  };
}
