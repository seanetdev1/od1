const { Child_Account, Parent_Account } = require("../../functions/Associations/accountAssociations");
const { Invoice, Invoice_Losses, Invoice_Transactions } = require("../../functions/Associations/incoiceAssociations");
const { Vouchers, Voucher_Heads }=require("../../functions/Associations/voucherAssociations");
const { SE_Job, SE_Equipments, Commodity } = require("../../functions/Associations/jobAssociations/seaExport");
const { Clients }=require("../../functions/Associations/clientAssociation");
const { Bl } = require('../../functions/Associations/jobAssociations/seaExport');

const { Accounts } = require('../../models/');
const { aviationJobPLRows } = require('../../functions/aviationJobPL');
const { reportCompanies } = require('../../functions/companyAccess');
// Required for the side effect as much as the exports: an include only works
// once the association file that declares it has run, and nothing else in this
// route pulls the aviation links in.
const { Aviation_Job, Aviation_Consignment } = require('../../functions/Associations/aviationAssociations');
const { Charge_Head } = require('../../functions/Associations/incoiceAssociations');
const aviationModels = {
  Aviation_Job, Aviation_Consignment, Charge_Head, Invoice,
  Invoice_Transactions, Clients, Commodity,
};
const { customsJobPLRows } = require('../../functions/customsJobPL');
// Same reason as the aviation require above: the include below only works once
// the association file that declares it has run, and nothing else in this
// route pulls the customs links in.
const { Customs_Job, Customs_Duty } = require('../../functions/Associations/customsAssociations');
// Customs_Duty is NOT optional here. Duty is assessed per item on that table,
// so customsJobPLRows includes it - and a missing model becomes
// `{ model: undefined }` in the include, which makes Sequelize throw and 500s
// the WHOLE report, freight and aviation rows included.
const customsModels = {
  Customs_Job, Customs_Duty, Charge_Head, Invoice, Invoice_Transactions,
  Clients, Commodity,
};
const routes=require('express').Router();
const { pkDay } = require('../../functions/pkDay');
const { withGainLossShares } = require('../../functions/gainLossShares');
const { sequelize } = require('../../models');
const Sequelize=require('sequelize');
const moment = require("moment");
const { Employees } = require("../../functions/Associations/employeeAssociations");
const url = 'profitLoss';
const Op = Sequelize.Op;

routes.get(`/${url}/job`, async(req, res) => {
  try {
    let obj = {};
    obj.approved ='true';
    // '4' is the legacy Seanet "companies 1 and 3" value, kept so an existing
    // saved filter behaves exactly as before. 'all' is the new "every company
    // on this installation", which the pickers now offer instead of a
    // hardcoded list of Seanet's own companies.
    //
    // subType is a separate filter and is applied either way - it only sat
    // inside the else branch because that branch was "not 4".
    // A list is a restricted user's own 'all' (functions/companyAccess).
    const reportCompanyIds = reportCompanies(req.headers.company, req.allowedCompanies);
    if (reportCompanyIds) obj.companyId = { [Op.in]: reportCompanyIds };
    // Guarded: this used to be `req.headers.subtype.split(",")` inside the
    // company branch, which threw - and returned a 500 for the whole report -
    // whenever a company was picked but no sub-type was ticked. An absent
    // sub-type filter means "every sub-type", not "crash".
    if (req.headers.subtype) {
      obj.subType = { [Op.in]: req.headers.subtype.split(",") };
    }
    /* BY THE JOB'S OWN DATE - its jobDate, else when it was entered - as the
       customs rows go by the GD date and the aviation ones by the flight date
       (the user, 2026-11-20: amounts not matching). It went by createdAt,
       which on 729 of SNS's migrated jobs is a week or more off the job date,
       some across a fiscal year (ACS-AE-1774/26: dated 25 June, counted in
       the year from 1 July). Pakistan days - functions/pkDay. */
    const fromDay = pkDay(req.headers.from);
    const toDay = pkDay(req.headers.to);
    const jobDay = `COALESCE(NULLIF(left("SE_Job"."jobDate", 10), ''), to_char("SE_Job"."createdAt" AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD'))`;
    obj[Op.and] = [Sequelize.where(Sequelize.literal(jobDay), { [Op.between]: [fromDay || '0000-01-01', toDay || '9999-12-31'] })];
    // Kept for the aviation and customs fallbacks below (a flight or file with
    // no date of its own).
    const createdRange = {
      [Op.gte]: moment(req.headers.from).toDate(),
      [Op.lte]: moment(req.headers.to).add(1, 'days').toDate(),
    };
    req.headers.salesrepresentative?obj.salesRepresentatorId=req.headers.salesrepresentative:null;
    req.headers.client?obj.ClientId=req.headers.client:null;
    req.headers.overseasagent?obj.overseasAgentId=req.headers.overseasagent:null;
    req.headers.jobtype?obj.operation = { [Op.in]: req.headers.jobtype.split(",") }:null;
    const result = await SE_Job.findAll({
      attributes:['id','jobNo','fd', 'createdAt', 'jobDate', 'jobType', 'operation', 'weight',
        'subType','companyId','pcs','pol','exRate','costCenter','nomination',
        'pkgUnit','customerRef','eta','shipDate', 'vol'],
      where:obj,
      include:[
        {
          model:Invoice,
          attributes:['id', 'total', 'payType', 'recieved' , 'paid', 'type', 'status', 'ex_rate', 'currency'],
          where: {
            approved:'1',
          },
          include:[{
            model:Invoice_Transactions
          }]
        },
        { model:Bl, attributes:['hbl','mbl']

        },
        { model:Clients, attributes:['name'] },
        { model:Clients, as:'shipper', attributes:['name'] },
        { model:Clients, as:'consignee', attributes:['name'] },
        { model:Clients, as:'local_vendor', attributes:['name'] },
        { model:Clients, as:'overseas_agent', attributes:['name'] },
        { model:Clients, as:'shipping_line', attributes:['name'] },
        
        { model:SE_Equipments,  attributes:['teu'] },
        { model:Commodity, as:'commodity',  attributes:['name'] },
        
        { model:Employees, as:'sales_representator', attributes:['name'] },
      ]
    });

    // Aviation flights live in their own tables, so SE_Job.findAll above can
    // never see them - the "Aviation" type filter offered a choice that always
    // came back empty. They are appended as rows in the SAME shape, so the
    // screen, the Excel export and the summary tab need no aviation branch.
    //
    // Costs nothing on a freight-only installation: aviationJobPLRows returns
    // immediately without querying when the filters exclude aviation, and
    // there are no flights to find otherwise.
    const aviation = await aviationJobPLRows({
      company: req.headers.company,
      allowedCompanies: req.allowedCompanies,
      jobtype: req.headers.jobtype,
      subtype: req.headers.subtype,
      client: req.headers.client,
      salesrepresentative: req.headers.salesrepresentative,
      overseasagent: req.headers.overseasagent,
      // Aviation ranges on the flight date, which is a 'YYYY-MM-DD' string -
      // hence the plain format rather than the Date objects the freight
      // timestamp comparison needs. Inclusive of `to`, which is what the
      // freight side's `< to + 1 day` amounts to.
      from: pkDay(req.headers.from),
      to: pkDay(req.headers.to),
      // The same window as timestamps, used only for flights that have no
      // flight date recorded and fall back to createdAt.
      fromDate: createdRange[Op.gte],
      toDate: createdRange[Op.lte],
    }, aviationModels);

    // Goods declarations, for exactly the same reason: they live in their own
    // table, so SE_Job.findAll can never see them and the "Customs Clearance"
    // type filter offered a choice that always came back empty. Appended in
    // the SAME shape, so nothing downstream needs a customs branch.
    //
    // Costs nothing on an installation that files none: customsJobPLRows
    // returns immediately without querying when the filters exclude customs.
    const customs = await customsJobPLRows({
      company: req.headers.company,
      allowedCompanies: req.allowedCompanies,
      jobtype: req.headers.jobtype,
      subtype: req.headers.subtype,
      client: req.headers.client,
      salesrepresentative: req.headers.salesrepresentative,
      overseasagent: req.headers.overseasagent,
      // Customs ranges on the GD date, which is a 'YYYY-MM-DD' string - hence
      // the plain format rather than the Date objects the freight timestamp
      // comparison needs. Inclusive of `to`, which is what the freight side's
      // `< to + 1 day` amounts to.
      from: pkDay(req.headers.from),
      to: pkDay(req.headers.to),
      // The same window as timestamps, used only for files whose GD has not
      // been filed yet and that fall back to createdAt.
      fromDate: createdRange[Op.gte],
      toDate: createdRange[Op.lte],
    }, customsModels);

    // Oldest first across all three, so a mixed report reads as one list
    // rather than freight followed by aviation followed by customs. Every
    // report reads oldest to newest; this one was the exception, putting the
    // start of the period on the last page. Sorted on createdAt, the date the
    // report's Date column shows.
    const combined = [
      // The Date column is the date the period went by - see the filter above.
      ...result.map((r) => { const j = r.toJSON(); if (j.jobDate) j.createdAt = j.jobDate; return j; }),
      ...aviation, ...customs,
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    // Each invoice's own share of its receipt's or payment's gain/loss, not
    // the whole of it once per invoice - functions/gainLossShares.
    await withGainLossShares(sequelize, combined);

    res.json({status:'success', result:combined});

  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error});
  }
});

routes.post(`/${url}/getGainLoss`, async(req, res) => {
  try {
    const result = await Vouchers.findAll({
      where:{invoice_Id:req.body.ids},
      attributes:['exRate', 'vType'],
      include:[{
        model:Voucher_Heads,
        attributes:['amount', 'type', 'defaultAmount'],
        include:[{
          model:Child_Account,
          attributes:['title'],
        }]
      }]
    })
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

routes.get(`/${url}/full`, async(req, res) => {
  try {
    const expense = await Accounts.findOne({
      attributes:['title'],
      where:{id:1},
      include:[{
        model:Parent_Account,
        where:{CompanyId:req.headers.id},
        attributes:['title'],
        include:[{
          model:Child_Account,
          attributes:['title'],
          include:[{
            model:Voucher_Heads,
            where:{
              createdAt: {
                [Op.gte]: moment(req.headers.from).toDate(),
                [Op.lte]: moment(req.headers.to).add(1, 'days').toDate(),
              }
            },
            attributes:['defaultAmount', 'amount', 'type'],
            include:[{
              model:Vouchers,
              attributes:['vType', 'type', 'exRate'],
            }]
          }]
        }]
      }]
    });
    const revenue = await Accounts.findOne({
      attributes:['title'],
      where:{id:2},
      include:[{
        model:Parent_Account,
        where:{CompanyId:req.headers.id},
        attributes:['title'],
        include:[{
          model:Child_Account,
          attributes:['title'],
        }]
      }]
    });
    res.json({status:'success', result:{expense, revenue}});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

routes.get(`/${url}/test`, async(req, res) => {
  try {
    let dateObj = {
      createdAt: {
        [Op.gte]: moment(req.headers.from).toDate(),
        [Op.lte]: moment(req.headers.to).add(1, 'days').toDate(),
      }
    }
    const result = await Child_Account.findAll({
      where:{ParentAccountId:req.headers.id},
      attributes:['title'],
      include:[
        { 
          model:Voucher_Heads,
          where:req.headers.from?dateObj:{},
          attributes:['id', 'amount', 'createdAt'],
          include:[{
            model:Vouchers,
            attributes:['voucher_Id', 'vType'],
          }]
        }
      ]
    })
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

routes.get(`/${url}/search`, async(req, res) => {
  try {
    const result = await Employees.findAll({where:{represent: {[Op.substring]: 'sr'} }, attributes:['id', 'name']});
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result:error});
  }
});

/**
 * The voucher-date condition for a report period, or {} when no valid range
 * was given.
 *
 * Dated on the voucher's createdAt, the same basis the trial balance uses, so
 * the two reports agree about which month a voucher belongs to. Whole days,
 * inclusive of `to`: the page sends ISO timestamps carrying the time of day
 * they were picked at, and comparing those directly would drop part of the
 * first and last day.
 */
function reportPeriod(from, to) {
  const start = moment(from);
  const end = moment(to);
  if (!from || !to || !start.isValid() || !end.isValid()) return {};
  return {
    createdAt: {
      [Op.gte]: start.startOf('day').toDate(),
      [Op.lt]: end.add(1, 'day').startOf('day').toDate(),
    },
  };
}

async function getAccountVoucherHierarchy(parentId = null, company, period = {}) {
  try{
    const accounts = await Child_Account.findAll({
      where: { ChildAccountId: parentId },
      order: [['id', 'ASC']],
      include: [{
        model: Voucher_Heads,
        include: [{
          model: Vouchers,
          attributes: ['id', 'vType'],
          where: { CompanyId: company, ...period }
        }]
      }]
    });
    const result = await Promise.all(
      accounts.map(async (account) => {
        const children = await getAccountVoucherHierarchy(account.id, company, period);
        return {
          ...account.get({ plain: true }),
          children
        };
      })
    );

    return result;
  }catch(error){
    console.error(error);
  }
}

routes.get(`/${url}/incomeStatement`, async(req, res) => {
  try {
    // The page has always sent from/to, and printed them in the report's
    // heading, but they were never applied - every figure was the account's
    // total since the books began, whatever period the heading named.
    const result = await getAccountVoucherHierarchy(
      null,
      req.headers.company,
      reportPeriod(req.headers.from, req.headers.to)
    );
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

const getComparitiveData = async (accountId, company, from, to) => {
  try{
    const result = await Child_Account.findOne({
      where: {
        id: accountId
      },
      include: {
        model: Voucher_Heads,
        where: {
          createdAt: {
              [Op.gte]: moment(from).toDate(),
              [Op.lte]: moment(to).toDate(),
          }
        },
        include: {
          model: Vouchers,
          where: {
            CompanyId: company
          }
        }
      }
    })
    return result
  }catch(e){
    console.error(e)
    // res.status(500).json({ status: 'error', result: e.message })
    return e.message
  } 
}


routes.get(`/${url}/ISComparitive`, async(req, res) => {
  try {
    console.log(req.query);
    const revenue = [
      {
        id: 5120
      },
      {
        id: 5122
      },
      {
        id: 5131
      }
    ]
    const COS = [
      {
        id: 5148
      },
      {
        id: 5152
      },
      {
        id: 5162
      },
    ]
    const result = await getComparitiveData(5149, 1, req.query.from, req.query.to)


    res.json({ status:'success', result: result });
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

module.exports = routes;