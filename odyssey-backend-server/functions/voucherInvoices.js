/**
 * The invoices a payment or receipt settled, from Vouchers.invoices.
 *
 * makeTransaction writes them as text: "80761,80762," - each id followed by a
 * comma. The Payments & Receipts list matched an invoice to a voucher by
 * SUBSTRING (`invoices.includes("8076")`), which is true of "80761," too: a
 * receipt for one party also showed another party's invoice 8076 whenever the
 * two were on the same page of the list. The ledger was right all along - it
 * reads the voucher, not this list.
 *
 * Split on the commas and compare whole ids. No model imports - unit tested.
 */
const invoiceIdsOf = (list) => new Set(
  String(list ?? '').split(',').map((id) => id.trim()).filter(Boolean),
);

module.exports = { invoiceIdsOf };
