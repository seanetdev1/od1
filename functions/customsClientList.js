/**
 * Who a customs job's Client box offers (GET /customsJob/getValues `client`).
 *
 * Deliberately NOT filtered to a "client" tag: a clearing agent's customer may
 * be tagged Shipper, Consignee, both or neither, and hiding a real customer
 * for a missing tick is worse than a longer list. But a party tagged ONLY as
 * a Terminal is never anybody's customer, and the box was offering every one
 * (the user, 2026-11-17: "parties only tagged with Terminals are showing up in
 * clients"). Those are left out. A Terminal with another tag as well - a
 * Consignee, a Local Vendor - stays, and so does an untagged party.
 *
 * A job that already has such a client keeps it on screen: the job screen
 * adds the saved party back from the full list (CreateOrEdit's `party`).
 *
 * Pure - unit tested.
 */

// Tags that, alone, mean the party is not a customer.
const NOT_A_CLIENT = ['Terminal'];

/** Clients.types is a comma-joined string ('Shipper, Consignee'). */
const tagsOf = (types) => String(types || '').split(',').map((t) => t.trim()).filter(Boolean);

/** May a party with these tags be offered as a customs job's client? */
const mayBeClient = (types) => {
  const tags = tagsOf(types);
  return !tags.length || tags.some((t) => !NOT_A_CLIENT.includes(t));
};

module.exports = { NOT_A_CLIENT, tagsOf, mayBeClient };
