/**
 * The narration on the voucher a CUSTOMS invoice posts when it is approved -
 * what the ledger, the party statement and the voucher itself show against
 * the entry.
 *
 * The freight one reads "Recievable Against Invoice JI-12/27 For Job# X From
 * PARTY", which on a clearing file leaves out everything the accounts side
 * looks an entry up by. This carries, in the order the user asked for:
 *
 *   the shipper, the client's own invoice #, Form-E #, job #, invoice #, GD #
 *
 *   Receivable from HAFIZ TANNERY, Client Inv # AMA-18792-26,
 *   Form-E # FE-9921, Against Job # TP-2300/27, Inv # CL-JI-2/27, GD # 50712
 *
 * A field the job has not got is left out rather than printed blank - the
 * legacy narration printed "LC # Inv #" with nothing after either.
 *
 * THE INVOICE NUMBER MUST STAY IN IT. routes/invoice links vouchers to
 * invoices by finding the invoice number inside the narration.
 *
 * THE SHIPPER, NOT THE CLIENT (the user, 2026-11-03): the job's shipper is
 * who the accounts side knows a clearing file by. It was the job's client.
 * When the shipper is the party billed, it is named once; otherwise, and on
 * every bill (the party is then a vendor), the party is named as well - the
 * entry sits on the party's account, and a narration that named only the
 * shipper would hide who it is with. A job with no shipper names its client,
 * as before - so a file nobody filled the shipper in on still says whose it is.
 */
const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/**
 * @param payType    'Recievable' | 'Payble' - the invoice's own spelling
 * @param invoiceNo  the invoice's number
 * @param partyName  the party billed / paid (Invoices.party_Name)
 * @param partyId    that party's Clients id, from a charge line
 * @param job        the customs job: jobNo, invoiceNo (or clientRef), formENo, gdNumber,
 *                   customFileNo, shipperId and shipper { name } (else clientId and
 *                   client { name })
 */
function customsVoucherNarration({ payType, invoiceNo, partyName, partyId, job }) {
  const receivable = payType === 'Recievable';
  const byShipper = present(job?.shipper?.name);
  const owner = byShipper ? job.shipper : job?.client;
  const ownerId = byShipper ? job?.shipperId : job?.clientId;
  const named = present(owner?.name) ? String(owner.name).trim() : null;
  const party = present(partyName) ? String(partyName).trim() : '';
  const billedTheOwner = !named
    || (present(partyId) && present(ownerId) && String(partyId) === String(ownerId));

  const head = receivable
    ? (billedTheOwner ? `Receivable from ${named || party}` : `Receivable from ${party} for ${named}`)
    : `Payable to ${party}${named ? ` for ${named}` : ''}`;

  const fields = [
    // The Client Invoice #: invoiceNo, or clientRef on an old job that only
    // has that copy of it - see routes/customsJobs clientInvoiceOf.
    ['Client Inv #', present(job?.invoiceNo) ? job.invoiceNo : job?.clientRef],
    ['Form-E #', job?.formENo],
    ['Against Job #', job?.jobNo],
    ['Inv #', invoiceNo],
    // The GD number is sometimes only in the file number - the same figure,
    // filled in the other box. As on the printed invoice.
    ['GD #', present(job?.gdNumber) ? job.gdNumber : job?.customFileNo],
  ].filter(([, v]) => present(v)).map(([label, v]) => `${label} ${String(v).trim()}`);

  return [head, ...fields].join(', ');
}

module.exports = { customsVoucherNarration };
