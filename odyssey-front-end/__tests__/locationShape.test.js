import { shapeLocations } from '../functions/migration/locationShape'

// Shaping is the half of the location migration that has to happen where the
// data is: an airport's CityUNCode points at some row among 108,182 UN
// locations, so a name only resolves with the whole set in memory. The old
// import sent them 100 at a time and resolved on the receiver, so the target
// was almost never in the same batch - the lookup missed and the code was
// stored where the name belonged.

const loc = (UNLocCode, UNLocName, over = {}) => ({
  UNLocCode, UNLocName, IsInActive: false, IsSeaPort: false, IsCity: false, IsCountry: false,
  ...over,
})

const air = (AirportCode, over = {}) => ({
  AirportCode, AirportName: `${AirportCode} AIRPORT`,
  CityUNCode: null, CountryUNCode: null, IsInActive: null, ...over,
})

describe('shapeLocations - name resolution', () => {
  test('resolves an airport city and country against the whole location set', () => {
    const out = shapeLocations({
      Airports: [air('LHR', { CityUNCode: 'GBLON', CountryUNCode: 'GB' })],
      UNLocation: [loc('GBLON', 'LONDON'), loc('GB', 'UNITED KINGDOM')],
    })

    expect(out.airports[0]).toEqual({
      airportCode: 'LHR', airportName: 'LHR AIRPORT', city: 'LONDON', country: 'UNITED KINGDOM',
    })
    expect(out.problems.unresolvedCity).toBe(0)
  })

  test('falls back to the raw UN code rather than a blank NOT NULL column', () => {
    // city/country are NOT NULL with notEmpty validators, but the write goes
    // through bulkCreate, which does not run them - so '' would land silently
    // and render as an empty cell.
    const out = shapeLocations({
      Airports: [air('XXX', { CityUNCode: 'NOSUCH', CountryUNCode: 'ALSONONE' })],
      UNLocation: [],
    })

    expect(out.airports[0].city).toBe('NOSUCH')
    expect(out.airports[0].country).toBe('ALSONONE')
    expect(out.problems.unresolvedCity).toBe(1)
    expect(out.problems.unresolvedCountry).toBe(1)
  })

  test('falls back to UNKNOWN only when there is no code at all', () => {
    const out = shapeLocations({ Airports: [air('YYY')], UNLocation: [] })
    expect(out.airports[0].city).toBe('UNKNOWN')
    expect(out.airports[0].country).toBe('UNKNOWN')
  })
})

describe('shapeLocations - trimming', () => {
  test('trims padded airport names and counts them', () => {
    // 265 of 4,492 real airport names arrive space-padded.
    const out = shapeLocations({
      Airports: [air('AAH', { AirportName: 'AACHEN/MERZBRUCK AIRPORT          ' })],
      UNLocation: [],
    })

    expect(out.airports[0].airportName).toBe('AACHEN/MERZBRUCK AIRPORT')
    expect(out.problems.paddedNames).toBe(1)
  })

  test('trims destination names before de-duplicating, not after', () => {
    // Destinations.name is UNIQUE, so "PARIS" and "PARIS " are two rows that
    // look identical in every picker.
    const out = shapeLocations({
      Airports: [],
      UNLocation: [
        loc('1', 'PARIS', { IsCity: true }),
        loc('2', 'PARIS  ', { IsCity: true }),
        loc('3', 'LYON', { IsCity: true }),
      ],
    })

    expect(out.destinations.map((d) => d.name).sort()).toEqual(['LYON', 'PARIS'])
    expect(out.problems.duplicateDestinationNames).toBe(1)
  })
})

describe('shapeLocations - filtering and splitting', () => {
  test('splits locations into sea ports and destinations by their flags', () => {
    const out = shapeLocations({
      Airports: [],
      UNLocation: [
        loc('NLRTM', 'ROTTERDAM', { IsSeaPort: true, IsCity: true, CountryCode: 'NL' }),
        loc('NL', 'NETHERLANDS', { IsCountry: true }),
        loc('XX', 'NEITHER'),
        loc('NLAAA', 'A PORT ONLY', { IsSeaPort: true }),
      ],
    })

    expect(out.ports.map((p) => p.portId).sort()).toEqual(['NLAAA', 'NLRTM'])
    // A location can be both, which is what the real data says - 107,915 sea
    // ports and 107,922 cities out of 108,177 active locations.
    expect(out.destinations.map((d) => d.name).sort()).toEqual(['NETHERLANDS', 'ROTTERDAM'])
  })

  test('adds a location as a port when the customer ships through it', () => {
    // IsSeaPort is master data and it does not agree across installations: on
    // the freight database nearly every location carries it, on the customs one
    // 2,161 of 108,758 do. 271 of the codes CargoLinkers' jobs load and
    // discharge at are outside that flag - HEATHROW APT/LONDON, DHAKA, CHANGI -
    // so 956 jobs would open with a port the picker could not offer.
    const out = shapeLocations({
      Airports: [],
      UNLocation: [
        loc('NLRTM', 'ROTTERDAM', { IsSeaPort: true, CountryCode: 'NL' }),
        loc('GBLHR', 'HEATHROW APT/LONDON', { IsCity: true, CountryCode: 'GB' }),
        loc('XXNIL', 'NEVER USED', { IsCity: true }),
      ],
      UsedByJobs: ['GBLHR'],
    })

    expect(out.ports.map((p) => p.portId).sort()).toEqual(['GBLHR', 'NLRTM'])
    expect(out.stats.portsFromJobUsage).toBe(1)
    // It is still a destination too - being used as a port does not stop it
    // being a city.
    expect(out.destinations.map((d) => d.name)).toContain('HEATHROW APT/LONDON')
  })

  test('is unchanged when the legacy server sends no usage list', () => {
    // Freight servers do not send UsedByJobs. The stage must behave exactly as
    // it did before rather than quietly widening the port list.
    const base = [
      loc('NLRTM', 'ROTTERDAM', { IsSeaPort: true }),
      loc('GBLHR', 'HEATHROW APT/LONDON', { IsCity: true }),
    ]
    for (const extra of [{}, { UsedByJobs: [] }, { UsedByJobs: null }]) {
      const out = shapeLocations({ Airports: [], UNLocation: base, ...extra })
      expect(out.ports.map((p) => p.portId)).toEqual(['NLRTM'])
      expect(out.stats.portsFromJobUsage).toBe(0)
    }
  })

  test('does not double-count a used code that is already a sea port', () => {
    const out = shapeLocations({
      Airports: [],
      UNLocation: [loc('NLRTM', 'ROTTERDAM', { IsSeaPort: true })],
      UsedByJobs: ['NLRTM'],
    })
    expect(out.ports).toHaveLength(1)
    expect(out.stats.portsFromJobUsage).toBe(0)
  })

  test('drops inactive airports and locations', () => {
    const out = shapeLocations({
      Airports: [air('OLD', { IsInActive: true }), air('NEW')],
      UNLocation: [
        loc('A', 'GONE', { IsSeaPort: true, IsInActive: true }),
        loc('B', 'HERE', { IsSeaPort: true }),
      ],
    })

    expect(out.airports.map((a) => a.airportCode)).toEqual(['NEW'])
    expect(out.ports.map((p) => p.portId)).toEqual(['B'])
  })

  test('skips a duplicate airport code, since the column is unique', () => {
    const out = shapeLocations({
      Airports: [air('LHR'), air('LHR'), air('CDG')],
      UNLocation: [],
    })

    expect(out.airports.map((a) => a.airportCode)).toEqual(['LHR', 'CDG'])
    expect(out.problems.duplicateAirportCodes).toEqual(['LHR'])
  })

  test('skips an airport with no code and counts it', () => {
    const out = shapeLocations({
      Airports: [air(''), air(null), air('OK')],
      UNLocation: [],
    })

    expect(out.airports.map((a) => a.airportCode)).toEqual(['OK'])
    expect(out.problems.airportsWithoutCode).toBe(2)
  })

  test('falls back to the code when an airport has no name', () => {
    // airportName is NOT NULL notEmpty.
    const out = shapeLocations({ Airports: [air('ZZZ', { AirportName: '  ' })], UNLocation: [] })
    expect(out.airports[0].airportName).toBe('ZZZ')
    expect(out.problems.airportsWithoutName).toBe(1)
  })
})

describe('shapeLocations - totals', () => {
  test('reports the totals the progress bar counts against', () => {
    const out = shapeLocations({
      Airports: [air('A'), air('B')],
      UNLocation: [
        loc('P1', 'PORT ONE', { IsSeaPort: true }),
        loc('C1', 'CITY ONE', { IsCity: true }),
      ],
    })

    expect(out.stats).toEqual({
      sourceAirports: 2, sourceLocations: 2,
      airports: 2, ports: 1, destinations: 1, total: 4,
      // No UsedByJobs in this fixture, so no port is added from usage.
      portsFromJobUsage: 0,
    })
  })

  test('does not throw on an empty or missing export', () => {
    expect(shapeLocations({}).stats.total).toBe(0)
    expect(shapeLocations().stats.total).toBe(0)
    expect(shapeLocations({ Airports: null, UNLocation: undefined }).airports).toEqual([])
  })
})
