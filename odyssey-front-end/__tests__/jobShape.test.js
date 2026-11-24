import { buildJobLookups, attachResolved, countUnresolved, indexBy } from '../functions/migration/jobShape'

// The legacy lookups a job needs total 8.9 MB. The first version of the jobs
// stage attached them to every batch: 29 requests x 8.9 MB = 259 MB of
// identical data re-sent for 22 MB of jobs. Large enough to time a batch out,
// and a timed-out batch looks exactly like a job type that never imported.

const lookupData = {
  PropertiesLOV: [{ Id: 5, LOVCode: 'CC-5' }],
  Parties_Locations: [{ Id: 9, LocationName: 'KARACHI TERMINAL' }],
  IncoTerms: [{ Id: 2, IncoCode: 'FOB' }],
  UNAirport: [{ Id: 77, AirportCode: 'LHR' }, { Id: 78, AirportCode: 'DXB' }],
  UNLocation: [{ UNLocCode: 'GBLON', UNLocName: 'LONDON' }],
}

const job = (over = {}) => ({
  Id: 1, JobNumber: 'SEA-1/24', CostCenterId: 5, TerminalId: 9, IncoTermsId: 2, ...over,
})

describe('indexBy / buildJobLookups', () => {
  test('indexes a lookup table by id', () => {
    const m = indexBy([{ Id: 1, Code: 'A' }, { Id: 2, Code: 'B' }], 'Id', 'Code')
    expect(m.get('1')).toBe('A')
    expect(m.get('2')).toBe('B')
  })

  test('survives rows with no key and a missing table', () => {
    expect(indexBy([{ Code: 'A' }, null], 'Id', 'Code').size).toBe(0)
    expect(indexBy(undefined, 'Id', 'Code').size).toBe(0)
  })

  test('builds every lookup the mapper needs', () => {
    const l = buildJobLookups(lookupData)
    expect(l.costCentres.get('5')).toBe('CC-5')
    expect(l.terminals.get('9')).toBe('KARACHI TERMINAL')
    expect(l.incoTerms.get('2')).toBe('FOB')
    expect(l.airportCodes.get('77')).toBe('LHR')
    expect(l.locationNames.get('GBLON')).toBe('LONDON')
  })

  test('does not throw on an empty payload', () => {
    expect(() => buildJobLookups({})).not.toThrow()
    expect(() => buildJobLookups()).not.toThrow()
  })
})

describe('attachResolved', () => {
  const lookups = buildJobLookups(lookupData)

  test('attaches the scalars a sea job needs, and no airport fields', () => {
    const [out] = attachResolved([job()], lookups, 'SE')
    expect(out._resolved).toEqual({
      costCentre: 'CC-5', terminal: 'KARACHI TERMINAL', incoTerms: 'FOB',
    })
    // Sea jobs carry their port codes directly on the job row.
    expect(out._resolved.polAirport).toBeUndefined()
  })

  test('attaches airport and location names for an air job', () => {
    const [out] = attachResolved([job({
      AirPortOfLoadingId: 77, AirPortOfDischargeId: 78,
      FinalDestinationCode: 'GBLON', FreightPayableAtCode: 'GBLON',
    })], lookups, 'AE')

    expect(out._resolved.polAirport).toBe('LHR')
    expect(out._resolved.podAirport).toBe('DXB')
    expect(out._resolved.fdName).toBe('LONDON')
    expect(out._resolved.freightPayableAtName).toBe('LONDON')
  })

  test('leaves the legacy row otherwise untouched', () => {
    // The server-side mapper stays the one place that decides what an SE_Job
    // column gets set to.
    const [out] = attachResolved([job({ CustomerRefNo: 'REF-1' })], lookups, 'SE')
    expect(out.Id).toBe(1)
    expect(out.JobNumber).toBe('SEA-1/24')
    expect(out.CustomerRefNo).toBe('REF-1')
  })

  test('resolves a miss to null rather than throwing', () => {
    const [out] = attachResolved([job({ CostCenterId: 999, TerminalId: null })], lookups, 'SE')
    expect(out._resolved.costCentre).toBeNull()
    expect(out._resolved.terminal).toBeNull()
  })

  test('trims resolved values', () => {
    const l = buildJobLookups({ PropertiesLOV: [{ Id: 1, LOVCode: '  CC-1  ' }] })
    const [out] = attachResolved([job({ CostCenterId: 1 })], l, 'SE')
    expect(out._resolved.costCentre).toBe('CC-1')
  })

  test('does not throw on an empty or junk job list', () => {
    expect(attachResolved([], lookups, 'SE')).toEqual([])
    expect(attachResolved(undefined, lookups, 'SE')).toEqual([])
    expect(attachResolved([null], lookups, 'SE')).toEqual([null])
  })
})

describe('countUnresolved', () => {
  const lookups = buildJobLookups(lookupData)

  test('counts lookups that missed, which the server cannot see', () => {
    const jobs = attachResolved(
      [job(), job({ CostCenterId: 999 }), job({ TerminalId: 999 })], lookups, 'SE',
    )
    expect(countUnresolved(jobs, 'SE')).toMatchObject({ costCentre: 1, terminal: 1, incoTerms: 0 })
  })

  test('does not count a lookup the source never had', () => {
    const jobs = attachResolved([job({ CostCenterId: null })], lookups, 'SE')
    expect(countUnresolved(jobs, 'SE').costCentre).toBe(0)
  })
})

describe('all four job types are covered', () => {
  // The old importer never imported sea-import jobs at all - the upload was
  // commented out - and its air and sea halves were separate try blocks, so a
  // failure in one silently left the other's jobs out.
  const lookups = buildJobLookups(lookupData)

  test('every operation shapes without error and keeps its own rows', () => {
    for (const op of ['SE', 'SI', 'AE', 'AI']) {
      const out = attachResolved([job({ Id: 1 }), job({ Id: 2 })], lookups, op)
      expect(out).toHaveLength(2)
      expect(out.every((r) => r._resolved)).toBe(true)
    }
  })

  test('air operations get airport fields and sea operations do not', () => {
    for (const op of ['AE', 'AI']) {
      const [out] = attachResolved([job({ AirPortOfLoadingId: 77 })], lookups, op)
      expect(out._resolved.polAirport).toBe('LHR')
    }
    for (const op of ['SE', 'SI']) {
      const [out] = attachResolved([job({ AirPortOfLoadingId: 77 })], lookups, op)
      expect(out._resolved.polAirport).toBeUndefined()
    }
  })
})
