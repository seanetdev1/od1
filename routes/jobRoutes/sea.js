const { 
  SE_Job, SE_Equipments, Container_Info,
  Stamps, Job_notes, Loading_Program, Bl,
  Delivery_Order, Item_Details, Dimensions,
} = require("../../functions/Associations/jobAssociations/seaExport");
// Legacy-import receivers are migration, which is Seanet's - see
// functions/systemAccess.js.
const { requireSystem: SYSTEM } = require('../../functions/systemAccess');
const { Awbl } = require("../../functions/Associations/awblAssociations");
// `formatNumber` here is the document numbering one (below), hence the rename.
const { storedSpellings, formatNumber: formatAwbl } = require("../../functions/awbl");
const { Charge_Head } = require("../../functions/Associations/incoiceAssociations");
const { Child_Account, Parent_Account } = require("../../functions/Associations/accountAssociations");
const { Vouchers, Voucher_Heads, Office_Vouchers } = require("../../functions/Associations/voucherAssociations");
const { Employees } = require("../../functions/Associations/employeeAssociations");
const { Clients, Client_Associations } = require("../../functions/Associations/clientAssociation");
const { Voyage } = require("../../functions/Associations/vesselAssociations");
const { Commodity, Vessel, Charges, Invoice, Airports, Ports, Destinations, Company, sequelize }=require("../../models");
const { resolveSelectedFiscalYear } = require("../../functions/Associations/fiscalYearAssociations");
const routes = require('express').Router();
const Sequelize = require('sequelize');
const moment = require("moment");
const { format } = require("morgan");
const { createHistory } = require("../../functions/history");
const migrationCache = require("../../functions/migrationCache");
const requireDesignation = require("../../functions/requireDesignation");
const { hasDesignation } = requireDesignation;

/* Who may open an approved job for editing - see /unlock. The same three as
 * a customs job's (routes/customsJobs UNLOCKERS). */
const UNLOCKERS = ['CEO', 'CFO', 'admin'];
// Company code for document numbers (job/invoice/voucher/DO prefixes).
// Reads Company.short, which is set per install - these were hardcoded as
// SNS/CLS/ACS, which stamps Seanet's codes onto another company's documents.
const { companyShort, isCompanyId, realCompanyId, NO_COMPANY } = require('../../functions/companyCodes');
// House style for job numbers - see functions/documentNumber.
const {
  readNumbering, lastInYear, nextAfter, perCompany, formatNumber, codeFor,
} = require('../../functions/documentNumber');
const Op = Sequelize.Op;

// What editing a BL may change on a container it already has - everything but
// its id, its BL, its Climax id and when it was made. See /editBl.
const CONTAINER_FIELDS = [
  "no", "seal", "size", "rategroup", "gross", "net", "tare", "wtUnit", "cbm", "pkgs",
  "unit", "temp", "loadType", "remarks", "detention", "demurge", "plugin", "dg",
  "number", "date", "top", "right", "left", "front", "back", "updatedAt",
];

// Who migrated rows are attributed to. Null is fine and is the default; set
// ODYSSEY_MIGRATION_USER_ID to a real Employees.id if you want the imported
// records to carry a creator. Never hardcode a UUID here - it will not exist on
// a customer's database.
const MIGRATION_USER_ID = process.env.ODYSSEY_MIGRATION_USER_ID || null;

// Legacy Gen_SubCompanies.Id -> Odyssey Companies.id.
//
// Replaces `job.SubCompanyId == 2 ? 1 : 3`, which was repeated at eight sites
// and assumed the target database numbered its companies exactly the way one
// particular install did. On a fresh migration those ids are whatever
// autoincrement produced, so jobs were silently attached to the wrong company -
// or to one that did not exist.
//
// Companies must therefore be imported first (/companies/uploadCompanies).
// Cached per process: this is called once per job in a loop over thousands.
let _companyByClimaxId = null;
async function resolveCompanyId(subCompanyId) {
  if (_companyByClimaxId === null) {
    const rows = await Company.findAll({ attributes: ['id', 'climaxId'] });
    _companyByClimaxId = new Map(
      rows.filter((c) => c.climaxId != null).map((c) => [String(c.climaxId), c.id])
    );
    if (_companyByClimaxId.size === 0) {
      console.error(
        '[migration] No company carries a climaxId. Run /companies/uploadCompanies ' +
        'before importing jobs, or every job will be created with no company.'
      );
    }
  }
  const id = _companyByClimaxId.get(String(subCompanyId));
  if (id === undefined) {
    console.warn(`[migration] No Odyssey company for legacy SubCompanyId=${subCompanyId}`);
    return null;
  }
  return id;
}

// Legacy TAP_Employee.Id -> Odyssey Employees.id.
//
// Jobs are inserted with their sales rep resolved here, rather than being
// written null and patched afterwards by /seaJob/fixSalesRep. The legacy schema
// names the column differently per job type (SalesRepId on sea/air export and
// air import, SalesmanId on sea import), so both are accepted.
let _repByClimaxId = null;
async function resolveSalesRepId(job) {
  const legacyId = job?.SalesRepId ?? job?.SalesmanId;
  if (legacyId === null || legacyId === undefined || legacyId === '') return null;

  if (_repByClimaxId === null) {
    const rows = await Employees.findAll({ attributes: ['id', 'climaxId'] });
    _repByClimaxId = new Map(
      rows.filter((e) => e.climaxId != null).map((e) => [String(e.climaxId), e.id])
    );
    if (_repByClimaxId.size === 0) {
      console.warn(
        '[migration] No employee carries a climaxId - jobs will import with no ' +
        'sales rep. Run the employee import before jobs.'
      );
    }
  }
  return _repByClimaxId.get(String(legacyId)) || null;
}

/** Drop the cache - call if companies are re-imported mid-session. */
function resetCompanyCache() { _companyByClimaxId = null; }

/**
 * Rule 3 helper: on an air EXPORT job the MAWB must come from registered stock
 * (Setup > AWB Numbers), belong to the job's own airline, and not already be
 * consumed by a different job.
 *
 * This lives on the server because the field cannot be relied on to police
 * itself: a number typed straight in, or submitted before the picker had
 * resolved, reaches this route regardless of what the UI shows. Every BL save
 * funnels through here, so it is the only place the rule genuinely holds.
 *
 * AE only. Import MAWBs are issued by the origin carrier, not drawn from stock
 * held here, so applying this to AI would block the first inbound BL anyone
 * records.
 *
 * @returns a message explaining the rejection, or null when acceptable.
 */
const checkMawbIsRegistered = async ({ mbl, jobId }) => {
  // Looked up under every spelling it may be stored as - an IATA number's
  // digits, or a special one's own (functions/awbl storedSpellings). Digits
  // alone turned DHL's SN-035-1873 into 0351873, which no register holds.
  const spellings = storedSpellings(mbl);
  if (!spellings.length) return null; // a blank MAWB is left to the existing rules

  const job = await SE_Job.findOne({
    where: { id: jobId },
    attributes: ["id", "jobNo", "companyId", "airLineId"],
  });
  if (!job) return null; // no job to validate against; other checks cover this

  // One pool, shared by the group - no company filter. Stock is allocated to
  // the companies jointly and either can use any number, so the only
  // questions are whether it is registered, whether it belongs to this job's
  // airline, and whether another job already has it.
  const awbl = await Awbl.findOne({
    where: { awbNumber: { [Op.in]: spellings } },
    include: [{ model: Clients, as: "Airline", attributes: ["name", "code"], required: false }],
  });

  const shown = awbl ? formatAwbl(awbl.awbNumber) : String(mbl).trim();

  if (!awbl) {
    return `MAWB ${shown} is not registered. Add it under Setup > AWB Numbers before using it on a job.`;
  }
  if (String(awbl.AirlineId) !== String(job.airLineId)) {
    const owner = awbl.Airline ? `${awbl.Airline.name} (${awbl.Airline.code})` : "another airline";
    return `MAWB ${shown} belongs to ${owner}, which is not this job's airline. Use a number registered to the job's airline.`;
  }
  if (awbl.SEJobId && String(awbl.SEJobId) !== String(jobId)) {
    const other = await SE_Job.findOne({
      where: { id: awbl.SEJobId },
      attributes: ["jobNo"],
    });
    return `MAWB ${shown} is already used on job ${other ? other.jobNo : awbl.SEJobId}.`;
  }
  return null;
};

const getJob = (id) => {
  const finalResult = SE_Job.findOne({
    where:{id:id},
    include:[
      { model:SE_Equipments },
      { model:Clients, attributes:['name'] }
    ]
  })
  return finalResult
}

routes.get("/getJobNumbers", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const whereCondition = search
      ? {
          [Op.or]: [
            { jobNo: { [Op.iLike]: `%${search}%` } },
            { '$Client.name$': { [Op.iLike]: `%${search}%` } },
            { '$consignee.name$': { [Op.iLike]: `%${search}%` } },
            { '$Bl.hbl$': { [Op.iLike]: `%${search}%` } },
            { '$Bl.mbl$': { [Op.iLike]: `%${search}%` } }
          ]
        }
      : {};

    const { rows, count } = await SE_Job.findAndCountAll({
      attributes: ['id', 'jobNo', 'fileNo'],
      where: whereCondition,
      distinct: true,
      limit,
      offset,
      order: [['id', 'DESC']],
      include: [
        {
          model: Clients,
          attributes: ['name'],
          required: false
        },
        {
          model: Clients,
          as: 'consignee',
          attributes: ['name'],
          required: false
        },
        {
          model: Bl,
          attributes: ['hbl', 'mbl'],
          required: false
        }
      ]
    });

    res.json({
      status: 'success',
      data: rows,
      pagination: {
        totalRecords: count,
        currentPage: page,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

routes.get("/getValues", async(req, res) => {
  let makeResult = (result, resultTwo) => {
    let finalResult = {shipper:[], consignee:[], notify:[], client:[], sLine:[]};
    result.forEach((x) => {
      if(x.types.includes('Shipper')){
        finalResult.shipper.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Consignee')){
        finalResult.consignee.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Notify')){
        finalResult.notify.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Shipping Line')){
        finalResult.sLine.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
    })
    let tempClient = [];
    resultTwo.forEach((x)=>{
      if(x.nongl!='1'){
        // salesRepresentatorId: picking the client on a job picks its sales
        // rep too (Jobs/BookingInfo, functions/partySalesRep).
        tempClient.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl, salesRepresentatorId:x.salesRepresentatorId})
      }
    })
    finalResult.client = tempClient;
    return finalResult
  };

  let makeResultTwo = (result) => {
    let finalResult = { transporter:[], forwarder:[], overseasAgent:[], localVendor:[], chaChb:[], sLine:[], airLine:[] };
    result.forEach((x) => {
      if(x.types.includes('Air Line')){
        finalResult.airLine.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Transporter')){
        finalResult.transporter.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Forwarder/Coloader')){
        finalResult.forwarder.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Overseas Agent')){
        finalResult.overseasAgent.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('CHA/CHB')){
        finalResult.chaChb.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Local Vendor') && x.nongl!='1'){
        finalResult.localVendor.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
      if(x.types.includes('Shipping Line')){
        finalResult.sLine.push({name:`${x.name} (${x.code})`, id:x.id, types:x.types, nongl:x.nongl})
      }
    })
    return finalResult
  };

  try {
    const resultOne = await Clients.findAll({ 
      where:{
        active:true
      },
      attributes:['id','name', 'types', 'code', 'nongl', 'salesRepresentatorId'],
      order: [['createdAt', 'DESC']]
    })
    const result = await Clients.findAll({ 
      where: {
        types: {
          [Op.or]:[
            { [Op.substring]: 'Shipper' },
            { [Op.substring]: 'Consignee' },
            { [Op.substring]: 'Shipping Line' },
            { [Op.substring]: 'Notify' }]
        },
        active:true
      },
      // nongl: so a REPORT can leave out parties that have no ledger account.
      attributes:['id','name', 'types', 'code', 'nongl'],
      order: [['createdAt', 'DESC']]
    })
    const resultThree = await Clients.findAll({ 
      where: {
        types: {
          [Op.or]:[
            { [Op.substring]: 'Transporter' },
            { [Op.substring]: 'Forwarder/Coloader' },
            { [Op.substring]: 'Local Vendor' },
            { [Op.substring]: 'CHA/CHB' },
            { [Op.substring]: 'Overseas Agent' },
            { [Op.substring]: 'Air Line' },
            { [Op.substring]: 'Shipping Line' }
          ]
        },
        active:true
      },
      attributes:['id','name', 'types', 'code', 'nongl'],
      order: [['createdAt', 'DESC']]
    })
    let tempCommodity = [];
    const resultTwo = await Commodity.findAll({
      order: [['createdAt', 'DESC']],
      attributes:['id','name', 'hs']
    });
    await resultTwo.forEach((x)=>{
      if(x.hs){
        tempCommodity.push({...x.dataValues, name:`${x.dataValues.name} (${x.dataValues.hs})`})
      } else {
        tempCommodity.push(x.dataValues)
      }
    })
    const resultFour = await Vessel.findAll({
      order: [['createdAt', 'DESC']],
      attributes:['id', 'name', 'code', 'carrier', 'active'], // active: the picker leaves inactive ones out - see models/Vessel
      include:[{
          model:Voyage
      }]
    });
    const Sr = await Employees.findAll({where:{represent: {[Op.substring]: 'sr'} }, attributes:['id', 'name']});
    let tempChargeList = [];
    const charges = await Charges.findAll({where: {status:true}});
    await charges.forEach((x) => {
      tempChargeList.push({...x.dataValues, label:`(${x.dataValues.code}) ${x.dataValues.short}`, value:x.dataValues.id});
    });
    let temp = result.filter(x => x.types.includes('Shipping Line'));
    res.json({
      status:'success',
      result:{
        res: temp,
        party:makeResult(result, resultOne),
        vendor:makeResultTwo(resultThree),
        commodity:tempCommodity,
        vessel:resultFour,
        sr:Sr,
        chargeList:tempChargeList
      }
    });
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.post("/getNotes", async(req, res) => {
  try {
    const result = await Job_notes.findAll({
      where:{type: req.body.type, recordId:req.body.id},
      order:[["createdAt", "DESC"]],
    });
    
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.get("/getAllNotes", async(req, res) => {
  try {
    const result = await Job_notes.findAll({
      order:[["createdAt", "DESC"]],
    });
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.post('/updateNotes', async(req, res) => {
  try {
    const result =  await Job_notes.update({opened : req.body.data.opened}, 
    {where : {recordId : req.body.data.recordId}})
    createHistory(req.body.employeeId, 'Job', 'Edit', result.name);
    res.json({ status: "success", result:result})
  }
  catch (err) {
    res.status(500).json({status:"error", result:err.message})
  }
});

routes.post("/addNote", async(req, res) => {
  try {
      const result = await Job_notes.create(req.body);
      createHistory(req.body.employeeId, 'Job', 'Add', result.name);
      res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

const { blankIntegersToNull } = require('../../functions/blankIntegers');
// A client over its credit limit cannot be put on a job - functions/creditControl.
const { assertClientAllowed, CreditBlocked } = require('../../functions/creditControl/blocks');
const creditRefusal = (res, error) => res.status(409).json({ status: 'error', result: error.message, creditBlock: error.creditBlock });

routes.post("/create", async(req, res) => {

  const createEquip = (list, id) => {
    let result = [];
    list.forEach((x) => {
      if(x.size!=''&&x.qty!='', x.dg!='', x.teu!=''){
        delete x.id
        result.push({...x, SEJobId:id, teu:`${x.teu}`})
      }
    })
    return result;
  }
  try {
    let data = req.body.data
    // A real company, or nothing is saved - see functions/companyCodes.
    const companyId = await realCompanyId(data?.companyId);
    if (!companyId) return res.status(400).json({ status: 'error', result: NO_COMPANY });
    data.companyId = companyId;

    const fiscalYear = await resolveSelectedFiscalYear(data.fiscalYearId);
    const fySuffix = fiscalYear.suffix;

    delete data.id
    // An unset dropdown's "" in any integer link - see functions/blankIntegers.
    blankIntegersToNull(SE_Job, data);
    await assertClientAllowed(req, { clientId: data.ClientId });
    data.customCheck = data.customCheck.toString();
    data.transportCheck = data.transportCheck.toString();
    if(data.operation=="AE"||data.operation=="AI"){
      data.vesselId = null
      data.subType = "AIR"

    } else {
      data.airLineId=null
    }
    // The code for the operation (SEJ / SIJ / AE / AI by default) and the
    // layout both come from Config > Document Numbers. The last job is found
    // by operation and jobId - never by the code or prefix in jobNo, which
    // that screen can change - so the sequence carries on through any change.
    const numbering = await readNumbering();
    const jobCompany = await companyShort(data.companyId);
    const check = await lastInYear(SE_Job, {
      seqCol: 'jobId',
      noCol: 'jobNo',
      suffix: fySuffix,
      where: { operation: data.operation },
      company: { column: 'companyId', id: data.companyId.toString() },
      scoped: perCompany(numbering, 'jobs'),
    });
    const nextJobId = nextAfter(check, 'jobId');

    const result = await SE_Job.create({
      ...data,
      jobId: nextJobId,
      jobNo: formatNumber(numbering, {
        klass: 'jobs', company: jobCompany, code: codeFor(numbering, 'jobs', data.operation),
        seq: nextJobId, suffix: fySuffix,
      }),
      FiscalYearId: fiscalYear.id
    })
    await SE_Equipments.bulkCreate(createEquip(data.equipments,  result.id)).catch((x)=>console.error(x))
    createHistory(req.body.employeeId, 'Job', 'Create', result.jobNo);
    res.json({status:'success', result:await getJob(result.id)});
  }
  catch (error) {
    if (error instanceof CreditBlocked) return creditRefusal(res, error);
    console.error(error)
    res.status(500).json({status:'error', result:error.message || error});
  }
});

routes.post("/edit", async (req, res) => {
  const createEquip = (list, id) => {
    let result = [];
    list.forEach((x) => {
      if (x.size != "" && x.qty != "" && x.dg != "" && x.teu != "") {
        delete x.id;
        result.push({ ...x, SEJobId: id, teu: `${x.teu}` });
      }
    });
    return result;
  };

  // Declared out here so the catch can still reach the transaction, but
  // opened INSIDE the try: this handler is an async function and Express 4
  // does not catch rejections from one, so anything thrown before the try
  // (e.g. the pool being exhausted when opening the transaction) would leave
  // the request hanging with no response instead of returning an error.
  let t;
  let committed = false;

  try {
    // The job row and its equipment rows are one logical edit and must not be
    // allowed to half-apply: the equipment update below is a full destroy +
    // re-create, so a failure partway through would otherwise leave the job
    // with no containers at all.
    let data = req.body.data;
    // Nor saved by a user with no company picked; and an edit never moves a
    // job to another company - the payload carries whatever the header holds.
    if (!(await realCompanyId(data?.companyId))) {
      return res.status(400).json({ status: "error", result: NO_COMPANY });
    }
    delete data.companyId;
    // Nor who created it - that is set once, at create.
    delete data.createdById;

    /* UNLOCKED: an approved job saved after a CEO, CFO or admin pressed
     * Unlock (/unlock). Checked here, on the save itself: the screen's flag is
     * a request, and a stale tab or anything posting straight at this route
     * must not pass for an unlock by setting it. */
    const unlockedSave = data.unlocked === true;
    delete data.unlocked;
    if (unlockedSave && !hasDesignation(req, UNLOCKERS)) {
      return res.status(403).json({
        status: "error",
        result: `Only ${UNLOCKERS.join(', ')} can change an approved job.`,
      });
    }

    // A job that already has the client keeps saving; changing to a blocked one does not.
    const before = await SE_Job.findOne({ where: { id: data.id }, attributes: ['ClientId'] });
    await assertClientAllowed(req, { clientId: data.ClientId === '' ? null : data.ClientId, previousClientId: before?.ClientId });

    t = await sequelize.transaction();

    // An unset dropdown's "" in any integer link - see functions/blankIntegers.
    blankIntegersToNull(SE_Job, data);
    data.customCheck = data.customCheck.toString();
    data.transportCheck = data.transportCheck.toString();
    data.approved = data.approved.toString();

    // These three writes used to each carry a .catch(x => console.error(...))
    // while the handler still returned status:"success" unconditionally. That
    // made a *rejected* edit look like it had saved: most often the fiscal-year
    // guard (functions/Associations/fiscalYearAssociations) refusing a write to
    // a job whose fiscal year is locked, or is not the one the user currently
    // has selected. The user got "Job Updated!", the row never changed, and the
    // equipment destroy/re-create still ran even though the job update hadn't.
    // Let these throw so the catch below reports the real reason and rolls back.
    await SE_Job.update(data, { where: { id: data.id }, transaction: t });
    await SE_Equipments.destroy({ where: { SEJobId: data.id }, transaction: t });
    await SE_Equipments.bulkCreate(createEquip(data.equipments, data.id), { transaction: t });

    await t.commit();
    committed = true;

    // An unlocked save is its own entry, so the special change can be found.
    createHistory(req.body.employeeId, 'Job', unlockedSave ? 'Edit (unlocked)' : 'Edit', data.jobNo);
    return res.json({ status: "success", result: await getJob(data.id) });

  } catch (error) {
    // Only roll back if the transaction was actually opened and we never got
    // as far as committing - rolling back an already-committed (or never
    // started) transaction throws and would mask the real error.
    if (t && !committed) {
      await t.rollback().catch(() => {});
    }
    if (error instanceof CreditBlocked) return creditRefusal(res, error);
    console.error(error);
    return res.status(500).json({status:"error", result: error.message || String(error) });
  }
});

/**
 * Unlock an approved job for one save - CEO, CFO and admin only.
 *
 * An approved job's booking info is locked on the screen, and once one of its
 * charges is approved the job cannot be un-approved either - so a mistake on
 * it could not be corrected at all. This opens it without un-approving
 * anything, as /customsJob/unlock does for an invoiced declaration.
 *
 * It changes nothing on its own. It leaves a record - History "Unlock", by
 * the signed-in user - and the save that follows is checked again in /edit and
 * recorded as "Edit (unlocked)".
 */
routes.post("/unlock", requireDesignation(UNLOCKERS), async (req, res) => {
  try {
    const id = Number(req.body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: "error", result: `Not a valid job id: ${req.body.id}` });
    }
    const job = await SE_Job.findOne({ where: { id }, attributes: ["id", "jobNo", "approved"] });
    if (!job) return res.status(404).json({ status: "error", result: "Job not found." });
    if (!["1", "true"].includes(String(job.approved).toLowerCase())) {
      return res.status(409).json({ status: "error", result: "This job is not approved, so it is not locked." });
    }
    await createHistory(req.user?.id || req.body.employeeId, "Job", "Unlock", job.jobNo);
    res.json({ status: "success", result: { id: job.id, jobNo: job.jobNo } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", result: error.message || error });
  }
});

routes.get("/get", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const search = (req.query.search || "").trim();
    const companyId = req.query.companyid;
    const operation = req.query.operation;

    // STRICT: no company picked, no jobs - and the screen says why. See
    // functions/companyCodes. (With none, the query below threw on an
    // undefined WHERE value and the list came back a 500.)
    if (!isCompanyId(companyId)) {
      return res.json({ status: "success", result: [], total: 0, page: 1, totalPages: 1, noCompany: true });
    }

    const isNumeric = !isNaN(Number(search));

    // -------------------------
    // SEARCH CONDITION
    // -------------------------
    const searchCondition = search
      ? {
          [Op.or]: [
            { jobNo: { [Op.iLike]: `%${search}%` } },
            { nomination: { [Op.iLike]: `%${search}%` } },
            { freightType: { [Op.iLike]: `%${search}%` } },
            { pol: { [Op.iLike]: `%${search}%` } },
            { pod: { [Op.iLike]: `%${search}%` } },
            { fd: { [Op.iLike]: `%${search}%` } },

            Sequelize.where(
              Sequelize.col("Client.name"),
              { [Op.iLike]: `%${search}%` }
            ),

            Sequelize.where(
              Sequelize.col("Bl.hbl"),
              { [Op.iLike]: `%${search}%` }
            ),
            Sequelize.where(
              Sequelize.col("Bl.mbl"),
              { [Op.iLike]: `%${search}%` }
            ),

            ...(isNumeric
              ? [
                  Sequelize.where(
                    Sequelize.cast(
                      Sequelize.col("SE_Job.weight"),
                      "TEXT"
                    ),
                    { [Op.iLike]: `%${search}%` }
                  )
                ]
              : [])
          ]
        }
      : {};

    // -------------------------
    // QUERY WITH MERGED COUNTS ✅
    // -------------------------
    const { count, rows } = await SE_Job.findAndCountAll({
      where: {
        companyId,
        operation,
        ...searchCondition
      },

      include: [
        { model: Employees, as: "created_by", attributes: ["name"] },
        { model: Bl, attributes: ["hbl", "mbl"], required: false },
        { model: Clients, attributes: ["name"], required: false },
        {
          model: Charge_Head,
          attributes: [],
          required: false
        }
      ],

      attributes: [
        "id",
        "createdAt",
        "approved",
        "jobNo",
        "nomination",
        "freightType",
        "pol",
        "pod",
        "fd",
        "weight",
        "transportCheck",
        "customCheck",

        // ✅ INVOICE COUNT
        [
          Sequelize.literal(`
            COUNT(DISTINCT CASE
              WHEN "Charge_Heads"."invoice_id" LIKE '%I%'
              THEN "Charge_Heads"."invoice_id"
            END)
          `),
          "iLength"
        ],

        // ✅ BILL COUNT
        [
          Sequelize.literal(`
            COUNT(DISTINCT CASE
              WHEN "Charge_Heads"."invoice_id" LIKE '%B%'
              THEN "Charge_Heads"."invoice_id"
            END)
          `),
          "bLength"
        ]
      ],

      group: [
        "SE_Job.id",
        "created_by.id",
        "created_by.name",
        "Bl.id",
        "Bl.hbl",
        "Bl.mbl",
        "Client.id",
        "Client.name"
      ],

      order: [["createdAt", "DESC"]],
      limit,
      offset,
      distinct: true,
      subQuery: false
    });

    res.json({
      status: "success",
      result: rows,
      total: count.length || count,
      page,
      totalPages: Math.ceil((count.length || count) / limit)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch jobs",
      error
    });
  }
});

routes.get("/getJobById", async(req, res) => {
    try {
        const result = await SE_Job.findOne({
          where:{id:req.headers.id},
          include:[
            {
              model:SE_Equipments
            },
            {
              model:Clients,
              attributes:['name']
            }
          ],
          order:[["createdAt", "DESC"]],
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result: error.message || error });
    }
});

routes.get("/getSEJobIds", async(req, res) => {
    try {
      const result = await SE_Job.findAll({
        attributes:['id']
      });
      res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result: error.message || error });
    }
});

routes.get("/getSEJobById", async(req, res) => {
    try {
      const result = await SE_Job.findOne({
        where:{id:req.headers.id},
        include:[
          // The containers' gross: a sea job's Weight is their total.
          {model:Bl, attributes:['id', 'hbl', 'hblDate', 'mbl', 'mblDate'],
            include:[{ model:Container_Info, attributes:['id', 'gross'] }]},
          {model:Voyage},
          {model:SE_Equipments},
          {
            model:Clients,
            attributes:['name']
          },
          // Who opened the job - shown on the job page.
          { model: Employees, as: 'created_by', attributes: ['name'], required: false },
        ],
        order:[["createdAt", "DESC"]],
      });
      res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result: error.message || error });
    }
});

routes.get("/getJobsWithoutBl", async(req, res) => {

  const attr = [
    'name', 'address1', 'address1', 'person1', 'mobile1',
    'person2', 'mobile2', 'telephone1', 'telephone2', 'infoMail'
  ];

  try {
  const result = await SE_Job.findAll({
    where:{id:req.headers.id},
    attributes:[
      'id', 'jobNo', 'pol',
      'pod', 'fd', 'jobDate',
      'shipDate', 'cutOffDate',
      'delivery', 'freightType',
      'operation', 'flightNo','VoyageId',
      'cwtLine', 'cwtClient', 'weight', 'pcs'
    ],
    order:[["createdAt", "DESC"]],
    include:[
      {
        model:Bl,
        required: false,
      },
      { model:SE_Equipments, attributes:['qty', 'size'] },
      { model:Clients,  attributes:attr },
      { model:Clients, as:'consignee', attributes:attr },
      { model:Clients, as:'shipper', attributes:attr },
      { model:Clients, as:'overseas_agent', attributes:attr },
      { model:Commodity, as:'commodity' },
      { model:Vessel, as:'vessel', attributes:['name'] },
      { model:Clients, as:'air_line', attributes:['name'] },
      { model:Clients, as:'shipping_line', attributes:['name'] },
      { model:Voyage, attributes:['voyage'] },
    ],
  });
  res.json({status:'success', result:result});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// routes.post("/createBl", async(req, res) => {
//   try {
//     let data = req.body;
//     delete data.id;
//     const check = await Bl.findOne({
//       where:{ hbl: data.hbl },
//       attributes:["mbl", "hbl", "SEJobId"] 
//     });
//     if(data.operation=="AI" || data.operation=="AE"){

//     }
//     if (!check){
//       let obj = {
//         pkgUnit:data.unit, 
//         pcs:data.pkgs, 
//         weightUnit:data.wtUnit, 
//         vol:data.cbm, 
//         shpVol:data.cbm,
//         weight:data.gross,
//         cwtClient:data.chargableWt
//       }
//       if(data.operation=="SI" || data.operation=="AI" || data.operation=="SE"){

//         await SE_Job.update({
//           ...obj
//         }, {where:{id:data.SEJobId}});
//       }
//       const result = await Bl.create({...data,
//       }).catch((x)=>console.log(x))
//       // Creating Items for AE
//       if(data.Item_Details.length>0){
//         let tempItems = [];
//         data.Item_Details.forEach((x)=>{
//           x.id==null?delete x.id:null;
//           tempItems.push({...x, BlId:result.id})
//         })
//         await Item_Details.bulkCreate(tempItems)
//       }
//       await data.Container_Infos.forEach((x, i)=>{
//         data.Container_Infos[i] = {...x, BlId:result.id}
//       })
//       await Container_Info.bulkCreate(data.Container_Infos).catch((x)=>console.error(x))
//       if(data.Dimensions.length>0){
//         data.Dimensions.forEach((x, i)=>{
//           x.id==null?delete x.id:null;
//           data.Dimensions[i] = {...x, BlId:result.id}
//         })
//         await Dimensions.bulkCreate(data.Dimensions).catch((x)=>console.error(x))
//       }
//       const res1 = await SE_Job.findOne({
//         where:{id: data.SEJobId}
//       })
//       createHistory(req.body.employeeId, 'BL', 'Create', res1.jobNo);
//       res.json({status:'success', result:result.id });
//     }else {
//       const job = await SE_Job.findOne({
//         where: {
//           id: check.dataValues.SEJobId
//         },
//         attributes:["jobNo"]
//       })
//       // createHistory(req.body.employeeId, 'BL', 'Create', job.jobNo);
//       res.json({status:'warning', result:`Mbl or Hbl Already Exists in Job: ${job.dataValues.jobNo}` });
//     }
//   }
//   catch (error) {
//     console.error(error)
//     res.status(500).json({status:'error', result: error.message || error });
//   }
// });

routes.post("/createBl", async (req, res) => {
  try {
    let data = req.body;
    delete data.id;

    /**
     * 🔴 Rule 1: HBL must NEVER be duplicated
     */
    const hblCheck = await Bl.findOne({
      where: { hbl: data.hbl },
      attributes: ["mbl", "hbl", "SEJobId"],
    });

    if (hblCheck) {
      const job = await SE_Job.findOne({
        where: { id: hblCheck.SEJobId },
        attributes: ["jobNo"],
      });

      return res.json({
        status: "warning",
        result: `HBL Already Exists in Job: ${job.jobNo}`,
      });
    }

    /**
     * 🔴 Rule 2: MBL must NOT be duplicated ONLY for AI / AE
     */
    if (data.operation === "AI" || data.operation === "AE") {
      const mblCheck = await Bl.findOne({
        where: { mbl: data.mbl },
        attributes: ["mbl", "SEJobId"],
      });

      if (mblCheck) {
        const job = await SE_Job.findOne({
          where: { id: mblCheck.SEJobId },
          attributes: ["jobNo"],
        });

        return res.json({
          status: "warning",
          result: `MBL Already Exists in Job: ${job.jobNo}`,
        });
      }
    }

    /**
     * 🔴 Rule 3: on AE the MAWB must be registered stock for the job's airline
     */
    if (data.operation === "AE") {
      const problem = await checkMawbIsRegistered({ mbl: data.mbl, jobId: data.SEJobId });
      if (problem) {
        return res.json({ status: "warning", result: problem });
      }
    }

    /**
     * ✅ Original logic (UNCHANGED)
     */
    let obj = {
      pkgUnit: data.unit,
      pcs: data.pkgs,
      weightUnit: data.wtUnit,
      vol: data.cbm,
      shpVol: data.cbm,
      weight: data.gross,
      cwtClient: data.chargableWt,
    };

    if (data.operation === "SI" || data.operation === "AI" || data.operation === "SE") {
      await SE_Job.update(
        { ...obj },
        { where: { id: data.SEJobId } }
      );
    }

    const result = await Bl.create({ ...data });

    // Creating Items for AE
    if (data.Item_Details.length > 0) {
      let tempItems = [];
      data.Item_Details.forEach((x) => {
        x.id == null ? delete x.id : null;
        tempItems.push({ ...x, BlId: result.id });
      });
      await Item_Details.bulkCreate(tempItems);
    }

    await data.Container_Infos.forEach((x, i) => {
      data.Container_Infos[i] = { ...x, BlId: result.id };
    });
    await Container_Info.bulkCreate(data.Container_Infos);

    if (data.Dimensions.length > 0) {
      data.Dimensions.forEach((x, i) => {
        x.id == null ? delete x.id : null;
        data.Dimensions[i] = { ...x, BlId: result.id };
      });
      await Dimensions.bulkCreate(data.Dimensions);
    }

    const res1 = await SE_Job.findOne({
      where: { id: data.SEJobId },
    });

    createHistory(req.body.employeeId, "BL", "Create", res1.jobNo);

    res.json({
      status: "success",
      result: result.id,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({status:"error", result: error.message || error });
  }
});

// routes.post("/editBl", async(req, res) => {
//   try {
//     let data = req.body;
//     let obj = {
//       pkgUnit:data.unit, 
//       pcs:data.pkgs, 
//       weightUnit:data.wtUnit, 
//       vol:data.cbm, 
//       shpVol:data.cbm,
//       weight:data.gross,
//       cwtClient:data.chargableWt
//     };
//     if(data.operation=="SI" || data.operation=="AI" || data.operation=="SE"){
//       await SE_Job.update({
//         ...obj
//       }, {where:{id:data.SEJobId}});
//     };
//     await Bl.update(data, {where:{id:data.id}});
//     data.Container_Infos.forEach((x, i)=>{
//       data.Container_Infos[i] = {
//         ...x, BlId:data.id, 
//         pkgs:x.pkgs.toString(),
//         gross:x.gross.toString(),
//         net:x.net.toString(),
//         tare:x.tare.toString(),
//         cbm:x.cbm?.toString(),
//       }
//     });
//     const result = await Container_Info.bulkCreate(data.Container_Infos,{
//       updateOnDuplicate: [
//         "pkgs", "no", "seal", "size", "rategroup", "gross", "net", "tare", "wtUnit", "cbm", "pkgs", "unit", "temp", "loadType", "remarks", "detention",  "demurge", "plugin", "dg", "number", "date", "top", "right", "left", "front", "back"
//       ],
//     });
//     // Creating Items for AE
//     if(data.Item_Details.length>0){
//       let tempItems = [];
//       data.Item_Details.forEach((x)=>{
//         x.id==null?delete x.id:null;
//         tempItems.push({...x, BlId:req.body.id})
//       })
//       await Item_Details.bulkCreate(tempItems,{
//         updateOnDuplicate: [
//           "noOfPcs", "unit", "grossWt", "kh_lb", "r_class", "itemNo", "chargableWt", "rate_charge", "total", "lineWeight"
//         ],
//       })
//     };
//     if(data.Dimensions.length>0){
//       let tempItems = [];
//       data.Dimensions.forEach((x)=>{
//         x.id==null?delete x.id:null;
//         tempItems.push({...x, BlId:req.body.id})
//       })
//       await Dimensions.bulkCreate(tempItems,{
//         updateOnDuplicate: [
//           "length", "width", "height", "qty", "vol", "weight"
//         ],
//       })
//     };
//     await Stamps.destroy({ where:{id:data.deleteArr} });
//     await Container_Info.destroy({ where:{id:req.body.deletingContinersList} });
//     await Item_Details.destroy({ where:{id:req.body.deletingItemList} });
//     await Dimensions.destroy({ where:{id:req.body.deletingDimensionsList} });
//     await data.stamps?.map((x) => Stamps.upsert({...x, BlId:req.body.id}));
//     const res1 = await SE_Job.findOne({
//       where:{id:data.SEJobId}
//     })
//     createHistory(req.body.employeeId, 'BL', 'Edit', res1.jobNo);
//     res.json({status:'success', result: result});   
//   } 
//   catch (error) {
//     res.status(500).json({status:'error', result: error.message || error });  
//   } 
// }); 

routes.post("/editBl", async (req, res) => {
  try {
    let data = req.body;

    /**
     * 🔴 Rule 1: HBL must NEVER be duplicated (ignore current BL)
     */
    const hblCheck = await Bl.findOne({
      where: {
        hbl: data.hbl,
        id: { [Op.ne]: data.id },
      },
      attributes: ["SEJobId"],
    });

    if (hblCheck) {
      const job = await SE_Job.findOne({
        where: { id: hblCheck.SEJobId },
        attributes: ["jobNo"],
      });

      return res.json({
        status: "warning",
        result: `HBL Already Exists in Job: ${job.jobNo}`,
      });
    }

    /**
     * 🔴 Rule 2: MBL must NOT be duplicated ONLY for AI / AE (ignore current BL)
     */
    if (data.operation === "AI" || data.operation === "AE") {
      const mblCheck = await Bl.findOne({
        where: {
          mbl: data.mbl,
          id: { [Op.ne]: data.id },
        },
        attributes: ["SEJobId"],
      });

      if (mblCheck) {
        const job = await SE_Job.findOne({
          where: { id: mblCheck.SEJobId },
          attributes: ["jobNo"],
        });

        return res.json({
          status: "warning",
          result: `MBL Already Exists in Job: ${job.jobNo}`,
        });
      }
    }

    /**
     * 🔴 Rule 3: on AE the MAWB must be registered stock for the job's airline,
     * but ONLY when it is actually being changed.
     *
     * Air export BLs that predate the register can carry a number that was
     * never added to it (bad check digit, wrong length, or a duplicate - the
     * ones the migration reports and scripts/backfillAwbl.js lists).
     * Validating unconditionally would make those BLs uneditable for any reason
     * at all: someone fixing a consignee would be stopped by an unrelated MAWB
     * complaint. Only a change to the MAWB itself has to satisfy the rule.
     */
    if (data.operation === "AE") {
      const current = await Bl.findOne({
        where: { id: data.id },
        attributes: ["mbl", "SEJobId"],
      });
      const before = String(current?.mbl ?? "").replace(/\D/g, "");
      const after = String(data.mbl ?? "").replace(/\D/g, "");

      if (before !== after) {
        const problem = await checkMawbIsRegistered({
          mbl: data.mbl,
          jobId: data.SEJobId || current?.SEJobId,
        });
        if (problem) {
          return res.json({ status: "warning", result: problem });
        }
      }
    }

    /**
     * ✅ ORIGINAL CODE (UNCHANGED)
     */
    let obj = {
      pkgUnit: data.unit,
      pcs: data.pkgs,
      weightUnit: data.wtUnit,
      vol: data.cbm,
      shpVol: data.cbm,
      weight: data.gross,
      cwtClient: data.chargableWt,
    };

    if (data.operation === "SI" || data.operation === "AI" || data.operation === "SE") {
      await SE_Job.update(
        { ...obj },
        { where: { id: data.SEJobId } }
      );
    }

    await Bl.update(data, { where: { id: data.id } });

    /* EXISTING CONTAINERS ARE UPDATED, NEW ONES INSERTED. The screen sends
     * every container on the BL, the saved ones with their ids. Without
     * updateOnDuplicate (dropped in April) each saved container was inserted
     * again under its own id, and editing any BL that had one failed on
     * Container_Infos_pkey. A new row's empty id is left out so it gets one. */
    const text = (v) => (v === null || v === undefined ? v : String(v));
    const containers = (data.Container_Infos || []).map((x) => {
      const row = {
        ...x,
        BlId: data.id,
        pkgs: text(x.pkgs),
        gross: text(x.gross),
        net: text(x.net),
        tare: text(x.tare),
        cbm: text(x.cbm),
      };
      if (row.id === null || row.id === undefined || row.id === '') delete row.id;
      return row;
    });

    const result = await Container_Info.bulkCreate(containers, {
      updateOnDuplicate: CONTAINER_FIELDS,
    });

    if (data.Item_Details.length > 0) {
      await Item_Details.destroy({
        where: {
          BlId: data.id
        }
      })
      let tempItems = [];
      data.Item_Details.forEach((x) => {
        x.id == null ? delete x.id : null;
        tempItems.push({ ...x, BlId: data.id });
      });
      await Item_Details.bulkCreate(tempItems);
    }

    if (data.Dimensions.length > 0) {
      await Dimensions.destroy({
        where: {
          BlId: data.id
        }
      })
      let tempItems = [];
      data.Dimensions.forEach((x) => {
        x.id == null ? delete x.id : null;
        tempItems.push({ ...x, BlId: data.id });
      });

      await Dimensions.bulkCreate(tempItems);
    }

    await Stamps.destroy({ where: { id: data.deleteArr } });
    await Container_Info.destroy({ where: { id: data.deletingContinersList } });
    await Item_Details.destroy({ where: { id: data.deletingItemList } });
    await Dimensions.destroy({ where: { id: data.deletingDimensionsList } });

    /* STAMPS: saved ones updated, new ones inserted - as with the containers
     * above. The screen sends the saved stamps with their ids, and creating
     * them again failed on Stamps_pkey; the failure was logged and swallowed,
     * so the BL read "saved" while every change to an existing stamp was
     * lost. Only the stamps the screen removed (deleteArr) are deleted. */
    if (data.stamps && data.stamps.length > 0) {
      const stamps = data.stamps.map((x) => {
        const row = { ...x, BlId: data.id };
        if (row.id === null || row.id === undefined || row.id === '') delete row.id;
        return row;
      });
      await Stamps.bulkCreate(stamps, {
        updateOnDuplicate: ["code", "stamps", "stamp_group", "updatedAt"],
      });
    }

    const res1 = await SE_Job.findOne({
      where: { id: data.SEJobId },
    });

    createHistory(req.body.employeeId, "BL", "Edit", res1.jobNo);

    /* The BL's containers as saved, with the ids the new ones were given. The
     * screen kept a new row's empty id after saving, so the next save sent
     * it as new again and it was inserted twice - and once more on every
     * save after (the user's "rows are duplicating", 2026-11-02). */
    const containersSaved = await Container_Info.findAll({ where: { BlId: data.id }, order: [['id', 'ASC']] });

    res.json({ status: "success", result, containers: containersSaved });

  } catch (error) {
    console.error(error);
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.post("/findJobByNo", async(req, res) => {
  try {
    const attr = [
      'name', 'address1', 'address1', 'person1', 'mobile1',
      'person2', 'mobile2', 'telephone1', 'telephone2', 'infoMail'
    ];
    const result = await SE_Job.findAll({
      where:{jobNo:req.body.no},
      attributes:[
        'jobNo', 'pol', 'por',
        'flightNo','id', 
        'pod', 'fd', 'jobDate',
        'shipDate', 'cutOffDate',
        'delivery', 'freightType',
        'freightPaybleAt','VoyageId',
      ],
      order:[["createdAt", "DESC"]],
      include:[
        { model:SE_Equipments, attributes:['qty', 'size'] },
        { model:Clients,  attributes:attr },
        { model:Clients, as:'consignee', attributes:attr },
        { model:Clients, as:'shipper', attributes:attr },
        { model:Clients, as:'overseas_agent', attributes:attr },
        { model:Commodity, as:'commodity' },
        { model:Vessel,  as:'vessel', attributes:['name'] },
        { model:Clients, as:'air_line', attributes:['name'] },
        { model:Clients, as:'shipping_line', attributes:['name'] },
        { model:Voyage, attributes:['voyage'] },
      ]
    });
    res.json({status:'success', result:result});
  }
  catch (error) {
    res.status(500).json({status:'error', result: error.message || error });
  }
});

// Lightweight search used by "Copy From Existing Job" on the new-job page —
// find a candidate by job number or client name, then the frontend fetches
// the full record via /getSEJobById once one is picked.
routes.get("/searchForCopy", async(req, res) => {
  try {
    const q = (req.headers.q || '').trim();
    if (!q) {
      return res.json({ status:'success', result:[] });
    }
    const where = { operation:req.headers.operation };
    if (req.headers.companyid) {
      where.companyId = req.headers.companyid;
    }
    where[Op.or] = [
      { jobNo: { [Op.iLike]: `%${q}%` } },
      { '$Client.name$': { [Op.iLike]: `%${q}%` } },
    ];
    const jobs = await SE_Job.findAll({
      where,
      attributes:['id', 'jobNo', 'jobDate', 'pol', 'pod', 'fd'],
      include:[{ model:Clients, attributes:['name'] }],
      order:[['createdAt', 'DESC']],
      limit: 20,
      subQuery: false,
    });
    res.json({status:'success', result:jobs});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error.message || error});
  }
});

routes.get("/getAllBls", async(req, res) => {
    try {
      const result = await Bl.findAll({
        include:[
          { model:SE_Job, attributes:["jobNo"] },
          { model:Container_Info }
        ]
      });
      res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result: error.message || error });
    }
});

routes.get("/getBlById", async(req, res) => {
  try {
    const result = await Bl.findOne({
      where:{id:req.headers.id},
      include:[
        {
          model:SE_Job,
          attributes:["jobNo"]
        },
        {model: Stamps},
        {model: Container_Info},
        {model: Item_Details},
        {model: Dimensions},
    ]});
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
});

routes.get("/getStamps", async(req, res) => {
  try {
    const result = await Stamps.findAll({
        where:{BlId:req.headers.id},
    });
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
}); 

routes.post("/deleteJob", async(req, res) => {
  try {
    await Bl.destroy({
      where:{
        SEJobId: req.body.id
      }
    })
    const job = await SE_Job.findOne({
      where:{id:req.body.id}
    })
    const result = await SE_Job.destroy({
      where:{id:req.body.id},
    });
    createHistory(req.body.employeeId, 'Job', 'Delete', job.jobNo);
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
}); 

routes.get("/getLoadingProgram", async(req, res) => {
  try {
    const result = await Loading_Program.findOne({
      where:{SEJobId:req.headers.id},
    });
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
}); 

/* Saving a job's loading program: the one it has is updated, or one is made.
 *
 * Not Model.upsert. That is INSERT ... ON CONFLICT ("id"), which needs a
 * unique key on id - and a database whose Loading_Programs has lost its
 * primary key (a local copy did) refuses the statement outright, so nothing
 * could be saved. Found by id, else by job: a job has one loading program,
 * and a save that arrives without the id (a second tab, a reload mid-edit)
 * updates it rather than adding another. Answers [row, created], as upsert
 * did - the screen reads the new id from result[0]. */
routes.post("/upsertLoadingProgram", async(req, res) => {
  try {
    const { id, employeeId, ...fields } = req.body;
    let row = id ? await Loading_Program.findOne({ where: { id } }) : null;
    if (!row && fields.SEJobId) {
      row = await Loading_Program.findOne({ where: { SEJobId: fields.SEJobId }, order: [['id', 'ASC']] });
    }
    const result = row ? await row.update(fields) : await Loading_Program.create(fields);
    createHistory(employeeId, 'Loading Program', row ? 'Update' : 'Create', String(fields.SEJobId ?? ''));
    res.json({status:'success', result:[result, !row]});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error });
  }
}); 

routes.get("/getJobByValues", async (req, res) => {
    let value = req.headers;
    let obj = {
      createdAt: {
        [Op.gte]: moment(value.from).toDate(),
        [Op.lte]: moment(value.to).add(1, 'days').toDate(),
      }
    };
    let newObj = {};
    if (value.client) {
      obj.ClientId = value.client;
    }
    if (value.final_destination) {
      obj.fd = value.final_destination;
    }
    if (value.shipping_air_line) {
      obj.shippingLineId = value.shipping_air_line;
    }
    if (value.consignee) {
      obj.consigneeId = value.consignee;
    }
    if (value.oversease_agent) {
      obj.overseasAgentId = value.oversease_agent;
    }
    if (value.vessel) {
      obj.vesselId = value.vessel;
    }
    if (value.clearing_agent) {
      obj.customAgentId = value.clearing_agent;
    }
    if (value.vendor) {
      obj.localVendorId = value.vendor;
    }
     if(value.air_line) {
      obj.airLineId = value.air_line;
    }
    if(value.hbl) {
      newObj.hbl = value.hbl;
    }
    if(value.mbl) {
      newObj.mbl = value.mbl;
    }
    try {
      const jobs = await SE_Job.findAll({
        where: obj,
        include:[
          { model:Bl, where: newObj, 
          include:[{model:Container_Info , attributes:["gross", 'net', "tare", "no"]},
          {model:Item_Details , attributes:["grossWt", 'chargableWt', "rate_charge"]} 
          ]},
          { model: Clients, attributes:     ["name"] },
          { model: Charge_Head, attributes: ["type", "amount"]},
          { model: Clients, attributes:     ["name"], as : "local_vendor"},
          { model: Clients, attributes:     ["name"], as : "shipping_line"},
          { model: Clients, attributes:     ["name"], as :"air_line"},
          { model: Vessel , attributes:     ["name"], as :"vessel" },
          { model: Commodity, attributes:   ["name"], as :"commodity" },
          { model: Employees, attributes:   ["name"], as :"sales_representator" },
          { model: Clients, attributes:     ["name"], as :"shipper" },
          { model: Clients, attributes:     ["name"], as :"consignee" },
      ]});
      res.status(200).json({ result: jobs });
    } catch (err) {
      console.error(err);
      res.status(200).json({ result: err.message });
    }
});

routes.get("/getValuesJobList", async (req, res) => {

  let makeResult = (result, resultTwo) => {
    let finalResult = { consignee: [], client: [], sLine: [] };
    result.forEach((x) => {
      if (x.types.includes("Consignee")) {
        finalResult.consignee.push({
          name: `${x.name} (${x.code})`,
          id: x.id,
          types: x.types,
        });
      }
      if (x.types.includes("Shipping Line")) {
        finalResult.sLine.push({
          name: `${x.name} (${x.code})`,
          id: x.id,
          types: x.types,
        });
      }
    });
    finalResult.client = resultTwo.map((x) => {
      return { name: `${x.name} (${x.code})`, id: x.id, types: x.types };
    });
    return finalResult;
  };

  let makeResultTwo = (result) => {
    let finalResult = {
      overseasAgent: [],
      chaChb: [],
      sLine: [],
      airLine: []
    };
    result.forEach((x) => {
      if (x.types.includes("Overseas Agent")) {
        finalResult.overseasAgent.push({
          name: `${x.name} (${x.code})`,
          id: x.id,
          types: x.types,
        });
      }
      if (x.types.includes("CHA/CHB")) {
        finalResult.chaChb.push({
          name: `${x.name} (${x.code})`,
          id: x.id,
          types: x.types,
        });
      }

      if (x.types.includes("Shipping Line")) {
        finalResult.sLine.push({
          name: `${x.name} (${x.code})`,
          id: x.id,
          types: x.types,
        });
      }
      if (x.types.includes("Air Line")) {
        finalResult.airLine.push({
          name: `${x.name} (${x.code})`,
          id: x.id,
          types: x.types,
        });
      } 
    });
    return finalResult;
  };

  try {
    const resultOne = await Clients.findAll({
      attributes: ["id", "name", "types", "code"],
      order: [["createdAt", "DESC"]],
    });
    const result = await Clients.findAll({
      where: {
        types: {
          [Op.or]: [{ [Op.substring]: "Consignee" },
          { [Op.substring]: "Shipping Line" }],
        },
      },
      attributes: ["id", "name", "types", "code"],
      order: [["createdAt", "DESC"]],
    });
    const resultThree = await Clients.findAll({
      where: {
        types: {
          [Op.or]: [
            { [Op.substring]: "CHA/CHB" },
            { [Op.substring]: "Overseas Agent" },
            { [Op.substring]: "Shipping Line" },
          ],
        },
      },
      attributes: ["id", "name", "types", "code"],
      order: [["createdAt", "DESC"]],
    });

    const vendor = await Clients.findAll({
      attributes: ["id", "name", "types", "code"],
      order: [["createdAt", "DESC"]],
    });
    const resultTwo = await Commodity.findAll({
      order: [["createdAt", "DESC"]],
      attributes: ["id", "name", "hs"],
    });

    const resultFour = await Vessel.findAll({
      order: [["createdAt", "DESC"]],
      attributes: ["id", "name", "code", "carrier", "active"],
      include: [
        {
          model: Voyage,
        },
      ],
    });
    const Sr = await Employees.findAll({
      where: { represent: { [Op.substring]: "sr" } },
      attributes: ["id", "name"],
    });
    res.json({
      status: "success",
      result: {
        vendor: vendor,
        party: makeResult(result, resultOne),
        vendor_details: makeResultTwo(resultThree),
        commodity: resultTwo,
        vessel: resultFour,
        sr: Sr,
      },
    });
  } catch (error) {
    console.error(error)
    res.status(500).json({status:"error", result: error.message || error });
  }
});

routes.get("/getDeliveryOrder", async(req, res) => {
  try {
    const result = await Delivery_Order.findOne({
        where:{SEJobId:req.headers.id},
    }).catch((x)=>console.error(x))
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error.message || error });
  }
}); 

/* Saving a delivery order. The first save numbers it; every later one updates
 * that same order.
 *
 * Every later save used to fail: it wrote the history line from `result`
 * before `result` was set, so it threw, and the order never changed after it
 * was first saved. A save that arrives with the number but without the id (the
 * screen dropped the id after the first save) updates the order it names,
 * rather than adding a second order under the same number. */
routes.post("/upsertDeliveryOrder", async(req, res) => {
  try {
    let result;
    if(!req.body.doNo){
      const check = await Delivery_Order.findOne({order: [ [ 'no', 'DESC' ]], attributes:["no"], where:{operation:req.body.operation, companyId:req.body.companyId}});
      result = await Delivery_Order.upsert({
        ...req.body,
        no:check==null?1:parseInt(check.no)+1,
        doNo:`${await companyShort(req.body.companyId)}-DO${check==null?1:parseInt(check.no)+1}-${moment().format("YY")}`
      });
    } else {
      const data = { ...req.body };
      if (!data.id) {
        const existing = await Delivery_Order.findOne({ where: { doNo: data.doNo, SEJobId: data.SEJobId }, attributes: ['id', 'no'] });
        if (existing) { data.id = existing.id; data.no = existing.no; }
      }
      result = await Delivery_Order.upsert(data);
    }
    createHistory(req.body.employeeId, 'Delivery Order', 'Upsert', result?.[0]?.doNo || req.body.doNo);
    res.json({status:'success', result: result});
  }
  catch (error) {
    console.error(error.message)
    res.status(500).json({status:'error', result:error.message});
  }
});

routes.get("/getawb", async(req, res) => {
  try {
    const result = await SE_Job.findAll({
      where: {[Op.or]: [
        { operation: "AE" },
        { operation: "AI" }
      ]},
      attributes:["jobNo", "operation", "id"],
      include:[{
        model:Bl,
        attributes:["mbl"]
      }]
    })
    res.status(200).json({ result: result });
  } catch (err) {
    console.error(err);
    res.status(200).json({ result: err.message });
  }
});

const createMap = (arr, key) => new Map(arr.map(item => [item[key], item]));

function formatAddress(raw) {
  // Handle null, undefined, or non-string safely
  if (!raw || typeof raw !== "string") {
    raw = "";
  }

  // Split by newlines and tabs
  let parts = raw
    .split(/\r?\n|\t/) // split on newlines or tabs
    .map(p => p.trim()) // trim extra spaces
    .filter(p => p.length > 0); // remove empty ones

  // Add TEL null placeholders if none exist
  if (!parts.some(p => /^TEL/i.test(p))) {
    parts.push("TEL null", "TEL null");
  }

  // Pad with "null" to reach 10 lines
  while (parts.length < 10) {
    parts.push("null");
  }

  // Wrap each in <p>
  return parts.map(p => `<p>${p}</p>`).join("");
}


routes.post("/UploadSEJobs", SYSTEM, async (req, res) => {
  try{
    let jobs = []
    // Already-imported jobs are skipped rather than inserted twice.
    //
    // These receivers use plain create(), so a stage that died half way through
    // could not be retried - the only recovery was restoring the database.
    // Matching on climaxId (now indexed) makes every job stage re-runnable, and
    // `skipped` in the response tells you it happened rather than hiding it.
    let skipped = 0;
    resetLinkMisses();

    const existingJobs = new Set(
      (await SE_Job.findAll({ attributes: ['climaxId'], where: { climaxId: { [Op.ne]: null } } }))
        .map((j) => String(j.climaxId))
    );
    for(let job of req.body){
      if (job?.Id != null && existingJobs.has(String(job.Id))) { skipped++; continue; }

      // One transaction per job: the job, its equipment, B/L, containers,
      // stamps and charge lines all commit together or not at all.
      //
      // This is what makes the skip above safe. Without it, a batch that died
      // between creating the job row and creating its charges left a job that
      // existed but was incomplete - and the retry, seeing its climaxId,
      // skipped it, leaving it half-imported permanently. Rolling the job back
      // means a retry sees no climaxId and redoes it cleanly, so the skip only
      // ever applies to jobs that actually finished.
      await sequelize.transaction(async (t) => {
      const Client = await safeFindOne(Clients, job.ClientId)
      const OverseasAgent = await safeFindOne(Clients, job.OverseasAgentId)
      const LocalAgent = await safeFindOne(Clients, job.LocalAgentId)
      const CustomClearance = await safeFindOne(Clients, job.CustomClearanceId)
      const Transporter = await safeFindOne(Clients, job.TransporterId)
      const Forwarder = await safeFindOne(Clients, job.ForwarderId)
      const ShippingLine = await safeFindOne(Clients, job.ShippingLineId)
      const Consignee = await safeFindOne(Clients, job.ConsigneeId)
      const Shipper = await safeFindOne(Clients, job.ShipperId)
      const commodity = await safeFindOne(Commodity, job.CommodityId)
      const vessel = await safeFindOne(Vessel, job.VesselId)
      let voyage
      vessel ? voyage = await migrationCache.findVoyage(vessel.id, job.VoyageNo) : null

      let j = {
        jobNo: job.JobNumber,
        jobId: job.JobNumber.split("/")[0].split("-").pop(),
        customerRef: job.CustomerRefNo,
        fileNo: job.FileNumber,
        shipStatus: job.ShipmentStatusId == 1 ? "Shipped" : "Booked" ,
        teu: job.TEUS,
        bkg: job.BookingWeight,
        pcs: job.NoOfPackages,
        vol: job.Volume,
        volWeight: job.Weight,
        pol: job.PortOfLoadingCode,
        pod: job.PortOfDischargeCode,
        fd: job.PortOfFinalDestCode,
        dg: job.DGNonDGId == 1 ? "DG" : "non-DG",
        subType: job.SubTypeId == 3 ? "FCL" : "LCL",
        billVol: "",
        shpVol: job.Volume,
        weight: job.ActualWeight ?? job.Weight,
        weightUnit: job.WTUnitId,
        costCenter: job.CostCenter?.LOVCode,
        jobType: job.JobTypeId == 1 ? "Direct" : job.JobTypeId == 2 ? "Coloaded" : "Cross Trade",
        jobKind: job.JobKindId == 1 ? "Current" : "Opening",
        container: "",
        // 1 = Prepaid, 2 = Collect - see functions/jobMigrationPlan.js. Must be
        // the label: the id matches no option in Booking Info's select.
        freightType: job.FreightTypeId == 1 ? 'Prepaid'
          : job.FreightTypeId == 2 ? 'Collect'
          : null,
        // Not in the legacy book - see functions/jobMigrationPlan.js. A bare 1 is not one
        // of the options Booking Info offers, so it renders as a bare number.
        nomination: 'Free Hand',
        transportCheck: Transporter ? "Transport" : "", // ticked = HAS one; was inverted - see functions/jobMigrationPlan.js
        customCheck: CustomClearance ? "Custom Clearance" : "",
        etd: job.PlannedETD,
        eta: job.PlannedETA,
        aesDate: job.AESDateTime,
        eRcDate: job.ERecDateTime,
        eRlDate: job.ERLSDateTime,
        jobDate: job.JobDate,
        shipDate: job.SailingDate,
        doorMove: job.DoorMoveOnDate,
        cutOffDate: job.CutOffDateTime,
        siCutOoffDate: job.SICUTOFFDateTime,
        vgmCutOffDate: job.VGMCUTOFFDateTime,
        freightPaybleAt: job.FreightPayableAtCode,
        terminal: job?.Terminal?.LocationName,
        delivery: job.DeliveryTypeId,
        companyId: await resolveCompanyId(job.SubCompanyId),
        pkgUnit: job.WTUnitId,
        incoTerms: job.IncoTerms?.IncoCode,
        exRate: job.ExRateBuying,
        approved: job.ApprovedStatusId == 2 ? "true" : "false",
        canceled: false,
        cwtLine: "",
        cwtClient: "0",
        operation: "SE",
        arrivalDate: "",
        arrivalTime: "",
        departureDate: "",
        departureTime: "",
        createdAt: job.AddOn,
        updatedAt: job.EditOn?job.EditOn:job.AddOn,
        ClientId: Client?.id,
        VoyageId: voyage?.id,
        salesRepresentatorId: await resolveSalesRepId(job),   // resolved inline via Employees.climaxId
        overseasAgentId: OverseasAgent?.id,
        shippingLineId: ShippingLine?.id,
        localVendorId: LocalAgent?.id,
        customAgentId: CustomClearance?.id,
        transporterId: Transporter?.id,
        createdById: MIGRATION_USER_ID,   // env-driven; was a hardcoded UUID from one install
        commodityId: commodity?.id,
        consigneeId: Consignee?.id,
        forwarderId: Forwarder?.id,
        shipperId: Shipper?.id,
        vesselId: vessel.id,
        climaxId: job.Id,
      }

      const savedJob = await SE_Job.create(j, { fiscalYearCheck: false, transaction: t })

      jobs.push(j)

      
      if(job.SExp_SeaExportJob_Equipment?.length > 0){
        for(let equip of job.SExp_SeaExportJob_Equipment){
          await SE_Equipments.create({
            size: equip.EquipCode,
            qty: equip.Quantity,
            dg: equip.dDGNonDGId == 2 ? "non-DG" : "DG",
            gross: equip.Gen_EquipmentSizeType.PerUnitWeight,
            teu: equip.Gen_EquipmentSizeType.Teus,
            createdAt: job.AddOn,
            updatedAt: job.EditOn?job.EditOn:job.AddOn,
            SEJobId: savedJob.id,
          }, { silent: true, transaction: t })
        }
      }

      if(job.SExp_BL){
        let bl = job.SExp_BL
                let BL = {
          // Legacy B/L id, so this stage can be verified and re-run rather than
          // duplicating on a retry.
          climaxId: bl.Id,
          
          operation: "SE",
          hbl: bl.HBLNo,
          hblDate: bl.HBLDate,
          hblIssue: "",
          mbl: bl.MBLNo,
          mblDate: bl.MBLDate,
          status: bl.StatusId == 1 ? "Draft" : "Final", //find reference from climax then add
          blReleaseStatus: "Original", //find reference from climax then add
          blhandoverType: "By Hand", //find reference from climax then add
          releaseInstruction: "", //find reference from climax then add
          remarks: "", //find reference from climax then add
          sailingDate: bl.SailingDate,
          shipDate: job.SailingDate,
          shipperContent: formatAddress(bl.SExp_BL_Detail.Shipper),
          consigneeContent: formatAddress(bl.SExp_BL_Detail.Consignee),
          notifyOneContent: formatAddress(bl.SExp_BL_Detail.NotifyParty1),
          notifyTwoContent: formatAddress(bl.SExp_BL_Detail.NotifyParty2),
          deliveryContent: formatAddress(bl.SExp_BL_Detail.DeliveryAgent),
          marksContent: formatAddress(bl.SExp_BL_Detail.MarksAndNumber),
          marksContentTwo: "",
          noOfPckgs: bl.SExp_BL_Detail.NoOfPkgs,
          descOfGoodsContent: formatAddress(bl.SExp_BL_Detail.GoodsDescription),
          descOfGoodsContentTwo: "",
          grossWeightContent: formatAddress(bl.SExp_BL_Detail.GrossWeight),
          measurementContent: formatAddress(bl.SExp_BL_Detail.Measurement),
          AgentStamp: bl.SExp_BL_Detail.AgentStamp,
          hs: bl.SExp_BL_Detail.HSCode,
          onBoardDate: "",
          IssuePlace: bl.SExp_BL_Detail.PlaceOfIssue,
          IssueDate: bl.SExp_BL_Detail.PlaceOfIssueDate,
          poDeliveryTwo: bl.SExp_BL_Detail.PortOfDelivery,
          podTwo: bl.SExp_BL_Detail.PortOfDischarge,
          polTwo: bl.SExp_BL_Detail.PortOfLoading,
          agentM3: job.AgentM3,
          coloadM3: job.ColoadM3,
          noBls: bl.SExp_BL_Detail.NoOfOriginalBL,
          formE: bl.FormENumber,
          formEDate: bl.FormEDate,
          date1: "",
          date2: "",
          declareCarriage: "",
          declareCustoms: "",
          insurance: "",
          handlingInfo: "",
          toOne: "",
          toTwo: "",
          toThree: "",
          byOne: "",
          byTwo: "",
          byFirstCarrier: "",
          currency: "",
          charges: "",
          wtValPPC: "",
          wtVatCOLL: "",
          othersPPC: "",
          othersCOLL: "",
          ppWeightCharges: "0",
          ccWeightCharges: "0",
          ppvaluationCharges: "0",
          ccvaluationCharges: "0",
          ppTax: "0",
          ccTax: "0",
          ppOtherDueChargeAgent: "0",
          ccOtherDueChargeAgent: "0",
          ppOtherDueChargeCarrier: "0",
          ccOtherDueChargeCarrier: "0",
          ppTotal: "0",
          ccTotal: "0",
          applyToCWT: "0",
          createdAt: bl.AddOn,
          updatedAt: bl.EditOn?bl.EditOn:bl.AddOn,
          SEJobId: savedJob.id,
        }
  
        const savedBl = await Bl.create(BL, { transaction: t })
  
        if(bl.SExp_BL_Equipment?.length > 0){
          for(let e of bl.SExp_BL_Equipment){
            await Container_Info.create({
              no: e.ContainerNo,
              seal: e.SealNo,
              size: e.EquipCode,
              rategroup: e.RateGroup,
              gross: e.GrossWt,
              net: e.NetWt,
              tare: e.GrossWt - e.NetWt,
              wtUnit: e.WTUnitId == 2 ? "KGS" : "",
              cbm: e.CBM,
              pkgs: e.NoOfPackages,
              unit: e.UNPacking?.PackName || null,
              temp: e.Temperature,
              loadType: e.LoadTypeId == 2 ? "FULL" : "EMPTY",
              remarks: e.Remarks,
              detention: "",
              demurge: "",
              plugin: "",
              dg: e.dDGNonDGId == 2 ? "non-DG" : "DG",
              number: e.dFormENumber,
              date: bl.AddOn,
              top: e.OOG_TOP,
              right: e.OOG_RIGHT,
              left: e.OOG_LEFT,
              front: e.OOG_FRONT,
              back: e.OOG_BACK,
              createdAt: bl.AddOn,
              updatedAt: bl.EditOn?bl.EditOn:bl.AddOn,
              BlId: savedBl.id,
            }, { transaction: t })
          }
        }
  
        if(bl.SExp_BL_Stamp){
          for(let s of bl.SExp_BL_Stamp){
            await Stamps.create({
              code: s.Gen_Stamps?.StampCode,
              stamps: s.Gen_Stamps?.StampName,
              stamp_group: s.StampGroupId,
              createdAt: bl.AddOn,
              updatedAt: bl.EditOn?bl.EditOn:bl.AddOn,
              BlId: savedBl.id,
            }, { transaction: t })
          }
        }
      }
      // Was a full Child_Account.findAll (with an include) on EVERY job -
      // ten thousand complete chart-of-accounts reads for one map. Cached.
      const accountMap = await migrationCache.getAccountMap();
      const companyId = await resolveCompanyId(job.SubCompanyId);

      if(job.SeaExportJob_ChargesPayb){
        await UploadChargesPayb(job.SeaExportJob_ChargesPayb, job, savedJob, accountMap, companyId, t)
      }

      if(job.SeaExportJob_ChargesRecv){
        await UploadChargesRecv(job.SeaExportJob_ChargesRecv, job, savedJob, accountMap, companyId, t)
      }
          });
    }
    // createHistory(req.body.employeeId, 'Upload Job', 'Edit', result.name);
    res.json({
      status: "success", result: jobs, imported: jobs.length, skipped,
      cache: migrationCache.stats(),
      // Charge lines whose invoice the ledger stage had not created. Should be
      // zero - non-zero means the invoice feed and the job feed disagree.
      linkMisses: { invoices: linkMisses.invoices, samples: linkMisses.samples.slice() },
    });
  }catch(e){
    console.error(e)
    res.status(500).json({status:"error", result: e.toString() });
  }
})

const safeFindOne = async (model, id) => {
  if (id === null || id === undefined || id === '') return null;
  // Resolved from a prefetched index rather than a query per call. This one
  // function was responsible for 12 queries per job (9 Clients + Commodity +
  // Vessel + Voyage); on ten thousand jobs that is 120,000 round trips for
  // answers drawn from a few thousand distinct rows.
  //
  // model.name is the Sequelize model name, which is what the cache keys on.
  return migrationCache.findByLegacyId(model.name, id);
};

routes.post("/UploadSIJobs", SYSTEM, async (req, res) => {
  try{
    let jobs = []
    // Already-imported jobs are skipped rather than inserted twice.
    //
    // These receivers use plain create(), so a stage that died half way through
    // could not be retried - the only recovery was restoring the database.
    // Matching on climaxId (now indexed) makes every job stage re-runnable, and
    // `skipped` in the response tells you it happened rather than hiding it.
    let skipped = 0;
    resetLinkMisses();

    const existingJobs = new Set(
      (await SE_Job.findAll({ attributes: ['climaxId'], where: { climaxId: { [Op.ne]: null } } }))
        .map((j) => String(j.climaxId))
    );
    for(let job of req.body){
      if (job?.Id != null && existingJobs.has(String(job.Id))) { skipped++; continue; }

      // One transaction per job: the job, its equipment, B/L, containers,
      // stamps and charge lines all commit together or not at all.
      //
      // This is what makes the skip above safe. Without it, a batch that died
      // between creating the job row and creating its charges left a job that
      // existed but was incomplete - and the retry, seeing its climaxId,
      // skipped it, leaving it half-imported permanently. Rolling the job back
      // means a retry sees no climaxId and redoes it cleanly, so the skip only
      // ever applies to jobs that actually finished.
      await sequelize.transaction(async (t) => {
      const Client = await safeFindOne(Clients, job.ClientId)
      const OverseasAgent = await safeFindOne(Clients, job.OverseasAgentId)
      const LocalAgent = await safeFindOne(Clients, job.LocalAgentId)
      const CustomClearance = await safeFindOne(Clients, job.CustomClearanceId)
      const Transporter = await safeFindOne(Clients, job.TransporterId)
      const Forwarder = await safeFindOne(Clients, job.ForwarderId)
      const ShippingLine = await safeFindOne(Clients, job.ShippingLineId)
      const Consignee = await safeFindOne(Clients, job.ConsigneeId)
      const Shipper = await safeFindOne(Clients, job.ShipperId)
      const commodity = await safeFindOne(Commodity, job.CommodityId)
      const vessel = await safeFindOne(Vessel, job.VesselId)
      let voyage
      vessel ? voyage = await migrationCache.findVoyage(vessel.id, job.VoyageNo) : null

      let j = {
        jobNo: job.JobNumber,
        jobId: job.JobNumber.split("/")[0].split("-").pop(),
        customerRef: job.CustomerRefNo,
        fileNo: job.FileNumber,
        shipStatus: job.ShipmentStatusId == 1 ? "Shipped" : "Booked" ,
        teu: job.TEUS,
        bkg: job.BookingWeight,
        pcs: job.NoOfPackages,
        vol: job.Volume,
        volWeight: job.Weight,
        pol: job.PortOfLoadingCode,
        pod: job.PortOfDischargeCode,
        fd: job.PortOfFinalDestCode,
        dg: job.DGNonDGId == 1 ? "DG" : "non-DG",
        subType: job.SubTypeId == 3 ? "FCL" : "LCL",
        billVol: "",
        shpVol: job.Volume,
        weight: job.ActualWeight ?? job.Weight,
        weightUnit: job.WTUnitId,
        costCenter: job.CostCenter?.LOVCode,
        jobType: job.JobTypeId == 1 ? "Direct" : job.JobTypeId == 2 ? "Coloaded" : "Cross Trade",
        jobKind: job.JobKindId == 1 ? "Current" : "Opening",
        container: "",
        // 1 = Prepaid, 2 = Collect - see functions/jobMigrationPlan.js. Must be
        // the label: the id matches no option in Booking Info's select.
        freightType: job.FreightTypeId == 1 ? 'Prepaid'
          : job.FreightTypeId == 2 ? 'Collect'
          : null,
        // Not in the legacy book - see functions/jobMigrationPlan.js. A bare 1 is not one
        // of the options Booking Info offers, so it renders as a bare number.
        nomination: 'Free Hand',
        transportCheck: Transporter ? "Transport" : "", // ticked = HAS one; was inverted - see functions/jobMigrationPlan.js
        customCheck: CustomClearance ? "Custom Clearance" : "",
        etd: job.PlannedETD,
        eta: job.PlannedETA,
        aesDate: job.AESDateTime,
        eRcDate: job.ERecDateTime,
        eRlDate: job.ERLSDateTime,
        jobDate: job.JobDate,
        shipDate: job.SailingDate,
        doorMove: job.DoorMoveOnDate,
        cutOffDate: job.CutOffDateTime,
        siCutOoffDate: job.SICUTOFFDateTime,
        vgmCutOffDate: job.VGMCUTOFFDateTime,
        freightPaybleAt: job.FreightPayableAtCode,
        terminal: job?.Terminal?.LocationName,
        delivery: job.DeliveryTypeId,
        companyId: await resolveCompanyId(job.SubCompanyId),
        pkgUnit: job.WTUnitId,
        incoTerms: job.IncoTerms?.IncoCode,
        exRate: job.ExRateBuying,
        approved: job.ApprovedStatusId == 2 ? "true" : "false",
        canceled: false,
        cwtLine: "",
        cwtClient: "0",
        operation: "SI",
        arrivalDate: "",
        arrivalTime: "",
        departureDate: "",
        departureTime: "",
        createdAt: job.AddOn,
        updatedAt: job.EditOn?job.EditOn:job.AddOn,
        ClientId: Client?.id,
        VoyageId: voyage?.id,
        salesRepresentatorId: await resolveSalesRepId(job),   // resolved inline via Employees.climaxId
        overseasAgentId: OverseasAgent?.id,
        shippingLineId: ShippingLine?.id,
        localVendorId: LocalAgent?.id,
        customAgentId: CustomClearance?.id,
        transporterId: Transporter?.id,
        createdById: MIGRATION_USER_ID,   // env-driven; was a hardcoded UUID from one install
        commodityId: commodity?.id,
        consigneeId: Consignee?.id,
        forwarderId: Forwarder?.id,
        shipperId: Shipper?.id,
        vesselId: vessel.id,
        climaxId: job.Id,
      }

      const savedJob = await SE_Job.create(j, { fiscalYearCheck: false, transaction: t })

      jobs.push(j)

      
      if(job.SImp_SeaImportJob_Equipment?.length > 0){
        for(let equip of job.SImp_SeaImportJob_Equipment){
          await SE_Equipments.create({
            size: equip.EquipCode,
            qty: equip.Quantity,
            dg: equip.dDGNonDGId == 2 ? "non-DG" : "DG",
            gross: equip.Gen_EquipmentSizeType.PerUnitWeight,
            teu: equip.Gen_EquipmentSizeType.Teus,
            createdAt: job.AddOn,
            updatedAt: job.EditOn?job.EditOn:job.AddOn,
            SEJobId: savedJob.id,
          }, { silent: true, transaction: t })
        }
      }

      if(job.SImp_BL){
        let bl = job.SImp_BL
                let BL = {
          // Legacy B/L id, so this stage can be verified and re-run rather than
          // duplicating on a retry.
          climaxId: bl.Id,
          
          operation: "SI",
          hbl: bl.HBLNo,
          hblDate: bl.HBLDate,
          hblIssue: "",
          mbl: bl.MBLNo,
          mblDate: bl.MBLDate,
          status: bl.StatusId == 1 ? "Draft" : "Final", //find reference from climax then add
          blReleaseStatus: "Original", //find reference from climax then add
          blhandoverType: "By Hand", //find reference from climax then add
          releaseInstruction: "", //find reference from climax then add
          remarks: "", //find reference from climax then add
          sailingDate: bl.SailingDate,
          shipDate: job.SailingDate,
          shipperContent: formatAddress(bl.SImp_BL_Detail.Shipper),
          consigneeContent: formatAddress(bl.SImp_BL_Detail.Consignee),
          notifyOneContent: formatAddress(bl.SImp_BL_Detail.NotifyParty1),
          notifyTwoContent: formatAddress(bl.SImp_BL_Detail.NotifyParty2),
          deliveryContent: formatAddress(bl.SImp_BL_Detail.DeliveryAgent),
          marksContent: formatAddress(bl.SImp_BL_Detail.MarksAndNumber),
          marksContentTwo: "",
          noOfPckgs: bl.SImp_BL_Detail.NoOfPkgs,
          descOfGoodsContent: formatAddress(bl.SImp_BL_Detail.GoodsDescription),
          descOfGoodsContentTwo: "",
          grossWeightContent: formatAddress(bl.SImp_BL_Detail.GrossWeight),
          measurementContent: formatAddress(bl.SImp_BL_Detail.Measurement),
          AgentStamp: bl.SImp_BL_Detail.AgentStamp,
          hs: bl.SImp_BL_Detail.HSCode,
          onBoardDate: "",
          IssuePlace: bl.SImp_BL_Detail.PlaceOfIssue,
          IssueDate: bl.SImp_BL_Detail.PlaceOfIssueDate,
          poDeliveryTwo: bl.SImp_BL_Detail.PortOfDelivery,
          podTwo: bl.SImp_BL_Detail.PortOfDischarge,
          polTwo: bl.SImp_BL_Detail.PortOfLoading,
          agentM3: job.AgentM3,
          coloadM3: job.ColoadM3,
          noBls: bl.SImp_BL_Detail.NoOfOriginalBL,
          formE: bl.FormENumber,
          formEDate: bl.FormEDate,
          date1: "",
          date2: "",
          declareCarriage: "",
          declareCustoms: "",
          insurance: "",
          handlingInfo: "",
          toOne: "",
          toTwo: "",
          toThree: "",
          byOne: "",
          byTwo: "",
          byFirstCarrier: "",
          currency: "",
          charges: "",
          wtValPPC: "",
          wtVatCOLL: "",
          othersPPC: "",
          othersCOLL: "",
          ppWeightCharges: "0",
          ccWeightCharges: "0",
          ppvaluationCharges: "0",
          ccvaluationCharges: "0",
          ppTax: "0",
          ccTax: "0",
          ppOtherDueChargeAgent: "0",
          ccOtherDueChargeAgent: "0",
          ppOtherDueChargeCarrier: "0",
          ccOtherDueChargeCarrier: "0",
          ppTotal: "0",
          ccTotal: "0",
          applyToCWT: "0",
          createdAt: bl.AddOn,
          updatedAt: bl.EditOn?bl.EditOn:bl.AddOn,
          SEJobId: savedJob.id,
        }
  
        const savedBl = await Bl.create(BL, { transaction: t })
      }
      // Was a full Child_Account.findAll (with an include) on EVERY job -
      // ten thousand complete chart-of-accounts reads for one map. Cached.
      const accountMap = await migrationCache.getAccountMap();
      const companyId = await resolveCompanyId(job.SubCompanyId);

      if(job.SeaExportJob_ChargesPayb){
        await UploadChargesPayb(job.SeaExportJob_ChargesPayb, job, savedJob, accountMap, companyId, t)
      }

      if(job.SeaExportJob_ChargesRecv){
        await UploadChargesRecv(job.SeaExportJob_ChargesRecv, job, savedJob, accountMap, companyId, t)
      }
          });
    }
    
    res.json({
      status: "success", result: jobs, imported: jobs.length, skipped,
      cache: migrationCache.stats(),
      // Charge lines whose invoice the ledger stage had not created. Should be
      // zero - non-zero means the invoice feed and the job feed disagree.
      linkMisses: { invoices: linkMisses.invoices, samples: linkMisses.samples.slice() },
    });
  }catch(e){
    console.error(e)
    res.status(500).json({status:"error", result: e.toString() });
  }
})

/**
 * Invoices the job payload referenced that the ledger stage had not created.
 *
 * Non-zero means the two legacy feeds disagree: /voucher/getAll returned every
 * GL_Invoices row, so a job charge pointing at an invoice that is not there is
 * a real gap, not a normal condition. Reset per request, returned in the
 * response, and surfaced by the migration stage gate.
 */
const linkMisses = { invoices: 0, samples: [] };
function resetLinkMisses() {
  linkMisses.invoices = 0;
  linkMisses.samples.length = 0;
}

const UploadChargesPayb = async (Charge, job, savedJob, accountMap, companyId, transaction) => {
  try{
    for(let CP of Charge){
    const charge = await migrationCache.findByLegacyId('Charges', CP.ChargesId)
    let party = await safeFindOne(Clients, CP.VendorId)
    let invoice_id
    let invoiceType
    let partyType
    let invoice
    if(CP.GL_JobBill_Charges){
      invoice_id = CP.GL_JobBill_Charges?.JobBill?.Invoice?.InvoiceNumber
      invoiceType = "Job Bill"
      partyType = "vendor"
      invoice = await safeFindOne(Invoice, CP.GL_JobBill_Charges.JobBill.Invoice.Id.toString())
    }else if(CP.GL_AgentInvoice_Charges){
      invoice_id = CP.GL_AgentInvoice_Charges?.Agent_Invoice?.Invoice?.InvoiceNumber
      invoiceType = "Agent Invoice"
      partyType = "agent"
      invoice = await safeFindOne(Invoice, CP.GL_AgentInvoice_Charges.Agent_Invoice.Invoice.Id.toString()) 
    }
        let ChargeP = {
      // Legacy charge-line id - same reason as the B/L above.
      climaxId: CP.Id,
      
      charge: charge?.id,
      particular: charge?.name,
      invoice_id: invoice_id,
      description: CP.Description,
      name: CP.Vendor.PartyName,
      partyId: party.id,
      invoiceType: invoiceType,
      type: "Payble",
      basis: CP.Charges.PerUnitFixedId == 1 ? "Per Unit" : "Per Shipment",
      pp_cc: CP.PPCCId == 1 ? "PP" : "CC",
      size_type: CP.EquipCode,
      dg_type: job.DGNonDGId == 1 ? "DG" : "non-DG",
      qty: CP.Quantity,
      rate_charge: CP.Rate,
      currency: CP.Currency.CurrencyCode,
      amount: "1",
      discount: CP.DiscountAmount,
      taxPerc: 0,
      tax_apply: CP.TaxAmount > 0 ? true : false,
      tax_amount: CP.TaxAmount,
      net_amount: CP.NetAmount,
      ex_rate: CP.ExchRateLine,
      local_amount: CP.LocalAmount,
      status: 1,
      approved_by: "",
      approved_date: "",
      partyType: partyType,
      InvoiceId: invoice?.id,
      SEJobId: savedJob.id,
    }

    const savedCP = await Charge_Head.create(ChargeP, { transaction })

    // Point the invoice back at this job.
    //
    // Invoices are imported before jobs, because charge lines have to be able
    // to look their invoice up - so /importI cannot resolve SEJobId itself,
    // there are no jobs yet when it runs. This is the first moment both ids are
    // known, and the charge line linking them is the evidence for it.
    //
    // Only fills a null, so a job that legitimately shares an invoice with
    // another job cannot silently steal it from whichever job got there first.
    if (invoice?.id && savedJob?.id && invoice.SEJobId == null) {
      await Invoice.update(
        { SEJobId: savedJob.id },
        { where: { id: invoice.id, SEJobId: null }, silent: true, transaction }
      );
      invoice.SEJobId = savedJob.id;
    }

    // LINK ONLY - this no longer creates invoices or vouchers.
    //
    // The ledger stage creates every invoice and voucher from GL_Invoices and
    // GL_Voucher, which the legacy API returns unfiltered, so anything this
    // payload references already exists by the time jobs run. This block used
    // to create them when the lookup missed, which made it a second writer for
    // those rows with a different field mapping again - its voucher heads got
    // the raw sub-category in accountType where every other path stores the
    // classified bucket the app actually reads.
    //
    // A miss now means the two legacy feeds disagree. That is worth seeing, so
    // it is counted and returned rather than papered over.
    if (CP.GL_JobBill_Charges?.JobBill?.Invoice) {
      if (invoice?.id) {
        if (savedCP.InvoiceId == null) {
          await savedCP.update({ InvoiceId: invoice.id }, { transaction });
        }
      } else {
        linkMisses.invoices++;
        linkMisses.samples.length < 10 &&
          linkMisses.samples.push(CP.GL_JobBill_Charges?.JobBill?.Invoice?.InvoiceNumber);
      }
    }

    // LINK ONLY - this no longer creates invoices or vouchers.
    //
    // The ledger stage creates every invoice and voucher from GL_Invoices and
    // GL_Voucher, which the legacy API returns unfiltered, so anything this
    // payload references already exists by the time jobs run. This block used
    // to create them when the lookup missed, which made it a second writer for
    // those rows with a different field mapping again - its voucher heads got
    // the raw sub-category in accountType where every other path stores the
    // classified bucket the app actually reads.
    //
    // A miss now means the two legacy feeds disagree. That is worth seeing, so
    // it is counted and returned rather than papered over.
    if (CP.GL_AgentInvoice_Charges?.Agent_Invoice?.Invoice) {
      if (invoice?.id) {
        if (savedCP.InvoiceId == null) {
          await savedCP.update({ InvoiceId: invoice.id }, { transaction });
        }
      } else {
        linkMisses.invoices++;
        linkMisses.samples.length < 10 &&
          linkMisses.samples.push(CP.GL_AgentInvoice_Charges?.Agent_Invoice?.Invoice?.InvoiceNumber);
      }
    }
  }
}catch(e){
  console.error(e)
}
}

const UploadChargesRecv = async (Charge, job, savedJob, accountMap, companyId, transaction) => {
  try{
    for (let CP of Charge) {

    const charge = await Charges.findOne({ where: { code: CP.ChargesId } });

    let party = await Clients.findOne({
      where: { climaxId: CP.Customer.Id }
    });

    let invoice_id;
    let invoiceType;
    let partyType;
    let invoice;

    /* ---------------- Invoice Detection ---------------- */

    if (CP.GL_JobInvoice_Charges) {
      invoice_id = CP.GL_JobInvoice_Charges?.JobInvoice?.Invoice?.InvoiceNumber;
      invoiceType = "Job Invoice";
      partyType = "client";
      invoice = await Invoice.findOne({
        where: {
          climaxId: CP.GL_JobInvoice_Charges?.JobInvoice?.Invoice?.Id.toString()
        }
      });
    }
    else if (CP.GL_AgentInvoice_Charges) {
      invoice_id = CP.GL_AgentInvoice_Charges?.Agent_Invoice?.Invoice?.InvoiceNumber;
      invoiceType = "Agent Invoice";
      partyType = "agent";
      invoice = await Invoice.findOne({
        where: {
          climaxId: CP.GL_AgentInvoice_Charges.Agent_Invoice.Invoice.Id.toString()
        }
      });
    }

    /* ---------------- Charge Head ---------------- */

    const ChargeP = {
      // Legacy charge-line id, so the receivable side is verifiable and
      // re-runnable in the same way as the payable side.
      climaxId: CP.Id,
      charge: charge?.id,
      particular: charge?.name,
      invoice_id,
      description: CP.Description,
      name: CP.Customer.PartyName,
      partyId: party.id,
      invoiceType,
      type: "Recievable",
      basis: CP.Charges.PerUnitFixedId == 1 ? "Per Unit" : "Per Shipment",
      pp_cc: CP.PPCCId == 1 ? "PP" : "CC",
      size_type: CP.EquipCode,
      dg_type: job.DGNonDGId == 1 ? "DG" : "non-DG",
      qty: CP.Quantity,
      rate_charge: CP.Rate,
      currency: CP.Currency.CurrencyCode,
      amount: "1",
      discount: CP.DiscountAmount,
      taxPerc: 0,
      tax_apply: CP.TaxAmount > 0,
      tax_amount: CP.TaxAmount,
      net_amount: CP.NetAmount,
      ex_rate: CP.ExchRateClient,
      local_amount: CP.LocalAmount,
      status: 1,
      approved_by: "",
      approved_date: "",
      partyType,
      InvoiceId: invoice?.id,
      SEJobId: savedJob.id
    };

    const savedCP = await Charge_Head.create(ChargeP, { transaction });

    // Point the invoice back at this job.
    //
    // Invoices are imported before jobs, because charge lines have to be able
    // to look their invoice up - so /importI cannot resolve SEJobId itself,
    // there are no jobs yet when it runs. This is the first moment both ids are
    // known, and the charge line linking them is the evidence for it.
    //
    // Only fills a null, so a job that legitimately shares an invoice with
    // another job cannot silently steal it from whichever job got there first.
    if (invoice?.id && savedJob?.id && invoice.SEJobId == null) {
      await Invoice.update(
        { SEJobId: savedJob.id },
        { where: { id: invoice.id, SEJobId: null }, silent: true, transaction }
      );
      invoice.SEJobId = savedJob.id;
    }

    // LINK ONLY - this no longer creates invoices or vouchers.
    //
    // The ledger stage creates every invoice and voucher from GL_Invoices and
    // GL_Voucher, which the legacy API returns unfiltered, so anything this
    // payload references already exists by the time jobs run. This block used
    // to create them when the lookup missed, which made it a second writer for
    // those rows with a different field mapping again - its voucher heads got
    // the raw sub-category in accountType where every other path stores the
    // classified bucket the app actually reads.
    //
    // A miss now means the two legacy feeds disagree. That is worth seeing, so
    // it is counted and returned rather than papered over.
    if (CP.GL_JobInvoice_Charges?.JobInvoice?.Invoice) {
      if (invoice?.id) {
        if (savedCP.InvoiceId == null) {
          await savedCP.update({ InvoiceId: invoice.id }, { transaction });
        }
      } else {
        linkMisses.invoices++;
        linkMisses.samples.length < 10 &&
          linkMisses.samples.push(CP.GL_JobInvoice_Charges?.JobInvoice?.Invoice?.InvoiceNumber);
      }
    }
  }
}catch(e){
  console.error("Error", e)
}
};


routes.post("/UploadAEJobs", SYSTEM, async (req, res) => {
  try{
    let jobs = []
    // Already-imported jobs are skipped rather than inserted twice.
    //
    // These receivers use plain create(), so a stage that died half way through
    // could not be retried - the only recovery was restoring the database.
    // Matching on climaxId (now indexed) makes every job stage re-runnable, and
    // `skipped` in the response tells you it happened rather than hiding it.
    let skipped = 0;
    resetLinkMisses();

    const existingJobs = new Set(
      (await SE_Job.findAll({ attributes: ['climaxId'], where: { climaxId: { [Op.ne]: null } } }))
        .map((j) => String(j.climaxId))
    );

    for(let job of req.body){
      if (job?.Id != null && existingJobs.has(String(job.Id))) { skipped++; continue; }

      // One transaction per job: the job, its equipment, B/L, containers,
      // stamps and charge lines all commit together or not at all.
      //
      // This is what makes the skip above safe. Without it, a batch that died
      // between creating the job row and creating its charges left a job that
      // existed but was incomplete - and the retry, seeing its climaxId,
      // skipped it, leaving it half-imported permanently. Rolling the job back
      // means a retry sees no climaxId and redoes it cleanly, so the skip only
      // ever applies to jobs that actually finished.
      await sequelize.transaction(async (t) => {

      const Client = await safeFindOne(Clients, job.ClientId);
      const AirLine = await safeFindOne(Clients, job.AirLineId);
      const OverseasAgent = await safeFindOne(Clients, job.OverseasAgentId);
      const LocalAgent = await safeFindOne(Clients, job.LocalVendorId);
      const CustomClearance = await safeFindOne(Clients, job.CustomClearanceId);
      const Transporter = await safeFindOne(Clients, job.TransporterId);
      const Forwarder = await safeFindOne(Clients, job.ForwarderId);
      const ShippingLine = await safeFindOne(Clients, job.ShippingLineId);
      const Consignee = await safeFindOne(Clients, job.ConsigneeId);
      const Shipper = await safeFindOne(Clients, job.ShipperId);
      const commodity = await safeFindOne(Commodity, job.CommodityId);

      let j = {
        jobNo: job.JobNumber,
        jobId: job.JobNumber.split("/")[0].split("-").pop(),
        customerRef: job.CustomerRefNo,
        fileNo: job.FileNumber,
        shipStatus: job.ShipmentStatusId == 1 ? "Shipped" : "Booked" ,
        teu: job.TEUS,
        bkg: job.BookingWeight,
        pcs: job.NoOfPackages,
        vol: job.Volume,
        volWeight: job.Weight,
        pol: job.AirPortOfLoading?.AirportCode || job.PortOfLoading?.UNLocCode || "",
        pod: job.AirPortOfDischarge?.AirportCode || job.PortOfDischarge?.UNLocCode || "",
        fd: job.FinalDestination?.UNLocName,
        dg: job.DGNonDGId == 1 ? "DG" : "non-DG",
        subType: job.SubTypeId == 3 ? "FCL" : "LCL",
        billVol: "",
        shpVol: job.Volume,
        weight: job.ActualWeight ?? job.Weight,
        weightUnit: job.WTUnitId,
        costCenter: job.CostCenter?.LOVCode,
        jobType: job.JobTypeId == 1 ? "Direct" : job.JobTypeId == 2 ? "Coloaded" : "Cross Trade",
        jobKind: job.JobKindId == 1 ? "Current" : "Opening",
        container: "",
        // 1 = Prepaid, 2 = Collect - see functions/jobMigrationPlan.js. Must be
        // the label: the id matches no option in Booking Info's select.
        freightType: job.FreightTypeId == 1 ? 'Prepaid'
          : job.FreightTypeId == 2 ? 'Collect'
          : null,
        // Not in the legacy book - see functions/jobMigrationPlan.js. A bare 1 is not one
        // of the options Booking Info offers, so it renders as a bare number.
        nomination: 'Free Hand',
        transportCheck: Transporter ? "Transport" : "", // ticked = HAS one; was inverted - see functions/jobMigrationPlan.js
        customCheck: CustomClearance ? "Custom Clearance" : "",
        etd: job.PlannedETD,
        eta: job.PlannedETA,
        aesDate: job.AESDateTime,
        eRcDate: job.ERecDateTime,
        eRlDate: job.ERLSDateTime,
        jobDate: job.JobDate,
        shipDate: job.SailingDate,
        doorMove: job.DoorMoveOnDate,
        cutOffDate: job.CutOffDateTime,
        siCutOoffDate: job.SICUTOFFDateTime,
        vgmCutOffDate: job.VGMCUTOFFDateTime,
        freightPaybleAt: job.FreightPayableAt?.UNLocName,
        terminal: job?.Terminal?.LocationName,
        delivery: job.DeliveryTypeId,
        companyId: await resolveCompanyId(job.SubCompanyId),
        pkgUnit: job.WTUnitId,
        incoTerms: job.IncoTerms?.IncoCode,
        exRate: job.ExRateBuying,
        approved: job.ApprovedStatusId == 2 ? "true" : "false",
        canceled: false,
        // Air-specific. These were literal ""/"0" and then overwritten by the
        // /seaJob/fixAirJobs pass; the payload already carries the real values.
        cwtLine: job.ChargeableWeightLine ?? "",
        cwtClient: job.ChargeableWeightClient ?? "0",
        operation: "AE",
        arrivalDate: job.ArrivalDate ?? "",
        arrivalTime: job.ArrivalTime ?? "",
        departureDate: job.DepartureDate ?? "",
        departureTime: job.DepartureTime ?? "",
        createdAt: job.AddOn,
        updatedAt: job.EditOn?job.EditOn:job.AddOn,
        ClientId: Client?.id,
        salesRepresentatorId: await resolveSalesRepId(job),   // resolved inline via Employees.climaxId
        overseasAgentId: OverseasAgent?.id,
        shippingLineId: ShippingLine?.id,
        localVendorId: LocalAgent?.id,
        customAgentId: CustomClearance?.id,
        transporterId: Transporter?.id,
        createdById: MIGRATION_USER_ID,   // env-driven; was a hardcoded UUID from one install
        commodityId: commodity?.id,
        consigneeId: Consignee?.id,
        forwarderId: Forwarder?.id,
        shipperId: Shipper?.id,
        airLineId: AirLine?.id,
        climaxId: job.Id,
        flightNo: job.FlightNo,
      }

      const savedJob = await SE_Job.create(j, { fiscalYearCheck: false, transaction: t })

      jobs.push(j)
      if(job.SExp_BL){

        let bl = job.SExp_BL

                let BL = {
          // Legacy B/L id, so this stage can be verified and re-run rather than
          // duplicating on a retry.
          climaxId: bl.Id,
          
          operation: "AE",
          hbl: bl.HAWBNo,

          hblDate: bl.HAWBDate,
          hblIssue: "",
          mbl: bl.MAWBNo,
          mblDate: bl.MAWBDate,
          status: bl.StatusId == 1 ? "Draft" : "Final", //find reference from climax then add
          blReleaseStatus: "Original", //find reference from climax then add
          blhandoverType: "By Hand", //find reference from climax then add
          releaseInstruction: "", //find reference from climax then add
          remarks: "", //find reference from climax then add
          sailingDate: bl.SailingDate,
          shipDate: job.SailingDate,
          shipperContent: formatAddress(bl.Shipper),
          consigneeContent: formatAddress(bl.Consignee),
          notifyOneContent: formatAddress(bl.NotifyParty1),
          notifyTwoContent: formatAddress(bl.NotifyParty2),
          deliveryContent: formatAddress(bl.DeliveryAgent),
          marksContent: formatAddress(bl.MarksAndNumber),
          marksContentTwo: "",
          noOfPckgs: bl.NoOfPkgs,
          descOfGoodsContent: formatAddress(bl.GoodsDescription),
          descOfGoodsContentTwo: "",
          grossWeightContent: formatAddress(bl.GrossWeight1),
          measurementContent: "",
          AgentStamp: "",
          hs: "",
          onBoardDate: "",
          IssuePlace: bl.PlaceOfIssue,
          IssueDate: bl.PlaceOfIssueDate,
          poDeliveryTwo: "",
          podTwo: "",
          polTwo: "",
          agentM3: job.AgentInstruction,
          coloadM3: "",
          noBls: bl.NoOfOriginalBL,
          formE: bl.FormENumber,
          formEDate: bl.FormEDate,
          date1: "",
          date2: "",
          declareCarriage: "",
          declareCustoms: "",
          insurance: "",
          handlingInfo: "",
          toOne: "",
          toTwo: "",
          toThree: "",
          byOne: "",
          byTwo: "",
          byFirstCarrier: "",
          currency: "",
          charges: "",
          wtValPPC: "",
          wtVatCOLL: "",
          othersPPC: "",
          othersCOLL: "",
          ppWeightCharges: "0",
          ccWeightCharges: "0",
          ppvaluationCharges: "0",
          ccvaluationCharges: "0",
          ppTax: "0",
          ccTax: "0",
          ppOtherDueChargeAgent: "0",
          ccOtherDueChargeAgent: "0",
          ppOtherDueChargeCarrier: "0",
          ccOtherDueChargeCarrier: "0",
          ppTotal: "0",
          ccTotal: "0",
          applyToCWT: "0",
          createdAt: bl.AddOn,
          updatedAt: bl.EditOn?bl.EditOn:bl.AddOn,
          SEJobId: savedJob.id,
        }
  
        const savedBl = await Bl.create(BL, { transaction: t })
      }
      // Was a full Child_Account.findAll (with an include) on EVERY job -
      // ten thousand complete chart-of-accounts reads for one map. Cached.
      const accountMap = await migrationCache.getAccountMap();
      const companyId = await resolveCompanyId(job.SubCompanyId);

      if(job.SeaExportJob_ChargesPayb){
        await UploadChargesPayb(job.SeaExportJob_ChargesPayb, job, savedJob, accountMap, companyId, t)
      }

      if(job.SeaExportJob_ChargesRecv){
        await UploadChargesRecv(job.SeaExportJob_ChargesRecv, job, savedJob, accountMap, companyId, t)
      }
          });
    }

    res.json({
      status: "success", result: jobs, imported: jobs.length, skipped,
      cache: migrationCache.stats(),
      // Charge lines whose invoice the ledger stage had not created. Should be
      // zero - non-zero means the invoice feed and the job feed disagree.
      linkMisses: { invoices: linkMisses.invoices, samples: linkMisses.samples.slice() },
    });
  }catch(e){
    console.error(e)
    res.status(500).json({status:"error", result: e.toString() });
  }
})

routes.post("/UploadAIJobs", SYSTEM, async (req, res) => {
  try{
    let jobs = []
    // Already-imported jobs are skipped rather than inserted twice.
    //
    // These receivers use plain create(), so a stage that died half way through
    // could not be retried - the only recovery was restoring the database.
    // Matching on climaxId (now indexed) makes every job stage re-runnable, and
    // `skipped` in the response tells you it happened rather than hiding it.
    let skipped = 0;
    resetLinkMisses();

    const existingJobs = new Set(
      (await SE_Job.findAll({ attributes: ['climaxId'], where: { climaxId: { [Op.ne]: null } } }))
        .map((j) => String(j.climaxId))
    );

    for(let job of req.body){
      if (job?.Id != null && existingJobs.has(String(job.Id))) { skipped++; continue; }

      // One transaction per job: the job, its equipment, B/L, containers,
      // stamps and charge lines all commit together or not at all.
      //
      // This is what makes the skip above safe. Without it, a batch that died
      // between creating the job row and creating its charges left a job that
      // existed but was incomplete - and the retry, seeing its climaxId,
      // skipped it, leaving it half-imported permanently. Rolling the job back
      // means a retry sees no climaxId and redoes it cleanly, so the skip only
      // ever applies to jobs that actually finished.
      await sequelize.transaction(async (t) => {

      const Client = await safeFindOne(Clients, job.ClientId);
      const AirLine = await safeFindOne(Clients, job.AirLineId);
      const OverseasAgent = await safeFindOne(Clients, job.OverseasAgentId);
      const LocalAgent = await safeFindOne(Clients, job.LocalAgentId);
      const CustomClearance = await safeFindOne(Clients, job.CustomClearanceId);
      const Transporter = await safeFindOne(Clients, job.TransporterId);
      const Forwarder = await safeFindOne(Clients, job.ForwarderId);
      const ShippingLine = await safeFindOne(Clients, job.ShippingLineId);
      const Consignee = await safeFindOne(Clients, job.ConsigneeId);
      const Shipper = await safeFindOne(Clients, job.ShipperId);
      const commodity = await safeFindOne(Commodity, job.CommodityId);

      let j = {
        jobNo: job.JobNumber,
        jobId: job.JobNumber.split("/")[0].split("-").pop(),
        customerRef: job.CustomerRefNo,
        fileNo: job.FileNumber,
        shipStatus: job.ShipmentStatusId == 1 ? "Shipped" : "Booked" ,
        teu: job.TEUS,
        bkg: job.BookingWeight,
        pcs: job.NoOfPackages,
        vol: job.Volume,
        volWeight: job.Weight,
        pol: job.AirPortOfLoading?.AirportCode || job.PortOfLoading?.UNLocCode || "",
        pod: job.AirPortOfDischarge?.AirportCode || job.PortOfDischarge?.UNLocCode || "",
        fd: job.PortOfFinalDest?.UNLocCode,
        dg: job.DGNonDGId == 1 ? "DG" : "non-DG",
        subType: job.SubTypeId == 3 ? "FCL" : "LCL",
        billVol: "",
        shpVol: job.Volume,
        weight: job.ActualWeight ?? job.Weight,
        weightUnit: job.WTUnitId,
        costCenter: job.CostCenter?.LOVCode,
        jobType: job.JobTypeId == 1 ? "Direct" : job.JobTypeId == 2 ? "Coloaded" : "Cross Trade",
        jobKind: job.JobKindId == 1 ? "Current" : "Opening",
        container: "",
        // 1 = Prepaid, 2 = Collect - see functions/jobMigrationPlan.js. Must be
        // the label: the id matches no option in Booking Info's select.
        freightType: job.FreightTypeId == 1 ? 'Prepaid'
          : job.FreightTypeId == 2 ? 'Collect'
          : null,
        // Not in the legacy book - see functions/jobMigrationPlan.js. A bare 1 is not one
        // of the options Booking Info offers, so it renders as a bare number.
        nomination: 'Free Hand',
        transportCheck: Transporter ? "Transport" : "", // ticked = HAS one; was inverted - see functions/jobMigrationPlan.js
        customCheck: CustomClearance ? "Custom Clearance" : "",
        etd: job.PlannedETD,  
        eta: job.PlannedETA,
        aesDate: job.AESDateTime,
        eRcDate: job.ERecDateTime,
        eRlDate: job.ERLSDateTime,
        jobDate: job.JobDate,
        shipDate: job.SailingDate,
        doorMove: job.DoorMoveOnDate,
        cutOffDate: job.CutOffDateTime,
        siCutOoffDate: job.SICUTOFFDateTime,
        vgmCutOffDate: job.VGMCUTOFFDateTime,
        freightPaybleAt: job.FreightPayableAt?.UNLocName,
        terminal: job?.Terminal?.LocationName,
        delivery: job.DeliveryTypeId,
        companyId: await resolveCompanyId(job.SubCompanyId),
        pkgUnit: job.WTUnitId,
        incoTerms: job.IncoTerms?.IncoCode,
        exRate: job.ExRateBuying,
        approved: job.ApprovedStatusId == 2 ? "true" : "false",
        canceled: false,
        // Air-specific. These were literal ""/"0" and then overwritten by the
        // /seaJob/fixAirJobs pass; the payload already carries the real values.
        cwtLine: job.ChargeableWeightLine ?? "",
        cwtClient: job.ChargeableWeightClient ?? "0",
        operation: "AI",
        arrivalDate: job.ArrivalDate ?? "",
        arrivalTime: job.ArrivalTime ?? "",
        departureDate: job.DepartureDate ?? "",
        departureTime: job.DepartureTime ?? "",
        createdAt: job.AddOn,
        updatedAt: job.EditOn?job.EditOn:job.AddOn,
        ClientId: Client?.id,
        salesRepresentatorId: await resolveSalesRepId(job),   // resolved inline via Employees.climaxId
        overseasAgentId: OverseasAgent?.id,
        shippingLineId: ShippingLine?.id,
        localVendorId: LocalAgent?.id,
        customAgentId: CustomClearance?.id,
        transporterId: Transporter?.id,
        createdById: MIGRATION_USER_ID,   // env-driven; was a hardcoded UUID from one install
        commodityId: commodity?.id,
        consigneeId: Consignee?.id,
        forwarderId: Forwarder?.id,
        shipperId: Shipper?.id,
        airLineId: AirLine?.id,
        climaxId: job.Id,
        flightNo: job.FlightNo,
      }

      const savedJob = await SE_Job.create(j, { fiscalYearCheck: false, transaction: t })

      jobs.push(j)
      if(job.SExp_BL){

        let bl = job.SExp_BL

                let BL = {
          // Legacy B/L id, so this stage can be verified and re-run rather than
          // duplicating on a retry.
          climaxId: bl.Id,
          
          operation: "AI",
          hbl: bl.HAWBNo,
          hblDate: bl.HAWBDate,
          hblIssue: "",
          mbl: bl.MAWBNo,
          mblDate: bl.MAWBDate,
          status: bl.StatusId == 1 ? "Draft" : "Final", //find reference from climax then add
          blReleaseStatus: "Original", //find reference from climax then add
          blhandoverType: "By Hand", //find reference from climax then add
          releaseInstruction: "", //find reference from climax then add
          remarks: "", //find reference from climax then add
          sailingDate: bl.SailingDate,
          shipDate: job.SailingDate,
          shipperContent: formatAddress(bl.Shipper),
          consigneeContent: formatAddress(bl.Consignee),
          notifyOneContent: formatAddress(bl.NotifyParty1),
          notifyTwoContent: formatAddress(bl.NotifyParty2),
          deliveryContent: formatAddress(bl.DeliveryAgent),
          marksContent: formatAddress(bl.MarksAndNumber),
          marksContentTwo: "",
          noOfPckgs: bl.NoOfPkgs,
          descOfGoodsContent: formatAddress(bl.GoodsDescription),
          descOfGoodsContentTwo: "",
          grossWeightContent: formatAddress(bl.GrossWeight1),
          measurementContent: "",
          AgentStamp: "",
          hs: "",
          onBoardDate: "",
          IssuePlace: bl.PlaceOfIssue,
          IssueDate: bl.PlaceOfIssueDate,
          poDeliveryTwo: "",
          podTwo: "",
          polTwo: "",
          agentM3: job.AgentInstruction,
          coloadM3: "",
          noBls: bl.NoOfOriginalBL,
          formE: bl.FormENumber,
          formEDate: bl.FormEDate,
          date1: "",
          date2: "",
          declareCarriage: "",
          declareCustoms: "",
          insurance: "",
          handlingInfo: "",
          toOne: "",
          toTwo: "",
          toThree: "",
          byOne: "",
          byTwo: "",
          byFirstCarrier: "",
          currency: "",
          charges: "",
          wtValPPC: "",
          wtVatCOLL: "",
          othersPPC: "",
          othersCOLL: "",
          ppWeightCharges: "0",
          ccWeightCharges: "0",
          ppvaluationCharges: "0",
          ccvaluationCharges: "0",
          ppTax: "0",
          ccTax: "0",
          ppOtherDueChargeAgent: "0",
          ccOtherDueChargeAgent: "0",
          ppOtherDueChargeCarrier: "0",
          ccOtherDueChargeCarrier: "0",
          ppTotal: "0",
          ccTotal: "0",
          applyToCWT: "0",
          createdAt: bl.AddOn,
          updatedAt: bl.EditOn?bl.EditOn:bl.AddOn,
          SEJobId: savedJob.id,
        }
  
        const savedBl = await Bl.create(BL, { transaction: t })
      }
      // Was a full Child_Account.findAll (with an include) on EVERY job -
      // ten thousand complete chart-of-accounts reads for one map. Cached.
      const accountMap = await migrationCache.getAccountMap();
      const companyId = await resolveCompanyId(job.SubCompanyId);

      if(job.SeaExportJob_ChargesPayb){
        await UploadChargesPayb(job.SeaExportJob_ChargesPayb, job, savedJob, accountMap, companyId, t)
      }

      if(job.SeaExportJob_ChargesRecv){
        await UploadChargesRecv(job.SeaExportJob_ChargesRecv, job, savedJob, accountMap, companyId, t)
      }
          });
    }

    res.json({
      status: "success", result: jobs, imported: jobs.length, skipped,
      cache: migrationCache.stats(),
      // Charge lines whose invoice the ledger stage had not created. Should be
      // zero - non-zero means the invoice feed and the job feed disagree.
      linkMisses: { invoices: linkMisses.invoices, samples: linkMisses.samples.slice() },
    });
  }catch(e){
    console.error(e)
    res.status(500).json({status:"error", result: e.toString() });
  }
})

routes.post("/linkCharges", async (req, res) => {
  try{
    const charges = await Charge_Head.findAll({
      where: {
        InvoiceId: null
      }
    })
    for(let CP of charges){
      const invoice = await Invoice.findOne({
        where: {
          invoice_No: CP.invoice_id
        }
      })
      if(invoice){
        await CP.update({InvoiceId:invoice.id})
      }
    }
    res.json({ status: "success" });
  }catch(e){
    console.error(e)
    res.status(500).json({status:"error", result: e.toString() });
  }
})

routes.post("/fixAirJobs", async (req, res) => {
  let i = 0
  try{
    const AirImportJob = req.body.AirImportJob
    const AirExportJob = req.body.AirExportJob
    const UNLocation = req.body.UNLocation
    const AExp_BL = req.body.BL
    const UNAirport = req.body.UNAirport

    const clients = await Clients.findAll({
      attributes: ['id', 'climaxId'],
      raw: true, // returns plain objects instead of model instances
    });

    const IdtoShortCOde = new Map(
      UNAirport.map(l => [l.Id, l.AirportCode])
    )
    
    const climaxToId = new Map(
      clients
      .filter(c => c.climaxId != null) // exclude null/undefined
      .map(c => [c.climaxId, c.id])
    );
    
    const commodities = await Commodity.findAll({
      attributes: ['id', 'climaxId'],
      raw: true, // returns plain objects instead of model instances
    });

    const climaxToCommodityId = new Map(
      commodities
        .filter(c => c.climaxId != null) // exclude null/undefined
        .map(c => [c.climaxId, c.id])
    );

    const fdMap = new Map(
      UNLocation.map(l => [l.UNLocCode, l.UNLocName])
    )

    for(let job of AirExportJob){
      i++
      const localVendor = climaxToId.get(job.LocalVendorId)
      
      const [affected] = await SE_Job.update(
        {
          flightNo: job.FlightNo,
          localVendorId: localVendor,
          cwtLine: job.ChargeableWeightLine,
          cwtClient: job.ChargeableWeightClient,
          weight: job.ActualWeight,
          fd: fdMap.get(job.FinalDestinationCode),
          commodityId: climaxToCommodityId.get(parseInt(job.CommodityId)),
          departureDate: job.DepartureDate,
          departureTime: job.DepartureTime,
          arrivalDate: job.ArrivalDate,
          arrivalTime: job.ArrivalTime,
          pol: IdtoShortCOde.get(job.AirPortOfLoadingId),
          pod: IdtoShortCOde.get(job.AirPortOfDischargeId)
        },
        {
          where: { climaxId: job.Id },
        }
      );

      if (affected === 0) {
        console.warn(`No SE_Job found for climaxId=${job.Id}`);
      }
    }

    for(let job of AirImportJob){
      const localVendor = climaxToId.get(job.LocalVendorId)
      const commodity = climaxToCommodityId.get(parseInt(job.CommodityId))

      const [affected] = await SE_Job.update(
        {
          flightNo: job.FlightNo,
          localVendorId: localVendor,
          cwtLine: job.ChargeableWeightLine,
          cwtClient: job.ChargeableWeightClient,
          weight: job.ActualWeight,
          commodityId: commodity,
          departureDate: job.DepartureDate,
          // departureTime: job.DepartureTime,
          arrivalDate: job.ArrivalDate,
          arrivalTime: job.ArrivalTime,
          pol: IdtoShortCOde.get(job.AirPortOfLoadingId),
          pod: IdtoShortCOde.get(job.AirPortOfDischargeId)
        },
        {
          where: { climaxId: job.Id },
        }
      );

      if (affected === 0) {
        // Nothing matched the where clause
        console.warn(`No SE_Job found for climaxId=${job.Id}`);
      }
    }

    res.status(200).json({ status: 'success', result: req.body.length })
  }catch(e){
    console.error(e)
    res.status(500).json({ status: 'error', result: e.message})
  }
})

routes.post("/fixSeaJobs", async (req, res) => {
  let i = 0
  try{
    const SeaExportJob = req.body.SeaExportJob
    const SeaImportJob = req.body.SeaImportJob
    const UNLocation = req.body.UNLocation

    const commodities = await Commodity.findAll({
      attributes: ['id', 'climaxId'],
      raw: true, // returns plain objects instead of model instances
    });
    
    const climaxToCommodityId = new Map(
      commodities
        .filter(c => c.climaxId != null) // exclude null/undefined
        .map(c => [c.climaxId, c.id])
    );

    const clients = await Clients.findAll({
      attributes: ['id', 'climaxId'],
      // raw: true, // returns plain objects instead of model instances
    });

    const climaxToId = new Map(
      clients
        .filter(c => c.climaxId != null) // exclude null/undefined
        .map(c => [c.climaxId, c.id])
    );

    const fdMap = new Map(
      UNLocation.map(l => [l.UNLocCode, l.UNLocName])
    )

    for(let job of SeaExportJob){
      i++
      const client = climaxToId.get(parseInt(job.ClientId))
      const shipper = climaxToId.get(parseInt(job.ShipperId))
      const commodity = climaxToCommodityId.get(parseInt(job.CommodityId))

      const [affected] = await SE_Job.update(
        {
          ClientId: client,
          shipperId: shipper,
          fd: fdMap.get(job.FinalDestinationCode),
          commodityId: commodity
        },
        {
          where: { climaxId: job.Id },
        }
      );

      if (affected === 0) {
        console.warn(`No SE_Job found for climaxId=${job.Id}`);
      }
    }

    for(let job of SeaImportJob){
      i++
      const client = climaxToId.get(parseInt(job.ClientId))
      const shipper = climaxToId.get(parseInt(job.ShipperId))
      const commodity = climaxToCommodityId.get(parseInt(job.CommodityId))

      const [affected] = await SE_Job.update(
        {
          ClientId: client,
          shipperId: shipper,
          fd: fdMap.get(job.FinalDestinationCode),
          commodityId: commodity
        },
        {
          where: { climaxId: job.Id },
        }
      );

      if (affected === 0) {
        console.warn(`No SE_Job found for climaxId=${job.Id}`);
      }
    }

    res.status(200).json({ status: 'success', result: req.body.length })
  }catch(e){
    console.error(e)
    res.status(500).json({ status: 'error', result: e.message})
  }
})

routes.post("/fixAEBL", async ( req, res ) => {
  try{
    const AExp_BL = req.body

    const jobs = await SE_Job.findAll({
      where: {
        jobNo: {
          [Op.like]: "%AE%"
        }
      }
    })

    const AEJobsMap = new Map(
      jobs.map(j => [j.climaxId, j.id])
    )

    const jobIds = jobs.map(j => j.id);

    const BLs = await Bl.findAll({
      where: {
        SEJobId: {
          [Op.in]: jobIds
        }
      }
    })

    const AEBlsMap = new Map(
      BLs.map(b => [b.SEJobId, b])
    )

    let i = 0
    for(let bl of AExp_BL){
      i++
      let jobId = AEJobsMap.get(parseInt(bl.AEJobId))
      let Bl = AEBlsMap.get(parseInt(jobId))
      await Bl.update(
        {
          issuePlace: bl.PlaceOfIssue,
          issueDate: bl.PlaceOfIssueDate,
          toOne: bl.To1,
          toTwo: bl.To2,
          toThree: bl.To3,
          byFirstCarrier: bl.ByFirstCarrier,
          byOne: bl.By2,
          byTwo: bl.By3,
          Currency: bl.Currency,
          charges: bl.Charges,
          wtValPPC: bl.WTPP,
          wtValCOLL: bl.WTCC,
          othersPPC: bl.OtherPP,
          othersCOLL: bl.OtherCC,
          declareCarriage: bl.DeclareValueForCarriage,
          declareCustoms: bl.DeclareValueForCustom,
          insurance: bl.AmountOfInsurance,
          handlingInfo: bl.HandlingInfo,
          polTwo: bl.AirportOfLoading,
          podTwo: bl.AirportOfDischarge,
          poDeliveryTwo: bl.AirportOfFinalDest 
        },
        {
          where: { id: Bl.id },
        }
      );
      if(bl.NoOfPcs1 != 0){
        await Item_Details.create({
          noOfPcs: bl.NoOfPcs1,
          unit: bl.UnitOfPcs1,
          grossWt: bl.GrossWeight1,
          kh_lb: bl.UnitOfWeightId1 == 2? 'Kg' : 'Lb',
          r_class: bl.RateClass1,
          itemNo: bl.ItemNumber1,
          chargableWt: bl.ChargeableWeight1,
          rate_charge: bl.RatePerCharge1,
          total: bl.ItemTotal1,
          lineWeight: bl.LineWeight1,
          BlId: Bl.id
        })
      }
      if(bl.NoOfPcs2 != 0){
        await Item_Details.create({
          noOfPcs: bl.NoOfPcs2,
          unit: bl.UnitOfPcs2,
          grossWt: bl.GrossWeight2,
          kh_lb: bl.UnitOfWeightId2 == 2? 'Kg' : 'Lb',
          r_class: bl.RateClass2,
          itemNo: bl.ItemNumber2,
          chargableWt: bl.ChargeableWeight2,
          rate_charge: bl.RatePerCharge2,
          total: bl.ItemTotal2,
          lineWeight: bl.LineWeight2,
          BlId: Bl.id
        })
      }
      if(bl.NoOfPcs3 != 0){
        await Item_Details.create({
          noOfPcs: bl.NoOfPcs3,
          unit: bl.UnitOfPcs3,
          grossWt: bl.GrossWeight3,
          kh_lb: bl.UnitOfWeightId3 == 2? 'Kg' : 'Lb',
          r_class: bl.RateClass3,
          itemNo: bl.ItemNumber3,
          chargableWt: bl.ChargeableWeight3,
          rate_charge: bl.RatePerCharge3,
          total: bl.ItemTotal3,
          lineWeight: bl.LineWeight3,
          BlId: Bl.id
        })
      }
      if(bl.NoOfPcs4 != 0){
        await Item_Details.create({
          noOfPcs: bl.NoOfPcs4,
          unit: bl.UnitOfPcs4,
          grossWt: bl.GrossWeight4,
          kh_lb: bl.UnitOfWeightId4 == 2? 'Kg' : 'Lb',
          r_class: bl.RateClass4,
          itemNo: bl.ItemNumber4,
          chargableWt: bl.ChargeableWeight4,
          rate_charge: bl.RatePerCharge4,
          total: bl.ItemTotal4,
          lineWeight: bl.LineWeight4,
          BlId: Bl.id
        })
      }
    }

    res.status(200).json({ status: 'success', result: req.body.length})
  }catch(e){
    console.error(e)
    res.status(500).json({ status: 'error', result: e.message })
  }
})

routes.post("/uploadLogJobs", SYSTEM, async (req, res) => {
  try{
    await SE_Job.bulkCreate(req.body, { fiscalYearCheck: false })
    res.status(200).json({ status: 'success' })
  }catch(e){
    console.error(e)
    res.status(500).json({ status: 'Error', result: e.message})
  }
})

/* --------------------- MIGRATION: job sales reps ---------------------------
 * Re-points migrated jobs at their sales rep.
 *
 * Body: { SEJob: [...], SIJob: [...], AEJob: [...], AIJob: [...] } straight
 * from the legacy /jobs/getSalesRep endpoint. Each row carries the legacy job
 * Id and the legacy employee id (SalesRepId on sea/air export+import,
 * SalesmanId on the sea-import set - the legacy schema is inconsistent).
 *
 * REWRITTEN: this used to be four copies of a switch mapping legacy ids to
 * literal Odyssey UUIDs:
 *
 *     case '2': SR = '39fc0d3f-6966-46af-b22b-81e1093e4e9b'; break;
 *
 * Those UUIDs only exist in one specific Odyssey database. Run against a fresh
 * migration target - which is every real customer cutover - none of them
 * resolve, and every job silently ends up with no sales rep. It now resolves
 * through Employees.climaxId, populated by /employeeRoutes/uploadEmployees,
 * so it works on any target and reports what it could not match.
 */
routes.post("/fixSalesRep", async (req, res) => {
  try {
    const jobs = await SE_Job.findAll({ attributes: ['id', 'climaxId'] });
    const jobsByClimaxId = new Map(jobs.map((j) => [j.climaxId, j.id]));

    const employees = await Employees.findAll({
      attributes: ['id', 'name', 'climaxId'],
      where: { climaxId: { [Op.ne]: null } },
    });
    const repsByClimaxId = new Map(employees.map((e) => [String(e.climaxId), e.id]));

    if (repsByClimaxId.size === 0) {
      return res.status(409).json({
        status: 'error',
        result:
          'No employees carry a climaxId, so no sales rep can be resolved. Run ' +
          'the employee import (/employeeRoutes/uploadEmployees) before this step.',
      });
    }

    // The legacy payload names the sales rep column differently per job type.
    const BLOCKS = [
      { key: 'SEJob', field: 'SalesRepId' },
      { key: 'SIJob', field: 'SalesmanId' },
      { key: 'AEJob', field: 'SalesRepId' },
      { key: 'AIJob', field: 'SalesRepId' },
    ];

    let matched = 0;
    const unmatchedJobs = [];
    const unmatchedReps = new Set();

    for (const { key, field } of BLOCKS) {
      for (const job of req.body?.[key] || []) {
        const jobId = jobsByClimaxId.get(parseInt(job.Id));
        if (jobId === undefined) {
          unmatchedJobs.push({ block: key, climaxJobId: job.Id });
          continue;
        }

        const legacyRepId = job[field];
        // No rep on the legacy row is legitimate - clear it rather than guess.
        const repId = legacyRepId == null ? null : repsByClimaxId.get(String(legacyRepId));

        if (legacyRepId != null && repId === undefined) {
          unmatchedReps.add(String(legacyRepId));
          continue;   // leave the job alone rather than null out a real rep
        }

        await SE_Job.update(
          { salesRepresentatorId: repId || null },
          { where: { id: jobId } }
        );
        matched += 1;
      }
    }

    res.json({
      status: (unmatchedJobs.length || unmatchedReps.size) ? 'partial' : 'success',
      result: {
        jobsUpdated: matched,
        employeesAvailable: repsByClimaxId.size,
        unmatchedLegacyRepIds: [...unmatchedReps],
        unmatchedJobs: unmatchedJobs.slice(0, 50),
        unmatchedJobCount: unmatchedJobs.length,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', result: e.message });
  }
})

/* ------------------- MIGRATION: reference/master data ---------------------
 * Airports, sea ports and destinations from the legacy Climax database.
 *
 * Body: { Airports: [...Gen_UNAirport], UNLocation: [...Gen_UNLocation] }
 * straight from the legacy /jobs/getAirports endpoint. The caller sends these
 * in batches, so either array may be empty on a given request.
 *
 * Gen_UNLocation is one table carrying flags (IsSeaPort / IsAirPort /
 * IsCountry / IsCity), which Odyssey splits into Ports and Destinations. That
 * mapping is what this route is for.
 *
 * Idempotent: everything is matched on its natural key (airportCode, portId,
 * name) and updated rather than inserted twice, so a failed run can simply be
 * repeated. Inactive legacy rows are skipped - there is no value in importing
 * a customer's dead reference data.
 */
/**
 * Reference locations: airports, sea ports and destinations.
 *
 * Takes flat, pre-resolved rows - one kind per request - and inserts the ones
 * that are missing in bulk.
 *
 * It used to take the raw legacy payload and run findOrCreate plus an update
 * per record: two round trips each, sequentially, across tens of thousands of
 * UN/LOCODE rows. That is why this stage appeared to never finish.
 *
 * It also resolved city and country names from the locations in the CURRENT
 * request, while the caller was sending them 100 at a time - and an airport's
 * CityUNCode refers to some other location, which was almost never in the same
 * batch. The lookup missed and the raw code was stored where the name belonged.
 * Names are now resolved by the caller, which holds the whole dataset at once.
 *
 * Existing rows are left alone rather than re-written. These are reference
 * tables keyed by a natural code; re-running the stage should be cheap and
 * should not churn rows that are already correct.
 */
routes.post("/UploadAirPorts", SYSTEM, async (req, res) => {
  const KINDS = {
    airports:     { model: Airports,     key: 'airportCode' },
    ports:        { model: Ports,        key: 'portId' },
    destinations: { model: Destinations, key: 'name' },
  };

  // Exactly one kind per request, so a batch is a single bulk insert.
  const kind = Object.keys(KINDS).find((k) => Array.isArray(req.body?.[k]) && req.body[k].length);

  if (!kind) {
    return res.status(400).json({
      status: 'error',
      result: 'Expected one non-empty array: { airports: [...] } or { ports: [...] } or { destinations: [...] }.',
    });
  }

  const { model, key } = KINDS[kind];
  const rows = req.body[kind];

  try {
    // De-duplicate within the batch first. Sending two rows with the same key
    // in one bulkCreate fails the whole batch, and the legacy location table
    // has repeats.
    const seen = new Set();
    const unique = [];
    for (const row of rows) {
      const k = row?.[key];
      if (k == null || k === '') continue;
      const id = String(k);
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(row);
    }

    // One query for what is already there, instead of one per row.
    const existing = new Set(
      (await model.findAll({
        attributes: [key],
        where: { [key]: { [Op.in]: unique.map((r) => r[key]) } },
        raw: true,
      })).map((r) => String(r[key]))
    );

    const toCreate = unique.filter((r) => !existing.has(String(r[key])));
    if (toCreate.length) await model.bulkCreate(toCreate);

    res.json({
      status: 'success',
      result: {
        kind,
        received: rows.length,
        duplicatesInBatch: rows.length - unique.length,
        created: toCreate.length,
        alreadyPresent: unique.length - toCreate.length,
      },
    });
  } catch (error) {
    console.error(`UploadAirPorts (${kind}) failed:`, error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

module.exports = routes;