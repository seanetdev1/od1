import { expandNames, toNames, toggle, setRow, modulesFor } from 'functions/permissionGrid'

// A slice of GET /authRoutes/permissionCatalog.
const catalog = {
  actions: { view: 'View', edit: 'Create & edit', delete: 'Delete', approve: 'Approve' },
  modules: [
    { key: 'seaExport', group: 'Operations', label: 'Sea export jobs', actions: ['view', 'edit', 'delete', 'approve'], modes: ['freight'], legacy: ['ExSea'] },
    { key: 'customs', group: 'Operations', label: 'Customs', actions: ['view', 'edit', 'delete', 'approve'], modes: ['customs'], legacy: ['ExSea', 'ImSea'] },
    { key: 'parties', group: 'Setup', label: 'Parties', actions: ['view', 'edit', 'delete'], modes: null, legacy: ['ClientList'] },
    { key: 'invoices', group: 'Accounts', label: 'Invoices', actions: ['view', 'edit', 'delete', 'approve'], modes: null, legacy: ['Invoice/Bills'] },
  ],
}

describe('permission grid model', () => {
  test('a legacy name ticks every action of its module, plus the party baseline everyone had', () => {
    const { admin, perms } = expandNames(['ExSea'], catalog)
    expect(admin).toBe(false)
    expect([...perms]).toEqual(expect.arrayContaining(['seaExport:view', 'seaExport:approve', 'parties:view', 'parties:edit']))
    expect(perms.has('parties:delete')).toBe(false)
  })

  test('a user saved through the grid gets exactly what is ticked - no baseline', () => {
    const { perms } = expandNames(['perm:invoices:view'], catalog)
    expect([...perms]).toEqual(['invoices:view'])
  })

  test('saving writes perm: names, dropping modules this install does not run', () => {
    const state = expandNames(['ExSea'], catalog)
    const names = toNames(state, catalog, 'freight')
    expect(names).toContain('perm:seaExport:edit')
    expect(names.some((n) => n.startsWith('perm:customs:'))).toBe(false)
    expect(toNames({ admin: true, perms: new Set() }, catalog, 'freight')).toEqual(['admin'])
  })

  test('any action brings view with it, and dropping view clears the row', () => {
    let p = toggle(new Set(), 'invoices', 'approve', true)
    expect([...p].sort()).toEqual(['invoices:approve', 'invoices:view'])
    p = toggle(p, 'invoices', 'view', false)
    expect(p.size).toBe(0)
  })

  test('a row can be ticked whole', () => {
    const row = catalog.modules.find((m) => m.key === 'parties')
    expect(setRow(new Set(), row, true).size).toBe(3)
    expect(setRow(new Set(['parties:view', 'invoices:view']), row, false)).toEqual(new Set(['invoices:view']))
  })

  test('only the modules for the install\'s mode are offered', () => {
    expect(modulesFor(catalog, 'customs').map((m) => m.key)).toEqual(['customs', 'parties', 'invoices'])
  })
})

/* THE CATALOG OF 2026-10-10: job charges apart from the job, and Parties as
   Non-GL, Customers and Vendors. The grid reads older names by the rules the
   catalog sends - the same ones the server enforces. */
describe('the catalog with job charges and the three kinds of party', () => {
  const v2 = {
    actions: catalog.actions,
    modules: [
      { key: 'seaExport', group: 'Operations', label: 'Sea export jobs', actions: ['view', 'edit', 'delete', 'approve'], modes: ['freight'], legacy: ['ExSea'] },
      { key: 'jobCharges', group: 'Operations', label: 'Job charges', actions: ['view', 'edit', 'delete', 'approve'], modes: null, legacy: ['ExSea'] },
      { key: 'nonGlParties', group: 'Setup', label: 'Parties - Non-GL', actions: ['view', 'edit', 'delete'], modes: null, legacy: ['NonGLParties'] },
      { key: 'customers', group: 'Setup', label: 'Parties - Customers', actions: ['view', 'edit', 'delete'], modes: null, legacy: ['ClientList'] },
      { key: 'vendors', group: 'Setup', label: 'Parties - Vendors', actions: ['view', 'edit', 'delete'], modes: null, legacy: ['VendorList'] },
    ],
    aliases: { parties: ['nonGlParties', 'customers', 'vendors'] },
    carryToCharges: { from: ['seaExport'], to: 'jobCharges' },
    marker: 'perm:catalog:2',
    baseline: ['nonGlParties:view', 'nonGlParties:edit', 'customers:view', 'customers:edit', 'vendors:view', 'vendors:edit'],
  }

  test('a grant of the old Parties is a grant of each kind', () => {
    const { perms } = expandNames(['perm:parties:view', 'perm:catalog:2'], v2)
    expect([...perms].sort()).toEqual(['customers:view', 'nonGlParties:view', 'vendors:view'])
  })

  test('rows saved before job charges had a module: the job rights cover the charges until saved again', () => {
    const { perms } = expandNames(['perm:seaExport:view', 'perm:seaExport:edit'], v2)
    expect(perms.has('jobCharges:view') && perms.has('jobCharges:edit')).toBe(true)
    expect(perms.has('jobCharges:approve')).toBe(false)
  })

  test('saved through the grid, the rows stand as ticked - no charges unless ticked', () => {
    const names = toNames({ admin: false, perms: new Set(['seaExport:view', 'seaExport:edit']) }, v2, 'freight')
    expect(names).toEqual(['perm:seaExport:edit', 'perm:seaExport:view', 'perm:catalog:2'])
    expect(expandNames(names, v2).perms.has('jobCharges:view')).toBe(false)
  })

  test('a user on legacy names only: every kind of party to view and edit, and the charges of their jobs', () => {
    const { perms } = expandNames(['ExSea'], v2)
    expect(perms.has('customers:edit') && perms.has('vendors:edit') && perms.has('nonGlParties:edit')).toBe(true)
    expect(perms.has('jobCharges:approve')).toBe(true)
  })
})

/* Job invoices off job charges (2026-10-20): someone may enter charges and
   raise invoices without editing or approving them. The catalog the server
   sends since then. */
describe('the catalog with job invoices apart from job charges', () => {
  const v3 = {
    actions: { view: 'View', raise: 'Raise', edit: 'Create & edit', delete: 'Delete', approve: 'Approve' },
    modules: [
      { key: 'seaExport', group: 'Operations', label: 'Sea export jobs', actions: ['view', 'edit', 'delete', 'approve'], modes: ['freight'], legacy: ['ExSea'] },
      { key: 'jobCharges', group: 'Operations', label: 'Job charges', actions: ['view', 'edit', 'approve'], modes: null, legacy: ['ExSea'] },
      { key: 'jobInvoices', group: 'Operations', label: 'Job invoices & bills', actions: ['view', 'raise', 'edit', 'delete', 'approve'], modes: null, legacy: ['ExSea'] },
    ],
    aliases: {},
    carryToCharges: { from: ['seaExport'], to: 'jobCharges', actions: ['view', 'edit', 'delete', 'approve'] },
    splitInvoices: { from: 'jobCharges', to: 'jobInvoices', actions: { view: ['view'], edit: ['raise', 'edit'], delete: ['delete'], approve: ['approve'] } },
    chargesMarkers: ['perm:catalog:2', 'perm:catalog:3'],
    marker: 'perm:catalog:3',
    baseline: [],
  }
  const sorted = (names) => [...expandNames(names, v3).perms].sort()

  test('rows saved before the split: the charges rights cover the invoices, until saved again', () => {
    expect(sorted(['perm:jobCharges:view', 'perm:jobCharges:edit', 'perm:catalog:2'])).toEqual([
      'jobCharges:edit', 'jobCharges:view', 'jobInvoices:edit', 'jobInvoices:raise', 'jobInvoices:view',
    ])
  })

  test('and from before the charges had a module, the job rights carry all the way - Delete included', () => {
    expect(sorted(['perm:seaExport:view', 'perm:seaExport:delete'])).toEqual(expect.arrayContaining(['jobInvoices:view', 'jobInvoices:delete']))
  })

  test('saved since, exactly what is ticked: raise without edit or approve', () => {
    const names = toNames({ admin: false, perms: new Set(['jobCharges:view', 'jobCharges:edit', 'jobInvoices:view', 'jobInvoices:raise']) }, v3, 'freight')
    expect(names).toContain('perm:catalog:3')
    expect(sorted(names)).toEqual(['jobCharges:edit', 'jobCharges:view', 'jobInvoices:raise', 'jobInvoices:view'])
  })

  test('a marker is never a box', () => {
    expect(sorted(['perm:jobCharges:view', 'perm:catalog:2', 'perm:catalog:3'])).toEqual(['jobCharges:view'])
  })
})

describe('what the signed-in user may do - functions/myPermissions', () => {
  const { checker } = require('functions/myPermissions')

  test('by their grants; full access is everything', () => {
    const can = checker({ all: false, granular: true, perms: new Set(['jobCharges:view']) })
    expect(can('jobCharges', 'view')).toBe(true)
    expect(can('jobCharges', 'edit')).toBe(false)
    expect(can.granular).toBe(true)
    expect(checker({ all: true, perms: new Set() })('vendors', 'edit')).toBe(true)
  })

  test('not known yet, or not to be had: everything is offered - the server still decides', () => {
    expect(checker(null)('jobCharges', 'edit')).toBe(true)
    expect(checker(null).granular).toBe(false)
  })
})

/* Unapprove off Approve (the user's request, 2026-10-24): an operator raises
 * invoices approved and cannot take them back out of the ledger. */
describe('Unapprove, apart from Approve', () => {
  const now = {
    actions: { view: 'View', raise: 'Raise', edit: 'Create & edit', delete: 'Delete', approve: 'Approve', unapprove: 'Unapprove' },
    modules: [
      { key: 'jobInvoices', group: 'Operations', label: 'Job invoices & bills', actions: ['view', 'raise', 'edit', 'delete', 'approve', 'unapprove'], modes: null, legacy: [] },
      { key: 'invoices', group: 'Accounts', label: 'Invoices & bills', actions: ['view', 'edit', 'delete', 'approve', 'unapprove'], modes: null, legacy: ['Invoice/Bills'] },
    ],
    splitUnapprove: { modules: ['jobInvoices', 'invoices'], from: 'approve', to: 'unapprove' },
    invoicesMarkers: ['perm:catalog:3', 'perm:catalog:4'],
    chargesMarkers: ['perm:catalog:2', 'perm:catalog:3', 'perm:catalog:4'],
    marker: 'perm:catalog:4',
  }

  test('saved before it, an invoice Approve shows Unapprove ticked too - saving keeps it', () => {
    const state = expandNames(['perm:invoices:view', 'perm:invoices:approve', 'perm:catalog:3'], now)
    expect(state.perms.has('invoices:unapprove')).toBe(true)
    expect(toNames(state, now, 'freight')).toEqual(expect.arrayContaining(['perm:invoices:unapprove', 'perm:catalog:4']))
  })

  test('saved since, Approve without Unapprove sticks', () => {
    const state = expandNames(['perm:jobInvoices:view', 'perm:jobInvoices:approve', 'perm:catalog:4'], now)
    expect(state.perms.has('jobInvoices:approve')).toBe(true)
    expect(state.perms.has('jobInvoices:unapprove')).toBe(false)
  })

  test('the markers are never shown as boxes', () => {
    const state = expandNames(['perm:invoices:view', 'perm:catalog:3', 'perm:catalog:4'], now)
    expect([...state.perms]).toEqual(['invoices:view'])
  })
})
