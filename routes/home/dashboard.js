const { Vouchers } = require("../../functions/Associations/voucherAssociations");
const { SE_Job, SE_Equipments } = require("../../functions/Associations/jobAssociations/seaExport");
const { Invoice, Invoice_Transactions } = require("../../functions/Associations/incoiceAssociations");
const routes = require('express').Router();
const Sequelize = require('sequelize');
const moment = require("moment");
const Op = Sequelize.Op;
// Which designation sees which widget - Configuration > Dashboard Widgets.
const { requireWidget, widgetsForRequest } = require('../../functions/dashboardWidgets');
const { PK_OFFSET_MINUTES } = require('../../functions/pkDay');

/* The widgets this user's designation is ticked for, in page order. The home
 * page lays itself out from it; the routes below refuse the rest. */
routes.get("/widgets", async(req, res) => {
  try {
    res.json({ status:'success', result:{ widgets: await widgetsForRequest(req) } });
  }
  catch (error) {
    res.status(500).json({ status:'error', result: error.message || error });
  }
});

routes.get("/getDashboard", requireWidget('jobCounters'), async(req, res) => {

  try {
    const lastWeek = `${moment().subtract(1, 'week' ).format("YYYY-MM-DD")}`
    const lastMonth =`${moment().subtract(1, 'month').format("YYYY-MM-DD")}`
    const lastYear = `${moment().subtract(1, 'year' ).format("YYYY-MM-DD")}`

    // FCL/LCL are scoped to the last 12 months (same rolling window as
    // Receivable Sales below), so they read as recent activity
    // rather than growing forever. Pending Approval stays all-time - it's a
    // current backlog, not a period metric.
    const snsFcl = await SE_Job.count({where:{companyId:"1", subType:"FCL", approved:"true", createdAt:{[Op.gte]:moment(lastYear).toDate()}}});
    const snsLCL = await SE_Job.count({where:{companyId:"1", subType:"LCL", approved:"true", createdAt:{[Op.gte]:moment(lastYear).toDate()}}});
    const snsPending = await SE_Job.count({where:{companyId:"1", approved:"false"}});

    const acsFcl = await SE_Job.count({where:{companyId:"3", subType:"FCL", approved:"true", createdAt:{[Op.gte]:moment(lastYear).toDate()}}});
    const acsLCL = await SE_Job.count({where:{companyId:"3", subType:"LCL", approved:"true", createdAt:{[Op.gte]:moment(lastYear).toDate()}}});
    const acsPending = await SE_Job.count({where:{companyId:"3", approved:"false"}});

    // TODAY in Pakistan, not on the server's clock: the servers run in UTC,
    // so their midnight is 5 am here. Jobs opened since then. It replaced the
    // year's count on the dashboard (the user, 2026-11-23).
    const today = moment().utcOffset(PK_OFFSET_MINUTES).startOf('day').toDate();
    const dayCount  = await SE_Job.count({where:{createdAt:{[Op.gte]:today}}});
    const weekCount = await SE_Job.count({where:{createdAt:{[Op.gte]:moment(lastWeek).toDate()}}});
    const monthCount= await SE_Job.count({where:{createdAt:{[Op.gte]:moment(lastMonth).toDate()}}});

    const projSales = await Invoice.findAll({
      where:{payType:'Recievable', approved:'1', createdAt:{[Op.gte]:moment(lastYear).toDate()}},
      attributes:['total', 'currency', 'ex_rate']
    });

    res.json({
      status:'success', result:{
        sns:{ snsFcl, snsLCL, snsPending },
        acs:{ acsFcl, acsLCL, acsPending },
        dayCount, weekCount, monthCount,
        invocies:{
          projSales
        }
      }
    });
  }
  catch (error) {
    res.status(500).json({status:'error', result: error});
  }
});

routes.get("/getCashFlow", requireWidget('incomeExpense', 'cashFlow'), async(req, res) => {
  try {
    const cashflow = await Vouchers.findAll({
      raw:true,
      where:{type:'Job Reciept'},
      attributes:['id', 'createdAt'],
      include:[{
        model:Invoice_Transactions,
        attributes:['amount']
      }]
    });
    const cashexpenditure = await Vouchers.findAll({
      raw:true,
      where:{type:'Job Payment'},
      attributes:['id', 'createdAt'],
      include:[{
        model:Invoice_Transactions,
        attributes:['amount']
      }]
    });
    res.json({ status:'success', result:{
      cashflow,
      cashexpenditure
    } });
  }
  catch (error) {
    res.status(500).json({status:'error', result: error});
  }
});

routes.get("/getCashFlowTwo", requireWidget('incomeExpense', 'cashFlow'), async(req, res) => {
  try {
    const values = await Vouchers.findAll({
      raw:true,
      where:{
        [Op.or]:[
          { type:'Job Reciept' },
          { type:'Job Payment' },
        ]
      },
      attributes:['id', 'createdAt', 'type', 'currency', 'exRate'],
      include:[{
        model:Invoice_Transactions,
        attributes:['amount']
      }]
    });
    res.json({ status:'success', result:values });
  }
  catch (error) {
    res.status(500).json({status:'error', result: error});
  }
});

module.exports = routes;