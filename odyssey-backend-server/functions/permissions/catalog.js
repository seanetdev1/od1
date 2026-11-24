// WHAT A USER CAN BE ALLOWED TO DO: modules, and the actions on each.
//
// The single source of truth. The server checks requests against it
// (functions/permissions/routeRules.js), and the employee screen draws its
// permission grid from it (GET /authRoutes/permissionCatalog), so the two can
// never list different things.
//
// A grant is stored as an Access_Levels row, as access levels always were:
//   'perm:<module>:<action>'  - one action on one module (the new grid), or
//   a LEGACY name ('ExSea', 'Invoice/Bills', ...) - what the old multi-select
//   wrote, which still means every action on the module(s) it maps to below.
//   Nobody loses anything they had; an edit through the new grid rewrites a
//   user's legacy names as the 'perm:' rows they stand for.
//   'admin'                   - everything, as before.
//
// The legacy names are also what the sidebar reads from the session token, so
// at sign-in a user's grants are folded back into them (legacyNamesFor in
// grants.js) and the menu needs no change.

// The grid's columns, in this order. RAISE is job invoices' alone: making an
// invoice or bill from a job's charges, apart from editing one once it is
// made (the user's request, 2026-10-20).
const ACTIONS = {
  view: 'View',
  raise: 'Raise',
  edit: 'Create & edit',
  delete: 'Delete',
  approve: 'Approve',
  // Taking an approval back - apart from giving it (the user's request,
  // 2026-10-24): an operator raises invoices approved, straight into the
  // ledger, and may not take them out of it again.
  unapprove: 'Unapprove',
};

const VED = ['view', 'edit', 'delete'];
const VEDA = ['view', 'edit', 'delete', 'approve'];
const V = ['view'];

const MODULES = [
  // ---- Operations
  { key: 'seaExport', group: 'Operations', label: 'Sea export jobs', actions: VEDA, legacy: ['ExSea'], modes: ['freight'] },
  { key: 'seaImport', group: 'Operations', label: 'Sea import jobs', actions: VEDA, legacy: ['ImSea'], modes: ['freight'] },
  { key: 'airExport', group: 'Operations', label: 'Air export jobs', actions: VEDA, legacy: ['ExAir'], modes: ['freight'] },
  { key: 'airImport', group: 'Operations', label: 'Air import jobs', actions: VEDA, legacy: ['ImAir'], modes: ['freight'] },
  { key: 'manifest', group: 'Operations', label: 'Air manifests', actions: VED, legacy: ['manifest'], modes: ['freight'] },
  { key: 'aviation', group: 'Operations', label: 'Flights & PFM', actions: VEDA, legacy: ['ExAir', 'ImAir'], modes: ['aviation'] },
  { key: 'customs', group: 'Operations', label: 'Customs jobs & Program Book', actions: VEDA, legacy: ['ExSea', 'ImSea', 'ExAir', 'ImAir'], modes: ['customs'] },
  // A JOB'S CHARGES, apart from its details (the user's request, 2026-10-10),
  // and since 2026-10-20 apart from the INVOICES raised from them too - someone
  // may enter charges and raise invoices without editing or approving those
  // invoices. On every kind of job. The job modules above are the job itself.
  //
  //   jobCharges   the charge sheet. Approve is approving charge lines.
  //   jobInvoices  the invoices and bills made from it: Raise makes one, Create
  //                & edit changes one already made - its currency, date, round
  //                off, note, or a charge line on it while it is unapproved -
  //                Approve approves it into the ledger and takes it back out.
  //
  // Whoever had a job module by a legacy name has both, as they always had.
  // menu: [] - both are tabs inside a job, not menus of their own, so they put
  // no menu names in the session (grants.legacyNamesFor).
  { key: 'jobCharges', group: 'Operations', label: 'Job charges', actions: ['view', 'edit', 'approve'], legacy: ['ExSea', 'ImSea', 'ExAir', 'ImAir'], menu: [] },
  { key: 'jobInvoices', group: 'Operations', label: 'Job invoices & bills', actions: ['view', 'raise', 'edit', 'delete', 'approve', 'unapprove'], legacy: ['ExSea', 'ImSea', 'ExAir', 'ImAir'], menu: [] },

  // ---- Setup
  // PARTIES BY KIND (the user's request, 2026-10-10), as Setup > Parties
  // creates them - a name-only Non-GL party, a Customer with a receivable
  // ledger, a Vendor with a payable one. One 'parties' module before; a grant
  // of it stands for all three (ALIASES).
  { key: 'nonGlParties', group: 'Setup', label: 'Parties - Non-GL', actions: VED, legacy: ['NonGLParties'] },
  { key: 'customers', group: 'Setup', label: 'Parties - Customers (AR)', actions: VED, legacy: ['ClientList'] },
  { key: 'vendors', group: 'Setup', label: 'Parties - Vendors (AP)', actions: VED, legacy: ['VendorList'] },
  { key: 'commodity', group: 'Setup', label: 'Commodities', actions: VED, legacy: ['Commodity'] },
  { key: 'vessels', group: 'Setup', label: 'Vessels & voyages', actions: VED, legacy: ['Voyage'], modes: ['freight'] },
  { key: 'charges', group: 'Setup', label: 'Charges & charge groups', actions: VED, legacy: ['Charges'] },
  { key: 'locations', group: 'Setup', label: 'Ports, destinations & airports', actions: VED, legacy: ['Ports', 'Destinations', 'Airports'] },
  { key: 'awb', group: 'Setup', label: 'AWB numbers & stock, carriers, aircraft', actions: VED, legacy: ['AWBL', 'Airports'] },

  // ---- Accounts
  { key: 'coa', group: 'Accounts', label: 'Chart of accounts', actions: VED, legacy: ['ChartOfAccount'] },
  { key: 'invoices', group: 'Accounts', label: 'Invoices & bills', actions: [...VEDA, 'unapprove'], legacy: ['Invoice/Bills'] },
  { key: 'payments', group: 'Accounts', label: 'Payments & receipts', actions: VED, legacy: ['Payment/Reciept'] },
  { key: 'vouchers', group: 'Accounts', label: 'Vouchers', actions: VEDA, legacy: ['Voucher', 'VoucherList', 'OfficeVoucherList'] },
  { key: 'directJob', group: 'Accounts', label: 'Direct Job E/R', actions: VED, legacy: ['DirectJobList'] },
  { key: 'openingBalances', group: 'Accounts', label: 'Opening balances & invoices', actions: VED, legacy: ['OpeningBalances', 'OpeningInvoises'] },

  // ---- Reports (view only)
  { key: 'rptJobBalancing', group: 'Reports', label: 'Job balancing & operations reports', actions: V, legacy: ['JobBalancing'] },
  { key: 'rptAccountActivity', group: 'Reports', label: 'Account activity', actions: V, legacy: ['AccountActivity'] },
  { key: 'rptBalanceSheet', group: 'Reports', label: 'Balance sheet', actions: V, legacy: ['BalanceSheet'] },
  { key: 'rptJobPL', group: 'Reports', label: 'Job profit & loss', actions: V, legacy: ['JobProfit/Loss'] },
  { key: 'rptLedger', group: 'Reports', label: 'Ledger', actions: V, legacy: ['Ledger'] },
  { key: 'rptAgent', group: 'Reports', label: 'Agent balance & international report', actions: V, legacy: ['AgentInvBalance'] },
  { key: 'rptTrialBalance', group: 'Reports', label: 'Trial balance & VAT detail', actions: V, legacy: ['TrialBalance'] },
  { key: 'rptIncomeStatement', group: 'Reports', label: 'Income statement', actions: V, legacy: ['IncomeStatement'] },
  { key: 'rptAgeing', group: 'Reports', label: 'Ageing', actions: V, legacy: ['ageingReport'] },
  { key: 'rptAuditLog', group: 'Reports', label: 'Audit log', actions: V, legacy: ['auditLog'] },
  { key: 'rptReconciliation', group: 'Reports', label: 'Climax reconciliation', actions: V, legacy: ['climaxReconciliation'] },
  // THE ARCHIVE (2026-11-11): reading the old Climax books an install
  // keeps beside its own (routes/archive). New, so no legacy name stands for
  // it; `menu` is the name the sidebar reads. `requires`: offered in the grid
  // only on an install that has archive books (functions/archive/books).
  { key: 'archive', group: 'Reports', label: 'Archive (old books)', actions: V, menu: ['Archive'], requires: 'archive' },
];

const MODULE_KEYS = new Set(MODULES.map((m) => m.key));
const byKey = Object.fromEntries(MODULES.map((m) => [m.key, m]));

const PERM_PREFIX = 'perm:';
const permName = (module, action) => `${PERM_PREFIX}${module}:${action}`;

// Groups of modules that routes are commonly shared between.
const FREIGHT_JOBS = ['seaExport', 'seaImport', 'airExport', 'airImport'];
const ALL_JOBS = [...FREIGHT_JOBS, 'aviation', 'customs'];
const PARTY_MODULES = ['nonGlParties', 'customers', 'vendors'];

/* WHAT AN OLDER GRANT STILL MEANS - the catalog changed on 2026-10-10.
 *
 *   ALIASES  a module that was split: a grant of it is a grant of each part.
 *
 *   Saved through the grid before then, a user's rows hold no jobCharges -
 *   their job rights covered the charges. Until they are saved again, each
 *   job right they have is the same right on jobCharges (CARRY_TO_CHARGES).
 *   A save through the grid writes CATALOG_MARKER with the rows, which says
 *   the rows are complete as they stand - so unticking every charges box
 *   sticks, rather than being filled back in from the job rights. */
const ALIASES = { parties: PARTY_MODULES };
// `actions`: what jobCharges had when it was made - Delete included, which
// meant deleting a job's invoice and so carries on to jobInvoices (below).
const CARRY_TO_CHARGES = { from: ALL_JOBS, to: 'jobCharges', actions: VEDA };

/* THE INVOICES CAME OFF jobCharges ON 2026-10-20. Rows saved before then hold
 * jobCharges rights that covered the invoices too, so until the user is saved
 * again each one still stands for its share of jobInvoices: View for View,
 * Create & edit for Raise and Create & edit, Delete (deleting a job's invoice -
 * jobCharges has no Delete of its own now) and Approve for theirs.
 *
 * The markers say which of these a user's rows are already complete for:
 * 'catalog:2' (saved 2026-10-10 to 2026-10-20) for the job rights -> charges
 * carry only; 'catalog:3', written by every save from now on, for both. */
const SPLIT_INVOICES = {
  from: 'jobCharges',
  to: 'jobInvoices',
  actions: { view: ['view'], edit: ['raise', 'edit'], delete: ['delete'], approve: ['approve'] },
};
/* UNAPPROVE CAME OFF APPROVE ON 2026-10-24 (the user's request): an invoice's
 * Approve used to take the approval back too. Rows saved before then keep
 * that until the user is saved again - each invoice Approve still stands for
 * Unapprove - so nobody loses a right on the upgrade. 'catalog:4', written by
 * every save from now on, says the rows are complete for this too. */
const SPLIT_UNAPPROVE = { modules: ['jobInvoices', 'invoices'], from: 'approve', to: 'unapprove' };

const CATALOG_MARKER = 'catalog:4';
// Rows complete for the job rights -> charges carry, and for the invoices
// split, respectively - every marker since each one.
const CHARGES_MARKERS = ['catalog:2', 'catalog:3', 'catalog:4'];
const INVOICES_MARKERS = ['catalog:3', 'catalog:4'];

// Legacy freight operation codes on SE_Job.operation.
const OPERATION_MODULE = { SE: 'seaExport', SI: 'seaImport', AE: 'airExport', AI: 'airImport' };

module.exports = {
  ACTIONS,
  MODULES,
  MODULE_KEYS,
  byKey,
  PERM_PREFIX,
  permName,
  FREIGHT_JOBS,
  ALL_JOBS,
  PARTY_MODULES,
  OPERATION_MODULE,
  ALIASES,
  CARRY_TO_CHARGES,
  SPLIT_INVOICES,
  SPLIT_UNAPPROVE,
  INVOICES_MARKERS,
  CATALOG_MARKER,
  CHARGES_MARKERS,
};
