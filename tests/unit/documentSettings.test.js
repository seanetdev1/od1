/**
 * Configuration > Documents (functions/documents/settings.js): the list of
 * document types, and which folders may be chosen.
 */
const path = require('path');
const settings = require('../../functions/documents/settings');

describe('document types', () => {
  const stored = () => settings.normalizeTypes(null);

  test('a fresh install starts with a list - Invoice shown on the job\'s invoices', () => {
    const { types, nextId } = stored();
    expect(types.map((t) => t.name)).toEqual(['Invoice', 'Bill of Lading', 'Air Waybill', 'Goods Declaration', 'Packing List', 'Receipt', 'Other']);
    expect(types.filter((t) => t.onInvoices).map((t) => t.name)).toEqual(['Invoice']);
    expect(nextId).toBe(8);
  });

  test('a renamed type keeps its number; a new one gets the next; numbers are never reused', () => {
    const first = settings.mergeTypes(stored(), [
      { id: 1, name: 'Commercial Invoice', onInvoices: true },
      { id: 7, name: 'Other' },
      { name: '  Delivery   Order ' },
    ]);
    expect(first.types).toEqual([
      { id: 1, name: 'Commercial Invoice', onInvoices: true, offered: true },
      { id: 7, name: 'Other', onInvoices: false, offered: true },
      { id: 8, name: 'Delivery Order', onInvoices: false, offered: true },
    ]);
    const second = settings.mergeTypes(settings.normalizeTypes(JSON.stringify(first)), [
      ...first.types.filter((t) => t.id !== 8), { name: 'Weight Slip' },
    ]);
    expect(second.types.find((t) => t.name === 'Weight Slip').id).toBe(9);
  });

  test('an id it never gave is a new type, not a way to take over a number', () => {
    const out = settings.mergeTypes(stored(), [{ id: 99, name: 'Invented' }, { id: 1, name: 'Invoice' }]);
    expect(out.types.find((t) => t.name === 'Invented').id).toBe(8);
  });

  test('refused: no name, a name twice, removing one in use, nothing offered', () => {
    expect(() => settings.mergeTypes(stored(), [{ name: ' ' }])).toThrow(/needs a name/);
    expect(() => settings.mergeTypes(stored(), [{ name: 'Receipt' }, { name: 'receipt' }])).toThrow(/two types called "receipt"/);
    expect(() => settings.mergeTypes(stored(), stored().types.filter((t) => t.id !== 2), new Map([[2, 3]])))
      .toThrow(/"Bill of Lading" is on 3 documents, so it cannot be removed - untick Offered/);
    expect(() => settings.mergeTypes(stored(), [{ id: 1, name: 'Invoice', offered: false }])).toThrow(/At least one type must be offered/);
    // Retiring one in use is how it goes.
    const retired = settings.mergeTypes(stored(), stored().types.map((t) => (t.id === 2 ? { ...t, offered: false } : t)), new Map([[2, 3]]));
    expect(retired.types.find((t) => t.id === 2).offered).toBe(false);
  });
});

describe('the folders that may be chosen', () => {
  afterEach(() => { delete process.env.ODYSSEY_DOCUMENTS_ROOTS; });

  test('inside the folders the server makes available, and nowhere else', () => {
    process.env.ODYSSEY_DOCUMENTS_ROOTS = [path.resolve('/documents'), path.resolve('/mnt')].join(',');
    expect(settings.insideRoots(path.resolve('/mnt/data/odyssey'))).toBe(true);
    expect(settings.insideRoots(path.resolve('/documents'))).toBe(true);
    expect(settings.insideRoots(path.resolve('/mnt/../etc'))).toBe(false);
    expect(settings.insideRoots(path.resolve('/mntx/data'))).toBe(false);
    expect(settings.insideRoots(path.resolve('/etc'))).toBe(false);
  });

  test('unset, the kits\' mounts', () => {
    expect(settings.allowedRoots()).toEqual(['/documents', '/mnt', '/media', '/srv'].map((r) => path.resolve(r)));
  });
});
