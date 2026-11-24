/**
 * Who a customs job's Client box offers - functions/customsClientList (the
 * user, 2026-11-17: parties tagged only as Terminals were showing up).
 */
const { mayBeClient, tagsOf } = require('../../functions/customsClientList');

test('a party tagged only as a Terminal is not offered', () => {
  expect(mayBeClient('Terminal')).toBe(false);
  expect(mayBeClient(' Terminal , Terminal ')).toBe(false);
});

test('a Terminal with another tag as well is', () => {
  expect(mayBeClient('Terminal, Consignee')).toBe(true);
  // As CargoLinkers' terminals are tagged.
  expect(mayBeClient('Local Vendor, Transporter, Warehouse, Depot, Terminal')).toBe(true);
});

test('an untagged party is still offered - a customer may have no tag at all', () => {
  expect(mayBeClient('')).toBe(true);
  expect(mayBeClient(null)).toBe(true);
});

test('the tags, as the comma-joined column holds them', () => {
  expect(tagsOf('Shipper, Consignee')).toEqual(['Shipper', 'Consignee']);
  expect(tagsOf(' , ')).toEqual([]);
});
