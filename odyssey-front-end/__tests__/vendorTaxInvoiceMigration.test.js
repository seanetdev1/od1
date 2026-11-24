/**
 * Vendor Tax Invoice Numbers - its own step on Configuration > Migration
 * (functions/migration/vendorTaxInvoices), the user's request of 2026-10-14.
 */
import { migrateVendorTaxInvoices } from 'functions/migration/vendorTaxInvoices';
import { stagesForMode } from 'functions/migration/engine';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));

beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); });

test('is a step of its own on a customs install, after Clearing Invoices', () => {
  const ids = stagesForMode('customs').map((s) => s.id);
  expect(ids).toContain('customsVendorTaxInvoices');
  expect(ids.indexOf('customsVendorTaxInvoices')).toBeGreaterThan(ids.indexOf('customsInvoices'));
  expect(stagesForMode('freight').map((s) => s.id)).not.toContain('customsVendorTaxInvoices');
});

test('pages the legacy bills through apply and says what it did and could not do', async () => {
  const rows = (n, from) => Array.from({ length: n }, (_, i) => ({ Id: from + i, TranNumber: `JB-${from + i}`, VendorTaxInvoiceNo: `IN-${from + i}` }));
  mockGet.mockImplementation(async (url, opts) => {
    if (url.endsWith('/jobs/getVendorTaxInvoiceNumbers')) {
      return { data: { total: 6000, rows: opts.params.offset === 0 ? rows(5000, 0) : rows(1000, 5000) } };
    }
    if (url === '/vendorTaxInvoiceMigration/verify') return { data: { result: { bills: 57632, withNumber: 13300 } } };
    throw new Error(`unexpected ${url}`);
  });
  mockPost.mockImplementation(async (url, body) => ({
    data: { result: { updated: body.rows.length - 10, problems: { alreadySet: 0, billNotFound: { count: 10, sample: ['JB-9'] } } } },
  }));
  const lines = [];
  const out = await migrateVendorTaxInvoices((l) => lines.push(l));

  expect(mockPost).toHaveBeenCalledTimes(2);
  expect(mockPost.mock.calls[0][0]).toBe('/vendorTaxInvoiceMigration/apply');
  expect(out.applied.updated).toBe(5980);
  expect(lines.join('\n')).toMatch(/put on 5,980 bills/);
  expect(lines.join('\n')).toMatch(/20 name a bill Odyssey does not have/);
  expect(lines.join('\n')).toMatch(/13,300 of 57,632 bills now carry one/);
});

test('says what it did, rather than a row count that cannot move', async () => {
  mockGet.mockImplementation(async (url) => (url.endsWith('/jobs/getVendorTaxInvoiceNumbers')
    ? { data: { total: 2, rows: [{ Id: 1, TranNumber: 'JB-1', VendorTaxInvoiceNo: 'A' }, { Id: 2, TranNumber: 'JB-2', VendorTaxInvoiceNo: 'B' }] } }
    : { data: { result: { bills: 10, withNumber: 2 } } }));
  mockPost.mockResolvedValue({ data: { result: { updated: 2, problems: { alreadySet: 0 } } } });
  const out = await migrateVendorTaxInvoices();
  expect(out.summary).toBe('2 bills given their number, 0 already had it; 2 of 10 bills now carry one');
  expect(out.warning).toBeNull();
});

/* The user's run of 2026-10-14 read "+0 rows" and nothing else: a database the
 * legacy bills were never imported into (a local SNS copy against the CL legacy
 * server) matches none of them. Said on screen. */
test('warns when no legacy bill is in this database', async () => {
  mockGet.mockImplementation(async (url) => (url.endsWith('/jobs/getVendorTaxInvoiceNumbers')
    ? { data: { total: 100, rows: Array.from({ length: 100 }, (_, i) => ({ Id: i, TranNumber: `JB-${i}`, VendorTaxInvoiceNo: 'X' })) } }
    : { data: { result: { bills: 23912, withNumber: 0 } } }));
  mockPost.mockResolvedValue({ data: { result: { updated: 0, problems: { alreadySet: 0, billNotFound: { count: 30, sample: [] }, wrongBill: { count: 70, sample: [] } } } } });
  const out = await migrateVendorTaxInvoices();
  expect(out.warning).toMatch(/None matched: 100 of 100 legacy bills are not in this database/);
  expect(out.reason).toBe('No legacy bill matched a bill in this database.');
});

test('names the legacy server to update when it lacks the endpoint', async () => {
  mockGet.mockRejectedValue({ response: { status: 404 } });
  await expect(migrateVendorTaxInvoices()).rejects.toThrow(/Climax-backup-server-CC/);
});
