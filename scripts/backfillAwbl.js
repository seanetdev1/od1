/*
 * Registers the MAWB numbers typed onto air jobs in the AWB stock, and writes
 * the list of the ones it cannot register for the air operations team.
 *
 *   node scripts/backfillAwbl.js                 # DRY RUN - reports + CSV, writes nothing
 *   node scripts/backfillAwbl.js --apply         # actually registers (--commit also works)
 *   node scripts/backfillAwbl.js --out=C:/tmp/fix.csv
 *
 * The B/L migration stage already does the registering
 * (POST /blMigration/registerMawbs) - both run functions/awblMigration, so the
 * rules are identical. What this adds is the CORRECTION SHEET: every air BL
 * whose number could not be registered, why, and blank columns for operations
 * to write the right number or airline into. scripts/applyAwblCorrections.js
 * reads that sheet back. Run it after a migration to get the sheet, and again
 * after corrections to register what was fixed.
 *
 * SAFETY
 *  - Dry run unless --apply. The CSV is produced either way, so the correction
 *    list can be sent out before anything is written.
 *  - Only adds to "Awbls" (and withdraws its own earlier registrations of a
 *    number that has since turned up on a second job). Bls, SE_Jobs and every
 *    other table are only read - the typed mbl values stay exactly as they are.
 *  - Idempotent: numbers already registered to the same job are skipped.
 *  - Anything ambiguous is SKIPPED and listed, never guessed. A number on two
 *    jobs is registered to NEITHER - there is no way to tell which job owns
 *    it, and picking one would silently bless a real double-booking.
 *
 * AWB stock belongs to the group, so none of this is per company - the
 * company column is informational only.
 */
const fs = require('fs');
const path = require('path');
const db = require('../models');
const { sequelize } = db;
const { formatNumber } = require('../functions/awbl');
const {
  planMawbRegistration, readAirBls, readContext, registerMigratedMawbs, tally,
} = require('../functions/awblMigration');

const args = process.argv.slice(2);
const COMMIT = args.includes('--apply') || args.includes('--commit');
const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const OUT_PATH = argValue('out') ||
  path.join(process.cwd(), `awbl-corrections-${new Date().toISOString().slice(0, 10)}.csv`);

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

const companyLabel = (companies, id) => companies.get(String(id)) || String(id ?? '');

const csvCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// What each outcome is called on the sheet, in the order someone working
// through it would want: the blocking problems first.
const ISSUE = {
  duplicate: 'Duplicate MAWB',
  wrongCheckDigit: 'Wrong check digit',
  invalidFormat: 'Invalid MAWB format',
  noAirline: 'No airline on job',
  airlineMismatch: 'Airline differs from stock',
  takenByOtherJob: 'Registered to another job',
  review: 'Airline may be wrong (review)',
};
const ORDER = Object.values(ISSUE);

async function main() {
  await sequelize.authenticate();
  // The models module kicks off the schema sync on require; wait for it so the
  // Awbls table is definitely there before we read or write it.
  await db.ready;

  console.log(COMMIT ? '*** APPLY MODE - changes will be written ***'
                     : '--- DRY RUN - nothing will be written (pass --apply to register) ---');

  const [companyRows] = await sequelize.query(`SELECT id, short FROM "Companies"`);
  const companies = new Map(companyRows.map((c) => [String(c.id), c.short]));

  const rows = await readAirBls(sequelize);
  console.log(`\nair BLs with a typed MAWB: ${rows.length}`);

  const plan = planMawbRegistration(rows, await readContext(db.Awbl, rows));

  const corrections = plan.outcomes
    .filter((o) => ISSUE[o.outcome])
    .map((o) => ({
      issue: ISSUE[o.outcome],
      row: o.row,
      mawb: digitsOnly(o.row.mbl).length === 11 ? formatNumber(digitsOnly(o.row.mbl)) : o.row.mbl,
      detail: o.detail,
      suggested: o.suggested || '',
    }));

  /* Prefix / airline disagreement - still registered, flagged for review.
   * An airline prefix belongs to exactly one airline in reality, so a prefix
   * appearing against several airlines means the job data disagrees with
   * itself. These register under whichever airline their own job names,
   * because inventing a correction would be worse, but the minority ones are
   * listed against the airline that dominates the prefix. Every backfilled
   * row is `used`, so a wrong airline never reaches the unused dropdown; it
   * skews the AWB page's airline filter, nothing operational. */
  const byPrefix = new Map();
  for (const c of plan.toCreate) {
    if (!byPrefix.has(c.prefix)) byPrefix.set(c.prefix, new Map());
    const m = byPrefix.get(c.prefix);
    m.set(c.AirlineId, (m.get(c.AirlineId) || 0) + 1);
  }
  const rowByNumber = new Map(rows.map((r) => [digitsOnly(r.mbl), r]));
  for (const c of plan.toCreate) {
    const m = byPrefix.get(c.prefix);
    if (m.size < 2) continue;
    const [topId, topN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (c.AirlineId === topId) continue;
    const top = rows.find((r) => r.airLineId === topId);
    corrections.push({
      issue: ISSUE.review,
      row: rowByNumber.get(c.awbNumber),
      mawb: formatNumber(c.awbNumber),
      detail: `Prefix ${c.prefix} is used by ${top?.airlineName || `airline #${topId}`} on ${topN} other ` +
        'job(s), but this job names a different airline. Either the airline on the job or the MAWB is wrong.',
      suggested: '',
    });
  }

  /* ----------------------------- report ----------------------------- */
  const counts = tally(plan.outcomes);
  console.log(`\nwould register:           ${counts.registered}`);
  console.log(`would match unused stock: ${counts.claimed}`);
  console.log(`already registered:       ${counts.already}`);
  if (plan.toRelease.length) {
    console.log(`earlier registrations to withdraw (number now on two jobs): ${plan.toRelease.length}`);
  }

  const byIssue = corrections.reduce((acc, c) => ({ ...acc, [c.issue]: (acc[c.issue] || 0) + 1 }), {});
  console.log('\nNeeds manual correction:');
  if (!corrections.length) console.log('   nothing - every number parsed cleanly');
  Object.entries(byIssue)
    .sort((a, b) => b[1] - a[1])
    .forEach(([issue, n]) => console.log(`   ${String(n).padStart(5)}  ${issue}`));

  /* ------------------------------ CSV ------------------------------- */
  corrections.sort((a, b) => {
    const d = ORDER.indexOf(a.issue) - ORDER.indexOf(b.issue);
    return d !== 0 ? d : String(a.row.jobNo).localeCompare(String(b.row.jobNo));
  });

  // Columns fall into three groups, in this order:
  //   what we found      - Issue .. What To Fix
  //   our suggestion     - Suggested MAWB (check-digit rows only; never assumed
  //                        correct, since the serial may be the wrong part)
  //   operations' answer - Corrected MAWB / Corrected Airline / Notes, left
  //                        blank for them to fill in and send back
  // scripts/applyAwblCorrections.js reads exactly these headers, so renaming a
  // column here means renaming it there too.
  const header = [
    'Issue', 'Job No', 'Company', 'Type', 'MAWB As Entered', 'Airline On Job', 'What To Fix',
    'Suggested MAWB', 'Corrected MAWB', 'Corrected Airline', 'Operations Notes',
    'Job ID', 'BL ID',
  ];
  const lines = [header.join(',')];
  for (const c of corrections) {
    const r = c.row;
    const airline = r.airlineName ? `${r.airlineName}${r.airlineCode ? ` (${r.airlineCode})` : ''}` : '';
    lines.push([
      c.issue, r.jobNo, companyLabel(companies, r.companyId), r.operation, c.mawb, airline, c.detail,
      c.suggested, '', '', '',
      r.jobId, r.blId,
    ].map(csvCell).join(','));
  }
  // BOM so Excel opens it as UTF-8 rather than mangling any accented party names.
  fs.writeFileSync(OUT_PATH, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`\nCorrection list written: ${OUT_PATH}`);
  console.log(`   ${corrections.length} row(s) for the air operations team.`);

  if (!COMMIT) {
    console.log('\nDry run finished - nothing written to the database.');
    console.log('Re-run with --apply to register the numbers above.');
    return;
  }

  // Re-planned inside its own transaction rather than trusting the plan above,
  // so nothing that changed in between is written from a stale read.
  const result = await registerMigratedMawbs(db);
  console.log(`\nDone. Registered ${result.counts.registered}, matched ${result.counts.claimed} to stock, ` +
              `withdrew ${result.released}.`);
}

main()
  .catch((err) => { console.error('Backfill failed:', err); process.exitCode = 1; })
  .finally(async () => { await sequelize.close(); });
