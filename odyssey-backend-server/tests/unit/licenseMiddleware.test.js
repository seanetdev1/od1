/**
 * A read-only install (licence suspended) refuses every write with 423 - but
 * still prints invoices, from a Word template too: those requests are POSTs
 * only because the invoice's values go up in the body.
 */
jest.mock('../../functions/license/client', () => ({
  computeState: () => ({ mode: 'readonly' }),
  getState: () => ({ message: 'Read-only.' }),
}));

const { enforceLicense } = require('../../functions/license/middleware');

const call = (method, path) => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const next = jest.fn();
  enforceLicense({ method, path }, res, next);
  return { passed: next.mock.calls.length === 1, status: res.status.mock.calls[0]?.[0] };
};

test('a write is refused', () => {
  expect(call('POST', '/invoice/approve')).toEqual({ passed: false, status: 423 });
});

test('reads and logging in are not', () => {
  expect(call('GET', '/invoice/getInvoices').passed).toBe(true);
  expect(call('POST', '/authRoutes/login').passed).toBe(true);
});

test('printing from a Word template is not - one invoice or a bulk print', () => {
  expect(call('POST', '/printingTemplates/render').passed).toBe(true);
  expect(call('POST', '/printingTemplates/renderMany').passed).toBe(true);
  // Saving a template is a write.
  expect(call('POST', '/printingTemplates/save')).toEqual({ passed: false, status: 423 });
});
