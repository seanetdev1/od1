import moment from 'moment';
import airports from 'jsonData/airports';
import { placeName } from 'functions/placeName';
import { totalGross } from 'functions/blWeights';
import { pTagsToString, htmlLines, blPortName, freightTerms, freightPayableAt, stampsOfGroup } from 'functions/blPrintText';
import { templateCatalogue } from 'functions/templateCatalogue';
import { stamps as STAMP_LIST } from 'Components/Layouts/JobsLayout/BlComp/groupData';

/* THE VALUES A BILL OF LADING OR AN AIR WAYBILL TEMPLATE PRINTS - the user's
 * request, 2026-11-01: "the same template system for BL and AWBL". Set up in
 * Configuration > Printing Templates as the document "Bill of Lading" (sea
 * jobs) or "Air Waybill" (air jobs), printed from the B/L's Ref No's / Stamps
 * tab.
 *
 * What a sea B/L prints is worked out with the built-in print's own helpers
 * (BlPrintImage - functions/blPrintText, functions/blWeights), from the same
 * screen values it prints from, so the two cannot print one B/L two ways. The
 * built-in has no Air Waybill: air jobs printed the sea B/L form. An Air
 * Waybill template prints the AWB's own boxes - routing, charges, items,
 * dimensions - as the Basic Information, Item Detail and Charges Detail tabs
 * hold them.
 *
 * Every value arrives as finished text: Word cannot format or add up.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const present = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null';
const text = (v) => (present(v) ? String(v).trim() : '');
// The B/L's own date format - "Date and Place of Issue" on the built-in print.
const blDate = (v) => (v && moment(v).isValid() ? moment(v).format('DD/MMM/YYYY') : '');
const money = (v) => {
  const n = Math.round(num(v) * 100) / 100;
  const [whole, cents] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
};
// An AWB's charge box: empty when nothing is charged, as on a paper AWB.
const charge = (v) => (num(v) ? money(v) : '');
// A weight or count as typed, without a float's tail: 125.5, not 125.50000001.
const figure = (v) => (present(v) ? String(Math.round(num(v) * 1000) / 1000) : '');
const box = (html) => pTagsToString(html ?? '');

export const BILL_OF_LADING = 'Bill of Lading';
export const AIR_WAYBILL = 'Air Waybill';

/** The document a job's B/L is: an Air Waybill for an air job. */
export const blDocumentType = (operation) => (operation === 'AE' || operation === 'AI' ? AIR_WAYBILL : BILL_OF_LADING);

// Climax's copies: each an Original or a Non-Negotiable copy - Stamps' Copies.
const COPY_NAMES = { original: 'ORIGINAL', nonNegotiable: 'NON-NEGOTIABLE' };

/**
 * Every value a B/L or Air Waybill template can print, for one copy.
 *
 * Takes what the built-in print (BlPrintImage) takes: the screen's values
 * (`values` - the form, with the job as jobData), its `state` (the party,
 * marks and description editors, Container_Infos, Item_Details, Dimensions),
 * the job's company (the letterhead), Stamps' "Leave off the print" boxes
 * (`options`: hideCbm, hideGrossWeight, hideNetWeight, hideContainers,
 * hideFormE) and which copy (`copy`: 'original' | 'nonNegotiable').
 */
export function blTemplateFields({
  values, state, company, options = {}, copy = 'original', copyNo = 1, printedBy = '', now = new Date(),
}) {
  const v = values || {};
  const st = state || {};
  const comp = company || {};
  const job = v.jobData || {};
  const operation = v.operation || job.operation || '';
  const isAir = operation === 'AE' || operation === 'AI';
  const place = (code) => (isAir ? placeName(airports, code) : blPortName(code));

  // ---- the cargo, as the built-in print adds it up
  const gross = totalGross(v.Container_Infos);
  const containers = options.hideContainers ? [] : (st.Container_Infos || []).map((c, i) => ({
    sr: String(i + 1),
    no: text(c.no),
    size: text(c.size),
    seal: text(c.seal),
    packages: [text(c.pkgs), text(c.unit)].filter(Boolean).join(' '),
    grossWeight: present(c.gross) ? `${num(c.gross).toFixed(3)} KGS` : '',
    netWeight: present(c.net) ? `${num(c.net).toFixed(3)} KGS` : '',
    cbm: present(c.cbm) ? `${num(c.cbm).toFixed(3)} CBM` : '',
  }));
  /* THE B/L'S OWN BOXES ONLY. The two "Attach sheet" editors under them are
   * what goes on the attach sheet - which prints from the built-in layout
   * after the template's B/L (Stamps). They were joined on here, so with a
   * Word template everything landed on the B/L and no attach sheet was ever
   * printed (the user, 2026-11-20: "attach sheet functionality lost"). A
   * template that wants them on its own page has attachMarks and
   * attachDescription. */
  const marks = htmlLines(st.marksContent).join('\n');
  const description = htmlLines(st.descOfGoodsContent).join('\n');
  const attachMarks = htmlLines(st.marksContentTwo).join('\n');
  const attachDescription = htmlLines(st.descOfGoodsContentTwo).join('\n');

  // ---- an air waybill's items and dimensions
  const items = (st.Item_Details || []).map((x, i) => ({
    sr: String(i + 1),
    pieces: figure(x.noOfPcs),
    grossWeight: figure(x.grossWt),
    kgLb: text(x.kh_lb),
    rateClass: text(x.r_class),
    commodityItemNo: text(x.itemNo),
    chargeableWeight: figure(x.chargableWt),
    rate: present(x.rate_charge) && num(x.rate_charge) ? money(x.rate_charge) : '',
    total: present(x.total) && num(x.total) ? money(x.total) : '',
  }));
  const dimensions = (st.Dimensions || [])
    .filter((d) => num(d.length) || num(d.width) || num(d.height) || num(d.qty))
    .map((d) => ({
      length: figure(d.length), width: figure(d.width), height: figure(d.height),
      qty: figure(d.qty), volume: figure(d.vol), weight: figure(d.weight),
      line: `${figure(d.length)} x ${figure(d.width)} x ${figure(d.height)}${num(d.qty) ? ` x ${figure(d.qty)}` : ''}`,
    }));
  const sumOf = (list, key) => list.reduce((t, x) => t + num(x[key]), 0);

  // ---- stamps, by group (the Stamps tab's Stamp Group)
  const stampGroups = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8]
    .map((g) => [`stamps${g}`, stampsOfGroup(v.stamps, g, STAMP_LIST).join(' ')]));
  const allStamps = (Array.isArray(v.stamps) ? v.stamps : [])
    .map((x) => STAMP_LIST[Number(x?.code) - 1]?.label).filter(Boolean).map((l) => l.trim());

  const formENo = text(v.formE);
  const showFormE = !options.hideFormE && formENo !== '';
  const terms = freightTerms(v.freightType);
  const copyName = COPY_NAMES[copy] || COPY_NAMES.original;

  return {
    // company - the letterhead
    companyName: text(comp.title),
    companyAddress: text(comp.address),
    companyPhone: text(comp.phone),
    companyEmail: text(comp.email),
    companyWeb: text(comp.web),
    companyNtn: text(comp.ntn),
    companyStrn: text(comp.strn),

    // the document, and this copy of it
    documentType: isAir ? AIR_WAYBILL : BILL_OF_LADING,
    copyName,
    copyNo: String(copyNo),
    jobNo: text(v.jobNo),
    blNo: text(v.hbl),
    blDate: blDate(v.hblDate),
    mblNo: text(v.mbl),
    mblDate: blDate(v.mblDate),
    hawbNo: text(v.hbl),
    hawbDate: blDate(v.hblDate),
    mawbNo: text(v.mbl),
    mawbDate: blDate(v.mblDate),

    // the parties, as typed in the B/L's boxes
    shipper: box(st.shipperContent),
    consignee: box(st.consigneeContent),
    notifyParty: box(st.notifyOneContent),
    notifyParty2: box(st.notifyTwoContent),
    deliveryAgent: box(st.deliveryContent),
    shipperName: text(v.shipper),
    consigneeName: text(v.consignee),
    overseasAgentName: text(v.overseas_agent),

    // the voyage - ports by name, as the B/L prints them
    vessel: text(v.vessel),
    voyage: text(v.voyage),
    vesselVoyage: [text(v.vessel), text(v.voyage)].filter(Boolean).join(' '),
    shippingLine: text(v.shipping_line),
    placeOfReceipt: place(v.por),
    portOfLoading: place(v.polTwo),
    portOfDischarge: place(v.podTwo),
    placeOfDelivery: place(v.poDeliveryTwo),
    onBoardDate: blDate(v.onBoardDate),

    // the cargo
    marks,
    packages: box(st.noOfPckgs),
    description,
    attachMarks,
    attachDescription,
    commodity: text(v.commodity),
    hsCode: text(v.hs),
    totalPackages: num(v.pkgs) ? [figure(v.pkgs), text(v.unit) === '0' ? '' : text(v.unit)].filter(Boolean).join(' ') : '',
    grossWeight: options.hideGrossWeight ? '' : `${gross.toFixed(3)} KGS`,
    netWeight: options.hideNetWeight ? '' : `${num(v.net).toFixed(3)} KGS`,
    cbm: options.hideCbm ? '' : `${num(v.cbm).toFixed(3)} CBM`,
    containers,
    containerNos: containers.map((c) => c.no).filter(Boolean).join(', '),
    containerCount: String(containers.length),

    // freight, issue, originals - as the built-in print words them
    freight: terms,
    freightTerms: terms ? `FREIGHT ${terms}` : '',
    freightPayableAt: freightPayableAt(v.freightType),
    issuePlace: text(v.issuePlace),
    issueDate: blDate(v.issueDate),
    issueDateAndPlace: [blDate(v.issueDate), text(v.issuePlace)].filter(Boolean).join(' | '),
    noOfOriginals: text(v.noBls),
    agentStamp: text(v.AgentStamp),
    formENo: showFormE ? formENo : '',
    formEDate: showFormE ? blDate(v.formEDate) : '',
    ...stampGroups,
    allStamps: allStamps.join('\n'),

    // an air waybill's own boxes
    airline: text(v.air_line),
    flightNo: text(v.flightNo),
    flightDate1: blDate(v.date1),
    flightDate2: blDate(v.date2),
    airportOfDeparture: place(v.polTwo),
    airportOfDestination: place(v.podTwo),
    routingTo1: text(v.toOne),
    routingBy1: text(v.byFirstCarrier),
    routingTo2: text(v.toTwo),
    routingBy2: text(v.byOne),
    routingTo3: text(v.toThree),
    routingBy3: text(v.byTwo),
    currency: text(v.currency),
    chargesCode: text(v.charges),
    wtValPrepaid: text(v.wtValPPC),
    wtValCollect: text(v.wtValCOLL),
    otherPrepaid: text(v.othersPPC),
    otherCollect: text(v.othersCOLL),
    declaredValueCarriage: text(v.declareCarriage),
    declaredValueCustoms: text(v.declareCustoms),
    insuranceAmount: text(v.insurance),
    handlingInformation: text(v.handlingInfo),
    items,
    totalPieces: items.length ? figure(sumOf(items, 'pieces')) : '',
    totalItemsGrossWeight: items.length ? figure(sumOf(items, 'grossWeight')) : '',
    totalChargeableWeight: items.length ? figure(sumOf(items, 'chargeableWeight')) : '',
    totalItemsCharge: sumOf(st.Item_Details || [], 'total') ? money(sumOf(st.Item_Details || [], 'total')) : '',
    dimensions,
    dimensionsText: dimensions.map((d) => d.line).join('\n'),
    totalVolume: dimensions.length ? figure(sumOf(dimensions, 'volume')) : '',
    weightChargePrepaid: charge(v.ppWeightCharges),
    weightChargeCollect: charge(v.ccWeightCharges),
    valuationChargePrepaid: charge(v.ppvaluationCharges),
    valuationChargeCollect: charge(v.ccvaluationCharges),
    taxPrepaid: charge(v.ppTax),
    taxCollect: charge(v.ccTax),
    otherDueAgentPrepaid: charge(v.ppOtherDueChargeAgent),
    otherDueAgentCollect: charge(v.ccOtherDueChargeAgent),
    otherDueCarrierPrepaid: charge(v.ppOtherDueChargeCarrier),
    otherDueCarrierCollect: charge(v.ccOtherDueChargeCarrier),
    totalPrepaid: charge(v.ppTotal),
    totalCollect: charge(v.ccTotal),
    executedOn: blDate(v.issueDate),
    executedAt: text(v.issuePlace),

    // printing
    printedOn: moment(now).format('DD/MM/YYYY HH:mm:ss'),
    printedDate: moment(now).format('DD-MMM-YYYY'),
    printedBy: text(printedBy),

    // conditions
    isOriginal: copy !== 'nonNegotiable',
    isNonNegotiable: copy === 'nonNegotiable',
    isPrepaid: terms === 'PREPAID',
    isCollect: terms === 'COLLECT',
    isExport: operation === 'SE' || operation === 'AE',
    isImport: operation === 'SI' || operation === 'AI',
    hasNotifyParty2: present(box(st.notifyTwoContent)),
    hasContainers: containers.length > 0,
    hasFormE: showFormE,
    hasStamps: allStamps.length > 0,
    hasItems: items.length > 0,
    hasDimensions: dimensions.length > 0,
    hasHandlingInformation: present(v.handlingInfo),
    showCbm: !options.hideCbm,
    showGrossWeight: !options.hideGrossWeight,
    showNetWeight: !options.hideNetWeight,
    showContainers: !options.hideContainers,
    hasAttachSheet: attachMarks !== '' || attachDescription !== '',
  };
}

/**
 * The B/L as a document to print from its template (functions/
 * templatePrint usePreparedDocumentPdf): one set of values per copy,
 * in Stamps' order - ['original', 'original', 'nonNegotiable'] - as one PDF.
 * args: as blTemplateFields takes, with `copies` for `copy`.
 */
export const blDocument = ({ copies, ...args }) => (now) => {
  const list = Array.isArray(copies) && copies.length ? copies : ['original'];
  const docs = list.map((copy, i) => blTemplateFields({ ...args, copy, copyNo: i + 1, now }));
  const first = docs[0];
  return {
    docs,
    fileName: `${first.blNo || first.jobNo || 'B-L'} ${first.documentType}`,
    what: first.documentType === AIR_WAYBILL ? 'air waybill' : 'B/L',
  };
};

/* ------------------------------- the names --------------------------------- */

const COMPANY = { group: 'Company (the letterhead - the job\'s company)', fields: [
  ['companyName', 'Company name', 'SEANET SHIPPING & LOGISTICS'],
  ['companyAddress', 'Address', 'OFFICE NO. 1, KARACHI'],
  ['companyPhone', 'Phone', '021-35870000'],
  ['companyEmail', 'Email', ''],
  ['companyWeb', 'Website', ''],
  ['companyNtn', 'NTN', ''],
  ['companyStrn', 'STRN', ''],
] };
const COPY = { group: 'This copy', fields: [
  ['copyName', 'ORIGINAL or NON-NEGOTIABLE - each copy set under Copies prints once', 'ORIGINAL'],
  ['copyNo', 'Its number, from 1', '1'],
] };
const PARTIES = { group: 'Parties - as typed in the B/L\'s boxes (one line each)', fields: [
  ['shipper', 'Shipper', 'ABC TEXTILES (PVT) LTD\nPLOT 12, SITE, KARACHI'],
  ['consignee', 'Consignee', 'TO ORDER'],
  ['notifyParty', 'Notify One', 'XYZ IMPORTS LLC, DUBAI'],
  ['notifyParty2', 'Notify Two', ''],
  ['deliveryAgent', 'Delivery Agent - "For delivery please apply to"', 'GLOBAL AGENCIES, JEBEL ALI'],
  ['shipperName', "The job's shipper, by name", 'ABC TEXTILES (PVT) LTD'],
  ['consigneeName', "The job's consignee, by name", ''],
  ['overseasAgentName', "The job's overseas agent, by name", 'GLOBAL AGENCIES'],
] };
const PRINTING = { group: 'Printing', fields: [
  ['printedOn', 'Date and time of printing', '01/11/2026 16:38:21'],
  ['printedDate', 'Date of printing', '01-Nov-2026'],
  ['printedBy', 'Who printed it', 'Account'],
] };
const STAMPS = { group: 'Stamps (Ref No\'s / Stamps tab)', fields: [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((g) => [`stamps${g}`, `The stamps in group ${g}, on one line`, g === 1 ? 'SHIP ON BOARD' : '']),
  ['allStamps', 'Every stamp, one line each', 'SHIP ON BOARD\nSAID TO CONTAIN'],
] };

export const BL_FIELDS = [
  COMPANY,
  COPY,
  { group: 'Bill of Lading', fields: [
    ['blNo', 'B/L (HBL) number', 'SNSL/KHI/0425'],
    ['blDate', 'B/L date', '24/Oct/2026'],
    ['mblNo', 'MBL number', 'MAEU123456789'],
    ['mblDate', 'MBL date', '24/Oct/2026'],
    ['jobNo', 'Job number', 'SNS-SE-425/26'],
    ['issuePlace', 'Place of issue', 'KARACHI'],
    ['issueDate', 'Date of issue', '24/Oct/2026'],
    ['issueDateAndPlace', 'Both, as the built-in print has them', '24/Oct/2026 | KARACHI'],
    ['onBoardDate', 'Shipped on board', '25/Oct/2026'],
    ['noOfOriginals', 'Number of original B/Ls (NO. BLS)', 'THREE (3)'],
    ['agentStamp', 'Agent Stamp', ''],
  ] },
  PARTIES,
  { group: 'Voyage', fields: [
    ['vessel', 'Vessel', 'MAERSK KENSINGTON'],
    ['voyage', 'Voyage', '612W'],
    ['vesselVoyage', 'Both, on one line', 'MAERSK KENSINGTON 612W'],
    ['shippingLine', 'Shipping line', 'MAERSK LINE'],
    ['placeOfReceipt', 'Place of receipt', 'KARACHI, PAKISTAN'],
    ['portOfLoading', 'Port of loading', 'KARACHI, PAKISTAN'],
    ['portOfDischarge', 'Port of discharge', 'JEBEL ALI, UNITED ARAB EMIRATES'],
    ['placeOfDelivery', 'Place of delivery', 'JEBEL ALI, UNITED ARAB EMIRATES'],
  ] },
  { group: 'Cargo', fields: [
    ['marks', 'Marks & numbers - the B/L box, one line each (its Attach sheet box prints on the attach sheet)', 'ABC/DXB\n1-500'],
    ['packages', 'Packages or shipping units, as typed', '500 CARTONS'],
    ['description', 'Description of goods - the B/L box, one line each (its Attach sheet box prints on the attach sheet)', 'COTTON YARN\nHS CODE 5205.12'],
    ['attachMarks', 'Marks - the Attach sheet box, one line each', 'CONTD.'],
    ['attachDescription', 'Description - the Attach sheet box, one line each', '200 CARTONS ...'],
    ['commodity', "The job's commodity", 'COTTON YARN'],
    ['hsCode', 'HS code', '5205.12'],
    ['totalPackages', 'The containers\' packages, added up', '500 CTNS'],
    ['grossWeight', 'Gross weight, every container\'s (blank with Leave off: Gross weight)', '9936.000 KGS'],
    ['netWeight', 'Net weight (blank with Leave off: Net weight)', '9800.000 KGS'],
    ['cbm', 'Measurement (blank with Leave off: CBM)', '28.000 CBM'],
    ['containerNos', 'Container numbers, comma separated', 'MSKU1234565, MSKU7654321'],
    ['containerCount', 'How many containers', '2'],
  ] },
  { group: 'Freight', fields: [
    ['freight', 'PREPAID or COLLECT', 'PREPAID'],
    ['freightTerms', 'As the built-in print has it', 'FREIGHT PREPAID'],
    ['freightPayableAt', 'Freight payable at', 'KARACHI, PAKISTAN'],
    ['formENo', 'Form E number (blank with Leave off: Form E)', '12345'],
    ['formEDate', 'Form E date', '20/Oct/2026'],
  ] },
  STAMPS,
  PRINTING,
];

const CONTAINER_FIELDS = [
  ['sr', 'Line number', '1'],
  ['no', 'Container number', 'MSKU1234565'],
  ['size', 'Size / type', "40'HC"],
  ['seal', 'Seal', 'ML-123456'],
  ['packages', 'Its packages', '250 CTNS'],
  ['grossWeight', 'Its gross weight', '4968.000 KGS'],
  ['netWeight', 'Its net weight', '4900.000 KGS'],
  ['cbm', 'Its measurement', '14.000 CBM'],
];

export const BL_LISTS = [
  { name: 'containers', about: 'One per container - none with Leave off: Container data.', fields: CONTAINER_FIELDS },
];

const COMMON_CONDITIONS = [
  ['isOriginal', 'This copy is an Original'],
  ['isNonNegotiable', 'This copy is a Non-Negotiable copy'],
  ['isPrepaid', 'Freight prepaid'],
  ['isCollect', 'Freight collect'],
  ['isExport', 'An export job'],
  ['isImport', 'An import job'],
  ['hasNotifyParty2', 'It has a second notify party'],
  ['hasStamps', 'It has a stamp'],
];

export const BL_CONDITIONS = [
  ...COMMON_CONDITIONS,
  ['hasContainers', 'It has a container (and Container data is not left off)'],
  ['hasFormE', 'It has a Form E number (and Form E is not left off)'],
  ['showCbm', 'Leave off: CBM not ticked'],
  ['showGrossWeight', 'Leave off: Gross weight not ticked'],
  ['showNetWeight', 'Leave off: Net weight not ticked'],
  ['showContainers', 'Leave off: Container data not ticked'],
  ['hasAttachSheet', 'Something is typed in an Attach sheet box - e.g. for "AS PER ATTACHED SHEET"'],
];

export const AWB_FIELDS = [
  COMPANY,
  COPY,
  { group: 'Air Waybill', fields: [
    ['mawbNo', 'MAWB number', '176-12345675'],
    ['mawbDate', 'MAWB date', '24/Oct/2026'],
    ['hawbNo', 'HAWB number', 'SNS-HAWB-0425'],
    ['hawbDate', 'HAWB date', '24/Oct/2026'],
    ['jobNo', 'Job number', 'SNS-AE-425/26'],
    ['airline', 'The airline', 'EMIRATES'],
    ['flightNo', 'Flight number', 'EK-601'],
    ['flightDate1', 'Date (1) - requested flight date', '25/Oct/2026'],
    ['flightDate2', 'Date (2)', ''],
    ['executedOn', 'Executed on - the date of issue', '24/Oct/2026'],
    ['executedAt', 'Executed at - the place of issue', 'KARACHI'],
  ] },
  PARTIES,
  { group: 'Routing', fields: [
    ['airportOfDeparture', 'Airport of departure', 'Karachi'],
    ['airportOfDestination', 'Airport of destination', 'Dubai'],
    ['placeOfDelivery', 'Place of delivery', 'Dubai'],
    ['routingTo1', 'To (first)', 'DXB'],
    ['routingBy1', 'By first carrier', 'EK'],
    ['routingTo2', 'To (second)', ''],
    ['routingBy2', 'By (second)', ''],
    ['routingTo3', 'To (third)', ''],
    ['routingBy3', 'By (third)', ''],
  ] },
  { group: 'Charges and values', fields: [
    ['freight', 'PREPAID or COLLECT - the job\'s freight', 'PREPAID'],
    ['freightTerms', 'As FREIGHT PREPAID / FREIGHT COLLECT', 'FREIGHT PREPAID'],
    ['currency', 'Currency', 'USD'],
    ['chargesCode', 'CHGS code', 'PP'],
    ['wtValPrepaid', 'WT/VAL - PPD', 'X'],
    ['wtValCollect', 'WT/VAL - COLL', ''],
    ['otherPrepaid', 'Other - PPD', 'X'],
    ['otherCollect', 'Other - COLL', ''],
    ['declaredValueCarriage', 'Declared value for carriage', 'NVD'],
    ['declaredValueCustoms', 'Declared value for customs', 'NCV'],
    ['insuranceAmount', 'Amount of insurance', 'NIL'],
    ['handlingInformation', 'Handling information', 'PLEASE INFORM CONSIGNEE ON ARRIVAL'],
    ['weightChargePrepaid', 'Weight charge - prepaid (blank when none)', '1,250.00'],
    ['weightChargeCollect', 'Weight charge - collect', ''],
    ['valuationChargePrepaid', 'Valuation charge - prepaid', ''],
    ['valuationChargeCollect', 'Valuation charge - collect', ''],
    ['taxPrepaid', 'Tax - prepaid', ''],
    ['taxCollect', 'Tax - collect', ''],
    ['otherDueAgentPrepaid', 'Total other charges due agent - prepaid', '50.00'],
    ['otherDueAgentCollect', 'Total other charges due agent - collect', ''],
    ['otherDueCarrierPrepaid', 'Total other charges due carrier - prepaid', '120.00'],
    ['otherDueCarrierCollect', 'Total other charges due carrier - collect', ''],
    ['totalPrepaid', 'Total prepaid', '1,420.00'],
    ['totalCollect', 'Total collect', ''],
  ] },
  { group: 'Cargo', fields: [
    ['marks', 'Marks & numbers, one line each', 'ABC/DXB 1-25'],
    ['description', 'Nature and quantity of goods, one line each', 'GARMENTS'],
    ['commodity', "The job's commodity", 'GARMENTS'],
    ['totalPieces', 'Pieces, added up', '25'],
    ['totalItemsGrossWeight', 'Gross weight, added up', '412.5'],
    ['totalChargeableWeight', 'Chargeable weight, added up', '450'],
    ['totalItemsCharge', 'The items\' totals, added up', '1,250.00'],
    ['dimensionsText', 'Every dimension line - L x W x H x pieces - one line each', '60 x 40 x 40 x 25'],
    ['totalVolume', 'Volume, added up', '2.4'],
  ] },
  STAMPS,
  PRINTING,
];

export const AWB_LISTS = [
  { name: 'items', about: 'One per Item Detail row - the rating lines.', fields: [
    ['sr', 'Line number', '1'],
    ['pieces', 'No. of pieces', '25'],
    ['grossWeight', 'Gross weight', '412.5'],
    ['kgLb', 'Kg / Lb', 'K'],
    ['rateClass', 'Rate class', 'Q'],
    ['commodityItemNo', 'Commodity item no.', ''],
    ['chargeableWeight', 'Chargeable weight', '450'],
    ['rate', 'Rate / charge', '2.78'],
    ['total', 'Total', '1,250.00'],
  ] },
  { name: 'dimensions', about: 'One per dimension line (Item Detail).', fields: [
    ['length', 'Length', '60'], ['width', 'Width', '40'], ['height', 'Height', '40'],
    ['qty', 'Pieces', '25'], ['volume', 'Volume', '2.4'], ['weight', 'Weight', ''],
    ['line', 'L x W x H x pieces', '60 x 40 x 40 x 25'],
  ] },
];

export const AWB_CONDITIONS = [
  ...COMMON_CONDITIONS,
  ['hasItems', 'It has an Item Detail row'],
  ['hasDimensions', 'It has a dimension line'],
  ['hasHandlingInformation', 'It has handling information'],
];

export const BL_CATALOGUE = templateCatalogue({ fields: BL_FIELDS, lists: BL_LISTS, conditions: BL_CONDITIONS });
export const AWB_CATALOGUE = templateCatalogue({ fields: AWB_FIELDS, lists: AWB_LISTS, conditions: AWB_CONDITIONS });

export default blTemplateFields;
