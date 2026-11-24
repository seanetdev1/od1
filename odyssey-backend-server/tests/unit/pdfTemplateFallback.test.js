/* An emailed invoice's PDF (functions/pdf.js) asks first whether a Word
 * template applies (Configuration > Printing Templates). A lookup that fails -
 * no "Printing_Templates" table, a sync that stopped short of it - must not
 * stop the email: it goes in the built-in layout, as it did before templates. */
jest.mock('puppeteer', () => ({ launch: jest.fn() }), { virtual: true });
jest.mock('../../models', () => ({
  Invoice: { findByPk: jest.fn() },
  Printing_Template: { findAll: jest.fn() },
}));

const puppeteer = require('puppeteer');
const { Invoice, Printing_Template } = require('../../models');
const { renderInvoicePdf } = require('../../functions/pdf');

const page = {
  setViewport: jest.fn(), goto: jest.fn(), waitForSelector: jest.fn(),
  pdf: jest.fn(async () => Buffer.from('%PDF built-in')),
};

beforeEach(() => {
  process.env.FRONTEND_BASE_URL = 'http://frontend';
  puppeteer.launch.mockResolvedValue({ newPage: async () => page, close: jest.fn() });
  Invoice.findByPk.mockResolvedValue({ id: 7, companyId: '3', type: 'Job Invoice' });
  page.goto.mockClear();
});

test('no table to look in: the built-in layout, and the email still goes', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  Printing_Template.findAll.mockRejectedValue(new Error('relation "Printing_Templates" does not exist'));
  const pdf = await renderInvoicePdf(7);
  expect(String(pdf)).toBe('%PDF built-in');
  expect(page.goto.mock.calls[0][0]).toMatch(/\/invoice-print\/7\?token=[^&]+$/);
  expect(spy.mock.calls[0][0]).toMatch(/Printing_Templates/);
  spy.mockRestore();
});

test('no template saved: the built-in layout, as before', async () => {
  Printing_Template.findAll.mockResolvedValue([]);
  expect(String(await renderInvoicePdf(7))).toBe('%PDF built-in');
});
