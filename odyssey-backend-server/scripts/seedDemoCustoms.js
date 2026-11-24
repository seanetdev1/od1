/**
 * DEMO DATA FOR A CUSTOMS INSTALL - one of everything, on an empty database.
 *
 *   node scripts/seedDemoCustoms.js            <- says which database, changes nothing
 *   node scripts/seedDemoCustoms.js --apply    <- builds the demo
 *   ... --apply --reset-admin                    <- and sets the admin password to
 *                                                   DEMO_PASSWORD, for a database the
 *                                                   backend has already booted on
 *
 * The customs counterpart of seedDemoFreight.js, built the same way: every
 * record goes through the application's own routes, in-process, so job,
 * invoice and voucher numbers, duty totals, sales tax and ledger postings are
 * exactly what the screens produce.
 *
 * WHAT IT BUILDS
 *   setup     customs mode, a clearing agent company (with bank account),
 *             fiscal year 2026-27, the chart of accounts, ports / airports,
 *             bank and cash ledgers, a sales rep, commodities with HS codes,
 *             the charge master (service charges taxed 15%, duty and port
 *             charges as pass-through disbursements), a charge group,
 *             importers, exporters, a shipping line, the customs collector,
 *             a terminal, a transporter, overseas buyers / sellers
 *   jobs      Export, sea FCL   - On Vessel; invoiced + billed, part received
 *             Import, sea FCL   - DrayOff; duty lines, invoice raised and
 *                                 AWAITING THE DIRECTOR (approve it live),
 *                                 duty and DO bills posted, duty paid
 *             Import, air LCL   - In Process, Red channel; receivables held
 *                                 until On Vessel / DrayOff (the rule, live)
 *             Export, sea LCL   - In Process, no charges (apply the group live)
 *             Export, sea       - cancelled
 *   program   job planning on (Configuration > Customs) and a week of the
 *   book      client's shipping program: 6 planned jobs - 2 confirmed, 3
 *             pending, 1 cancelled - and the first confirmed one already
 *             moved to the jobs list, so the book shows a job number
 *   accounts  opening balance, an opening invoice, a bank payment, a journal
 *             voucher, a Direct Job expense on a declaration
 *
 * SAFE BY CONSTRUCTION - as the freight seed: refuses a database whose name
 * lacks "demo" or that already has customs jobs, and creates the admin with
 * DEMO_PASSWORD only when the database has no users yet.
 *
 *   $env:DB_NAME="odyssey-demo-scratch"; node scripts/seedDemoCustoms.js --apply
 */
const path = require('path');
const { spawnSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const RESET_ADMIN = process.argv.includes('--reset-admin');
const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];

/* ------------------------------------------------------------------ settings
 * Fictional throughout - change the names here, not further down. */
const DEMO_PASSWORD = 'Demo@2026';
const COMPANY = {
  title: 'Harbourline Customs Services (Pvt) Ltd',
  short: 'HCS',
  address: 'Suite 1107, Business Centre, Mumtaz Hassan Road, Karachi',
  phone: '+92 21 3200 0000',
  email: 'info@harbourline-demo.com',
  web: 'www.harbourline-demo.com',
  ntn: '0000000-1',
  strn: '00-00-0000-000-00',
};
const FISCAL_YEAR = { label: '2026-27', suffix: '27', startDate: '2026-07-01', endDate: '2027-06-30' };
const SALES_TAX = 15; // on service charges - Sindh sales tax on services

/* ------------------------------------------------------------------ helpers */
const fail = (msg) => { console.error(`\n  ✗ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`  • ${msg}`);

if (!/demo/i.test(String(cfg.database || ''))) {
  fail(`Database "${cfg.database}" does not have "demo" in its name. This script only fills demo databases.`);
}

console.log(`\nDemo customs data -> ${cfg.database} on ${cfg.host} (NODE_ENV=${env})`);
if (!APPLY) {
  console.log('\nNothing changed. Re-run with --apply to build the demo.\n');
  process.exit(0);
}

async function main() {
  const db = require('../models');
  await db.ready;
  const { Employees, Child_Account, Charge_Head, Client_Associations, Ports } = db;
  const { Customs_Job } = require('../functions/Associations/customsAssociations');
  const { totalDuty } = require('../functions/customsDuty');

  if (await Customs_Job.count() > 0) {
    fail(`${cfg.database} already has customs jobs. This script fills an EMPTY demo database - drop and recreate it to start again.`);
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
  // A backend that has booted on the database once already made the admin,
  // with the random password from that boot's log. On request, a known one.
  if (!adminCreated && RESET_ADMIN) {
    const { hashPassword } = require('../functions/password');
    await admin.update({ password: await hashPassword(DEMO_PASSWORD) });
  }
  const adminKnown = adminCreated || RESET_ADMIN;
  step(adminCreated ? `admin login created (password ${DEMO_PASSWORD})`
    : RESET_ADMIN ? `admin "${admin.username}" password set to ${DEMO_PASSWORD}`
      : `admin login "${admin.username}" already existed - password unchanged (add --reset-admin to set it to ${DEMO_PASSWORD})`);

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
  if (mode.locked && mode.mode !== 'customs') fail(`This database is locked to "${mode.mode}" mode, not customs.`);
  if (!mode.locked) await post('/settings/operationMode', { mode: 'customs' });
  step('operation mode: customs');

  const company = (await post('/companies/createCompany', COMPANY)).result;
  const companyId = String(company.id);
  const bank = (await post('/companies/bankAccount/create', {
    CompanyId: company.id, label: 'Main account (PKR)', bankName: 'Standard Trust Bank Ltd',
    accountTitle: COMPANY.title, accountNo: '0202-7654321-01', iban: 'PK00STBL0000020276543201',
    branch: 'I.I. Chundrigar Road, Karachi', swift: 'STBLPKKA',
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
  const bankLedger = await ledgerChild('STANDARD TRUST BANK - 0202', 'BANK ACCOUNTS', 'Bank');
  const cashLedger = await ledgerChild('PETTY CASH - CUSTOM HOUSE', 'CASH IN HAND', 'Cash');
  const receivables = await account('ACCOUNT RECEIVABLE');
  const payables = await account('ACCOUNT PAYABLE');
  await post('/settings/partyAccounts', { mapping: { receivable: receivables.id, payable: payables.id } });
  step('bank and cash ledgers; new customers / vendors default to Receivable / Payable');

  const salesRep = (await post('/employeeRoutes/createEmployee', {
    createdBy: admin.name,
    values: {
      empName: 'Hamza Qureshi', userName: 'hamza', pass: DEMO_PASSWORD, code: 'E-002',
      selectDesignation: 'employee', selectDepart: 'Sales', represent: 'sr',
      email: 'hamza@harbourline-demo.com', phone: '+92 300 0000012', date: '2026-07-01',
      defaultCompanyId: companyId, accessLevels: [],
    },
  })).result;
  step(`sales representative ${salesRep.name}`);

  /* ------------------------------------------------------- master data */
  console.log('\nMaster data');
  const commodity = {};
  for (const [key, name, hs] of [
    ['linen', 'Cotton Bed Linen', '6302.3100'],
    ['pharma', 'Pharmaceutical Raw Material (Paracetamol)', '2924.2930'],
    ['electronics', 'Mobile Phone Accessories', '8517.7900'],
    ['rice', 'Basmati Rice', '1006.3010'],
  ]) {
    commodity[key] = (await post('/commodity/create', { data: { name, hs, isHazmat: [] } })).result;
  }
  step('4 commodities with HS codes');

  // [key, name, short, calculationType, receivable role, payable role, taxed, pass-through]
  const charge = {};
  for (const [key, name, short, basis, rec, pay, taxed, reimbursable] of [
    ['service', 'AGENCY / SERVICE CHARGES', 'SVC', 'Per Shipment', 'Client', null, true, false],
    ['doc', 'DOCUMENTATION CHARGES', 'DOC', 'Per Shipment', 'Client', null, false, false],
    ['duty', 'CUSTOMS DUTY & TAXES', 'DUTY', 'Per Shipment', 'Client', null, false, true],
    ['wharfage', 'WHARFAGE / PORT CHARGES', 'WHF', 'Per Shipment', 'Client', 'Local-Agent', false, true],
    ['thc', 'TERMINAL HANDLING CHARGES', 'THC', 'Per Unit', 'Client', 'Local-Agent', false, true],
    ['do', 'DELIVERY ORDER CHARGES', 'DO', 'Per Shipment', 'Client', 'Shipping-Line', false, true],
    ['exam', 'EXAMINATION & LABOUR', 'EXM', 'Per Shipment', 'Client', 'Local-Agent', false, true],
    ['transport', 'TRANSPORTATION', 'TRP', 'Per Unit', 'Client', 'Transport-Agent', false, false],
  ]) {
    charge[key] = (await post('/charges/create', {
      data: {
        name, short, currency: 'PKR', calculationType: basis, defaultRecivableParty: rec, defaultPaybleParty: pay,
        taxApply: taxed ? 'Yes' : 'No', taxPerc: taxed ? String(SALES_TAX) : '0', fixAmount: 0, reimbursable,
      },
    })).result;
  }
  step(`${Object.keys(charge).length} charges (service charges taxed ${SALES_TAX}%, duty and port charges pass-through)`);

  const party = {};
  const makeParty = async (key, p, ledger) => {
    const res = await post('/clientRoutes/createClient', {
      active: true, currency: 'PKR', registerDate: '2026-07-01', createdBy: admin.name,
      operations: ['Sea Export', 'Sea Import', 'Air Import', 'Air Export'],
      ...p, pAccountName: ledger === 'ar' ? receivables.id : ledger === 'ap' ? payables.id : '',
    });
    party[key] = res.result;
    if (ledger) {
      const link = await Client_Associations.findOne({ where: { ClientId: party[key].id } });
      party[key].ledgerId = link.ChildAccountId;
    }
  };
  // Clients - billed, so each has a receivable ledger.
  await makeParty('indus', { name: 'Indus Valley Textiles (Pvt) Ltd', types: ['Shipper'],
    address1: 'Plot 14, Sector 7-A, Korangi Industrial Area', city: 'Karachi', person1: 'Imran Siddiqui',
    mobile1: '+92 300 1110001', infoMail: 'exports@indusvalley-demo.com', ntn: '1111111-1', strn: '11-11-1111-111-11' }, 'ar');
  await makeParty('crescent', { name: 'Crescent Pharma (Pvt) Ltd', types: ['Consignee'],
    address1: 'Plot 31, SITE Area', city: 'Karachi', person1: 'Dr. Ayesha Malik',
    mobile1: '+92 300 1110002', infoMail: 'imports@crescentpharma-demo.com', ntn: '2222222-2', strn: '22-22-2222-222-22' }, 'ar');
  await makeParty('metro', { name: 'Metro Electronics Trading', types: ['Consignee'],
    address1: 'Shop 5, Saddar Electronics Market', city: 'Karachi', person1: 'Usman Tariq',
    mobile1: '+92 300 1110004', infoMail: 'purchase@metroelectronics-demo.com', ntn: '4444444-4' }, 'ar');
  await makeParty('kohinoor', { name: 'Kohinoor Rice Exporters', types: ['Shipper'],
    address1: 'Office 12, Grain Market', city: 'Karachi', person1: 'Saad Rehman',
    mobile1: '+92 300 1110005', infoMail: 'export@kohinoorrice-demo.com', ntn: '5555555-5' }, 'ar');
  // Vendors - paid on the client's behalf or for services, so payable ledgers.
  await makeParty('collector', { name: 'Collector of Customs (Duty Payments)', types: ['Local Vendor'],
    address1: 'Custom House, West Wharf', city: 'Karachi', person1: 'Duty Cash' }, 'ap');
  await makeParty('oceanic', { name: 'Oceanic Container Lines', types: ['Shipping Line'],
    address1: 'Office 1101, Dolmen City', city: 'Karachi', person1: 'Import Desk', mobile1: '+92 21 3500 1001' }, 'ap');
  await makeParty('terminal', { name: 'Port Terminal Services Ltd', types: ['Local Vendor'],
    address1: 'East Wharf', city: 'Karachi', person1: 'Billing', mobile1: '+92 21 3500 1003' }, 'ap');
  await makeParty('swift', { name: 'Swift Haulage Services', types: ['Transporter'],
    address1: 'Truck Stand, Hawkesbay Road', city: 'Karachi', person1: 'Dispatch', mobile1: '+92 21 3500 1004' }, 'ap');
  await makeParty('skyway', { name: 'Skyway Airlines Cargo', types: ['Air Line'],
    address1: 'Cargo Complex, Jinnah International Airport', city: 'Karachi', person1: 'Cargo Sales' }, 'ap');
  // Overseas buyers / sellers - on the declaration only, never billed.
  await makeParty('hanseatic', { name: 'Hanseatic Home Textiles GmbH', types: ['Consignee'],
    address1: 'Grosse Elbstrasse 145', city: 'Hamburg', person1: 'Anna Schulz' }, null);
  await makeParty('sinochem', { name: 'Zhejiang Pharma Chem Co Ltd', types: ['Shipper'],
    address1: 'No. 88 Binhai Road', city: 'Taizhou', person1: 'Chen Hao' }, null);
  await makeParty('shenzhen', { name: 'Shenzhen Bright Tech Co Ltd', types: ['Shipper'],
    address1: 'Building 6, Bao an District', city: 'Shenzhen', person1: 'Li Wei' }, null);
  await makeParty('gulf', { name: 'Gulf Fresh Foods LLC', types: ['Consignee'],
    address1: 'Plot S10411, Jebel Ali Free Zone', city: 'Dubai', person1: 'Rashid Al Mansoori' }, null);
  step(`${Object.keys(party).length} parties (4 clients, 5 vendors, 4 overseas)`);

  await post('/customsChargeGroups/save', {
    data: {
      name: 'Standard Export Clearance - Sea', companyId,
      description: 'The usual charges on a sea export file: agency, documents, port and terminal.',
      parties: [{ partyId: party.indus.id, partyName: party.indus.name }, { partyId: party.kohinoor.id, partyName: party.kohinoor.name }],
      lines: [
        { type: 'Recievable', charge: charge.service.id, particular: charge.service.name, basis: 'Per Shipment', qty: 1, rate_charge: 15000, currency: 'PKR' },
        { type: 'Recievable', charge: charge.doc.id, particular: charge.doc.name, basis: 'Per Shipment', qty: 1, rate_charge: 3500, currency: 'PKR' },
        { type: 'Recievable', charge: charge.wharfage.id, particular: charge.wharfage.name, basis: 'Per Shipment', qty: 1, rate_charge: 9800, currency: 'PKR' },
        { type: 'Recievable', charge: charge.thc.id, particular: charge.thc.name, basis: 'Per Unit', qty: 1, rate_charge: 27500, currency: 'PKR' },
      ],
    },
  });
  step('charge group "Standard Export Clearance - Sea"');

  /* ------------------------------------------------------- declarations */
  console.log('\nDeclarations');
  const line = (c, type, p, { qty = 1, rate, approved = true, description = '' }) => ({
    charge: c.id, particular: c.name, type, basis: c.calculationType, description,
    partyId: p.id, name: p.name, partyType: type === 'Recievable' ? 'client' : 'vendor',
    qty, rate_charge: rate, discount: 0, currency: 'PKR', ex_rate: 1,
    tax_apply: c.taxApply === 'Yes', taxPerc: c.taxApply === 'Yes' ? c.taxPerc : 0,
    status: approved ? '1' : '0',
  });
  const declaration = async (data) => (await post('/customsJob/create', {
    data: { companyId, fiscalYearId, ...data },
  })).result;
  const chargesOf = (job) => Charge_Head.findAll({ where: { CustomsJobId: job.id }, order: [['id', 'ASC']] });
  // Make Invoice raises them UNAPPROVED - the director's step is /invoice/approve.
  const makeInvoices = async (job, rows) => (await post('/customsJob/makeInvoice', {
    chargeIds: rows.map((r) => r.id), companyId, fiscalYearId,
  })).result;
  const datedAndApproved = async (doc, date, { approve = true } = {}) => {
    await post('/invoice/changeDate', { id: doc.id, date });
    if (!approve) return doc;
    return (await post('/invoice/approve', { id: doc.id, fiscalYearId })).invoice;
  };
  const settle = async ({ invoice, job, amount, payType, partyKey, partyType, date }) => {
    const receiving = payType === 'Recievable';
    const p = party[partyKey];
    await post('/voucher/makeTransaction', {
      edit: false, advance: false, payType, transactionMode: 'Bank', subType: 'Bank',
      partyId: p.id, partyName: p.name, partyType, type: partyType,
      companyId, currency: 'PKR', exRate: 1, fiscalYearId, tranDate: date, narration: '',
      totalReceiving: receiving ? amount : 0, gainLoss: 0, checkNo: '', checkDate: '',
      invoices: [{ id: invoice.id, invoice_No: invoice.invoice_No, payType, party_Name: invoice.party_Name, receiving: amount, SE_Job: { jobNo: job.jobNo } }],
      transactions: [
        { accountName: p.name, type: receiving ? 'credit' : 'debit', credit: receiving ? amount : 0, debit: receiving ? 0 : amount, accountType: 'partyAccount', partyId: p.id, currency: 'PKR' },
        { accountName: bankLedger.title, type: receiving ? 'debit' : 'credit', debit: receiving ? amount : 0, credit: receiving ? 0 : amount, accountType: 'payAccount', partyId: bankLedger.id, currency: 'PKR' },
      ],
    });
  };
  const docs = [];

  // ---- 1. Export, sea FCL: On Vessel, invoiced, billed, part received
  const exp = await declaration({
    direction: 'Export', transportMode: 'Sea', gdType: 'Export', channel: 'Green', status: 'Complete',
    jobDate: '2026-09-18', gdNumber: 'KEXP-SB-104871-18092026', gdDate: '2026-09-18', jobRef: 'SR-2207',
    clientRef: 'IVT-INV-4471', invoiceDate: '2026-09-15', invoiceValue: 86400, invoiceCurrency: 'USD', exRate: '280.50',
    formENo: 'FE-NBP-2026-55120', clientId: party.indus.id, shipperId: party.indus.id, consigneeId: party.hanseatic.id,
    CommodityId: commodity.linen.id, shippingLineId: party.oceanic.id, transporterId: party.swift.id,
    pol: 'MEK', pod: 'DEHAM', pofd: 'Hamburg, Germany', terminal: 'KICT', cargoType: 'FCL', incoTerms: 'FREE ON BOARD',
    blNo: 'OCLU2641778812', blDate: '2026-09-28', mblNo: 'OCLU2641778812', vesselOrFlight: 'MV ARABIAN PEARL',
    voyageNo: 'AP-2641W', sailingDate: '2026-09-28', shippingBillNo: 'SB-104871', shippingBillDate: '2026-09-18',
    packages: 1840, pkgUnit: 'Cartons', grossWeight: 36800, netWeight: 35800, containers: '2 x 40HC',
    goodsDescription: '1840 CARTONS COTTON BED LINEN, HS 6302.3100', costCenter: 'KHI',
    containerRows: [
      { containerNo: 'OCLU4417720', sizeType: '40HC', grossWeight: 18400, netWeight: 17900, packages: 920, truckNo: 'JU-4471' },
      { containerNo: 'OCLU4417736', sizeType: '40HC', grossWeight: 18400, netWeight: 17900, packages: 920, truckNo: 'JU-4472' },
    ],
    charges: [
      line(charge.service, 'Recievable', party.indus, { rate: 15000 }),
      line(charge.doc, 'Recievable', party.indus, { rate: 3500 }),
      line(charge.wharfage, 'Recievable', party.indus, { rate: 9800 }),
      line(charge.thc, 'Recievable', party.indus, { qty: 2, rate: 27500 }),
      line(charge.transport, 'Recievable', party.indus, { qty: 2, rate: 24000 }),
      line(charge.transport, 'Payble', party.swift, { qty: 2, rate: 19000 }),
    ],
  });
  let made = await makeInvoices(exp, (await chargesOf(exp)).filter((c) => c.status === '1'));
  const expInvoice = await datedAndApproved(made.find((d) => d.type === 'Job Invoice'), '2026-09-28');
  const expBill = await datedAndApproved(made.find((d) => d.type === 'Job Bill'), '2026-09-28');
  await settle({ invoice: expInvoice, job: exp, amount: Math.round(Number(expInvoice.total) * 0.5), payType: 'Recievable', partyKey: 'indus', partyType: 'client', date: '2026-10-02' });
  docs.push([exp.jobNo, `export, On Vessel - ${expInvoice.invoice_No} (half received), ${expBill.invoice_No} (unpaid)`]);

  // ---- 2. Import, sea FCL: DrayOff, duty lines, invoice waiting for the director
  const dutyLine = {
    itemNo: '1', quantity: 18000, sroNumber: '', originCode: 'CN', assessedValue: 9820000, fobValue: 33500,
    cnfValue: 35050, exchangeRate: 280.15, customDutyPerc: 11, additionalCustomDutyPerc: 2, regulatoryDutyPerc: 0,
    salesTaxPerc: 18, additionalSalesTaxPerc: 3, incomeTaxPerc: 5.5,
  };
  const duty = Math.round(totalDuty({ dutyLines: [dutyLine] }));
  const imp = await declaration({
    direction: 'Import', transportMode: 'Sea', gdType: 'Home Consumption', channel: 'Yellow', status: 'DrayOff',
    jobDate: '2026-09-09', gdNumber: 'KAPW-HC-221906-14092026', gdDate: '2026-09-14', jobRef: 'SR-2188',
    clientRef: 'ZPC-2026-0915', invoiceDate: '2026-08-28', invoiceValue: 33500, invoiceCurrency: 'USD', exRate: '280.15',
    lcNo: 'LC-MCB-2026-3381', clientId: party.crescent.id, shipperId: party.sinochem.id, consigneeId: party.crescent.id,
    CommodityId: commodity.pharma.id, shippingLineId: party.oceanic.id, localVendorId: party.terminal.id,
    pol: 'CNNGB', pod: 'PKKHI', terminal: 'QICT', cargoType: 'FCL', incoTerms: 'COST AND FREIGHT',
    blNo: 'OCLU2633019841', blDate: '2026-08-30', igmNo: 'IGM-2026-1407', indexNo: '118', vesselOrFlight: 'MV EASTERN STAR',
    voyageNo: 'ES-2633E', etaDate: '2026-09-08', arrivalDate: '2026-09-08', deliveryDate: '2026-09-17',
    packages: 720, pkgUnit: 'Bags', grossWeight: 18450, netWeight: 18000, containers: '1 x 40HC',
    assessedValue: 9820000, psid: 'PSID-2026-0914-77812', dutyPaidDate: '2026-09-14', dutyPaidBy: 'Agent',
    goodsDescription: '720 BAGS PARACETAMOL BP (RAW MATERIAL), HS 2924.2930', costCenter: 'KHI',
    dutyLines: [dutyLine],
    containerRows: [{ containerNo: 'OCLU5512094', sizeType: '40HC', grossWeight: 18450, netWeight: 18000, packages: 720 }],
    charges: [
      line(charge.duty, 'Recievable', party.crescent, { rate: duty, description: 'Duty & taxes as assessed on the GD' }),
      line(charge.service, 'Recievable', party.crescent, { rate: 25000 }),
      line(charge.do, 'Recievable', party.crescent, { rate: 18000 }),
      line(charge.exam, 'Recievable', party.crescent, { rate: 6500 }),
      line(charge.duty, 'Payble', party.collector, { rate: duty, description: 'Duty paid through PSID' }),
      line(charge.do, 'Payble', party.oceanic, { rate: 18000 }),
    ],
  });
  made = await makeInvoices(imp, (await chargesOf(imp)).filter((c) => c.status === '1'));
  const impInvoice = await datedAndApproved(made.find((d) => d.type === 'Job Invoice'), '2026-09-17', { approve: false });
  const impBills = [];
  for (const bill of made.filter((d) => d.type === 'Job Bill')) impBills.push(await datedAndApproved(bill, '2026-09-14'));
  const dutyBill = impBills.find((b) => b.party_Name === party.collector.name);
  await settle({ invoice: dutyBill, job: imp, amount: Number(dutyBill.total), payType: 'Payble', partyKey: 'collector', partyType: 'vendor', date: '2026-09-14' });
  docs.push([imp.jobNo, `import, DrayOff - duty ${duty.toLocaleString()} from its duty line; ${impInvoice.invoice_No} WAITING FOR APPROVAL; duty bill paid`]);

  // ---- 3. Import, air LCL: In Process, Red channel - receivables held by the rule
  const air = await declaration({
    direction: 'Import', transportMode: 'Air', gdType: 'Home Consumption', channel: 'Red', status: 'Incomplete',
    jobDate: '2026-10-01', gdNumber: 'KAPA-HC-019554-02102026', gdDate: '2026-10-02', jobRef: 'SR-2231',
    clientRef: 'MET-AI-0310', invoiceValue: 12400, invoiceCurrency: 'USD', exRate: '280.40',
    clientId: party.metro.id, shipperId: party.shenzhen.id, consigneeId: party.metro.id, CommodityId: commodity.electronics.id,
    shippingLineId: party.skyway.id, pol: 'MIA', pod: 'PKKHI', terminal: "Gerry's Dnata", cargoType: 'LCL',
    blNo: '786-45012310', vesselOrFlight: 'SW 302', arrivalDate: '2026-10-02',
    packages: 12, pkgUnit: 'Cartons', grossWeight: 215, netWeight: 198,
    goodsDescription: '12 CARTONS MOBILE PHONE ACCESSORIES, HS 8517.7900', costCenter: 'KHI',
    charges: [
      // Receivables entered, NOT approved: they wait for On Vessel / DrayOff.
      line(charge.service, 'Recievable', party.metro, { rate: 18000, approved: false }),
      line(charge.exam, 'Recievable', party.metro, { rate: 9500, approved: false }),
      line(charge.exam, 'Payble', party.terminal, { rate: 7000 }),
    ],
  });
  docs.push([air.jobNo, 'import by air, In Process, Red channel - receivables waiting on the status (the rule, live)']);

  // ---- 4. Export, sea LCL: In Process, nothing charged yet
  const lcl = await declaration({
    direction: 'Export', transportMode: 'Sea', gdType: 'Export', status: 'Incomplete',
    jobDate: '2026-10-04', jobRef: 'SR-2240', clientRef: 'KRE-EXP-2026-118', invoiceValue: 21600, invoiceCurrency: 'USD',
    exRate: '280.40', clientId: party.kohinoor.id, shipperId: party.kohinoor.id, consigneeId: party.gulf.id,
    CommodityId: commodity.rice.id, shippingLineId: party.oceanic.id, pol: 'PQE', pod: 'AEJEA', pofd: 'Dubai, UAE',
    terminal: 'SAPT', cargoType: 'LCL', packages: 400, pkgUnit: 'Bags', grossWeight: 10050, netWeight: 10000,
    goodsDescription: '400 BAGS BASMATI RICE, HS 1006.3010', costCenter: 'KHI',
  });
  docs.push([lcl.jobNo, 'export, In Process - no charges yet (apply the charge group live)']);

  // ---- 5. Cancelled
  const cancelled = await declaration({
    direction: 'Export', transportMode: 'Sea', gdType: 'Export', status: 'Incomplete',
    jobDate: '2026-09-25', jobRef: 'SR-2219', clientRef: 'IVT-INV-4488', clientId: party.indus.id,
    shipperId: party.indus.id, consigneeId: party.hanseatic.id, CommodityId: commodity.linen.id,
    pol: 'MEK', pod: 'DEHAM', cargoType: 'FCL', goodsDescription: 'COTTON BED LINEN', costCenter: 'KHI',
    cancelReason: 'Order withdrawn by the buyer',
  });
  await post('/customsJob/delete', { id: cancelled.id });
  docs.push([cancelled.jobNo, 'cancelled']);
  for (const [no, what] of docs) step(`${no}  ${what}`);

  /* ------------------------------------------------------- program book */
  console.log('\nProgram Book');
  // Job planning on, and the client's shipping program as it would arrive:
  // confirmed rows ready to move, rows waiting on the buyer, a cancelled one.
  await post('/settings/customsPlanning', { enabled: true });
  const planRow = (p) => ({ status: 'Pending', pol: 'MEK', shippingLineId: party.oceanic.id, ...p });
  await post('/customsJob/plans/save', {
    companyId,
    rows: [
      planRow({ status: 'Confirmed', shipperId: party.indus.id, invoiceNo: 'IVT-INV-4521', qty: 2, size: '40HC',
        pod: 'DEHAM', containers: 'OCLU7781203, OCLU7781219', gateInTime: '2026-10-08 10:30', vessel: 'MV ARABIAN PEARL',
        cutOff: '2026-10-09 18:00', bookingNo: 'OCL-BK-55120', currentStatus: 'Gated in',
        vehicleDetail: 'JW-4410, TKB-2281', remarks: 'Stuffed at the factory' }),
      planRow({ status: 'Confirmed', shipperId: party.kohinoor.id, invoiceNo: 'KRE-EXP-0917', qty: 1, size: '20GP',
        pol: 'PQE', pod: 'AEJEA', vessel: 'MV GULF TRADER', cutOff: '2026-10-10 12:00', bookingNo: 'OCL-BK-55187',
        currentStatus: 'Empty picked up', vehicleDetail: 'JY-7702' }),
      planRow({ shipperId: party.indus.id, invoiceNo: 'IVT-INV-4530', qty: 3, size: '40HC', pod: 'NLRTM',
        vessel: 'MV NORTHERN LIGHT', cutOff: '2026-10-14 18:00', currentStatus: 'Awaiting booking',
        remarks: 'Buyer to confirm by Friday' }),
      planRow({ shipperId: party.kohinoor.id, invoiceNo: 'KRE-EXP-0921', qty: 2, size: '20GP', pol: 'PQE', pod: 'AEJEA',
        cutOff: '2026-10-15 12:00', currentStatus: 'Awaiting booking' }),
      planRow({ shipperId: party.indus.id, invoiceNo: 'IVT-INV-4535', qty: 1, size: '40HC', pod: 'USNYC',
        vessel: 'MV ATLANTIC CROWN', cutOff: '2026-10-17 18:00', bookingNo: 'OCL-BK-55240' }),
      planRow({ status: 'Cancelled', shipperId: party.kohinoor.id, invoiceNo: 'KRE-EXP-0904', qty: 1, size: '20GP',
        pol: 'PQE', pod: 'AEJEA', remarks: 'Buyer cancelled the order' }),
    ],
  });
  const plans = (await call('get', '/customsJob/plans/get', null, { companyid: companyId })).result;
  const movedPlan = (await post('/customsJob/plans/move', { companyId, ids: [plans[0].id], fiscalYearId })).result[0];
  step(`${plans.length} planned jobs - 2 confirmed, 3 pending, 1 cancelled`);
  step(`the first moved to the jobs list as ${movedPlan.jobNo}; the second is confirmed, ready to move live`);

  /* ------------------------------------------------------- accounts */
  console.log('\nAccounts');
  const voucher = async ({ vType, type, date, lines, narration }) => {
    const heads = lines.map(([ledger, side, amount, accountType = 'partyAccount']) => ({
      type: side, amount, defaultAmount: amount, ChildAccountId: ledger.id, accountType, narration, createdAt: date,
    }));
    return (await post('/voucher/createVoucher', {
      type, vType, currency: 'PKR', exRate: 1, costCenter: 'KHI', CompanyId: company.id, fiscalYearId,
      tranDate: date, createdAt: date, Voucher_Heads: heads,
    })).result;
  };
  const opening = await voucher({
    vType: 'OP', type: 'Opening Balance', date: '2026-07-01T00:00:00.000Z', narration: 'Opening bank and cash balances',
    lines: [[bankLedger, 'debit', 8000000], [cashLedger, 'debit', 75000], [await account('Capitals'), 'credit', 8075000]],
  });
  const rent = await voucher({
    vType: 'BPV', type: 'Payment Voucher', date: '2026-09-30T09:00:00.000Z', narration: 'Office rent for September 2026',
    lines: [[await account('OPERATING EXPENSES'), 'debit', 150000], [bankLedger, 'credit', 150000, 'payAccount']],
  });
  const journal = await voucher({
    vType: 'JV', type: 'Journal Voucher', date: '2026-09-30T10:00:00.000Z', narration: 'Audit fee accrued for the quarter',
    lines: [[await account('OPERATING EXPENSES'), 'debit', 60000], [await account('ACCRUED EXPENSES'), 'credit', 60000]],
  });
  step(`${opening.voucher_Id} opening balance, ${rent.voucher_Id} office rent, ${journal.voucher_Id} accrual`);

  await post('/voucher/saveDirectJob', {
    fiscalYearId,
    direct_Job: {
      companyId, Type: 'expense', Operation: 'logistics', Job_Type: 'single', SubType: 'cash', Currency: 'PKR', Ex_Rate: 1,
      Tran_Mode: 'Cash', Account_No: cashLedger.id, Paid_To: cashLedger.id, Entry_Date: '2026-09-15T08:00:00.000Z',
      Add_By: admin.name, Narration: 'Examination labour at QICT, paid in cash',
    },
    direct_Job_Association: [{
      Job_No: imp.jobNo, Charge_Name: 'Examination labour', Quantity: 1, Currency: 'PKR', Ex_Rate: 1, Amount: 4500,
      Tax_Apply: false, Description: 'Yellow channel examination, 1 x 40HC', Job_Id: imp.id,
    }],
  });
  step(`Direct Job expense on ${imp.jobNo}`);

  const openingInvoice = (await post('/invoice/openingInvoice', {
    party_Id: party.indus.ledgerId, party_Name: party.indus.name, type: 'OI', date: '2026-06-30T00:00:00.000Z',
    amount: 275000, currency: 'PKR', payType: 'Recievable', creditAccount: (await account('CONTRA ACCOUNT OPENINIG')).id,
    exRate: 1, operation: 'CC', partyType: 'client', companyId, fiscalYearId,
  })).result.invoices;
  step(`opening invoice ${openingInvoice.invoice_No} for ${party.indus.name}`);

  console.log(`\nDone. 6 declarations (one moved in from the Program Book) and 6 planned jobs.`);
  console.log(`\n  Log in:   ${admin.username} / ${adminKnown ? DEMO_PASSWORD : '(its existing password)'}`);
  console.log(`  Also:     hamza / ${DEMO_PASSWORD}  (sales rep - no screens granted)`);
  console.log(`  Company:  ${COMPANY.short} - ${COMPANY.title}`);
  console.log(`  Year:     ${FISCAL_YEAR.label}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('\nSeed failed:', err); process.exit(1); });
