/**
 * The aviation Sales Report - one row per AWB, buying against selling.
 *
 * Shaped after the sales department's workbook (a sheet per airline: date, AWB,
 * sector, the two rates, what we owe the carrier, what we bill the agent, and
 * the margin between them). The flight summary answers "what flew"; this
 * answers "what did we make on it".
 *
 * ONE ROW PER AWB, not per flight. A flight carries many agents' cargo bought
 * and sold at different rates, so a flight-level margin is an average that
 * matches no deal anybody actually struck. The row people check is the AWB.
 *
 * ONLY APPROVED AWBs. Approval is what raises the air-freight charge on both
 * sides (see Aviation_Consignment.awbApproved), so an unapproved AWB has a
 * selling rate typed on it and no charges behind it - it would report a
 * hundred per cent margin. Direct consignments are excluded outright: someone
 * else's load on someone else's air waybill is not ours to sell.
 *
 * THE MONEY COMES FROM THE CHARGES, NOT FROM THE RATES.
 *
 * The rate columns are what was agreed per kilo; the Payable and Receivable
 * columns are the sum of the charge lines actually raised. They are NOT the
 * same arithmetic, deliberately - an AWB carries more than air freight, and
 * pricing the report off `chargeable x rate` would silently drop every other
 * charge on it and disagree with the invoice. So:
 *
 *   payable     EVERY payable charge line on the AWB, in local currency.
 *   receivable  EVERY receivable line, the same way.
 *   profit      the difference. It ties to the ledger because both sides are
 *               sums of the same rows the invoice is built from.
 *
 * THE GTC+SCAN AND ER COLUMNS ARE BREAKOUTS, NEVER SUBTOTALS. They name the
 * non-freight charge codes the office wants to see separately (configured in
 * AppSetting - see the route). Nothing is subtracted from Payable to make
 * them, and a code appearing in neither list is still in Payable. That is the
 * point: however the two lists are configured - or misconfigured - the report
 * cannot stop reconciling with the invoice.
 *
 * THE SETTLEMENT COLUMNS ARE APPORTIONED, and blank until the bill is paid.
 *
 * A bill covers several AWBs and is settled as a whole, so the remittance and
 * the exchange gain on it are split across the AWBs on it in proportion to
 * what each contributed to the bill - the same rule functions/aviationJobPL
 * uses to share an invoice across flight legs. Where a bill is unsettled the
 * three columns are NULL rather than zero: "not paid yet" and "paid, no gain"
 * are different statements and a zero makes them look alike.
 *
 * Kept free of model imports so the arithmetic can be tested without a
 * database. The route hands it plain rows.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Two decimals, applied once at the end. These are sums of per-line arithmetic
// and carry float noise a report would otherwise print.
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Charge_Head.type is misspelled in the database and has been since the
// freight module was written. Matched as stored - see
// functions/chargeHeadMigrationPlan, which says the same thing.
const PAYABLE = 'Payble';
const RECEIVABLE = 'Recievable';

/** Charge codes as a Set of strings, however they were configured. */
const codeSet = (v) => new Set(
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean),
);

/**
 * What to call the foreign-currency column.
 *
 * ONE NAME OR NONE, the same discipline the flight summary applies to its GAM
 * heading: a column heading is a single string for the whole table, so it can
 * only name a currency when every row agrees on one. A run spanning two
 * currencies is headed 'FCY' rather than having one of them picked and the
 * other quietly mislabelled.
 */
function currencyLabelFor(consignments) {
  const seen = new Set();
  for (const c of consignments || []) {
    for (const ch of c.charges || []) {
      if (ch.type !== PAYABLE) continue;
      const cur = String(ch.currency || '').trim().toUpperCase();
      // A line carrying no ex-rate is already in local currency and says
      // nothing about what the AWB was bought in.
      if (cur && num(ch.exRate) !== 1) seen.add(cur);
    }
  }
  return seen.size === 1 ? [...seen][0] : 'FCY';
}

/**
 * What to head the buying-rate column.
 *
 * The workbook this is modelled on says "Payable to UX" - the airline's own
 * code, because a sheet covers one carrier. Odyssey's does not have to, so the
 * heading follows the same ONE NAME OR NONE rule as currencyLabelFor above:
 * the airline when every AWB on the report flew the same one, and the generic
 * word when the run spans several. Never one of several picked at random,
 * which would head another airline's cost with this one's name.
 */
function carrierLabelFor(consignments) {
  const names = new Set();
  for (const c of consignments || []) {
    const name = String(c.airline || '').trim();
    if (name) names.add(name);
  }
  return names.size === 1 ? [...names][0] : 'Carrier';
}

/**
 * The settlement of one AWB's share of the bills its payable sits on.
 *
 * `bills` maps an invoice id to that bill's whole-of-invoice figures. The share
 * is this AWB's payable on that bill over the bill's total payable, so it is 1
 * for the ordinary case of a bill covering a single AWB.
 *
 * THE REMIT RATE IS WEIGHTED, not averaged. Two part-payments at different
 * rates settle a bill at neither of them; weighting by the amount each carried
 * is the rate the money actually went out at. A single payment - which is
 * nearly always - weights to exactly itself.
 */
function settlementOf(payableByInvoice, bills) {
  let amount = 0;
  let gainLoss = 0;
  let rateWeight = 0;
  let settled = false;

  for (const [invoiceId, mine] of payableByInvoice) {
    const bill = bills[invoiceId];
    if (!bill) continue;
    const transactions = bill.transactions || [];
    if (!transactions.length) continue;

    // A zero-value bill cannot be apportioned; give the whole of nothing to
    // each AWB rather than dividing by zero.
    const share = num(bill.total) ? mine / num(bill.total) : 1;

    for (const t of transactions) {
      settled = true;
      const paid = num(t.amount) * share;
      amount += paid;
      gainLoss += num(t.gainLoss) * share;
      const rate = num(t.settleExRate);
      if (rate) rateWeight += rate * paid;
    }
  }

  // Never paid: the three columns have no answer, and NULL says so where a
  // zero would claim the bill settled for nothing.
  if (!settled) return { remitAmount: null, remitExRate: null, exGainLoss: null };

  return {
    remitAmount: round(amount),
    remitExRate: amount ? round(rateWeight / amount) : null,
    exGainLoss: round(gainLoss),
  };
}

/** One AWB, as a row of the report. */
function salesRow(c, opts = {}) {
  const bills = opts.bills || {};
  const gtc = codeSet(opts.gtcCodes);
  const er = codeSet(opts.erCodes);

  let payable = 0;
  let receivable = 0;
  let dollarPayable = 0;
  let gtcScan = 0;
  let erAmount = 0;
  let erPayable = 0;

  // invoiceId -> this AWB's payable on that bill, for apportioning the
  // settlement below. Charges not yet invoiced have no bill to be settled by.
  const payableByInvoice = new Map();

  for (const ch of c.charges || []) {
    const local = num(ch.localAmount);
    const code = String(ch.code || '').trim();

    if (ch.type === RECEIVABLE) {
      receivable += local;
      continue;
    }
    if (ch.type !== PAYABLE) continue;

    payable += local;

    // The foreign-currency face of the payable - the figure the carrier is
    // actually remitted. Converted per line at the line's own ex-rate rather
    // than dividing the total by one of them, so an AWB whose charges were
    // struck on different days still totals correctly.
    const rate = num(ch.exRate);
    const foreign = rate ? local / rate : local;
    if (rate) dollarPayable += foreign;

    if (gtc.has(code)) gtcScan += foreign;
    if (er.has(code)) {
      erAmount += foreign;
      erPayable += local;
    }

    if (ch.invoiceId !== null && ch.invoiceId !== undefined && ch.invoiceId !== '') {
      const key = ch.invoiceId;
      payableByInvoice.set(key, (payableByInvoice.get(key) || 0) + local);
    }
  }

  return {
    id: c.id,
    jobNo: c.jobNo || '',
    flightNo: c.flightNo || '',
    airline: c.airline || '',
    date: c.date || '',
    awb: c.awb || '',
    origin: c.origin || '',
    destination: c.destination || '',
    grossWeight: round(num(c.grossWeight)),
    chargeableWeight: round(num(c.chargeableWeight)),

    // The agreed rates, as typed on the AWB. Null rather than zero when never
    // set - an AWB priced at nothing and an AWB not yet priced are different.
    buyingRate: c.buyingRate === null || c.buyingRate === undefined ? null : num(c.buyingRate),
    sellingRate: c.sellingRate === null || c.sellingRate === undefined ? null : num(c.sellingRate),
    exRate: num(c.buyingExRate) || null,

    gtcScan: round(gtcScan),
    er: round(erAmount),
    agent: c.agent || '',

    payable: round(payable),
    erPayable: round(erPayable),
    receivable: round(receivable),
    profit: round(receivable - payable),
    dollarPayable: round(dollarPayable),

    ...settlementOf(payableByInvoice, bills),
  };
}

const ZERO_TOTALS = () => ({
  awbs: 0,
  grossWeight: 0,
  chargeableWeight: 0,
  gtcScan: 0,
  er: 0,
  payable: 0,
  erPayable: 0,
  receivable: 0,
  profit: 0,
  dollarPayable: 0,
  remitAmount: 0,
  exGainLoss: 0,
  // How many rows the settlement columns actually speak for. Without it the
  // remittance total looks like it covers every AWB on the report.
  settled: 0,
});

function addRow(t, r) {
  t.awbs += 1;
  t.grossWeight += r.grossWeight;
  t.chargeableWeight += r.chargeableWeight;
  t.gtcScan += r.gtcScan;
  t.er += r.er;
  t.payable += r.payable;
  t.erPayable += r.erPayable;
  t.receivable += r.receivable;
  t.profit += r.profit;
  t.dollarPayable += r.dollarPayable;
  if (r.remitAmount !== null) {
    t.settled += 1;
    t.remitAmount += r.remitAmount;
    t.exGainLoss += num(r.exGainLoss);
  }
  return t;
}

const SUMMED = ['grossWeight', 'chargeableWeight', 'gtcScan', 'er', 'payable',
  'erPayable', 'receivable', 'profit', 'dollarPayable', 'remitAmount', 'exGainLoss'];

function roundTotals(t) {
  for (const k of SUMMED) t[k] = round(t[k]);
  // The margin the period actually ran at. Computed from the totals rather
  // than by averaging the rows' own percentages, which would weight a 30 kg
  // AWB the same as a 7,000 kg one.
  t.marginPerc = t.receivable ? round((t.profit / t.receivable) * 100) : 0;
  return t;
}

/**
 * Build the report from the consignments the route selected.
 *
 * `labels.currency` is what the foreign-currency column should be headed - see
 * currencyLabelFor. Returned rather than left to the screen, so the report and
 * anything printed or exported from it agree about what that column is called.
 */
function buildSalesReport(consignments, opts = {}) {
  const list = Array.isArray(consignments) ? consignments : [];
  const rows = list.map((c) => salesRow(c, opts));

  const totals = ZERO_TOTALS();
  for (const r of rows) addRow(totals, r);

  // Rows read oldest first, then by AWB, so the same period always comes out
  // in the same order and two runs can be compared line by line.
  rows.sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
    || String(a.awb).localeCompare(String(b.awb)));

  return {
    rows,
    totals: roundTotals(totals),
    labels: { currency: currencyLabelFor(list), carrier: carrierLabelFor(list) },
  };
}

module.exports = {
  buildSalesReport, salesRow, settlementOf, currencyLabelFor, carrierLabelFor, codeSet,
  PAYABLE, RECEIVABLE,
};
