// Migration steps, extracted from the UploadBackUp screen.
//
// These used to live inside one React component, which meant the only way to
// run any of them was to edit the file and uncomment a line. They are plain
// async functions here so Config > Migration can run them individually, verify
// the result, and only then move on.
//
// Progress text (previously setStatus) goes through a reporter the caller
// installs with setReporter(); it defaults to a no-op so a step can be run
// straight from the console.

import CSVReader from "react-csv-reader";
import axiosClient from 'apis/axiosClient';
import Cookies from "js-cookie";
import { useEffect, useState } from "react";
import { Col, Result, Row } from "antd";
import { loopHooks } from "react-table";
import { Spin } from 'antd';

// Where the legacy Climax read-only API lives (Climax-Server-Backup, default
// port 8081). It talks to the legacy SQL Server, so it is a DIFFERENT host from
// the Odyssey backend and needs its own base URL - it cannot be a relative path.
//
// Every Odyssey-side call in this file is now relative and therefore follows
// axiosClient's baseURL (NEXT_PUBLIC_CLIMAX_MAIN_URL) like the rest of the app.
// They used to be hardcoded to http://localhost:8084, a port nothing listens on
// outside the machine this was originally written on.
// Progress sink. Config > Migration installs one so each step's status text
// reaches the UI; defaults to a no-op.
//
// The second argument carries { done, total } where a step knows them, which is
// what drives the progress bar. Steps that only have text to report pass none,
// and the bar falls back to an indeterminate state rather than a wrong number.
let report = () => {};
const setReporter = (fn) => { report = typeof fn === 'function' ? fn : () => {}; };

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

// Keyed lookup that REPORTS collisions instead of silently keeping the last row.
//
// The plain createMap() used throughout this file is correct wherever the
// source really is one-row-per-key, but nothing in the legacy schema enforces
// that for every table it's used on (SExp_BL_Detail, for instance, has no
// unique constraint on SEBLId - it is 1:1 by convention only). On a real
// migration a duplicate there would drop a B/L's body text with no trace.
//
// Collisions are collected rather than thrown: a migration that aborts on the
// first oddity is worse than one that finishes and hands you a list.
const mapCollisions = [];
const createMapUnique = (arr, key, label) => {
  const map = new Map();
  (arr || []).forEach((item) => {
    const k = item[key];
    if (map.has(k)) {
      mapCollisions.push({ table: label, key, value: k });
    }
    map.set(k, item);
  });
  return map;
};

/** Anything createMapUnique found, for the end-of-run report. */
const getMapCollisions = () => mapCollisions;

// Per-run record of every batched upload, so the end of a migration can state
// plainly what landed and what did not, instead of leaving it in the console.
// Install-specific values for the logistics-job import (importLGJobs). These
// were hardcoded to one company id, one cost centre and one employee UUID from
// the machine the migration was originally written on - which silently produced
// wrong data on any other target. Configure per migration.
const LG_COMPANY_ID = Number(process.env.NEXT_PUBLIC_LG_COMPANY_ID) || null;
const LG_COST_CENTER = process.env.NEXT_PUBLIC_LG_COST_CENTER || '';
const MIGRATION_USER_ID = process.env.NEXT_PUBLIC_MIGRATION_USER_ID || null;

const runReport = [];

// Charge lines that could not be attached to an invoice, accumulated across a
// stage. Reported alongside the batch losses so a divergence between the
// invoice feed and the job feed fails the stage instead of passing quietly.
const linkMisses = { count: 0, samples: [] };

/** Clear the run report. The engine calls this at the start of each stage so a
 *  stage is judged on its own batches, not on a previous stage's. */
const resetRunReport = () => {
  runReport.length = 0;
  linkMisses.count = 0;
  linkMisses.samples.length = 0;
};

/** What this stage actually lost, for the engine to gate on. */
const getRunReport = () => ({
  entries: runReport.slice(),
  lost: runReport.reduce((n, r) => n + r.skipped.reduce((m, x) => m + x.items, 0), 0),
  incomplete: runReport.filter((r) => r.skipped.length),
  linkMisses: { count: linkMisses.count, samples: linkMisses.samples.slice() },
});

const chunkRecords = (array, size) => {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
};

/**
 * Send records in batches and record honestly what landed.
 *
 * The job imports used to do this inline, with the whole error path being
 * `catch (err) { console.error("Batch error:", err.message); }` and nothing
 * else - so a batch that failed printed one line and the loop carried on as if
 * it had worked. That is how every SE and SI batch died on a foreign-key error
 * while the migration still reported success: the failures existed only in the
 * browser console, and the stage gate never saw them.
 *
 * Every call is recorded in runReport whether it succeeded or not, so the stage
 * gate can fail a stage that lost records instead of trusting a row count.
 *
 * `wrapped` covers the two calling conventions in this file: the job endpoints
 * take a bare array as the body, the voucher endpoints take { records }.
 *
 * Progress goes through the module-level `report` binding that setReporter()
 * installs, so the stage UI shows batch progress without this needing a
 * callback threaded through every caller.
 */
const sendBatches = async (items, url, batchSize = 100, maxRetries = 3, opts = {}) => {
  if (!items || !items.length) return { url, total: 0, sent: 0, skipped: [] };
  // `wrapKey` lets one endpoint take several record kinds on the same route
  // without needing a separate sender for each.
  const { wrapped = false, wrapKey = 'records' } = opts;
  const batches = chunkRecords(items, batchSize);
  const skipped = [];
  let sent = 0;

  for (let i = 0; i < batches.length; i++) {
    let retries = 0, success = false, lastError = null, lastResponse = null;
    while (!success && retries < maxRetries) {
      try {
        report(
          url + ": " + Math.min(sent + batches[i].length, items.length) + "/" + items.length,
          { done: sent, total: items.length }
        );
        lastResponse = await axiosClient.post(url, wrapped ? { [wrapKey]: batches[i] } : batches[i]);
        success = true;
      } catch (error) {
        retries++;
        lastError =
          error?.response?.data?.result ||
          error?.response?.data?.message ||
          error.message;
        console.error(
          "Batch " + (i + 1) + " failed (attempt " + retries + "/" + maxRetries + "): " + lastError
        );
      }
    }
    if (success) {
      sent += batches[i].length;
      // Charge lines the job receivers could not attach to an invoice. The
      // ledger stage creates every invoice from the unfiltered GL_Invoices
      // feed, so a miss means the two legacy feeds disagree - a real gap, and
      // one that used to be hidden by the job import quietly creating a
      // second, differently-mapped copy of the invoice instead.
      const misses = lastResponse?.data?.linkMisses;
      if (misses?.invoices) {
        linkMisses.count += misses.invoices;
        for (const sample of (misses.samples || [])) {
          if (linkMisses.samples.length < 20) linkMisses.samples.push(sample);
        }
      }
    } else {
      skipped.push({
        batch: i + 1,
        itemRange: [i * batchSize, i * batchSize + batches[i].length - 1],
        items: batches[i].length,
        error: lastError,
      });
    }
  }

  report(url + ": " + sent + "/" + items.length, { done: sent, total: items.length });

  const result = { url, total: items.length, sent, skipped };
  if (skipped.length) {
    const lost = skipped.reduce((n, x) => n + x.items, 0);
    console.error(
      "INCOMPLETE: " + url + " - " + sent + "/" + items.length +
      " records sent, " + lost + " LOST across " + skipped.length + " batch(es).",
      skipped
    );
  } else {
    console.log("Complete: " + url + " - " + sent + "/" + items.length + " records sent.");
  }
  runReport.push(result);
  return result;
};

const summariseRun = () => {
  const incomplete = runReport.filter((r) => r.skipped.length);
  const collisions = getMapCollisions();
  console.log('=== MIGRATION SUMMARY ===');
  runReport.forEach((r) =>
    console.log(`  ${r.sent}/${r.total}  ${r.url}${r.skipped.length ? '   <-- INCOMPLETE' : ''}`)
  );
  if (collisions.length) {
    console.warn(`  ${collisions.length} duplicate lookup key(s):`, collisions.slice(0, 20));
  }
  if (incomplete.length) {
    console.error(`  ${incomplete.length} endpoint(s) did NOT receive all records:`, incomplete);
  }
  return { runReport, collisions, incomplete };
};
// ---------------------------------------------------------------------------



    // The migration runner.
    //
    // ORDER MATTERS and is a dependency chain, not a preference:
    //   employees      - jobs reference a sales rep by legacy id; nothing else
    //                    creates Employees.climaxId, so this must be first
    //   master data    - commodities, vessels/voyages, airports/ports
    //   accounting     - chart of accounts, then charges
    //   parties        - clients/vendors; jobs and invoices both point at these
    //   jobs           - brings its own B/Ls and charge lines with it
    //   vouchers       - then invoices, which reference vouchers
    //   fix passes     - repair what the main import could not resolve inline
    //
    // Each step is commented out deliberately: this is run one step at a time
    // against a restored copy, checking the result before moving on. Uncomment
    // only the step you are running.


    const importLGJobs = async () => {
        try{
            const c = await axiosClient.get("/clientRoutes/getClientsForBackup");
            console.log("Clients", c)
            const com = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_CREATE_COMMODITY);
            console.log("Commodities", com)
            const result = await axiosClient.get(`${LEGACY_API}/jobs/getLOGJOB`);
            console.log("Log Jobs", result.data.result)
            const Clients = c.data.result
            const ClientsMap = new Map(
                Clients.map(c => [c.climaxId, c.id])
            )
            // Sales reps resolved from the migrated employees (Employees.climaxId),
            // the same way fixSalesRep now does - never a hardcoded UUID.
            const emp = await axiosClient.get("/employeeRoutes/getEmployees");
            const EmployeeMap = new Map(
                (emp.data?.result || [])
                    .filter((e) => e.climaxId != null)
                    .map((e) => [e.climaxId, e.id])
            )
            const Commodites = com.data.result
            const CommoditiesMap = new Map(
                Commodites.map(c => [c.climaxId, c.id])
            )
            const UNLocation = result.data.result.UNLocation
            const UNLocMap = new Map(
                UNLocation.map(b => [b.UNLocCode, b.UNLocName])
            )
            const UNPacking = result.data.result.Packing
            const PackingMap = new Map(
                UNPacking.map(b => [b.PackCode, b.PackName])
            )
            const Gen_IncoTerms = result.data.result.IncoTerms
            const IncoMap = new Map(
                Gen_IncoTerms.map(b => [b.Id, b.IncoName])
            )
            const jobs = []
            result.data.result.Job.forEach((j) => {
                jobs.push({
                    jobNo: j.JobNumber,
                    jobId: j.JobNumber.split("-")[1].split("/")[0],
                    title: null,
                    customerRef: null,
                    fileNo: j.CustomFileNo,
                    shipStatus: null,
                    teu: null,
                    bkg: null,
                    pcs: j.NoOfPackages,
                    vol: j.Volume,
                    volWeight: j.GrossWeight,
                    pol: UNLocMap.get(j.POLCode),
                    pod: UNLocMap.get(j.PODCode),
                    fd: UNLocMap.get(j.POFDCode),
                    dg: null,
                    subType: j.ContianerTypeId == 5 ? 'FCL' : j.ContianerTypeId == 4 ? 'LCL': 'None',
                    billVol: 0,
                    shpVol: 0,
                    weight: j.GrossWeight,
                    weightUnit: null,
                    costCenter: LG_COST_CENTER,   // was hardcoded 'Khi'; set NEXT_PUBLIC_LG_COST_CENTER
                    jobType: j.JobTypeId == 1 ? 'Clearing Only' : j.JobTypeId == 2 ? 'Transport' : 'Clearing + Tpt',
                    jobKind: j.ContianerTypeId == 5 ? 'FCL' : j.ContianerTypeId == 4 ? 'LCL': 'None',
                    container: null, 
                    carrier: null,
                    freightType: 'Prepaid',
                    nomination: 'Free Hand',
                    transportCheck: j.TransporterId? "Transport": '',
                    customCheck: j.ShippingAgentId? 'Shipping': '',
                    etd: null,
                    eta: null,
                    cbkg: null,
                    aesDate: null,
                    aesTime: null,
                    eRcDate: null,
                    eRcTime: null,
                    eRIDate: null,
                    eRITime: null,
                    jobDate: j.JobDate,
                    shipDate: null,
                    doorMove: null,
                    cutOffDate: null,
                    cutOffTime: null,
                    siCutOffDate: null,
                    siCutOffTime: null,
                    vgmCutOffDate: null,
                    vgmCuttOffTime: null,
                    freightPaybleAt: null,
                    terminal: null,
                    delivery: null,
                    companyId: LG_COMPANY_ID,   // was hardcoded 2; set NEXT_PUBLIC_LG_COMPANY_ID for the target install
                    pkgUnit: PackingMap.get(j.PackagesCode),
                    incoTerms: IncoMap.get(j.IncoTermsId),
                    exRate: 0,
                    approved: j.ApprovedStatusId == 2 ? 'true' : 'false',
                    canceled: null,
                    climaxid: j.Id,
                    flightNo: null,
                    cwtLine: null,
                    cwtClient: null,
                    operation: j.OperationTypeId == 4 ? 'SE' : j.OperationTypeId == 2 ? 'AE' : j.OperationTypeId == 1 ? 'AI' : 'SI',
                    arrivalDate: null,
                    arrivalTime: null,
                    departureDate: null,
                    departureTime: null,
                    ClientId: ClientsMap.get(j.CustomerId),
                    VoyageId: null,
                    saleRepresentatorId: EmployeeMap.get(j.SalesRepId) || null,   // was a hardcoded UUID from one specific install
                    overseasAgentId: ClientsMap.get(j.OverSeasAgentId),
                    shippingLineId: ClientsMap.get(j.ShippingLineId),
                    LocalVendorId: ClientsMap.get(j.ShippingAgentId),
                    customAgentId: ClientsMap.get(j.ClearingAgentId),
                    transporterId: ClientsMap.get(j.TransporterId),
                    createdById: MIGRATION_USER_ID || null,   // set NEXT_PUBLIC_MIGRATION_USER_ID, or leave null - do not hardcode a UUID
                    commodityId: CommoditiesMap.get(j.CommodityId ?? j.commodityId),   // legacy field is CommodityId; the lowercase spelling was always undefined
                    consigneeId: ClientsMap.get(j.ConsigneeId),
                    forwarderId: ClientsMap.get(j.ForwarderId),
                    airLineId: ClientsMap.get(j.AirLineId),
                    shipperId: ClientsMap.get(j.ShipperId),
                    vesselId: null,
                    por: null,

                })
            })
            console.log(jobs)
            const res = await axiosClient.post("/seaJob/uploadLogJobs", jobs)
        }catch(e){
            console.error(e)
        }
    }



    const checkInvoices = async () => {
        console.log("Getting Invoices")
        const { data } = await axiosClient.post(`${LEGACY_API}/voucher/getAllInvoices`);
        console.log(data.Invoices)
        const result = await axiosClient.get("/invoice/invoiceMatching");
        console.log(result.data.result)

        const createMap = (arr, key) => new Map(arr.map(item => [item[key], item]));

        const map = createMap(result.data.result, 'invoice_No');
        
        const invoices = []

        data.Invoices.forEach(element => {
            if(!map.has(element.InvoiceNumber)){
                // console.log(element.invoice_No)
                invoices.push(element.InvoiceNumber)
            }
        });

        console.log(invoices)
        
    }

    
    const parserOptions = {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: header => header.toLowerCase().replace(/\W/g, '_')
      }

    function extractCode(str) {
        if(str){
            // console.log(str)
            const match = str.toString().match(/^[A-Z]+-([A-Z]{2})-\d{2,4}\/\d+$/);
            return match ? match[1] : null;
        }else{
            return null
        }
        // console.log("Match:", match)
    }

    function removeBracketedPart(str) {
        return str.replace(/\s*\([^()]*\)\s*$/, '').trim();
    }

    function parseDateString(dateStr) {
        //console.log(dateStr)
        if(dateStr && dateStr.includes("-")){
            let year1 = "20"+year
            return new Date(year1, parseInt(monthName)-1, day);
        }else if(dateStr && dateStr.includes("/")){
            let year1 = "20"+year
            return new Date(year1, parseInt(monthName)-1, day);
        }
      }

      function parseDateString1(dateStr) {
        //console.log(dateStr)
        if(dateStr && dateStr.includes("-")){

            return new Date(year, parseInt(monthName)-1, day);
        }else if(dateStr && dateStr.includes("/")){
            return new Date(year, parseInt(monthName)-1, day);
        }
      }

      function parseDateString3(dateStr) {
        // Helper map for month names to numbers
        const monthMap = {
            Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
            Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
        };
    
        if (dateStr && dateStr.includes("-")) {
            return new Date(
                parseInt(year.length === 2 ? `20${year}` : year), // Handle 2-digit year
                monthMap[monthName],
                parseInt(day)
            );
        }
        return null; // Return null for invalid or empty date strings
    }

      function parseDateString2(dateStr) {
        if (dateStr && dateStr.includes("-")) {
            let [day, monthName, year] = dateStr.split('-');
            // year = year.length == 2 ? (parseInt(year) < 50 ? '20' + year : '19' + year) : year; // Handles two-digit years
            year.length<=2?year="20"+year:null
            // year = "20"+year
            // console.log(year, parseInt(monthName) - 1, parseInt(day));
            return new Date(parseInt(year), parseInt(monthName) - 1, parseInt(day)+1);
        } else if (dateStr && dateStr.includes("/")) {
            let [day, monthName, year] = dateStr.split('/');
            // year = year.length == 2 ? (parseInt(year) < 50 ? '20' + year : '19' + year) : year; // Handles two-digit years
            year.length<=2?year="20"+year:null
            // console.log(year, parseInt(monthName) - 1, parseInt(day));
            return new Date(parseInt(year), parseInt(monthName) - 1, parseInt(day)+1);
        }
    }
    

      function removeCommas(str) {
        typeof str == 'string'?str = str.replace(/,/g, ''):str = str.toString().replace(/,/g, '')
        return str;
    }

    const importCharges = async () => {
        try{
            report("Fetching Charges")
            const charges = await axiosClient.post(`${LEGACY_API}/charges/getAll`)
            console.log(charges)
            let tempCharges = []
            charges.data.forEach((x) => {
                let temp = {
                    // id: x.Id,
                    code: x.Id,
                    currency: x.GL_Currencies.CurrencyCode,
                    name: x.ChargesName,
                    short: x.ShortName,
                    calculationType: x.PerUnitFixedId==1?"Per Unit":"Per Shipment",
                    defaultPaybleParty: "Local-Agent",
                    defaultRecivableParty: "Client",
                    taxApply: x.IsTaxable?"Yes":"No",
                    taxPerc: "0",
                    fixAmount: 0,
                    climaxId: x.Id
                }
                tempCharges.push(temp)
            })
            console.log(tempCharges)
            const result = await axiosClient.post("/charges/bulkCreate", tempCharges)
            report("Charges Imported")
            console.log(result)
        }catch(err){
            console.error(err)
        }
    
    }
    const importCOA = async () => {
        try{
            report("Fetching COA")
            console.log("Importing Accounts")
            const companyId = Cookies.get("companyId")
            const coa = await axiosClient.post(`${LEGACY_API}/accounts/getAll`)
            console.log("COA Data:", coa.data)
            // const Data = coa.data

            // Data.forEach((data)=>{

            // })
            
            const result = await axiosClient.post("/accounts/importAccount", coa.data.temp)
            report("COA Imported")
            console.log(result.status)
        }catch(err){
            console.error(err)
        }
    }
    // RETIRED: getCOATree()
    // Called GET /coa/getCOATree, which does not exist - there is no /coa router
    // mounted at all. It only console.log'd the result, so it was a debugging
    // aid, never part of the import chain. Use the Chart of Accounts screen.

const importParties = async () => {
    try{
        report("Fetching Parties")
        console.log("Importing Parties")
        const { data } = await axiosClient.get(`${LEGACY_API}/parties/get`)
        console.log("Parties Data:", data)

        const createMap = (arr, key) => new Map(arr.map(item => [item[key], item]));

        const lookupMaps = {
            Parties: createMap(data.Parties, "Id"),
            UNLocation: createMap(data.UNLocation, "UNLocCode"),
            Employee: createMap(data.Employee, "Id"),
            Currencies: createMap(data.Currencies, "Id"),
            COA: createMap(data.COA, "Id"),
        };

        const parties = data.Parties.map(x => ({
            ...x,
            ParentParty: lookupMaps.Parties.get(x.ParentPartyId),
            Country: lookupMaps.UNLocation.get(x.CountryCode),
            City: lookupMaps.UNLocation.get(x.CityCode),
            SalesPerson: lookupMaps.Employee.get(x.SalesPersonId),
            AccountsRep: lookupMaps.Employee.get(x.AccountsRepId),
            DocsRep: lookupMaps.Employee.get(x.DocsRepId),
            Currency: lookupMaps.Currencies.get(x.CurrencyId),
            ParentAccount: lookupMaps.COA.get(x.ParentAccountId),
            ContraAccount: lookupMaps.COA.get(x.ContraAccountId),
            Account: lookupMaps.COA.get(x.AccountId),
        }));

        console.log("Sorted Data", parties)

        const result = await axiosClient.post("/clientRoutes/bulkCreate", parties)
        report("Parties Imported")
        console.log(result.data.status)
    }catch(err){
        console.error(err)
    }
}

let usedVouchers = [];
let usedVIdSet = new Set();

// Collects each voucher referenced by an invoice, once.
//
// BUG FIXED: this used to test `usedIdSet` - the INVOICE set, declared further
// down - while adding to `usedVIdSet`, the voucher set. So whether a voucher got
// collected depended on whether its Id happened to collide with an invoice Id
// already seen. Two independent id spaces, compared against each other.
const filterVoucherData = (map, filter) => {
  const temp = map.get(filter);

  if (temp && !usedVIdSet.has(temp.Id)) {
    usedVIdSet.add(temp.Id);
    usedVouchers.push(temp);
  }

  return temp;
};

/**
 * The ledger: vouchers, voucher heads, invoices and settlement, in one pass.
 *
 * This replaces importVouchers and importInvoices, which between them fetched
 * /voucher/getAll twice, built the same eighteen lookup maps twice, and made
 * five endpoint calls that wrote overlapping rows:
 *
 *   /importVouchers      vouchers + heads + settlement (adjusted vouchers only)
 *   /importV             vouchers + heads again, every voucher, different mapping
 *   /deleteVoucherHeads  deleted the duplicate VOUCHERS the two had just made
 *   /importVoucherHeads  heads a third time
 *   /importI             invoices, plus another voucher each, colliding again
 *
 * A voucher was written up to three times and an arbitrary copy survived, so
 * everything hanging off it - heads, invoices, settlement - linked to whichever
 * copy happened to win. That is the unreliability, and most of the runtime.
 *
 * Now: one fetch, one set of maps, two ordered phases.
 *
 *   phase 1  each voucher with its heads and the invoices it raised
 *   phase 2  each settled invoice with its complete adjustment history
 *
 * Two phases because a settlement points at an invoice that may be raised by a
 * voucher later in the run, so every invoice has to exist before any settlement
 * is applied. Everything else resolves inside phase 1 without a lookup, because
 * the parent is created in the same transaction as its children.
 */
const importLedger = async () => {
    try {
        report("Ledger: fetching legacy data...");
        const { data } = await axiosClient.post(`${LEGACY_API}/voucher/getAll`);

        const createMap = (arr, key) => new Map((arr || []).map(item => [item[key], item]));
        const createGroupedMap = (arr, key) => {
            const map = new Map();
            (arr || []).forEach(item => {
                if (!map.has(item[key])) map.set(item[key], []);
                map.get(item[key]).push(item);
            });
            return map;
        };

        report("Ledger: building lookups...");

        // Built once. Both old functions built this same set independently.
        const lookupMaps = {
            GL_COA: createMap(data.COA, "Id"),
            GL_COASubCategory: createMap(data.COASubCategory, "Id"),
            Gen_BankSubType: createMap(data.BankSubType, "Id"),
            Gen_SubCompanies: createMap(data.SubCompanies, "Id"),
            GL_InvTaxType: createMap(data.InvTaxType, "Id"),
            GL_PropertiesLOV: createMap(data.PropertiesLOV, "Id"),
            GL_Currencies: createMap(data.Currencies, "Id"),
            Gen_TaxInvNature: createMap(data.TaxInvNature, "Id"),
            GL_Requisition: createMap(data.Requisition, "Id"),
            GL_ChequeType: createMap(data.ChequeType, "Id"),
            Gen_TaxFilerStatus: createMap(data.TaxFilerStatus, "Id"),
            GL_VoucherType: createMap(data.VoucherType, "Id"),
            GL_VoucherFormType: createMap(data.VoucherFormType, "Id"),
            GL_InvMode: createMap(data.InvMode, "Id"),
            GL_JobInvoice: createMap(data.JobInvoice, "GLInvoiceId"),
            GL_JobBill: createMap(data.JobBill, "GLInvoiceId"),
        };

        // Chart of accounts, resolved against itself so a line can name its
        // parent - which is what decides payable vs receivable.
        const COA = (data.COA || []).map((a) => ({
            ...a,
            GL_COA: lookupMaps.GL_COA.get(a.ParentAccountId),
            GL_COASubCategory: lookupMaps.GL_COASubCategory.get(a.SubCategoryId),
        }));
        lookupMaps.GL_COA = createMap(COA, "Id");

        const Voucher_Heads = (data.Voucher_Detail || []).map((vh) => ({
            ...vh,
            GL_COA: lookupMaps.GL_COA.get(vh.COAAccountId),
            GL_Currencies: lookupMaps.GL_Currencies.get(vh.CurrencyIdVD),
            GL_PropertiesLOV: lookupMaps.GL_PropertiesLOV.get(vh.CostCenterId),
            Gen_BankSubType: lookupMaps.Gen_BankSubType.get(vh.BankSubTypeId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(vh.SubCompanyId),
            GL_InvTaxType: lookupMaps.GL_InvTaxType.get(vh.TaxTypeId),
        }));
        lookupMaps.GL_Voucher_Detail = createMap(Voucher_Heads, "Id");
        lookupMaps.GL_Voucher_Details = createGroupedMap(Voucher_Heads, "VoucherId");

        // Invoices, grouped under the voucher that raised them. GL_Invoices
        // points at the voucher DETAIL line (GVDetailId), so each invoice
        // belongs to exactly one voucher - which is what lets phase 1 set
        // VoucherId from a row it just created instead of looking one up.
        const Invoices = (data.Invoices || []).map((i) => ({
            ...i,
            GL_Currencies: lookupMaps.GL_Currencies.get(i.CurrencyId),
            GL_InvMode: lookupMaps.GL_InvMode.get(i.InvoiceTypeId),
            GL_JobInvoice: lookupMaps.GL_JobInvoice.get(i.Id),
            GL_JobBill: lookupMaps.GL_JobBill.get(i.Id),
            GL_Voucher_Detail: [lookupMaps.GL_Voucher_Detail.get(i.GVDetailId)].filter(Boolean),
            _voucherId: lookupMaps.GL_Voucher_Detail.get(i.GVDetailId)?.VoucherId ?? null,
        }));
        const invoicesByVoucher = createGroupedMap(
            Invoices.filter((i) => i._voucherId != null), "_voucherId"
        );

        const orphanInvoices = Invoices.filter((i) => i._voucherId == null).length;
        if (orphanInvoices) {
            console.warn(
                `${orphanInvoices} invoice(s) have no raising voucher and will not be imported. ` +
                `Their GVDetailId does not match any voucher detail line.`
            );
        }

        const Vouchers = (data.Voucher || []).map((v) => ({
            ...v,
            Gen_TaxInvNature: lookupMaps.Gen_TaxInvNature.get(v.TaxNatureId),
            GL_Currencies: lookupMaps.GL_Currencies.get(v.CurrencyId),
            GL_Requisition: lookupMaps.GL_Requisition.get(v.ReqId),
            GL_ChequeType: lookupMaps.GL_ChequeType.get(v.ChequeTypeId),
            Gen_TaxFilerStatus: lookupMaps.Gen_TaxFilerStatus.get(v.FilerStatusId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(v.SubCompanyId),
            GL_VoucherType: lookupMaps.GL_VoucherType.get(v.VoucherTypeId),
            GL_VoucherFormType: lookupMaps.GL_VoucherFormType.get(v.VoucherFormId),
            GL_Voucher_Detail: lookupMaps.GL_Voucher_Details.get(v.Id) || [],
            Invoices: invoicesByVoucher.get(v.Id) || [],
        }));

        report(`Ledger: sending ${Vouchers.length} vouchers with their heads and invoices...`);
        await sendBatches(Vouchers, "/voucher/importLedger", 50, 3, { wrapped: true });

        /* ---- phase 2: settlement ----

          One record per settled invoice carrying its COMPLETE adjustment
          history, so the settled figure is written once from the whole set.
          The old import did `paid = paid + amount` per adjustment, which is not
          safe to retry - a batch that failed after its update double-counted on
          the way back through - and it incremented paid AND recieved by the
          same amount, so every invoice looked both paid and received.
        */
        const adjustmentsByInvoice = createGroupedMap(data.InvAdjustments, "InvoiceId");
        const settlements = [];
        adjustmentsByInvoice.forEach((adjustments, invoiceId) => {
            settlements.push({
                invoiceClimaxId: invoiceId,
                adjustments: adjustments.map((a) => ({
                    amount: a.Amount,
                    date: a.InvAdjDate || a.AddOn || null,
                    // Which voucher actually settled it. The adjustment names a
                    // voucher DETAIL line, not a voucher.
                    voucherClimaxId: lookupMaps.GL_Voucher_Detail.get(a.GVDetailId)?.VoucherId ?? null,
                })),
            });
        });

        report(`Ledger: applying settlement to ${settlements.length} invoices...`);
        await sendBatches(settlements, "/voucher/importSettlements", 100, 3, { wrapped: true });

        report("Ledger: done.");
    } catch (e) {
        console.error(e);
        throw e;
    }
}

const BATCH_SIZE = 100;

const importAirPorts = async () => {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getAirports`);

    const airports = data.Airports || [];
    const unLocations = data.UNLocation || [];

    // Resolve names ONCE, against the whole dataset.
    //
    // The receiver used to do this from the locations in the current request,
    // and the frontend sent them 100 at a time - but an airport's CityUNCode
    // points at some other location, which was almost never in the same batch.
    // So the lookup missed and the code was stored where the name belonged.
    // Here the full set is in memory, so every reference resolves.
    report(`Airports: resolving ${unLocations.length} location names...`);
    const nameByCode = new Map(unLocations.map((l) => [l.UNLocCode, l.UNLocName]));
    const nameOf = (code) => (code ? (nameByCode.get(code) || null) : null);

    // Flat, pre-resolved rows. The backend inserts them in bulk instead of
    // running a findOrCreate and an update per record.
    const airportRows = airports
        .filter((a) => a?.AirportCode && !a.IsInActive)
        .map((a) => ({
            airportCode: a.AirportCode,
            airportName: a.AirportName || a.AirportCode,
            city: nameOf(a.CityUNCode) || '',
            country: nameOf(a.CountryUNCode) || '',
        }));

    const active = unLocations.filter((l) => l?.UNLocCode && !l.IsInActive);

    const portRows = active
        .filter((l) => l.IsSeaPort)
        .map((l) => ({
            portId: l.UNLocCode,
            portName: l.UNLocName || l.UNLocCode,
            portCountry: nameOf(l.CountryCode) || '',
        }));

    // Destinations are keyed by name, so de-duplicate before sending rather
    // than letting the database reject thousands of duplicates one at a time.
    const destinationNames = [...new Set(
        active.filter((l) => (l.IsCity || l.IsCountry) && l.UNLocName).map((l) => l.UNLocName)
    )];
    const destinationRows = destinationNames.map((name) => ({ name }));

    report(
        `Airports: ${airportRows.length} airports, ${portRows.length} ports, ` +
        `${destinationRows.length} destinations`
    );

    await sendBatches(airportRows, "/seaJob/UploadAirPorts", 1000, 3,
        { wrapped: true, wrapKey: 'airports' });
    await sendBatches(portRows, "/seaJob/UploadAirPorts", 1000, 3,
        { wrapped: true, wrapKey: 'ports' });
    await sendBatches(destinationRows, "/seaJob/UploadAirPorts", 1000, 3,
        { wrapped: true, wrapKey: 'destinations' });
};

// STEP 1 of the migration - nothing else can run before this.
//
// Every legacy job, voucher and invoice is scoped by SubCompanyId, and the
// receivers resolve that through Company.climaxId. Until these rows exist,
// jobs get no company (they used to be attached to hardcoded ids 1/3, which is
// how they ended up on the wrong company), vouchers fail outright because
// Vouchers.CompanyId is NOT NULL, and voucher numbers fall back to a generic
// prefix instead of the company's short code.
//
// This also brings across the letterhead - name, address, phone, NTN and both
// logo images - which the prints now read from the Company record rather than
// from hardcoded values.
const importCompanies = async () => {
    try {
        report("Fetching Companies");
        const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getSubCompanies`);
        console.log("Legacy companies:", data?.SubCompanies?.length ?? 0);

        const res = await axiosClient.post(`/companies/uploadCompanies`, data);
        console.log("Company import result:", res.data?.result);

        // The legacy-id -> new-id mapping every later step depends on. Worth
        // eyeballing before going further: if a company is missing here, its
        // jobs and vouchers will have nowhere to go.
        console.table(res.data?.result?.mapping || []);
        if (res.data?.result?.failed?.length) {
            console.error("Companies that did NOT import:", res.data.result.failed);
        }
        console.warn(
            "Bank accounts are NOT in the legacy database - they were only ever " +
            "hardcoded in the old frontend. Add them in Config > Bank Accounts " +
            "before issuing invoices, or the bank block prints empty."
        );
        report("Companies Imported");
        return res.data?.result;
    } catch (e) {
        console.error("Company import failed:", e);
        report("Company import FAILED - see console");
        throw e;   // stop the run: nothing downstream is valid without companies
    }
}

const importEmployees = async () => {
    try {
        report("Fetching employees...");
        const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getEmployees`);

        report(`Importing ${Array.isArray(data) ? data.length : 0} employees...`);
        const res = await axiosClient.post(`/employeeRoutes/uploadEmployees`, data);
        report("Employees imported");
        console.log("Employee import result:", res.data?.result);
        if (res.data?.result?.failed?.length) {
            console.error("Employees that did NOT import:", res.data.result.failed);
        }
    }catch(e){
        console.error("Employee import failed:", e)
    }
}

const importCommodities = async () => {
    try {
        report("Fetching Commodities")
        const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getCommodities`);
        console.log("Commodity Data:", data);

        await axiosClient.post(`/commodity/uploadCommodities`, data);
        report("Commodities Imported")
        console.log("Comodities uploaded successfully");
    }catch(e){
        console.log(e)
    }
}

const importVoyages = async () => {
    try {
        report("Fetching Vessels & Voyages")
        const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getVoyages`);
        console.log("Voyage Data:", data);
        let Vessels = []
        data.Vessel.forEach((Ve) => {
            let voyages = []

            data.Voyage.forEach((Vo) => {
                if(Vo.VesselId == Ve.Id){
                    voyages.push(Vo)
                }
            })

            let temp = {
                ...Ve,
                voyages
            }

            Vessels.push(temp)
        })

        console.log("Updated Vessels", Vessels)

        const result = await axiosClient.post(`/vessel/uploadVoyages`, Vessels);
        report("Vessels & Voyages Imported")
        console.log("Vessels uploaded successfully", result);
    }catch(e){
        console.log(e)
    }
}

// RETIRED: importBls()
// Posted the legacy B/L set to /seaJob/uploadBLs, which does not exist.
//
// Deliberately NOT reinstated: UploadSEJobs and UploadAEJobs already create the
// B/L, its containers and its stamps inline from the SExp_BL / SImp_BL data
// attached to each job (see Bl.create / Container_Info.create / Stamps.create in
// routes/jobRoutes/sea.js). Adding a second pass would insert every B/L twice.

// RETIRED: importAECharges()
// Posted air-export charges to /charges/uploadChargeHeads, which does not exist.
//
// Deliberately NOT reinstated, for the same reason as importBls: importJobs maps
// AirExportJob_ChargesPayb/Recv onto each job, and UploadAEJobs feeds them to
// UploadChargesPayb/UploadChargesRecv. Charges already arrive with the job, so a
// separate pass would double every charge line - and these are billable amounts.

let usedInvoices = [];
let usedIdSet = new Set();

const filterData = (map, filter) => {
  const temp = map.get(filter);

  if (temp && !usedIdSet.has(temp.Id)) {
    usedIdSet.add(temp.Id);
    usedInvoices.push(temp);
  }

  return temp;
};

const importJobs = async () => {
    try{
        // Three separate fetches, each large. Reported individually because the
        // gap between them is minutes on a full dataset and a silent UI there
        // looks identical to a hang.
        report("Jobs: fetching air job data (1/3)...");
        const result0 = await axiosClient.get(`${LEGACY_API}/jobs/getAll0`);
        report("Jobs: fetching sea job data (2/3)...");
        const result = await axiosClient.get(`${LEGACY_API}/jobs/getAll`);
        report("Jobs: fetching job charges (3/3)...");
        const result1 = await axiosClient.get(`${LEGACY_API}/jobs/getAll1`);
        console.log(result0)
        console.log(result)
        console.log(result1)
        const data = {
            ...result0.data,
            ...result.data,
            ...result1.data
        }
        console.log("Air Job Data:", data)

        const createMap = (arr, key) => new Map(arr.map(item => [item[key], item]));

        const createGroupedMap = (arr, key) => {
            const map = new Map();
            arr.forEach(item => {
                if (!map.has(item[key])) {
                map.set(item[key], []);
                }
                map.get(item[key]).push(item);
            });
            return map;
        };

        const lookupMaps = {
            Gen_UNLocation: createMap(data.UNLocation, "UNLocCode"),
            Gen_UNAirport: createMap(data.UNAirport, "Id"),
            UNPacking: createMap(data.Packing, "PackCode"),
            Gen_Vessel: createMap(data.Vessel, "Id"),
            Gen_Commodity: createMap(data.Commodity, "Id"),
            // Gen_DocumentType: createMap(data.DocumentType, "Id"),
            GL_PropertiesLOV: createMap(data.PropertiesLOV, "Id"),
            Gen_Parties_Locations: createMap(data.Parties_Locations, "Id"),
            Gen_IncoTerms: createMap(data.IncoTerms, "Id"),
            TAP_Employee: createMap(data.Employee, "Id"),
            Gen_Parties: createMap(data.Parties, "Id"),
            GL_Voucher: createMap(data.Voucher, "Id"),
            Gen_CargoTypeFile: createMap(data.CargoTypeFile, "Id"),
            Gen_DeliveryType: createMap(data.DeliveryType, "Id"),
            GL_Currencies: createMap(data.Currencies, "Id"),
            GL_COA: createMap(data.COA, "Id"),
            AExp_AirExportJob: createMap(data.AirExportJob, "Id"),
            AImp_AirImportJob: createMap(data.AirImportJob, "Id"),
            // Gen_JobCancelReason: createMap(data.JobCancelReason, "Id"),
            Gen_ChargesVATCategory: createMap(data.ChargesVATCategory, "Id"),
            Gen_EquipmentSizeType: createMap(data.EquipmentSizeType, "EquipCode"),
            Gen_Charges: createMap(data.Charges, "Id"),
            Gen_BLTemplate: createMap(data.BLTemplate, "Id"),
            GL_Invoices: createMap(data.Invoices, "Id"),
            AExp_BL_Dimension: createMap(data.AE_BL_Dimension, "AEBLId"),
            GL_COASubCategory: createMap(data.COASubCategory, "Id"),
            Gen_SubCompanies: createMap(data.SubCompanies, "Id"),
            GL_VoucherType: createMap(data.VoucherType, "Id"),
            GL_InvMode: createMap(data.InvMode, "Id"),
        };

        const COA = data.COA.map((a) => ({
            ...a,
            GL_COA: lookupMaps.GL_COA.get(a.ParentAccountId),
            GL_COASubCategory: lookupMaps.GL_COASubCategory.get(a.SubCategoryId)
        }))

        lookupMaps.GL_COA = createMap(COA, "Id")

        const tempVoucher_Heads = data.Voucher_Detail.map((vh) => ({
            ...vh,
            GL_COA: lookupMaps.GL_COA.get(vh.COAAccountId),
            GL_Currencies: lookupMaps.GL_Currencies.get(vh.CurrencyIdVD),
            GL_PropertiesLOV: lookupMaps.GL_PropertiesLOV.get(vh.CostCenterId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(vh.SubCompanyId),
        }));

        lookupMaps.GL_Voucher_Detail = createMap(tempVoucher_Heads, "Id")
        lookupMaps.GL_Voucher_Details = createGroupedMap(tempVoucher_Heads, "VoucherId")

        let tempVouchers = data.Voucher.map((v) => ({
            ...v,
            GL_Currencies: lookupMaps.GL_Currencies.get(v.CurrencyId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(v.SubCompanyId),
            GL_VoucherType: lookupMaps.GL_VoucherType.get(v.VoucherTypeId),
            GL_Voucher_Detail: lookupMaps.GL_Voucher_Details.get(v.Id),
        }))

        lookupMaps.GL_Voucher = createMap(tempVouchers, "Id")

        const tempInvoices = data.Invoices.map((i) => ({
            ...i,
            GL_Voucher: filterVoucherData(lookupMaps.GL_Voucher, lookupMaps.GL_Voucher_Detail.get(i.GVDetailId)?.VoucherId),
            GL_Currencies: lookupMaps.GL_Currencies.get(i.CurrencyId),
            GL_InvMode: lookupMaps.GL_InvMode.get(i.InvoiceTypeId),
            Gen_Parties: lookupMaps.Gen_Parties.get(i.PartyId),
        }))

        lookupMaps.GL_Invoices = createMap(tempInvoices, "Id")

        const tempJobBill = data.JobBill.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_JobBill = createMap(tempJobBill, "Id");

        const tempJobBill_Charges = data.JobBill_Charges.map(x => ({
            ...x,
            JobBill: lookupMaps.GL_JobBill.get(x.JobBillId),
        }))

        lookupMaps.SEPGL_JobBill_Charges = createMap(tempJobBill_Charges, "AEJobChargesPaybId");
        lookupMaps.SIPGL_JobBill_Charges = createMap(tempJobBill_Charges, "AIJobChargesPaybId");

        const tempJobInvoice = data.JobInvoice.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_JobInvoice = createMap(tempJobInvoice, "Id");

        const tempJobInvoice_Charges = data.JobInvoice_Charges.map(x => ({
            ...x,
            JobInvoice: lookupMaps.GL_JobInvoice.get(x.JobInvoiceId),
        }))

        lookupMaps.SERGL_JobInvoice_Charges = createMap(tempJobInvoice_Charges, "AEJobChargesRecvId");
        lookupMaps.SIRGL_JobInvoice_Charges = createMap(tempJobInvoice_Charges, "AIJobChargesRecvId");

        const tempAgentInvoice = data.Agent_Invoice.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_Agent_Invoice = createMap(tempAgentInvoice, "Id");

        const tempAgentInvoice_Charges = data.AgentInvoice_Charges.map(x => ({
            ...x,
            Agent_Invoice: lookupMaps.GL_Agent_Invoice.get(x.AgentInvoiceId),
        }))

        lookupMaps.SEPGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "AEJobChargesPaybId");
        lookupMaps.SIPGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "AIJobChargesPaybId");
        lookupMaps.SERGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "AEJobChargesRecvId");
        lookupMaps.SIRGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "AIJobChargesRecvId");

        const tempParties = data.Parties.map(x => ({
            ...x,
            GL_COA: lookupMaps.GL_COA.get(x.AccountId),
        }));
        
        lookupMaps.Gen_Parties = createMap(tempParties, "Id");

        const tempSEBl = data.AE_BL.map(x => ({
            ...x,
            Vessel: lookupMaps.Gen_Vessel.get(x.VesselId),
            ShipperData: lookupMaps.Gen_Parties.get(x.ShipperId),
            ConsigneeData: lookupMaps.Gen_Parties.get(x.ConsigneeId),
            NotifyParty1Data: lookupMaps.Gen_Parties.get(x.NotifyParty1Id),
            BLTemplate: lookupMaps.Gen_BLTemplate.get(x.BLTemplateId),
            NotifyParty2Data: lookupMaps.Gen_Parties.get(x.NotifyParty2Id),
            AEBL_Dimension: lookupMaps.AExp_BL_Dimension.get(x.Id),
        }));

        lookupMaps.SExp_BL = createMap(tempSEBl, "AEJobId");

        const tempSIBl = data.AI_BL.map(x => ({
            ...x,
            Vessel: lookupMaps.Gen_Vessel.get(x.VesselId),
            ShipperData: lookupMaps.Gen_Parties.get(x.ShipperId),
            ConsigneeData: lookupMaps.Gen_Parties.get(x.ConsigneeId),
            NotifyParty1Data: lookupMaps.Gen_Parties.get(x.NotifyParty1Id),
            BLTemplate: lookupMaps.Gen_BLTemplate.get(x.BLTemplateId),
            NotifyParty2Data: lookupMaps.Gen_Parties.get(x.NotifyParty2Id),
        }));

        lookupMaps.SImp_BL = createMap(tempSIBl, "AEJobId");

        const tempSEChargesPayb = data.AirExportJob_ChargesPayb.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Vendor: lookupMaps.Gen_Parties.get(x.VendorId),
            Principal: lookupMaps.Gen_Parties.get(x.PrincipalId),
            VatCategory: lookupMaps.Gen_ChargesVATCategory.get(x.VatCategoryId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SEPGL_AgentInvoice_Charges.get(x.Id),
            GL_JobBill_Charges: lookupMaps.SEPGL_JobBill_Charges.get(x.Id),
        }));

        lookupMaps.SExp_SeaExportJob_ChargesPayb = createGroupedMap(tempSEChargesPayb, "AEJobId");

        const tempSEChargesRecv = data.AirExportJob_ChargesRecv.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Customer: lookupMaps.Gen_Parties.get(x.CustomerId),
            Principal: lookupMaps.Gen_Parties.get(x.PrincipalId),
            VatCategory: lookupMaps.Gen_ChargesVATCategory.get(x.VatCategoryId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SERGL_AgentInvoice_Charges.get(x.Id),
            GL_JobInvoice_Charges: lookupMaps.SERGL_JobInvoice_Charges.get(x.Id),
        }));

        lookupMaps.SExp_SeaExportJob_ChargesRecv = createGroupedMap(tempSEChargesRecv, "AEJobId");

        const tempSIChargesPayb = data.AirImportJob_ChargesPayb.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Vendor: lookupMaps.Gen_Parties.get(x.VendorId),
            Principal: lookupMaps.Gen_Parties.get(x.PrincipalId),
            VatCategory: lookupMaps.Gen_ChargesVATCategory.get(x.VatCategoryId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SIPGL_AgentInvoice_Charges.get(x.Id),
            GL_JobBill_Charges: lookupMaps.SIPGL_JobBill_Charges.get(x.Id),
        }));

        lookupMaps.SImp_SeaImportJob_ChargesPayb = createGroupedMap(tempSIChargesPayb, "AIJobId");

        const tempSIChargesRecv = data.AirImportJob_ChargesRecv.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Customer: lookupMaps.Gen_Parties.get(x.CustomerId),
            Principal: lookupMaps.Gen_Parties.get(x.PrincipalId),
            VatCategory: lookupMaps.Gen_ChargesVATCategory.get(x.VatCategoryId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SIRGL_AgentInvoice_Charges.get(x.Id),
            GL_JobInvoice_Charges: lookupMaps.SIRGL_JobInvoice_Charges.get(x.Id),
        }));

        lookupMaps.SImp_SeaImportJob_ChargesRecv = createGroupedMap(tempSIChargesRecv, "AIJobId");

        console.log({
            tempSIChargesPayb,
            tempSIChargesRecv,
            tempSEChargesPayb,
            tempSEChargesRecv
        })

        let SEJobs = data.AirExportJob.map(job => ({
            ...job,
            AirLine: lookupMaps.Gen_Parties.get(job.AirLineId),
            LocalVendor: lookupMaps.Gen_Parties.get(job.LocalVendorId),
            FinalDestination: lookupMaps.Gen_UNLocation.get(job.FinalDestinationCode),
            OverseasAgent: lookupMaps.Gen_Parties.get(job.OverseasAgentId),
            NotifyParty1: lookupMaps.Gen_Parties.get(job.NotifyParty1Id),
            NotifyParty2: lookupMaps.Gen_Parties.get(job.NotifyParty2Id),
            Shipper: lookupMaps.Gen_Parties.get(job.ShipperId),
            Consignee: lookupMaps.Gen_Parties.get(job.ConsigneeId),
            CustomClearance: lookupMaps.Gen_Parties.get(job.CustomClearanceId),
            Transporter: lookupMaps.Gen_Parties.get(job.TransporterId),
            PortOfReceipt: lookupMaps.Gen_UNLocation.get(job.PortOfReceiptCode),
            CostCenter: lookupMaps.GL_PropertiesLOV.get(job.CostCenterId),
            Voucher: lookupMaps.GL_Voucher.get(job.VoucherId),
            // ManifestHeader: lookupMaps.Gen_ManifestHeader.get(job.ManifestHeaderId),
            SplittedJob: lookupMaps.AExp_AirExportJob.get(job.SplittedJobId),
            Forwarder: lookupMaps.Gen_Parties.get(job.ForwarderId),
            CargoTypeFile: lookupMaps.Gen_CargoTypeFile.get(job.CargoTypeFileId),
            CargoPickUpLocation: lookupMaps.Gen_Parties_Locations.get(job.CargoPickUpLocationId),
            CargoDropOffLocation: lookupMaps.Gen_Parties_Locations.get(job.CargoDropOffLocationId),
            ParentJob: lookupMaps.AExp_AirExportJob.get(job.ParentJobId),
            Client: lookupMaps.Gen_Parties.get(job.ClientId),
            Buyer: lookupMaps.Gen_Parties.get(job.BuyerId),
            APOTAirLine: lookupMaps.Gen_Parties.get(job.APOTAirLineId),
            AirPortOfTranshipment1: lookupMaps.Gen_UNAirport.get(job.AirPortOfTranshipment1Id),
            APOT1AirLine: lookupMaps.Gen_Parties.get(job.APOT1AirLineId),
            AirPortOfTranshipment2: lookupMaps.Gen_UNAirport.get(job.AirPortOfTranshipment2Id),
            IncoTerms: lookupMaps.Gen_IncoTerms.get(job.IncoTermsId),
            AirPortOfDischarge: lookupMaps.Gen_UNAirport.get(job.AirPortOfDischargeId),
            AirPortOfTranshipment: lookupMaps.Gen_UNAirport.get(job.AirPortOfTranshipmentId),
            AirPortOfLoading: lookupMaps.Gen_UNAirport.get(job.AirPortOfLoadingId),
            Terminal: lookupMaps.Gen_Parties_Locations.get(job.TerminalId),
            // DocumentType: lookupMaps.Gen_DocumentType.get(job.DocumentTypeId),
            SalesRep: lookupMaps.TAP_Employee.get(job.SalesRepId),
            Packages: lookupMaps.UNPacking.get(job.PackagesCode),
            Commodity: lookupMaps.Gen_Commodity.get(job.CommodityId),
            SeaExportJob_ChargesPayb: lookupMaps.SExp_SeaExportJob_ChargesPayb.get(job.Id),
            SeaExportJob_ChargesRecv: lookupMaps.SExp_SeaExportJob_ChargesRecv.get(job.Id),
            SExp_BL: lookupMaps.SExp_BL.get(job.Id),
        }))

        let SIJobs = data.AirImportJob.map(job => ({
            ...job,
            FinalDestination: lookupMaps.Gen_UNLocation.get(job.FinalDestinationCode),
            Packages: lookupMaps.UNPacking.get(job.PackagesCode),
            OverseasAgent: lookupMaps.Gen_Parties.get(job.OverseasAgentId),
            NotifyParty1: lookupMaps.Gen_Parties.get(job.NotifyParty1Id),
            NotifyParty2: lookupMaps.Gen_Parties.get(job.NotifyParty2Id),
            Shipper: lookupMaps.Gen_Parties.get(job.ShipperId),
            Consignee: lookupMaps.Gen_Parties.get(job.ConsigneeId),
            CustomClearance: lookupMaps.Gen_Parties.get(job.CustomClearanceId),
            Transporter: lookupMaps.Gen_Parties.get(job.TransporterId),
            PortOfReceipt: lookupMaps.Gen_UNLocation.get(job.PortOfReceiptCode),
            Voucher: lookupMaps.GL_Voucher.get(job.VoucherId),
            Terminal: lookupMaps.Gen_Parties_Locations.get(job.TerminalId),
            Forwarder: lookupMaps.Gen_Parties.get(job.ForwarderId),
            CargoTypeFile: lookupMaps.Gen_CargoTypeFile.get(job.CargoTypeFileId),
            CargoPickUpLocation: lookupMaps.Gen_Parties_Locations.get(job.CargoPickUpLocationId),
            CargoDropOffLocation: lookupMaps.Gen_Parties_Locations.get(job.CargoDropOffLocationId),
            Buyer: lookupMaps.Gen_Parties.get(job.BuyerId),
            // ManifestHeader: lookupMaps.Gen_ManifestHeader.get(job.ManifestHeaderId),
            ParentJob: lookupMaps.AImp_AirImportJob.get(job.ParentJobId),
            AirLine: lookupMaps.Gen_Parties.get(job.AirLineId),
            Client: lookupMaps.Gen_Parties.get(job.ClientId),
            IncoTerms: lookupMaps.Gen_IncoTerms.get(job.IncoTermsId),
            AirPortOfDischarge: lookupMaps.Gen_UNAirport.get(job.AirPortOfDischargeId),
            AirPortOfTranshipment: lookupMaps.Gen_UNAirport.get(job.AirPortOfTranshipmentId),
            AirPortOfLoading: lookupMaps.Gen_UNAirport.get(job.AirPortOfLoadingId),
            SalesRep: lookupMaps.TAP_Employee.get(job.SalesRepId),
            Commodity: lookupMaps.Gen_Commodity.get(job.CommodityId),
            LocalVendor: lookupMaps.Gen_Parties.get(job.LocalVendorId),
            // DocumentType: lookupMaps.Gen_DocumentType.get(job.DocumentTypeId),
            CostCenter: lookupMaps.GL_PropertiesLOV.get(job.CostCenterId),
            SeaImportJob_ChargesPayb: lookupMaps.SImp_SeaImportJob_ChargesPayb.get(job.Id),
            SeaImportJob_ChargesRecv: lookupMaps.SImp_SeaImportJob_ChargesRecv.get(job.Id),
            SImp_BL: lookupMaps.SImp_BL.get(job.Id),
        }))

        console.log("Connected AE Jobs", SEJobs)

        // const result = await axiosClient.post(`/seaJob/UploadAEJobs`,SEJobs.slice(1000, 1050));

        await sendBatches(SEJobs, "/seaJob/UploadAEJobs", 10, 3);

        console.log("Connected AI Jobs", SIJobs)

        await sendBatches(SIJobs, "/seaJob/UploadAIJobs", 10, 3);

    }catch(e){
        console.error(e)
    }

    try{
        console.log("Fetching SE Job data")
        const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getAllSE`);
        console.log("SE Job Data:", data)

        const createMap = (arr, key) => new Map(arr.map(item => [item[key], item]));

        const createGroupedMap = (arr, key) => {
            const map = new Map();
            arr.forEach(item => {
                if (!map.has(item[key])) {
                map.set(item[key], []);
                }
                map.get(item[key]).push(item);
            });
            return map;
        };

        const lookupMaps = {
            UNPacking: createMap(data.Packing, "PackCode"),
            GL_PropertiesLOV: createMap(data.PropertiesLOV, "Id"),
            Gen_Parties_Locations: createMap(data.Parties_Locations, "Id"),
            Gen_IncoTerms: createMap(data.IncoTerms, "Id"),
            Gen_Parties: createMap(data.Parties, "Id"),
            GL_Currencies: createMap(data.Currencies, "Id"),
            GL_COA: createMap(data.COA, "Id"),
            SExp_SeaExportJob: createMap(data.SeaExportJob, "Id"),
            Gen_EquipmentSizeType: createMap(data.EquipmentSizeType, "EquipCode"),
            Gen_Charges: createMap(data.Charges, "Id"),
            SExp_BL_Detail: createMapUnique(data.SEBL_Detail, "SEBLId", "SEBL_Detail"),
            GL_Invoices: createMap(data.Invoices, "Id"),
            Gen_Stamps: createMap(data.Stamps, "Id"),
            GL_COASubCategory: createMap(data.COASubCategory, "Id"),
            Gen_SubCompanies: createMap(data.SubCompanies, "Id"),
            GL_VoucherType: createMap(data.VoucherType, "Id"),
            GL_InvMode: createMap(data.InvMode, "Id"),
        };


        const tempSEBL_Stamp = data.SEBL_Stamp.map(x => ({
            ...x,
            Gen_Stamps: lookupMaps.Gen_Stamps.get(x.StampId),
        }))

        lookupMaps.SExp_BL_Stamp = createGroupedMap(tempSEBL_Stamp, "SEBLId");

        const tempSEBLE = data.SEBL_Equipment.map(x => ({
            ...x,
            UNPacking: lookupMaps.UNPacking.get(x.PackagesCode),
        }))

        lookupMaps.SExp_BL_Equipment = createGroupedMap(tempSEBLE, "SEBLId");

        const tempEquip = data.SeaExportJob_Equipment.map(x => ({
            ...x,
            Gen_EquipmentSizeType: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode)
        }))

        lookupMaps.SExp_SeaExportJob_Equipment = createGroupedMap(tempEquip, "SEJobId");

        
        const tempCOA = data.COA.map(x => ({
            ...x,
            GL_COA: lookupMaps.GL_COA.get(x.ParentAccountId),
            GL_COASubCategory: lookupMaps.GL_COASubCategory.get(x.CategoryId),

        }));

        lookupMaps.GL_COA = createMap(tempCOA, "Id");
        
        const tempParties = data.Parties.map(x => ({
            ...x,
            GL_COA: lookupMaps.GL_COA.get(x.AccountId),
        }));
        
        lookupMaps.Gen_Parties = createMap(tempParties, "Id");
        

        const tempVoucher_Heads = data.Voucher_Detail.map((vh) => ({
            ...vh,
            GL_COA: lookupMaps.GL_COA.get(vh.COAAccountId),
            GL_Currencies: lookupMaps.GL_Currencies.get(vh.CurrencyIdVD),
            GL_PropertiesLOV: lookupMaps.GL_PropertiesLOV.get(vh.CostCenterId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(vh.SubCompanyId),
        }));

        lookupMaps.GL_Voucher_Detail = createMap(tempVoucher_Heads, "Id")
        lookupMaps.GL_Voucher_Details = createGroupedMap(tempVoucher_Heads, "VoucherId")

        let tempVouchers = data.Voucher.map((v) => ({
            ...v,
            GL_Currencies: lookupMaps.GL_Currencies.get(v.CurrencyId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(v.SubCompanyId),
            GL_VoucherType: lookupMaps.GL_VoucherType.get(v.VoucherTypeId),
            GL_Voucher_Detail: lookupMaps.GL_Voucher_Details.get(v.Id),
        }))

        lookupMaps.GL_Voucher = createMap(tempVouchers, "Id")

        const tempInvoices = data.Invoices.map((i) => ({
            ...i,
            GL_Voucher: filterVoucherData(lookupMaps.GL_Voucher, lookupMaps.GL_Voucher_Detail.get(i.GVDetailId)?.VoucherId),
            GL_Currencies: lookupMaps.GL_Currencies.get(i.CurrencyId),
            GL_InvMode: lookupMaps.GL_InvMode.get(i.InvoiceTypeId),
            Gen_Parties: lookupMaps.Gen_Parties.get(i.PartyId),
        }))

        lookupMaps.GL_Invoices = createMap(tempInvoices, "Id")

        const tempJobBill = data.JobBill.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_JobBill = createMap(tempJobBill, "Id");

        const tempJobBill_Charges = data.JobBill_Charges.map(x => ({
            ...x,
            JobBill: lookupMaps.GL_JobBill.get(x.JobBillId),
        }))

        lookupMaps.SEPGL_JobBill_Charges = createMap(tempJobBill_Charges, "SEJobChargesPaybId");

        const tempJobInvoice = data.JobInvoice.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_JobInvoice = createMap(tempJobInvoice, "Id");

        const tempJobInvoice_Charges = data.JobInvoice_Charges.map(x => ({
            ...x,
            JobInvoice: lookupMaps.GL_JobInvoice.get(x.JobInvoiceId),
        }))

        lookupMaps.SERGL_JobInvoice_Charges = createMap(tempJobInvoice_Charges, "SEJobChargesRecvId");

        const tempAgentInvoice = data.Agent_Invoice.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_Agent_Invoice = createMap(tempAgentInvoice, "Id");

        const tempAgentInvoice_Charges = data.AgentInvoice_Charges.map(x => ({
            ...x,
            Agent_Invoice: lookupMaps.GL_Agent_Invoice.get(x.AgentInvoiceId),
        }))

        lookupMaps.SEPGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "SEJobChargesPaybId");
        lookupMaps.SERGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "SEJobChargesRecvId");

        const tempSEBl = data.SE_BL.map(x => ({
            ...x,
            SExp_BL_Detail: lookupMaps.SExp_BL_Detail.get(x.Id),
            SExp_BL_Equipment: lookupMaps.SExp_BL_Equipment.get(x.Id),
            SExp_BL_Stamp: lookupMaps.SExp_BL_Stamp.get(x.Id)
        }));

        lookupMaps.SExp_BL = createMap(tempSEBl, "SEJobId");

        const tempSEChargesPayb = data.SeaExportJob_ChargesPayb.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Vendor: lookupMaps.Gen_Parties.get(x.VendorId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SEPGL_AgentInvoice_Charges.get(x.Id),
            GL_JobBill_Charges: lookupMaps.SEPGL_JobBill_Charges.get(x.Id),
        }));

        lookupMaps.SExp_SeaExportJob_ChargesPayb = createGroupedMap(tempSEChargesPayb, "SEJobId");

        const tempSEChargesRecv = data.SeaExportJob_ChargesRecv.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Customer: lookupMaps.Gen_Parties.get(x.CustomerId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SERGL_AgentInvoice_Charges.get(x.Id),
            GL_JobInvoice_Charges: lookupMaps.SERGL_JobInvoice_Charges.get(x.Id),
        }));

        lookupMaps.SExp_SeaExportJob_ChargesRecv = createGroupedMap(tempSEChargesRecv, "SEJobId");

        let SEJobs = data.SeaExportJob.map(job => ({
            ...job,
            Packages: lookupMaps.UNPacking.get(job.PackagesCode),
            CostCenter: lookupMaps.GL_PropertiesLOV.get(job.CostCenterId),
            Terminal: lookupMaps.Gen_Parties_Locations.get(job.TerminalId),
            IncoTerms: lookupMaps.Gen_IncoTerms.get(job.IncoTermsId),
            SeaExportJob_ChargesPayb: lookupMaps.SExp_SeaExportJob_ChargesPayb.get(job.Id),
            SeaExportJob_ChargesRecv: lookupMaps.SExp_SeaExportJob_ChargesRecv.get(job.Id),
            SExp_BL: lookupMaps.SExp_BL.get(job.Id),
            SExp_SeaExportJob_Equipment: lookupMaps.SExp_SeaExportJob_Equipment.get(job.Id),
            
        }))

        console.log("Connected SE Jobs", SEJobs)

        // const result = await axiosClient.post(`/seaJob/UploadSEJobs`,SEJobs.slice(1000, 1010));

        await sendBatches(SEJobs, "/seaJob/UploadSEJobs", 10, 3);

        
        // console.log("Connected SI Jobs", SIJobs)

        // const result = await axiosClient.post(`/seaJob/UploadSIJobs`,SIJobs.slice(100, 200));
        
        // for (let i = 0; i < SIJobs.length; i += 10) {
        //     const chunk = SIJobs.slice(i, i + 10);
        //     console.log(`Sending records ${i} - ${i + chunk.length}`);
            
        //     try {
        //         const result = await axiosClient.post(
        //         `/seaJob/UploadSIJobs`,
        //         chunk
        //         );
        //         console.log("Batch success:", result.data);
        //     } catch (err) {
        //         console.error("Batch error:", err.message);
        //     }
        // }

    }catch(e){
        console.error(e)
    }

    try{
        console.log("Fetching SI Job data")
        const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getAllSI`);
        console.log("SI Job Data:", data)

        const createMap = (arr, key) => new Map(arr.map(item => [item[key], item]));

        const createGroupedMap = (arr, key) => {
            const map = new Map();
            arr.forEach(item => {
                if (!map.has(item[key])) {
                map.set(item[key], []);
                }
                map.get(item[key]).push(item);
            });
            return map;
        };

        const lookupMaps = {
            UNPacking: createMap(data.Packing, "PackCode"),
            GL_PropertiesLOV: createMap(data.PropertiesLOV, "Id"),
            Gen_Parties_Locations: createMap(data.Parties_Locations, "Id"),
            Gen_IncoTerms: createMap(data.IncoTerms, "Id"),
            Gen_Parties: createMap(data.Parties, "Id"),
            GL_Currencies: createMap(data.Currencies, "Id"),
            GL_COA: createMap(data.COA, "Id"),
            // SExp_SeaExportJob: createMap(data.SeaExportJob, "Id"),
            Gen_EquipmentSizeType: createMap(data.EquipmentSizeType, "EquipCode"),
            Gen_Charges: createMap(data.Charges, "Id"),
            SImp_BL_Detail: createMapUnique(data.SIBL_Detail, "SIBLId", "SIBL_Detail"),
            GL_Invoices: createMap(data.Invoices, "Id"),
            // Gen_Stamps: createMap(data.Stamps, "Id"),
            GL_COASubCategory: createMap(data.COASubCategory, "Id"),
            Gen_SubCompanies: createMap(data.SubCompanies, "Id"),
            GL_VoucherType: createMap(data.VoucherType, "Id"),
            GL_InvMode: createMap(data.InvMode, "Id"),
        };

        const tempEquip = data.SeaImportJob_Equipment.map(x => ({
            ...x,
            Gen_EquipmentSizeType: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode)
        }))

        lookupMaps.SImp_SeaImportJob_Equipment = createGroupedMap(tempEquip, "SIJobId");

        
        const tempCOA = data.COA.map(x => ({
            ...x,
            GL_COA: lookupMaps.GL_COA.get(x.ParentAccountId),
            GL_COASubCategory: lookupMaps.GL_COASubCategory.get(x.CategoryId),

        }));

        lookupMaps.GL_COA = createMap(tempCOA, "Id");
        
        const tempParties = data.Parties.map(x => ({
            ...x,
            GL_COA: lookupMaps.GL_COA.get(x.AccountId),
        }));
        
        lookupMaps.Gen_Parties = createMap(tempParties, "Id");
        

        const tempVoucher_Heads = data.Voucher_Detail.map((vh) => ({
            ...vh,
            GL_COA: lookupMaps.GL_COA.get(vh.COAAccountId),
            GL_Currencies: lookupMaps.GL_Currencies.get(vh.CurrencyIdVD),
            GL_PropertiesLOV: lookupMaps.GL_PropertiesLOV.get(vh.CostCenterId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(vh.SubCompanyId),
        }));

        lookupMaps.GL_Voucher_Detail = createMap(tempVoucher_Heads, "Id")
        lookupMaps.GL_Voucher_Details = createGroupedMap(tempVoucher_Heads, "VoucherId")

        let tempVouchers = data.Voucher.map((v) => ({
            ...v,
            GL_Currencies: lookupMaps.GL_Currencies.get(v.CurrencyId),
            Gen_SubCompanies: lookupMaps.Gen_SubCompanies.get(v.SubCompanyId),
            GL_VoucherType: lookupMaps.GL_VoucherType.get(v.VoucherTypeId),
            GL_Voucher_Detail: lookupMaps.GL_Voucher_Details.get(v.Id),
        }))

        lookupMaps.GL_Voucher = createMap(tempVouchers, "Id")

        const tempInvoices = data.Invoices.map((i) => ({
            ...i,
            GL_Voucher: filterVoucherData(lookupMaps.GL_Voucher, lookupMaps.GL_Voucher_Detail.get(i.GVDetailId)?.VoucherId),
            GL_Currencies: lookupMaps.GL_Currencies.get(i.CurrencyId),
            GL_InvMode: lookupMaps.GL_InvMode.get(i.InvoiceTypeId),
            Gen_Parties: lookupMaps.Gen_Parties.get(i.PartyId),
        }))

        lookupMaps.GL_Invoices = createMap(tempInvoices, "Id")

        const tempJobBill = data.JobBill.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_JobBill = createMap(tempJobBill, "Id");

        const tempJobBill_Charges = data.JobBill_Charges.map(x => ({
            ...x,
            JobBill: lookupMaps.GL_JobBill.get(x.JobBillId),
        }))

        lookupMaps.SEPGL_JobBill_Charges = createMap(tempJobBill_Charges, "SIJobChargesPaybId");

        const tempJobInvoice = data.JobInvoice.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_JobInvoice = createMap(tempJobInvoice, "Id");

        const tempJobInvoice_Charges = data.JobInvoice_Charges.map(x => ({
            ...x,
            JobInvoice: lookupMaps.GL_JobInvoice.get(x.JobInvoiceId),
        }))

        lookupMaps.SERGL_JobInvoice_Charges = createMap(tempJobInvoice_Charges, "SIJobChargesRecvId");

        const tempAgentInvoice = data.Agent_Invoice.map(x => ({
            ...x,
            Invoice: filterData(lookupMaps.GL_Invoices, x.GLInvoiceId),
        }))

        lookupMaps.GL_Agent_Invoice = createMap(tempAgentInvoice, "Id");

        const tempAgentInvoice_Charges = data.AgentInvoice_Charges.map(x => ({
            ...x,
            Agent_Invoice: lookupMaps.GL_Agent_Invoice.get(x.AgentInvoiceId),
        }))

        lookupMaps.SEPGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "SIJobChargesPaybId");
        lookupMaps.SERGL_AgentInvoice_Charges = createMap(tempAgentInvoice_Charges, "SIJobChargesRecvId");

        const tempSEBl = data.SI_BL.map(x => ({
            ...x,
            SImp_BL_Detail: lookupMaps.SImp_BL_Detail.get(x.Id),
            // SExp_BL_Equipment: lookupMaps.SExp_BL_Equipment.get(x.Id),
            // SExp_BL_Stamp: lookupMaps.SExp_BL_Stamp.get(x.Id)
        }));

        lookupMaps.SImp_BL = createMap(tempSEBl, "SIJobId");

        const tempSIChargesPayb = data.SeaExportJob_ChargesPayb.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Vendor: lookupMaps.Gen_Parties.get(x.VendorId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SEPGL_AgentInvoice_Charges.get(x.Id),
            GL_JobBill_Charges: lookupMaps.SEPGL_JobBill_Charges.get(x.Id),
        }));

        lookupMaps.SExp_SeaExportJob_ChargesPayb = createGroupedMap(tempSIChargesPayb, "SIJobId");

        const tempSIChargesRecv = data.SeaExportJob_ChargesRecv.map(x => ({
            ...x,
            Currency: lookupMaps.GL_Currencies.get(x.CurrencyId),
            Customer: lookupMaps.Gen_Parties.get(x.CustomerId),
            Charges: lookupMaps.Gen_Charges.get(x.ChargesId),
            Equip: lookupMaps.Gen_EquipmentSizeType.get(x.EquipCode),
            GL_AgentInvoice_Charges: lookupMaps.SERGL_AgentInvoice_Charges.get(x.Id),
            GL_JobInvoice_Charges: lookupMaps.SERGL_JobInvoice_Charges.get(x.Id),
        }));

        lookupMaps.SExp_SeaExportJob_ChargesRecv = createGroupedMap(tempSIChargesRecv, "SIJobId");

        let SIJobs = data.SeaImportJob.map(job => ({
            ...job,
            Packages: lookupMaps.UNPacking.get(job.PackagesCode),
            CostCenter: lookupMaps.GL_PropertiesLOV.get(job.CostCenterId),
            Terminal: lookupMaps.Gen_Parties_Locations.get(job.TerminalId),
            IncoTerms: lookupMaps.Gen_IncoTerms.get(job.IncoTermsId),
            SeaExportJob_ChargesPayb: lookupMaps.SExp_SeaExportJob_ChargesPayb.get(job.Id),
            SeaExportJob_ChargesRecv: lookupMaps.SExp_SeaExportJob_ChargesRecv.get(job.Id),
            SImp_BL: lookupMaps.SImp_BL.get(job.Id),
            SImp_SeaImportJob_Equipment: lookupMaps.SImp_SeaImportJob_Equipment.get(job.Id),
            
        }))

        console.log("Connected SI Jobs", SIJobs)

        // const result = await axiosClient.post(`/seaJob/UploadSIJobs`,SIJobs.slice(100, 110));

        await sendBatches(SIJobs, "/seaJob/UploadSIJobs", 10, 3);

        
        // console.log("Connected SI Jobs", SIJobs)

        // const result = await axiosClient.post(`/seaJob/UploadSIJobs`,SIJobs.slice(100, 200));
        
        // for (let i = 0; i < SIJobs.length; i += 10) {
        //     const chunk = SIJobs.slice(i, i + 10);
        //     console.log(`Sending records ${i} - ${i + chunk.length}`);
            
        //     try {
        //         const result = await axiosClient.post(
        //         `/seaJob/UploadSIJobs`,
        //         chunk
        //         );
        //         console.log("Batch success:", result.data);
        //     } catch (err) {
        //         console.error("Batch error:", err.message);
        //     }
        // }

    }catch(e){
        console.error(e)
    }

}


/**
 * Invoices, the vouchers that raised them, and their settlement history.
 *
 * This used to be the tail of importJobs, which meant the job receivers
 * created charge lines and looked up their invoice BEFORE this ran - so every
 * charge line got InvoiceId null while the invoices it wanted were created
 * seconds later in the same stage.
 *
 * It is its own stage so the invoices exist, and can be counted, before any
 * job asks for them.
 */

export {
  checkInvoices,
  importAirPorts,
  importCOA,
  importCharges,
  importCommodities,
  importCompanies,
  importEmployees,
  importJobs,
  importLGJobs,
  importParties,
  importLedger,
  importVoyages,
  setReporter,
  summariseRun,
  resetRunReport,
  getRunReport,
  getMapCollisions,
};
