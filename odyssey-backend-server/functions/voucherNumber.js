const {
  readNumbering, lastInYear, nextAfter, perCompany, formatNumber, codeFor,
} = require('./documentNumber');

/**
 * The next voucher number for a voucher type WITHIN a fiscal year.
 *
 * Voucher numbering restarts at 1 each fiscal year. The historical Climax data
 * does exactly that (SNS BPV ran 1..1373 in FY23, 1..1335 in FY24, 1..1875 in
 * FY26), and job and invoice numbering scope themselves the same way.
 *
 * Counted by vType and voucher_No - never by the text of voucher_Id beyond its
 * year - so renaming a voucher code or switching the company prefix in
 * Config > Document Numbers carries the sequence straight on. See lastInYear
 * in functions/documentNumber for how the year is read, and why a year-first
 * "SNS-BPV-27/26" is not mistaken for this year's.
 *
 * Read from voucher_Id rather than FiscalYearId for the year, because rows
 * imported from Climax have a null FiscalYearId.
 *
 * Per company while vouchers carry the company prefix; shared by every company
 * when they do not - see functions/documentNumber.
 *
 * @param Vouchers  the Vouchers model
 * @param vType     voucher type (BPV, BRV, SI, PI, ...)
 * @param CompanyId the company the voucher belongs to
 * @param suffix    fiscal year suffix, e.g. "27"
 * @param settings  numbering settings, when the caller already has them
 */
const nextVoucherNo = async (Vouchers, { vType, CompanyId, suffix, transaction, settings }) => {
  const s = settings || await readNumbering();
  const last = await lastInYear(Vouchers, {
    seqCol: 'voucher_No',
    noCol: 'voucher_Id',
    suffix,
    where: { vType },
    company: { column: 'CompanyId', id: CompanyId },
    scoped: perCompany(s, 'vouchers') && CompanyId !== undefined && CompanyId !== null,
    transaction,
  });
  return nextAfter(last, 'voucher_No');
};

/**
 * A voucher's number, as Config > Document Numbers lays vouchers out: the
 * configured code for its vType (BPV may print as something else), the
 * company prefix or not, the year before or after.
 */
const voucherId = (settings, { vType, company, seq, suffix }) => formatNumber(settings, {
  klass: 'vouchers', company, code: codeFor(settings, 'vouchers', vType), seq, suffix,
});

module.exports = { nextVoucherNo, voucherId };
