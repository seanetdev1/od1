const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const db = require("../../models");
const moment = require("moment");
const routes = require('express').Router();
const { Employees } = require("../../functions/Associations/employeeAssociations");
const { Clients, Client_Associations } = require("../../functions/Associations/clientAssociation");
const { Child_Account, Parent_Account } = require("../../functions/Associations/accountAssociations");
const { Voucher_Heads } = require('../../functions/Associations/voucherAssociations');
const { createHistory } = require('../../functions/history');
const {
  OPERATIONAL_REFS, FINANCIAL_REFS, OUTSTANDING_SQL, PAID_TOLERANCE,
} = require('../../functions/partyMerge');
const { types } = require('pg');
const requireDesignation = require('../../functions/requireDesignation');
// Ledger-code allocation and party numbering are SHARED with Setup > Carriers,
// which creates a party for a carrier so its charges can be invoiced. Two
// copies of either rule would drift, and the drift would only show up as
// duplicate codes long after the fact.
const { allocateChildAccountCode: allocateCode } = require('../../functions/carrierParty');
const { nextPartyCode } = require('../../functions/partyCode');
const { creditLimitsFrom } = require('../../functions/partyCredit');

const CEO_CFO_ADMIN = requireDesignation(['CEO', 'CFO', 'admin']);
const { isSystem } = require('../../functions/systemAccess');
const { grantsFor } = require('../../functions/permissions/grants');
const { partyKinds, sideOfAccount, MODULE_OF_KIND } = require('../../functions/partyKind');

/**
 * The code for the ledger account a new party gets, under `parentId`.
 *
 * Both places below used to work this out in SQL, with
 * MAX(CAST(code AS INTEGER)) / ORDER BY CAST(code AS INTEGER). That overflows
 * int4 as soon as the chart of accounts is four levels deep - a level-4 code
 * is thirteen digits and int4 holds ten - and Postgres answers 22003, so
 * creating a party under such a parent failed with a 500 every time.
 *
 * Now it asks for the siblings and takes the maximum in JS, which is what
 * routes/accounts createChildAccount already does. Two consequences beyond
 * fixing the crash, both intended:
 *
 *   - The FIRST party under a parent now gets parentCode * 10000 + 1 rather
 *     than the literal 1 the old `maxCode + 1 || 1` produced. A code of "1"
 *     sat outside its parent's block entirely and collided with the top-level
 *     accounts.
 *   - Siblings whose code is not numeric are ignored rather than excluded by a
 *     regexp in the query; same outcome, one less thing in SQL.
 *
 * The body now lives in functions/carrierParty.js, because Setup > Carriers
 * gives a carrier a ledger account too and two allocators would eventually
 * hand out the same code. This wrapper keeps the local (parentId, transaction)
 * shape both call sites below already use.
 */
const allocateChildAccountCode = (parentId, transaction) =>
  allocateCode(Child_Account, parentId, transaction);

// Party create/update/list/view is open to every authenticated user, but only
// these designations may give a party a ledger (a parent account). For anyone
// else we force the party to be non-GL server-side (strip pAccountName) so the
// frontend checkbox can never be bypassed - a party that needs a ledger must be
// set up by accounts (CEO/CFO/admin).
//
// Or (since 2026-10-10) a user whose permissions are set in the grid, with the
// right to edit that kind of party - customers for a receivable ledger,
// vendors for a payable one (the user's request: separate access for Non-GL,
// Customer and Vendor). A user still on the old access names has exactly the
// designation rule, as before.
const LEDGER_DESIGNATIONS = ['ceo', 'cfo', 'admin'];
const canCreateLedger = async (req) => {
  if (LEDGER_DESIGNATIONS.includes((req.user?.designation || '').toLowerCase())) return true;
  const parent = req.body?.pAccountName;
  if (!parent) return true;                 // no ledger asked for
  if (isSystem(req)) return true;
  const g = await grantsFor(req.user.id);
  if (g.all) return true;
  if (!g.granular) return false;
  const side = await sideOfAccount(db, parent);
  return g.perms.has(`${side === 'vendor' ? 'vendors' : 'customers'}:edit`);
};

/* The kinds of party this user may see on the Parties list - a Set, or null
   for all of them. */
const viewableKinds = async (req) => {
  if (!req.user || isSystem(req)) return null;
  const g = await grantsFor(req.user.id);
  if (g.all) return null;
  const kinds = Object.entries(MODULE_OF_KIND).filter(([, m]) => g.perms.has(`${m}:view`)).map(([k]) => k);
  return kinds.length === Object.keys(MODULE_OF_KIND).length ? null : new Set(kinds);
};

const validTypes = [
  "Slot Operator",
  "Buyer",
  "Terminal",
  "Depot",
  "Principal",
  "Stevedore",
  "Cartage",
  "Drayman",
  "Trucking",
  "Air Line",
  "Buying House",
  "Warehouse",
  "Delivery Agent",
  "Shipping Line",
  "CHA/CHB",
  "Transporter",
  "Indentor",
  "Commission Agent",
  "Overseas Agent",
  "Potential Customer",
  "Non operational Party",
  "Forwarder/Coloader",
  "Local Vendor"
];

const createChildAccounts = (list, name) => {
    let result = [];
    list.forEach((x)=>{
        result.push({title:name, ChildAccountId:x.id, subCategory:'Customer'})
    })
    return result;
}
const createAccountList = (parent, child, id) => {
    let result = [];
    parent.forEach((x, i)=>{
        result[i] = {
            ClientId:id,
            CompanyId:x.CompanyId,
            ParentAccountId:x.id,
            ChildAccountId:null
        }
        child.forEach((y, j)=>{
            if(y.ParentAccountId==x.id){
                result[i].ChildAccountId=child[j].id
            }
        })
    })
    return result;
}

routes.post("/addClient", CEO_CFO_ADMIN, async(req, res)=>{
    try{
        const result = await Clients.create(req.body)
        res.json({
            status:'success', 
            result:result.dataValues
        });
    }catch(e){
        res.status(500).json({status:'error', result:e});
        console.error(e)
    }
})

routes.post("/createClientAssociations", async(req, res) => {
    try{
        const result1 = await Clients.findOne({
            attributes:['id', 'name'],
            where:{
                name: req.body.name
            }
        })
        const ChAcc = await Child_Account.findOne({
            where:{
                id: req.body.ChildAccountId
            },
            attributes:['id', 'title', 'ParentAccountId'],
        })
        const result = await Client_Associations.create({
            ClientId: result1.dataValues.id,
            CompanyId: req.body.companyId,
            ParentAccountId: ChAcc.dataValues.ParentAccountId,
            ChildAccountId: ChAcc.dataValues.id
        });        
        res.json({status: 'success', result:result.dataValues});
    }catch(e){
        res.status(500).json({status:'error', result:e});
        console.error(e)
    }
})

routes.post("/createClient", async (req, res) => {
  // Non-privileged users can only create name-only (non-GL) parties.
  if (!(await canCreateLedger(req))) req.body.pAccountName = '';
  // Checked before anything is written - see functions/partyCredit.
  let credit;
  try { credit = creditLimitsFrom(req.body); }
  catch (error) { return res.json({ status: 'error', message: error.message }); }
  const resultPayload = await db.sequelize.transaction(async (t) => {
    try {
      let value = { ...req.body, ...credit };
      // Stored as a comma-separated string. An AVIATION install does not ask
      // for operations at all (the four freight ones mean nothing to an
      // airline - see Setup/Client/CreateOrEdit), so the field can arrive
      // absent; joining undefined would take the whole save down with a
      // TypeError rather than saving a party with no operations, which is
      // exactly what is wanted there.
      value.operations = Array.isArray(value.operations) ? value.operations.join(', ') : (value.operations ?? null);
      value.types = Array.isArray(value.types) ? value.types.join(', ') : (value.types ?? null);
      delete value.id;

      // Newest party's code + 1, skipping the eight legacy rows whose code is
      // not a number. Shared with Setup > Carriers - see functions/partyCode.js
      // for why the rule is worth having in one place.
      const nextCode = await nextPartyCode(Clients, t);

      value.accountRepresentatorId = value.accountRepresentatorId == "" ? null : value.accountRepresentatorId;
      value.salesRepresentatorId = value.salesRepresentatorId == "" ? null : value.salesRepresentatorId;
      value.docRepresentatorId = value.docRepresentatorId == "" ? null : value.docRepresentatorId;
      value.authorizedById = value.authorizedById == "" ? null : value.authorizedById;
      req.body.pAccountName ? value.nongl = '0' : value.nongl = '1';

      const check2 = await Clients.findOne({
        where: { name: value.name },
        transaction: t
      });

      if (check2) {
        // Early return inside a managed transaction throws to rollback;
        // we'll bubble a custom object and handle it below.
        return { earlyExit: true, payload: { status: 'exists', message: "Client Already Exists" } };
      }

      const result = await Clients.create(
        { ...value, code: nextCode },
        { transaction: t }
      );

      if (req.body.pAccountName) {
        const accounts = await Child_Account.findOne({
          where: { id: req.body.pAccountName },
          transaction: t
        });

        const account = await Child_Account.create({
          title: result.name,
          subCategory: 'Customer',
          editable: false,
          code: await allocateChildAccountCode(accounts.id, t),
          ChildAccountId: accounts.id
        }, { transaction: t });
        await Client_Associations.create({
          ClientId: result.id,
          ChildAccountId: account.id,
        }, { transaction: t });
        }

      // Non-DB side-effect; left as-is (doesn't need transaction, but fine to keep)
      createHistory(req.body.employeeId, 'Client', 'Create', result.name);
      return { earlyExit: false, payload: { status: 'success', result } };

    } catch (error) {
      // Throwing here triggers automatic rollback by Sequelize
      throw error;
    }
  })
  .then((outcome) => {
    if (outcome.earlyExit) {
      return res.json(outcome.payload);
    }
    return res.json(outcome.payload);
  })
  .catch((error) => {
    console.error(error);
    return res.status(500).json({status:'error', result: error });
  });
});

routes.post("/createClientInBulk", CEO_CFO_ADMIN, async(req, res) => {

    const createChildAccounts = (list, name) => {
        let result = [];
        list.forEach((x)=>{
            result.push({title:name+ `${x.title=="ACCOUNT RECEIVABLE"?" RECEIVABLE":" PAYABLE"}`, ParentAccountId:x.id, subCategory:'Customer'})
        })
        return result;
    }
    const createAccountList = (parent, child, id) => {
        let result = [];
        parent.forEach((x, i)=>{
            result[i] = {
                ClientId:id,
                CompanyId:x.CompanyId,
                ParentAccountId:x.id,
                ChildAccountId:null
            }
            child.forEach((y, j)=>{
                if(y.ParentAccountId==x.id){
                    result[i].ChildAccountId=child[j].id
                }
            })
        })
        return result;
    }

    try {
        // for...of, not forEach(async): `await` on a forEach awaits undefined,
        // so this replied 'success' with the client rows and their account
        // associations still being written - and a failure in any of them was
        // an unhandled rejection rather than the 'error' response below.
        for (const val of obj) {
            let value = {...val};
            value.accountRepresentatorId = null;
            value.salesRepresentatorId   = null;
            value.docRepresentatorId     = null;
            value.authorizedById         = null;
            value.createdBy              = "";
            const result = await Clients.create({...value}).catch((x)=>console.error(x))
            const accounts = await Parent_Account.findAll({
                where: {
                    // Was CompanyId in [1, 2, 3] - the company ids of the
                    // install this was written on. A company whose id is not
                    // one of those got no receivable/payable child accounts
                    // for its clients, which means it cannot invoice them.
                    title: { [Op.or]: ['ACCOUNT RECEIVABLE', 'ACCOUNT PAYABLE'] }
                }
            }).catch((x)=>console.error("===========1=============", x))
            const accountsList = await Child_Account.bulkCreate(createChildAccounts(accounts, result.name)).catch((x)=>console.error("===========2===========", x))
            await Client_Associations.bulkCreate(createAccountList(accounts, accountsList, result.id)).catch((x)=>console.error("===========3===========", x))
        }

        res.json({status:'success'});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.post("/editClient", async (req, res) => {
  // Non-privileged users can edit party details but never touch/add a ledger.
  if (!(await canCreateLedger(req))) req.body.pAccountName = '';
  let credit;
  try { credit = creditLimitsFrom(req.body.data); }
  catch (error) { return res.json({ status: 'error', message: error.message }); }
  try {
    await db.sequelize.transaction(async (t) => {
    //   console.log("Request Body:", req.body);

      let value = { ...req.body.data, ...credit };
      // A rep cleared on the form arrives as '' - not an employee id.
      for (const rep of ['accountRepresentatorId', 'salesRepresentatorId', 'docRepresentatorId', 'authorizedById']) {
        if (value[rep] === '') value[rep] = null;
      }
      // Stored as a comma-separated string. An AVIATION install does not ask
      // for operations at all (the four freight ones mean nothing to an
      // airline - see Setup/Client/CreateOrEdit), so the field can arrive
      // absent; joining undefined would take the whole save down with a
      // TypeError rather than saving a party with no operations, which is
      // exactly what is wanted there.
      value.operations = Array.isArray(value.operations) ? value.operations.join(', ') : (value.operations ?? null);
      value.types = Array.isArray(value.types) ? value.types.join(', ') : (value.types ?? null);

      await Clients.update(
        { ...value, code: parseInt(value.code, 10) },
        { where: { id: value.id }, transaction: t }
      );

      const clientAssociation = await Client_Associations.findOne({
        where: { ClientId: value.id },
        transaction: t
      });

      if (clientAssociation && req.body.pAccountName) {
        const pAccount = await Child_Account.findOne({
          where: { id: req.body.pAccountName },
          transaction: t
        });

        if (pAccount) {
          await Child_Account.update(
            {
              title: value.name,
              ChildAccountId: pAccount.id,
            },
            {
              where: { id: clientAssociation.ChildAccountId },
              transaction: t
            }
          );
          await Clients.update(
            { nongl: '0' },
            { where: { id: value.id }, transaction: t }
          );
        }
      } else if (req.body.pAccountName) {
        
        const newAccount = await Child_Account.create(
          {
            title: value.name,
            subCategory: 'Customer',
            editable: false,
            code: await allocateChildAccountCode(req.body.pAccountName, t),
            ChildAccountId: req.body.pAccountName
          },
          { transaction: t }
        );

        await Client_Associations.create(
          {
            ClientId: value.id,
            ChildAccountId: newAccount.id
          },
          { transaction: t }
        );

        await Clients.update(
          { nongl: '0' },
          { where: { id: value.id }, transaction: t }
        );
      }
    });

    // ✅ Response ONLY after successful commit
    return res.json({ status: 'success' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

routes.get("/getClients", async(req, res) => {
    try {
        const result = await Clients.findAll({
            attributes:['id', 'name' , 'person1', 'mobile1', 'person2', 'mobile2', 'telephone1', 'telephone2', 'address1', 'address2', 'createdBy', 'code', 'active', 'types'],
            order: [['createdAt', 'DESC'], /* ['name', 'ASC'],*/] ,
            include: [{
                model: Client_Associations,
                required: false
            }]
        });
        // Each party's KIND - Non-GL, customer or vendor (functions/partyKind)
        // - and only the kinds this user may view.
        const kinds = await partyKinds(db);
        const visible = await viewableKinds(req);
        const rows = result
            .map((c) => ({ ...c.toJSON(), kind: kinds.get(c.id) || 'nonGl' }))
            .filter((c) => !visible || visible.has(c.kind));
        res.json({status:'success', result:rows});
    }
    catch (error) {
        console.error(error)
      res.status(500).json({status:'error', result:error});
    }
});

// Same data as /getClients, deliberately NOT designation-gated: this backs
// the party-search picker inside job Charges (Components/.../PartySearch.js),
// which every employee needs to be able to use to pick a party for a charge
// line, even though they can't reach the Setup > Parties list/edit screens.
routes.get("/getClientsForSelect", async(req, res) => {
    try {
        const result = await Clients.findAll({
            attributes:['id', 'name' , 'person1', 'mobile1', 'person2', 'mobile2', 'telephone1', 'telephone2', 'address1', 'address2', 'createdBy', 'code', 'active', 'types'],
            order: [['createdAt', 'DESC']],
            include: [{
                model: Client_Associations,
                required: false
            }]
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
        console.error(error)
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getClientsbyType", async(req, res) => {
    try {
        const result = await Clients.findAll({
            where:{
                types: {
                    [Op.like]: `%${req.headers.type}%`
                }
            },
            attributes:['id', 'name' , 'person1', 'mobile1', 'person2', 'mobile2', 'telephone1', 'telephone2', 'address1', 'address2', 'createdBy', 'code', 'active', 'types', 'nongl'],  // nongl: so a report can leave out parties with no ledger account
            order: [['createdAt', 'DESC'], /* ['name', 'ASC'],*/] 
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getClientById", async(req, res) => {
    try {
        const result = await Clients.findOne({
            where:{id:req.headers.id},
            include:[{
                model:Client_Associations,
                // required:false,
                attributes:['id'],
                include:[{
                    // where:{CompanyId:1},
                    attributes:['id', 'title'],
                    model:Child_Account,
                    include:[{
                        model:Child_Account,
                        as: 'parent'
                    }]
                }]
            }]
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
        console.error(error)
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getNotifyParties", async(req, res) => {
    try {
        const result = await Clients.findAll({
            where:{
                types:{[Op.substring]: 'Notify'},
                
            },
            attributes:['id','name', 'address1', 'address1', 'person1', 'mobile1',
            'person2', 'mobile2', 'telephone1', 'telephone2', 'infoMail'],
            order: [['createdAt', 'DESC'], /* ['name', 'ASC'],*/] 
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getForCharges", async (req, res) => {
  res.set("Cache-Control", "no-store");

  try {

    const partyId = parseInt(req.headers.id);
    if (!partyId) {
      return res.json({ status: "success", result: [] });
    }

    let obj = {
    id: partyId,
    [Op.or]: [
        { nongl: '0' },
        { nongl: null }
    ]
    };

    const result = await Clients.findAll({
      where: obj,
      attributes: [
        "id",
        "name",
        "person2",
        "person1",
        "mobile1",
        "mobile2",
        "address1",
        "address2",
        "types",
        "city",
        "nongl"
      ],
      order: [["createdAt", "DESC"]]
    });

    res.json({ status: "success", result });
  } catch (error) {
    res.status(500).json({ status: "error", result: error.message });
  }
});

routes.get("/experimentalQuery", async(req, res) => {
    try {
        const [results, metadata] = await db.sequelize.query(
            `
            SELECT
                Clients.name,
                Employees.name AS EmployeeName,
                Clients.bank
            FROM Clients
            LEFT OUTER JOIN Employees ON Clients.accountRepresentatorId=Employees.id;
            `
            );
        res.json({status:'success', result:results});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getChildAccounts", async(req, res) => {
    try {
        const result = await Client_Associations.findOne({
            where: {
                id: req.headers.id
            },
        });
        const result1 = await Vendor_Associations.findOne({
            where: {
                id: req.headers.id
            }
        })
        if(result){
            res.json({status:'success', result:result});
        }
        if(result1){   
            res.json({status:'success', result:result1});
        }
    }
    catch (error) {
        console.error(error)
      res.status(500).json({status:'error', result:error});
    }
})

routes.post("/findAccounts", async(req, res) => {
    try {
        const result = await Parent_Account.findAll({
            where: {
                CompanyId: {
                    [Op.or]: req.body.companies
                },
                title:'Accounts Recievable'
            },
            attributes:['id', 'title']
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getClientAssociations", async(req, res) => {
    try {
        const result = await Client_Associations.findAll({
            where: {
                CompanyId: req.headers.company
            },
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
        console.error(error)
        res.status(500).json({status:'error', result:error});
    }
});

/* -------------------------------------------------------------------------
 * REPLACE ONE PARTY WITH ANOTHER
 *
 * For parties that should never have existed (a duplicate, a typo) but are
 * already referenced by jobs, BLs or AWB stock, so they cannot simply be
 * deleted.
 *
 * /mergeImpact reports what points at a party. /mergeParty repoints the
 * operational references and optionally removes the old party.
 *
 * The merge REFUSES while any invoice, voucher, transaction or charge head
 * names the party: those are accounting records, and moving them would rewrite
 * who owes money. Unpaid invoices are listed by name so they can be settled or
 * corrected first - see functions/partyMerge.js for why "unpaid" is
 * total - GREATEST(paid, recieved) and not the more obvious subtraction.
 * ---------------------------------------------------------------------- */

// A table a mode never created is not an error - it simply holds no rows.
const existingTables = async (transaction) => {
    const [rows] = await db.sequelize.query(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'`,
        { transaction });
    return new Set(rows.map((r) => r.t));
};

const refValue = (ref, id) => (ref.text ? String(id) : Number(id));

const buildImpact = async (partyId, transaction) => {
    const id = String(partyId);
    const tables = await existingTables(transaction);
    const operational = [];
    const financial = [];

    for (const ref of OPERATIONAL_REFS) {
        if (!tables.has(ref.table)) continue;
        const [[row]] = await db.sequelize.query(
            `SELECT count(*)::int AS n FROM "${ref.table}" WHERE "${ref.column}" = :id`,
            { replacements: { id: refValue(ref, id) }, transaction });
        if (row.n) operational.push({ ...ref, count: row.n });
    }

    for (const ref of FINANCIAL_REFS) {
        if (!tables.has(ref.table)) continue;
        // These columns are varchar, so the id is compared as text.
        const [[row]] = await db.sequelize.query(
            `SELECT count(*)::int AS n FROM "${ref.table}" WHERE "${ref.column}" = :id`,
            { replacements: { id }, transaction });
        if (row.n) financial.push({ ...ref, count: row.n });
    }

    // The actionable list: invoices still carrying a balance.
    const [unpaid] = await db.sequelize.query(`
        SELECT "invoice_No", "payType", "party_Name", total, paid, recieved,
               ROUND(${OUTSTANDING_SQL}, 2) AS outstanding, "createdAt"::date AS "on"
          FROM "Invoices"
         WHERE "party_Id" = :id AND ${OUTSTANDING_SQL} > ${PAID_TOLERANCE}
         ORDER BY "createdAt"
    `, { replacements: { id }, transaction });

    return {
        operational,
        financial,
        unpaid,
        operationalTotal: operational.reduce((n, r) => n + r.count, 0),
        financialTotal: financial.reduce((n, r) => n + r.count, 0),
        canMerge: financial.length === 0,
    };
};

routes.get("/mergeImpact", CEO_CFO_ADMIN, async (req, res) => {
    try {
        const id = req.query.id || req.headers.id;
        if (!id) return res.json({ status: 'error', result: 'Party id is required.' });

        const party = await Clients.findOne({ where: { id } });
        if (!party) return res.json({ status: 'error', result: 'That party no longer exists.' });

        const impact = await buildImpact(id);
        return res.json({
            status: 'success',
            result: {
                party: { id: party.id, name: party.name, code: party.code, types: party.types },
                ...impact,
            },
        });
    } catch (error) {
        console.error(error);
        return res.json({ status: 'error', result: error.message || String(error) });
    }
});

routes.post("/mergeParty", CEO_CFO_ADMIN, async (req, res) => {
    const t = await db.sequelize.transaction();
    let committed = false;
    try {
        const { fromId, toId, deleteAfter = true, employeeId } = req.body;

        if (!fromId || !toId) {
            await t.rollback();
            return res.json({ status: 'error', result: 'Both the party to replace and its replacement are required.' });
        }
        if (String(fromId) === String(toId)) {
            await t.rollback();
            return res.json({ status: 'error', result: 'A party cannot be replaced by itself.' });
        }

        const from = await Clients.findOne({ where: { id: fromId }, transaction: t });
        const to = await Clients.findOne({ where: { id: toId }, transaction: t });
        if (!from || !to) {
            await t.rollback();
            return res.json({ status: 'error', result: 'One of those parties no longer exists.' });
        }

        // Re-checked inside the transaction, not trusted from whatever the
        // screen last saw: an invoice could have been raised against this party
        // between the impact check and the confirmation.
        const impact = await buildImpact(fromId, t);
        if (!impact.canMerge) {
            await t.rollback();
            return res.json({
                status: 'error',
                result: `"${from.name}" has accounting records (` +
                    impact.financial.map((f) => `${f.count} ${f.label.toLowerCase()}`).join(', ') +
                    `) and cannot be replaced. Settle or move those first.`,
                impact,
            });
        }

        const tables = await existingTables(t);
        const moved = [];
        for (const ref of OPERATIONAL_REFS) {
            if (!tables.has(ref.table)) continue;
            const replacements = {
                to: refValue(ref, toId), from: refValue(ref, fromId), toName: to.name,
            };
            if (ref.uniqueWithin) {
                // A group that already holds the replacement keeps that row;
                // repointing the old one too would list the party twice.
                await db.sequelize.query(
                    `DELETE FROM "${ref.table}" a
                      WHERE a."${ref.column}" = :from
                        AND EXISTS (SELECT 1 FROM "${ref.table}" b
                                     WHERE b."${ref.uniqueWithin}" = a."${ref.uniqueWithin}"
                                       AND b."${ref.column}" = :to)`,
                    { replacements, transaction: t });
            }
            const sets = [`"${ref.column}" = :to`, `"updatedAt" = now()`];
            if (ref.nameColumn) sets.push(`"${ref.nameColumn}" = :toName`);
            // On Postgres a raw UPDATE hands back the driver's result object,
            // not a number - the count is its rowCount.
            const [, meta] = await db.sequelize.query(
                `UPDATE "${ref.table}" SET ${sets.join(', ')} WHERE "${ref.column}" = :from`,
                { replacements, transaction: t });
            const count = typeof meta === 'number' ? meta : Number(meta?.rowCount || 0);
            if (count) moved.push({ label: ref.label, count });
        }

        let deleted = false;
        if (deleteAfter) {
            // Only the party row itself. Its ledger association, if any, was
            // repointed above rather than removed.
            await Clients.destroy({ where: { id: fromId }, transaction: t });
            deleted = true;
        }

        await t.commit();
        committed = true;

        createHistory(employeeId, 'Party', deleted ? 'Replace & Delete' : 'Replace',
            `${from.name} (${from.code}) -> ${to.name} (${to.code})`);

        return res.json({
            status: 'success',
            result: {
                from: { id: from.id, name: from.name },
                to: { id: to.id, name: to.name },
                moved,
                movedTotal: moved.reduce((n, r) => n + r.count, 0),
                deleted,
            },
        });
    } catch (error) {
        if (!committed) await t.rollback().catch(() => {});
        console.error(error);
        return res.json({ status: 'error', result: error.message || String(error) });
    }
});

routes.post("/deleteClient", CEO_CFO_ADMIN, async(req, res) => {
    try{
        let clientId = req.body.id
        const result0 = await Clients.findOne({where: {
            id: clientId
        }})
        if(result0){
            const result1 = await Client_Associations.findOne({
                where: {
                    ClientId: result0.dataValues.id
                }
            })
            if(result1){
                const result2 = await Child_Account.findOne({
                    where: {
                        id: result1.dataValues.ChildAccountId
                    }
                })
                if(result2){
                    const result3 = await Voucher_Heads.findOne({
                        where: {
                            ChildAccountId: result2.dataValues.id
                        }
                    })
                    if(result3){
                        return res.json({status: 'transaction'})
                    } else {
                        await Child_Account.destroy({
                            where: {
                                id: result2.dataValues.id
                            }
                        })
                        await Client_Associations.destroy({
                            where: {
                                id: result1.dataValues.id
                            }
                        })
                        await Clients.destroy({
                            where: {
                                id: result0.dataValues.id
                            }
                        })
                    }
                } else {
                    await Client_Associations.destroy({
                        where: {
                            id: result1.dataValues.id
                        }
                    })
                    await Clients.destroy({
                        where: {
                            id: result0.dataValues.id
                        }
                    })
                }
            } else {
                await Clients.destroy({
                    where: {
                        id: result0.dataValues.id
                    }
                })
            }
        } else {
            return res.json({status: 'deleted'})
        }
        res.json({status: 'success'})
    }catch(e){
        console.error(e)
        res.status(500).json({status:'error', message: e})
    }
})

routes.post("/bulkCreate", CEO_CFO_ADMIN, async (req, res) => {
  const parties = req.body;
  try {
    let i = 1
    const accounts = await Child_Account.findAll({
        include: {
            model: Child_Account,
            as: 'parent'
        }
    });

    for (let party of parties) {
        let ops = '';

        if (party.IsAirExport) ops += 'Air Export, ';
        if (party.IsAirImport) ops += 'Air Import, ';
        if (party.IsSeaExport) ops += 'Sea Export, ';
        if (party.IsSeaImport) ops += 'Sea Import, ';

        let type = '';

        if (party.IsShipper) type += 'Shipper, ';
        if (party.IsConsignee) type += 'Consignee, ';
        if (party.IsNotify) type += 'Notify, ';
        if (party.IsPotentialCustomer) type += 'Potential Customer, ';
        if (party.IsNonOperationalParty) type += 'Non operational Party, ';
        if (party.IsForwarder) type += 'Forwarder/Coloader, ';
        if (party.IsLocalAgent) type += 'Local Vendor, ';
        if (party.IsOverseasAgent) type += 'Overseas Agent, ';
        if (party.IsCommissionAgent) type += 'Commission Agent, ';
        if (party.IsIndentor) type += 'Indentor, ';
        if (party.IsTransporter) type += 'Transporter, ';
        if (party.IsCHACHB) type += 'CHA/CHB, ';
        if (party.IsShippingLine) type += 'Shipping Line, ';
        if (party.IsDeliveryAgent) type += 'Delivery Agent, ';
        if (party.IsWarehouse) type += 'Warehouse, ';
        if (party.IsBuyingHouse) type += 'Buying House, ';
        if (party.IsAirLine) type += 'Air Line, ';
        if (party.IsTrucking) type += 'Trucking, ';
        if (party.IsDrayman) type += 'Drayman, ';
        if (party.IsCartage) type += 'Cartage, ';
        if (party.IsStevedore) type += 'Stevedore, ';
        if (party.IsPrincipal) type += 'Principal, ';
        if (party.IsDepo) type += 'Depot, ';
        if (party.IsTerminalParty) type += 'Terminal, ';
        if (party.IsBuyer) type += 'Buyer, ';
        if (party.IsSlotOperator) type += 'Slot Operator, ';

        let COA1 = null
        accounts.forEach((account) => {
            if (account.dataValues.id == party?.AccountId) {
                COA1 = account.dataValues.id;
            }
        })
        const SNSClient = await Clients.create({
            climaxId: party.Id,
            code: i || null,
            name: party.PartyName,
            city: party.City?.UNLocName || null,
            telephone1: party.Telephone1 || null,
            telephone2: party.Telephone2 || null,
            address1: party.Address1 || null,
            address2: party.Address2 || null,
            website: party.WebSite || null,
            accountsMail: party.AccountsEmail || null,
            infoMail: party.Email || null,
            strn: party.STRN || null,
            ntn: party.NTNName || null,
            registerDate: party.DateOfRegistration || moment().format("YYYY-MM-DD"),
            operations: ops || null,
            types: type || null,
            bankAuthorizeDate: party.AuthorizationDate || moment().format("YYYY-MM-DD"),
            bank: party.BankName || null,
            branchName: party.BranchName || null,
            branchCode: party.BranchCode || null,
            accountNo: party.AccountNo || null,
            iban: party.IBAN || null,
            swiftCode: party.SwiftCode || null,
            routingNo: party.RoutingNo || null,
            ifscCode: party.IFCSCode || null,
            micrCode: party.MICRCode || null,
            currency: party.CurrencyId || "PKR",
            createdBy: party.AddLog || "System",
            active: true,
            nongl: COA1 != null ? '0' : '1'
        });
        if(COA1 != null){
            await Client_Associations.create({
                ClientId: SNSClient.id,
                ChildAccountId: COA1
            })
        }
      i++
    }

    return res.json({ status: 'success', result: 'Parties created successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: 'error', result: error.message });
  }
});

routes.get("/getClientsForBackup", async (req, res) => {
    try{
        const clients = await Clients.findAll({
            attributes: [ 'id', 'climaxId' ],
        })
        res.status(200).json({ status: 'success', result: clients})
    }catch(e){
        console.error(e)
        res.status(500).json({ status: 'error', result: e.message })
    }
})

// The rewritten parties migration: plan, apply, verify.
// /clientRoutes/bulkCreate above is untouched - see routes/clients/partyMigration.js
// for what it does differently and why.
routes.use('/', require('./partyMigration'));

module.exports = routes;