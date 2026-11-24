const Sequelize = require('sequelize');
// Legacy-import receivers are migration, which is Seanet's - see
// functions/systemAccess.js.
const { requireSystem: SYSTEM } = require('../../functions/systemAccess');
const { Op } = require("sequelize");
const routes = require('express').Router();
const { Vessel, SE_Job, Record_Company, sequelize } = require("../../models");
//const { Voyage } = require('./functions/Associations/vesselAssociations');
const { Voyage } = require('../../functions/Associations/vesselAssociations');
const { createHistory } = require('../../functions/history');
const { vesselSearchWhere } = require('../../functions/vesselSearch');

const asActive = (v) => !(v === false || v === 'false' || v === 0 || v === '0');
const asId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/* WHERE A VESSEL IS USED: the freight jobs that carry it, directly
 * (SE_Jobs.vesselId) or through one of its voyages (SE_Jobs.VoyageId). Both
 * foreign keys are ON DELETE SET NULL, so deleting a used vessel would not
 * fail - it would quietly blank the vessel and voyage on every one of those
 * jobs. The customs job's vessel is typed text, not a link, so it is not a
 * use. */
async function vesselUsage(id, transaction) {
  const voyageIds = (await Voyage.findAll({ where: { VesselId: id }, attributes: ['id'], transaction }))
    .map((v) => v.id);
  const where = { [Op.or]: [{ vesselId: id }, ...(voyageIds.length ? [{ VoyageId: voyageIds }] : [])] };
  const [jobs, sample] = await Promise.all([
    SE_Job.count({ where, transaction }),
    SE_Job.findAll({ where, attributes: ['jobNo'], order: [['id', 'DESC']], limit: 5, transaction }),
  ]);
  return { jobs, jobNos: sample.map((j) => j.jobNo).filter(Boolean), voyageIds };
}

routes.post("/create", async(req, res) => {
    try {
      const value = req.body.data;
      const check = await Vessel.max("code")
      const result = await Vessel.create({...value, code:check? parseInt(check) + 1:1});
      createHistory(req.body.employeeId, 'Vessel', 'Create', result.name);
      res.json({status:'success', result:result});
    
    }
    catch (error) {
      console.log(error)
      res.status(500).json({status:'error', result:error});
    }
});

/* SETUP > VESSELS - one page, searched on the server (functions/vesselSearch).
 * The screen used to load every vessel with the page (2,104 on SNS) and page
 * and search in the browser. Newest first, as /get lists them; id breaks ties
 * so an entry never shows on two pages. Narrowed to the working company like
 * every vessel list when Configuration separates vessels by company. */
routes.get("/list", async (req, res) => {
  try {
    const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize)) || 25));
    const where = vesselSearchWhere(req.query.search);
    const [total, rows] = await Promise.all([
      Vessel.count({ where }),
      Vessel.findAll({
        where,
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
    ]);
    res.json({ status: 'success', total, page, pageSize, result: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || 'Could not list the vessels.' });
  }
});

routes.get("/getVessels", async(req, res) => {
    try {
      const result = await Vessel.findAll({
        order: [['createdAt', 'DESC']]
      });
      res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.post("/findVoyages", async(req, res) => {
  try {
    console.log(req.body)
    const result = await Voyage.findAll({
      where:{
          VesselId:req.body.id ,
      }
    });
    createHistory(req.body.employeeId, 'Vessel', 'View Voyages', result.name);
    res.json({status:'success', result:result});
  }
  catch (error) {
    res.status(500).json({status:'error', result:error});
  }
});

routes.post("/createVoyage", async(req, res) => {
  try {
    let data = req.body;
    delete data.id;
    const result = await Voyage.create(data);
    createHistory(req.body.employeeId, 'Voyage', 'Create', result.voyage);
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.log(error)
    res.status(500).json({status:'error', result:error});
  }
});

routes.post("/editVoyage", async(req, res) => {
  try {
    let data = req.body;
    const result = await Voyage.update(data,{
      where:{id:data.id}
    });
    createHistory(req.body.employeeId, 'Voyage', 'Edit', result.name);
    res.json({status:'success', result:result});
  }
  catch (error) {
    console.log(error)
    res.status(500).json({status:'error', result:error});
  }
});

routes.get("/get", async(req, res) => {
    try {
      const result = await Vessel.findAll({
        order: [['createdAt', 'DESC']]
      });
      res.json({status:'success', result:result});
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.post("/edit", async(req, res) => {
    try {
      const value = { ...req.body.data };
      // The form's Status. Absent (an older screen) leaves it as it is.
      if (value.active === undefined || value.active === null || value.active === '') delete value.active;
      else value.active = asActive(value.active);
      const exists = await Vessel.findOne({
        where:{
            id:{ [Op.ne]: req.body.data.id },
            name:{ [Op.eq]: req.body.data.name}
        }
      });
      if(exists){
        createHistory(req.body.employeeId, 'Vessel', 'Edit', exists.name);
          res.json({status:'exists', result:exists});
      } else {
          await Vessel.update( {...value, code : parseInt(value.code)},{
            where:{id:req.body.data.id}
          });
          const result = await Vessel.findOne({where:{id:req.body.data.id}})
          res.json({status:'success', result:result});
      }
    }
    catch (error) {
      res.status(500).json({status:'error', result:error});
    }
});

routes.post("/uploadVoyages", SYSTEM, async(req, res) => {
    try {
      const data = req.body
      // console.log(data)
      let Vessels = []
      for(let vessel of data){
        let temp = {
          code: parseInt(vessel.Id),
          name: vessel.VesselName,
          type: "Both",
          climaxId: parseInt(vessel.Id)
        }
        const ve = await Vessel.create(temp)
        for(let voyage of vessel.voyages){
          let temp1 = {
            voyage: voyage.VoyageNo,
            importOriginSailDate: voyage.OriginSailingDate,
            importArrivalDate: voyage.ArrivalDate,
            exportSailDate: voyage.SailingDate,
            destinationEta: voyage.DestinationETA,
            cutOffDate: voyage.CutOfDate,
            cutOffTime: voyage.CutOfTime,
            type: voyage.TypeId==3?"Export":voyage.TypeId==2?"Import":"Both",
            VesselId: ve.id,
            climaxId: voyage.Id
          }
          await Voyage.create(temp1)
        }
        Vessels.push(ve)
      }
      // createHistory(req.body.employeeId, 'Vessel', 'Upload', result.name);
      res.json({status:'success', result:Vessels});
    }
    catch (error) {
      console.error(error)
      res.status(500).json({status:'error', result:error});
    }
});



// The rewritten vessel/voyage migration. /vessel/uploadVoyages above is
// untouched - see routes/vessel/voyageMigration.js.
routes.use('/', require('./voyageMigration'));

/* DELETE A VESSEL - only one no job has ever used.
 *
 * Used (see vesselUsage): nothing is changed, and the answer says so with
 * status 'inUse', the number of jobs and a few of their numbers - the screen
 * then offers to make it inactive instead (/setActive), which takes it off
 * the job screen's picker and leaves those jobs as they are. Unused: the
 * vessel goes with its voyages (their VesselId would only be nulled,
 * leaving voyages of no vessel) and its company visibility rows.
 *
 * The vessel and its voyages are locked first: a job being saved with one of
 * them takes a key-share lock on that row, so it either finishes before the
 * count (and is counted) or waits until the delete is done (and then fails on
 * its foreign key) - never a job saved in between and blanked by SET NULL. */
routes.post("/delete", async (req, res) => {
  try {
    const id = asId(req.body?.id);
    if (!id) return res.status(400).json({ status: 'error', result: 'Which vessel? No id was sent.' });

    const outcome = await sequelize.transaction(async (transaction) => {
      const vessel = await Vessel.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!vessel) return { missing: true };
      await Voyage.findAll({ where: { VesselId: id }, attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });

      const usage = await vesselUsage(id, transaction);
      if (usage.jobs) return { vessel, usage };

      await Voyage.destroy({ where: { VesselId: id }, transaction });
      await Record_Company.destroy({ where: { entity: 'Vessel', recordId: String(id) }, transaction });
      await vessel.destroy({ transaction });
      return { vessel, deleted: true, voyages: usage.voyageIds.length };
    });

    if (outcome.missing) return res.status(404).json({ status: 'error', result: 'That vessel does not exist any more.' });
    if (!outcome.deleted) {
      const { jobs, jobNos } = outcome.usage;
      return res.status(409).json({
        status: 'inUse',
        result: `${outcome.vessel.name} is on ${jobs} job${jobs === 1 ? '' : 's'}`
          + `${jobNos.length ? ` (${jobNos.join(', ')}${jobs > jobNos.length ? ', ...' : ''})` : ''}, so it cannot be deleted.`,
        jobs,
        jobNos,
        active: outcome.vessel.active,
      });
    }
    createHistory(req.body.employeeId, 'Vessel', 'Delete', outcome.vessel.name);
    res.json({ status: 'success', result: `${outcome.vessel.name} deleted${outcome.voyages ? `, with its ${outcome.voyages} voyage${outcome.voyages === 1 ? '' : 's'}` : ''}.` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || 'Could not delete the vessel.' });
  }
});

/* ACTIVE / INACTIVE. Inactive is left off the job screen's Vessel picker -
 * except on a job that already has it - and nothing else changes. */
routes.post("/setActive", async (req, res) => {
  try {
    const id = asId(req.body?.id);
    if (!id || req.body?.active === undefined) {
      return res.status(400).json({ status: 'error', result: 'Send the vessel id and active true or false.' });
    }
    const vessel = await Vessel.findByPk(id);
    if (!vessel) return res.status(404).json({ status: 'error', result: 'That vessel does not exist any more.' });
    await vessel.update({ active: asActive(req.body.active) });
    createHistory(req.body.employeeId, 'Vessel', vessel.active ? 'Activate' : 'Deactivate', vessel.name);
    res.json({ status: 'success', result: vessel });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || 'Could not change the vessel.' });
  }
});

module.exports = routes;