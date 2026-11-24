const { Child_Account } = require("../../functions/Associations/accountAssociations");
const db = require('../../models');
const routes = require('express').Router();
const Sequelize = require('sequelize');
const {
  utcOffsetOf, reportDay, dayStart, dayEnd, accountSumsSql, buildTrialBalance,
} = require('../../functions/trialBalance');
const url = 'trialBalance';

const accountSums = ({ from, toEnd, company, currency }) => {
  const pkr = !currency || currency === 'PKR';
  return db.sequelize.query(accountSumsSql({ pkr, company }), {
    replacements: { from, toEnd, company: company || null, currency: currency || null },
    type: Sequelize.QueryTypes.SELECT,
  });
};

/**
 * The trial balance - rows ready to show, for the report type asked for.
 *
 * Headers: from, to ('YYYY-MM-DD'; an ISO instant from an older link is read
 * as its day), utcoffset (the screen's, minutes), company, currency,
 * accountid, reporttype, options.
 */
routes.get(`/${url}/get`, async (req, res) => {
  try {
    const offset = utcOffsetOf(req.headers.utcoffset);
    const fromDay = reportDay(req.headers.from, offset);
    const toDay = reportDay(req.headers.to, offset);
    if (!fromDay || !toDay) {
      return res.status(400).json({ status: 'error', result: 'A From and To date are required.' });
    }
    if (toDay < fromDay) {
      return res.status(400).json({ status: 'error', result: 'To is before From.' });
    }

    const company = /^\d+$/.test(String(req.headers.company ?? '')) ? Number(req.headers.company) : null;
    const [accounts, sums] = await Promise.all([
      Child_Account.findAll({ attributes: ['id', 'title', 'code', 'ChildAccountId'], raw: true }),
      accountSums({
        from: dayStart(fromDay, offset),
        toEnd: dayEnd(toDay, offset),
        company,
        currency: req.headers.currency,
      }),
    ]);

    const report = buildTrialBalance({
      accounts,
      sums,
      reportType: req.headers.reporttype,
      options: req.headers.options,
      accountId: req.headers.accountid,
    });

    res.json({
      status: "success",
      result: { ...report, from: fromDay, to: toDay, currency: req.headers.currency || 'PKR' },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "error", result: error.message || error });
  }
});


module.exports = routes;
