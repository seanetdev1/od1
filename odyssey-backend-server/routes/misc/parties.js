
const routes = require('express').Router();
const Sequelize = require('sequelize');
const { Invoice, Charge_Head } = require("../../functions/Associations/incoiceAssociations");
const { SE_Job, SE_Equipments } = require("../../functions/Associations/jobAssociations/seaExport");
const { Clients, Client_Associations } = require("../../functions/Associations/clientAssociation");
const { Employees } = require("../../functions/Associations/employeeAssociations");
const Op = Sequelize.Op;
const url = 'parties';
const moment = require("moment");
const { Child_Account } = require('../../functions/Associations/accountAssociations');

/**
 * The parties a screen can pick from, by what they are TO US.
 *
 * All four answers come from Clients - "vendor" and "agent" are not separate
 * tables, they are what the `types` column says about a client - so the three
 * named branches differ only by that filter.
 *
 * `all` IS THE FOURTH, and is what Payments & Receipts now asks for. That
 * screen used to make the user say client/vendor/agent before it would show
 * anybody, which meant knowing how a party had been categorised before you
 * could take money from them - and a party filed as neither was unreachable.
 * It is also the default here: an unrecognised type used to fall through every
 * branch and return `undefined`, which reached the browser as an empty picker
 * with no error anywhere.
 *
 * ONE `where`, BUILT UP. The vendor and agent branches each used to pass two
 * `where` keys in one object literal, and the second silently replaced the
 * first - so `nongl: '0'` was dropped on both, and non-GL parties were offered
 * for posting. Conditions are collected into a single object here instead.
 */
routes.get(`/${url}/getPartiesbyType`, async (req, res) => {
  try {
    const type = String(req.headers.type || 'all').toLowerCase();

    // Never offered for posting: a party marked non-GL has no ledger account
    // to post against. This applies to every branch.
    const where = { nongl: '0' };

    const typesLike = (op, pattern) =>
      Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('types')), op, pattern);

    if (type === 'vendor') {
      // Everyone we buy from EXCEPT the overseas agents, which are their own
      // branch below.
      where.types = typesLike('NOT LIKE', '%overseas agent%');
    } else if (type === 'agent') {
      where.types = typesLike('LIKE', '%agent%');
    }
    // 'client' and 'all' add nothing: every client is a client, and `all` is
    // deliberately every party on the ledger.

    const result = await Clients.findAll({
      where,
      // `types` is returned so the screen can work out what a party IS rather
      // than asking the user to say so - Payments & Receipts derives its
      // agent/vendor/client handling from it now that the selector is gone.
      attributes: ['id', 'name', 'code', 'types'],
      include: {
        model: Client_Associations,
        include: { model: Child_Account },
      },
      order: [['name', 'ASC']],
    });

    res.json({ status: 'success', result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', result: e.message || e });
  }
});

routes.post(`/${url}/getBySearch`, async(req, res) => {
  try {
    let result;
    if(req.body.type=="client"){
      result = await Clients.findAll({
        attributes:['id', 'name','code'],
        where:{
          [Op.or]: [
            { code: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('code')), 'LIKE', '%' + req.body.search.toLowerCase() + '%') },
            { name: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('name')), 'LIKE', '%' + req.body.search.toLowerCase() + '%') }, 
          ],
        }
      })
    } else if (req.body.type=="vendor"){
      result = await Vendors.findAll({
        attributes:['id', 'name','code'],
        where:{
          [Op.or]: [
            { code: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('code')), 'LIKE', '%' + req.body.search.toLowerCase() + '%') },
            { name: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('name')), 'LIKE', '%' + req.body.search.toLowerCase() + '%') }, 
          ],
          types: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('types')), 'NOT LIKE', '%overseas agent%'),
        }
      })
    } else if(req.body.type=="agent"){
      result = await Vendors.findAll({
        attributes:['id', 'name','code'],
        where:{
          [Op.or]: [
            { code: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('code')), 'LIKE', '%' + req.body.search.toLowerCase() + '%') },
            { name: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('name')), 'LIKE', '%' + req.body.search.toLowerCase() + '%') }, 
          ],
          types: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('types')), 'LIKE', '%agent%')
        }
      })
    }else if("representative"){
      result = await Employees.findAll({
        attributes:['id', 'name'],
        where:{
          name: Sequelize.where(Sequelize.fn('LOWER', Sequelize.col('name')), 'LIKE', '%' + req.body.search.toLowerCase() + '%')
        }
      })
    }
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

routes.post(`/${url}/geInvoiceBalancing`, async(req, res) => {
  let obj = {
    approved:'true',
    operation:req.body.filters.operation,
    createdAt: {
      [Op.gte]: moment(req.body.filters.from).toDate(),
      [Op.lte]: moment(req.body.filters.to).add(1, 'days').toDate(),
    }
  }
  try {
    const result = await Invoice.findAll({
      where:{approved:"1"},
      include:[{
        model:SE_Job,
        where:obj
      }]
    })

    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

routes.post(`/${url}/getJobBalance`, async(req, res) => {
    try {
      let result;
      if(req.body.type=="client"){
        result = await SE_Job.findAll({
        attributes:['id', 'jobNo', 'subType', 'freightType', 'fd', 'vol', 'weight'],
        include:[
          {
            model:Invoice,
            where:{
              payType:req.body.payType,
              party_Id:req.body.id,
              status:{[Op.ne]:'0'},
              createdAt: {
                [Op.gte]: moment(req.body.from).toDate(),
                [Op.lte]: moment(req.body.to).add(1, 'days').toDate(),
              }
            },
            attributes:['invoice_No', 'payType', 'status', 'createdAt', 'party_Name', 'paid', 'recieved','roundOff', 'total'],
          },
          {
            model:SE_Equipments,
            attributes:['qty', 'size']
          },
        ],
        }).catch((x)=>console.log(x));
    } else {
      result = await SE_Job.findAll({
        attributes:['id', 'jobNo', 'subType', 'freightType', 'fd', 'vol', 'weight'],
        include:[
          {
            model:Invoice,
            where:{
              payType:req.body.payType,
              party_Id:req.body.id,
              status:{[Op.ne]:'0'}
            },
            attributes:['invoice_No', 'payType', 'status', 'createdAt', 'party_Name', 'payType', 'paid', 'recieved', 'total'],
          },
          {
            model:SE_Equipments,
            attributes:['qty', 'size']
          },
        ],
        }).catch((x)=>console.log(x));
    }
      res.json({status:'success', result:result});
    }
    catch (error) {
      console.error(error);
      res.status(500).json({status:'error', result: error});
    }
});

routes.post(`/${url}/getJobBalanceNew`, async(req, res) => {
  try {
    let result;
    let obj = {
      party_Id:req.body.id,
      status:{[Op.ne]:'0'},
      createdAt: {
        [Op.gte]: moment(req.body.from).toDate(),
        [Op.lte]: moment(req.body.to).add(1, 'days').toDate(),
      }
    }
    if(req.body.payType!="Both"){
      obj.payType=req.body.payType
    }
    if(req.body.type=="client"){
      result = await Invoice.findAll({
        where:obj,
        attributes:['invoice_No', 'payType', 'status', 'createdAt', 'party_Name', 'paid', 'recieved', 'roundOff', 'total', 'ex_rate'],
        include:[
          {
            model:SE_Job,
            attributes:['id', 'jobNo', 'subType', 'freightType', 'fd', 'vol', 'weight'],
            include:[{
              model:SE_Equipments,
              attributes:['qty', 'size']
            }]
          },
        ],
      }).catch((x)=>console.log(x));
    } else {
      result = await Invoice.findAll({
        where:{
          payType:req.body.payType,
          party_Id:req.body.id,
          status:{[Op.ne]:'0'},
          createdAt: {
            [Op.gte]: moment(req.body.from).toDate(),
            [Op.lte]: moment(req.body.to).add(1, 'days').toDate(),
          }
        },
        attributes:['invoice_No', 'payType', 'status', 'createdAt', 'party_Name', 'paid', 'recieved', 'roundOff', 'total'],
        include:[
          {
            model:SE_Job,
            attributes:['id', 'jobNo', 'subType', 'freightType', 'fd', 'vol', 'weight'],
            include:[{
              model:SE_Equipments,
              attributes:['qty', 'size']
            }]
          },
          {
            model:Charge_Head,
            attributes:['id'],
            where:{},
          }
        ],
      }).catch((x)=>console.log(x));
    }
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error});
  }
});

routes.get("/dateExperiment", async(req, res) => {
  try {
      const from = moment("2023-02-23");
      const to = moment("2023-02-25");
      const resultOne = await Invoice.findAll({
        where:{
          createdAt: {
            [Op.gte]: from.toDate(),
            [Op.lte]: to.toDate(),
           }
        },
        order: [[ 'createdAt', 'ASC' ]]
      });
      res.json({status:'success', result:{ resultOne }});
      }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

module.exports = routes;