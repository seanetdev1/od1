/**
 * The lines of a Direct Job E/R as the screen keeps them: always a blank one
 * at the bottom to type into, and only the filled ones saved (asked
 * 2026-11-13).
 *
 * WHAT COUNTS AS A LINE. Something somebody typed or picked: a job, a charge,
 * a file or size, a figure, a tax, a description. NOT the defaults every line
 * starts with - currency, basis, rate group and exchange rate - which a charge
 * fills in by itself. A line holding only those is the blank one at the bottom
 * and is never sent: the server would have refused it (no charge) or saved a
 * line of nothing.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v) => String(v ?? '').trim();

/** A new, empty line - what Add + and the bottom row start as. */
export const blankLine = () => ({
  id: 0,
  JobId: 0,
  JobNumber: '',
  Charge: '',
  FileNumber: '',
  Basis: '',
  Currency: 'PKR',
  RateGroup: 'None',
  SizeType: '',
  Quantity: 0.0,
  Rate: 0.0,
  Amount: 0.0,
  Discount: 0.0,
  NetAmount: 0.0,
  TaxApply: false,
  TaxShare: 0.0,
  TaxAmount: 0.0,
  VATCategory: '',
  NetIncTaxAmount: 0.0,
  ExRate: 1.0,
  LocalAmount: 0.0,
  Description: '',
});

/** Has anything been entered on this line? See above for what counts. */
export const lineHasData = (line) => {
  if (!line) return false;
  return Boolean(
    text(line.JobNumber)
    || num(line.JobId)
    || text(line.Charge)
    || text(line.FileNumber)
    || text(line.SizeType)
    || num(line.Quantity)
    || num(line.Rate)
    || num(line.Discount)
    || num(line.TaxAmount)
    || line.TaxApply
    || text(line.VATCategory)
    || text(line.Description)
  );
};

/** The lines a Save sends: the filled ones, in their order. */
export const linesToSave = (lines) => (lines || []).filter(lineHasData);

/** A line's job, as the job list gives it ({ id, jobNo, fileNo }). */
export const jobFields = (job) => ({
  JobId: job?.id ?? 0,
  JobNumber: String(job?.jobNo ?? ''),
  // The file number the job list sends - on customs, the job's S/R Page #.
  FileNumber: String(job?.fileNo ?? ''),
});

// The most lines one job can be given at once from the job list, and the most
// one pick can add - a few hundred rows of inputs is where the table drags.
export const MAX_LINES_PER_JOB = 50;
export const MAX_LINES_AT_ONCE = 300;

/** The lines-per-job counter's value as a whole number in range. */
export const linesPerJob = (n) => {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, MAX_LINES_PER_JOB);
};

/**
 * SEVERAL JOBS AT ONCE, from the job list's ticks (asked 2026-11-17): `perJob`
 * lines for each job, in the order given, with only the job filled in - the
 * charge and figures are typed afterwards.
 *
 * The line the list was opened from takes the first job, keeping whatever
 * else is on it, as picking one job always did; the rest go in right after it,
 * so they land where the user was rather than at the bottom.
 *
 * @returns a new array; `lines` is not changed
 */
export const linesForJobs = (lines, index, jobs, perJob = 1) => {
  const list = [...(lines || [])];
  const count = linesPerJob(perJob);
  const made = [];
  for (const job of jobs || []) {
    if (!job) continue;
    for (let k = 0; k < count; k += 1) made.push(jobFields(job));
  }
  if (!made.length) return list;

  const first = made.shift();
  const at = Number.isInteger(index) && index >= 0 && index < list.length ? index : list.length;
  if (at < list.length) list[at] = { ...list[at], ...first };
  else list.push({ ...blankLine(), ...first });
  list.splice(at + 1, 0, ...made.map((f) => ({ ...blankLine(), ...f })));
  return list;
};

/**
 * The lines with a blank one at the bottom, or null when they already end in
 * one. Multiple-job entries only - a single-job entry is one line.
 */
export const withBlankLast = (lines) => {
  const list = lines || [];
  if (list.length && !lineHasData(list[list.length - 1])) return null;
  return [...list, blankLine()];
};
