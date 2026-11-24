/**
 * The lines under an invoice print's Total Amount, as Climax printed them:
 *
 *   Received   (Paid, on a bill)  what receipts / payments settled
 *   Adjustment                    what adjustment vouchers (ADJ-R / ADJ-P) settled
 *   Balance                       the Total Amount less both
 *
 * The invoice's recieved / paid holds everything settled, adjustments included;
 * `adjustment` is the server's share of it from adjustment vouchers (see the
 * backend's functions/invoiceAdjustment), so it is taken off to print the two
 * apart. All in the invoice's own currency, as its Total Amount is.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(v * 100) / 100;

export function settlementLines(invoice, totalAmount) {
  const bill = invoice?.payType === 'Payble';
  const settled = num(bill ? invoice?.paid : invoice?.recieved);
  const adjustment = num(invoice?.adjustment);
  return [
    { label: bill ? 'Paid' : 'Received', value: round2(settled - adjustment) },
    { label: 'Adjustment', value: round2(adjustment) },
    { label: 'Balance', value: round2(num(totalAmount) - settled) },
  ];
}

export default settlementLines;
