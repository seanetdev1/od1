const routes = require('express').Router();
const { searchFor } = require('../../functions/globalSearch');

/**
 * THE HEADER'S SEARCH (the user, 2026-11-23) - GET /search?q=...
 * Jobs, B/Ls, invoices & bills, vouchers and parties matching q, a few of
 * each, only the kinds and companies this user may see (functions/
 * globalSearch). Under two characters, nothing.
 */
routes.get('/', async (req, res) => {
  try {
    res.json({ status: 'success', result: await searchFor(req, req.query.q) });
  } catch (err) {
    res.status(500).json({ status: 'error', result: err.message });
  }
});

module.exports = routes;
