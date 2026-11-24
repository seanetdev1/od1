// Duty and taxes on a goods declaration, as the screen computes them.
//
// A GD is assessed ITEM BY ITEM, and each item is assessed at RATES against
// the values those rates apply to. Nothing stores an amount; this file is the
// one place on the client where a rate becomes money.
//
// It MIRRORS functions/customsDuty.js on the backend, which is what the server
// reports - if the two ever disagree, the backend is right and this is the
// bug. That is also why the tests here check the same cases the backend's do,
// and why __tests__/customsDuty.test.js sweeps them against each other.
//
// ============================ READ THIS ============================
// THE CASCADE BELOW IS NOT YET VERIFIED AGAINST A REAL DECLARATION.
// Sales tax is charged on the value PLUS the duties already levied, and income
// tax on that total again. The base of each step is what separates a plausible
// figure from a correct one, and Climax's exact chain has not been confirmed.
// Correct it in the BACKEND file and mirror it here.
// ===================================================================

export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The heads charged as a RATE, in the order an assessment applies them, with
 * the base each is charged on.
 *
 *   'value'  the item's assessed customs value alone
 *   'duty'   that value plus every duty levied above this line
 *   'tax'    the duty subtotal plus the sales taxes
 *
 * Order is load-bearing: a head can only be charged on what the heads above it
 * have already added. `short` is the column heading on the grid, where the
 * full label will not fit.
 */
export const RATE_HEADS = [
  { field: 'customDutyPerc',            label: 'Custom Duty',            short: 'CD',   base: 'value' },
  { field: 'additionalCustomDutyPerc',  label: 'Additional Custom Duty', short: 'ACD',  base: 'value' },
  { field: 'regulatoryDutyPerc',        label: 'Regulatory Duty',        short: 'RD',   base: 'value' },
  { field: 'excisePerc',                label: 'Excise',                 short: 'EXC',  base: 'value' },
  { field: 'federalExcisePerc',         label: 'Federal Excise Duty',    short: 'FED',  base: 'duty'  },
  { field: 'salesTaxPerc',              label: 'Sales Tax',              short: 'ST',   base: 'duty'  },
  { field: 'additionalSalesTaxPerc',    label: 'Additional Sales Tax',   short: 'AST',  base: 'duty'  },
  { field: 'salesTaxOnServicesPerc',    label: 'Sales Tax on Services',  short: 'SIT',  base: 'duty'  },
  { field: 'incomeTaxPerc',             label: 'Income Tax (WHT)',       short: 'IT',   base: 'tax'   },
  { field: 'whSurchargePerc',           label: 'WH Surcharge',           short: 'WHS',  base: 'tax'   },
];

/** The heads entered as a flat AMOUNT rather than a rate. */
export const AMOUNT_HEADS = [
  { field: 'deliveryOrder',        label: 'Delivery Order' },
  { field: 'doLoloCharges',        label: 'LOLO Charges' },
  { field: 'doInsurance',          label: 'DO Insurance' },
  { field: 'doEndorsementCharges', label: 'Endorsement Charges' },
  { field: 'doThc',                label: 'Terminal Handling' },
  { field: 'doBankCharges',        label: 'Bank Charges' },
  { field: 'doBlSplitting',        label: 'B/L Splitting' },
  { field: 'doAgencyCharges',      label: 'Agency Charges' },
  { field: 'doLclCharges',         label: 'LCL Charges' },
  { field: 'eto',                  label: 'ETO' },
  { field: 'otherSecurity',        label: 'Security' },
  { field: 'otherWharfage',        label: 'Wharfage' },
  { field: 'stampDuty',            label: 'Stamp Duty' },
  { field: 'fine',                 label: 'Fine' },
  { field: 'fineSection82',        label: 'Fine (Section 82)' },
  { field: 'fineInvoiceNotFound',  label: 'Fine (Invoice Not Found)' },
  { field: 'detention',            label: 'Detention' },
  { field: 'demurrage',            label: 'Demurrage' },
];

/** The value fields a line carries, for the expanded panel on the grid. */
export const VALUE_FIELDS = [
  { field: 'assessedValue',  label: 'Assessed Value' },
  { field: 'fobValue',       label: 'FOB' },
  { field: 'cnfValue',       label: 'C&F' },
  { field: 'freight',        label: 'Freight' },
  { field: 'insuranceValue', label: 'Insurance' },
  { field: 'exchangeRate',   label: 'Ex. Rate' },
  { field: 'landingInsPerc', label: 'Landing %' },
];

/**
 * Assess ONE duty line: every head, its base, and what it comes to.
 *
 * The base is reported alongside the amount because that second number is what
 * makes the cascade checkable against a declaration instead of taken on trust.
 * A rate of 0 is dropped - a GD levies three or four of the ten, and printing
 * the rest as 0.00 buries the ones that matter.
 */
export const assessLine = (line) => {
  const value = num(line?.assessedValue);

  const heads = [];
  let dutySubtotal = value;
  let taxSubtotal = 0;

  for (const head of RATE_HEADS) {
    const perc = num(line?.[head.field]);

    // Read BEFORE this head is added, advanced after - so a head is never
    // charged on itself.
    let base;
    if (head.base === 'value') base = value;
    else if (head.base === 'duty') base = dutySubtotal;
    else {
      if (!taxSubtotal) taxSubtotal = dutySubtotal;
      base = taxSubtotal;
    }

    const amount = base * (perc / 100);
    if (head.base === 'value' || head.base === 'duty') dutySubtotal += amount;

    if (perc !== 0) {
      heads.push({ field: head.field, label: head.label, perc, base, amount, kind: 'rate' });
    }
  }

  for (const head of AMOUNT_HEADS) {
    const amount = num(line?.[head.field]);
    if (amount !== 0) {
      heads.push({ field: head.field, label: head.label, perc: null, base: null, amount, kind: 'amount' });
    }
  }

  return {
    assessedValue: value,
    heads,
    total: heads.reduce((t, h) => t + h.amount, 0),
  };
};

/** What one duty line comes to, all heads together. */
export const lineTotal = (line) => assessLine(line).total;

/** The duty lines off a job, however the caller happens to hold it. */
export const dutyLinesOf = (job) => {
  if (Array.isArray(job)) return job;
  return job?.Customs_Duties || job?.dutyLines || [];
};

/** Total duty on a declaration: every line, every head. */
export const totalDuty = (job) =>
  dutyLinesOf(job).reduce((t, l) => t + lineTotal(l), 0);

/**
 * The breakdown for a whole declaration: each head, summed across its lines.
 *
 * Summed rather than listed per line, because "what is the sales tax on this
 * GD" is the question people ask. A rate that differs between lines is
 * reported as null rather than as one line's rate standing for all.
 */
export const dutyBreakdown = (job) => {
  const totals = new Map();
  for (const line of dutyLinesOf(job)) {
    for (const head of assessLine(line).heads) {
      const prev = totals.get(head.field);
      if (prev) {
        prev.amount += head.amount;
        prev.base += head.base ?? 0;
        if (prev.perc !== head.perc) prev.perc = null;
      } else {
        totals.set(head.field, { ...head });
      }
    }
  }
  const order = [...RATE_HEADS, ...AMOUNT_HEADS].map((h) => h.field);
  return [...totals.values()].sort(
    (a, b) => order.indexOf(a.field) - order.indexOf(b.field)
  );
};

/**
 * Duty the AGENT paid and is therefore owed back.
 *
 * Anything other than 'Agent' - including an unanswered field - counts as not
 * reimbursable, because billing a client for money they already paid is the
 * worse of the two mistakes.
 */
export const reimbursableDuty = (job) =>
  String(job?.dutyPaidBy || '').trim().toLowerCase() === 'agent' ? totalDuty(job) : 0;

/**
 * Effective duty rate against the customs value, as a percentage.
 *
 * Measured against the LINES' assessed values summed, not the job header's -
 * the lines are what customs actually assessed. Returns null rather than 0
 * when there is nothing to measure against: a 0% badge on an unassessed GD
 * reads as a duty-free consignment.
 */
export const effectiveDutyRate = (job) => {
  const lines = dutyLinesOf(job);
  const value = lines.reduce((t, l) => t + num(l?.assessedValue), 0) || num(job?.assessedValue);
  if (!value) return null;
  return (totalDuty(job) / value) * 100;
};

/** Money, the way every figure on these screens is written. */
export const money = (n) =>
  num(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
