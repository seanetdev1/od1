/**
 * ONE OF EACH CHARGE PER JOB - an install switch, Configuration > Direct Job
 * (AppSetting `uniqueJobCharges`, asked 2026-11-17).
 *
 * On, a charge goes on a job once per side:
 *
 *   - DIRECT JOB E/R: once as an expense and once as a revenue, counting every
 *     entry against the job - a second WEBOC TOKEN expense on the same job is
 *     refused, whether it is on this entry or another one.
 *   - THE JOB'S CHARGE SHEET: once on Payable and once on Receivable.
 *
 * The two are not checked against each other (the user's choice): a Direct
 * Job expense does not stop the same charge on the sheet's Payable.
 *
 * OFF UNLESS TURNED ON, because repeats are ordinary on some installs:
 * CargoLinkers' copy (2026-10-08) has 1,570 job/charge/side repeats in Direct
 * Job lines - CARTAGE 708, LABOUR 409, OTHER CHARGES 179 - and 1,550 on the
 * sheet (STORAGE, OTHER CHARGES, CARTAGE). A rule for every install would have
 * refused their second cartage payment.
 *
 * WHAT IS ALREADY THERE MAY STAY (my call). Only a save that ADDS a repeat is
 * refused. An entry or sheet that already held one - migrated, or saved before
 * the switch went on - can still be opened, corrected and saved; otherwise
 * turning the switch on would lock every such file until somebody deleted a
 * line that may be right. Counted per pair: a sheet with two CARTAGE lines may
 * keep two, not grow a third.
 *
 * The rules are pure - no database - and unit tested. readUniqueJobCharges
 * takes the models.
 */

const KEY = 'uniqueJobCharges';

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

// A charge as an id string: Charge_Head.charge and Direct_Job_Association
// .Charge_Name are STRING columns holding the master's integer id (see
// functions/chargeIds), and the screens send it as a number.
const chargeKey = (v) => {
  const s = str(v);
  if (!s) return '';
  const n = Number(s);
  return Number.isInteger(n) ? String(n) : s;
};
const jobKey = (v) => {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

const countBy = (items, keyOf) => {
  const out = new Map();
  for (const it of items || []) {
    const k = keyOf(it);
    if (k) out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
};

/**
 * THE JOB'S CHARGE SHEET.
 *
 * @param after   the sheet's lines as they will stand once saved: { type, charge }
 * @param before  the lines on the job now, same shape
 * @returns [{ type, charge, count }] - a side and charge the save would hold
 *          more often than once and more often than it does now
 */
function sheetRepeats(after, before = []) {
  const keyOf = (c) => {
    const charge = chargeKey(c?.charge);
    return charge ? `${str(c?.type)}|${charge}` : '';
  };
  const now = countBy(before, keyOf);
  const out = [];
  for (const [k, count] of countBy(after, keyOf)) {
    if (count > Math.max(1, now.get(k) || 0)) {
      const [type, charge] = k.split('|');
      out.push({ type, charge, count });
    }
  }
  return out;
}

/**
 * DIRECT JOB E/R - one entry's lines, all of one side (the entry's Type).
 *
 * @param lines   the lines as sent: { jobId, charge, jobNo? }
 * @param before  this entry's own lines as saved now, IF the entry was saved
 *                on the same side (a change of side starts from nothing)
 * @param others  the lines of OTHER entries of the same side on these jobs:
 *                { jobId, charge, entryNo }
 * @returns [{ jobId, jobNo, charge, count }]        - on this entry more than once
 *          [{ jobId, jobNo, charge, entries: [...] }] - already on another entry
 */
function directJobRepeats({ lines = [], before = [], others = [] } = {}) {
  const keyOf = (l) => {
    const job = jobKey(l?.jobId);
    const charge = chargeKey(l?.charge);
    return job && charge ? `${job}|${charge}` : '';
  };
  const had = countBy(before, keyOf);
  const elsewhere = new Map();
  for (const o of others || []) {
    const k = keyOf(o);
    if (!k) continue;
    if (!elsewhere.has(k)) elsewhere.set(k, []);
    const no = str(o.entryNo);
    if (no && !elsewhere.get(k).includes(no)) elsewhere.get(k).push(no);
  }
  const jobNoOf = new Map();
  for (const l of lines || []) {
    const k = keyOf(l);
    if (k && !jobNoOf.has(k) && str(l.jobNo)) jobNoOf.set(k, str(l.jobNo));
  }

  const out = [];
  for (const [k, count] of countBy(lines, keyOf)) {
    const [jobId, charge] = k.split('|');
    const jobNo = jobNoOf.get(k) || '';
    const before = had.get(k) || 0;
    if (count > Math.max(1, before)) out.push({ jobId, jobNo, charge, count });
    else if (!before && elsewhere.has(k)) out.push({ jobId, jobNo, charge, entries: elsewhere.get(k) });
  }
  return out;
}

const SIDE = { Payble: 'Payable', Recievable: 'Receivable', expense: 'expense', revenue: 'revenue' };
const MAX_SAID = 5;

const listed = (parts) => (parts.length > MAX_SAID
  ? `${parts.slice(0, MAX_SAID).join(' ')} And ${parts.length - MAX_SAID} more.`
  : parts.join(' '));

/** What a refused sheet save says. `names`: charge id -> name. */
function sheetRepeatsMessage(repeats, names = {}) {
  const parts = repeats.map((r) => `${names[r.charge] || `Charge #${r.charge}`} is on the ${SIDE[r.type] || r.type} side ${r.count} times.`);
  return `A charge can be on a job once per side (Configuration > Direct Job). ${listed(parts)}`;
}

/** What a refused Direct Job save says. */
function directJobRepeatsMessage(repeats, type, names = {}) {
  const side = SIDE[type] || 'expense';
  const parts = repeats.map((r) => {
    const charge = names[r.charge] || `Charge #${r.charge}`;
    const job = r.jobNo || `job #${r.jobId}`;
    return r.entries
      ? `${charge} is already on ${job} as ${side === 'expense' ? 'an' : 'a'} ${side}, in ${r.entries.join(', ')}.`
      : `${charge} is on ${job} ${r.count} times in this entry.`;
  });
  return `A charge can be on a job once as an expense and once as a revenue (Configuration > Direct Job). ${listed(parts)}`;
}

/** Is the switch on? Off unless an admin turned it on. */
async function readUniqueJobCharges(db) {
  const row = await db.AppSetting.findOne({ where: { key: KEY } });
  return row?.value === 'true';
}

module.exports = {
  KEY, chargeKey, sheetRepeats, directJobRepeats,
  sheetRepeatsMessage, directJobRepeatsMessage, readUniqueJobCharges,
};
