/**
 * NUMBERS NO TWO CUSTOMS JOBS MAY SHARE - Configuration > Customs > Job Screen
 * (the user, 2026-11-14): GD #, Client Invoice # and the S/R Page # (under the
 * install's name for it), each with its own switch.
 *
 * Switches, not a rule, by the user's choice: on CargoLinkers' book 885 GD
 * numbers and 774 client invoice numbers already repeat - short GD serials
 * that come round again, and part shipments, one client invoice over several
 * jobs - so a rule for every install would have stopped CL working as it does.
 *
 * ACROSS THE WHOLE COMPANY (the user's choice over per client / per year): no
 * two live jobs of the company may share a switched-on number, whatever their
 * client or date. Compared trimmed and ignoring case.
 *
 * My calls, not the user's:
 *   - a CANCELLED job does not count - its number is free again;
 *   - a BLANK number is never a duplicate;
 *   - a job keeps a number it ALREADY HAS: only a new or changed number is
 *     checked, so an old duplicate never stops its job from being saved.
 */

const { Op, Sequelize } = require('sequelize');

const norm = (v) => String(v ?? '').trim().toLowerCase();

/** The Client Invoice # as the job screen has it: invoiceNo, else clientRef. */
const clientInvoiceOf = (j = {}) => {
  const inv = String(j.invoiceNo ?? '').trim();
  return inv || String(j.clientRef ?? '').trim();
};

const FIELDS = [
  {
    setting: 'uniqueGdNumber',
    label: () => 'GD #',
    of: (j) => j.gdNumber,
    column: () => Sequelize.fn('lower', Sequelize.fn('trim', Sequelize.col('gdNumber'))),
  },
  {
    setting: 'uniqueClientInvoice',
    label: () => 'Client Invoice #',
    of: clientInvoiceOf,
    column: () => Sequelize.fn('lower', Sequelize.fn('trim', Sequelize.fn('coalesce',
      Sequelize.fn('nullif', Sequelize.fn('trim', Sequelize.col('invoiceNo')), ''),
      Sequelize.col('clientRef')))),
  },
  {
    setting: 'uniqueJobRef',
    label: (form) => form.referenceLabel || 'S/R Page #',
    of: (j) => j.jobRef,
    column: () => Sequelize.fn('lower', Sequelize.fn('trim', Sequelize.col('jobRef'))),
  },
];

/**
 * The numbers to look for: switched on, not blank, and new or changed from
 * what the job held before (`previous` - null for a new job).
 */
function numbersToCheck(form = {}, values = {}, previous = null) {
  return FIELDS
    .filter((f) => form[f.setting])
    .map((f) => ({ field: f, value: String(f.of(values) ?? '').trim() }))
    .filter(({ field, value }) => value && (!previous || norm(field.of(previous)) !== norm(value)));
}

/**
 * The first number another live job of the company already has, as
 * { label, value, jobNo } - or null.
 */
async function findDuplicate(Customs_Job, { form, values, previous = null, companyId, excludeId = null }) {
  for (const { field, value } of numbersToCheck(form, values, previous)) {
    const other = await Customs_Job.findOne({
      attributes: ['jobNo'],
      where: {
        [Op.and]: [
          { companyId: String(companyId) },
          { [Op.or]: [{ canceled: false }, { canceled: null }] },
          ...(excludeId ? [{ id: { [Op.ne]: excludeId } }] : []),
          Sequelize.where(field.column(), norm(value)),
        ],
      },
      order: [['id', 'ASC']],
    });
    if (other) return { label: field.label(form), value, jobNo: other.jobNo };
  }
  return null;
}

const duplicateMessage = (d) =>
  `${d.label} ${d.value} is already on job ${d.jobNo}. This install keeps each ${d.label} to one job `
  + '(Configuration > Customs > Job Screen).';

module.exports = { FIELDS, numbersToCheck, findDuplicate, duplicateMessage, clientInvoiceOf };
