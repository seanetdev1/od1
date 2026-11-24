// An open fiscal year for a suite that only needs one to exist.
//
// These suites took the newest unlocked year another suite had made, so they
// passed or failed by the order jest ran the files in: first on an empty
// database - which jest does to a file that failed last time - there was none,
// and the null tore down the whole file (2026-10-26). Found as before, and
// made only when there is none.
const { FiscalYears } = require('../../models');
const { TEST_PREFIX } = require('./auth');

async function anyFiscalYear() {
  const found = await FiscalYears.findOne({ where: { isLocked: false }, order: [['id', 'DESC']] });
  if (found) return found;
  return FiscalYears.create({ label: `${TEST_PREFIX}FY`, suffix: '99', startDate: '2026-07-01', endDate: '2027-06-30', isLocked: false });
}

module.exports = { anyFiscalYear };
