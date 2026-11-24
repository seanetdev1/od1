const { Op } = require("sequelize");
const routes = require('express').Router();
const db = require("../../models/");
const { Ports } = db;
const { createHistory } = require('../../functions/history');
// "Customs port of loading" - an option on the port (functions/customsLoadingPorts).
const { loadingPortIds, setLoadingPort } = require('../../functions/customsLoadingPorts');
const withLoading = async (rows) => {
    const ids = await loadingPortIds(db);
    return rows.map((r) => ({ ...(r.toJSON ? r.toJSON() : r), customsLoading: ids.has(Number(r.id)) }));
};

routes.post("/createPort", async (req, res) => {
    try {
        const { portId, portName, portCountry } = req.body;
        if (!portId || !portName || !portCountry) {
            return res.json({ status: "error", result: "All fields are required" })
        }
        let nameWithCode = `${portName} (${portId})`
        const result = await Ports.create({
            portId,
            portName: nameWithCode,
            portCountry
        })
        if (req.body.customsLoading === true) await setLoadingPort(db, result.id, true);
        createHistory(req.body.employeeId, 'Ports', 'Create', result.portName);
        return res.json({ status: "success", result: (await withLoading([result]))[0] })

    } catch (error) {
        console.log(error);
        res.status(500).json({status:"error", result: error })
    }
})

routes.get("/viewPorts", async (req, res) => {
    try {
        const result = await Ports.findAll();
        return res.json({ status: "success", result: await withLoading(result) })
    } catch (error) {
        return res.status(500).json({status:"error", result: error })
    }
});

/*
 * Type-ahead source for the Port of Loading / Discharge / Final Destination
 * pickers on the job screen.
 *
 * /viewPorts above returns every row - 157,879 on the freight install, about
 * 12.6 MB of JSON - which the job screen was downloading every time it opened.
 * This returns at most `limit` matches instead.
 *
 * Deliberately findAll, not findAndCountAll: the picker never shows a total, and
 * the COUNT half of findAndCountAll is the expensive part (~400 ms) because it
 * cannot stop early the way a LIMIT can.
 *
 * `id` resolves a single port by its exact code, so an already-saved job can
 * label the value it holds without fetching anything else.
 */
routes.get("/search", async (req, res) => {
    try {
        const { search = "", id = "" } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);

        if (id) {
            const row = await Ports.findOne({ where: { portId: id } });
            return res.json({ status: "success", result: row ? [row] : [] });
        }

        const term = String(search).trim();
        // pg_trgm indexes are built from 3-character trigrams, so a 1-2
        // character pattern cannot use them and falls back to a full scan of
        // the table. The picker asks for at least 2 before searching; this is
        // the backstop for anything that does not. The indexes themselves come
        // from scripts/fixPickListIndexes.js.
        if (term.length < 2) {
            return res.json({ status: "success", result: [] });
        }

        // The customs loading desks (functions/customsLoadingPorts) are
        // Ports rows, not seaports - not offered as anyone's POL or POD.
        const desks = [...await loadingPortIds(db)];
        const rows = await Ports.findAll({
            where: {
                [Op.or]: [
                    { portId: { [Op.iLike]: `%${term}%` } },
                    { portName: { [Op.iLike]: `%${term}%` } },
                    { portCountry: { [Op.iLike]: `%${term}%` } },
                ],
                ...(desks.length ? { id: { [Op.notIn]: desks } } : {}),
            },
            order: [["portName", "ASC"]],
            limit,
        });
        return res.json({ status: "success", result: rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: "error", result: error.message || String(error) });
    }
});

routes.get("/get", async (req, res) => {
    try {
        const { page = 1, limit = 50, search = "" } = req.query;

        const offset = (Number(page) - 1) * Number(limit);
        const where = search
            ? {
                [Op.or]: [
                    { portId: { [Op.iLike]: `%${search}%` } },
                    { portName: { [Op.iLike]: `%${search}%` } },
                    { portCountry: { [Op.iLike]: `%${search}%` } },
                ],
            }
            : {};

        const { count, rows } = await Ports.findAndCountAll({
            where,
            order: [["portName", "ASC"]],
            limit: Number(limit),
            offset,
        });

        res.json({
            status: "success",
            result: await withLoading(rows),
            pagination: {
                currentPage: Number(page),
                pageSize: Number(limit),
                totalRecords: count,
                totalPages: Math.ceil(count / Number(limit)),
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({status:"error", result: error });
    }
});

routes.post("/updatePort", async (req, res) => {
    try {
        const { id, portId, portName, portCountry, customsLoading } = req.body.data || req.body;
        if (!id || !portId || !portName || !portCountry) {
            return res.json({ status: "error", result: "All fields are required" })
        }
        let nameWithCode = portName.includes(`(${portId})`) ? portName : `${portName} (${portId})`
        await Ports.update({
            portId,
            portName: nameWithCode,
            portCountry
        }, { where: { id } });
        // Left as it is when the screen does not say (an older one).
        if (typeof customsLoading === 'boolean') await setLoadingPort(db, id, customsLoading);
        const result = await Ports.findOne({ where: { id } });
        createHistory(req.body.employeeId, 'Ports', 'Edit', result.portName);
        return res.json({ status: "success", result: (await withLoading([result]))[0] })
    } catch (error) {
        console.log(error);
        res.status(500).json({status:"error", result: error })
    }
})

routes.post("/deletePort", async (req, res) => {
    try {
        const { id } = req.body;
        const record = await Ports.findOne({ where: { id } });
        await Ports.destroy({ where: { id } });
        await setLoadingPort(db, id, false);
        createHistory(req.body.employeeId, 'Ports', 'Delete', record?.portName);
        return res.json({ status: "success", result: id })
    } catch (error) {
        console.log(error);
        res.status(500).json({status:"error", result: error })
    }
})

module.exports = routes;
