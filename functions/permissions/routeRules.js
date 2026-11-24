// WHAT EACH ROUTE NEEDS. Every route the app registers has an entry here -
// tests/integration/permissionRules.test.js walks Express's own route table and
// fails on any that does not - so access control is complete by construction
// rather than by remembering.
//
// A rule is one of:
//   OPEN    any signed-in user. Pickers (the party, account, charge and port
//           lists nearly every screen fills a dropdown from), settings reads,
//           the dashboard, and routes whose handler already checks the
//           designation itself (requireDesignation) - those keep that check
//           and are not gated twice.
//   SYSTEM  Seanet only (functions/systemAccess.js). Config writes, migration,
//           user management, and developer/repair endpoints no screen calls.
//           The handlers check it too.
//   [...]   'module:action' alternatives - the user needs ANY one of them.
//           Derived from which screens call the route: a job screen raises and
//           approves its own invoices, so the invoice routes accept the job
//           modules as well as 'invoices'.
//   fn      (req) => alternatives, for a route that says in the request which
//           module it is about (the freight job list's ?operation=SE).
//
// The modules and actions are in ./catalog.js.

const { FREIGHT_JOBS, ALL_JOBS, OPERATION_MODULE, PARTY_MODULES } = require('./catalog');

// companySeparation table -> the module(s) whose edit right shares its records
const TABLE_MODULE = { coa: 'coa', parties: PARTY_MODULES, charges: 'charges', chargeGroups: 'charges', commodity: 'commodity', vessels: 'vessels' };

const OPEN = 'open';
const SYSTEM = 'system';

const can = (action) => (...modules) => modules.flat().map((m) => `${m}:${action}`);
const view = can('view');
const edit = can('edit');
const del = can('delete');
const approve = can('approve');
// Taking an invoice's approval back - its own right since 2026-10-24.
const unapprove = can('unapprove');
const any = (...lists) => [...new Set(lists.flat())];

// The reports that open an invoice or a voucher when you click a row.
const LINKING_REPORTS = ['rptJobBalancing', 'rptLedger', 'rptAccountActivity', 'rptAgeing', 'rptAgent', 'rptJobPL'];
// A job's own screens read its invoices and charge lines too - the job
// details lock themselves once charges are approved, so they must be able to
// see whether they are. Changing them is jobCharges' and jobInvoices' (below).
const INVOICE_READERS = view('invoices', 'payments', 'jobCharges', 'jobInvoices', ALL_JOBS, LINKING_REPORTS);
// THE CHARGE SHEET - jobCharges, apart from the job's details (the user's
// request, 2026-10-10), or the invoices module.
const CHARGE_DOCS = ['jobCharges', 'invoices'];
// THE INVOICES AND BILLS RAISED FROM IT - jobInvoices, apart from the charges
// (the user's request, 2026-10-20: raising one is not editing or approving
// it), or the invoices module.
const INVOICE_DOCS = ['jobInvoices', 'invoices'];
// Making one from a job's charges: jobInvoices' Raise, or the invoices
// module's Create & edit, which has always included it.
const RAISE = any(can('raise')('jobInvoices'), edit('invoices'));

// PARTIES BY KIND (the user's request, 2026-10-10): the right on the kind of
// party a request is about - functions/partyKind. Read when the rule is.
let partyKindFns;
const partyKind = () => (partyKindFns = partyKindFns || require('../partyKind'));
const models = () => require('../../models');
// A new party: a ledger under a receivable parent makes a customer, under a
// payable one a vendor; no ledger, a Non-GL party. A job screen may add one
// too - only a name-only one unless the ledger gate in routes/clients passes.
const partyCreate = async (req) => {
  const { sideOfAccount, MODULE_OF_KIND } = partyKind();
  const parent = req.body?.pAccountName;
  const kind = parent ? (await sideOfAccount(models(), parent)) || 'customer' : 'nonGl';
  return [`${MODULE_OF_KIND[kind]}:edit`, ...edit(ALL_JOBS)];
};
// An existing party: the right on the kind it is.
const partyEdit = async (req) => {
  const { partyKinds, MODULE_OF_KIND } = partyKind();
  const id = req.body?.data?.id ?? req.body?.id;
  const kind = id ? (await partyKinds(models(), [id])).get(Number(id)) : null;
  return kind ? [`${MODULE_OF_KIND[kind]}:edit`] : edit(PARTY_MODULES);
};
const VOUCHER_READERS = view('vouchers', 'payments', 'openingBalances', 'directJob', LINKING_REPORTS);

// Freight job routes that name the operation (SE/SI/AE/AI) narrow to its module.
const freightFrom = (pick, action) => (req) => {
  const m = OPERATION_MODULE[String(pick(req) || '').toUpperCase()];
  return m ? [`${m}:${action}`] : can(action)(FREIGHT_JOBS);
};

const RULES = {
  // ---------------------------------------------------------------- public / session
  'GET /': OPEN,
  'GET /health': OPEN,
  'GET /getUser': OPEN,
  'POST /authRoutes/login': OPEN,
  'POST /authRoutes/systemLogin': OPEN,
  'POST /authRoutes/logout': OPEN,
  'GET /authRoutes/verifyLogin': OPEN,
  'POST /authRoutes/changePassword': OPEN,
  'GET /authRoutes/permissionCatalog': OPEN,
  'GET /authRoutes/myPermissions': OPEN,
  'GET /license/info': OPEN,     // admin designation, checked in the route
  'GET /license/status': OPEN,
  'GET /notifications/getAllNotifications': OPEN,
  'GET /notifications/unreadCount': OPEN,
  // The handler checks the designation is picked (functions/newJobAlerts).
  'GET /notifications/newJobs': OPEN,
  // Each list only for a user who may see its records (functions/bellAlerts).
  'GET /notifications/alerts': OPEN,
  // The header's search: each kind only for a user who may see it (functions/globalSearch).
  'GET /search': OPEN,
  'POST /notifications/markRead': OPEN,
  'POST /notifications/sendNotification': OPEN,
  'POST /notifications/updateNotification': OPEN,

  // ---------------------------------------------------------------- dashboard
  'GET /home/accounts/get': OPEN,
  'GET /home/getCashFlow': OPEN,
  'GET /home/getCashFlowTwo': OPEN,
  'GET /home/getDashboard': OPEN,
  'GET /home/operatrions/get': OPEN,
  // Each widget's route also checks the user's designation is ticked for it
  // (functions/dashboardWidgets) - Configuration > Dashboard Widgets.
  'GET /home/widgets': OPEN,
  'GET /aviationJob/dashboard': OPEN,
  'GET /customsJob/dashboard': OPEN,
  'GET /seaJob/getAllNotes': OPEN,

  // ---------------------------------------------------------------- settings (Config)
  'GET /settings/operationMode': OPEN,
  'GET /settings/costCenter': OPEN,
  'GET /settings/ledgerAccounts': OPEN,
  'GET /settings/partyAccounts': OPEN,
  'GET /settings/documentNumbering': OPEN,
  'GET /settings/reportColumns/:report': OPEN,
  'GET /settings/invoiceRoundOff': OPEN,
  'GET /settings/invoicePrint': OPEN,
  'GET /settings/directJobDefaultType': OPEN,
  'GET /settings/uniqueJobCharges': OPEN,
  'GET /settings/customsPlanning': OPEN,
  'GET /settings/customsDocumentsOnGd': OPEN,
  'GET /settings/customsChargeTabs': OPEN,
  'GET /settings/customsStatuses': OPEN,
  'GET /settings/customsJobForm': OPEN,
  'GET /settings/gstNumberFormat': OPEN,
  'GET /settings/permissionsMode': OPEN,
  'GET /settings/companySeparation': OPEN,
  'GET /settings/jobBalancingAdvances': OPEN,
  'GET /settings/reportDates': OPEN,
  'GET /settings/dashboardWidgets': SYSTEM,
  'GET /settings/newJobAlerts': SYSTEM,
  'GET /settings/bellAlertLists': SYSTEM,
  'GET /settings/bellAlertDays': SYSTEM,
  'GET /settings/emailConfig': SYSTEM,
  'GET /settings/permissionDenials': SYSTEM,
  'POST /settings/operationMode': SYSTEM,
  'POST /settings/costCenter': SYSTEM,
  'POST /settings/ledgerAccounts': SYSTEM,
  'POST /settings/partyAccounts': SYSTEM,
  'POST /settings/documentNumbering': SYSTEM,
  'POST /settings/emailConfig': SYSTEM,
  'POST /settings/emailConfig/test': SYSTEM,
  'POST /settings/reportColumns/:report': SYSTEM,
  'POST /settings/invoiceRoundOff': SYSTEM,
  'POST /settings/invoicePrint': SYSTEM,
  'POST /settings/directJobDefaultType': SYSTEM,
  'POST /settings/uniqueJobCharges': SYSTEM,
  'POST /settings/customsPlanning': SYSTEM,
  'POST /settings/customsDocumentsOnGd': SYSTEM,
  'POST /settings/customsChargeTabs': SYSTEM,
  'POST /settings/customsStatuses': SYSTEM,
  'POST /settings/customsJobForm': SYSTEM,
  'POST /settings/gstNumberFormat': SYSTEM,
  'POST /settings/permissionsMode': SYSTEM,
  'POST /settings/companySeparation': SYSTEM,
  'POST /settings/jobBalancingAdvances': SYSTEM,
  'POST /settings/reportDates': SYSTEM,
  'POST /settings/dashboardWidgets': SYSTEM,
  'POST /settings/newJobAlerts': SYSTEM,
  'POST /settings/bellAlertLists': SYSTEM,
  'POST /settings/bellAlertDays': SYSTEM,
  'POST /settings/permissionDenials/clear': SYSTEM,

  // ---------------------------------------------------------------- credit control
  // Blocked parties are read and checked by every job screen, and anyone
  // picking one may ask for it. The approvers' routes check the approver
  // designations (Config > Credit Control) in the handler; the settings and
  // the runs are Config's.
  'GET /creditControl/blocked': OPEN,
  'POST /creditControl/check': OPEN,
  'POST /creditControl/requestUnblock': OPEN,
  'GET /creditControl/overview': OPEN,
  'GET /creditControl/requests': OPEN,
  'POST /creditControl/decide': OPEN,
  'POST /creditControl/allow': OPEN,
  'POST /creditControl/reblock': OPEN,
  'GET /creditControl/partyInvoices': OPEN,
  'POST /creditControl/omit': OPEN,
  'POST /creditControl/omitBefore': OPEN,
  'GET /creditControl/omitted': OPEN,
  'GET /creditControl/settings': SYSTEM,
  'POST /creditControl/settings': SYSTEM,
  'POST /creditControl/run': SYSTEM,
  'GET /creditControl/log': SYSTEM,

  // ---------------------------------------------------------------- WhatsApp daily update (Config)
  'GET /whatsapp/settings': SYSTEM,
  'POST /whatsapp/settings': SYSTEM,
  'POST /whatsapp/run': SYSTEM,
  'GET /whatsapp/log': SYSTEM,

  // ---------------------------------------------------------------- companies
  'GET /companies/getAllCompanies': OPEN,
  'GET /companies/mine': OPEN,
  'GET /companies/visibility': OPEN,
  // Sharing a record needs the edit right on its table.
  'POST /companies/visibility': (req) => {
    const module = TABLE_MODULE[String(req.body?.table)];
    return module ? [].concat(module).map((m) => `${m}:edit`) : [];
  },
  'GET /companies/bankAccount/byCompany/:companyId': OPEN,   // invoice prints read the bank block
  'POST /companies/createCompany': SYSTEM,
  'POST /companies/editCompany': SYSTEM,
  'POST /companies/deleteCompany': SYSTEM,
  'POST /companies/bankAccount/create': SYSTEM,
  'POST /companies/bankAccount/edit': SYSTEM,
  'POST /companies/bankAccount/setDefault': SYSTEM,
  'POST /companies/bankAccount/delete': SYSTEM,
  'POST /companies/uploadCompanies': SYSTEM,
  'GET /companies/migration/verify': SYSTEM,
  'POST /companies/migration/plan': SYSTEM,
  'POST /companies/migration/apply': SYSTEM,

  // ---------------------------------------------------------------- employees
  'GET /employeeRoutes/getEmployeesIdAndName': OPEN,
  'GET /employeeRoutes/getRepresentativeEmployees': OPEN,
  'GET /employeeRoutes/getManagers': OPEN,
  'GET /employeeRoutes/allRiders': OPEN,
  'GET /employeeRoutes/getEmployees': OPEN,   // CEO/CFO/admin, checked in the route
  'POST /employeeRoutes/createEmployee': SYSTEM,
  'POST /employeeRoutes/editEmployee': SYSTEM,
  'POST /employeeRoutes/uploadEmployees': SYSTEM,
  'GET /employeeRoutes/migration/users/verify': SYSTEM,
  'POST /employeeRoutes/migration/users/plan': SYSTEM,
  'POST /employeeRoutes/migration/users/apply': SYSTEM,

  // ---------------------------------------------------------------- fiscal years (CEO/CFO/admin in the route)
  'GET /fiscalYears/getAll': OPEN,
  'GET /fiscalYears/getSelectable': OPEN,
  'POST /fiscalYears/create': OPEN,
  'POST /fiscalYears/edit': OPEN,
  'POST /fiscalYears/lock': OPEN,
  'POST /fiscalYears/unlock': OPEN,

  // ---------------------------------------------------------------- tasks (manager/CEO/CFO/admin in the routes)
  // DOCUMENTS ATTACHED TO RECORDS (2026-11-13). One set of routes for every
  // kind of record, so they are checked in the route, against the RECORD's own
  // rights and company - functions/documents/kinds.js and access.js.
  'GET /documents': OPEN,
  'POST /documents/upload': OPEN,
  'GET /documents/file': OPEN,   // its own token (PUBLIC_PATHS)
  'GET /documents/:id/link': OPEN,
  'POST /documents/:id/rename': OPEN,
  'POST /documents/:id/delete': OPEN,
  // Their types, for the dropdown; the list itself and the folder they are
  // kept in are Configuration's.
  'GET /documents/types': OPEN,
  'POST /documents/types': SYSTEM,
  'GET /documents/settings': SYSTEM,
  'GET /documents/settings/browse': SYSTEM,
  'POST /documents/settings/path': SYSTEM,
  'GET /tasks/assignees': OPEN,
  'GET /tasks/dashboard': OPEN,
  'GET /tasks/getAllTasks': OPEN,
  'GET /tasks/getAssignedTasks': OPEN,
  'GET /tasks/getEmployeeTask': OPEN,
  'GET /tasks/:id/history': OPEN,
  'GET /tasks/attachments/:attachmentId': OPEN,
  'POST /tasks/:id/attachments': OPEN,
  'POST /tasks/attachments/:attachmentId/delete': OPEN,
  'POST /tasks/changeTaskStatus': OPEN,
  'POST /tasks/create': OPEN,
  'POST /tasks/createTask': OPEN,
  'POST /tasks/edit': OPEN,
  'POST /tasks/delete': OPEN,
  'POST /tasks/toggleSubTask': OPEN,
  'POST /tasks/runEscalation': OPEN,
  'GET /invoice/getTaskInvoices': OPEN,

  // ---------------------------------------------------------------- audit log
  'GET /history/getFormTypes': view('rptAuditLog'),
  'GET /history/getTypes': view('rptAuditLog'),
  'GET /history/getHistory': view('rptAuditLog', PARTY_MODULES),

  // ---------------------------------------------------------------- chart of accounts
  'GET /accounts/getAllAccounts': OPEN,
  'GET /accounts/getAllChilds': OPEN,
  'GET /accounts/getAllParents': OPEN,
  'GET /accounts/getAllParentswithChildsbyAccountId': OPEN,
  'GET /accounts/getAccountsForTransaction': OPEN,
  'GET /accounts/getAccountsForTransactionVouchers': OPEN,
  'GET /accounts/getPartySetupAccounts': OPEN,
  'GET /accounts/parentAccounts': OPEN,
  'GET /accounts/getAccount': OPEN,
  'GET /accounts/accountDeleteCheck/:id': view('coa'),
  'POST /accounts/createParentAccount': edit('coa'),
  'POST /accounts/createChildAccount': edit('coa'),
  'POST /accounts/editParentAccount': edit('coa'),
  'POST /accounts/editChildAccount': edit('coa'),
  'POST /accounts/codeParentAccount': edit('coa'),
  'POST /accounts/codeChildAccount': edit('coa'),
  'POST /accounts/deleteAccount': del('coa'),
  'GET /accounts/chartOfAccounts/seed': SYSTEM,
  'POST /accounts/chartOfAccounts/seed': SYSTEM,
  'POST /accounts/accountCreate': SYSTEM,
  'POST /accounts/importAccount': SYSTEM,
  'POST /accounts/importAccounts': SYSTEM,
  'POST /accounts/createClientInBulk': SYSTEM,
  'POST /accounts/createVendorInBulk': SYSTEM,
  'POST /accounts/nonGlInBulk': SYSTEM,
  'POST /accounts/countAll': SYSTEM,
  'POST /accounts/deleteAll': SYSTEM,
  'POST /accounts/deleteInvoices': SYSTEM,
  'POST /accounts/deleteJobs': SYSTEM,
  'POST /accounts/testDeleteVouchers': SYSTEM,
  'GET /accounts/childForJobApproval': SYSTEM,     // read Parent_Account, which no longer exists
  'GET /accounts/getSEJobChilds': SYSTEM,
  'GET /accounts/getSEJobPartyChilds': SYSTEM,
  'GET /accounts/migration/coa/verify': SYSTEM,
  'POST /accounts/migration/coa/plan': SYSTEM,
  'POST /accounts/migration/coa/apply': SYSTEM,

  // ---------------------------------------------------------------- ledger & balance reports
  'GET /accounts/getLedger': view('rptLedger'),
  'GET /accounts/getLedgerPdf': view('rptLedger'),
  'GET /accounts/getLedgerPrintData': OPEN,   // its own print token (PUBLIC_PATHS)
  'GET /accounts/getLedgerClosingBalance': view('rptLedger', 'vouchers', 'payments'),
  'GET /accounts/getByDate': view('rptLedger', 'rptAccountActivity', 'vouchers'),
  'GET /accounts/voucherLedger': view('rptLedger', 'rptAccountActivity', 'vouchers'),
  'GET /accounts/balanceSheet': view('rptBalanceSheet'),
  'GET /accounts/balanceSheetOld': view('rptBalanceSheet'),
  'GET /accounts/getOpeningBalances': view('openingBalances'),
  'POST /accounts/createOpeningBalances': edit('openingBalances'),

  // ---------------------------------------------------------------- parties
  'GET /clientRoutes/getClientsForSelect': OPEN,
  'GET /clientRoutes/getForCharges': OPEN,
  'GET /clientRoutes/getNotifyParties': OPEN,
  'GET /clientRoutes/getClientsbyType': OPEN,
  'GET /clientRoutes/getChildAccounts': OPEN,
  'GET /clientRoutes/getClientAssociations': OPEN,
  // The list shows only the kinds the user may view (routes/clients).
  'GET /clientRoutes/getClients': view(PARTY_MODULES),
  'GET /clientRoutes/getClientById': any(view(PARTY_MODULES), view(ALL_JOBS)),
  'POST /clientRoutes/createClient': partyCreate,
  'POST /clientRoutes/editClient': partyEdit,
  'POST /clientRoutes/createClientAssociations': edit('customers', 'vendors'),
  'POST /clientRoutes/findAccounts': OPEN,
  'POST /clientRoutes/addClient': OPEN,          // CEO/CFO/admin in the route
  'POST /clientRoutes/deleteClient': OPEN,       // CEO/CFO/admin in the route
  'GET /clientRoutes/mergeImpact': OPEN,         // CEO/CFO/admin in the route
  'POST /clientRoutes/mergeParty': OPEN,         // CEO/CFO/admin in the route
  'POST /clientRoutes/createClientInBulk': SYSTEM,
  'POST /clientRoutes/bulkCreate': SYSTEM,
  'GET /clientRoutes/getClientsForBackup': SYSTEM,
  'GET /clientRoutes/experimentalQuery': SYSTEM,
  'GET /clientRoutes/migration/parties/verify': SYSTEM,
  'POST /clientRoutes/migration/parties/plan': SYSTEM,
  'POST /clientRoutes/migration/parties/apply': SYSTEM,
  'GET /misc/parties/getPartiesbyType': OPEN,
  'POST /misc/parties/getBySearch': OPEN,
  'GET /nonGlParties/getParties': OPEN,
  'GET /nonGlParties/getPartiesById': OPEN,
  'POST /nonGlParties/createNonGlParty': edit('nonGlParties'),
  'POST /nonGlParties/editNonGlParty': edit('nonGlParties'),
  'POST /nonGlParties/createNonglPartiesInBulk': SYSTEM,

  // ---------------------------------------------------------------- commodity, vessels, charges, locations
  'GET /commodity/get': OPEN,
  'POST /commodity/create': any(edit('commodity'), edit(ALL_JOBS)),
  'POST /commodity/edit': edit('commodity'),
  'POST /commodity/updateCommodity': edit('commodity'),
  'POST /commodity/uploadCommodities': SYSTEM,
  'GET /commodity/migration/verify': SYSTEM,
  'POST /commodity/migration/plan': SYSTEM,
  'POST /commodity/migration/apply': SYSTEM,
  'GET /commodity/migration/hs/verify': SYSTEM,
  'POST /commodity/migration/hs/plan': SYSTEM,
  'POST /commodity/migration/hs/apply': SYSTEM,

  'GET /vessel/get': OPEN,
  'GET /vessel/getVessels': OPEN,
  'GET /vessel/list': view('vessels'),
  'POST /vessel/findVoyages': OPEN,
  'POST /vessel/create': edit('vessels'),
  'POST /vessel/edit': edit('vessels'),
  'POST /vessel/setActive': edit('vessels'),
  'POST /vessel/delete': del('vessels'),
  'POST /vessel/createVoyage': edit('vessels'),
  'POST /vessel/editVoyage': edit('vessels'),
  'POST /vessel/uploadVoyages': SYSTEM,
  'GET /vessel/migration/verify': SYSTEM,
  'POST /vessel/migration/plan': SYSTEM,
  'POST /vessel/migration/apply': SYSTEM,

  'GET /charges/get': OPEN,
  'POST /charges/create': edit('charges'),
  'POST /charges/edit': edit('charges'),
  'POST /charges/status': edit('charges'),
  'POST /charges/delete': del('charges'),
  'POST /charges/bulkCreate': SYSTEM,
  'GET /charges/migration/verify': SYSTEM,
  'POST /charges/migration/plan': SYSTEM,
  'POST /charges/migration/apply': SYSTEM,
  'GET /customsChargeGroups/': OPEN,
  'GET /customsChargeGroups/forParty': OPEN,
  'POST /customsChargeGroups/save': edit('charges'),
  'POST /customsChargeGroups/delete': del('charges'),

  'GET /ports/get': OPEN,
  'GET /ports/search': OPEN,
  'GET /ports/viewPorts': OPEN,
  'POST /ports/createPort': edit('locations'),
  'POST /ports/updatePort': edit('locations'),
  'POST /ports/deletePort': del('locations'),
  'GET /destinations/get': OPEN,
  'GET /destinations/search': OPEN,
  'GET /destinations/viewDestinations': OPEN,
  'POST /destinations/createDestination': edit('locations'),
  'POST /destinations/updateDestination': edit('locations'),
  'POST /destinations/deleteDestination': del('locations'),
  'GET /airports/get': OPEN,
  'GET /airports/viewAirports': OPEN,
  'POST /airports/createAirport': edit('locations'),
  'POST /airports/updateAirport': edit('locations'),
  'POST /airports/deleteAirport': del('locations'),
  'GET /locations/migration/verify': SYSTEM,
  'POST /locations/migration/apply': SYSTEM,

  // ---------------------------------------------------------------- AWB numbers & stock, carriers, aircraft
  'GET /awbl/available': view('awb', FREIGHT_JOBS),
  'GET /awbl/list': view('awb', FREIGHT_JOBS),
  'POST /awbl/assign': edit('awb', FREIGHT_JOBS),
  'POST /awbl/release': edit('awb', FREIGHT_JOBS),
  'POST /awbl/register': edit('awb'),
  'POST /awbl/delete': del('awb'),
  'GET /aviationJob/awb/available': view('awb', 'aviation'),
  'GET /aviationJob/awb/list': view('awb', 'aviation'),
  'POST /aviationJob/awb/assign': edit('awb', 'aviation'),
  'POST /aviationJob/awb/unassign': edit('awb', 'aviation'),
  'POST /aviationJob/awb/register': edit('awb'),
  'POST /aviationJob/awb/void': edit('awb'),
  'POST /aviationJob/awb/unvoid': edit('awb'),
  'POST /aviationJob/awb/delete': del('awb'),
  'GET /aviationJob/carriers': OPEN,
  'POST /aviationJob/carriers/save': edit('awb'),
  'POST /aviationJob/carriers/delete': del('awb'),
  'GET /aviationJob/aircraft': OPEN,
  'POST /aviationJob/aircraft/save': edit('awb'),
  'POST /aviationJob/aircraft/delete': del('awb'),

  // ---------------------------------------------------------------- freight jobs
  'GET /seaJob/get': freightFrom((req) => req.query.operation, 'view'),
  'GET /seaJob/getValues': view(FREIGHT_JOBS, 'manifest'),
  'GET /seaJob/getValuesJobList': view(FREIGHT_JOBS),
  'GET /seaJob/getSEJobById': view(FREIGHT_JOBS),
  'GET /seaJob/getJobById': view(FREIGHT_JOBS),
  'GET /seaJob/getJobByValues': view(FREIGHT_JOBS),
  'GET /seaJob/getJobsWithoutBl': view(FREIGHT_JOBS),
  'GET /seaJob/getAllBls': view(FREIGHT_JOBS),
  'GET /seaJob/getBlById': view(FREIGHT_JOBS),
  'GET /seaJob/getStamps': view(FREIGHT_JOBS),
  'GET /seaJob/getDeliveryOrder': view(FREIGHT_JOBS),
  'GET /seaJob/getLoadingProgram': view(FREIGHT_JOBS),
  'GET /seaJob/searchForCopy': view(FREIGHT_JOBS),
  'GET /seaJob/getSEJobIds': view(FREIGHT_JOBS),
  'GET /seaJob/getJobNumbers': any(view(FREIGHT_JOBS), view('directJob')),
  'GET /seaJob/getawb': view('manifest', 'airExport', 'airImport'),
  'POST /seaJob/findJobByNo': view(FREIGHT_JOBS),
  'POST /seaJob/getNotes': view(FREIGHT_JOBS),
  'POST /seaJob/create': freightFrom((req) => req.body?.data?.operation, 'edit'),
  'POST /seaJob/edit': freightFrom((req) => req.body?.data?.operation, 'edit'),
  'POST /seaJob/unlock': approve(FREIGHT_JOBS),      // and CEO/CFO/admin in the route
  'POST /seaJob/createBl': edit(FREIGHT_JOBS),
  'POST /seaJob/editBl': edit(FREIGHT_JOBS),
  'POST /seaJob/addNote': edit(FREIGHT_JOBS),
  'POST /seaJob/updateNotes': edit(FREIGHT_JOBS),
  'POST /seaJob/upsertDeliveryOrder': edit(FREIGHT_JOBS),
  'POST /seaJob/upsertLoadingProgram': edit(FREIGHT_JOBS),
  'POST /seaJob/deleteJob': del(FREIGHT_JOBS),
  'POST /seaJob/fixAEBL': SYSTEM,
  'POST /seaJob/fixAirJobs': SYSTEM,
  'POST /seaJob/fixSalesRep': SYSTEM,
  'POST /seaJob/fixSeaJobs': SYSTEM,
  'POST /seaJob/linkCharges': SYSTEM,
  'POST /seaJob/UploadSEJobs': SYSTEM,
  'POST /seaJob/UploadSIJobs': SYSTEM,
  'POST /seaJob/UploadAEJobs': SYSTEM,
  'POST /seaJob/UploadAIJobs': SYSTEM,
  'POST /seaJob/uploadLogJobs': SYSTEM,
  'POST /seaJob/UploadAirPorts': SYSTEM,
  'GET /manifest/get': view('manifest'),
  'GET /manifest/getAll': view('manifest'),
  'GET /manifest/searchJobs': view('manifest'),
  'POST /manifest/create': edit('manifest'),
  'POST /manifest/edit': edit('manifest'),

  // ---------------------------------------------------------------- aviation
  'GET /aviationJob/getValues': view('aviation'),
  'GET /aviationJob/get': view('aviation'),
  'GET /aviationJob/getById': view('aviation'),
  'GET /aviationJob/relatedCharges': view('jobCharges', 'aviation'),
  'GET /aviationJob/pfm/get': view('aviation'),
  'GET /aviationJob/pfm/getById': view('aviation'),
  'GET /aviationJob/pfm/selectable': view('aviation'),
  'POST /aviationJob/create': edit('aviation'),
  // Or the charges alone - the route saves only the charge lines then.
  'POST /aviationJob/edit': edit('aviation', 'jobCharges'),
  'POST /aviationJob/pfm/create': edit('aviation'),
  'POST /aviationJob/pfm/edit': edit('aviation'),
  'POST /aviationJob/delete': del('aviation'),
  'POST /aviationJob/pfm/delete': del('aviation'),
  'POST /aviationJob/makeInvoice': RAISE,
  'GET /aviationJob/flightSummary': view('rptJobBalancing'),
  'GET /aviationJob/salesReport': view('rptJobBalancing'),
  'GET /aviationJob/report': view('rptJobBalancing'),

  // ---------------------------------------------------------------- customs
  'GET /customsJob/getValues': view('customs'),
  'GET /customsJob/get': view('customs'),
  'GET /customsJob/getById': view('customs'),
  'GET /customsJob/chargeSummary': view('jobCharges', 'customs'),
  'POST /customsJob/notes': view('customs'),
  'GET /customsJob/plans/get': view('customs'),
  'GET /customsJob/register': view('customs', 'rptJobBalancing'),
  'POST /customsJob/create': edit('customs'),
  // Or the charges alone - the route saves only the charge sheet then.
  'POST /customsJob/edit': edit('customs', 'jobCharges'),
  'POST /customsJob/addNote': edit('customs'),
  'POST /customsJob/plans/save': edit('customs'),
  'POST /customsJob/plans/move': edit('customs'),
  'POST /customsJob/delete': del('customs'),
  'POST /customsJob/plans/delete': del('customs'),
  'POST /customsJob/unlock': approve('customs'),   // and CEO/CFO/admin in the route
  // Raised approved posts them too - the approve right, as /invoice/approve.
  // Raised approved ("Invoice & approve") also needs the Approve right - the
  // route checks that part itself (routes/customsJobs makeInvoice).
  'POST /customsJob/makeInvoice': RAISE,

  // ---------------------------------------------------------------- invoices & bills
  'GET /invoice/getFilteredInvoices': INVOICE_READERS,
  'GET /invoice/getAllInvoiceData': INVOICE_READERS,
  'GET /invoice/getInvoiceById': INVOICE_READERS,
  'GET /invoice/getInvoiceByNo': INVOICE_READERS,
  'GET /invoice/getInvoices': INVOICE_READERS,
  'GET /invoice/getHeadesNew': INVOICE_READERS,
  'GET /invoice/getJobInvoices': INVOICE_READERS,
  'GET /invoice/getTransaction': INVOICE_READERS,
  'GET /invoice/getPartyEmails': INVOICE_READERS,
  'GET /invoice/suggestEmails': INVOICE_READERS,
  'POST /invoice/sendEmail': INVOICE_READERS,
  'GET /invoice/getPrintData': OPEN,   // its own print token (PUBLIC_PATHS)
  // ------------------------------------ printing templates (Config, Word files)
  // Read by the invoice screen before it prints; set up by Seanet. Printing
  // is INVOICE_READERS - which takes in every job's viewers, for a job's
  // Bill of Lading or Air Waybill.
  'GET /printingTemplates/list': OPEN,
  'GET /printingTemplates/applies': OPEN,
  'GET /printingTemplates/:id/file': OPEN,
  'POST /printingTemplates/save': SYSTEM,
  'DELETE /printingTemplates/:id': SYSTEM,
  'POST /printingTemplates/render': INVOICE_READERS,
  'POST /printingTemplates/renderMany': INVOICE_READERS,
  'GET /invoice/getAllInvoices': view('payments', 'invoices'),
  'GET /invoice/getAllInvoicesByPartyId': view('payments', 'invoices'),
  'GET /invoice/getAllOldInvoicesByPartyId': view('payments', 'invoices'),
  'GET /invoice/getClientsWithACPayble': view('payments', 'invoices'),
  'POST /invoice/makeInvoiceNew': RAISE,
  'POST /invoice/saveHeadesNew': edit(CHARGE_DOCS),
  'POST /invoice/saveHeades': edit(CHARGE_DOCS),
  'POST /invoice/saveChargeHeades': edit(CHARGE_DOCS),
  'POST /invoice/updateCharges': edit(INVOICE_DOCS),
  'POST /invoice/addInvoiceNote': edit(INVOICE_DOCS),
  'POST /invoice/changeCurrency': edit(INVOICE_DOCS),
  'POST /invoice/changeDate': edit(INVOICE_DOCS),
  'POST /invoice/roundOffInv': edit(INVOICE_DOCS),
  'POST /invoice/approve': approve(INVOICE_DOCS),
  // One charge LINE's approval - the charges', not an invoice's.
  'POST /invoice/approveHeads': approve(CHARGE_DOCS),
  'POST /invoice/unApprove': unapprove(INVOICE_DOCS),
  // Sets the flag either way: approving needs Approve, clearing it Unapprove.
  'POST /invoice/invApproveDisapp': (req) => (['1', 'true'].includes(String(req.body?.approved).toLowerCase())
    ? approve(INVOICE_DOCS) : unapprove(INVOICE_DOCS)),
  'GET /invoice/deleteInvoice': del(INVOICE_DOCS),
  'POST /invoice/createInvoiceTransaction': edit('payments'),
  'GET /invoice/getOpeningInvoice': view('openingBalances'),
  'GET /invoice/getOpeningInvoices': view('openingBalances'),
  'POST /invoice/openingInvoice': edit('openingBalances'),
  'POST /invoice/deleteOpeningInvoices': del('openingBalances'),
  'GET /invoice/ageingSummary': view('rptAgeing'),
  'GET /invoice/invoiceBalancing': view('rptJobBalancing'),
  'GET /invoice/jobBalancing': view('rptJobBalancing'),
  'GET /invoice/jobPnLComparison': view('rptJobPL'),
  'GET /invoice/jobPnLSummary': view('rptJobPL'),
  'GET /invoice/invoiceMatching': SYSTEM,
  'POST /invoice/updateVouchersWithInvoices': SYSTEM,
  'POST /invoice/createBulkInvoices': SYSTEM,
  'POST /invoice/uploadbulkInvoices': SYSTEM,
  'POST /invoice/uploadbulkInvoicesTest': SYSTEM,
  'GET /invoice/dateExperiment': SYSTEM,
  'GET /invoice/invoiceTest': SYSTEM,
  'GET /invoice/testGetLastInvoice': SYSTEM,
  'GET /invoice/testResetSomeInvoices': SYSTEM,
  'GET /invoice/getCPUS': SYSTEM,

  // ---------------------------------------------------------------- vouchers, payments, direct jobs
  'GET /voucher/getAllVouchers': VOUCHER_READERS,
  'GET /voucher/getVoucherById': VOUCHER_READERS,
  'GET /voucher/OfficeAllVouchers': view('vouchers'),
  'GET /voucher/OfficeVoucherById': view('vouchers'),
  'GET /voucher/getExRateVouchers': view('vouchers'),
  'GET /voucher/getVouchersByEmployeeId': view('vouchers', 'payments'),
  'POST /voucher/createVoucher': edit('vouchers'),
  'POST /voucher/updateVoucher': edit('vouchers'),
  'POST /voucher/OfficeVoucherUpsert': edit('vouchers'),
  'POST /voucher/recordReverse': edit('vouchers'),
  'POST /voucher/voucherCreation': edit('vouchers', 'payments'),
  'POST /voucher/voucherEdit': edit('vouchers', 'payments', 'openingBalances'),
  'POST /voucher/ApproveOfficeVoucher': approve('vouchers'),
  'POST /voucher/deleteVoucher': del('vouchers'),
  'POST /voucher/deleteBaseVoucher': del('vouchers', 'openingBalances'),
  'GET /voucher/getAllJobPayRecVouchers': view('payments'),
  'GET /voucher/getVoucherByIdAdvanced': view('payments'),
  'POST /voucher/makeTransaction': edit('payments'),
  // Knock invoices off against a payment / receipt already posted - an edit of it.
  'POST /voucher/settleTransaction': edit('payments'),
  'POST /voucher/chequeReturn': edit('payments'),
  'POST /voucher/deletePaymentReceipt': del('payments'),
  'GET /voucher/getJobData': view(ALL_JOBS, 'payments', 'invoices'),
  'GET /voucher/getDirectJob': view('directJob'),
  'GET /voucher/getDirectJobList': view('directJob'),
  'GET /voucher/getDirectJobNumbers': view('directJob'),
  'POST /voucher/createDirectJob': edit('directJob'),
  'POST /voucher/saveDirectJob': edit('directJob'),
  // Would these lines repeat a charge on a job? Asked as a charge is picked.
  'POST /voucher/checkDirectJobCharges': view('directJob'),
  'POST /voucher/deleteDirectJob': del('directJob'),
  'GET /voucher/getAccountActivity': view('rptAccountActivity'),
  'GET /voucher/getAllVoucehrHeads': SYSTEM,
  'GET /voucher/testgetAll': SYSTEM,
  'POST /voucher/checkVoucherHeads': SYSTEM,
  'POST /voucher/getChildAccountIds': SYSTEM,
  'POST /voucher/importLedger': SYSTEM,
  'POST /voucher/importSettlements': SYSTEM,

  // ---------------------------------------------------------------- reports
  // THE ARCHIVE (routes/archive) - reads only. The book list is OPEN:
  // the sidebar asks it for everyone, to know whether to offer the screen.
  'GET /archive/books': OPEN,
  'GET /archive/:book/summary': view('archive'),
  'GET /archive/:book/jobs': view('archive'),
  'GET /archive/:book/jobs/:id': view('archive'),
  'GET /archive/:book/invoices': view('archive'),
  'GET /archive/:book/invoices/:id': view('archive'),
  'GET /archive/:book/bills': view('archive'),
  'GET /archive/:book/bills/:id': view('archive'),
  'GET /archive/:book/vouchers': view('archive'),
  'GET /archive/:book/vouchers/:tranNo': view('archive'),
  'GET /archive/:book/accounts': view('archive'),
  'GET /archive/:book/ledger': view('archive'),
  'GET /archive/:book/trialBalance': view('archive'),
  'GET /misc/trialBalance/get': view('rptTrialBalance'),
  'GET /misc/vatDetail': view('rptTrialBalance'),
  'GET /misc/agentStatement': view('rptAgent'),
  'GET /misc/agentStatement/manual': view('rptAgent'),
  'POST /misc/agentStatement/manual': view('rptAgent'),
  'GET /misc/profitLoss/incomeStatement': view('rptIncomeStatement', 'rptAgeing', 'rptReconciliation'),
  'GET /misc/profitLoss/ISComparitive': view('rptIncomeStatement'),
  'GET /misc/profitLoss/full': view('rptIncomeStatement', 'rptJobPL'),
  'GET /misc/profitLoss/search': view('rptIncomeStatement', 'rptJobPL'),
  'GET /misc/profitLoss/job': view('rptJobPL'),
  'POST /misc/profitLoss/getGainLoss': view('rptIncomeStatement', 'payments'),
  'POST /misc/parties/geInvoiceBalancing': view('rptJobBalancing', 'rptAgent', 'payments'),
  'POST /misc/parties/getJobBalance': view('rptJobBalancing', 'rptAgent', 'payments'),
  'POST /misc/parties/getJobBalanceNew': view('rptJobBalancing', 'rptAgent', 'payments'),
  'GET /reconciliation/check': view('rptReconciliation'),
  'GET /misc/profitLoss/test': SYSTEM,
  'GET /misc/dateExperiment': SYSTEM,

  // ---------------------------------------------------------------- migration (Config > Migration)
  'GET /migration/counts': SYSTEM,
  'GET /migration/counts/:key': SYSTEM,
  'GET /migration/linkage': SYSTEM,
  'GET /migration/reconcile': SYSTEM,
  'POST /migration/cache/reset': SYSTEM,
  'GET /jobMigration/verify': SYSTEM,
  'POST /jobMigration/plan': SYSTEM,
  'POST /jobMigration/apply': SYSTEM,
  'GET /blMigration/verify': SYSTEM,
  'POST /blMigration/plan': SYSTEM,
  'POST /blMigration/apply': SYSTEM,
  'POST /blMigration/registerMawbs': SYSTEM,
  'GET /blChildMigration/verify': SYSTEM,
  'POST /blChildMigration/plan': SYSTEM,
  'POST /blChildMigration/apply': SYSTEM,
  'GET /jobEquipmentMigration/verify': SYSTEM,
  'POST /jobEquipmentMigration/plan': SYSTEM,
  'POST /jobEquipmentMigration/apply': SYSTEM,
  'GET /loadingProgramMigration/verify': SYSTEM,
  'POST /loadingProgramMigration/plan': SYSTEM,
  'POST /loadingProgramMigration/apply': SYSTEM,
  'GET /chargeHeadMigration/verify': SYSTEM,
  'POST /chargeHeadMigration/plan': SYSTEM,
  'POST /chargeHeadMigration/apply': SYSTEM,
  'GET /invoiceMigration/verify': SYSTEM,
  'POST /invoiceMigration/plan': SYSTEM,
  'POST /invoiceMigration/apply': SYSTEM,
  'GET /ledgerMigration/verify': SYSTEM,
  'POST /ledgerMigration/vouchers/plan': SYSTEM,
  'POST /ledgerMigration/vouchers/apply': SYSTEM,
  'POST /ledgerMigration/vouchers/numberUnnumbered': SYSTEM,
  'POST /ledgerMigration/settlements/plan': SYSTEM,
  'POST /ledgerMigration/settlements/apply': SYSTEM,
  'GET /lgJobMigration/verify': SYSTEM,
  'POST /lgJobMigration/plan': SYSTEM,
  'POST /lgJobMigration/apply': SYSTEM,
  'GET /directJobMigration/verify': SYSTEM,
  'POST /directJobMigration/plan': SYSTEM,
  'POST /directJobMigration/apply': SYSTEM,
  'GET /taxInvoiceMigration/verify': SYSTEM,
  'POST /taxInvoiceMigration/plan': SYSTEM,
  'POST /taxInvoiceMigration/apply': SYSTEM,
  'GET /vendorTaxInvoiceMigration/verify': SYSTEM,
  'POST /vendorTaxInvoiceMigration/plan': SYSTEM,
  'POST /vendorTaxInvoiceMigration/apply': SYSTEM,

  // Mounted only with OLLAMA_ENABLED=true (index.js).
  'POST /ollama/chatDB': SYSTEM,
};

// ---------------------------------------------------------------- lookup
const exact = new Map();
const patterned = [];
for (const [key, rule] of Object.entries(RULES)) {
  const [method, path] = key.split(' ');
  const normal = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (normal.includes(':')) {
    patterned.push({ method, re: new RegExp('^' + normal.replace(/:[^/]+/g, '[^/]+') + '/?$'), rule });
  } else {
    exact.set(`${method} ${normal}`, rule);
  }
}

/** The rule for a request, or undefined when the table has none. */
function ruleFor(method, path) {
  const m = method === 'HEAD' ? 'GET' : method;
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const hit = exact.get(`${m} ${p}`);
  if (hit !== undefined) return hit;
  const pat = patterned.find((r) => r.method === m && r.re.test(p));
  return pat ? pat.rule : undefined;
}

module.exports = { OPEN, SYSTEM, RULES, ruleFor, LINKING_REPORTS };
