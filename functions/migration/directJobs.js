/**
 * Direct Job E/R - legacy GL_JobDirectExpRev and its charge lines into
 * Direct_Jobs / Direct_Job_Association, on a customs install.
 *
 * Money paid or received against clearing jobs OUTSIDE the job's own charge
 * sheet - cartage, lift on/off, labour - paid in cash, by bank, or adjusted
 * against a staff IOU. On CargoLinkers 1,741 entries and 23,457 lines over
 * 15,562 jobs; the legacy system keeps these off the job charges, so without
 * this stage every clearing job is missing them.
 *
 * NOTHING IS POSTED. Each entry's voucher came in with the ledger stage; the
 * lines are linked to that voucher, which is why this stage runs after it.
 * Imported entries keep their legacy number behind the company code -
 * CL-JER-132/27 - so they are told apart from Odyssey's own DE / DR entries.
 *
 * What is kept and what is skipped: functions/directJobMigrationPlan.js on
 * the server.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// Entries per page; each brings its own lines (about 14 each on CargoLinkers).
const PAGE = 300;

async function fetchPage(offset) {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getDirectExpRev`, {
      params: { offset, limit: PAGE },
    });
    if (!data || !Array.isArray(data.headers)) {
      throw new Error(
        `${LEGACY_API}/jobs/getDirectExpRev returned no headers array. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getDirectExpRev does not exist on this legacy server. It was added `
        + 'for this stage - restart the legacy server to pick it up. It lives on the customs '
        + 'legacy server (Climax-backup-server-CC), not the freight one.'
      );
    }
    if (!err?.response) {
      throw new Error(
        `Could not reach the legacy server at ${LEGACY_API}. Check it is running and that `
        + 'NEXT_PUBLIC_CLIMAX_LEGACY_URL points at it.'
      );
    }
    throw err;
  }
}

// The problem keys the server reports, in the order worth reading them, with
// what each means for the person running the migration.
const PROBLEMS = [
  ['voucherNotImported', 'entries whose voucher is not in Odyssey - run the Ledger stage first. Not imported'],
  ['accountMissing', 'entries whose cash/bank/IOU account is not in Odyssey. Not imported'],
  ['chargeMissing', 'entries with a charge the Charge Master stage did not bring in. Not imported'],
  ['unknownCode', 'entries with a type, mode or sub-type that has no mapping. Not imported'],
  ['badEntryNo', 'entries whose number cannot be made into an Odyssey entry number. Not imported'],
  ['duplicateInBatch', 'entries sharing a legacy number. Only the first was imported'],
  ['noVoucher', 'entries the legacy system never posted - no voucher, no ledger effect. Skipped'],
  ['noLines', 'entries with no lines - nothing to attach a job or voucher through. Skipped'],
  ['noAttachableLines', 'entries none of whose lines names a job Odyssey has. Skipped - the money is still in the books through the voucher'],
  ['linesWithoutJob', 'lines naming no job in the legacy data - left out (every Direct Job line must belong to a job); the amount is still in the books through the voucher'],
  ['jobNotImported', 'lines naming a clearing job Odyssey does not have - left out; run the Clearing Jobs stage first'],
  ['currencyCorrected', 'lines tagged a foreign currency at rate 1 with rupee amounts - imported as the entry currency'],
  ['paidToUnresolved', 'entries whose Paid To party has no ledger account - imported without it'],
];

function addUp(acc, r) {
  acc.created += r.created || 0;
  acc.createdLines += r.createdLines || 0;
  acc.alreadyImported += r.stats?.alreadyImported || 0;
  acc.amount += r.stats?.amount || 0;
  acc.leftOutAmount += r.stats?.leftOutAmount || 0;
  for (const [k, v] of Object.entries(r.problems || {})) {
    if (!acc.problems[k]) acc.problems[k] = { count: 0, sample: [] };
    acc.problems[k].count += v.count || 0;
    acc.problems[k].sample.push(...(v.sample || []));
  }
  return acc;
}

export async function migrateDirectJobs(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Direct Job E/R: money paid or received against clearing jobs outside their charge sheets.');

  const first = await fetchPage(0);
  const total = first.total || 0;
  if (!total) {
    report('Direct Job E/R: the legacy system has none.');
    return { planned: null, applied: null, verification: null, noop: true, reason: 'No direct job entries in the source.' };
  }
  report(`Direct Job E/R: ${total.toLocaleString()} entries to ${apply ? 'import' : 'check'}.`);

  const acc = { created: 0, createdLines: 0, alreadyImported: 0, amount: 0, leftOutAmount: 0, problems: {} };
  let done = 0;

  for (let offset = 0; offset < total; offset += PAGE) {
    const page = offset === 0 ? first : await fetchPage(offset);
    const { data: res } = await axiosClient.post(
      apply ? '/directJobMigration/apply' : '/directJobMigration/plan',
      { headers: page.headers, lines: page.lines || [], currencies: page.currencies || [] },
    );
    addUp(acc, res.result);

    done += page.headers.length;
    const pct = Math.round((Math.min(done, total) / total) * 100);
    onProgress?.({ done, total, percent: pct });
    report(`Direct Job E/R: ${Math.min(done, total).toLocaleString()} of ${total.toLocaleString()} (${pct}%)`);
    if (!page.headers.length) break;
  }

  report(
    `Direct Job E/R: ${apply ? 'created' : 'would create'} ${acc.created.toLocaleString()} entries`
    + (apply ? ` with ${acc.createdLines.toLocaleString()} lines` : '')
    + `, ${acc.alreadyImported.toLocaleString()} already imported, `
    + `${Math.round(acc.amount).toLocaleString()} in total.`
  );
  for (const [k, what] of PROBLEMS) {
    const p = acc.problems[k];
    if (!p || !p.count) continue;
    report(`Direct Job E/R: ${p.count.toLocaleString()} ${what}. e.g. ${p.sample.slice(0, 5).join(', ')}`);
  }

  if (!apply) {
    report('Direct Job E/R: dry run - nothing was written.');
    return { planned: acc, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Direct Job E/R: verifying...');
  const { data: verifyRes } = await axiosClient.get('/directJobMigration/verify');
  const v = verifyRes.result;
  report(
    `Direct Job E/R: ${v.entries.toLocaleString()} entries in the system (${v.migrated.toLocaleString()} `
    + `migrated), ${v.lines.toLocaleString()} lines, ${v.linesWithoutJob.toLocaleString()} attached to no job.`
  );
  if (acc.leftOutAmount) {
    report(
      `Direct Job E/R: ${Math.round(acc.leftOutAmount).toLocaleString()} on lines with no job was left out. `
      + 'It is still in the ledger through the vouchers; the entries it was on show that much less '
      + 'than their voucher, and appear below.'
    );
  }
  if (v.notMatchingVoucher) {
    report(
      `Direct Job E/R: ${v.notMatchingVoucher} migrated entries do not add up to the voucher `
      + 'they point at. Expected only for the entries with left-out lines above - any other is a fault. e.g. '
      + v.notMatchingVoucherSample.slice(0, 5).map((s) => `${s.entryNo} (${s.lines} vs ${s.voucher})`).join(', ')
    );
  }

  return {
    planned: acc,
    applied: acc,
    verification: v,
    noop: acc.created === 0,
    reason: acc.created === 0 ? 'Every direct job entry was already imported.' : null,
  };
}

/** Plan only - writes nothing. */
export const planDirectJobsOnly = (report, options = {}) =>
  migrateDirectJobs(report, { ...options, apply: false });
