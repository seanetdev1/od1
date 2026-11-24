const { Clients } = require("../../functions/Associations/clientAssociation");
const routes = require('express').Router();
const { createHistory } = require('../../functions/history');
const requireDesignation = require('../../functions/requireDesignation');

const CEO_CFO_ADMIN = requireDesignation(['CEO', 'CFO', 'admin']);

routes.post("/createNonGlParty", CEO_CFO_ADMIN, async(req, res) => {
    try {
        let value = req.body;
        value.operations = value.operations.join(', ');
        value.types = value.types.join(', ');
        delete value.id
        const check = await Clients.max('code');
        const result = await Clients.create({
            ...value,
            code : check == null ? 1 : parseInt(check) + 1,
            nongl:'1'
        }).catch((x)=>console.log(x))
      
        res.json({status:'success', result: result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getParties", CEO_CFO_ADMIN, async(req, res) => {
    try {
        const result = await Clients.findAll({
            attributes:['id', 'name' , 'person1', 'mobile1', 'person2', 'mobile2', 'telephone1', 'telephone2', 'address1', 'address2', 'createdBy', 'code'],
            where:{nongl:'1'},
            order: [['createdAt', 'DESC'],] 
        });
        res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.get("/getPartiesById", CEO_CFO_ADMIN, async(req, res) => {
    try {
        const result = await Clients.findOne({where:{id:req.headers.id}});
        res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.post("/editNonGlParty", CEO_CFO_ADMIN, async(req, res) => {
    try {
        let value = req.body;
        value.id = value.id
        value.operations = value.operations.join(', ');
        value.types = value.types.join(', ');
        const result = await Clients.update({...value, code: parseInt(value.code)},{where:{id:value.id}}).then((x)=>console.log(x))
       createHistory(req.body.employeeId, 'Non-Gl Party', 'Edit', result.name);
        res.json({status:'success', result:result})
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

// One-time migration seed. The 1,361 party records this inserts used to be a
// literal array in this file - ~23,000 lines of real company names, street
// addresses, emails and mobile numbers sitting in the source tree, and
// therefore in git history forever. That is third-party PII; it does not
// belong in a repo that gets built, sealed and copied to customer sites.
//
// The data now lives in seeds/nonGlParties.seed.json, which is gitignored.
// See seeds/README.md. If the file isn't present this route reports that
// plainly rather than pretending it seeded anything.
routes.post("/createNonglPartiesInBulk", CEO_CFO_ADMIN, async(req, res) => {

    let parties;
    try {
        // Loaded per request, not at module load: the file is absent on every
        // normal install, and requiring it at the top would make this whole
        // router fail to mount.
        parties = require('../../seeds/nonGlParties.seed.json');
    } catch (err) {
        return res.status(404).json({
            status: 'error',
            result: 'Seed file seeds/nonGlParties.seed.json not found. This is a ' +
                    'one-time migration endpoint; see seeds/README.md.',
        });
    }

    try {
        // for...of, not forEach(async): `await` on a forEach awaits undefined,
        // so this replied 'success' the instant it was called, with 1,361
        // creates still in flight and any failure among them silently lost.
        let created = 0;
        const failed = [];
        for (const val of parties) {
            let value = {...val};
            value.accountRepresentatorId = null;
            value.salesRepresentatorId   = null;
            value.docRepresentatorId     = null;
            value.authorizedById         = null;
            value.createdBy              = "";
            value.nongl                  = "1";
            try {
                await Clients.create({...value});
                created += 1;
            } catch (err) {
                // Keep going - a seed run that stops on the first duplicate is
                // useless - but report what didn't land instead of swallowing it.
                failed.push({ code: val.code, name: val.name, reason: err.message });
            }
        }
        createHistory(req.body.employeeId, 'Non-Gl Party', 'Create', "Non-Gl Parties");
        res.json({
            status: failed.length ? 'partial' : 'success',
            result: { total: parties.length, created, failed },
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({status:'error', result:error});
    }
});

module.exports = routes;