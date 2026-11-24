const { Op } = require("sequelize");
const routes = require('express').Router();
const { Airports } = require("../../models/");
const { createHistory } = require('../../functions/history');

routes.post("/createAirport", async (req, res) => {
    try {
        const { airportCode, airportName, city, country } = req.body;
        // City is NOT required. An aviation install does not ask for it at all
        // (see the model), so demanding it here would refuse every airport
        // created from that screen.
        if (!airportCode || !airportName || !country) {
            return res.json({ status: "error", result: "Code, airport name and country are required" })
        }
        const result = await Airports.create({ airportCode, airportName, city: city || null, country });
        createHistory(req.body.employeeId, 'Airports', 'Create', result.airportName);
        return res.json({ status: "success", result: result })
    } catch (error) {
        console.log(error);
        res.status(500).json({status:"error", result: error })
    }
})

routes.get("/viewAirports", async (req, res) => {
    try {
        const result = await Airports.findAll();
        return res.json({ status: "success", result: result })
    } catch (error) {
        return res.status(500).json({status:"error", result: error })
    }
});

routes.get("/get", async (req, res) => {
    try {
        const { page = 1, limit = 50, search = "" } = req.query;

        const offset = (Number(page) - 1) * Number(limit);
        const where = search
            ? {
                [Op.or]: [
                    { airportCode: { [Op.iLike]: `%${search}%` } },
                    { airportName: { [Op.iLike]: `%${search}%` } },
                    { city: { [Op.iLike]: `%${search}%` } },
                    { country: { [Op.iLike]: `%${search}%` } },
                ],
            }
            : {};

        const { count, rows } = await Airports.findAndCountAll({
            where,
            order: [["airportName", "ASC"]],
            limit: Number(limit),
            offset,
        });

        res.json({
            status: "success",
            result: rows,
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

routes.post("/updateAirport", async (req, res) => {
    try {
        const { id, airportCode, airportName, city, country } = req.body.data || req.body;
        if (!id || !airportCode || !airportName || !country) {
            return res.json({ status: "error", result: "Code, airport name and country are required" })
        }
        // `city` is left out of the SET when the screen did not send one -
        // Sequelize skips undefined keys - so an aviation install editing an
        // airport does not blank a city a freight install had recorded.
        await Airports.update({ airportCode, airportName, city, country }, { where: { id } });
        const result = await Airports.findOne({ where: { id } });
        createHistory(req.body.employeeId, 'Airports', 'Edit', result.airportName);
        return res.json({ status: "success", result: result })
    } catch (error) {
        console.log(error);
        res.status(500).json({status:"error", result: error })
    }
})

routes.post("/deleteAirport", async (req, res) => {
    try {
        const { id } = req.body;
        const record = await Airports.findOne({ where: { id } });
        await Airports.destroy({ where: { id } });
        createHistory(req.body.employeeId, 'Airports', 'Delete', record?.airportName);
        return res.json({ status: "success", result: id })
    } catch (error) {
        console.log(error);
        res.status(500).json({status:"error", result: error })
    }
})

module.exports = routes;
