/**
 * DEMO DATA FOR A FREIGHT INSTALL - one of everything, on an empty database.
 *
 *   node scripts/seedDemoFreight.js            <- says which database, changes nothing
 *   node scripts/seedDemoFreight.js --apply    <- builds the demo
 *
 * For a sales demo: enough that every list, report and print has something in
 * it, while the jobs created live in front of the audience are the interesting
 * ones. Everything goes through the application's own routes, in-process, the
 * way the integration tests drive them - so job, invoice and voucher numbers,
 * ledger postings and balances are exactly what the screens produce.
 *
 * WHAT IT BUILDS
 *   setup     freight mode, a company (with bank account), fiscal year
 *             2026-27, the chart of accounts, ports / destinations / airports,
 *             a bank and a cash ledger, a sales rep, commodities, charges,
 *             customers, vendors, a shipping line, an airline, an overseas
 *             agent, a vessel with an export and an import voyage, AWB stock
 *   jobs      Sea Export FCL  - B/L, loading program, invoiced + billed, part paid
 *             Sea Import LCL  - B/L, delivery order, invoiced, unpaid
 *             Air Export      - HAWB on a registered MAWB, invoiced, paid
 *             Air Import      - charges entered, NOT invoiced (invoice it live)
 *             Sea Export LCL  - booked only, no B/L yet (make one live)
 *   accounts  opening balance, an opening invoice, a bank payment, a journal
 *             voucher, a Direct Job expense
 *
 * SAFE BY CONSTRUCTION
 *   - refuses unless the database name contains "demo"
 *   - refuses a database that already has jobs in it
 *   - the admin login is created with DEMO_PASSWORD only when the database has
 *     no users yet; an admin that already exists keeps its own password
 *
 * Point it at another database for a trial run without editing .env:
 *   $env:DB_NAME="odyssey-demo-scratch"; node scripts/seedDemoFreight.js --apply
 */
const path = require('path');
const { spawnSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

/* ------------------------------------------------------------------ settings
 * Fictional throughout - change the names here, not further down. */
const DEMO_PASSWORD = 'Demo@2026';
const COMPANY = {
  title: 'Bluewave Freight Solutions (Pvt) Ltd',
  short: 'BWF',
  address: 'Office 402, Ocean Tower, Block 9, Clifton, Karachi',
  phone: '+92 21 3500 0000',
  email: 'info@bluewave-demo.com',
  web: 'www.bluewave-demo.com',
  ntn: '0000000-0',
};
const FISCAL_YEAR = { label: '2026-27', suffix: '27', startDate: '2026-07-01', endDate: '2027-06-30' };
const USD_RATE = 280;
const AWB_PREFIX = '786';          // the demo airline's 3-digit prefix
const AWB_FIRST_SERIAL = 4501230;  // ten numbers are registered from here

/* ------------------------------------------------------------------ helpers */
const fail = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`  • ${msg}`);

if (!/demo/i.test(String(cfg.database || ''))) {
  fail(`Database "${cfg.database}" does not have "demo" in its name. This script only fills demo databases.`);
}

console.log(`\nDemo freight data -> ${cfg.database} on ${cfg.host} (NODE_ENV=${env})`);
if (!APPLY) {
  console.log('\nNothing changed. Re-run with --apply to build the demo.\n');
  process.exit(0);
}

const awbCheck = (serial) => String(serial % 7);
const awbCode = (serial) => `${String(serial).padStart(7, '0')}${awbCheck(serial)}`;
const net = (rate, qty) => Number((rate * qty).toFixed(2));

async function main() {
  const db = require('../models');
  await db.syncPromise;
  const { Employees, SE_Job, Child_Account, Charge_Head, Client_Associations, Ports, Awbl, Invoice } = db;

  if (await SE_Job.count() > 0) {
    fail(`${cfg.database} already has jobs. This script fills an EMPTY demo database - drop and recreate it to start again.`);
  }

  /* ---------------------------------------------------------- foundations */
  console.log('\nFoundations');
  let adminCreated = false;
  if (await Employees.count() === 0) {
    process.env.ADMIN_SEED_PASSWORD = DEMO_PASSWORD;
    const { seedAdminUser } = require('../functions/seedAdmin');
    adminCreated = (await seedAdminUser()).created;
  }
  const admin = await Employees.findOne({ where: { designation: 'admin' }, order: [['id', 'ASC']] });
  if (!admin) fail('No admin user in this database, and it was not empty enough to create one.');
  step(adminCreated ? `admin login created (password ${DEMO_PASSWORD})` : `admin login "${admin.username}" already existed - password unchanged`);

  const { seedChartOfAccounts } = require('../functions/chartOfAccounts');
  const coa = await seedChartOfAccounts({ apply: true });
  step(`chart of accounts (${coa.created} accounts created)`);

  if (await Ports.count() === 0) {
    const run = spawnSync(process.execPath, [path.join(__dirname, 'seedPickLists.js')], { env: process.env, stdio: 'ignore' });
    if (run.status !== 0) fail('Loading ports / destinations / airports failed - run node scripts/seedPickLists.js to see why.');
  }
  step('ports, destinations and airports');

  /* ------------------------------------------------------- the API, in-process */
  const request = require('supertest');
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../functions/secrets');
  const sessionManager = require('../functions/sessionManager');
  const app = require('../index');

  const token = jwt.sign(
    { id: admin.id, username: admin.name, designation: admin.designation, access: '', defaultCompanyId: null },
    JWT_SECRET, { expiresIn: '2h' },
  );
  await sessionManager.setSession(admin.id, token);

  let fiscalYearId = null;
  const call = async (method, url, body, headers = {}) => {
    let req = request(app)[method](url).set('Authorization', `Bearer ${token}`).timeout({ deadline: 180000 });
    if (fiscalYearId) req = req.set('x-fiscal-year-id', String(fiscalYearId));
    for (const [k, v] of Object.entries(headers)) req = req.set(k, String(v));
    const res = method === 'get' ? await req : await req.send(body || {});
    const ok = res.status < 300 && (res.body?.status === 'success' || res.body?.status === undefined);
    if (!ok) {
      fail(`${method.toUpperCase()} ${url} -> ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`);
    }
    return res.body;
  };
  const post = (url, body) => call('post', url, { employeeId: admin.id, ...body });
  const account = async (title) => {
    const row = await Child_Account.findOne({ where: { title } });
    if (!row) fail(`Account "${title}" is missing from the chart.`);
    return row;
  };

  const mode = await call('get', '/settings/operationMode');
  if (mode.locked && mode.mode !== 'freight') fail(`This database is locked to "${mode.mode}" mode, not freight.`);
  if (!mode.locked) await post('/settings/operationMode', { mode: 'freight' });
  step('operation mode: freight');

  const company = (await post('/companies/createCompany', COMPANY)).result;
  const companyId = company.id;
  const bank = (await post('/companies/bankAccount/create', {
    CompanyId: companyId, label: 'Main account (PKR)', bankName: 'Standard Trust Bank Ltd',
    accountTitle: COMPANY.title, accountNo: '0101-2345678-01', iban: 'PK00STBL0000010123456701',
    branch: 'Clifton Branch, Karachi', swift: 'STBLPKKA',
  })).result;
  await post('/companies/bankAccount/setDefault', { id: bank.id, kind: 'client' });
  step(`company ${COMPANY.short} - ${COMPANY.title}, with its bank account`);

  const fy = (await post('/fiscalYears/create', FISCAL_YEAR)).result;
  fiscalYearId = fy.id;
  step(`fiscal year ${fy.label}`);

  const ledgerChild = async (title, parentTitle, subCategory) => {
    const parent = await account(parentTitle);
    await post('/accounts/createChildAccount', { title, ChildAccountId: parent.id, subCategory, editable: true });
    return account(title);
  };
  const bankLedger = await ledgerChild('STANDARD TRUST BANK - 0101', 'BANK ACCOUNTS', 'Bank');
  const cashLedger = await ledgerChild('PETTY CASH - HEAD OFFICE', 'CASH IN HAND', 'Cash');
  const receivables = await account('ACCOUNT RECEIVABLE');
  const payables = await account('ACCOUNT PAYABLE');
  await post('/settings/partyAccounts', { mapping: { receivable: receivables.id, payable: payables.id } });
  step('bank and cash ledgers; new customers / vendors default to Receivable / Payable');

  const salesRep = (await post('/employeeRoutes/createEmployee', {
    createdBy: admin.name,
    values: {
      empName: 'Sara Ahmed', userName: 'sara', pass: DEMO_PASSWORD, code: 'E-002',
      selectDesignation: 'employee', selectDepart: 'Sales', represent: 'sr',
      email: 'sara@bluewave-demo.com', phone: '+92 300 0000002', date: '2026-07-01',
      defaultCompanyId: companyId, accessLevels: [],
    },
  })).result;
  step('sales representative Sara Ahmed');

  /* ------------------------------------------------------- master data */
  console.log('\nMaster data');
  const commodity = {};
  for (const [key, name, hs, cargoType] of [
    ['linen', 'Cotton Bed Linen', '6302.31', 'General'],
    ['rice', 'Basmati Rice', '1006.30', 'General'],
    ['surgical', 'Surgical Instruments', '9018.90', 'General'],
    ['electronics', 'Mobile Accessories', '8517.70', 'General'],
  ]) {
    commodity[key] = (await post('/commodity/create', { data: { name, hs, cargoType, isHazmat: [] } })).result;
  }
  step('4 commodities');

  const charge = {};
  for (const [key, name, short, currency, calculationType, rec, pay] of [
    ['ofrt', 'OCEAN FREIGHT', 'OFRT', 'USD', 'Per Unit', 'Client', 'Shipping-Line'],
    ['thc', 'TERMINAL HANDLING CHARGES', 'THC', 'PKR', 'Per Unit', 'Client', 'Local-Agent'],
    ['doc', 'DOCUMENTATION FEE', 'DOC', 'PKR', 'Per Shipment', 'Client', 'Shipping-Line'],
    ['dofee', 'DELIVERY ORDER FEE', 'DO FEE', 'PKR', 'Per Shipment', 'Client', 'Shipping-Line'],
    ['afrt', 'AIR FREIGHT', 'AFRT', 'USD', 'Per Unit', 'Client', null],
    ['handling', 'HANDLING CHARGES', 'HDL', 'PKR', 'Per Shipment', 'Client', 'Local-Agent'],
    ['transport', 'TRANSPORTATION', 'TRPT', 'PKR', 'Per Shipment', 'Client', 'Transport-Agent'],
    ['clearance', 'CUSTOMS CLEARANCE', 'CCL', 'PKR', 'Per Shipment', 'Client', 'Custom-Agent'],
    ['profit', 'PROFIT SHARE', 'PSH', 'USD', 'Per Shipment', 'Overseas-Agent', 'Overseas-Agent'],
  ]) {
    charge[key] = (await post('/charges/create', {
      data: { name, short, currency, calculationType, defaultRecivableParty: rec, defaultPaybleParty: pay, taxApply: 'No', taxPerc: '0', fixAmount: 0 },
    })).result;
  }
  step(`${Object.keys(charge).length} charges`);

  const party = {};
  const makeParty = async (key, p, ledger) => {
    const res = await post('/clientRoutes/createClient', {
      active: true, currency: 'PKR', registerDate: '2026-07-01', createdBy: admin.name,
      ...p, pAccountName: ledger === 'ar' ? receivables.id : ledger === 'ap' ? payables.id : '',
    });
    party[key] = res.result;
    if (ledger) {
      const link = await Client_Associations.findOne({ where: { ClientId: party[key].id } });
      party[key].ledgerId = link.ChildAccountId;
    }
  };
  const SEA = ['Sea Export', 'Sea Import'];
  const AIR = ['Air Export', 'Air Import'];
  const ALL = [...SEA, ...AIR];
  // Customers - billed, so each has a receivable ledger.
  await makeParty('indus', { name: 'Indus Valley Textiles (Pvt) Ltd', types: ['Shipper', 'Notify'], operations: SEA,
    address1: 'Plot 14, Sector 7-A, Korangi Industrial Area', city: 'Karachi', person1: 'Imran Siddiqui',
    mobile1: '+92 300 1110001', infoMail: 'exports@indusvalley-demo.com', ntn: '1111111-1' }, 'ar');
  await makeParty('crescent', { name: 'Crescent Agro Foods Ltd', types: ['Consignee', 'Notify'], operations: SEA,
    address1: '22 Shahrah-e-Faisal', city: 'Karachi', person1: 'Ayesha Malik', mobile1: '+92 300 1110002',
    infoMail: 'imports@crescentagro-demo.com', ntn: '2222222-2' }, 'ar');
  await makeParty('northern', { name: 'Northern Surgical Instruments', types: ['Shipper'], operations: AIR,
    address1: 'Small Industrial Estate, Ugoki Road', city: 'Sialkot', person1: 'Bilal Chaudhry',
    mobile1: '+92 300 1110003', infoMail: 'shipping@northernsurgical-demo.com', ntn: '3333333-3' }, 'ar');
  await makeParty('metro', { name: 'Metro Electronics Trading', types: ['Consignee'], operations: AIR,
    address1: 'Shop 5, Saddar Electronics Market', city: 'Karachi', person1: 'Usman Tariq',
    mobile1: '+92 300 1110004', infoMail: 'purchase@metroelectronics-demo.com', ntn: '4444444-4' }, 'ar');
  // Vendors - paid, so each has a payable ledger.
  await makeParty('oceanic', { name: 'Oceanic Container Lines', types: ['Shipping Line'], operations: SEA,
    address1: 'Office 1101, Business Centre, Dolmen City', city: 'Karachi', person1: 'Line Desk', mobile1: '+92 21 3500 1001' }, 'ap');
  await makeParty('skyway', { name: 'Skyway Airlines Cargo', types: ['Air Line'], operations: AIR,
    address1: 'Cargo Complex, Jinnah International Airport', city: 'Karachi', person1: 'Cargo Sales', mobile1: '+92 21 3500 1002' }, 'ap');
  await makeParty('portside', { name: 'Port Side Logistics Services', types: ['Local Vendor'], operations: ALL,
    address1: 'West Wharf Road', city: 'Karachi', person1: 'Operations', mobile1: '+92 21 3500 1003' }, 'ap');
  await makeParty('swift', { name: 'Swift Haulage Services', types: ['Transporter'], operations: SEA,
    address1: 'Truck Stand, Hawkesbay Road', city: 'Karachi', person1: 'Dispatch', mobile1: '+92 21 3500 1004' }, 'ap');
  await makeParty('clearing', { name: 'Metro Customs Clearing House', types: ['CHA/CHB'], operations: ALL,
    address1: 'Custom House Road', city: 'Karachi', person1: 'Clearance Desk', mobile1: '+92 21 3500 1005' }, 'ap');
  await makeParty('coastal', { name: 'Coastal Consolidators', types: ['Forwarder/Coloader'], operations: SEA,
    address1: 'Office 7, Marine Point', city: 'Karachi', person1: 'Coload Desk', mobile1: '+92 21 3500 1006' }, 'ap');
  await makeParty('atlas', { name: 'Atlas Global Logistics GmbH', types: ['Overseas Agent'], operations: ALL,
    address1: 'Am Sandtorkai 40', city: 'Hamburg', person1: 'Klaus Weber', mobile1: '+49 40 0000 0001', infoMail: 'ops@atlasglobal-demo.de' }, 'ap');
  // Overseas parties on the documents only - never billed, so no ledger.
  await makeParty('hanseatic', { name: 'Hanseatic Home Textiles GmbH', types: ['Consignee'], operations: SEA,
    address1: 'Grosse Elbstrasse 145', city: 'Hamburg', person1: 'Anna Schulz' }, null);
  await makeParty('gulf', { name: 'Gulf Fresh Foods LLC', types: ['Shipper'], operations: SEA,
    address1: 'Plot S10411, Jebel Ali Free Zone', city: 'Dubai', person1: 'Rashid Al Mansoori' }, null);
  await makeParty('medline', { name: 'Medline Distribution UK Ltd', types: ['Consignee'], operations: AIR,
    address1: 'Unit 4, Heathrow Logistics Park', city: 'London', person1: 'James Carter' }, null);
  await makeParty('shenzhen', { name: 'Shenzhen Bright Tech Co Ltd', types: ['Shipper'], operations: AIR,
    address1: 'Building 6, Bao an District', city: 'Shenzhen', person1: 'Li Wei' }, null);
  step(`${Object.keys(party).length} parties (4 customers, 7 vendors / agents, 4 overseas)`);

  const vessel = (await post('/vessel/create', { data: { name: 'MV ARABIAN PEARL', carrier: party.oceanic.name, type: 'Both' } })).result;
  const exportVoyage = (await post('/vessel/createVoyage', {
    VesselId: vessel.id, voyage: 'AP-2641W', type: 'Export', pol: 'PKKHI', pod: 'DEHAM',
    exportSailDate: '2026-09-28', cutOffDate: '2026-09-25', cutOffTime: '18:00', destinationEta: '2026-10-24',
  })).result;
  const importVoyage = (await post('/vessel/createVoyage', {
    VesselId: vessel.id, voyage: 'AP-2639E', type: 'Import', pol: 'AEJEA', pod: 'PKKHI',
    importOriginSailDate: '2026-09-10', importArrivalDate: '2026-09-15',
  })).result;
  step(`vessel ${vessel.name}, voyages ${exportVoyage.voyage} (export) and ${importVoyage.voyage} (import)`);

  await post('/awbl/register', {
    airlineId: party.skyway.id, prefix: AWB_PREFIX, code: awbCode(AWB_FIRST_SERIAL), series: true, count: 10,
  });
  step(`10 AWB numbers for ${party.skyway.name}, from ${AWB_PREFIX}-${awbCode(AWB_FIRST_SERIAL)}`);

  /* ------------------------------------------------------- jobs */
  console.log('\nJobs');
  const jobDefaults = {
    customerRef: '', fileNo: '', costCenter: 'KHI', shipStatus: 'Booked', jobType: 'Direct', jobKind: 'Current',
    dg: 'non-DG', freightType: 'Prepaid', nomination: 'Free Hand', incoTerms: 'FOB',
    customCheck: [], transportCheck: [], approved: false, canceled: false, exRate: String(USD_RATE),
    companyId, fiscalYearId, createdById: admin.id, salesRepresentatorId: salesRep.id, equipments: [],
  };
  const makeJob = async (data) => (await post('/seaJob/create', { data: { ...jobDefaults, ...data } })).result;

  // The charge sheet's own arithmetic - ChargesComp calculate(): net is
  // rate x qty, local is net x ex_rate (x 1 for PKR).
  const line = (job, c, type, p, invoiceType, partyType, { qty = 1, rate, size = '40HC', ppcc = 'PP', description = '' }) => {
    const exRate = c.currency === 'PKR' ? 1 : USD_RATE;
    const netAmount = net(rate, qty);
    return {
      type, description, basis: c.calculationType, new: true, ex_rate: exRate, pp_cc: ppcc,
      size_type: job.operation.startsWith('S') ? size : '', dg_type: 'non-DG', qty, rate_charge: rate,
      currency: c.currency, amount: 1, check: false, bill_invoice: '', charge: c.id, particular: c.name,
      discount: 0, tax_apply: false, taxPerc: 0, tax_amount: 0, net_amount: netAmount,
      local_amount: Number((netAmount * exRate).toFixed(2)), invoiceType, name: p.name, partyId: p.id,
      partyType, sep: false, status: '0', approved_by: '', approval_date: '', InvoiceId: null, SEJobId: job.id,
    };
  };
  const saveCharges = async (job, lines, { approve = true } = {}) => {
    await post('/invoice/saveHeadesNew', { charges: lines, deleteList: [], id: job.id, exRate: USD_RATE });
    const rows = await Charge_Head.findAll({ where: { SEJobId: job.id }, order: [['id', 'ASC']] });
    if (approve) for (const r of rows) if (r.status !== '1') await post('/invoice/approveHeads', { id: r.id });
    return Charge_Head.findAll({ where: { SEJobId: job.id }, order: [['id', 'ASC']] });
  };
  // One document per party, then approved - the charge sheet's Auto Invoice.
  const invoiceFor = async (job, rows, partyId, date) => {
    const lines = rows.filter((r) => String(r.partyId) === String(partyId) && !r.InvoiceId).map((r) => r.get({ plain: true }));
    const made = await post('/invoice/makeInvoiceNew', {
      chargeList: lines, companyId, fiscalYearId, type: job.operation, shipDate: date,
      ...(job.operation.startsWith('A') ? { departureDate: date } : {}),
    });
    const approved = await post('/invoice/approve', { id: made.result.newInv.id, fiscalYearId });
    return approved.invoice;
  };
  const settle = async ({ invoice, job, bl, amount, payType, partyKey, partyType, date }) => {
    const receiving = payType === 'Recievable';
    const p = party[partyKey];
    await post('/voucher/makeTransaction', {
      edit: false, advance: false, payType, transactionMode: 'Bank', subType: 'Bank',
      partyId: p.id, partyName: p.name, partyType, type: partyType,
      companyId, currency: 'PKR', exRate: 1, fiscalYearId, tranDate: date, narration: '',
      totalReceiving: receiving ? amount : 0, gainLoss: 0, checkNo: '', checkDate: '',
      invoices: [{
        id: invoice.id, invoice_No: invoice.invoice_No, payType, party_Name: invoice.party_Name,
        receiving: amount, SE_Job: { jobNo: job.jobNo, Bl: { hbl: bl?.hbl, mbl: bl?.mbl } },
      }],
      transactions: [
        { accountName: p.name, type: receiving ? 'credit' : 'debit', credit: receiving ? amount : 0, debit: receiving ? 0 : amount, accountType: 'partyAccount', partyId: p.id, currency: 'PKR' },
        { accountName: bankLedger.title, type: receiving ? 'debit' : 'credit', debit: receiving ? amount : 0, credit: receiving ? 0 : amount, accountType: 'payAccount', partyId: bankLedger.id, currency: 'PKR' },
      ],
    });
  };
  const docs = [];

  // ---- 1. Sea Export, FCL: the full cycle
  const se = await makeJob({
    operation: 'SE', subType: 'FCL', shipStatus: 'Sailed', jobDate: '2026-09-20', shipDate: '2026-09-28',
    customerRef: 'PO-IVT-4471', ClientId: party.indus.id, shipperId: party.indus.id, consigneeId: party.hanseatic.id,
    overseasAgentId: party.atlas.id, shippingLineId: party.oceanic.id, localVendorId: party.portside.id,
    commodityId: commodity.linen.id, vesselId: vessel.id, VoyageId: exportVoyage.id,
    pol: 'PKKHI', pod: 'DEHAM', fd: 'DEHAM', freightPaybleAt: 'Karachi', terminal: 'KICT',
    cutOffDate: '2026-09-25', cutOffTime: '18:00', etd: '2026-09-28', eta: '2026-10-24',
    weight: '36800', weightUnit: 'KGS', pcs: '1840', pkgUnit: 'CARTONS', vol: '132', shpVol: '132', billVol: '2',
    teu: '4', container: '2 x 40HC', bkg: 'OCL-BKG-778812',
    equipments: [{ id: '', size: '40HC', qty: '2', dg: 'non-DG', gross: '36800', teu: '4' }],
  });
  const seBl = { hbl: 'BWF/KHI/HAM/0001', mbl: 'OCLU2641778812' };
  await post('/seaJob/createBl', {
    operation: 'SE', SEJobId: se.id, ...seBl, hblDate: '2026-09-28', hblIssue: 'Karachi',
    mblDate: '2026-09-28', status: 'Final', blReleaseStatus: 'Original', issuePlace: 'Karachi',
    issueDate: '2026-09-28', onBoardDate: '2026-09-28', noBls: '3', freightType: 'Prepaid',
    shipperContent: `${party.indus.name}\nPlot 14, Sector 7-A, Korangi Industrial Area\nKarachi, Pakistan`,
    consigneeContent: `${party.hanseatic.name}\nGrosse Elbstrasse 145\n22767 Hamburg, Germany`,
    notifyOneContent: 'SAME AS CONSIGNEE',
    marksContent: 'HHT/HAM\nPO 4471\nMADE IN PAKISTAN', noOfPckgs: '1840 CARTONS',
    descOfGoodsContent: '2 x 40HC CONTAINERS SAID TO CONTAIN\n1840 CARTONS OF COTTON BED LINEN\nHS CODE 6302.31\nFREIGHT PREPAID',
    grossWeightContent: '36,800.000 KGS', measurementContent: '132.000 CBM',
    pkgs: 1840, unit: 'CARTONS', gross: 36800, wtUnit: 'KGS', cbm: 132,
    Container_Infos: [
      { no: 'OCLU4417720', seal: 'SL-558201', size: '40HC', gross: '18400', net: '17900', tare: '3900', wtUnit: 'KGS', cbm: '66', pkgs: '920', unit: 'CARTONS' },
      { no: 'OCLU4417736', seal: 'SL-558202', size: '40HC', gross: '18400', net: '17900', tare: '3900', wtUnit: 'KGS', cbm: '66', pkgs: '920', unit: 'CARTONS' },
    ],
    Item_Details: [], Dimensions: [],
  });
  await post('/seaJob/upsertLoadingProgram', {
    SEJobId: se.id, wharf: 'West Wharf', loadingTerminal: 'KICT', dischargeTerminal: 'Eurogate Hamburg',
    loadingDate: '2026-09-24', loadingTime: '10:00', etd: '2026-09-28', cro: 'CRO-778812', croIssueDate: '2026-09-18',
    validityDate: '2026-09-30', gatePass: 'GP-20931', gatePassDate: '2026-09-24', berth: 'Berth 6',
    portOfReciept: 'Karachi', instruction: 'Load 2 x 40HC after customs examination. VGM to be filed before cut-off.',
  });
  let rows = await saveCharges(se, [
    line(se, charge.ofrt, 'Recievable', party.indus, 'Job Invoice', 'client', { qty: 2, rate: 1850 }),
    line(se, charge.thc, 'Recievable', party.indus, 'Job Invoice', 'client', { qty: 2, rate: 32000 }),
    line(se, charge.doc, 'Recievable', party.indus, 'Job Invoice', 'client', { rate: 6500 }),
    line(se, charge.ofrt, 'Payble', party.oceanic, 'Job Bill', 'vendor', { qty: 2, rate: 1600 }),
    line(se, charge.doc, 'Payble', party.oceanic, 'Job Bill', 'vendor', { rate: 4500 }),
    // Entered and approved, left for the audience: invoice it live.
    line(se, charge.thc, 'Payble', party.portside, 'Job Bill', 'vendor', { qty: 2, rate: 28000 }),
    line(se, charge.profit, 'Payble', party.atlas, 'Agent Bill', 'agent', { rate: 150, ppcc: 'CC' }),
  ]);
  const seInvoice = await invoiceFor(se, rows, party.indus.id, '2026-09-28');
  const seBill = await invoiceFor(se, rows, party.oceanic.id, '2026-09-28');
  const seReceived = Math.round(Number(seInvoice.total) * 0.6);
  await settle({ invoice: seInvoice, job: se, bl: seBl, amount: seReceived, payType: 'Recievable', partyKey: 'indus', partyType: 'client', date: '2026-10-01' });
  await settle({ invoice: seBill, job: se, bl: seBl, amount: Number(seBill.total), payType: 'Payble', partyKey: 'oceanic', partyType: 'vendor', date: '2026-10-02' });
  docs.push([se.jobNo, `B/L ${seBl.hbl}, ${seInvoice.invoice_No} (60% received), ${seBill.invoice_No} (paid), 2 charges left to bill`]);

  // ---- 2. Sea Import, LCL: delivered, invoiced, unpaid
  const si = await makeJob({
    operation: 'SI', subType: 'LCL', shipStatus: 'Arrived', jobDate: '2026-09-08', shipDate: '2026-09-15',
    customerRef: 'CAF-IMP-0912', ClientId: party.crescent.id, shipperId: party.gulf.id, consigneeId: party.crescent.id,
    overseasAgentId: party.atlas.id, shippingLineId: party.oceanic.id, localVendorId: party.portside.id,
    commodityId: commodity.rice.id, vesselId: vessel.id, VoyageId: importVoyage.id,
    pol: 'AEJEA', pod: 'PKKHI', fd: 'PKKHI', terminal: 'SAPT', eta: '2026-09-15',
    weight: '4200', weightUnit: 'KGS', pcs: '168', pkgUnit: 'BAGS', vol: '6.5', shpVol: '6.5', billVol: '6.5',
  });
  const siBl = { hbl: 'AGL/JEA/KHI/2209', mbl: 'OCLU2639440017' };
  await post('/seaJob/createBl', {
    operation: 'SI', SEJobId: si.id, ...siBl, hblDate: '2026-09-10', mblDate: '2026-09-10',
    status: 'Final', issuePlace: 'Jebel Ali', freightType: 'Collect',
    shipperContent: `${party.gulf.name}\nPlot S10411, Jebel Ali Free Zone\nDubai, UAE`,
    consigneeContent: `${party.crescent.name}\n22 Shahrah-e-Faisal\nKarachi, Pakistan`,
    descOfGoodsContent: '168 BAGS OF BASMATI RICE\nLCL CARGO', pkgs: 168, unit: 'BAGS', gross: 4200, wtUnit: 'KGS', cbm: 6.5,
    Container_Infos: [{ no: 'OCLU3390214', seal: 'SL-771045', size: '20HC', gross: '4200', wtUnit: 'KGS', cbm: '6.5', pkgs: '168', unit: 'BAGS' }],
    Item_Details: [], Dimensions: [],
  });
  await post('/seaJob/upsertDeliveryOrder', {
    SEJobId: si.id, operation: 'SI', companyId: String(companyId), date: '2026-09-16', validDate: '2026-09-30',
    clearingAgent: party.clearing.name, name: party.crescent.name, deliveryReqTo: 'SAPT Terminal Manager',
    remarks: 'Deliver against original B/L and paid invoice.', mobileNo: '+92 300 1110002',
  });
  rows = await saveCharges(si, [
    line(si, charge.dofee, 'Recievable', party.crescent, 'Job Invoice', 'client', { rate: 15000 }),
    line(si, charge.handling, 'Recievable', party.crescent, 'Job Invoice', 'client', { rate: 22000 }),
    line(si, charge.thc, 'Recievable', party.crescent, 'Job Invoice', 'client', { qty: 1, rate: 18500, size: '20HC' }),
    line(si, charge.handling, 'Payble', party.portside, 'Job Bill', 'vendor', { rate: 16000 }),
  ]);
  const siInvoice = await invoiceFor(si, rows, party.crescent.id, '2026-09-15');
  docs.push([si.jobNo, `B/L ${siBl.hbl}, delivery order, ${siInvoice.invoice_No} (unpaid), 1 charge left to bill`]);

  // ---- 3. Air Export: HAWB on a registered MAWB, invoiced and paid
  const ae = await makeJob({
    operation: 'AE', shipStatus: 'Departed', jobDate: '2026-09-26', shipDate: '2026-09-30', departureDate: '2026-09-30',
    departureTime: '03:40', arrivalDate: '2026-09-30', arrivalTime: '09:15', flightNo: 'SW 715',
    customerRef: 'NSI-EXP-1182', ClientId: party.northern.id, shipperId: party.northern.id, consigneeId: party.medline.id,
    overseasAgentId: party.atlas.id, airLineId: party.skyway.id, localVendorId: party.portside.id,
    commodityId: commodity.surgical.id, pol: 'KHI', pod: 'LHR', fd: 'LHR', freightType: 'Prepaid',
    weight: '388', weightUnit: 'KGS', pcs: '24', pkgUnit: 'CARTONS', vol: '2.52', cwtLine: '420', cwtClient: '420',
  });
  const mawb = await Awbl.findOne({ where: { AirlineId: party.skyway.id, status: 'unused' }, order: [['awbNumber', 'ASC']] });
  const mawbNo = `${mawb.awbNumber.slice(0, 3)}-${mawb.awbNumber.slice(3)}`;
  const aeBl = { hbl: 'BWF-AE-0001', mbl: mawbNo };
  await post('/seaJob/createBl', {
    operation: 'AE', SEJobId: ae.id, ...aeBl, hblDate: '2026-09-30', mblDate: '2026-09-30',
    status: 'Final', issuePlace: 'Karachi', freightType: 'Prepaid', applyToCWT: '0',
    shipperContent: `${party.northern.name}\nSmall Industrial Estate, Ugoki Road\nSialkot, Pakistan`,
    consigneeContent: `${party.medline.name}\nUnit 4, Heathrow Logistics Park\nLondon, UK`,
    descOfGoodsContent: '24 CARTONS SURGICAL INSTRUMENTS\nHS CODE 9018.90', pkgs: 24, unit: 'CARTONS', gross: 388,
    wtUnit: 'KGS', cbm: 2.52, chargableWt: 420, toOne: 'LHR', byOne: party.skyway.name, currency: 'USD',
    Container_Infos: [], Item_Details: [], Dimensions: [],
  });
  await post('/awbl/assign', { awblId: mawb.id, jobId: ae.id });
  rows = await saveCharges(ae, [
    line(ae, charge.afrt, 'Recievable', party.northern, 'Job Invoice', 'client', { qty: 420, rate: 3.2 }),
    line(ae, charge.handling, 'Recievable', party.northern, 'Job Invoice', 'client', { rate: 12500 }),
    line(ae, charge.afrt, 'Payble', party.skyway, 'Job Bill', 'vendor', { qty: 420, rate: 2.75 }),
  ]);
  const aeInvoice = await invoiceFor(ae, rows, party.northern.id, '2026-09-30');
  const aeBill = await invoiceFor(ae, rows, party.skyway.id, '2026-09-30');
  await settle({ invoice: aeInvoice, job: ae, bl: aeBl, amount: Number(aeInvoice.total), payType: 'Recievable', partyKey: 'northern', partyType: 'client', date: '2026-10-03' });
  docs.push([ae.jobNo, `HAWB ${aeBl.hbl} on MAWB ${mawbNo}, ${aeInvoice.invoice_No} (received), ${aeBill.invoice_No} (unpaid)`]);

  // ---- 4. Air Import: charges in, nothing invoiced - for the live demo
  const ai = await makeJob({
    operation: 'AI', shipStatus: 'Arrived', jobDate: '2026-10-01', shipDate: '2026-10-02', departureDate: '2026-10-01',
    arrivalDate: '2026-10-02', arrivalTime: '05:20', flightNo: 'SW 302',
    customerRef: 'MET-AI-0310', ClientId: party.metro.id, shipperId: party.shenzhen.id, consigneeId: party.metro.id,
    overseasAgentId: party.atlas.id, airLineId: party.skyway.id, localVendorId: party.portside.id,
    commodityId: commodity.electronics.id, pol: 'PVG', pod: 'KHI', fd: 'KHI', freightType: 'Collect',
    weight: '215', weightUnit: 'KGS', pcs: '12', pkgUnit: 'CARTONS', vol: '1.4', cwtLine: '235', cwtClient: '235',
  });
  await saveCharges(ai, [
    line(ai, charge.dofee, 'Recievable', party.metro, 'Job Invoice', 'client', { rate: 9500 }),
    line(ai, charge.handling, 'Recievable', party.metro, 'Job Invoice', 'client', { rate: 14000 }),
    line(ai, charge.clearance, 'Recievable', party.metro, 'Job Invoice', 'client', { rate: 18000 }),
    line(ai, charge.clearance, 'Payble', party.clearing, 'Job Bill', 'vendor', { rate: 12000 }),
  ]);
  docs.push([ai.jobNo, '4 charges entered and approved, NOT invoiced - invoice them live']);

  // ---- 5. Sea Export, LCL: booked only
  const se2 = await makeJob({
    operation: 'SE', subType: 'LCL', shipStatus: 'Booked', jobDate: '2026-10-04', shipDate: '2026-10-12',
    customerRef: 'PO-IVT-4502', ClientId: party.indus.id, shipperId: party.indus.id, consigneeId: party.hanseatic.id,
    overseasAgentId: party.atlas.id, shippingLineId: party.oceanic.id, forwarderId: party.coastal.id,
    commodityId: commodity.linen.id, vesselId: vessel.id, VoyageId: exportVoyage.id,
    pol: 'PKKHI', pod: 'DEHAM', fd: 'DEHAM', weight: '2900', weightUnit: 'KGS', pcs: '145', pkgUnit: 'CARTONS',
    vol: '9.8', shpVol: '9.8', billVol: '9.8',
  });
  docs.push([se2.jobNo, 'booked only - no B/L or charges yet (build them live)']);
  for (const [no, what] of docs) step(`${no}  ${what}`);

  /* ------------------------------------------------------- accounts */
  console.log('\nAccounts');
  const voucher = async ({ vType, type, date, lines, narration }) => {
    const heads = lines.map(([ledger, side, amount, accountType = 'partyAccount']) => ({
      type: side, amount, defaultAmount: amount, ChildAccountId: ledger.id, accountType, narration, createdAt: date,
    }));
    return (await post('/voucher/createVoucher', {
      type, vType, currency: 'PKR', exRate: 1, costCenter: 'KHI', CompanyId: companyId, fiscalYearId,
      tranDate: date, createdAt: date, Voucher_Heads: heads,
    })).result;
  };
  const capital = await account('Capitals');
  const opening = await voucher({
    vType: 'OP', type: 'Opening Balance', date: '2026-07-01T00:00:00.000Z', narration: 'Opening bank and cash balances',
    lines: [[bankLedger, 'debit', 5000000], [cashLedger, 'debit', 50000], [capital, 'credit', 5050000]],
  });
  const rent = await voucher({
    vType: 'BPV', type: 'Payment Voucher', date: '2026-09-30T09:00:00.000Z', narration: 'Office rent for September 2026',
    lines: [[await account('OPERATING EXPENSES'), 'debit', 180000], [bankLedger, 'credit', 180000, 'payAccount']],
  });
  const journal = await voucher({
    vType: 'JV', type: 'Journal Voucher', date: '2026-09-30T10:00:00.000Z', narration: 'Audit fee accrued for the quarter',
    lines: [[await account('OPERATING EXPENSES'), 'debit', 75000], [await account('ACCRUED EXPENSES'), 'credit', 75000]],
  });
  step(`${opening.voucher_Id} opening balance, ${rent.voucher_Id} office rent, ${journal.voucher_Id} accrual`);

  await post('/voucher/saveDirectJob', {
    fiscalYearId,
    direct_Job: {
      companyId, Type: 'expense', Operation: 'logistics', Job_Type: 'single', SubType: 'cash', Currency: 'PKR', Ex_Rate: 1,
      Tran_Mode: 'Cash', Account_No: cashLedger.id, Paid_To: cashLedger.id, Entry_Date: '2026-09-24T08:00:00.000Z',
      Add_By: admin.name, Narration: 'Gate pass and port entry, paid in cash',
    },
    direct_Job_Association: [{
      Job_No: se.jobNo, Charge_Name: 'Gate Pass', Quantity: 1, Currency: 'PKR', Ex_Rate: 1, Amount: 3500,
      Tax_Apply: false, Description: 'KICT gate pass, 2 x 40HC', Job_Id: se.id,
    }],
  });
  step(`Direct Job expense on ${se.jobNo}`);

  const openingInvoice = (await post('/invoice/openingInvoice', {
    party_Id: party.indus.ledgerId, party_Name: party.indus.name, type: 'OI', date: '2026-06-30T00:00:00.000Z',
    amount: 350000, currency: 'PKR', payType: 'Recievable', creditAccount: (await account('CONTRA ACCOUNT OPENINIG')).id,
    exRate: 1, operation: 'SE', partyType: 'client', companyId, fiscalYearId,
  })).result.invoices;
  step(`opening invoice ${openingInvoice.invoice_No} for ${party.indus.name}`);

  const outstanding = await Invoice.count({ where: { companyId: String(companyId), approved: '1' } });
  console.log(`\nDone. ${outstanding} approved invoices / bills, 5 jobs.`);
  console.log(`\n  Log in:   ${admin.username} / ${adminCreated ? DEMO_PASSWORD : '(its existing password)'}`);
  console.log(`  Also:     sara / ${DEMO_PASSWORD}  (sales rep - no screens granted)`);
  console.log(`  Company:  ${COMPANY.short} - ${COMPANY.title}`);
  console.log(`  Year:     ${FISCAL_YEAR.label}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('\nSeed failed:', err); process.exit(1); });
