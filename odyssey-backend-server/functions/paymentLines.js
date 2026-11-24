/**
 * WHICH ACCOUNT A PAYMENTS & RECEIPTS LINE POSTS TO.
 *
 * The screen sends each line with a `partyId`: the party's CLIENTS id on the
 * party's own lines (its account line, its side of a gain / loss, of tax or
 * bank charges it pays), a CHILD ACCOUNT id on every other (the bank, the
 * gain / loss account, the tax account...). Those are two different
 * sequences, and a line was taken for the party's whenever its partyId was
 * EQUAL to the party's - so a bank account whose id happened to be the
 * party's Clients id posted to the party instead of the bank: the receipt
 * netted to nothing on the party and the bank was never debited. A fresh
 * database in CI landed on exactly that (2026-11-06, v1.2.88's tag run);
 * nothing on the SNS or CargoLinkers copies had yet.
 *
 * The screen now marks the party's lines (`onParty: true`). A request that
 * marks any line is read by the mark alone; one that marks none - a screen
 * older than this - by the old comparison, as before.
 *
 * No model imports - unit tested.
 */

/** Does the request say which lines are the party's? */
const marksParty = (lines = []) => lines.some((x) => x && Object.prototype.hasOwnProperty.call(x, 'onParty'));

/** The account a line posts to: the party's account for the party's own lines, else the line's own. */
function lineAccountId(line, { partyId, partyAccountId, marked }) {
  const onParty = line.accountType === 'partyAccount'
    || (marked ? line.onParty === true : line.partyId === partyId);
  return onParty ? partyAccountId : line.partyId;
}

module.exports = { marksParty, lineAccountId };
