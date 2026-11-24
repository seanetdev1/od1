import moment from 'moment';
import ports from 'jsonData/ports';
import airports from 'jsonData/airports';
import inWords from 'functions/numToWords';
import { bankAccountFields } from 'functions/companyBranding';
import { isSaleTaxLine, lineFigures, saleTaxFigures } from 'functions/saleTaxInvoice';
import { settlementLines } from 'functions/invoiceSettlementLines';
import { printCurrency, printsForeign, lineAmount } from 'functions/invoicePrintCurrency';
import { clientInvoiceNo } from 'functions/customsJobReference';
import { isDraftInvoice } from 'Components/Shared/DraftWatermark';
import { calculateTotal } from 'Components/Shared/invoicePrintDefaults';
import { placeName } from 'functions/placeName';
import { templateCatalogue } from 'functions/templateCatalogue';

/* THE VALUES AN INVOICE TEMPLATE PRINTS - Configuration > Printing Templates.
 *
 * A template is the client's own Word file with {names} typed where the data
 * goes; the server fills it and makes the PDF (functions/printingTemplate on
 * the backend). Every value is worked out HERE, from the same functions the
 * built-in print uses (Components/Shared/InvoicePrint) - which lines are the
 * service charges, the sales tax, the round off, Received and Balance - so a
 * template and the built-in print cannot total one invoice two ways. They
 * arrive as finished text: Word cannot format or add up. The Sales Tax
 * Invoice's (gst...) are among them, from SaleTaxInvoicePrint's own
 * saleTaxFigures - one set of values fills either kind of template.
 *
 * FIELDS is the list template authors are given (the Configuration screen
 * shows it). A name used in a template that is not in it prints nothing, and
 * the screen warns about it on upload.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const text = (v) => (present(v) ? String(v).trim() : '');
const money = (v) => {
  const n = Math.round(num(v) * 100) / 100;
  const [whole, cents] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
};
const date = (v) => (v && moment(v).isValid() ? moment(v).format('DD-MMM-YYYY') : '');
const joined = (...xs) => xs.filter(present).map(String).join(' / ');
const lines = (...xs) => xs.filter(present).map(String).join('\n');

/* WHO PAID A CHARGE - PAID BY U / PAID BY US on H.O Enterprises' invoice.
 * Nothing records what the client paid themselves yet (asked 2026-10-28), so
 * it is 0.00 and everything is paid by us, as on every invoice of theirs seen
 * so far. When it is recorded, this is the one place it comes from. */
const paidByClientOf = () => 0;

/**
 * Every value a template can print, for one invoice.
 *
 * Takes what InvoicePrint takes: the invoice (with customsJob, recipient,
 * placeNames and Sales_Tax_Invoice from the server's attachPrintContext), its
 * charge lines, the letterhead's Company, the bank account, and Printing
 * Options - so a template honours Hide Balance and the rest through the show*
 * conditions.
 */
export function invoiceTemplateFields({
  invoice, records, company, bankAccount, options = {}, printedBy = '', now = new Date(),
}) {
  const inv = invoice || {};
  const recs = records || [];
  const comp = company || {};
  const job = inv.customsJob || null;
  const freight = inv.SE_Job || null;
  const isCustoms = Boolean(job) || inv.operation === 'CC' || inv.operation === 'LG';
  const isAir = inv.operation === 'AE' || inv.operation === 'AI'
    || String(job?.transportMode || '').toLowerCase() === 'air';

  // ---- the figures, exactly as InvoicePrint works them out
  const taxSplit = isCustoms && recs.some(isSaleTaxLine);
  const expenseLines = taxSplit ? recs.filter((x) => !isSaleTaxLine(x)) : recs;
  const taxedLines = taxSplit ? recs.filter(isSaleTaxLine) : [];
  const saleTax = taxSplit ? saleTaxFigures(recs) : null;
  const currency = printCurrency(inv);
  const foreign = printsForeign(inv);
  const noTax = isCustoms && Boolean(options.hideTax);
  const expensesTotal = taxSplit ? num(calculateTotal(expenseLines, foreign)) : 0;
  const invoiceTotal = taxSplit
    ? Math.round((expensesTotal + saleTax.serviceCharges + saleTax.saleTax) * 100) / 100
    : num(calculateTotal(recs, foreign));
  const roundOff = num(inv.roundOff);
  const totalAmount = invoiceTotal + roundOff;
  const [received, adjustment, balance] = settlementLines(inv, totalAmount);

  // ---- one charge line. `amount` is its value before tax; `total` is the
  // built-in print's Total Amount - with the tax, unless Hide Tax Column.
  const lineOf = (x, i, figures) => {
    const amount = figures ? figures.taxable : lineAmount(x, foreign);
    const tax = figures ? figures.tax : num(x.tax_amount);
    const total = figures
      ? Math.round((figures.taxable + (noTax ? 0 : figures.tax)) * 100) / 100
      : lineAmount(x, foreign);
    const paidByClient = paidByClientOf(x);
    return {
      sr: String(i + 1),
      particular: text(x.particular || x.charge),
      description: text(x.description),
      qty: text(x.qty),
      rate: present(x.rate_charge) ? money(x.rate_charge) : '',
      lineCurrency: text(x.currency),
      amount: money(amount),
      tax: money(tax),
      taxRate: figures ? `${Math.round(figures.perc * 100) / 100} %` : '',
      total: money(total),
      paidByClient: money(paidByClient),
      paidByUs: money(amount - paidByClient),
      drCr: x.pp_cc === 'CC' ? (x.type === 'Recievable' ? 'DN' : 'CN') : '',
    };
  };
  const expenses = expenseLines.map((x, i) => lineOf(x, i));
  const serviceCharges = taxedLines.map((x, i) => lineOf(x, i, lineFigures(x)));
  const sum = (list, key) => list.reduce((t, l) => t + num(String(l[key]).replace(/,/g, '')), 0);

  // ---- the Sales Tax Invoice (VAT Tax Invoice): the taxed lines only, in
  // rupees, on any invoice - exactly what SaleTaxInvoicePrint prints.
  const gst = saleTaxFigures(recs);
  const gstLines = gst.lines.map((l, i) => ({
    sr: String(i + 1),
    particular: text(l.charge.particular || l.charge.charge),
    description: text(l.charge.description),
    amount: money(l.taxable),
    taxRate: `${Math.round(l.perc * 100) / 100} %`,
    tax: money(l.tax),
    total: money(l.taxable + l.tax),
  }));

  // ---- the parties
  const recipient = inv.recipient || {};
  const party = { ...recipient, name: recipient.name || inv.party_Name };
  const shipper = job?.shipper || freight?.shipper || {};
  const consignee = job?.consignee || freight?.consignee || {};
  const ms = options.shipperInMs && job?.shipper?.name ? job.shipper : party;

  // ---- places: Setup's names first, as the built-in print has them
  const setupPlaces = Object.entries(inv.placeNames || {}).map(([id, name]) => ({ id, name }));
  const place = (code) => {
    if (!present(code)) return '';
    if (inv.placeNames?.[code]) return placeName(setupPlaces, code);
    return placeName(isAir ? airports : ports.ports, code) || String(code);
  };

  const containerRows = job?.Customs_Containers?.length
    ? job.Customs_Containers.map((c) => ({ no: text(c.containerNo), size: text(c.sizeType) }))
    : (freight?.Bl?.Container_Infos || []).map((c) => ({ no: text(c.no), size: text(c.size) }));
  const containerNos = containerRows.map((c) => c.no).filter(Boolean).join(', ') || text(job?.containers);

  const bank = bankAccountFields(bankAccount);
  const bankValue = (label) => (bank.find(([l]) => l === label) || [])[1] || '';
  const gstNo = inv.Sales_Tax_Invoice?.taxInvoiceNo || '';

  return {
    // company - the letterhead
    companyName: text(comp.title),
    companyAddress: text(comp.address),
    companyPhone: text(comp.phone),
    companyEmail: text(comp.email),
    companyWeb: text(comp.web),
    companyNtn: text(comp.ntn),
    companyStrn: text(comp.strn),

    // the document
    documentType: text(inv.type),
    invoiceNo: text(inv.invoice_No),
    invoiceDate: date(inv.createdAt),
    currency,
    exRate: present(inv.ex_rate) ? String(inv.ex_rate) : '',
    note: text(inv.note),
    gstInvoiceNo: gstNo,

    // the invoiced party, and M/S (Printing Options' Shipper in M/S)
    partyName: text(party.name),
    partyAddress: lines(party.address1, party.address2),
    partyNtn: text(party.ntn),
    partyStrn: text(party.strn),
    msName: text(ms.name),
    msAddress: lines(ms.address1, ms.address2),
    msNtn: text(ms.ntn),
    msStrn: text(ms.strn),
    shipperName: text(shipper.name),
    shipperAddress: lines(shipper.address1, shipper.address2),
    consigneeName: text(consignee.name),
    consigneeAddress: lines(consignee.address1, consignee.address2),

    // the job - customs or freight, whichever the invoice is from
    jobNo: text(job?.jobNo || freight?.jobNo),
    jobDate: date(job?.jobDate || freight?.jobDate),
    jobType: text(job?.jobType || freight?.jobType),
    fileNo: text(job?.customFileNo),
    clientRef: text(job?.clientRef || freight?.customerRef),
    clientInvoiceNo: job ? clientInvoiceNo(job) : '',
    srPageNo: text(job?.jobRef || job?.regPageNo),
    // What this install calls it - Configuration > Customs (Essani's "File
    // Job Number"), sent with the invoice.
    srPageLabel: text(inv?.printSettings?.referenceLabel || 'S/R Page #'),
    gdNumber: text(job?.gdNumber || job?.customFileNo),
    gdDate: date(job?.gdDate),
    gdType: text(job?.gdType),
    formENo: text(job?.formENo),
    formEMbl: job ? joined(job.formENo, job.mblNo) : '',
    mblNo: text(job?.mblNo || freight?.Bl?.mbl),
    hblNo: text(freight?.Bl?.hbl),
    blNo: text(job?.blNo || freight?.Bl?.hbl),
    igmNo: text(job?.igmNo),
    indexNo: text(job?.indexNo),
    vessel: text(job?.vesselOrFlight || freight?.vessel?.name),
    voyage: text(job?.voyageNo || freight?.Voyage?.voyage),
    airline: text(freight?.air_line?.name),
    flightNo: text(freight?.flightNo),
    terminal: text(job?.terminal),
    pol: place(job?.pol ?? freight?.pol),
    pod: place(job?.pod ?? freight?.pod),
    destination: place(job ? (job.pofd || job.pod) : (freight?.fd || freight?.pod)),
    deliveryLocation: text(job?.deliveryLocation),
    packages: job ? [job.packages, job.pkgUnit].filter(present).join(' ') : text(freight?.pcs),
    goodsDescription: text(job?.goodsDescription || freight?.commodity?.name),
    grossWeight: present(job?.grossWeight ?? freight?.weight) ? money(job?.grossWeight ?? freight?.weight) : '',
    volume: present(freight?.vol) ? money(freight.vol) : '',
    invoiceValue: present(job?.invoiceValue) ? money(job.invoiceValue) : '',
    invoiceValueCurrency: text(job?.invoiceCurrency),
    containerNos,
    containerCount: String(containerRows.length || ''),
    sailingDate: date(job?.sailingDate || freight?.shipDate),
    arrivalDate: date(job?.arrivalDate || freight?.eta),
    salesRep: text(freight?.sales_representator?.name),
    shippingLine: text(freight?.shipping_line?.name),

    // the charges
    lines: [...expenses, ...serviceCharges.map((l, i) => ({ ...l, sr: String(expenses.length + i + 1) }))],
    expenses,
    serviceCharges,
    containers: containerRows,
    bankLines: bank.map(([label, value]) => ({ label, value: String(value) })),
    settlement: [received, adjustment, balance].map((l) => ({ label: l.label, value: money(l.value) })),

    // the totals
    totalExpenses: money(taxSplit ? expensesTotal : invoiceTotal),
    totalExpensesPaidByClient: money(sum(expenses, 'paidByClient')),
    totalExpensesPaidByUs: money(sum(expenses, 'paidByUs')),
    totalForSalesTax: money(saleTax?.serviceCharges),
    salesTaxRate: saleTax ? (saleTax.rate !== null ? `${saleTax.rate} %` : '(rates vary by line)') : '',
    salesTax: money(saleTax?.saleTax),
    totalWithoutTax: money(invoiceTotal - (saleTax?.saleTax || 0)),
    totalWithTax: money(invoiceTotal),
    invoiceTotal: money(invoiceTotal),
    roundOff: money(roundOff),
    totalAmount: money(totalAmount),
    receivedLabel: received.label,
    received: money(received.value),
    advanceReceived: money(received.value),
    adjustment: money(adjustment.value),
    balance: money(balance.value),
    netBalance: money(balance.value),
    amountInWords: inWords(totalAmount),
    totalInWords: `${currency} ${inWords(totalAmount)}`,

    // the Sales Tax Invoice
    gstLines,
    gstServiceCharges: money(gst.serviceCharges),
    gstRate: gst.rate !== null ? `${gst.rate} %` : '(rates vary by line)',
    gstTax: money(gst.saleTax),
    gstAdditionalTax: money(gst.additionalTax),
    gstTotal: money(gst.total),
    gstTotalInWords: `PKR ${inWords(gst.total)}`,

    // the bank account (Printing Options' account)
    bankName: text(bankValue('Bank Name')),
    bankBranch: text(bankValue('Bank Branch')),
    bankAccountTitle: text(bankValue('A/c Title')),
    bankAccountNo: text(bankValue('A/c #')),
    bankSwift: text(bankValue('Swift Code')),
    bankIban: text(bankValue('IBAN')),

    // printed
    // Blank under Printing Options' Hide Printed On / By.
    printedOn: options.hidePrintedBy ? '' : moment(now).format('DD/MM/YYYY HH:mm:ss'),
    printedDate: options.hidePrintedBy ? '' : moment(now).format('DD-MMM-YYYY'),
    printedBy: options.hidePrintedBy ? '' : text(printedBy),
    // Configuration > Invoices' text for where the sign line was.
    signDisclaimer: text(inv?.printSettings?.signDisclaimer),

    // conditions - {#name}...{/name} prints what is between only when true
    isCustoms,
    isFreight: !isCustoms,
    isReceivable: inv.payType !== 'Payble',
    isPayable: inv.payType === 'Payble',
    isDraft: isDraftInvoice(inv),
    hasExpenses: expenses.length > 0,
    hasServiceCharges: serviceCharges.length > 0,
    hasSalesTax: gstLines.length > 0,
    hasRoundOff: Math.abs(roundOff) >= 0.005,
    hasNote: present(inv.note),
    hasGstInvoiceNo: present(gstNo),
    showRef: !options.hideRef,
    showLogo: !options.hideLogo,
    showBalance: !options.hideBalance,
    showNote: !options.hideNote,
    showSignLine: !options.hideSignLine,
    showPrintedBy: !options.hidePrintedBy,
    showTaxColumn: !noTax,
    showBankDetails: !options.hideBankDetails,
  };
}

/* ---------------------------- the list for authors ---------------------------- */

const LINE_FIELDS = [
  ['sr', 'Line number', '1'],
  ['particular', 'The charge', 'WEBOC TOKEN CHARGES'],
  ['description', 'Its Description/Remarks', '3226240'],
  ['qty', 'Quantity', '1'],
  ['rate', 'Rate', '500.00'],
  ['lineCurrency', "The line's currency", 'PKR'],
  ['amount', 'Value before tax', '500.00'],
  ['tax', 'Its tax', '0.00'],
  ['taxRate', 'Its tax rate (service charges)', '15 %'],
  ['total', 'Total Amount as the built-in print has it (with tax, unless Hide Tax Column)', '500.00'],
  ['paidByClient', 'Paid by the client (PAID BY U) - 0.00 until it is recorded', '0.00'],
  ['paidByUs', 'Paid by us (PAID BY US): the value less what the client paid', '500.00'],
  ['drCr', 'DN / CN on a collect line', ''],
];

/** The names a template can use, grouped as the Configuration screen shows them. */
export const FIELDS = [
  { group: 'Company (the letterhead)', fields: [
    ['companyName', 'Company name', 'H.O Enterprises'],
    ['companyAddress', 'Address', 'OFFICE NO. 604, 6TH FLOOR, AL RAHIM TOWER, KARACHI'],
    ['companyPhone', 'Phone', '32471736, 32422184'],
    ['companyEmail', 'Email', ''],
    ['companyWeb', 'Website', ''],
    ['companyNtn', 'NTN', '0287535-7'],
    ['companyStrn', 'STRN', ''],
  ] },
  { group: 'Invoice', fields: [
    ['documentType', 'Job Invoice, Job Bill, Agent Invoice...', 'Job Invoice'],
    ['invoiceNo', 'Invoice number', 'HO-9695/26'],
    ['invoiceDate', 'Invoice date', '24-Oct-2026'],
    ['currency', 'Currency', 'PKR'],
    ['exRate', 'Exchange rate', '1'],
    ['gstInvoiceNo', 'GST (Sale Tax) Invoice number', '9643-A'],
    ['note', 'The invoice note', ''],
  ] },
  { group: 'Parties', fields: [
    ['partyName', 'The invoiced party', 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED'],
    ['partyAddress', 'Its address (one line each)', ''],
    ['partyNtn', 'Its NTN', ''],
    ['partyStrn', 'Its STRN', ''],
    ['msName', "M/S - the invoiced party, or the job's shipper with Shipper in M/S", 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED'],
    ['msAddress', 'Its address', ''],
    ['msNtn', 'Its NTN', ''],
    ['msStrn', 'Its STRN (sales tax registration)', ''],
    ['shipperName', "The job's shipper", 'AL-WAHAB RICE MILLS (PRIVATE) LIMITED'],
    ['shipperAddress', 'Its address', ''],
    ['consigneeName', "The job's consignee", ''],
    ['consigneeAddress', 'Its address', ''],
  ] },
  { group: 'Job', fields: [
    ['jobNo', 'Job number', 'TP-9588/26'],
    ['jobDate', 'Job date', '20-Oct-2026'],
    ['jobType', 'Job type', 'CLEARING'],
    ['fileNo', 'File number (customs)', '9588'],
    ['clientRef', "Client's reference", '1949'],
    ['clientInvoiceNo', "Client's invoice number (customs)", ''],
    ['srPageNo', 'S/R Page number (customs)', ''],
    ['srPageLabel', "What the install calls the S/R Page # (Configuration > Customs)", 'S/R Page #'],
    ['gdNumber', 'GD / machine number', 'KPPE-SB-101192'],
    ['gdDate', 'GD date', '21-Oct-2026'],
    ['gdType', 'GD type', ''],
    ['formENo', 'Form-E number', ''],
    ['formEMbl', 'Form-E / MBL together', ''],
    ['mblNo', 'MBL / MAWB number', ''],
    ['hblNo', 'HBL / HAWB number (freight)', ''],
    ['blNo', 'B/L number', ''],
    ['igmNo', 'IGM number', ''],
    ['indexNo', 'Index number', ''],
    ['vessel', 'Vessel (or flight)', ''],
    ['voyage', 'Voyage', ''],
    ['airline', 'Airline (freight)', ''],
    ['flightNo', 'Flight number (freight)', ''],
    ['terminal', 'Terminal / yard - "Shipment From"', 'QICT'],
    ['pol', 'Port of loading', ''],
    ['pod', 'Port of discharge', ''],
    ['destination', 'Final destination (else the port of discharge)', 'ANTWERPEN'],
    ['deliveryLocation', 'Delivery location', ''],
    ['packages', 'Packages with their unit', '100 BAGS'],
    ['goodsDescription', 'Description of the goods', 'RICE'],
    ['grossWeight', 'Gross weight', ''],
    ['volume', 'Volume (freight)', ''],
    ['invoiceValue', "The goods' invoice value (customs)", '1.00'],
    ['invoiceValueCurrency', 'Its currency', ''],
    ['containerNos', 'Container numbers, comma separated', 'APZU3465269'],
    ['containerCount', 'How many containers', '1'],
    ['sailingDate', 'Sailing / ship date', ''],
    ['arrivalDate', 'Arrival / ETA', ''],
    ['salesRep', 'Sales representative (freight)', ''],
    ['shippingLine', 'Shipping line (freight)', ''],
  ] },
  { group: 'Totals', fields: [
    ['totalExpenses', 'Total of the expenses (all lines when none are taxed)', '113,610.00'],
    ['totalExpensesPaidByClient', 'Expenses paid by the client', '0.00'],
    ['totalExpensesPaidByUs', 'Expenses paid by us', '113,610.00'],
    ['totalForSalesTax', 'Service charges before tax - "Total For Sales Tax"', '2,500.00'],
    ['salesTaxRate', 'The sales tax rate', '15 %'],
    ['salesTax', 'The sales tax', '375.00'],
    ['totalWithoutTax', 'Invoice total without the sales tax', '116,110.00'],
    ['totalWithTax', 'Invoice total with it', '116,485.00'],
    ['invoiceTotal', 'Invoice total, before any round off', '116,485.00'],
    ['roundOff', 'Round off', '0.00'],
    ['totalAmount', 'Total with the round off - "Balance Invoice"', '116,485.00'],
    ['receivedLabel', '"Received", or "Paid" on a bill', 'Received'],
    ['received', 'Received / paid so far', '0.00'],
    ['advanceReceived', 'The same - "Advance Received"', '0.00'],
    ['adjustment', 'Settled by adjustments', '0.00'],
    ['balance', 'What is still owed', '116,485.00'],
    ['netBalance', 'The same - "Net Balance"', '116,485.00'],
    ['totalInWords', 'Total in words with the currency', 'PKR One Hundred Sixteen Thousand Four Hundred Eighty Five only'],
    ['amountInWords', 'Total in words, no currency', 'One Hundred Sixteen Thousand Four Hundred Eighty Five only'],
  ] },
  { group: 'Sales Tax Invoice (VAT Tax Invoice) - the taxed charges only, in PKR', fields: [
    ['gstServiceCharges', 'Service Charges - the taxed charges before tax', '2,500.00'],
    ['gstRate', 'Sales Tax @ - the rate', '15 %'],
    ['gstTax', 'The sales tax', '375.00'],
    ['gstAdditionalTax', 'Additional Sales Tax (if any)', '0.00'],
    ['gstTotal', 'Total Value of Service inclusive of Tax', '2,875.00'],
    ['gstTotalInWords', 'That total in words', 'PKR Two Thousand Eight Hundred Seventy Five only'],
  ] },
  { group: 'Bank account', fields: [
    ['bankName', 'Bank', ''],
    ['bankBranch', 'Branch', ''],
    ['bankAccountTitle', 'Account title', ''],
    ['bankAccountNo', 'Account number', ''],
    ['bankSwift', 'Swift code', ''],
    ['bankIban', 'IBAN', ''],
  ] },
  { group: 'Printed', fields: [
    ['printedOn', 'Date and time of printing', '24/10/2026 16:38:21'],
    ['printedDate', 'Date of printing', '24-Oct-2026'],
    ['printedBy', 'Who printed it', 'Account'],
    ['signDisclaimer', 'The disclaimer for when the sign line is hidden (Configuration > Invoices)', ''],
  ] },
];

/** Lists - a table row (or rows) between {#name} and {/name}, once per item. */
export const LISTS = [
  { name: 'expenses', about: 'The charges without sales tax - all of them on an invoice with no taxed line. Numbered from 1.', fields: LINE_FIELDS },
  { name: 'serviceCharges', about: 'The taxed charges (customs) - "Clearance Service Charges". Numbered from 1.', fields: LINE_FIELDS },
  { name: 'lines', about: 'Every charge, expenses first, numbered straight through.', fields: LINE_FIELDS },
  { name: 'gstLines', about: 'The Sales Tax Invoice\'s lines: each taxed charge, in PKR. Numbered from 1.', fields: [
    ['sr', 'Line number', '1'],
    ['particular', 'The charge', 'SERVICES CHARGES'],
    ['description', 'Its Description/Remarks', '5X20'],
    ['amount', 'Value before tax', '2,500.00'],
    ['taxRate', 'Its tax rate', '15 %'],
    ['tax', 'Its tax', '375.00'],
    ['total', 'Value with the tax', '2,875.00'],
  ] },
  { name: 'containers', about: 'One per container.', fields: [['no', 'Container number', 'APZU3465269'], ['size', 'Size / type', '20GP']] },
  { name: 'bankLines', about: "The bank account's details, label and value.", fields: [['label', 'Bank Name, A/c # ...', 'A/c #'], ['value', 'Its value', '0123456789']] },
  { name: 'settlement', about: 'Received (Paid on a bill), Adjustment and Balance.', fields: [['label', 'Received / Adjustment / Balance', 'Received'], ['value', 'The amount', '0.00']] },
];

/** Conditions - what is between {#name} and {/name} prints only when it is true. */
export const CONDITIONS = [
  ['isCustoms', 'A customs clearance invoice'],
  ['isFreight', 'A freight (sea / air) invoice'],
  ['isReceivable', 'An invoice (receivable)'],
  ['isPayable', 'A bill (payable)'],
  ['isDraft', 'Not approved yet'],
  ['hasExpenses', 'It has charges without sales tax'],
  ['hasServiceCharges', 'It has taxed (service) charges - customs'],
  ['hasSalesTax', 'It has a taxed charge - what the Sales Tax Invoice prints'],
  ['hasRoundOff', 'It is rounded off'],
  ['hasNote', 'It has a note'],
  ['hasGstInvoiceNo', 'It has a GST invoice number'],
  ['showRef', 'Printing Options: Hide Ref not ticked'],
  ['showLogo', 'Printing Options: Hide Logo not ticked'],
  ['showBalance', 'Printing Options: Hide Balance not ticked'],
  ['showNote', 'Printing Options: Hide Note not ticked'],
  ['showSignLine', 'Printing Options: Hide Sign Line not ticked'],
  ['showPrintedBy', 'Printing Options: Hide Printed On / By not ticked'],
  ['showTaxColumn', 'Printing Options: Hide Tax Column not ticked'],
  ['showBankDetails', 'Printing Options: Hide Bank Details not ticked'],
];

/** The invoice's names - see functions/templateCatalogue. */
export const INVOICE_CATALOGUE = templateCatalogue({ fields: FIELDS, lists: LISTS, conditions: CONDITIONS });

/** The names in a template that are not an invoice's - "expenses > srNo". */
export const unknownTemplateNames = (tree) => INVOICE_CATALOGUE.unknownNames(tree);

export default invoiceTemplateFields;
