// The party behind a carrier.
//
// WHY A CARRIER NEEDS ONE
//
// A charge is never billed to a master - it is billed to a PARTY, because that
// is what the ledger is reachable from. /aviationJob/makeInvoice resolves it
// like this:
//
//     Client_Associations.findOne({ where: { ClientId: charge.partyId } })
//     ...  invoice.party_Id = association.ChildAccountId
//
// Aviation_Carrier is name + prefix + category. It has no Clients row, so a
// charge pointed straight at a carrier id would raise an invoice that posts
// nowhere - worse than refusing, because the document exists and the books do
// not know about it.
//
// So a carrier CARRIES a party id, and every charge against that carrier is an
// ordinary charge against an ordinary party. Nothing downstream changes:
// invoice numbering, the JB bill series, approveInvoice, the ledger and the
// print template all see exactly what they see for a freight payable.
//
// LINK BEFORE CREATE
//
// The airlines being registered as carriers are, in most installs, already
// parties - they have been billed or paid before aviation mode existed.
// Creating a second "PIA" would split its history across two ledger accounts,
// which is the one outcome worth going out of the way to avoid. So an existing
// party of the same name is LINKED, and a new one created only when there is
// none.
//
// Models are passed in rather than required: functions/ and models/ are
// circularly coupled (requiring clientAssociation on its own throws), and the
// caller holds all three already.
const Sequelize = require('sequelize');
const { nextPartyCode } = require('./partyCode');
const { nextChildAccountCode } = require('./childAccountCode');

/**
 * The ledger code for a new account under `parentId`.
 *
 * Same allocation routes/clients uses - hierarchical by multiplication, and
 * BigInt because a level-4 code is thirteen digits and overflows int4.
 */
const allocateChildAccountCode = async (Child_Account, parentId, transaction) => {
  const parent = await Child_Account.findOne({
    where: { id: parentId },
    attributes: ['code'],
    transaction,
  });
  const siblings = await Child_Account.findAll({
    where: { ChildAccountId: parentId },
    attributes: ['code'],
    raw: true,
    transaction,
  });
  return nextChildAccountCode(parent?.code, siblings.map((s) => s.code));
};

/**
 * Find a party by name, case-insensitively and EXACTLY.
 *
 * lower(name) = lower(?) rather than iLike: a carrier name containing % or _
 * would be a wildcard under iLike and could link the carrier to the wrong
 * party entirely.
 */
const findPartyByName = (Clients, name, transaction) =>
  Clients.findOne({
    where: Sequelize.where(
      Sequelize.fn('lower', Sequelize.col('name')),
      String(name).trim().toLowerCase()
    ),
    transaction,
  });

/**
 * Give a carrier a party, and that party a ledger account.
 *
 * Returns { partyId, party, action, ledgerCreated }, where action is one of:
 *   'linked'   an existing party was used (by id, or matched by name)
 *   'created'  a new party was created for this carrier
 *
 * `partyName` is the name the party gets, when the carrier's own short name is
 * not what the books should call it. It applies ONLY when a party is created
 * or searched for. An existing party reached by `partyId` is never renamed
 * from here: its name is on every invoice already raised against it, and this
 * screen is not where that decision belongs.
 *
 * A party is only given a ledger account when `parentAccountId` is supplied
 * AND it has none already - re-saving a carrier must not keep stacking new
 * accounts under the same party.
 *
 * Throws with a readable message rather than returning an error shape: the
 * caller runs this inside a transaction, and a throw is what rolls it back.
 */
const ensureCarrierParty = async ({
  models,
  name,
  partyName = null,
  partyId = null,
  parentAccountId = null,
  createdBy = null,
  transaction = null,
}) => {
  const { Clients, Client_Associations, Child_Account } = models;
  let party = null;
  let action = 'linked';

  // A carrier is known by its short name - "PIA" - but the books usually want
  // the legal one, "Pakistan International Airlines". partyName is that, and it
  // governs BOTH the search and the creation: if a name was typed, it is the
  // name meant, so linking to a party called "PIA" instead would quietly
  // override it.
  //
  // Each candidate is TRIMMED BEFORE it is chosen, not after. '   ' is truthy,
  // so trimming afterwards would let a box containing only spaces win the
  // fallback and then collapse to empty - refusing the save with "a party
  // needs a name" while the carrier name sat right there unused.
  const bookName = String(partyName ?? '').trim() || String(name ?? '').trim();
  if (!bookName) throw new Error('A party needs a name.');

  if (partyId) {
    party = await Clients.findByPk(partyId, { transaction });
    if (!party) throw new Error('That party no longer exists.');
  } else {
    party = await findPartyByName(Clients, bookName, transaction);
  }

  if (!party) {
    party = await Clients.create({
      name: bookName,
      code: await nextPartyCode(Clients, transaction),
      // The party type the Charges tab resolves a 'Carrier' default against.
      types: 'Carrier',
      operations: '',
      // nongl mirrors createClient: '0' has a ledger, '1' does not.
      nongl: parentAccountId ? '0' : '1',
      active: true,
      createdBy: createdBy || null,
    }, { transaction });
    action = 'created';
  }

  // Already has a ledger? Leave it. This is the re-save path, and it is also
  // what makes linking an existing party safe - its account is its own, and
  // registering it as a carrier must not touch it.
  const existing = await Client_Associations.findOne({
    where: { ClientId: party.id },
    transaction,
  });
  if (existing?.ChildAccountId || !parentAccountId) {
    return { partyId: party.id, party, action, ledgerCreated: false };
  }

  const account = await Child_Account.create({
    title: party.name,
    subCategory: 'Customer',
    editable: false,
    code: await allocateChildAccountCode(Child_Account, parentAccountId, transaction),
    ChildAccountId: parentAccountId,
  }, { transaction });

  await Client_Associations.create({
    ClientId: party.id,
    ChildAccountId: account.id,
  }, { transaction });

  // A party created as non-GL a moment ago now has a ledger.
  if (party.nongl !== '0') {
    await Clients.update({ nongl: '0' }, { where: { id: party.id }, transaction });
  }

  return { partyId: party.id, party, action, ledgerCreated: true };
};

module.exports = { ensureCarrierParty, findPartyByName, allocateChildAccountCode };
