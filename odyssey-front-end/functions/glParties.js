/**
 * Parties a REPORT can be filtered to: the ones with a ledger account.
 *
 * A non-GL party (Clients.nongl '1') is on documents only - a shipper or
 * consignee named on a BL - and never carries an invoice or a ledger line, so
 * picking one in a report can only ever show nothing. On CargoLinkers 11,752
 * of 12,972 parties are non-GL; the report pickers listed them all. The job
 * screens still list every party; this is for reports.
 *
 * A party with no nongl value (an older server) counts as GL, so nothing is
 * hidden that the server did not mark.
 */
export const isGlParty = (party) => String(party?.nongl ?? '0').trim() !== '1';

export const glOnly = (list) => (Array.isArray(list) ? list.filter(isGlParty) : []);

/**
 * A report's PARTY picker, built from several role lists: each GL party once.
 *
 * The lists (/seaJob/getValues) are by role, and a party is in one for every
 * role it has - 'client' alone holds every active party, and a forwarder that
 * is also a local vendor is in forwarder and localVendor as well. Joined
 * as they were, OOCL PAKISTAN came up three times under one name and code.
 * The first list a party is in decides its place.
 */
export const uniqueGlParties = (...lists) => {
  const seen = new Set();
  return lists.flatMap((list) => glOnly(list)).filter((p) => {
    const key = String(p.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export default glOnly;
