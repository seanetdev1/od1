/**
 * Plan a parties (clients/vendors) import before writing anything.
 *
 * Second stage of the rewritten migration, same shape as the chart of
 * accounts: work out everything first, report every problem, write only when
 * the caller has seen it.
 *
 * WHAT THE OLD IMPORT DID (/clientRoutes/bulkCreate, still in place)
 *
 *   - Loaded every Child_Account WITH its parent, then linear-scanned that
 *     array once per party to find one id. On this dataset that is roughly
 *     4,300 parties x 2,200 accounts, and the `parent` include was never read.
 *
 *   - `code: i` - a counter starting at 1 based on array position, not the
 *     legacy PartyCode. Client codes therefore meant nothing and changed if
 *     the import ran again or the source order shifted.
 *
 *   - `currency: party.CurrencyId` into a STRING column. CurrencyId is a
 *     numeric id, so every client ended up with a currency of "3" instead of
 *     "USD".
 *
 *   - Defaulted registerDate and bankAuthorizeDate to today when the legacy
 *     row had none, inventing a registration date for every party missing one.
 *
 *   - No climaxId check, so a second run duplicated every client. No
 *     transaction, so a failure part-way left some.
 *
 *   - Worst: if AccountId matched nothing, the client was quietly created as
 *     non-GL with no Client_Associations row. A client with no ledger account
 *     cannot be invoiced. Nothing said so - not an error, not a count, nothing.
 *     That is the number this planner puts front and centre.
 *
 * No database access here, so the mapping and the classification can be tested
 * directly.
 */

/** Trim and collapse whitespace; null when there is nothing left. */
function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * Normalise an email field that may hold several addresses.
 *
 * Odyssey supports multiple addresses per party - routes/invoice splits them on
 * `[;,]` - but the legacy data does not always use those separators. Of
 * CargoLinkers' 158 parties with an email, 6 carry more than one address: 3
 * separated by commas, which already work, and 3 by a DASH:
 *
 *   naizmh@live.com-naizmh@fsd.comsats.net.pk
 *   khalid.khan@libertymills.com- abdul.razzak@libertymills.com
 *
 * A dash split on `[;,]` yields one string containing both addresses, so
 * neither is deliverable and the party looks like it has a malformed email.
 *
 * Rather than guessing at separators, this EXTRACTS the addresses and rejoins
 * them with ", ". Extraction is what makes a dash safe: a hyphen inside a local
 * part (abdul-razzak@x.com) or a domain (info@my-company.com) stays inside its
 * address, because the pattern only ends an address at a real TLD.
 *
 * Falls back to the trimmed original when nothing matches, so a field holding
 * something that is not an address is preserved rather than silently emptied.
 */
function cleanEmails(value) {
  const text = cleanText(value);
  if (!text) return null;

  // The local part must START and END on an alphanumeric. Without that, the
  // dash in "a@x.com-b@y.com" is swallowed as the first character of the next
  // local part and the second address comes out as "-b@y.com". Hyphens INSIDE
  // a local part (abdul-razzak@...) are still allowed by the middle class.
  const found = text.match(
    /[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
  );
  if (!found || !found.length) return text;

  // De-duplicated, case-insensitively, keeping the first spelling of each.
  const seen = new Set();
  const out = [];
  for (const addr of found) {
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out.join(', ');
}

/** A date the legacy row actually carries, or null - never today. */
function asDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Legacy Is* flags -> the comma-separated strings the UI filters on. */
const OPERATION_FLAGS = [
  ['IsAirExport', 'Air Export'], ['IsAirImport', 'Air Import'],
  ['IsSeaExport', 'Sea Export'], ['IsSeaImport', 'Sea Import'],
];

const TYPE_FLAGS = [
  ['IsShipper', 'Shipper'], ['IsConsignee', 'Consignee'], ['IsNotify', 'Notify'],
  ['IsPotentialCustomer', 'Potential Customer'], ['IsNonOperationalParty', 'Non operational Party'],
  ['IsForwarder', 'Forwarder/Coloader'], ['IsLocalAgent', 'Local Vendor'],
  ['IsOverseasAgent', 'Overseas Agent'], ['IsCommissionAgent', 'Commission Agent'],
  ['IsIndentor', 'Indentor'], ['IsTransporter', 'Transporter'], ['IsCHACHB', 'CHA/CHB'],
  ['IsShippingLine', 'Shipping Line'], ['IsDeliveryAgent', 'Delivery Agent'],
  ['IsWarehouse', 'Warehouse'], ['IsBuyingHouse', 'Buying House'], ['IsAirLine', 'Air Line'],
  ['IsTrucking', 'Trucking'], ['IsDrayman', 'Drayman'], ['IsCartage', 'Cartage'],
  ['IsStevedore', 'Stevedore'], ['IsPrincipal', 'Principal'], ['IsDepo', 'Depot'],
  ['IsTerminalParty', 'Terminal'], ['IsBuyer', 'Buyer'], ['IsSlotOperator', 'Slot Operator'],
];

function flagsToList(row, flags) {
  const set = flags.filter(([key]) => row[key]).map(([, label]) => label);
  // Comma-separated with no trailing comma. The old version left one on the
  // end ("Shipper, "), which shows up in the UI and in any exact match.
  return set.length ? set.join(', ') : null;
}

/**
 * Map one legacy Gen_Parties row onto Clients columns.
 *
 * @param {object} row       the legacy party, with names already resolved
 * @param {object} employeeByClimaxId  legacy employee id -> Odyssey Employees.id
 */
function mapParty(row, employeeByClimaxId = new Map()) {
  const rep = (legacyId) => {
    if (legacyId === null || legacyId === undefined) return null;
    return employeeByClimaxId.get(String(legacyId)) || null;
  };

  return {
    climaxId: row.Id,
    // The legacy code, not a counter. This is what staff recognise a client by.
    code: cleanText(row.PartyCode),
    name: cleanText(row.PartyName),
    city: cleanText(row.CityName) || null,
    zip: cleanText(row.PostalCode),
    telephone1: cleanText(row.Telephone1),
    telephone2: cleanText(row.Telephone2),
    mobile1: cleanText(row.Mobile),
    person1: cleanText(row.ContactPerson),
    address1: cleanText(row.Address1),
    address2: cleanText(row.Address2),
    website: cleanText(row.WebSite),
    // Both may hold several addresses; normalised to the comma-separated form
    // the rest of the app splits on. See cleanEmails.
    accountsMail: cleanEmails(row.AccountsEmail),
    infoMail: cleanEmails(row.Email),
    strn: cleanText(row.STRN),
    // NTN comes from EINNo, NOT NTNName.
    //
    // NTNName is empty on every one of CargoLinkers' 12,918 parties - not
    // blank-ish, literally zero non-empty values - while EINNo holds 1,008
    // real NTNs in the Pakistani format ("1925643-4", "0803125-8"). Reading
    // NTNName dropped every tax number in the database, and an NTN has to
    // print on the invoice.
    //
    // NTNName is kept as a fallback for a source that does populate it.
    ntn: cleanText(row.EINNo) || cleanText(row.NTNName),
    // Null, not today. Inventing a registration date makes every party look
    // like it was registered on migration day.
    registerDate: asDate(row.DateOfRegistration),
    bankAuthorizeDate: asDate(row.AuthorizationDate),
    operations: flagsToList(row, OPERATION_FLAGS),
    types: flagsToList(row, TYPE_FLAGS),
    bank: cleanText(row.BankName),
    branchName: cleanText(row.BranchName),
    branchCode: cleanText(row.BranchCode),
    accountNo: cleanText(row.AccountNo),
    iban: cleanText(row.IBAN),
    swiftCode: cleanText(row.SwiftCode),
    routingNo: cleanText(row.RoutingNo),
    ifscCode: cleanText(row.IFCSCode),
    micrCode: cleanText(row.MICRCode),
    // The currency CODE. The old import wrote CurrencyId, so every client
    // carried a number where a code belonged.
    currency: cleanText(row.CurrencyCode) || 'PKR',
    createdBy: cleanText(row.AddLog) || 'Migration',
    // Blacklisted OR deactivated parties come across inactive rather than
    // being dropped - historical jobs still reference them.
    //
    // IsInActive was not read before, so 92 parties CargoLinkers had switched
    // off imported as live and selectable. IsBlackList is set on none of them,
    // so it was carrying the whole decision on its own and always said "keep".
    active: !row.IsBlackList && !row.IsInActive,
    // Set below once we know whether the ledger account resolved.
    nongl: '1',
    // Recovered from the legacy data; the old import set all three to null.
    salesRepresentatorId: rep(row.SalesPersonId),
    accountRepresentatorId: rep(row.AccountsRepId),
    docRepresentatorId: rep(row.DocsRepId),
  };
}

/**
 * @param {Array}    legacyRows
 * @param {object}   ctx
 * @param {Iterable} ctx.existingClimaxIds  parties already imported
 * @param {Iterable} ctx.accountIds         Child_Account ids that exist
 * @param {Map}      ctx.employeeByClimaxId legacy employee id -> Employees.id
 */
function planParties(legacyRows, ctx = {}) {
  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const alreadyImported = new Set([...(ctx.existingClimaxIds || [])].map(String));
  const accountIds = new Set([...(ctx.accountIds || [])].map(String));
  const employeeByClimaxId = ctx.employeeByClimaxId || new Map();

  const problems = {
    missingId: 0,
    missingName: [],
    duplicateClimaxIds: [],
    // Every party with no ledger account. Mostly expected - see typeStats
    // below - so this is a census, not an alarm.
    noLedgerAccount: [],
    // The subset that matters: parties of a type that normally DOES carry a
    // ledger account, but has none. These import fine and then cannot be
    // invoiced, and there is no other sign of it.
    ledgerTypeWithoutAccount: [],
    // Referenced an account that is not in the target - usually means the
    // chart of accounts stage has not run, or ran against different data.
    unresolvedAccount: [],
    unresolvedSalesRep: 0,
  };

  /**
   * Which party types actually carry a ledger account.
   *
   * Most parties in a real database legitimately have none: a shipper, a
   * consignee or a notify party is a name on a document, never invoiced. On
   * CargoLinkers that is 11,752 of 12,918 - so reporting a flat "11,752
   * parties have no ledger account" buries the one that matters in noise that
   * looks like a catastrophic failure.
   *
   * The split is derived from the data rather than hardcoded, because the
   * legacy PartyTypeId values are not documented anywhere and another
   * customer's may differ. A type where most rows DO have an account is a
   * ledger type; a party of that type with none is worth looking at. A type
   * where they mostly do not is an operational type, and that is expected.
   */
  const typeStats = new Map();
  for (const row of rows) {
    if (!row) continue;
    const t = row.PartyTypeId === null || row.PartyTypeId === undefined
      ? 'unknown' : String(row.PartyTypeId);
    const s = typeStats.get(t) || { total: 0, withAccount: 0 };
    s.total += 1;
    if (row.AccountId !== null && row.AccountId !== undefined) s.withAccount += 1;
    typeStats.set(t, s);
  }
  const isLedgerType = (t) => {
    const s = typeStats.get(t);
    return Boolean(s && s.total && s.withAccount / s.total > 0.5);
  };

  const seen = new Set();
  const toCreate = [];
  const associations = [];
  let skipped = 0;

  for (const row of rows) {
    if (!row || row.Id === null || row.Id === undefined) { problems.missingId += 1; continue; }

    const key = String(row.Id);
    if (seen.has(key)) { problems.duplicateClimaxIds.push(row.Id); continue; }
    seen.add(key);

    if (alreadyImported.has(key)) { skipped += 1; continue; }

    const mapped = mapParty(row, employeeByClimaxId);
    if (!mapped.name) { problems.missingName.push(row.Id); continue; }

    // Does it have a ledger account, and does that account exist here?
    const accountId = row.AccountId;
    const partyType = row.PartyTypeId === null || row.PartyTypeId === undefined
      ? 'unknown' : String(row.PartyTypeId);

    if (accountId === null || accountId === undefined) {
      // Genuinely non-GL in the source: a notify party, say. Expected.
      problems.noLedgerAccount.push({
        id: row.Id, name: mapped.name, partyType, reason: 'no account in source',
      });
      // ...unless it is a type that normally DOES have one, in which case this
      // is a customer or vendor that cannot be invoiced, and is the whole
      // reason this check exists.
      if (isLedgerType(partyType)) {
        problems.ledgerTypeWithoutAccount.push({ id: row.Id, name: mapped.name, partyType });
      }
    } else if (!accountIds.has(String(accountId))) {
      // Has one, but it is not in our chart. The FK on Client_Associations
      // would reject the row, so the association is skipped and the client
      // becomes non-GL - which is exactly the silent outcome being replaced.
      problems.unresolvedAccount.push({ id: row.Id, name: mapped.name, accountId });
      problems.noLedgerAccount.push({ id: row.Id, name: mapped.name, reason: 'account not in chart' });
    } else {
      mapped.nongl = '0';
      associations.push({ climaxId: row.Id, ChildAccountId: accountId });
    }

    if (row.SalesPersonId && !mapped.salesRepresentatorId) problems.unresolvedSalesRep += 1;

    toCreate.push(mapped);
  }

  return {
    toCreate,
    associations,
    problems,
    stats: {
      source: rows.length,
      toCreate: toCreate.length,
      alreadyImported: skipped,
      withLedgerAccount: associations.length,
      withoutLedgerAccount: toCreate.length - associations.length,
      // Per legacy party type: how many there are, how many carry a ledger
      // account, and whether this planner treats the type as a ledger type.
      // Reported so "11,752 have no account" can be read as "they are notify
      // parties" rather than as a broken import.
      byPartyType: Object.fromEntries(
        [...typeStats.entries()].map(([t, s]) => [t, {
          total: s.total, withAccount: s.withAccount, ledgerType: isLedgerType(t),
        }]),
      ),
    },
    // Nothing here is fatal. A party with no ledger account is still worth
    // having - it is a real party - and the count is reported so the operator
    // decides. What must not happen is it being silent.
    canApply: true,
  };
}

module.exports = { planParties, mapParty, flagsToList, cleanText, asDate, OPERATION_FLAGS, TYPE_FLAGS };
