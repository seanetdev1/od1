/**
 * Resolve the legacy lookups a job row needs, before it is sent.
 *
 * WHY THIS EXISTS
 *
 * The job mapper needs five legacy lookup tables - cost centres, terminals,
 * inco terms, airports and UN locations - to turn ids into the names Odyssey
 * stores. Those tables live in the legacy database, so the server cannot fetch
 * them itself, and the first version of this stage simply attached them to
 * every batch.
 *
 * That was 8.9 MB of lookups on each of 29 requests: 259 MB of identical data
 * re-sent for 22 MB of jobs. Large enough to time out a batch, and a timed-out
 * batch looks exactly like a job type that never imported.
 *
 * So the lookups are resolved once, here, and each job carries only the handful
 * of scalars it actually needs. A 500-job batch drops from 10.7 MB to 1.7 MB.
 *
 * Pure - no network, no database - so it is unit-testable against a real export.
 */

const AIR = new Set(['AE', 'AI']);

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** Build `${key}` -> `${value}` from a legacy lookup table. */
export function indexBy(rows, key, value) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row[key] === null || row[key] === undefined) continue;
    map.set(String(row[key]), row[value] ?? null);
  }
  return map;
}

/**
 * Build every lookup index once, for the whole run.
 *
 * @param {object} data  the /jobs/getJobRecords payload
 */
export function buildJobLookups(data = {}) {
  return {
    costCentres: indexBy(data.PropertiesLOV, 'Id', 'LOVCode'),
    terminals: indexBy(data.Parties_Locations, 'Id', 'LocationName'),
    incoTerms: indexBy(data.IncoTerms, 'Id', 'IncoCode'),
    airportCodes: indexBy(data.UNAirport, 'Id', 'AirportCode'),
    locationNames: indexBy(data.UNLocation, 'UNLocCode', 'UNLocName'),
  };
}

const get = (map, key) => {
  if (!map || key === null || key === undefined || key === '') return null;
  const hit = map.get(String(key));
  return hit === undefined ? null : cleanText(hit);
};

/**
 * Attach the resolved scalars a job needs onto the job itself.
 *
 * The legacy row is passed through untouched apart from `_resolved`, so the
 * server-side mapper stays the single place that decides what an SE_Job column
 * gets set to.
 *
 * @param {Array}  jobs       legacy job rows
 * @param {object} lookups    from buildJobLookups
 * @param {string} operation  SE | SI | AE | AI
 */
export function attachResolved(jobs, lookups, operation) {
  const isAir = AIR.has(operation);
  const list = Array.isArray(jobs) ? jobs : [];

  return list.map((row) => {
    if (!row) return row;

    const resolved = {
      costCentre: get(lookups.costCentres, row.CostCenterId),
      terminal: get(lookups.terminals, row.TerminalId),
      incoTerms: get(lookups.incoTerms, row.IncoTermsId),
    };

    // Sea jobs carry port codes directly on the job; only air jobs need these.
    if (isAir) {
      resolved.polAirport = get(lookups.airportCodes, row.AirPortOfLoadingId);
      resolved.podAirport = get(lookups.airportCodes, row.AirPortOfDischargeId);
      resolved.fdName = get(lookups.locationNames, row.FinalDestinationCode);
      resolved.freightPayableAtName = get(lookups.locationNames, row.FreightPayableAtCode);
    }

    return { ...row, _resolved: resolved };
  });
}

/** How many of each lookup missed - a job with no cost centre shows blank. */
export function countUnresolved(jobs, operation) {
  const isAir = AIR.has(operation);
  const out = { costCentre: 0, terminal: 0, incoTerms: 0, polAirport: 0, fdName: 0 };

  for (const row of Array.isArray(jobs) ? jobs : []) {
    const r = row?._resolved;
    if (!r) continue;
    if (row.CostCenterId && !r.costCentre) out.costCentre += 1;
    if (row.TerminalId && !r.terminal) out.terminal += 1;
    if (row.IncoTermsId && !r.incoTerms) out.incoTerms += 1;
    if (isAir) {
      if (row.AirPortOfLoadingId && !r.polAirport) out.polAirport += 1;
      if (row.FinalDestinationCode && !r.fdName) out.fdName += 1;
    }
  }
  return out;
}
