/**
 * Duty and taxes on a goods declaration.
 *
 * A GD is assessed ITEM BY ITEM, and each item is assessed at RATES against
 * the values those rates apply to - which is what Customs_Duty stores, and
 * what the legacy Log_DutyCalculation stores. No amount is held anywhere; this
 * file is the single place a rate becomes money.
 *
 * Lives here rather than inside the route so it can be tested without a
 * database - the arithmetic is the part worth checking, and standing up
 * Sequelize to do it would mean it never got checked.
 *
 * The frontend mirrors these rules in functions/customsDuty.js so the screen
 * can show a total before it is saved. THIS is what the server reports; if the
 * two ever disagree, this one is right.
 *
 * ============================ READ THIS ============================
 * THE CASCADE BELOW IS NOT YET VERIFIED AGAINST A REAL DECLARATION.
 *
 * Sales tax is not charged on the customs value - it is charged on the value
 * PLUS the duties already levied, and income tax on that total again. The
 * order and the base of each step is what makes the difference between a
 * plausible figure and a correct one, and Climax's exact chain has not been
 * confirmed.
 *
 * What is written here is the ordinary Pakistan/WeBOC chain. It is in ONE
 * place, and dutyBreakdown() reports each head's base alongside its amount, so
 * checking it against a GD is reading two columns rather than reverse-
 * engineering a formula. Correct it here and every screen, report and total
 * moves with it.
 * ===================================================================
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The heads that are charged as a RATE, in the order an assessment applies
 * them, with the base each one is charged on.
 *
 * `base` names the running subtotal a head is charged against:
 *   'value'  the item's assessed customs value alone
 *   'duty'   that value plus every duty levied above this line
 *   'tax'    the duty subtotal plus the sales taxes
 *
 * Order matters and is load-bearing: each entry can only be charged on what
 * the entries above it have already added.
 */
const RATE_HEADS = [
  { field: 'customDutyPerc',           label: 'Custom Duty',            base: 'value' },
  { field: 'additionalCustomDutyPerc', label: 'Additional Custom Duty', base: 'value' },
  { field: 'regulatoryDutyPerc',       label: 'Regulatory Duty',        base: 'value' },
  { field: 'excisePerc',               label: 'Excise',                 base: 'value' },
  { field: 'federalExcisePerc',        label: 'Federal Excise Duty',    base: 'duty'  },
  { field: 'salesTaxPerc',             label: 'Sales Tax',              base: 'duty'  },
  { field: 'additionalSalesTaxPerc',   label: 'Additional Sales Tax',   base: 'duty'  },
  { field: 'salesTaxOnServicesPerc',   label: 'Sales Tax on Services',  base: 'duty'  },
  { field: 'incomeTaxPerc',            label: 'Income Tax (WHT)',       base: 'tax'   },
  { field: 'whSurchargePerc',          label: 'WH Surcharge',           base: 'tax'   },
];

/**
 * The heads entered as a flat AMOUNT rather than a rate.
 *
 * Terminal and delivery-order charges, penalties, and the two time-based ones.
 * They are duty-side figures the client is answerable for, which is why they
 * are here and not among the agent's own Charge_Heads: those are what the
 * agent bills, these are what customs and the terminal charged.
 */
const AMOUNT_HEADS = [
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

/**
 * Assess ONE duty line: every head, its base, and what it comes to.
 *
 * Returns the heads that actually carry a figure, each with the base it was
 * charged on - that second number is what makes the cascade checkable against
 * a declaration instead of taken on trust.
 *
 * A rate of 0 is DROPPED, the same way the old breakdown dropped zero amounts:
 * a GD levies three or four of the ten, and printing the rest as 0.00 buries
 * the ones that matter. A rate that is present but zero is genuinely "not
 * charged", not "charged at nothing".
 */
const assessLine = (line) => {
  const value = num(line?.assessedValue);

  const heads = [];
  let dutySubtotal = value;   // value + duties levied so far
  let taxSubtotal = 0;        // filled once the duty subtotal is final

  for (const head of RATE_HEADS) {
    const perc = num(line?.[head.field]);

    // The base is read BEFORE this head is added, and the running subtotal is
    // advanced after - so a head is never charged on itself.
    let base;
    if (head.base === 'value') base = value;
    else if (head.base === 'duty') base = dutySubtotal;
    else {
      // First head charged on the tax base: freeze it now that every duty and
      // sales tax above has been added.
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
const lineTotal = (line) => assessLine(line).total;

/**
 * Total duty on a declaration: every line, every head.
 *
 * Takes the job's duty lines - Customs_Duties as the include returns them, or
 * a plain array. A job with no lines assessed comes to 0, which is the honest
 * answer: nothing has been assessed yet.
 */
const totalDuty = (job) => dutyLinesOf(job).reduce((t, l) => t + lineTotal(l), 0);

/** The duty lines off a job, however the caller happens to hold it. */
const dutyLinesOf = (job) => {
  if (Array.isArray(job)) return job;
  return job?.Customs_Duties || job?.dutyLines || [];
};

/**
 * The breakdown for a whole declaration: each head, summed across its lines.
 *
 * Summed rather than listed per line, because "what is the sales tax on this
 * GD" is the question people ask; the per-line detail is on the line. Order
 * follows RATE_HEADS then AMOUNT_HEADS, so a breakdown always reads in
 * assessment order rather than in whatever order the lines happened to fill.
 */
const dutyBreakdown = (job) => {
  const totals = new Map();
  for (const line of dutyLinesOf(job)) {
    for (const head of assessLine(line).heads) {
      const prev = totals.get(head.field);
      if (prev) {
        prev.amount += head.amount;
        prev.base += head.base ?? 0;
        // Rates that differ between lines cannot be summed into one number.
        // Reported as null rather than as one line's rate standing for all.
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
 * The distinction the accounts department actually cares about: duty the agent
 * paid out of its own account is a reimbursable that has to reach the invoice,
 * duty the client paid direct is not the agent's money and must never be
 * billed. Anything other than 'Agent' - including an unanswered field - counts
 * as not reimbursable, because billing a client for money they already paid is
 * the worse of the two mistakes.
 */
const reimbursableDuty = (job) =>
  String(job?.dutyPaidBy || '').trim().toLowerCase() === 'agent' ? totalDuty(job) : 0;

/**
 * Effective duty rate against the customs value, as a percentage.
 *
 * Measured against the duty lines' own assessed values summed, NOT the job
 * header's assessedValue: the lines are what customs actually assessed, and
 * they are allowed to disagree with what the file says. Falls back to the
 * header only when no line carries a value.
 *
 * Returns null rather than 0 when there is nothing to measure against - "no
 * answer" and "0%" are different things, and a 0% badge on an unassessed GD
 * reads as a duty-free consignment.
 */
const effectiveDutyRate = (job) => {
  const lines = dutyLinesOf(job);
  const value = lines.reduce((t, l) => t + num(l?.assessedValue), 0) || num(job?.assessedValue);
  if (!value) return null;
  return (totalDuty(job) / value) * 100;
};

module.exports = {
  RATE_HEADS,
  AMOUNT_HEADS,
  assessLine,
  lineTotal,
  dutyLinesOf,
  totalDuty,
  dutyBreakdown,
  reimbursableDuty,
  effectiveDutyRate,
  num,
};
