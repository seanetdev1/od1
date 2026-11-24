/**
 * The MAWBs typed onto migrated air jobs, registered in the freight AWB stock
 * as USED - so the register reflects every number the business has already
 * flown, and a migrated job's BL shows its own number in the MAWB dropdown.
 *
 * WHY IT RUNS WITH THE MIGRATION
 * Legacy air jobs carry their master number as free text on the BL. The
 * register (Setup > AWB Numbers) only knows numbers someone added to it, so
 * straight after a migration it is empty: no number anybody has used is marked
 * used, and every AE BL reads as "entered before AWB registration". The live
 * install fixed that with a one-off script after the fact
 * (scripts/backfillAwbl.js); here it is part of the B/L stage, so a fresh
 * migration arrives already registered.
 *
 * WHAT IS REGISTERED, AND WHAT IS NOT
 * Nothing is invented: the number comes from the BL, the airline from the job.
 * A BL is left alone - reported, never guessed - when:
 *   invalidFormat    the MAWB is not 11 digits
 *   noAirline        the job names no airline to register it under
 *   wrongCheckDigit  the last digit is not the serial mod 7, so the number is
 *                    a typo and no airline would accept it
 *   duplicate        the same number is on MORE THAN ONE job. There is no way
 *                    to tell which job owns it, and registering it to either
 *                    would silently bless a real double-booking. BOTH are
 *                    skipped, which is why this runs over every air BL at once
 *                    rather than batch by batch: a batch cannot see that a
 *                    later batch carries the same number.
 *   airlineMismatch  the number is already in stock, unused, under a
 *                    different airline than the job's
 *   takenByOtherJob  the number is already in stock and used by another job
 *
 * RE-RUNNABLE. A number already registered to the same job is left as it is.
 * A registration this module made earlier whose number has since turned up on
 * a second job is withdrawn - it was only ever a record of typed text, and it
 * is now ambiguous. A registration someone made BY HAND is never touched.
 *
 * Global, not per company: AWB stock belongs to the group, and an air waybill
 * number is unique worldwide - see models/Awbl.js.
 */

const { Op } = require('sequelize');
const { parseEntry, formatNumber } = require('./awbl');

// Stamped on every row this module creates, so a later run can tell its own
// registrations from ones a person made. 'Backfilled from typed MAWB' is what
// the live install's backfill script wrote - rows carrying it are the same kind
// of record and are treated the same way.
const MIGRATION_REMARK = 'Registered from migrated MAWB';
const MIGRATION_REMARKS = [MIGRATION_REMARK, 'Backfilled from typed MAWB'];

const OUTCOMES = [
  'registered', 'claimed', 'already',
  'invalidFormat', 'noAirline', 'wrongCheckDigit',
  'duplicate', 'airlineMismatch', 'takenByOtherJob',
];

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

/**
 * Decides, for each air BL, what happens to its MAWB. Pure - no database - so
 * the rules can be tested on their own.
 *
 * @param rows  [{ blId, mbl, jobId, jobNo, operation, airLineId, blCreatedAt }]
 * @param jobCountByNumber  Map number -> how many DISTINCT jobs carry it across
 *                          every air BL in the database, not just `rows`
 * @param registeredByNumber Map number -> the register row already holding it
 *                          { id, SEJobId, status, AirlineId, remarks }
 * @returns {{ toCreate, toClaim, toRelease, outcomes }}
 */
const planMawbRegistration = (rows, { jobCountByNumber = new Map(), registeredByNumber = new Map() } = {}) => {
  const toCreate = [];
  const toClaim = [];
  const toRelease = new Set();
  const outcomes = [];
  // A job with two BLs carrying the same number registers it once.
  const planned = new Set();

  const note = (row, outcome, detail = '', extra = {}) =>
    outcomes.push({ row, outcome, detail, ...extra });

  for (const row of rows) {
    const digits = digitsOnly(row.mbl);

    if (digits.length !== 11) {
      note(row, 'invalidFormat', digits.length
        ? `Has ${digits.length} digits, an AWB needs 11 (3-digit airline prefix + 7-digit serial + check digit).`
        : 'Contains no digits at all.');
      continue;
    }
    if (!row.airLineId) {
      note(row, 'noAirline', 'Set the airline on the job before this number can be registered.');
      continue;
    }

    const parsed = parseEntry(digits.slice(0, 3), digits.slice(3));
    if (!parsed.ok) {
      // The suggestion fixes the LAST digit, which is the common mis-key. It is
      // offered, not applied: if the serial is the wrong part instead, the
      // suggestion is wrong too.
      const serial = digits.slice(3, 10);
      note(row, 'wrongCheckDigit', parsed.error, {
        suggested: `${digits.slice(0, 3)}-${serial}${Number(serial) % 7}`,
      });
      continue;
    }

    const existing = registeredByNumber.get(digits);

    if ((jobCountByNumber.get(digits) || 0) > 1) {
      note(row, 'duplicate',
        `${formatNumber(digits)} is on ${jobCountByNumber.get(digits)} jobs. Decide which job keeps it; ` +
        'the others need their own number.');
      if (existing && MIGRATION_REMARKS.includes(existing.remarks)) toRelease.add(digits);
      continue;
    }

    if (existing) {
      if (String(existing.SEJobId) === String(row.jobId)) {
        note(row, 'already');
      } else if (existing.SEJobId) {
        note(row, 'takenByOtherJob', `${formatNumber(digits)} is already registered against another job.`);
      } else if (existing.status !== 'unused') {
        note(row, 'takenByOtherJob', `${formatNumber(digits)} is in stock but marked ${existing.status}.`);
      } else if (String(existing.AirlineId) !== String(row.airLineId)) {
        note(row, 'airlineMismatch',
          `${formatNumber(digits)} is in stock under a different airline than this job's.`);
      } else if (!planned.has(digits)) {
        // Registered as stock before the job reached Odyssey - the job used it.
        planned.add(digits);
        toClaim.push({ id: existing.id, SEJobId: row.jobId, usedAt: usedAtFor(row) });
        note(row, 'claimed');
      } else {
        note(row, 'already');
      }
      continue;
    }

    if (planned.has(digits)) {
      note(row, 'already');
      continue;
    }
    planned.add(digits);
    toCreate.push({
      prefix: digits.slice(0, 3),
      serial: digits.slice(3, 10),
      checkDigit: digits.slice(10),
      awbNumber: digits,
      AirlineId: row.airLineId,
      status: 'used',
      SEJobId: row.jobId,
      usedAt: usedAtFor(row),
      remarks: MIGRATION_REMARK,
    });
    note(row, 'registered');
  }

  return { toCreate, toClaim, toRelease: [...toRelease], outcomes };
};

// When the number was consumed: the BL's own date, as the backfill used.
const usedAtFor = (row) =>
  (row.blCreatedAt ? new Date(row.blCreatedAt).toISOString() : null);

/** Every air BL with something typed as its MAWB, with the job's airline. */
const readAirBls = async (sequelize, { transaction } = {}) => {
  const [rows] = await sequelize.query(`
    SELECT b.id AS "blId", b.mbl, b."createdAt" AS "blCreatedAt",
           j.id AS "jobId", j."jobNo", j.operation, j."companyId", j."airLineId",
           cl.name AS "airlineName", cl.code AS "airlineCode"
      FROM "Bls" b
      JOIN "SE_Jobs" j ON j.id = b."SEJobId"
      LEFT JOIN "Clients" cl ON cl.id = j."airLineId"
     WHERE j.operation IN ('AE','AI')
       AND b.mbl IS NOT NULL AND btrim(b.mbl) <> ''
     ORDER BY j."jobNo", b.id
  `, { transaction });
  return rows;
};

/** The inputs the planner needs, read from the whole database. */
const readContext = async (Awbl, rows, { transaction } = {}) => {
  const jobsByNumber = new Map();
  for (const row of rows) {
    const digits = digitsOnly(row.mbl);
    if (digits.length !== 11) continue;
    if (!jobsByNumber.has(digits)) jobsByNumber.set(digits, new Set());
    jobsByNumber.get(digits).add(String(row.jobId));
  }
  const jobCountByNumber = new Map([...jobsByNumber].map(([n, jobs]) => [n, jobs.size]));

  const registeredByNumber = new Map();
  const numbers = [...jobsByNumber.keys()];
  for (let i = 0; i < numbers.length; i += 1000) {
    const found = await Awbl.findAll({
      where: { awbNumber: { [Op.in]: numbers.slice(i, i + 1000) } },
      attributes: ['id', 'awbNumber', 'SEJobId', 'status', 'AirlineId', 'remarks'],
      raw: true,
      transaction,
    });
    for (const r of found) registeredByNumber.set(r.awbNumber, r);
  }
  return { jobCountByNumber, registeredByNumber };
};

/** Counts per outcome, every outcome present so a report can print zeros. */
const tally = (outcomes) => {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0]));
  for (const o of outcomes) counts[o.outcome] += 1;
  return counts;
};

/**
 * Plans over every air BL and, unless dryRun, writes the result in one
 * transaction.
 *
 * @returns {{ counts, released, outcomes }}
 */
const registerMigratedMawbs = async (db, { dryRun = false } = {}) => {
  const { sequelize, Awbl } = db;
  const run = async (transaction) => {
    const rows = await readAirBls(sequelize, { transaction });
    const context = await readContext(Awbl, rows, { transaction });
    const plan = planMawbRegistration(rows, context);

    if (!dryRun) {
      if (plan.toRelease.length) {
        await Awbl.destroy({
          where: { awbNumber: { [Op.in]: plan.toRelease }, remarks: { [Op.in]: MIGRATION_REMARKS } },
          transaction,
        });
      }
      for (const claim of plan.toClaim) {
        // Conditional, like /awbl/assign: only if it is still unused.
        await Awbl.update(
          { status: 'used', SEJobId: claim.SEJobId, usedAt: claim.usedAt },
          { where: { id: claim.id, status: 'unused' }, transaction },
        );
      }
      for (let i = 0; i < plan.toCreate.length; i += 500) {
        // ignoreDuplicates leans on the unique awbNumber index as a final
        // backstop, so a concurrent run cannot double-register.
        await Awbl.bulkCreate(plan.toCreate.slice(i, i + 500), { ignoreDuplicates: true, transaction });
      }
    }

    return { counts: tally(plan.outcomes), released: plan.toRelease.length, outcomes: plan.outcomes };
  };

  return dryRun ? run(undefined) : sequelize.transaction(run);
};

module.exports = {
  MIGRATION_REMARK,
  MIGRATION_REMARKS,
  OUTCOMES,
  planMawbRegistration,
  readAirBls,
  readContext,
  registerMigratedMawbs,
  tally,
};
