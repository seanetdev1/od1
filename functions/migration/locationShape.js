/**
 * Shape the legacy location export into Airports / Ports / Destinations rows.
 *
 * This is the half of the location migration that has to happen where the data
 * is. An airport's CityUNCode points at some row in UNLocation, and there are
 * 108,182 of those - so resolving a name needs the whole set in memory at
 * once. The legacy export is ~47.7 MB; it is fetched once, shaped here, and
 * only flat rows are sent onward. Nothing in this module touches the network,
 * so it is unit-testable against a real export.
 *
 * WHAT THIS FIXES
 *
 *   padded names    265 of 4,492 airport names arrive space-padded
 *                   ("AACHEN/MERZBRUCK AIRPORT          ") and 42 destination
 *                   names likewise. The old import stored them as-is, so the
 *                   padding reaches every picker and breaks exact-match search.
 *                   Destinations.name is UNIQUE, so a padded name is also a
 *                   second row that looks identical to the one beside it.
 *
 *   blank NOT NULL  Airports.city/country and Ports.portCountry are NOT NULL
 *   columns         with notEmpty validation, but the import writes them via
 *                   bulkCreate, which does not run validators. So an
 *                   unresolved lookup stored '' - a blank cell that passes
 *                   every row count and satisfies nothing the model asked for.
 *                   Unresolved lookups now fall back to the raw UN code, which
 *                   is real data and still identifies the place, and the count
 *                   is reported.
 *
 * WHAT IS NOT A BUG: IsSeaPort is true on 107,915 of 108,177 active locations
 * and IsCity on 107,922, so nearly every location is both a port and a
 * destination. That is what the legacy data says. This module reports the
 * volume rather than second-guessing the flags.
 */

const UNKNOWN = 'UNKNOWN';

export function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * @param {{ Airports: Array, UNLocation: Array }} data  the legacy export
 * @returns {{ airports, ports, destinations, stats, problems }}
 */
export function shapeLocations(data = {}) {
  const airports = Array.isArray(data.Airports) ? data.Airports : [];
  const unLocations = Array.isArray(data.UNLocation) ? data.UNLocation : [];

  // Resolved ONCE against the whole set. The receiver used to resolve from the
  // locations in the current request while the frontend sent them 100 at a
  // time, so an airport's CityUNCode almost never had its target in the same
  // batch - the lookup missed and the code was stored where the name belonged.
  const nameByCode = new Map();
  for (const l of unLocations) {
    if (l && l.UNLocCode !== null && l.UNLocCode !== undefined) {
      nameByCode.set(String(l.UNLocCode), cleanText(l.UNLocName));
    }
  }
  const nameOf = (code) => {
    if (code === null || code === undefined || code === '') return null;
    return nameByCode.get(String(code)) || null;
  };

  const problems = {
    airportsWithoutCode: 0,
    airportsWithoutName: 0,
    unresolvedCity: 0,
    unresolvedCountry: 0,
    portsWithoutCountry: 0,
    paddedNames: 0,
    duplicateAirportCodes: [],
    duplicateDestinationNames: 0,
  };

  // --- Airports ---------------------------------------------------------
  const seenAirport = new Set();
  const airportRows = [];
  for (const a of airports) {
    if (!a || a.IsInActive) continue;

    const code = cleanText(a.AirportCode);
    if (!code) { problems.airportsWithoutCode += 1; continue; }

    if (seenAirport.has(code.toUpperCase())) {
      // airportCode is UNIQUE - a second row would fail the insert.
      problems.duplicateAirportCodes.push(code);
      continue;
    }
    seenAirport.add(code.toUpperCase());

    const name = cleanText(a.AirportName);
    if (!name) problems.airportsWithoutName += 1;
    if (a.AirportName && a.AirportName !== cleanText(a.AirportName)) problems.paddedNames += 1;

    const city = nameOf(a.CityUNCode);
    const country = nameOf(a.CountryUNCode);
    if (!city) problems.unresolvedCity += 1;
    if (!country) problems.unresolvedCountry += 1;

    airportRows.push({
      airportCode: code,
      airportName: name || code,
      // NOT NULL + notEmpty. Fall back to the raw UN code rather than '' -
      // it is real data and still identifies the place.
      city: city || cleanText(a.CityUNCode) || UNKNOWN,
      country: country || cleanText(a.CountryUNCode) || UNKNOWN,
    });
  }

  // --- Ports and destinations -------------------------------------------
  const portRows = [];
  const destinationNames = new Set();
  let destinationCandidates = 0;

  /**
   * Codes the customer's own jobs load or discharge at.
   *
   * IsSeaPort is master data and it does not agree across installations: on the
   * freight database it is set on nearly every location, on the customs one on
   * 2,161 of 108,758. Under the strict flag, 271 codes CargoLinkers actually
   * ships through are not ports - HEATHROW APT/LONDON, DHAKA, CHANGI - so 956
   * jobs would open showing a discharge port the picker cannot offer, and
   * touching the field would clear it.
   *
   * A location this customer demonstrably ships through belongs in the port
   * list whatever the flag says. Supplied by /jobs/getAirports; absent on a
   * legacy server that does not send it, in which case this is empty and the
   * behaviour is exactly what it was.
   */
  const usedByJobs = new Set(
    (Array.isArray(data.UsedByJobs) ? data.UsedByJobs : [])
      .map((c) => cleanText(c))
      .filter(Boolean)
  );
  let portsFromUsage = 0;

  for (const l of unLocations) {
    if (!l || l.IsInActive) continue;
    const code = cleanText(l.UNLocCode);
    if (!code) continue;

    const locName = cleanText(l.UNLocName);

    const usedAsPort = usedByJobs.has(code);
    if (usedAsPort && !l.IsSeaPort) portsFromUsage += 1;

    if (l.IsSeaPort || usedAsPort) {
      const portCountry = nameOf(l.CountryCode);
      if (!portCountry) problems.portsWithoutCountry += 1;
      if (l.UNLocName && l.UNLocName !== locName) problems.paddedNames += 1;

      portRows.push({
        portId: code,
        portName: locName || code,
        portCountry: portCountry || cleanText(l.CountryCode) || UNKNOWN,
      });
    }

    // Destinations are keyed by name and the column is UNIQUE, so they are
    // de-duplicated on the trimmed name here rather than letting the database
    // reject ~13,500 duplicates one at a time.
    if ((l.IsCity || l.IsCountry) && locName) {
      destinationCandidates += 1;
      destinationNames.add(locName);
    }
  }

  problems.duplicateDestinationNames = destinationCandidates - destinationNames.size;

  return {
    airports: airportRows,
    ports: portRows,
    destinations: [...destinationNames].map((name) => ({ name })),
    problems,
    stats: {
      sourceAirports: airports.length,
      sourceLocations: unLocations.length,
      airports: airportRows.length,
      ports: portRows.length,
      // How many ports exist only because a job uses them. Zero on a freight
      // run, and on any legacy server that does not send UsedByJobs.
      portsFromJobUsage: portsFromUsage,
      destinations: destinationNames.size,
      total: airportRows.length + portRows.length + destinationNames.size,
    },
  };
}
