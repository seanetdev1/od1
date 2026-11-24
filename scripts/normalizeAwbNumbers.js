#!/usr/bin/env node
/**
 * Give every AWB number already in the database ONE spelling.
 *
 * THE PROBLEM. The same air waybill gets typed three ways by three people -
 * `9812 1234`, `9812-1234`, `98121234` - and stored as typed they are three
 * different strings. Two places match legs of a shipment by that exact string:
 *
 *   functions/aviationPendingLoads   groups an AWB's legs to work out what it
 *                                    still owes. Two spellings = two AWBs,
 *                                    each reported as owing its own cargo, so
 *                                    the outstanding-loads figure is overstated
 *                                    and settling one leg never clears it.
 *
 *   /relatedCharges                  finds the other flights carrying the same
 *                                    AWB so their charges can go on one
 *                                    invoice. Two spellings = they never find
 *                                    each other, and half the shipment is
 *                                    quietly billed on its own.
 *
 * Writes are normalised from now on (see normalizeAwb in functions/awb.js, and
 * lineValues in routes/aviationJobs). This fixes what is already stored.
 *
 * WHAT IT CHANGES. Separators only - spaces, hyphens (including the unicode
 * dashes a paste from Word brings), dots and slashes. Rows containing anything
 * else are REPORTED AND LEFT ALONE: a number nobody recognises is a data-entry
 * problem for a person to look at, not something to silently rewrite into a
 * plausible-looking wrong one.
 *
 * Two tables:
 *   Aviation_Consignments.awb   the number on a flight. Expected to be where
 *                               the mess is - a direct AWB is typed free-hand.
 *   Aviation_Awbs.awbNumber     the register. Expected to be clean already,
 *                               because /register builds numbers rather than
 *                               accepting them, but checked so "expected" is
 *                               not doing the work. Its column is UNIQUE, so a
 *                               normalisation that would collide with an
 *                               existing row is reported and skipped rather
 *                               than crashing the run half way through.
 *
 * Merging two spellings into one is the POINT, not a hazard: a consignment has
 * no unique constraint on awb, and two legs that were always the same air
 * waybill are supposed to group together.
 *
 * Safe to run more than once - the second run finds nothing to do.
 *
 * Pass --test to target the test database (DB_NAME_TEST) instead.
 *
 *   node scripts/normalizeAwbNumbers.js            # dry run - lists every change
 *   node scripts/normalizeAwbNumbers.js --apply
 */

require('dotenv').config();
const { Client } = require('pg');
const { normalizeAwb } = require('../functions/awb');

const APPLY = process.argv.includes('--apply');
const USE_TEST_DB = process.argv.includes('--test');

// [table, id column, value column, unique?]
const TARGETS = [
  ['Aviation_Consignments', 'id', 'awb', false],
  ['Aviation_Awbs', 'id', 'awbNumber', true],
];

// Only digits and the separators people actually type. Anything else is left
// for a person to look at.
const SAFE_TO_NORMALISE = /^[0-9\s./‐-―-]+$/;

const tableExists = async (client, table) => {
  const { rows } = await client.query(
    'SELECT to_regclass($1) AS oid', [`public."${table}"`],
  );
  return Boolean(rows[0].oid);
};

(async () => {
  const database = USE_TEST_DB ? process.env.DB_NAME_TEST : process.env.DB_NAME;
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database,
  });

  let changed = 0;
  let skipped = 0;

  try {
    await client.connect();
    console.log(`database: ${database}`);
    console.log('');

    for (const [table, idCol, valueCol, unique] of TARGETS) {
      if (!await tableExists(client, table)) {
        console.log(`${table}: does not exist - skipping.`);
        continue;
      }

      const { rows } = await client.query(
        `SELECT "${idCol}" AS id, "${valueCol}" AS value
           FROM "${table}"
          WHERE "${valueCol}" IS NOT NULL AND "${valueCol}" <> ''`,
      );

      // Every value the table will hold once this is done, so a collision on a
      // unique column is caught before the UPDATE rather than by it.
      const taken = new Set(
        rows.map((r) => normalizeAwb(r.value)).filter(Boolean),
      );

      const planned = [];
      for (const row of rows) {
        const tidy = normalizeAwb(row.value);
        if (!tidy || tidy === row.value) continue;

        if (!SAFE_TO_NORMALISE.test(String(row.value).trim())) {
          console.log(`  ${table} #${row.id}: "${row.value}" - not a number, left alone`);
          skipped += 1;
          continue;
        }

        if (unique) {
          const { rows: clash } = await client.query(
            `SELECT "${idCol}" FROM "${table}" WHERE "${valueCol}" = $1 AND "${idCol}" <> $2`,
            [tidy, row.id],
          );
          if (clash.length) {
            console.log(
              `  ${table} #${row.id}: "${row.value}" -> "${tidy}" WOULD COLLIDE with ` +
              `#${clash[0][idCol]} - left alone, resolve by hand`,
            );
            skipped += 1;
            continue;
          }
        }

        planned.push([row.id, row.value, tidy]);
      }

      if (!planned.length) {
        console.log(`${table}.${valueCol}: nothing to change (${rows.length} rows checked)`);
        continue;
      }

      console.log(`${table}.${valueCol}: ${planned.length} of ${rows.length} rows to normalise`);
      for (const [id, before, after] of planned) {
        console.log(`  #${id}: "${before}" -> "${after}"`);
        if (APPLY) {
          await client.query(
            `UPDATE "${table}" SET "${valueCol}" = $1 WHERE "${idCol}" = $2`,
            [after, id],
          );
        }
      }
      changed += planned.length;
      console.log('');
    }

    if (!changed && !skipped) {
      console.log('Nothing to do - every AWB number is already in one spelling.');
      return;
    }

    console.log('');
    if (!APPLY) {
      console.log(`Dry run - nothing changed. ${changed} row(s) would be normalised.`);
      if (skipped) console.log(`${skipped} row(s) need a person to look at them (listed above).`);
      console.log('Re-run with --apply to make these changes.');
    } else {
      console.log(`Done - ${changed} row(s) normalised.`);
      if (skipped) console.log(`${skipped} row(s) were left alone (listed above).`);
    }
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
