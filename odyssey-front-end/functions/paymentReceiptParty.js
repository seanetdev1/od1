/**
 * WHAT THE PARTY ON A PAYMENT / RECEIPT IS: client, vendor or agent.
 *
 * Read from the party's own record. `types` is a free-text list of roles
 * ("Shipper, Consignee", "Local Vendor, Transporter"), so this is a reading of
 * it, not a lookup. An agent role wins, then a vendor role; anything else - a
 * shipper, a consignee, no roles at all - reads as a client, which is what
 * the screen defaulted to before this was derived.
 *
 * Where it goes: the voucher's stored partyType (the P&R list's Party label),
 * the print's title ("Vendor Payment"), and the server, which names an agent's
 * voucher by the side its bank / cash line is on rather than by pay type.
 *
 * BROKEN FROM v1.2.18 TO 2026-11-16. The Client / Vendor / Agent selector went
 * (one party list) and the save went on sending the selector's field, `type` -
 * now the party LIST's filter, 'all'. The type worked out for the party was
 * set into a field the store did not have, and refused. So every payment and
 * receipt saved since was stored as 'all', printed as "All Receipt", and listed
 * as "All". cl-deploy / sns-deploy p-and-r-party-type.sql repairs the stored
 * ones from their party.
 */
export const partyTypeOf = (party) => {
  const types = String(party?.types || '').toLowerCase();
  if (types.includes('agent')) return 'agent';
  if (types.includes('vendor')) return 'vendor';
  return 'client';
};

const KNOWN = ['client', 'vendor', 'agent'];

/**
 * The party picked on the screen, as one of the three. When it is not in the
 * loaded list - a voucher opened before the list arrived - what the voucher
 * was stored as, if that names one, and a client otherwise.
 */
export const selectedPartyType = (state) => {
  const party = (state?.PRaccounts || []).find((x) => x.id === state?.selectedAccount);
  if (party) return partyTypeOf(party);
  const stored = String(state?.type || '').toLowerCase();
  return KNOWN.includes(stored) ? stored : 'client';
};
