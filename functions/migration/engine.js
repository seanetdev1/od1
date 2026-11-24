import axiosClient from 'apis/axiosClient';
import * as steps from './steps';
import { migrateChartOfAccounts } from './coa';
import { migrateParties } from './parties';
import { migrateEmployees } from './employees';
import { migrateCompanies } from './companies';
import { migrateCharges } from './charges';
import { migrateCommodities } from './commodity';
import { migrateLocations } from './locations';
import { migrateJobs } from './jobs';
import { migrateVoyages } from './voyages';
import { migrateBls } from './bls';
import { migrateBlChildren } from './blChildren';
import { migrateJobEquipment } from './jobEquipment';
import { migrateLoadingPrograms } from './loadingPrograms';
import { migrateChargeHeads } from './chargeHeads';
import { migrateInvoices } from './invoices';
import { migrateLedger } from './ledger';
import { migrateLgJobs } from './lgJobs';
import { migrateHsCodes } from './hsCodes';
import { migrateCustomsChargeLines } from './customsChargeLines';
import { migrateCustomsInvoices } from './customsInvoices';
import { migrateDirectJobs } from './directJobs';
import { migrateTaxInvoices } from './taxInvoices';
import { migrateVendorTaxInvoices } from './vendorTaxInvoices';

/**
 * Staged migration engine.
 *
 * The old migration ran everything at once: importJobs() pulled jobs, charge
 * heads, invoices, vouchers and voucher heads in a single pass, and the
 * receiver walked Job -> Charge_Head -> Invoice -> Voucher -> Voucher_Heads
 * inside one request. That made it impossible to answer "did the jobs land?"
 * before the charges went in, and a failure half way through was
 * indistinguishable from success.
 *
 * Here each stage owns one table, and after it runs the engine asks the backend
 * for that table's row count before allowing the next stage to start. The
 * relationships the all-at-once version built are preserved, because the
 * receivers resolve their foreign keys through the legacy `climaxId` stored on
 * each row - which is exactly why the ORDER below matters and why every stage
 * declares what it depends on.
 */

export const MODES = {
  freight: {
    label: 'Freight (Sea / Air)',
    hint: 'Legacy SExp/SImp/AExp/AImp job structures. The original migration path.',
  },
  customs: {
    label: 'Customs Clearance',
    hint: 'Legacy LOG job structure (clearing / transport). Different job shape from freight.',
  },
};

/**
 * A stage:
 *   id        stable key, also the /migration/counts key it verifies against
 *   run       the work
 *   verifies  which counts key to check afterwards (null = nothing countable).
 *             May be an array when a stage writes more than one table.
 *   dependsOn stages that must have run first
 *   modes     which migration types include this stage
 */
export const STAGES = [
  {
    id: 'companies',
    label: 'Companies',
    rewritten: true,
    detail:
      'Gen_SubCompanies, with logos and letterhead. Replaces the companies already here: ' +
      'anything not in the legacy export is deleted. Vouchers and bank accounts cascade ' +
      'with a company, so the stage refuses to delete one that still owns any unless ' +
      'forced, and reports what a replace costs before doing it.',
    modes: ['freight', 'customs'],
    dependsOn: [],
    verifies: 'companies',
    // replaceExisting: the ask is for the legacy companies to be the set, not
    // to sit alongside whatever was created by hand.
    run: (report) => migrateCompanies(report, { replaceExisting: true }),
  },
  {
    id: 'employees',
    label: 'Employees',
    rewritten: true,
    detail:
      'The staff records jobs reference by sales rep (TAP_Employee). Imported as RECORDS, ' +
      'not accounts: the legacy system has one shared login and no per-person users, so ' +
      'there is nothing to migrate as a user. Real users get created in Setup > Employees.',
    modes: ['freight', 'customs'],
    dependsOn: ['companies'],
    verifies: 'employees',
    run: (report) => migrateEmployees(report),
  },
  {
    id: 'commodities',
    label: 'Commodities',
    rewritten: true,
    detail:
      'The commodity master - around 10,000 rows. The old import stored the hazmat ' +
      'flag as a boolean in a string column, and every screen tests it with == 1, so hazardous ' +
      'commodities rendered as non-hazardous. Re-running corrects rows it already wrote. ' +
      'FREIGHT ONLY. A clearing job has no connection to this table - Log_Job has no ' +
      'CommodityId column at all, and every one of the 33 tables referencing Gen_Commodity is ' +
      'empty. A customs install gets the HS Tariff Codes stage instead, which imports the ' +
      'table Log_Job IS wired to (Gen_UnCommodity). Importing both would put ~16,900 entries ' +
      'of two different kinds into one picker, 10,275 of which nothing has ever referenced.',
    modes: ['freight'],
    dependsOn: ['companies'],
    verifies: 'commodities',
    run: (report) => migrateCommodities(report),
  },
  {
    id: 'hsCodes',
    label: 'HS Tariff Codes',
    rewritten: true,
    detail:
      'Gen_UnCommodity - the customs tariff master, 6,607 codes with their descriptions. This ' +
      'is the commodity table a clearing job is actually wired to: Log_Job.HSCCode is a ' +
      'foreign key onto it, where Log_Job has no CommodityId column at all. No legacy job ' +
      'populates HSCCode, so nothing historical links here - it is imported as the reference ' +
      'data needed to classify goods on a NEW declaration, which a general commodity list ' +
      'cannot do. Lands in the same commodity list, keyed on the HS code because ' +
      'Gen_UnCommodity has no id.',
    modes: ['customs'],
    dependsOn: ['companies'],
    verifies: 'commodities',
    run: (report) => migrateHsCodes(report),
  },
  {
    id: 'voyages',
    label: 'Vessels & Voyages',
    rewritten: true,
    detail:
      'The stage Jobs leans on hardest: a job resolves its voyage by vessel plus voyage ' +
      'number. The old import had no idempotency check at all, so a second run duplicated ' +
      'every vessel and split its voyages across both copies.',
    modes: ['freight'],
    dependsOn: ['companies'],
    verifies: 'voyages',
    run: (report) => migrateVoyages(report),
  },
  {
    id: 'airports',
    label: 'Airports, Ports & Destinations',
    rewritten: true,
    detail:
      'Gen_UNAirport plus Gen_UNLocation split into sea ports and destinations. The largest ' +
      'stage by far: a ~47.7 MB export yielding ~207,000 rows, so it reports progress per ' +
      'batch. Names are trimmed and unresolved lookups no longer store a blank cell.',
    modes: ['freight', 'customs'],
    dependsOn: ['companies'],
    verifies: 'airports',
    run: (report) => migrateLocations(report),
  },
  {
    id: 'accounts',
    label: 'Chart of Accounts',
    rewritten: true,
    detail:
      'Plans the import first and refuses to write if anything blocks it - ids already ' +
      'taken by a seeded chart, or accounts that reference each other in a loop. Verifies ' +
      'afterwards that every account can still reach a root, which a row count cannot see.',
    modes: ['freight', 'customs'],
    dependsOn: ['companies'],
    verifies: 'accounts',
    // The rewritten stage (functions/migration/coa.js). steps.importCOA is
    // still there and still works; it just does not plan, verify, or run in a
    // transaction.
    run: (report) => migrateChartOfAccounts(report),
  },
  {
    id: 'charges',
    label: 'Charge Master',
    rewritten: true,
    detail:
      'The charge catalogue, not the per-job charge lines. Every job charge line resolves its ' +
      'charge through the legacy id, which the old import dropped - so it could not tell a ' +
      're-run from a first run and duplicated the whole catalogue.',
    modes: ['freight', 'customs'],
    dependsOn: ['accounts'],
    verifies: 'charges',
    run: (report) => migrateCharges(report),
  },
  {
    id: 'parties',
    label: 'Parties (Clients / Vendors)',
    rewritten: true,
    detail:
      'Depends on the chart of accounts: a party is joined to its ledger account by ' +
      'legacy account id, and without that link the client imports fine but can never ' +
      'be invoiced. Verifies that link afterwards, which a client count cannot see.',
    modes: ['freight', 'customs'],
    dependsOn: ['accounts'],
    verifies: 'parties',
    linkage: ['clientsWithoutLedgerAccount'],
    run: (report) => migrateParties(report),
  },
  // THE LEDGER MOVED.
  //
  // It used to sit here, before jobs, because the old job receivers resolved a
  // charge line's invoice by looking it up as they went - so the invoices had
  // to exist first or every charge line was written with a null InvoiceId.
  //
  // The rewritten sequence does not work that way. Charge lines are attached to
  // their jobs by the chargeHeads stage and pointed at their invoice by the
  // invoices stage, both from the legacy junction tables. The ledger now runs
  // AFTER invoices, because settling an invoice requires the invoice to exist.
  // See its entry below.
  {
    id: 'jobs',
    label: 'Jobs (job records only)',
    rewritten: true,
    detail:
      'Job records only - no B/Ls, equipment, stamps or charge lines; those get their own ' +
      'stages, so migrated jobs will have none until then. All four legacy job tables land ' +
      'in one table separated by operation. Resolves foreign keys on the Odyssey side, so it ' +
      'no longer pulls 40 legacy tables to import jobs.',
    modes: ['freight'],
    // No longer depends on the ledger: nothing here touches invoices or
    // vouchers. It still needs the masters its foreign keys point at.
    dependsOn: ['companies', 'employees', 'commodities', 'voyages', 'parties'],
    verifies: 'jobs',
    // Foreign keys this stage is responsible for. Row counts cannot see a null
    // FK, so a stage that inserts the right number of unlinked rows looks
    // identical to one that worked - checked here instead.
    // No linkage keys: this stage no longer creates charge heads or B/Ls, so
    // it is not responsible for their foreign keys and reporting them here
    // would blame it for whatever an earlier run left behind. The job-level
    // links it IS responsible for are checked by /jobMigration/verify.
    run: (report) => migrateJobs(report),
  },
  {
    id: 'bls',
    label: 'B/Ls & Air Waybills',
    rewritten: true,
    detail:
      'B/L records only - no containers, stamps or dimensions; those get their own stages. ' +
      'All four legacy B/L tables land in one table separated by operation. The old import ' +
      'wrote IssuePlace/IssueDate with a capital I, which the model does not declare, so ' +
      'Sequelize dropped the place and date of issue on every B/L it ever created.',
    modes: ['freight'],
    // A B/L is attached through its job's legacy id, so the jobs have to exist.
    dependsOn: ['jobs'],
    verifies: 'bls',
    run: (report) => migrateBls(report),
  },
  {
    id: 'blChildren',
    label: 'B/L Containers, Stamps, Dimensions & Rate Lines',
    rewritten: true,
    detail:
      'The four things that hang off a B/L. The old import created them as a side effect of ' +
      'importing a job, computed tare weight instead of migrating it, dropped the container ' +
      'free-day counts, and never imported dimensions at all.',
    modes: ['freight'],
    dependsOn: ['bls'],
    // Four tables, because this stage writes all four in one run.
    verifies: ['containers', 'stamps', 'dimensions', 'items'],
    run: (report) => migrateBlChildren(report),
  },
  {
    id: 'jobEquipment',
    label: 'Job Equipment',
    rewritten: true,
    detail:
      'What the job booked - not the containers on its B/L, which are a different table. ' +
      'Sea only. The old import read the size catalogue default weight instead of the ' +
      'weight on the row, and threw on any size code the catalogue did not list.',
    modes: ['freight'],
    dependsOn: ['jobs'],
    verifies: 'equipment',
    run: (report) => migrateJobEquipment(report),
  },
  {
    id: 'loadingPrograms',
    label: 'Loading Programs',
    rewritten: true,
    detail:
      'Never migrated by any previous path - every sea export job currently has an empty ' +
      'one. Sea export only, one per job. Some legacy lookup ids do not resolve to anything ' +
      'meaningful, and those fields are left empty rather than filled with a raw id.',
    modes: ['freight'],
    dependsOn: ['jobs'],
    verifies: 'loadingPrograms',
    run: (report) => migrateLoadingPrograms(report),
  },
  {
    id: 'chargeHeads',
    label: 'Job Charge Lines',
    rewritten: true,
    detail:
      '~103,000 lines across eight legacy tables, attached to their jobs with their charge, ' +
      'party, amounts and tax. The old import hardcoded every line amount to 1. The invoice ' +
      'link is left to the ledger stage rather than half-resolved here.',
    modes: ['freight'],
    dependsOn: ['jobs', 'charges', 'parties'],
    verifies: 'chargeHeads',
    // chargeHeadsWithoutJob is this stage's responsibility; withoutInvoice
    // belongs to the invoices stage below, so it is deliberately not listed.
    linkage: ['chargeHeadsWithoutJob'],
    run: (report) => migrateChargeHeads(report),
  },
  {
    id: 'invoices',
    label: 'Job Invoices',
    rewritten: true,
    detail:
      'All 40,026 legacy invoices across three tables - client invoices, vendor bills and agent ' +
      'invoices - each attached to its job and party, and each pointed at by the charge lines it ' +
      'carries. This is what closes the invoice link the charge-line stage left open. The 7,775 ' +
      'cutover opening balances come too, as Opening Invoice / Opening Bill with no job. ' +
      'Settlement stays with the ledger stage: nothing here invents a payment.',
    modes: ['freight'],
    dependsOn: ['jobs', 'parties', 'chargeHeads'],
    verifies: 'invoices',
    // The link this stage creates is exactly what this orphan check counts.
    linkage: ['chargeHeadsWithoutInvoice'],
    run: (report) => migrateInvoices(report),
  },
  {
    id: 'lgJobs',
    label: 'Clearing / Transport Jobs',
    rewritten: true,
    detail:
      'Legacy Log_Job into Customs_Job, with Log_DutyCalculation into Customs_Duty - the rates '
      + 'the declaration was assessed at, one row per item. This is the customs-clearance '
      + 'equivalent of the jobs stage, and it targets the CUSTOMS module: the old path wrote '
      + 'these into SE_Job, which a customs install has no screens for. Job records and duty '
      + 'only - charge lines and invoices are not imported by this stage.',
    modes: ['customs'],
    // No employees: nothing on a clearance file resolves through them now that
    // the sales rep is not mapped. And no commodities: Log_Job has no
    // CommodityId column, so the mapper's commodity lookup can never resolve
    // anything - listing it as a dependency pointed at a stage this mode no
    // longer runs. Ledger is not a dependency of the job record itself either;
    // that was inherited from the old all-at-once import.
    dependsOn: ['companies', 'parties'],
    // Its own count key, not 'jobs': these land in Customs_Jobs, and verifying
    // against the SE_Job count would compare against a table this stage never
    // writes - passing whatever it did.
    verifies: 'customsJobs',
    run: (report, options) => migrateLgJobs(report, options),
  },
  {
    id: 'customsChargeLines',
    label: 'Clearing Charge Lines',
    rewritten: true,
    detail:
      'Log_Job_ChargesRecv and _ChargesPayb into Charge_Head, attached by CustomsJobId - ' +
      '143,368 lines across 95% of clearing jobs. THIS IS WHERE THE MONEY IS: the clearing-job ' +
      'stage carries headers only, and on a database where Log_DutyCalculation is empty the ' +
      'duty, wharfage and port charges arrive here as ordinary charge lines. Uses the same ' +
      'receiver as the freight charge lines - the legacy tables are structurally identical - ' +
      'and records which invoice document each line sits on, which is what the job P&L splits ' +
      'revenue from cost on. The invoice link itself is left to the Clearing Invoices stage.',
    modes: ['customs'],
    // The parent has to exist, and the charge and party lookups have to resolve
    // or the money lands with nobody to attribute it to.
    dependsOn: ['lgJobs', 'charges', 'parties'],
    verifies: 'chargeHeads',
    linkage: ['chargeHeadsWithoutJob'],
    run: (report, options) => migrateCustomsChargeLines(report, options),
  },
  {
    id: 'customsInvoices',
    label: 'Clearing Invoices',
    rewritten: true,
    detail:
      'GL_JobInvoice and GL_JobBill filtered to LGJobId, into Invoice - 14,535 client invoices ' +
      'and 36,410 vendor bills - with their charge lines pointed at them. A customs invoice has ' +
      'no job column: Invoice carries SEJobId and no customs equivalent, so a clearance invoice ' +
      'reaches its declaration through its charge lines, which is how the reports already read ' +
      'it. This is what turns every migrated charge line from uninvoiced work into a real ' +
      'balance. Settlement stays with the Ledger stage.',
    modes: ['customs'],
    // The link this stage forms is Charge_Head -> Invoice, so the lines have to
    // exist. Parties too, or an invoice cannot be chased or aged.
    dependsOn: ['customsChargeLines', 'parties'],
    verifies: 'invoices',
    // Exactly the link this stage creates.
    linkage: ['chargeHeadsWithoutInvoice'],
    run: (report, options) => migrateCustomsInvoices(report, options),
  },
  {
    id: 'customsTaxInvoices',
    label: 'GST Invoice Numbers',
    rewritten: true,
    detail:
      'GL_JobInvoice_TaxInvoice onto the migrated client invoices - the GST number each Sale Tax ' +
      'Invoice was issued under (CL-1 to CL-24295 on CargoLinkers), which the tax authority knows ' +
      'the invoice by. Numbers come across exactly as issued, including the 29 the legacy system ' +
      'gave to two invoices, and the next number Odyssey issues follows the last of them.',
    modes: ['customs'],
    dependsOn: ['customsInvoices'],
    verifies: 'salesTaxInvoices',
    run: (report, options) => migrateTaxInvoices(report, options),
  },
  {
    id: 'customsVendorTaxInvoices',
    label: 'Vendor Tax Invoice Numbers',
    rewritten: true,
    detail:
      'GL_JobBill.VendorTaxInvoiceNo onto the migrated vendor bills - the number on the tax ' +
      'invoice each vendor sent (QICT, KICT, WEBOC...), which Job Balancing shows as Vendor Tax ' +
      'Inv #. Its own small step, so it can run on an install whose bills are already in. A ' +
      'number already on a bill, typed in Odyssey, is kept; what cannot be matched is listed.',
    modes: ['customs'],
    dependsOn: ['customsInvoices'],
    // Updates bills already there - no row count changes.
    verifies: null,
    run: (report, options) => migrateVendorTaxInvoices(report, options),
  },
  // NO FIX STAGES.
  //
  // There used to be four, and every one of them was compensating for the
  // import writing the wrong thing:
  //
  //   fixSalesRep   jobs were inserted with salesRepresentatorId null and
  //                 patched afterwards. Now resolved inline through
  //                 Employees.climaxId at insert (resolveSalesRepId).
  //   fixAirJobs    the air receivers wrote literal ""/"0" for chargeable
  //                 weight and arrival/departure, and read sea-port fields for
  //                 pol/pod. They now read the air fields the payload already
  //                 carries.
  //   fixSeaJobs    Client/shipper/commodity lookups compared a string legacy
  //                 id against an INTEGER climaxId and matched nothing;
  //                 safeFindOne now coerces, so they resolve first time.
  //   fixCommodity  back-filled Commodity.climaxId, which
  //                 /commodity/uploadCommodities already sets. It was also
  //                 broken: it posted { Commodities: [...] } to an endpoint
  //                 that destructures { Id, CommodityName }, so it updated
  //                 nothing.
  //
  // A second pass that rewrites what the first pass got wrong hides the bug and
  // doubles the work. If a field is wrong after an import, fix the receiver.

  {
    id: 'ledger',
    label: 'Ledger (Vouchers, Heads & Settlement)',
    rewritten: true,
    detail:
      '53,129 vouchers with 121,967 heads, then 38,330 settlements applied to the invoices. ' +
      'This is what turns every invoice from fully outstanding into a real balance, and the ' +
      'job P&L from all-unrealized into actual figures. The old path incremented paid AND ' +
      'recieved by the same amount, so every settled invoice read as both; only the side the ' +
      'invoice’s payType calls for moves now. Nothing here invents an exchange gain.',
    modes: ['freight', 'customs'],
    // `invoices` on a freight install, `customsInvoices` on a customs one.
    // Both are listed because the dependency is the same in substance -
    // settlement needs the invoices to exist - and Config > Migration filters
    // this list to the stages the selected mode actually runs, so each install
    // sees only the one that applies to it.
    dependsOn: ['accounts', 'parties', 'invoices', 'customsInvoices'],
    verifies: ['vouchers', 'voucherHeads'],
    // Counts alone cannot see an unresolved foreign key. These are the links
    // this stage is responsible for forming.
    linkage: ['voucherHeadsWithoutVoucher', 'voucherHeadsWithoutAccount'],
    run: (report) => migrateLedger(report),
  },
  {
    id: 'customsDirectJobs',
    label: 'Direct Job E/R',
    rewritten: true,
    detail:
      'GL_JobDirectExpRev and its charge lines into Direct Job E/R - on CargoLinkers 1,741 ' +
      'entries and 23,457 lines: the cartage, lift on/off, labour and similar costs paid in cash, ' +
      'by bank or against a staff IOU, which the legacy system keeps OFF the job charge sheet. ' +
      'Nothing is posted: each line is linked to the voucher the Ledger stage imported, which is ' +
      'why it runs after it. Entries keep their legacy number behind the company code ' +
      '(CL-JER-132/27), so they are told apart from the DE / DR entries Odyssey issues.',
    modes: ['customs'],
    // The voucher, the job, the charge and the settlement account all have to
    // be in Odyssey already, or the entry has nothing to attach to.
    dependsOn: ['ledger', 'lgJobs', 'charges', 'accounts'],
    verifies: ['directJobs', 'directJobLines'],
    run: (report, options) => migrateDirectJobs(report, options),
  },
  {
    id: 'checkInvoices',
    label: 'Check: unmatched invoices',
    detail: 'Read-only. Lists legacy invoices with no counterpart in Odyssey.',
    modes: ['freight', 'customs'],
    dependsOn: ['ledger'],
    verifies: null,
    run: steps.checkInvoices,
  },
];

/**
 * Which stages are part of the rewritten sequence.
 *
 * The original stages are all still here, still exported, and still work - see
 * the note above each. They are not offered on the migration screen because
 * running them is how the last migration produced the data we are now
 * rewriting to avoid: silent partial imports, links that never resolved, and
 * a green tick either way.
 *
 * A stage becomes visible by gaining `rewritten: true`, once it plans before
 * it writes, applies atomically, and verifies afterwards. Flip the flag as
 * each one lands.
 */
export const stagesForMode = (mode) =>
  STAGES.filter((s) => s.modes.includes(mode) && s.rewritten);

/** The ones still on the old path - shown as a list, not as run buttons. */
export const pendingStagesForMode = (mode) =>
  STAGES.filter((s) => s.modes.includes(mode) && !s.rewritten);

/** Every stage, rewritten or not. For anything that needs the full picture. */
export const allStagesForMode = (mode) => STAGES.filter((s) => s.modes.includes(mode));

/** Row counts for every migration target. */
export async function fetchCounts() {
  const { data } = await axiosClient.get('/migration/counts');
  return data?.result || {};
}

/**
 * Source vs target reconciliation - legacy row counts against migrated ones.
 *
 * This is the only check that can support "everything came across". Counting
 * what Odyssey holds proves it received something; it says nothing about
 * whether that is all of it.
 */
export async function fetchReconciliation() {
  const legacyUrl =
    process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';
  const { data } = await axiosClient.get('/migration/reconcile', {
    params: { legacyUrl },
  });
  return data?.result || null;
}

/** Foreign keys that did not resolve - counts alone cannot show this. */
export async function fetchLinkage() {
  const { data } = await axiosClient.get('/migration/linkage');
  return data?.result || {};
}

async function countOne(key) {
  try {
    const { data } = await axiosClient.get(`/migration/counts/${key}`);
    return data?.result || null;
  } catch (_) {
    return null;
  }
}

/**
 * The row count a stage is judged on.
 *
 * `verifies` may name several tables, because a stage can legitimately write
 * more than one: the B/L children stage fills containers, stamps, dimensions
 * and rate lines in a single run. Counting only the first would judge it on a
 * fraction of its work and report "added no rows" whenever that one table
 * happened to be empty - which is exactly what it did before.
 */
async function countFor(key) {
  if (!key) return null;

  if (!Array.isArray(key)) return countOne(key);
  if (!key.length) return null;

  const parts = await Promise.all(key.map(countOne));
  const known = parts.filter((p) => p && typeof p.rows === 'number');
  if (!known.length) return null;

  return {
    // Named so a reader can see it is a total, not one table.
    model: key.join(' + '),
    rows: known.reduce((n, p) => n + p.rows, 0),
    withClimaxId: known.reduce(
      (n, p) => (typeof p.withClimaxId === 'number' ? n + p.withClimaxId : n),
      0,
    ),
    breakdown: Object.fromEntries(
      key.map((k, i) => [k, parts[i] && typeof parts[i].rows === 'number' ? parts[i].rows : null]),
    ),
  };
}

/**
 * Run one stage and verify it.
 *
 * Verification is a before/after count on the stage's own table, reported as a
 * delta. A stage that ran without error but added nothing is the signature of a
 * silent failure, and it is called out rather than passed over.
 */
export async function runStage(stage, { onProgress } = {}) {
  const report = (text, meta) => onProgress?.(stage.id, text, meta);
  steps.setReporter(report);

  // Drop the backend lookup cache first. It lives for the life of the process,
  // so a stage that ran before its dependency was populated would otherwise
  // keep resolving against a stale empty map - which is exactly how every
  // charge line ended up with a null InvoiceId.
  try { await axiosClient.post('/migration/cache/reset'); } catch (_) { /* non-fatal */ }

  // Judge this stage on its own batches, not on a previous stage's.
  steps.resetRunReport();

  const before = await countFor(stage.verifies);
  const startedAt = Date.now();

  try {
    report('running...');
    // Pass the reporter in. Stages that predate this take no arguments and
    // ignore it - they call steps' module-level report() instead.
    const output = await stage.run(report);
    const after = await countFor(stage.verifies);

    const delta =
      before && after && typeof before.rows === 'number' && typeof after.rows === 'number'
        ? after.rows - before.rows
        : null;

    // What the batches themselves reported. A stage that sends to several
    // endpoints can succeed at one and fail at every other, and the row count
    // cannot tell the difference - only this can.
    const batches = steps.getRunReport();

    // A stage that added nothing is only suspicious if it cannot account for
    // itself. The rewritten stages return { noop, reason } when there was
    // genuinely nothing to do - everything already imported, say - and that is
    // a success, not the ambiguous "either it worked or it did not" that this
    // warning used to give for both cases.
    const declaredNoop = output && output.noop === true;
    const noop = stage.verifies && delta === 0 && !declaredNoop;
    const warnings = [];
    // A stage that fills in rows already there - not countable - says so itself.
    if (output?.warning) warnings.push(output.warning);
    if (noop) {
      warnings.push('Completed but added no rows. Either it had already run, or it failed silently.');
    }

    // Foreign keys the count cannot see. Reported as a warning rather than a
    // failure because some nulls are legitimate (a job with no sales rep), but
    // "all of them" never is - so say the proportion and let it be judged.
    let linkage = null;
    if (stage.linkage?.length && delta) {
      try {
        const health = await fetchLinkage();
        for (const key of stage.linkage) {
          const nulls = health?.[key];
          if (typeof nulls === 'number' && nulls > 0) {
            (linkage ||= {})[key] = nulls;
            warnings.push(`${key}: ${nulls} row(s) have no link.`);
          }
        }
      } catch (_) { /* advisory only - never fail a stage on this */ }
    }

    // A charge line that could not find its invoice is a lost link, not a lost
    // row - the count is right and only the connection is missing, which is
    // exactly the failure the row counts cannot see.
    if (batches.linkMisses?.count) {
      warnings.push(
        `${batches.linkMisses.count} charge line(s) could not be attached to an invoice` +
        (batches.linkMisses.samples?.length
          ? ` (e.g. ${batches.linkMisses.samples.slice(0, 3).join(', ')})` : '') + '.'
      );
    }

    if (batches.lost > 0) {
      return {
        stageId: stage.id,
        ok: false,
        error:
          `${batches.lost} record(s) were not imported - ` +
          `${batches.incomplete.length} batch group(s) failed after retries. ` +
          `First error: ${batches.incomplete[0]?.skipped?.[0]?.error || 'see console'}`,
        batches,
        before,
        after,
        delta,
        linkage,
        output,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      };
    }

    return {
      stageId: stage.id,
      ok: !noop,
      noopReason: declaredNoop ? (output.reason || 'Nothing to do.') : null,
      warning: warnings.length ? warnings.join(' ') : null,
      // What an updating stage did - shown instead of "+0 rows", which counts
      // rows added and so read as nothing done.
      summary: output?.summary || null,
      batches,
      before,
      after,
      delta,
      linkage,
      output,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    };
  } catch (err) {
    return {
      stageId: stage.id,
      ok: false,
      error: err?.response?.data?.result || err.message || String(err),
      batches: steps.getRunReport(),
      before,
      after: await countFor(stage.verifies),
      seconds: Math.round((Date.now() - startedAt) / 1000),
    };
  } finally {
    steps.setReporter(null);
  }
}

/**
 * Run a whole mode's stages in order, stopping at the first failure.
 *
 * Stopping is the point. The old runner carried on regardless, so a failure in
 * the invoice stage produced jobs whose charges pointed at nothing - and the
 * only sign was a console line nobody was reading.
 */
export async function runAll(mode, { onProgress, onStageDone, stopOnWarning = false } = {}) {
  const results = [];
  for (const stage of stagesForMode(mode)) {
    const result = await runStage(stage, { onProgress });
    results.push(result);
    onStageDone?.(result);
    if (!result.ok && (result.error || stopOnWarning)) break;
  }
  return results;
}
