/**
 * The address under INVOICE TO on the freight invoice print.
 *
 * It printed the invoiced party's NAME over the JOB CLIENT's address
 * (SE_Job.Client.address1) whoever the invoice was to - so a bill to the
 * shipping line, or an invoice to the consignee or an agent, carried the
 * client's address under another party's name (the user's report,
 * 2026-10-20).
 *
 * The invoiced party's own record comes with the invoice: `recipient`, which
 * the server reads off the lines (routes/invoice printRecipient - party_Id
 * cannot be trusted for it, it means different things on migrated and new
 * invoices). The customs and Sale Tax Invoice prints already address from it.
 *
 * Without one, the job client's address is used only when the client IS the
 * invoiced party. Otherwise none: a blank line is a gap somebody notices; the
 * wrong address goes out to the customer.
 */
const text = (v) => String(v ?? '').trim();
const sameName = (a, b) => text(a).length > 0 && text(a).toLowerCase() === text(b).toLowerCase();

export const billToAddress = (invoice) => {
  const client = invoice?.SE_Job?.Client;
  const party = invoice?.recipient
    || (sameName(client?.name, invoice?.party_Name) ? client : null);
  return [party?.address1, party?.address2].map(text).filter(Boolean);
};
