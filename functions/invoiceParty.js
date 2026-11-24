/**
 * Who an invoice is for, read from its charge lines.
 *
 * WHY THE LINES. An invoice is raised for the party its charges name, and
 * keeps that party's ledger account in party_Id - but nothing kept the two in
 * step afterwards. Change the party on every charge, unapprove, approve again,
 * and the header still named the old party: the print showed it, and approval
 * posted the receivable to the OLD party's ledger, because the voucher's party
 * line is written to party_Id.
 *
 * ONE PARTY OR NONE. Lines that agree decide the party. Lines that name
 * several (some migrated documents do) or none (lines whose party was never
 * resolved) say nothing, and the invoice keeps what it has - so approving a
 * document that was fine before cannot start failing.
 *
 * Pure: the caller looks the party and its account up.
 *
 * @param lines  Charge_Head rows or plain objects with partyId / name
 * @returns {{ clientId: string } | { mixed: string[] } | null}
 */
function linePartyOf(lines) {
  const rows = (lines || []).map((l) => (l && l.dataValues) || l || {});
  const ids = [...new Set(
    rows.map((r) => r.partyId)
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
      .map((v) => String(v).trim()),
  )];
  if (ids.length === 0) return null;
  if (ids.length > 1) return { mixed: [...new Set(rows.map((r) => r.name).filter(Boolean))] };
  return { clientId: ids[0] };
}

module.exports = { linePartyOf };
