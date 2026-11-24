/**
 * Airports, Ports & Destinations - the rewritten migration stage.
 *
 * This is the stage that "just keeps on going", and the reason is not a bug:
 * the legacy export is ~47.7 MB and yields ~207,000 rows - 4,492 airports,
 * 107,915 sea ports and 94,582 destinations. It is genuinely the largest thing
 * the migration does. What was missing was any way to tell that from the
 * outside, so it looked indistinguishable from a hang.
 *
 * So this stage reports progress against a total it knows in advance, in
 * percent, per kind. A long stage that says where it is is a different
 * experience from a long stage that says nothing.
 *
 * WHAT ELSE CHANGES
 *
 *   padded names    265 airport names and 42 destination names arrive
 *                   space-padded. Destinations.name is UNIQUE, so a padded
 *                   name is a second row that looks identical to its twin.
 *                   Trimmed in shaping now.
 *   blank columns   city/country/portCountry are NOT NULL with notEmpty
 *                   validators, but bulkCreate does not run validators, so
 *                   unresolved lookups stored ''. They now fall back to the
 *                   raw UN code, and verify counts what is left.
 *   resumability    A batch is atomic and the stage skips what already exists,
 *                   so an interrupted run is re-runnable and picks up where it
 *                   stopped. It is NOT one transaction - 207,000 rows over
 *                   ~200 requests cannot be - and the stage says so.
 *
 * The existing importAirPorts in steps.js is untouched.
 */

import axiosClient from 'apis/axiosClient';
import { shapeLocations } from './locationShape';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// Matches the server's MAX_BATCH. Larger batches mean fewer round trips but a
// coarser progress bar and a bigger unit of loss on an interruption.
const BATCH = 2000;

async function fetchLocations() {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getAirports`);
    if (!data || (!Array.isArray(data.Airports) && !Array.isArray(data.UNLocation))) {
      throw new Error(
        `${LEGACY_API}/jobs/getAirports responded but returned neither Airports nor UNLocation. `
        + `Got: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    return data;
  } catch (err) {
    if (!err?.response) {
      throw new Error(
        `Could not reach the legacy server at ${LEGACY_API}. Check it is running and that `
        + 'NEXT_PUBLIC_CLIMAX_LEGACY_URL points at it. This export is large (~47.7 MB), so a '
        + 'timeout here usually means the request was cut short rather than refused.'
      );
    }
    throw err;
  }
}

/**
 * Send one kind in batches, reporting progress as a share of the whole stage.
 *
 * @param {number} doneBefore  rows already sent by earlier kinds, so the
 *                             percentage is of the stage and not of this kind
 */
async function sendKind(kind, rows, { report, onProgress, total, doneBefore, dryRun }) {
  const totals = { created: 0, alreadyPresent: 0, rejected: 0, duplicatesInBatch: 0 };
  const rejectedSamples = [];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const { data } = await axiosClient.post('/locations/migration/apply', {
      [kind]: batch, dryRun,
    });
    const r = data.result;

    totals.created += r.created || 0;
    totals.alreadyPresent += r.alreadyPresent || 0;
    totals.rejected += r.rejected || 0;
    totals.duplicatesInBatch += r.duplicatesInBatch || 0;
    if (r.rejectedSample?.length && rejectedSamples.length < 10) {
      rejectedSamples.push(...r.rejectedSample.slice(0, 10 - rejectedSamples.length));
    }

    const done = doneBefore + Math.min(i + BATCH, rows.length);
    const pct = total ? Math.round((done / total) * 100) : 100;

    onProgress?.({ kind, done, total, percent: pct });
    report(
      `${kind}: ${Math.min(i + BATCH, rows.length).toLocaleString()} of `
      + `${rows.length.toLocaleString()} (${pct}% of stage)`
    );
  }

  return { ...totals, rejectedSamples };
}

/**
 * @param {(text: string) => void} report
 * @param {{ apply?: boolean, onProgress?: Function }} options
 *   onProgress receives { kind, done, total, percent } after every batch, for
 *   a progress bar. The stage works without it.
 */
export async function migrateLocations(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;

  report('Airports/Ports/Destinations: fetching the location export (~47.7 MB, this is slow)...');
  const data = await fetchLocations();

  report(
    `Locations: shaping ${(data.Airports?.length || 0).toLocaleString()} airports and `
    + `${(data.UNLocation?.length || 0).toLocaleString()} UN locations...`
  );
  const shaped = shapeLocations(data);
  const { airports, ports, destinations, stats, problems } = shaped;

  // Said up front, because this is the number that explains the wait.
  report(
    `Locations: ${stats.total.toLocaleString()} rows to import - `
    + `${stats.airports.toLocaleString()} airports, ${stats.ports.toLocaleString()} ports, `
    + `${stats.destinations.toLocaleString()} destinations. This is the largest stage.`
  );

  // Ports that exist only because a job ships through them. The location
  // master's IsSeaPort flag is set on 2,161 of 108,758 rows on the customs
  // database, and the codes clearing jobs actually use are not all inside it.
  if (stats.portsFromJobUsage) {
    report(
      `Locations: ${stats.portsFromJobUsage.toLocaleString()} port(s) added because jobs load or `
      + 'discharge there, even though the location master does not flag them as sea ports. '
      + 'Without these the port picker could not offer a port those jobs already use.'
    );
  }

  if (problems.duplicateDestinationNames) {
    report(
      `Locations: ${problems.duplicateDestinationNames.toLocaleString()} duplicate destination `
      + 'names collapsed before sending - the column is unique, so they would have been rejected '
      + 'one at a time.'
    );
  }
  if (problems.paddedNames) {
    report(
      `Locations: ${problems.paddedNames} name(s) were space-padded in the source and have been `
      + 'trimmed. Padding is invisible on screen but breaks exact-match search.'
    );
  }
  if (problems.unresolvedCity || problems.unresolvedCountry || problems.portsWithoutCountry) {
    report(
      `Locations: ${problems.unresolvedCity} airport city, ${problems.unresolvedCountry} airport `
      + `country and ${problems.portsWithoutCountry} port country lookup(s) did not resolve. They `
      + 'fall back to the raw UN code rather than a blank cell.'
    );
  }
  if (problems.duplicateAirportCodes.length) {
    report(
      `Locations: ${problems.duplicateAirportCodes.length} duplicate airport code(s) skipped - `
      + `the column is unique. ${problems.duplicateAirportCodes.slice(0, 10).join(', ')}`
    );
  }

  const kinds = [
    ['airports', airports],
    ['ports', ports],
    ['destinations', destinations],
  ];

  const applied = {};
  let doneBefore = 0;

  for (const [kind, rows] of kinds) {
    if (!rows.length) { applied[kind] = { created: 0, alreadyPresent: 0, rejected: 0 }; continue; }

    report(`Locations: ${apply ? 'importing' : 'checking'} ${rows.length.toLocaleString()} ${kind}...`);
    applied[kind] = await sendKind(kind, rows, {
      report, onProgress, total: stats.total, doneBefore, dryRun: !apply,
    });
    doneBefore += rows.length;

    const a = applied[kind];
    report(
      `Locations: ${kind} done - ${a.created.toLocaleString()} created, `
      + `${a.alreadyPresent.toLocaleString()} already present`
      + (a.rejected ? `, ${a.rejected} rejected as blank` : '') + '.'
    );
    if (a.rejected && a.rejectedSamples?.length) {
      report(`Locations: rejected ${kind} sample - ${JSON.stringify(a.rejectedSamples.slice(0, 3))}`);
    }
  }

  if (!apply) {
    report('Locations: dry run - nothing was written.');
    return { planned: shaped, applied, verification: null, noop: true, reason: 'Dry run.' };
  }

  report('Locations: verifying...');
  const verifyRes = await axiosClient.get('/locations/migration/verify');
  const v = verifyRes.data.result;

  report(
    `Locations: ${v.airports.toLocaleString()} airports, ${v.ports.toLocaleString()} ports, `
    + `${v.destinations.toLocaleString()} destinations in the system.`
  );

  // Each of these is invisible to a row count and changes what a user sees.
  if (v.airportsWithBlankCityOrCountry || v.portsWithBlankCountry) {
    report(
      `Locations: WARNING - ${v.airportsWithBlankCityOrCountry} airport(s) have a blank city or `
      + `country and ${v.portsWithBlankCountry} port(s) a blank country. These render as empty `
      + 'cells. Sample: ' + (v.airportsWithBlankSample || []).slice(0, 10).join(', ')
    );
  }
  if (v.paddedValues) {
    report(
      `Locations: WARNING - ${v.paddedValues} value(s) still carry padding from an earlier import. `
      + 'They break exact-match search and sit beside their twin in a picker.'
    );
  }
  if (v.duplicatePortIdCount) {
    report(
      `Locations: WARNING - ${v.duplicatePortIdCount} port id(s) appear more than once, so a job's `
      + 'port lookup is not deterministic. Ports.portId has no unique index. Sample: '
      + (v.duplicatePortIds || []).slice(0, 10).join(', ')
    );
  }

  const created =
    applied.airports.created + applied.ports.created + applied.destinations.created;

  return {
    planned: shaped,
    applied,
    verification: v,
    noop: created === 0,
    reason: created === 0 ? 'Everything was already imported.' : null,
  };
}

/** Plan only - writes nothing. Still sends the data, because shaping is remote-free
 *  but the existence checks are not. */
export const planLocationsOnly = (report, options = {}) =>
  migrateLocations(report, { ...options, apply: false });
