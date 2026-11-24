/**
 * Settlement figures for a migrated invoice.
 *
 * The legacy system has no paid/received columns on GL_Invoices. It records
 * settlement as adjustment rows in GL_InvAdjustments, one per part payment, so
 * how much of an invoice has been settled is a sum rather than a field.
 *
 * The migration used to write the literal 0 to both paid and recieved, which is
 * why every migrated invoice showed as unpaid no matter what its history was.
 *
 * Lives in its own module because this is the arithmetic that decides what a
 * user sees as paid, and it should be checkable without standing up a database
 * and a legacy API.
 */

// Currency amounts arrived at by summing, so compare with a tolerance rather
// than for equality - a half-cent of float drift must not make a fully settled
// invoice read as partly settled.
const TOLERANCE = 0.005;

/**
 * Status codes as the payment screens use them
 * (Components/Layouts/AccountsComp/PaymentsReceipt/Gl.js):
 *   "1" open        nothing settled
 *   "2" settled     settled in full
 *   "3" part        settled, but not for the full amount (under or over)
 */
const STATUS = { OPEN: '1', SETTLED: '2', PART: '3' };

/**
 * @param {Array<{Amount: number|string}>} adjustments  GL_InvAdjustments rows
 * @param {number|string} invoiceTotal                  GL_Invoices.InvoiceAmount
 * @param {boolean} receivable                          payType === "Recievable"
 */
function settlementFor(adjustments, invoiceTotal, receivable) {
  const rows = Array.isArray(adjustments) ? adjustments : [];
  const settled = rows.reduce((sum, a) => sum + (Number(a && a.Amount) || 0), 0);
  const total = Number(invoiceTotal) || 0;

  let status = STATUS.OPEN;
  if (settled > TOLERANCE) {
    status = Math.abs(settled - total) < TOLERANCE ? STATUS.SETTLED : STATUS.PART;
  }

  return {
    settled,
    // An invoice is either receivable or payable, never both, so the other
    // column stays at zero rather than mirroring the figure.
    paid: receivable ? 0 : settled,
    recieved: receivable ? settled : 0,
    status,
  };
}

module.exports = { settlementFor, STATUS, TOLERANCE };
