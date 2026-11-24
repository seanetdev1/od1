/**
 * A guard test for the migration engine and every stage module it imports.
 *
 * This exists because a stray apostrophe inside a single-quoted stage
 * `detail` string broke the build, and nothing in the suite noticed: no test
 * imported engine.js, so the first thing that parsed it was Next's compiler
 * in front of the user. Importing it here means a syntax error, a bad import
 * path or a renamed export fails in CI instead.
 *
 * It also checks the invariants the engine relies on but never asserts.
 */

jest.mock('apis/axiosClient', () => ({
  get: jest.fn(() => Promise.resolve({ data: {} })),
  post: jest.fn(() => Promise.resolve({ data: { result: {} } })),
}))

import { STAGES, MODES } from '../functions/migration/engine'

describe('migration engine loads', () => {
  test('the engine and every stage module parse and import', () => {
    // Reaching this line at all means engine.js and everything it imports
    // parsed - which is the bug this file is here to catch.
    expect(Array.isArray(STAGES)).toBe(true)
    expect(STAGES.length).toBeGreaterThan(0)
  })

  test('every stage module a stage points at is importable', () => {
    // These are the rewritten stages' modules. If one is renamed or its export
    // changes, engine.js still parses but the stage explodes at run time.
    for (const path of [
      '../functions/migration/coa', '../functions/migration/parties',
      '../functions/migration/employees', '../functions/migration/companies',
      '../functions/migration/charges', '../functions/migration/commodity',
      '../functions/migration/locations', '../functions/migration/jobs',
      '../functions/migration/voyages', '../functions/migration/bls',
      '../functions/migration/blChildren', '../functions/migration/jobEquipment',
      '../functions/migration/jobShape', '../functions/migration/locationShape',
      '../functions/migration/loadingPrograms', '../functions/migration/chargeHeads',
    ]) {
      expect(() => require(path)).not.toThrow()
    }
  })
})

describe('stage list invariants', () => {
  test('every stage has an id, a label and a runnable run()', () => {
    for (const s of STAGES) {
      expect(typeof s.id).toBe('string')
      expect(s.id.length).toBeGreaterThan(0)
      expect(typeof s.label).toBe('string')
      expect(typeof s.run).toBe('function')
    }
  })

  test('stage ids are unique', () => {
    const ids = STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every dependsOn names a stage that exists', () => {
    // A typo here silently makes a stage un-runnable, or runnable too early.
    const ids = new Set(STAGES.map((s) => s.id))
    for (const s of STAGES) {
      for (const dep of s.dependsOn || []) {
        expect(ids.has(dep)).toBe(true)
      }
    }
  })

  test('no stage depends on one declared after it', () => {
    // The engine runs STAGES in order, so a forward dependency can never be
    // satisfied.
    const seen = new Set()
    for (const s of STAGES) {
      for (const dep of s.dependsOn || []) {
        expect(seen.has(dep)).toBe(true)
      }
      seen.add(s.id)
    }
  })

  test('every stage declares at least one known mode', () => {
    for (const s of STAGES) {
      expect(Array.isArray(s.modes)).toBe(true)
      expect(s.modes.length).toBeGreaterThan(0)
      for (const m of s.modes) expect(Object.keys(MODES)).toContain(m)
    }
  })

  test('a rewritten stage carries a detail explaining what changed', () => {
    for (const s of STAGES.filter((x) => x.rewritten)) {
      expect(typeof s.detail).toBe('string')
      expect(s.detail.length).toBeGreaterThan(0)
    }
  })
})

describe('every stage is countable', () => {
  // The keys /migration/counts knows (routes/migration/index.js TARGETS).
  // Mirrored rather than fetched because this is a unit test - the backend
  // test suite asserts the same list resolves to real models.
  const COUNTS_KEYS = [
    'companies', 'employees', 'commodities', 'vessels', 'voyages', 'airports',
    'ports', 'destinations', 'accounts', 'charges', 'parties', 'jobs', 'bls',
    'chargeHeads', 'containers', 'equipment', 'stamps', 'dimensions', 'items',
    'loadingPrograms', 'invoices', 'vouchers', 'voucherHeads', 'bankAccounts',
    // The customs module's own tables. A clearing job lands in Customs_Jobs,
    // NOT in SE_Job - verifying the lgJobs stage against `jobs` would compare
    // it against a table it never writes, and pass whatever happened.
    'customsJobs', 'customsDuty',
    // Direct Job E/R - the customs stage that follows the ledger.
    'directJobs', 'directJobLines',
    // GST invoice numbers - the customs stage after the clearing invoices.
    'salesTaxInvoices',
  ]

  test('every stage declares verifies, even if only to say null', () => {
    // Omitting it is the bug: the stage shows no count and can never be caught
    // adding nothing, which is how the B/L children stage shipped. An explicit
    // null is fine - checkInvoices only reports, it writes nothing - but it
    // has to be a decision rather than an oversight.
    for (const s of STAGES) {
      expect(Object.prototype.hasOwnProperty.call(s, 'verifies')).toBe(true)
    }
  })

  test('every verifies key is one the counts endpoint knows', () => {
    // A typo here fails silently: countFor swallows the error and the stage
    // simply shows no count.
    for (const s of STAGES) {
      if (s.verifies === null) continue
      for (const key of Array.isArray(s.verifies) ? s.verifies : [s.verifies]) {
        expect(COUNTS_KEYS).toContain(key)
      }
    }
  })

  test('a stage writing several tables counts all of them', () => {
    // Counting one of four would judge the stage on a fraction of its work.
    const blChildren = STAGES.find((s) => s.id === 'blChildren')
    expect(blChildren.verifies).toEqual(
      expect.arrayContaining(['containers', 'stamps', 'dimensions', 'items']),
    )
  })
})
