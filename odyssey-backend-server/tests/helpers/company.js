// A company for a suite that only needs one to exist.
//
// Saving a job now needs a REAL company (functions/companyCodes): a made-up
// id is refused exactly as a blank one is. These suites used to fall back to
// '1' when the database had no company, which on CI's empty database named a
// company that is not there. This finds the first one, as they did, and
// creates one only when there is none - on CI, once, for every suite after.
const { Company } = require('../../models');
const { TEST_PREFIX } = require('./auth');

async function anyCompany({ where } = {}) {
  const found = await Company.findOne({ ...(where ? { where } : {}), order: [['id', 'ASC']] });
  if (found) return found;
  return Company.create({ title: `${TEST_PREFIX}Any Company`, short: 'TAC' });
}

module.exports = { anyCompany };
