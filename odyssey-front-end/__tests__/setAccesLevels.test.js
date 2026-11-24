// setAccesLevels() builds the whole sidebar menu tree and is too large to
// cover exhaustively. This focuses narrowly on the designation-based gating
// (isCeoOrCfo / isAdminDesignation) that controls the 'Employees' and
// 'Parties' entries under the 'Setup' section - recently changed so Parties
// is gated the same way Employees already was.
//
// setAccesLevels reads the token from js-cookie itself (not a function
// param) and keeps module-level state (`firstCall`/`tempToken`) across
// calls, so each test resets the module registry and re-requires fresh
// mocks to get a clean "first call after page load" state.

jest.mock('js-cookie', () => ({ get: jest.fn() }))
jest.mock('jwt-decode', () => jest.fn())
jest.mock('functions/logout', () => jest.fn())
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn((x) => x) }))

const findParent = (items, key) => items.find((x) => x && x.key === key)
const findChild = (parent, key) => parent?.children?.find((x) => x && x.key === key)

describe('setAccesLevels designation gating (Employees / Parties)', () => {
  let Cookies
  let jwt_decode
  let setAccesLevels

  beforeEach(() => {
    jest.resetModules()
    jest.mock('js-cookie', () => ({ get: jest.fn() }))
    jest.mock('jwt-decode', () => jest.fn())
    jest.mock('functions/logout', () => jest.fn())
    jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn((x) => x) }))

    Cookies = require('js-cookie')
    jwt_decode = require('jwt-decode')
    ;({ setAccesLevels } = require('functions/setAccesLevels'))
  })

  test.each(['ceo', 'cfo', 'admin', 'CEO', 'CfO'])(
    'designation "%s" sees both Employees and Parties under Setup',
    (designation) => {
      Cookies.get.mockReturnValue('valid.jwt.token')
      jwt_decode.mockReturnValue({ designation, access: 'Commodity' })

      const items = setAccesLevels(jest.fn(), false)
      const setup = findParent(items, '2')

      expect(setup).toBeTruthy()
      expect(findChild(setup, '2-1')).toMatchObject({ label: 'Employees' })
      expect(findChild(setup, '2-2')).toMatchObject({ label: 'Parties' })
    }
  )

  test('an ordinary employee designation sees Parties but not Employees', () => {
    Cookies.get.mockReturnValue('valid.jwt.token')
    jwt_decode.mockReturnValue({ designation: 'employee', access: 'Commodity' })

    const items = setAccesLevels(jest.fn(), false)
    const setup = findParent(items, '2')

    // Setup is always present (Fiscal Years is visible to everyone).
    // Employees stays gated on designation; Parties is deliberately open to
    // every user, because anyone raising a job or a charge may need to create
    // the shipper or consignee it names.
    expect(setup).toBeTruthy()
    expect(findChild(setup, '2-1')).toBeFalsy()
    expect(findChild(setup, '2-2')).toMatchObject({ label: 'Parties' })
  })

  test('missing/undecodable designation still gets Parties, but not Employees', () => {
    Cookies.get.mockReturnValue('valid.jwt.token')
    jwt_decode.mockReturnValue({ access: 'Commodity' }) // no designation field

    const items = setAccesLevels(jest.fn(), false)
    const setup = findParent(items, '2')

    // Employees defaults closed rather than open: an absent designation must
    // never be read as a privileged one.
    expect(findChild(setup, '2-1')).toBeFalsy()
    expect(findChild(setup, '2-2')).toMatchObject({ label: 'Parties' })
  })

  test('admin designation grants full menu access independent of the access-level string', () => {
    Cookies.get.mockReturnValue('valid.jwt.token')
    // Deliberately no "admin" in the access-level string - only the
    // designation should be enough to unlock everything.
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'Commodity' })

    const items = setAccesLevels(jest.fn(), false)

    expect(findParent(items, '4')).toBeTruthy() // Sea Jobs
    expect(findParent(items, '7')).toBeTruthy() // Air Jobs
    expect(findParent(items, '2')).toBeTruthy() // Setup
    expect(findParent(items, '3')).toBeTruthy() // Accounts
    expect(findParent(items, '5')).toBeTruthy() // Reports
  })

  // Config is Seanet's on a leased install: a client's admin gets every
  // section but that one. The backend's `system` claim is what opens it.
  test('Configuration is shown to a system session only, not to a client admin', () => {
    Cookies.get.mockReturnValue('valid.jwt.token')
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })
    expect(findParent(setAccesLevels(jest.fn(), false), '9')).toBeFalsy()

    jest.resetModules()
    jest.mock('js-cookie', () => ({ get: jest.fn(() => 'valid.jwt.token') }))
    jest.mock('jwt-decode', () => jest.fn(() => ({ designation: 'admin', access: 'admin', system: true })))
    jest.mock('functions/logout', () => jest.fn())
    jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn((x) => x) }))
    const fresh = require('functions/setAccesLevels').setAccesLevels
    expect(findParent(fresh(jest.fn(), false), '9')).toBeTruthy()
  })

  test('no token cookie still returns a menu (Setup only, no crash)', () => {
    Cookies.get.mockReturnValue(undefined)

    const items = setAccesLevels(jest.fn(), false)
    const setup = findParent(items, '2')

    expect(setup).toBeTruthy()
    expect(findChild(setup, '2-1')).toBeFalsy()
  })
})

// The 'aviation' operation mode is an airline flying its own aircraft: there
// is no sea side to the business, so the sidebar must not offer one. Key '4'
// is the sea section, key '7' the air one.
describe('setAccesLevels in aviation operation mode', () => {
  let Cookies
  let jwt_decode
  let setAccesLevels

  // setAccesLevels and terminology both read cookies by name, so the mock has
  // to answer per key rather than returning one value for everything.
  const cookies = (values) => Cookies.get.mockImplementation((k) => values[k])

  beforeEach(() => {
    jest.resetModules()
    jest.mock('js-cookie', () => ({ get: jest.fn() }))
    jest.mock('jwt-decode', () => jest.fn())
    jest.mock('functions/logout', () => jest.fn())
    jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn((x) => x) }))

    Cookies = require('js-cookie')
    jwt_decode = require('jwt-decode')
    ;({ setAccesLevels } = require('functions/setAccesLevels'))
  })

  // Aviation Job ('10') is the only jobs section in this mode. Sea Jobs ('4')
  // goes because an airline has no ships; Air Jobs ('7') goes because
  // Aviation Job replaces it rather than sitting alongside it.
  test('an admin sees neither the sea nor the air freight section', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'aviation' })
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })

    const items = setAccesLevels(jest.fn(), false)

    expect(findParent(items, '4')).toBeFalsy()  // Sea Jobs - gone
    expect(findParent(items, '7')).toBeFalsy()  // Air Jobs - gone
    expect(findParent(items, '10')).toBeTruthy() // Aviation Job - the only one
    expect(findParent(items, '2')).toBeTruthy() // Setup still there
  })

  test('the same admin in freight mode still sees both sections', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'freight' })
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })

    const items = setAccesLevels(jest.fn(), false)

    expect(findParent(items, '4')).toMatchObject({ label: 'Sea Jobs' })
    expect(findParent(items, '7')).toMatchObject({ label: 'Air Jobs' })
  })

  test('an export-only air user gets Aviation Job, not an empty sidebar', () => {
    // "ExAir" is routed to the SEA section by the access-level switch. With
    // both freight sections removed, this user would be left with no jobs
    // section at all if Aviation Job were not added for them.
    cookies({ token: 'valid.jwt.token', operationMode: 'aviation' })
    jwt_decode.mockReturnValue({ designation: 'employee', access: 'ExAir' })

    const items = setAccesLevels(jest.fn(), false)

    expect(findParent(items, '4')).toBeFalsy()
    expect(findParent(items, '7')).toBeFalsy()
    expect(findParent(items, '10')).toMatchObject({ label: 'Aviation Job' })
  })

  test('a user with no air access gets no Aviation Job section at all', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'aviation' })
    jwt_decode.mockReturnValue({ designation: 'employee', access: 'Commodity' })

    const items = setAccesLevels(jest.fn(), false)

    expect(findParent(items, '10')).toBeFalsy()
    expect(findParent(items, '2')).toBeTruthy() // Setup is always present
  })

  test('an unknown operationMode cookie falls back to freight rather than hiding sections', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'not-a-mode' })
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })

    const items = setAccesLevels(jest.fn(), false)

    expect(findParent(items, '4')).toBeTruthy()
    expect(findParent(items, '7')).toBeTruthy()
  })

  // Ports ('2-10'), Destinations ('2-11') and Voyage ('2-4') are the sea-only
  // master lists. Airports ('2-12') is the one an airline actually uses and
  // must survive.
  test('Setup drops the sea-only lists but keeps Airports', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'aviation' })
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })

    const setup = findParent(setAccesLevels(jest.fn(), false), '2')

    expect(findChild(setup, '2-10')).toBeFalsy()
    expect(findChild(setup, '2-11')).toBeFalsy()
    expect(findChild(setup, '2-4')).toBeFalsy()
    expect(findChild(setup, '2-12')).toMatchObject({ label: 'Airports' })
  })

  // Key '10' is the Aviation Job section - the airline's own job type. It
  // exists only in this mode; a freight install must never see it.
  test('the Aviation Job section is present, and listed first', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'aviation' })
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })

    const items = setAccesLevels(jest.fn(), false)

    expect(findParent(items, '10')).toMatchObject({ label: 'Aviation Job' })
    expect(items[0].key).toBe('10')
  })

  test('freight mode has no Aviation Job section', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'freight' })
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })

    expect(findParent(setAccesLevels(jest.fn(), false), '10')).toBeFalsy()
  })

  test('freight mode keeps every Setup list, sea ones included', () => {
    cookies({ token: 'valid.jwt.token', operationMode: 'freight' })
    jwt_decode.mockReturnValue({ designation: 'admin', access: 'admin' })

    const setup = findParent(setAccesLevels(jest.fn(), false), '2')

    expect(findChild(setup, '2-10')).toMatchObject({ label: 'Ports' })
    expect(findChild(setup, '2-11')).toMatchObject({ label: 'Destinations' })
    expect(findChild(setup, '2-4')).toMatchObject({ label: 'Voyage' })
    expect(findChild(setup, '2-12')).toMatchObject({ label: 'Airports' })
  })
})
