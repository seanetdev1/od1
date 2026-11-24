/*
 * Shared definitions for replacing one party with another.
 *
 * A party id is referenced from two very different kinds of place, and the
 * distinction is what makes the feature safe:
 *
 *  OPERATIONAL references (jobs, BLs, AWB stock, associations) can simply be
 *  repointed at the replacement party. Nothing about the shipment changes.
 *
 *  FINANCIAL references (invoices, vouchers, transactions, charge heads) are
 *  accounting records. Moving them between parties silently rewrites who owes
 *  or is owed money, so their presence BLOCKS the replacement instead. They
 *  also carry a denormalised copy of the party NAME, which would then disagree
 *  with the id.
 *
 * Note that the financial columns are `character varying` and carry NO foreign
 * key - they are not visible in information_schema as references to Clients at
 * all. Anything that walked only the declared foreign keys would repoint the
 * jobs, delete the party, and leave every invoice and voucher pointing at an id
 * that no longer exists.
 *
 * THE OPERATIONAL LIST MUST BE COMPLETE, and not only for tidiness. Almost
 * every foreign key to Clients is ON DELETE SET NULL, so a reference missing
 * from this list is not an error when the old party is deleted - it is quietly
 * blanked: a customs job loses its consignee, a consignment its shipper. The
 * list covers every mode (freight, customs, aviation) because the schema is the
 * same on every install. When a new column starts pointing at a party, add it
 * here.
 */

// Repointed on merge.
//   text        the column is varchar, so the id is compared and written as text
//   nameColumn  a denormalised copy of the party's name, refreshed with the id
//   uniqueWithin a membership table: a row whose group already holds the
//               replacement is dropped rather than duplicated
const OPERATIONAL_REFS = [
  { table: 'SE_Jobs', column: 'ClientId', label: 'Jobs (as client)' },
  { table: 'SE_Jobs', column: 'airLineId', label: 'Jobs (as airline)' },
  { table: 'SE_Jobs', column: 'consigneeId', label: 'Jobs (as consignee)' },
  { table: 'SE_Jobs', column: 'customAgentId', label: 'Jobs (as custom agent)' },
  { table: 'SE_Jobs', column: 'forwarderId', label: 'Jobs (as forwarder)' },
  { table: 'SE_Jobs', column: 'localVendorId', label: 'Jobs (as local vendor)' },
  { table: 'SE_Jobs', column: 'overseasAgentId', label: 'Jobs (as overseas agent)' },
  { table: 'SE_Jobs', column: 'shipperId', label: 'Jobs (as shipper)' },
  { table: 'SE_Jobs', column: 'shippingLineId', label: 'Jobs (as shipping line)' },
  { table: 'SE_Jobs', column: 'transporterId', label: 'Jobs (as transporter)' },
  { table: 'Bls', column: 'notifyPartyOneId', label: 'BLs (notify party 1)' },
  { table: 'Bls', column: 'notifyPartyTwoId', label: 'BLs (notify party 2)' },
  { table: 'Awbls', column: 'AirlineId', label: 'AWB numbers (airline)' },
  { table: 'Client_Associations', column: 'ClientId', label: 'Party ledger associations' },

  { table: 'Customs_Jobs', column: 'clientId', label: 'Customs jobs (as client)' },
  { table: 'Customs_Jobs', column: 'consigneeId', label: 'Customs jobs (as consignee)' },
  { table: 'Customs_Jobs', column: 'shipperId', label: 'Customs jobs (as shipper)' },
  { table: 'Customs_Jobs', column: 'chaChbId', label: 'Customs jobs (as CHA/CHB)' },
  { table: 'Customs_Jobs', column: 'localVendorId', label: 'Customs jobs (as local vendor)' },
  { table: 'Customs_Jobs', column: 'shippingLineId', label: 'Customs jobs (as shipping line)' },
  { table: 'Customs_Jobs', column: 'transporterId', label: 'Customs jobs (as transporter)' },
  {
    table: 'Customs_Charge_Group_Parties', column: 'partyId', label: 'Customs charge groups',
    text: true, nameColumn: 'partyName', uniqueWithin: 'CustomsChargeGroupId',
  },

  { table: 'Aviation_Carriers', column: 'partyId', label: 'Carriers (as their party)' },
  { table: 'Aviation_Awbs', column: 'masterAgentId', label: 'Aviation AWB stock (master agent)' },
  { table: 'Aviation_Consignments', column: 'shipperId', label: 'Consignments (as shipper)' },
  { table: 'Aviation_Consignments', column: 'consigneeId', label: 'Consignments (as consignee)' },
  { table: 'Aviation_Consignments', column: 'masterAgentId', label: 'Consignments (as master agent)' },
  { table: 'Aviation_Pfm_Lines', column: 'masterAgentId', label: 'PFM lines (as master agent)' },
];

// Block the merge. varchar columns holding the id as text, with no FK.
const FINANCIAL_REFS = [
  { table: 'Invoices', column: 'party_Id', label: 'Invoices / Bills' },
  { table: 'Vouchers', column: 'partyId', label: 'Vouchers' },
  { table: 'Transactions', column: 'partyId', label: 'Transactions' },
  { table: 'Charge_Heads', column: 'partyId', label: 'Job charge heads' },
];

// total/paid/recieved are STRING columns. NULLIF guards the empty strings.
const num = (col) => `COALESCE(NULLIF(btrim("${col}"), ''), '0')::numeric`;

/*
 * Outstanding = total - GREATEST(paid, recieved), NOT total - (paid + recieved).
 *
 * The two columns are mirror copies: on the live freight install's 32,656
 * settled invoices `paid` and `recieved` held the identical amount regardless
 * of whether the invoice was Payble or Recievable. Summing them therefore
 * double-counts the settlement and under-reports what is still owed.
 */
const OUTSTANDING_SQL = `${num('total')} - GREATEST(${num('paid')}, ${num('recieved')})`;

// Rounding tolerance. Settlements are written back rounded, so an invoice of
// 51767.43 settled at 51767 leaves 0.43 behind - dust, not a debt.
const PAID_TOLERANCE = 1;

module.exports = {
  OPERATIONAL_REFS,
  FINANCIAL_REFS,
  OUTSTANDING_SQL,
  PAID_TOLERANCE,
  num,
};
