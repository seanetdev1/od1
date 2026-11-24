const { nextVoucherNo, voucherId } = require("../../functions/voucherNumber");
const { readNumbering } = require("../../functions/documentNumber");
const moment = require("moment");
const db = require("../../models");
const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const routes = require('express').Router();
const { Accounts } = require('../../models/');
// Nothing here uses Invoice any more (the ledger's invoice-number order went
// 2026-11-10); still required, so the associations load in the order they
// always have.
require("../../functions/Associations/incoiceAssociations");
const { Vouchers, Voucher_Heads } = require("../../functions/Associations/voucherAssociations");
const { Client_Associations, Clients } = require('../../functions/Associations/clientAssociation');
const { Child_Account, Parent_Account } = require("../../functions/Associations/accountAssociations");
const { SE_Job, SE_Equipments, Bl, Container_Info } = require("../../functions/Associations/jobAssociations/seaExport");
const { resolveSelectedFiscalYear } = require("../../functions/Associations/fiscalYearAssociations");
// What date an opening balance stands on in the ledger.
const { openingBalanceDate } = require("../../functions/voucherDate");
// The ledger PDF is rendered by loading the frontend's bare ledger print page
// headlessly, the same way an invoice PDF is - see functions/pdf.
const { signLedgerPrintToken, readLedgerPrintToken } = require('../../functions/printToken');
const { renderLedgerPdf } = require('../../functions/pdf');
const { createHistory } = require('../../functions/history');
// One definition of how a child account is numbered, shared with
// routes/clients - which had its own, in SQL, and overflowed on a chart four
// levels deep.
const { nextChildAccountCode } = require('../../functions/childAccountCode');
// Company code for document numbers (job/invoice/voucher/DO prefixes).
// Reads Company.short, which is set per install - these were hardcoded as
// SNS/CLS/ACS, which stamps Seanet's codes onto another company's documents.
const { companyShort } = require('../../functions/companyCodes');
const { seedChartOfAccounts } = require('../../functions/chartOfAccounts');
// Seeding the chart of accounts is set-up, which is Seanet's - see
// functions/systemAccess.js.
const { requireSystem: SYSTEM } = require('../../functions/systemAccess');
// Asked INSIDE /editChildAccount rather than in front of it: that route is open
// to everyone, but editing an account the chart has flagged as not editable is
// not. Same three designations the ledger and fiscal-year routes use.
const { hasDesignation } = require('../../functions/requireDesignation');
const COA_ADMINS = ['CEO', 'CFO', 'admin'];


async function getAccountHierarchy(parentId = null) {
  const accounts = await Child_Account.findAll({
    where: { ChildAccountId: parentId },
    attributes: ['id', 'title', 'editable', 'ChildAccountId', 'code', 'subCategory', 'createdAt'],
    order: [['id', 'ASC']]
  });

  // Recursively attach children
  const result = await Promise.all(
    accounts.map(async (account) => {
      const children = await getAccountHierarchy(account.id);
      return {
        ...account.get({ plain: true }),
        children
      };
    })
  );

  return result;
}

async function getAccountVoucherHierarchy(parentId = null, company) {
  const accounts = await Child_Account.findAll({
    where: { ChildAccountId: parentId },
    order: [['id', 'ASC']],
    include: [{
      model: Voucher_Heads,
      include: [{
        model: Vouchers,
        attributes: ['id', 'vType'],
        where: { CompanyId: company }
      }]
    }]
  });

  // Recursively attach children
  const result = await Promise.all(
    accounts.map(async (account) => {
      const children = await getAccountVoucherHierarchy(account.id, company);
      return {
        ...account.get({ plain: true }),
        children
      };
    })
  );

  return result;
}

async function getAllAccounts(id){
  try{
    let result;
    result = await Child_Account.findAll({
      attributes:['id', 'title'],
      include:[{
        model:Child_Account,
        as: 'parent',
        attributes:['id', 'title', 'editable', 'ChildAccountId', 'code'],
        include:[{
          model:Child_Account,
          as: 'parent',
          attributes:['id', 'title', 'ChildAccountId', 'createdAt', 'editable', 'code', 'subCategory'],
          order: [['id', 'DESC']],
        }]
      }]
    });
    return result;
    
  }catch(err){
    console.error(err)
  }
};

async function getAccount(id){
  let result;
  result = await Child_Account.findOne({
    attributes:['id', 'title'],
    
    where:{id:id}
  });
  return result;
}

routes.post("/importAccounts", SYSTEM, async (req, res) => {
  const data = req.body

  const TOP_LEVEL_MAP = {
    capital: "Equity",
    expense: "Expense",
    laibility: "Liabilities",
    revenue: "Income/Sales",
    assets: "Assets",
  };

  try{
    const accountIdMap = new Map()
    const parentAccountIdMap = new Map()
    const childAccountIdMap = new Map()

    const companyIds = ['1', '3']

    for(companyId of companyIds){

      for(item of data){
        if(!item.ParentAccountId){
          const mappedTitle = TOP_LEVEL_MAP[item.AccountName.toLowerCase()];
            if (!mappedTitle) {
              console.warn(`Top-level account '${item.AccountName}' not mapped`);
              continue;
            }
            const baseAccount = await Accounts.findOne({ where: { title: mappedTitle } });
            if (!baseAccount) {
              console.warn(`Mapped top-level account '${mappedTitle}' not found`);
              continue;
            }
            accountIdMap.set(item.Id, baseAccount.id);
  
        } else {
          if(accountIdMap.has(item.ParentAccountId)){
            const accountId = accountIdMap.get(item.ParentAccountId)
            const parent = Parent_Account.create({
              title: item.AccountName,
              code: item.Id.toString(),
              subCategory: item.SubCategory?.SubCategory || null,
              editable: item.IsVoucherEntryAllowed !== false,
              CompanyId: companyId,
              AccountId: accountId,
            })
            parentAccountIdMap.set(item.Id, parent.id)
          }
        }
  
      }
    }
    res.json({status: "Success"})
  }catch(e){
    console.error(e)
    return res.status(500).json({status:"error", result: e.message || e });
  }
})

routes.post("/importAccount", SYSTEM, async (req, res) => {
  const dataArray = req.body;

  try {

    for(let item of dataArray){
      
      const result  = await Child_Account.create({
        id: item.Id,
        title: item.AccountName,
        code: item.AccountCode.toString(),
        subCategory: item.SubCategory?.SubCategory || null,
        editable: item.IsVoucherEntryAllowed !== false,
        ChildAccountId: item.ParentAccountId,
      })

    }

    return res.json({
      status: "success",
      message: "Accounts imported successfully for selected companies.",
    });
  } catch (e) {
    console.error("Import error:", e);
    return res.status(500).json({status:"error", result: e.message || e });
  }
});


routes.post("/createParentAccount", async(req, res) => {
  try {
    const result = await Parent_Account.findOne({
      where: {
        [Op.and]: [
          { title: req.body.title },
          { CompanyId: req.body.CompanyId },
          { AccountId: req.body.AccountId }
        ]
      }
    })
    if(result){
      res.json({status:'exists', result:result});
    }else{
      const code = req.body.CompanyId.toString()+req.body.AccountId.toString();
      const result1 = await Parent_Account.findOne({
        where: {
          code: {
            [Op.like]: `${code}%`
          }
        },
        order: [['code', 'DESC']],
      });
      
      let newCode = 0
      if(result1){
        newCode = parseInt(result1.dataValues.code)+1
      }else{
        newCode = parseInt(code)*100
        newCode++
      }
      let values = req.body
      values.editable=0
      values.code=newCode.toString()
      const result2 = await Parent_Account.create(values);
      let val;
      val = await Parent_Account.findOne({
        where: {
          code: newCode.toString()
        }
      });
      res.json({status:'success', result:val});
    }
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
});

routes.post("/createChildAccount", async (req, res) => {
  try {
    const { title, ChildAccountId, subCategory, editable } = req.body;

    const existing = await Child_Account.findOne({
      where: {
        title,
        ChildAccountId: ChildAccountId || null, // null if top-level
      },
    });

    if (existing) {
      return res.json({ status: 'exists' });
    }


    let parentCode = '0';
    if (ChildAccountId) {
      const parent = await Child_Account.findOne({
        where: { id: ChildAccountId },
      });
      if (!parent) return res.json({ status: 'error', result: 'Parent not found' });
      parentCode = parent.code;
    }


    // Siblings are found by the PARENT LINK, not by a range over `code`.
    //
    // `code` is a STRING column, so a range like code >= '0' AND code < '10000'
    // compares lexicographically: '2' < '10000' is FALSE, because '2' beats '1'
    // on the first character. Once a top-level account had code '2' it fell
    // outside its own range, the query could only ever find '1', and every
    // subsequent account was numbered 1 + 1 = 2. Five top-level accounts came
    // out as 1, 2, 2, 2, 2.
    //
    // The range was standing in for "children of this parent", which the table
    // records directly. Asking for that instead removes the string comparison
    // altogether; the maximum is then taken numerically, in JS - see
    // functions/childAccountCode for why that arithmetic must not go back into
    // SQL, which routes/clients learned the hard way.
    const siblings = await Child_Account.findAll({
      where: { ChildAccountId: ChildAccountId || null },
      attributes: ['code'],
      raw: true,
    });

    // Top-level accounts count from 1; a child continues its parent's block.
    // parentCode is '0' when there is no parent, which seeds the block at 0.
    const newCode = nextChildAccountCode(parentCode, siblings.map((s) => s.code));

    // Create the new child account
    const newAccount = await Child_Account.create({
      title,
      ChildAccountId: ChildAccountId || null,
      subCategory: subCategory || 'General',
      // Respect the form's Editable toggle ('0' = editable, '1' = not).
      // Default to editable ('0') if the field wasn't sent (older callers).
      editable: editable != null ? editable : 0,
      code: newCode.toString(),
    });

    // By id, not by code: `code` has no unique constraint, so on any database
    // where the numbering above has already gone wrong this could hand back a
    // different account than the one just created.
    const createdAccount = await Child_Account.findByPk(newAccount.id);

    res.json({ status: 'success', result: createdAccount });
  } catch (error) {
    console.error(error);
    res.status(500).json({status:'error', result: error });
  }
});

// Counts of everything that would block deleting an account.
async function accountBlockers(id) {
  const [children, transactions, clients] = await Promise.all([
    Child_Account.count({ where: { ChildAccountId: id } }),      // sub-accounts
    Voucher_Heads.count({ where: { ChildAccountId: id } }),      // transactions (ledger postings)
    Client_Associations.count({ where: { ChildAccountId: id } }),// linked party ledgers
  ]);
  const reasons = [];
  if (children > 0)     reasons.push(`${children} sub-account(s)`);
  if (transactions > 0) reasons.push(`${transactions} transaction(s)`);
  if (clients > 0)      reasons.push(`${clients} linked party ledger(s)`);
  return { children, transactions, clients, deletable: reasons.length === 0, reason: reasons.join(', ') };
}

// Pre-check used by the UI before confirming a delete.
routes.get("/accountDeleteCheck/:id", async (req, res) => {
  try {
    const info = await accountBlockers(req.params.id);
    res.json({ status: 'success', ...info });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message });
  }
});

// Delete a leaf account. Re-checks on the server (authority) so the UI's
// pre-check can't be bypassed.
routes.post("/deleteAccount", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ status: 'error', result: 'Account id required.' });
    const account = await Child_Account.findByPk(id);
    if (!account) return res.status(404).json({ status: 'error', result: 'Account not found.' });

    const info = await accountBlockers(id);
    if (!info.deletable) {
      return res.status(409).json({ status: 'error', result: `Cannot delete "${account.title}": it has ${info.reason}.` });
    }

    await account.destroy();
    res.json({ status: 'success' });
  } catch (error) {
    res.status(500).json({ status: 'error', result: error.message });
  }
});

routes.post("/editParentAccount", async(req, res) => {

  const {id, title, AccountId, CompanyId} = req.body
  try {
    const result = await Parent_Account.findOne({where:{title, AccountId, CompanyId}})
    if(result){
      res.json({status:'exists', result:result});
    }else{
      await Parent_Account.update({title:title},{where:{id:id}})
      let val;
      val = await getAllAccounts(CompanyId);
      res.json({status:'success', result:val});
    }
  }
  catch (error) {
    res.send({status:'error', result:error});
  }
});

/**
 * Edit a chart-of-accounts entry: its title, and where it sits.
 *
 * WHO MAY EDIT WHAT. Any user may rename an ordinary account. An account the
 * chart has flagged as NOT EDITABLE (`editable` = '1') is part of the seeded
 * structure the rest of the system reasons about, and only a CEO/CFO/admin may
 * touch one. The screen shows the pencil on the same rule; this is what makes
 * it true rather than merely displayed.
 *
 * MOVING AN ACCOUNT IS ONLY FOR A LEAF, and that restriction is what makes the
 * rest of this tractable. Codes are hierarchical by MULTIPLICATION - a child's
 * block is parentCode * 10000 (see functions/childAccountCode) - so an
 * account's code states where it sits in the tree. Move it and the code has to
 * be reissued under the new parent, or the chart shows an account filed
 * somewhere its own number denies.
 *
 * For a leaf that is one row. For a node with children it would be a rewrite
 * of every code beneath it, to arbitrary depth, with each level multiplying
 * the block again - and any of those codes may already be printed on a
 * statement somebody has filed. So a parent is not movable, and the screen
 * greys the field rather than letting the request be made at all.
 *
 * THE CODE IS REISSUED, NOT KEPT. An account that moved and kept its old
 * number would sort under its previous parent on every report that orders by
 * code, which is most of them. The number describes the position; the position
 * changed.
 */
routes.post("/editChildAccount", async(req, res) => {

  const {id, title, CompanyId, employeeId} = req.body
  try {
    const account = await Child_Account.findByPk(id);
    if (!account) {
      return res.status(404).json({ status: 'error', result: 'Account not found.' });
    }

    /* A SEEDED ACCOUNT IS ADMIN-ONLY. `editable` is a string column holding
     * '0' or '1' - '1' means the chart does not offer it for editing. Compared
     * loosely because older rows hold the number 1 rather than the string. */
    const locked = String(account.editable) === '1';
    if (locked && !hasDesignation(req, COA_ADMINS)) {
      return res.status(403).json({
        status: 'error',
        result: `"${account.title}" is part of the standard chart of accounts. ` +
                `Only a ${COA_ADMINS.join('/')} may edit it.`,
      });
    }

    const result = await Child_Account.findOne({where:{title, id: { [Op.ne]: id } }})
    if(result){
      return res.json({status:'exists', result:result});
    }

    /* WHERE IT IS BEING PUT.
     *
     * `undefined` means the caller is not touching the placement at all and
     * the account stays where it is - which is not the same as null, and the
     * difference matters: null is the top level, and a caller that simply did
     * not send the field would otherwise have every account it renamed torn
     * out of the tree. The old form sent parseInt('') - NaN - for "no parent",
     * which is why this is resolved rather than trusted. */
    const asParentId = (v) => {
      if (v === undefined) return undefined;              // not being changed
      if (v === null || v === '' ) return null;           // the top level
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const nextParentId = asParentId(req.body.parentId);
    const moving = nextParentId !== undefined
      && String(nextParentId ?? '') !== String(account.ChildAccountId ?? '');

    const values = { title };

    if (moving) {
      // An account cannot be its own parent. A leaf has no descendants, so
      // this is the only cycle available to it - but it is available.
      if (nextParentId !== null && String(nextParentId) === String(id)) {
        return res.status(409).json({
          status: 'error', result: 'An account cannot be placed inside itself.',
        });
      }

      // ONLY A LEAF MOVES - see the header.
      const children = await Child_Account.count({ where: { ChildAccountId: id } });
      if (children > 0) {
        return res.status(409).json({
          status: 'error',
          result: `"${account.title}" has ${children} sub-account(s), so it cannot be moved. ` +
                  `Move or remove those first.`,
        });
      }

      let parentCode = '0';
      if (nextParentId !== null) {
        const parent = await Child_Account.findByPk(nextParentId);
        if (!parent) {
          return res.status(404).json({ status: 'error', result: 'That parent account no longer exists.' });
        }
        parentCode = parent.code;
      }

      /* Numbered exactly as a NEW account under that parent is - same helper,
       * same sibling lookup by parent link rather than by a range over `code`.
       * See /createChildAccount for why the range was wrong. */
      const siblings = await Child_Account.findAll({
        where: { ChildAccountId: nextParentId },
        attributes: ['code'],
        raw: true,
      });
      values.ChildAccountId = nextParentId;
      values.code = nextChildAccountCode(parentCode, siblings.map((s) => s.code)).toString();
    }

    await Child_Account.update(values, {where:{id:id}});
    let val;
    val = await getAllAccounts(CompanyId);
    createHistory(employeeId, 'Account', 'Edit', title);
    res.json({
      status:'success',
      result:val,
      // Said out loud: the number changed, and it is on reports.
      ...(moving ? { movedTo: values.code } : {}),
    });
  }
  catch (error) {
    console.error(error)
    res.send({status:'error', result:error});
  }
});

routes.post("/codeParentAccount", async(req, res) => {

  const {id, title, AccountId, CompanyId, code} = req.body
  try {
    result = false
    if(result){
      res.json({status:'exists', result:result});
    }else{
      await Parent_Account.update({title:title, code:code},{where:{id:id}})
      let val;
      val = await getAllAccounts(CompanyId);
      res.json({status:'success', result:val});
    }
  }
  catch (error) {
    res.send({status:'error', result:error});
  }
});

routes.post("/codeChildAccount", async(req, res) => {

  const {id, title, ParentAccountId, CompanyId, code} = req.body
  try {
    let result = false
    if(result){
      res.json({status:'exists', result:result});
    }else{
      await Child_Account.update({title:title, code:code},{where:{id:id}})
      let val;
      val = await getAllAccounts(CompanyId);
      res.json({status:'success', result:val});
    }
  }
  catch (error) {
    res.send({status:'error', result:error});
  }
});

routes.get("/getAllAccounts", async(req, res) => {
  try {
    let result;
    result = await getAccountHierarchy();
    res.json({status:'success', result:result});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/getAccount", async(req, res) => {
  try {
    let result;
    result = await getAccount(req.headers.id);
    res.json({status:'success', result:result});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/getAccountsForTransaction", async(req, res) => {
    let obj = { };
    let ChildObj = { };
    if(req.headers.type=="Bank") {
        ChildObj = {subCategory:'Bank'}
      } else if(req.headers.type=="Cash"){
      ChildObj = {subCategory:'Cash'}
    } else if(req.headers.type=='Adjust') {
        ChildObj = {subCategory:'General'}
    } else if(req.headers.type=='officevouchers') { 
      obj = {
        [Op.and]: [
          { title: { [Op.ne]: "Cash" } },
          { title: { [Op.ne]: "Accounts Recievable" } },
          { title: { [Op.ne]: "Accounts Payble" } },
          { title: { [Op.ne]: "Bank" } },
          { title: { [Op.ne]: "Income" } }, 
          { title: { [Op.ne]: "Selling Expense" } },
          { title: { [Op.ne]: "Taxes" } },
          { title: { [Op.ne]: "Bad Debts" } },
          { title: { [Op.ne]: "Charges" } },
          { title: { [Op.ne]: "Gain & Loss" } },
        ]
      }
    } else if(req.headers.type=='Charges') {
        ChildObj = {subCategory:'General'}
    } else if(req.headers.type=='Taxes') {
        ChildObj = {subCategory:'General'}
    } else if(req.headers.type=='Income' || 'Selling Expense') {
      obj = {
        title:req.headers.type,
      }
    } else {
      obj = { title:req.headers.type }
    }
    try {
      const result = await Child_Account.findAll({
        /* LEAF ACCOUNTS ONLY - what a voucher can post to. A group account
           (one with accounts under it) was offered too: under Adjust on Direct
           Job E/R and Payments & Receipts every 'General' group came up (the
           user, 2026-11-17). /getAccountsForTransactionVouchers already
           filtered them. No group account had been posted to on the CL or SNS
           copies, so nothing in use drops off. */
        where: { ...ChildObj, '$children.id$': null },
        include:[{
          model:Child_Account,
          as: 'parent',
          attributes:['title'],
          where:obj,
          include:[{
            model:Child_Account,
            as: 'parent'
          }]
        }, {
          model: Child_Account,
          as: 'children',
          required: false,   // LEFT JOIN
          attributes: [],
        }]
      });
      res.json({status:'success', result:result});
    }
    catch (error) {
      console.error(error)
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getAccountsForTransactionVouchers", async(req, res) => {
  let obj = { };
  let ChildObj = { };
  if(req.headers.type=="Bank") {
      ChildObj = {subCategory:'Bank'}
    } else if(req.headers.type=="Cash"){
    obj = {
    }
    ChildObj = {subCategory:'Cash'}
  } else if(req.headers.type=='Adjust') {
      ChildObj = {subCategory:'General'}
  } else if(req.headers.type=='All') {

  } else if(req.headers.type=='officevouchers') { 
    obj = {
      [Op.and]: [
        { title: { [Op.ne]: "Cash" } },
        { title: { [Op.ne]: "Accounts Recievable" } },
        { title: { [Op.ne]: "Accounts Payble" } },
        { title: { [Op.ne]: "Bank" } },
        { title: { [Op.ne]: "Income" } }, 
        { title: { [Op.ne]: "Selling Expense" } },
        { title: { [Op.ne]: "Taxes" } },
        { title: { [Op.ne]: "Bad Debts" } },
        { title: { [Op.ne]: "Charges" } },
        { title: { [Op.ne]: "Gain & Loss" } },
      ]
    }
  } else if(req.headers.type=='Charges') {
      ChildObj = {subCategory:'General'}
  } else if(req.headers.type=='Taxes') {
      ChildObj = {subCategory:'General'}
  } else if(req.headers.type=='Income' || 'Selling Expense') {
    obj = {
      title:req.headers.type,
    }
  }else {
    obj = { 
      title:req.headers.type,
    }
  }
  try {
    const result = await Child_Account.findAll({
      where: {
        ...ChildObj,
        '$children.id$': null     // LEAF NODE FILTER
      },
      include: [
        {
          model: Child_Account,
          as: 'children',
          where: { ...obj },
          required: false,         // LEFT JOIN
          attributes: []           // prevents children.id from appearing in SELECT
        }
      ],
      attributes: ['id', 'title', 'code', 'subCategory']
    });
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/getAllChilds", async(req, res) => {
  try {
    const result = await Child_Account.findAll({
      attributes: ["title", "id", "code", "subCategory"],
      include: [
        {
          model: Child_Account,
          as: "children",
          required: false,      // LEFT JOIN
          attributes: []        // We don't need child columns
        }
      ],
      where: {
        '$children.id$': null   // Means: no children exist → leaf accounts
      }
    });
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/getAllParents", async(req, res) => {
  try {
    const result = await Child_Account.findAll({
      attributes:["title", "id","code"],
    });
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/getAllParentswithChildsbyAccountId", async (req, res) => {
  try {
    const whereClause = { ChildAccountId: null }; // root parents only

    const result = await Child_Account.findAll({
      attributes: ["title", "id", "code"],
      where: whereClause,
      include: [{
        model: Child_Account,
        as: "children",
        attributes: ["title", "id", "code"],
        required: false,
      }],
      order: [["id", "ASC"]],
    });
    res.json({ status: "success", result });
  } catch (error) {
    
    console.error("getAllParentswithChildsbyAccountId error:", error);
    res.status(500).json({ status: "error", result: error.message || error });
  }
});

routes.get("/getSEJobChilds", async(req, res) => {
  try {

    const result = await Child_Account.findAll({
      attributes:["title", "id"],
      where:{title:JSON.parse(req.headers.title)},
      include:[{
        model:Parent_Account,
        where:{CompanyId:req.headers.companyid},
        attributes:["title", "CompanyId"]
      }]
    });

    res.json({status:'success', result:result});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/getSEJobPartyChilds", async(req, res) => {
  const clientObj = {
    model:Client_Associations,
    where:{CompanyId:req.headers.companyid, ClientId:req.headers.clientid},
    attributes:["id"],
    include:[{
      model:Child_Account,
      attributes:["id", "title"],
    }]
  }
  const vendorObj = {
    model:Vendor_Associations,
    where:{CompanyId:req.headers.companyid, VendorId:req.headers.clientid},
    include:[{
      model:Child_Account,
      attributes:["id", "title"],
    }]
  }
  try {
    const result = await Parent_Account.findOne({
      where:{
        title:req.headers.title,
        CompanyId:req.headers.companyid,
      },
      attributes:["id"],
      include:[req.headers.partytype=="vendor"?vendorObj:clientObj]
    });

    res.json({status:'success', result:req.headers.partytype!="vendor"? result.Client_Associations[0].Child_Account : result.Vendor_Associations[0].Child_Account });
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/childForJobApproval", async(req, res) => {
  const clientObj = {
    model:Client_Associations,
    where:{CompanyId:req.headers.companyid, ClientId:req.headers.clientid},
    attributes:["id"],
    include:[{
      model:Child_Account,
      attributes:["id", "title"],
    }]
  }
  const vendorObj = {
    model:Vendor_Associations,
    where:{CompanyId:req.headers.companyid, VendorId:req.headers.clientid},
    include:[{
      model:Child_Account,
      attributes:["id", "title"],
    }]
  }
  try {
    const result = await Parent_Account.findOne({
      where:{
        CompanyId:req.headers.companyid,
      },
      attributes:["id"],
      include:[req.headers.partytype=="vendor"?vendorObj:clientObj]
    });

    res.json({status:'success', result:req.headers.partytype!="vendor"? result.Client_Associations[0].Child_Account : result.Vendor_Associations[0].Child_Account });
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

function buildChildInclude(depth, companyId) {
  // Base case: last layer → attach Voucher_Heads + Vouchers
  if (depth === 1) {
    return {
      model: Child_Account,
      as: "children",
      attributes: ["title"],
      include: [
        {
          model: Voucher_Heads,
          attributes: ["amount", "type"],
          include: [
            {
              model: Vouchers,
              attributes: ["id"],
              where: { CompanyId: companyId }
            }
          ]
        }
      ]
    };
  }

  // Recursive case: build children → then deeper children
  return {
    model: Child_Account,
    as: "children",
    attributes: ["title"],
    include: [
      buildChildInclude(depth - 1, companyId)
    ]
  };
}

routes.get("/balanceSheetOld", async(req, res) => {
  try{
    const accounts = await getAccountVoucherHierarchy(null, parseInt(req.headers.companyid));

    res.json({status:'success', result:{ accounts }});
  }catch(error){
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
});


routes.get("/balanceSheet", async(req, res) => {
  try {
    const layers = 4; // make this dynamic later if you want

    const resultOne = await Child_Account.findAll({
      attributes: ["title"],
      where: { title: "ASSETS" },
      include: [
        buildChildInclude(layers, req.headers.companyid)
      ]
    });
    const resultTwo = await Child_Account.findAll({
      attributes:["title"],
      where:{title:'LAIBILITY'},
      include:[{
        model:Child_Account,
        as: 'children',
        // where:{ CompanyId:req.headers.companyid },
        attributes:["title"],
        include:[{
          model:Child_Account,
          as: 'children',
          attributes:["title"],
          include:[{
            model:Voucher_Heads,
            attributes:["amount", "type"],
            include:[{
              model:Vouchers,
              attributes:["id"],
              where:{CompanyId:req.headers.companyid}
            }]
          }]
        }]
      }]
    });
    const capital = await Child_Account.findAll({
      attributes:["title"],
      where:{title:'CAPITAL'},
      include:[{
        model:Child_Account,
        as: 'children',
        where:{ title:"Capitals" },
        attributes:["title"],
        include:[{
          model:Child_Account,
          as: 'children',
          attributes:["title"],
          include:[{
            model:Voucher_Heads,
            attributes:["amount", "type"],
            include:[{
              model:Vouchers,
              attributes:["id"],
              where:{CompanyId:req.headers.companyid}
            }]
          }]
        }]
      }]
    });
    const drawings = await Child_Account.findAll({
      attributes:["title"],
      where:{title:'EXPENSE'},
      include:[{
        model:Child_Account,
        as: 'children',
        where:{ title:"Drawings" },
        attributes:["title"],
        include:[{
          model:Child_Account,
          as: 'children',
          attributes:["title"],
          include:[{
            model:Voucher_Heads,
            attributes:["amount", "type"],
            include:[{
              model:Vouchers,
              attributes:["id"],
              where:{CompanyId:req.headers.companyid}
            }]
          }]
        }]
      }]
    });
    const selling = await Child_Account.findAll({
      attributes:[ "title" ],
      where:{title:"REVENUE"},
      include:[{
        model:Child_Account,
        as: 'children',
        where:{ title:["Cash", "Bank"] },
        attributes:[ "title" ],
        include:[{
          model:Child_Account,
          as: 'children',
          attributes:[ "title" ],
          include:[{
            model:Voucher_Heads,
            attributes:[ "amount", "type" ],
            include:[{
              model:Vouchers,
              where:{type:["Job Reciept"], CompanyId:req.headers.companyid},
              attributes:["id", "voucher_Id", "type"]
            }]
          }]
        }]
      }]
    });
    const costing = await Child_Account.findAll({
      attributes:[ "title" ],
      where:{id:[3]},
      include:[{
        model:Child_Account,
        as: 'children',
        where:{ title:["Cash", "Bank"] },
        attributes:["title"],
        include:[{
          model:Child_Account,
          as: 'children',
          attributes:["title"],
          include:[{
            model:Voucher_Heads,
            attributes:["amount", "type"],
            include:[{
              model:Vouchers,
              where:{type:["Job Payment", "Expenses Payment"], CompanyId:req.headers.companyid},
              attributes:[ "id", "voucher_Id", "type" ],
            }]
          }]
        }]
      }]
    });
    res.json({ status:'success', 
      result:{
        assets:resultOne,
        liabilities:resultTwo,
        capital:capital,
        drawings:drawings,
        selling:selling,
        costing:costing,
      }
    });
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result:error });
  }
});

routes.get("/voucherLedger", async(req, res) => {
  try {
    const currencyCondition = req.headers.currency!="ALL"?{ currency:req.headers.currency }:null
    const childAccountCondition = req.headers.id
      ? { ChildAccountId: req.headers.id }
      : { ChildAccountId: { [Op.ne]: null } };
      const oldCondition = req.headers.old!=true?{ type: { [Op.ne]: "Opening Invoice" } }:{ type: "Opening Invoice" }
    const result = await Voucher_Heads.count({
      where:{
        ...childAccountCondition,
        ...oldCondition,
        createdAt:{
          [Op.gte]: moment(req.headers.from).toDate(),
          [Op.lte]: moment(req.headers.to).add(1, 'days').toDate(),
        }
      },
      include:{
        model:Vouchers,
        required: false,
        where:{
          CompanyId: req.headers.companyid, 
          ...currencyCondition
        },
      }
    })
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
});   

routes.get("/getByDate", async(req, res) => {
  try {
    const result = await Child_Account.findAll({
      where:{ParentAccountId:req.headers.id},
      attributes:['title'],
      include:[
        {
          model:Voucher_Heads,
          where:{
            createdAt: {
              [Op.lte]: moment(req.headers.to).add(1, 'days').toDate(),
            }
          },
          attributes:['amount', 'createdAt'],
          include:[{
            model:Vouchers,
            attributes:['voucher_Id', 'vType'],
            where:{}
          }]
        }
      ]
    }) 
    res.json({status:'success', result:result});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

/**
 * The rows a ledger is built from.
 *
 * Extracted so /getLedger and /getLedgerPrintData cannot drift: one is read by
 * the screen with a login session, the other by the headless browser that turns
 * that same screen into a PDF, and a ledger that differed between the two would
 * be a document disagreeing with what it was printed from.
 *
 * Everything up to the `to` date is returned, not just the range - the opening
 * balance is worked out from what came before it. That arithmetic lives in the
 * frontend's LedgerReport, which is why this is rows rather than a report.
 *
 * Each row carries `Voucher.createdOn` - when its voucher was entered - which
 * the screen orders a day's entries by: every entry in the order it was made.
 * The day is the one the screen SHOWS, in the reader's time zone, so that
 * part of the ordering is done there (functions/ledgerOrder), not here.
 */
const fetchLedgerRows = async ({ id, to, currency, company }) => {
  const currencyCondition = currency != "PKR" ? { currency } : null;

  const childAccountCondition = id != 'undefined'
    ? { ChildAccountId: id }
    : { ChildAccountId: { [Op.ne]: null } };

  return Voucher_Heads.findAll({
    raw:true,
    where:{
      ...childAccountCondition,
      createdAt:{
        [Op.lte]: moment(to, "DD-MM-YYYY", true).add(1, "days").toDate(),
      },
    },
    attributes:['amount', 'type', 'narration', 'createdAt', 'defaultAmount', 'accountType'],
    include:[{
      model:Vouchers,
      attributes:['voucher_Id', 'id', 'type', 'currency', 'exRate', 'vType', 'chequeNo', 'chequeDate', 'createdOn'],
      where:{
        ...currencyCondition,
        CompanyId: company,
      }
    },
    {
      model:Child_Account,
      attributes:['title'],
    }],
    /* By date, then in the order the vouchers were made. createdAt alone left
     * every tie in whatever order Postgres returned it - and ties are the
     * normal case: a migrated SI / PI stands on its invoice's date at
     * midnight, and a freight invoice on its sailing date, so a day's
     * invoices all share one timestamp and came out jumbled. The voucher id
     * follows entry order - migrated vouchers were written in Climax's own Id
     * order - and the line id keeps a voucher's own lines together. */
    order:[["createdAt","ASC"], ["VoucherId","ASC"], ["id","ASC"]],
  });
};

routes.get("/getLedger", async(req, res) => {
  try {
    const result = await fetchLedgerRows({
      id: req.headers.id,
      to: req.headers.to,
      currency: req.headers.currency,
      company: req.headers.company,
    });
    res.json({status:'success', result:result});
  } catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
});

/**
 * The same rows, for the BARE PRINT PAGE - no login session involved.
 *
 * Puppeteer loads /ledger-print with a signed token and has no cookie to
 * present, exactly as it does for an invoice (see /invoice/getPrintData). The
 * token carries the account, range, currency and company it was issued for, so
 * this reads its parameters from the token and ignores anything in the request
 * - a URL cannot be edited into someone else's ledger.
 */
routes.get("/getLedgerPrintData", async (req, res) => {
  try {
    let params;
    let print;
    try {
      ({ params, print } = readLedgerPrintToken(String(req.headers.printtoken || '')));
    } catch (e) {
      return res.status(401).json({ status: 'error', result: 'This print link is invalid or has expired.' });
    }

    const result = await fetchLedgerRows(params);
    /* THE LETTERHEAD travels with the rows, as an invoice's does with its
     * print data (/invoice/getPrintData): the print page has no session, so
     * the company list the app loads after login is not there, and the PDF
     * printed no name, logo or address. The company the ledger is for, or -
     * for all companies - the one the user had selected. */
    const letterheadId = /^\d+$/.test(String(params.company || ''))
      ? params.company
      : (/^\d+$/.test(String(print.letterhead || '')) ? print.letterhead : null);
    const letterhead = letterheadId ? await db.Company.findOne({
      where: { id: letterheadId },
      attributes: ['id', 'title', 'short', 'logo', 'printLogo', 'address', 'phone', 'email', 'web', 'ntn', 'strn'],
      raw: true,
    }) : null;
    res.json({ status: 'success', result, params, letterhead, printedBy: print.printedBy || '' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

/**
 * The ledger as a PDF.
 *
 * Renders the SCREEN, headlessly - it does not rebuild the report server side.
 * A ledger's opening balance, its ex-rate handling and its exclusion of system
 * accounts on a foreign-currency ledger are all worked out in the frontend's
 * LedgerReport; a second implementation here would be a second set of numbers
 * to keep in step, and the one printed on a customer's statement is the worst
 * place to discover they have drifted apart.
 *
 * Streamed as an attachment rather than saved: nothing needs to keep it, and a
 * ledger PDF on disk is a copy of the books that no retention rule covers.
 */
routes.get("/getLedgerPdf", async (req, res) => {
  try {
    const params = {
      id: req.headers.id,
      from: req.headers.from,
      to: req.headers.to,
      currency: req.headers.currency,
      company: req.headers.company,
    };
    if (!params.to || !params.from) {
      return res.status(400).json({ status: 'error', result: 'A from and to date are required.' });
    }

    const name = String(req.headers.name || 'ledger');
    const pdf = await renderLedgerPdf({
      ...params,
      name,
      // Whose letterhead (the screen's choice when the ledger is for all
      // companies) and who printed it - see getLedgerPrintData.
      token: signLedgerPrintToken(params, {
        letterhead: req.headers.letterhead,
        printedBy: req.user?.username,
      }),
    });

    // A filename the browser will accept: the account title can carry slashes,
    // quotes and commas, none of which belong in a Content-Disposition.
    const safeName = name.replace(/[^\w\-. ]+/g, '_').trim() || 'ledger';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName} ${params.from} to ${params.to}.pdf"`);
    res.send(pdf);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// routes.get("/getLedgerClosingBalance", async(req, res) => {
//   try {
//     const result = await Voucher_Heads.findAll({
//       raw:true,
//       where:{
//         ChildAccountId:req.headers.id
//       },
//       attributes:['amount', 'type', 'defaultAmount'],
//       // include:[{
//       //   model:Vouchers,
//       //   attributes:['voucher_Id', 'id', 'type', 'currency', 'exRate', 'vType'],
//       // }],
//     })
//     res.json({status:'success', result:result});
//   } catch (error) {
//     res.status(500).json({status:'error', result:error});
//   }
// });

routes.get("/getLedgerClosingBalance", async (req, res) => {
  try {
    const { id } = req.headers;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "ChildAccountId is required",
      });
    }

    const ledger = await Voucher_Heads.findAll({
      raw: true,
      where: {
        ChildAccountId: Number(id),
      },
      include: [
        {
          model: Vouchers,
          attributes: ["id", "vType"],
          where: { CompanyId: req.headers.company },
        }
      ],
      attributes: ["type", "defaultAmount"],
    });

    let closingBalance = 0;

    for (const entry of ledger) {
      const amount = parseFloat(entry.defaultAmount || 0);

      if (entry.type === "debit") {
        closingBalance += amount;
      } else if (entry.type === "credit") {
        closingBalance -= amount;
      }
    }

    return res.json({
      status: "success",
      closingBalance,
    });

  } catch (error) {
    console.error("Ledger Closing Balance Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

routes.get("/parentAccounts", async(req, res) => {
  try {
    const results = await Parent_Account.findAll({where: {CompanyId : req.headers.id}})
    
      res.json({status:'success', result:results});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.post("/accountCreate", async(req, res) => {
  let obj = req.body;
  try {
    // Seed the chart of accounts for the companies that actually exist.
    //
    // This used to be `for (let i = 1; i <= 3; i++)`, hardcoded to the three
    // companies of the install it was written on. On any other install that
    // creates parent accounts for company ids that do not exist - and misses
    // any company whose id is above 3, leaving it with no chart of accounts at
    // all, which means no invoicing.
    const companies = await db.Company.findAll({ attributes: ['id'], raw: true });
    if (!companies.length) {
      return res.status(400).json({
        status: 'error',
        result: 'No companies exist yet. Create the company in Config first - the chart of accounts is created per company.',
      });
    }
    for (const company of companies) {
      const i = company.id;
      const newObj = obj.map((x) => ({...x, CompanyId:i, editable:'0'}));
      // for...of, not forEach(async): forEach ignores the promises its
      // callback returns, so the handler used to respond 'success' while
      // these creates were still in flight - and any rejection surfaced as
      // an unhandled rejection instead of the catch below.
      for (const x of newObj) {
        const result = await Parent_Account.create(x)
        if(x.childAccounts.length > 0) {
          const tempAccounts = x.childAccounts.map((y) => ({...y, ParentAccountId:result.id}));
          await Child_Account.bulkCreate(tempAccounts).catch((z)=>console.log(z));
        }
      }
    }
    await res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.post("/createOpeningBalances", async(req, res) => {
  try {
    const fiscalYear = await resolveSelectedFiscalYear(req.body.fiscalYearId);
    // The day before the selected year opens - see functions/voucherDate. The
    // voucher and its lines both: the ledger places a line by its own date.
    const postedAt = openingBalanceDate(fiscalYear);
    const setVoucherHeads = (id, heads) => (heads || []).map((x) => ({
      ...x,
      VoucherId: id,
      amount: `${x.amount}`,
      createdAt: postedAt,
    }));
    // Was scoped by vType alone - no company, no fiscal year - so opening
    // balance vouchers drew their number from a pool shared across every
    // company and every year. Now scoped like every other numbering site.
    const nextNo = await nextVoucherNo(Vouchers, {
      vType: req.body.vType,
      CompanyId: req.body.companyId,
      suffix: fiscalYear.suffix,
    });
    const result = await Vouchers.create({
      ...req.body,
      createdAt: postedAt,
      tranDate: postedAt.toISOString(),
      CompanyId:req.body.companyId,
      voucher_No: nextNo,
      voucher_Id: voucherId(await readNumbering(), {
        vType: req.body.vType,
        company: await companyShort(req.body.companyId),
        seq: nextNo,
        suffix: fiscalYear.suffix,
      }),
      FiscalYearId: fiscalYear.id,
    });
    let dataz = await setVoucherHeads(result.id, req.body.Voucher_Heads);
    await Voucher_Heads.bulkCreate(dataz);
    res.json({status:'success', result});
  }
  catch (error) {
    console.error(error)
    res.status(500).json({status:'error', result: error.message || error});
  }
});

routes.get("/getOpeningBalances", async(req, res) => {
  try {
    const results = await Vouchers.findAll({
      where: {
        CompanyId: req.headers.id,
        vType: "OP",
      },
      include: [
        {
          model: Voucher_Heads,
          include: [
            {
              model: Child_Account,
            },
          ],
        },
      ],
      order: [["createdAt", "DESC"]], // ✅ latest first
    });
    
    res.json({status:'success', result:results});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/getPartySetupAccounts", async (req, res) => {
  try {

    const [accounts] = await db.sequelize.query(`
      WITH RECURSIVE account_tree AS (
          -- Start nodes: the ASSETS and LIABILITY subtrees. A party's ledger
          -- account belongs under receivables or payables, so REVENUE, EXPENSE
          -- and CAPITAL are deliberately not offered.
          --
          -- MATCHED BY PREFIX, not by an exact list. The list used to be
          -- ('ASSETS','LIABILITY','LAIBILITY') - three spellings guessed in
          -- advance - and an install whose root is titled "Liabilities"
          -- (plural, spelled correctly) matched none of them. The whole
          -- subtree then vanished from the selector: not just the root, but
          -- Current Liabilities and Accounts Payable under it, because the
          -- recursion had nothing to descend from. LIKE covers the plural and
          -- the legacy misspelling 'LAIBILITY' without having to enumerate
          -- every variant an install might use.
          SELECT id, title, "ChildAccountId"
          FROM "Child_Accounts"
          WHERE UPPER(title) LIKE 'ASSET%'
             OR UPPER(title) LIKE 'LIABILIT%'
             OR UPPER(title) LIKE 'LAIBILIT%'

          UNION ALL

          -- Fetch children recursively
          SELECT c.id, c.title, c."ChildAccountId"
          FROM "Child_Accounts" c
          INNER JOIN account_tree t ON c."ChildAccountId" = t.id
      )

      -- Every account in those subtrees EXCEPT the parties' own ledger
      -- accounts.
      --
      -- This used to read "only accounts that have at least one child", which
      -- was a proxy for "is a group account rather than a party's own" - and
      -- it was wrong in the one case that matters most: a newly created group
      -- account has no children yet, so it could never be picked, so the FIRST
      -- party under it could never be created. A fresh Accounts Payable was
      -- permanently unusable.
      --
      -- Client_Associations is the exact test instead: every party ledger
      -- account is created together with a row there (routes/clients and
      -- functions/carrierParty both do it in one transaction), and nothing
      -- else writes that table. So this excludes precisely the accounts that
      -- belong to a party - which are also the thousands of rows that would
      -- otherwise swamp the list - and keeps every group account, childless or
      -- not.
      --
      -- The "or it has children" arm is the safety net. /createClientAssociations
      -- attaches a party to whatever account id it is handed, so a party CAN
      -- end up hanging off a group account like Accounts Payable itself. On the
      -- party test alone that would hide Accounts Payable from this list -
      -- exactly the failure being fixed. An account with children below it is
      -- acting as a parent whatever else is attached to it, so it stays.
      --
      -- DISTINCT because an install with a nested account matching the anchor
      -- as well as its own ancestor would otherwise walk that subtree twice
      -- and list it twice.
      SELECT DISTINCT a.id, a.title, a."ChildAccountId"
      FROM account_tree a
      WHERE NOT EXISTS (
          SELECT 1
          FROM "Client_Associations" ca
          WHERE ca."ChildAccountId" = a.id
      )
      OR EXISTS (
          SELECT 1
          FROM "Child_Accounts" ch
          WHERE ch."ChildAccountId" = a.id
      )
      ORDER BY a.id;
    `);

    res.json({ status: "success", result: accounts });

  } catch (error) {
    console.error(error);
    res.status(500).json({status:"error", result: error });
  }
});




//////////////////// ------------ Backup Routes ----------- /////////////////

routes.post("/deleteAll", async(req, res) => {
  try {
    res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});
routes.post("/deleteJobs", async(req, res) => {
  try {
    res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});
routes.post("/deleteInvoices", async(req, res) => {
  try {
    res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});
routes.post("/testDeleteVouchers", async (req, res) => {
  try {
    await res.json({ status: "success"});
  } catch (error) {
    res.status(500).json({status:"error", result: error });
  }
});
routes.post("/countAll", async(req, res) => {
  try {
    const clients = await Clients.count();
    const vendors = await Vendors.count();
    res.json({
      status:'success',
      result:{
        clients,
        vendors
      }
    });
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});
routes.post("/nonGlInBulk", SYSTEM, async(req, res) => {

  let obj = req.body;
  try {
    // for...of, not forEach(async) - see /createAccountsInBulk above.
    for (const x of obj) {
      let value = {...x};
      value.accountRepresentatorId = null;
      value.salesRepresentatorId   = null;
      value.docRepresentatorId     = null;
      value.authorizedById         = null;
      value.createdBy              = "";
      await Clients.create({...value});
    }
    await res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});
routes.post("/createVendorInBulk", SYSTEM, async(req, res) => {

  const createAccountList = (parent, id) => {
    let result = [];
    parent.forEach((x)=>{
      x.dataValues.Child_Accounts.forEach((y)=>{
        result.push({ParentAccountId:x.id, ChildAccountId:y.dataValues.id, CompanyId:x.CompanyId, VendorId:id})
      })
    })
    return result;
  }
  let obj = req.body;
  try {
    // for...of, not forEach(async) - see /createAccountsInBulk above.
    for (const x of obj) {
      let accountCheck = await Parent_Account.findAll({
        where:{title:x.account.parent},
        attributes:['id', 'title', 'CompanyId'],
        include:[{
          model:Child_Account,
          where:{title:x.account.account_title},
          attributes:['id', 'title'],
        }]
      })
      let value = {...x};
      value.accountRepresentatorId = null;
      value.salesRepresentatorId   = null;
      value.docRepresentatorId     = null;
      value.authorizedById         = null;
      value.createdBy              = "";
      let result = await Vendors.create({...value});
      await Vendor_Associations.bulkCreate(createAccountList(accountCheck, result.dataValues.id))
    }
    await res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});
routes.post("/createClientInBulk", SYSTEM, async(req, res) => {

  const createAccountList = (parent, id) => {
    let result = [];
    parent.forEach((x)=>{
      x.dataValues.Child_Accounts.forEach((y)=>{
        result.push({ParentAccountId:x.id, ChildAccountId:y.dataValues.id, CompanyId:x.CompanyId, ClientId:id})
      })
    })
    return result;
  }

  let obj = req.body;
  try {
    // for...of, not forEach(async) - see /createAccountsInBulk above.
    for (const x of obj) {
      let accountCheck = await Parent_Account.findAll({
        where:{title:x.account.parent},
        attributes:['id', 'title', 'CompanyId'],
        include:[{
          model:Child_Account,
          where:{title:x.account.account_title},
          attributes:['id', 'title'],
        }]
      });
      let value = {...x};
      value.accountRepresentatorId = null;
      value.salesRepresentatorId   = null;
      value.docRepresentatorId     = null;
      value.authorizedById         = null;
      value.createdBy              = "";
      let result = await Clients.create({...value});
      await Client_Associations.bulkCreate(createAccountList(accountCheck, result.dataValues.id));
    }
    await res.json({status:'success'});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});
routes.post("/importAccounts", SYSTEM, async(req, res) => {
  try{
    let obj = req.body;
    const accounts = await Accounts.findAll()
    const importCompanies = await db.Company.findAll({ attributes: ['id'], raw: true });
    if (!importCompanies.length) {
      return res.status(400).json({
        status: 'error',
        result: 'No companies exist yet. Create the company in Config first - accounts are created per company.',
      });
    }
    for(let x of obj.pAccounts){
      let parentId = 0
      accounts.forEach((y) => {
        if(x.Parent.AccountName==y.title){
          parentId = y.id
        }
      })
      let temp = {
        title:x.AccountName,
        editable: 0,
        AccountId: parentId,
      }
      // One parent account per company that exists. This was hardcoded to
      // CompanyId 1 and 3 - the two operating companies of the install it was
      // written on - so anywhere else it created accounts for companies that
      // do not exist and none for the ones that do.
      for (const company of importCompanies) {
        await Parent_Account.create({ ...temp, CompanyId: company.id })
      }
    }

    const pAccounts = await Parent_Account.findAll()

    for(let x of obj.cAccounts){
      let parentId = 0
      for(let y of pAccounts){
        if(x.Parent.AccountName==y.title){
          parentId = y.id
          let temp = {
            title:x.AccountName,
            editable: 0,
            subCategory: x.SubCategory?x.SubCategory.SubCategory:"General",
            ParentAccountId: parentId,
          }
          await Child_Account.create({
            ...temp,
          })
        }
      }
    }
    res.json({status:'success'});
  }catch(error){
    console.error(error)
    res.status(500).json({status:'error', result:error});
  }
})

/**
 * Seed the default chart of accounts on a fresh install.
 *
 *   GET  /accounts/chartOfAccounts/seed   what is missing (read-only)
 *   POST /accounts/chartOfAccounts/seed   create it
 *
 * Exposed as a route because the sealed Docker image does not ship scripts/ -
 * build/seal-tree.js copies only index.js, package.json, routes, models,
 * functions and config - so a compose deployment has no other way to do this,
 * and without a chart of accounts no client can be given a ledger account and
 * no invoice can be raised.
 *
 * Never automatic: an install migrating from Climax takes its chart from the
 * legacy system, and /accounts/importAccount creates those rows with ids taken
 * from the legacy data. Seeding first would occupy those ids and collide.
 */
routes.get("/chartOfAccounts/seed", SYSTEM, async (req, res) => {
  try {
    const result = await seedChartOfAccounts({ apply: false });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error('chartOfAccounts/seed (report) failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

routes.post("/chartOfAccounts/seed", SYSTEM, async (req, res) => {
  try {
    const result = await seedChartOfAccounts({ apply: true });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error('chartOfAccounts/seed (apply) failed:', error);
    res.status(500).json({ status: 'error', result: error.message || error });
  }
});

// The rewritten chart-of-accounts migration: plan, apply, verify.
//
// A separate router rather than more handlers here. /accounts/importAccount
// above is left exactly as it was - it is what existing installs ran, and
// nothing is served by breaking it - but it is not what a new migration should
// use. See routes/accounts/coaMigration.js for why.
routes.use('/', require('./coaMigration'));

module.exports = routes;
