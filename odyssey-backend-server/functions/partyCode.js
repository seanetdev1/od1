// The `code` a newly created party gets.
//
// Extracted from routes/clients createClient so the carrier page can create a
// party WITHOUT inventing a second numbering scheme. Two call sites numbering
// parties differently would stay invisible until someone sorted a report by
// code and found two series interleaved.
//
// The rule, unchanged from the original: take the most recently created
// party's code and add one. The exclusion list below is part of that rule -
// those eight rows are legacy imports whose codes are not numbers ('CU-00633',
// 'CC-11914'), and parseInt on any of them yields NaN, which would then be
// written as the next party's code and poison every party created after it.
// They are skipped so the query lands on a numeric code.
//
// This is the ORIGINAL behaviour, kept deliberately rather than hardened: any
// other non-numeric code reaching the top of the ordering has the same effect.
// Fixing that means renumbering existing rows, which is a decision about data
// rather than a code change - and guarding it HERE only, while createClient
// kept the old rule, would recreate exactly the divergence this file exists to
// prevent.
//
// The Clients model is passed IN rather than required here. functions/ and
// models/ are already circularly coupled (requiring clientAssociation on its
// own throws), and both call sites hold the model already, so taking it as an
// argument costs nothing and adds no new link to that chain.
const Sequelize = require('sequelize');
const Op = Sequelize.Op;

// Legacy rows whose `code` is not a number. See above.
const NON_NUMERIC_CODES = [
  'CU-00633', 'CC-00884', 'CU-00647', 'CU-00013',
  'CU-00721', 'CU-00902', 'CU-00146', 'CC-11914',
];

/**
 * The next code, given the newest party's code. Pure, so the arithmetic can be
 * tested without a database.
 *
 * `parseInt(x || 0) + 1` is the original expression: a missing code (the very
 * first party) reads as 0 and becomes 1.
 */
const bumpPartyCode = (lastCode) => parseInt(lastCode || 0) + 1;

/**
 * The next party code, read from the database.
 *
 * Takes the transaction so it participates in the caller's - two parties
 * created concurrently outside one would race for the same number.
 */
const nextPartyCode = async (Clients, transaction) => {
  const newest = await Clients.findOne({
    where: { code: { [Op.notIn]: NON_NUMERIC_CODES } },
    attributes: ['code'],
    order: [['createdAt', 'DESC']],
    transaction,
  });
  return bumpPartyCode(newest?.code);
};

module.exports = { bumpPartyCode, nextPartyCode, NON_NUMERIC_CODES };
