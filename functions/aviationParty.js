// Who an aviation charge falls to.
//
// A charge's default party TYPE is set once per charge in Setup > Charges
// ("this charge is normally payable to the Master Agent"). This turns that
// type into an actual party id on a given consignment.
//
// Three of the four roles read a field off the consignment. CARRIER IS A HOP
// FURTHER: the consignment names a carrier, and the carrier names its party
// (Setup > Carriers creates or links it). That indirection is deliberate - the
// carrier's party is not copied onto the consignment, so changing which party
// an airline is billed as takes effect everywhere at once instead of leaving
// every consignment entered before the change pointing at the old one.
//
// Kept out of the Charges component so it can be tested without rendering it.

/**
 * The party behind a line's carrier, or null.
 *
 * Null is the honest answer in two ordinary cases: the line has no carrier
 * yet, or the carrier has no party attached. Neither is an error - the charge
 * simply does not auto-fill and the party is picked by hand, exactly as it was
 * before carriers had parties at all.
 *
 * Accepts either shape a carrier arrives in: `partyId` from /getValues, or a
 * nested `party` object from /carriers.
 */
export const carrierPartyId = (line, carriers) => {
  if (!line?.AviationCarrierId) return null;
  const carrier = (carriers || []).find((c) => c.id === line.AviationCarrierId);
  return carrier?.partyId ?? carrier?.party?.id ?? null;
};

/**
 * Party-type -> the party on this line, by role.
 *
 * Keys match AVIATION_PARTY_TYPES. A freight party type is deliberately
 * absent: an old charge record carrying one simply does not auto-fill, rather
 * than filling in something wrong.
 */
export const PARTY_RESOLVERS = {
  'Shipper': (line) => line?.shipperId ?? null,
  'Consignee': (line) => line?.consigneeId ?? null,
  'Master Agent': (line) => line?.masterAgentId ?? null,
  'Carrier': (line, carriers) => carrierPartyId(line, carriers),
};

/**
 * The carrier's party shaped for a charge row, or null.
 *
 * `parties` is the BILLABLE party list. A party missing from it has no ledger
 * account, and defaulting a charge to it would only mean /makeInvoice refusing
 * the invoice later - so no default is returned instead, and Setup > Carriers
 * is where the missing ledger gets fixed.
 */
export const carrierPartyFor = (line, carriers, parties) => {
  const partyId = carrierPartyId(line, carriers);
  if (!partyId) return null;
  const party = (parties || []).find((p) => p.id === partyId);
  if (!party) return null;
  return { partyId, name: party.name, partyType: 'Carrier' };
};
