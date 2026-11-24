import { printCurrency, printsForeign, lineAmount } from 'functions/invoicePrintCurrency';
import { calculateTotal } from 'Components/Shared/invoicePrintDefaults';
import { invoiceFigures } from 'functions/invoiceExcel';

/* THE CURRENCY AN INVOICE PRINTS IN - functions/invoicePrintCurrency (the
 * user's report, 2026-10-12: changed to PKR, the print still said USD). The
 * invoice's own currency, as its Currency box sets it - not its type; the
 * type only for an invoice with none recorded. */
const usdLines = [
  { type: 'Recievable', partyType: 'agent', currency: 'USD', net_amount: '100', local_amount: '28000', ex_rate: '280' },
  { type: 'Recievable', partyType: 'agent', currency: 'USD', net_amount: '50', local_amount: '14150', ex_rate: '283' },
];

describe('the currency', () => {
  test("the invoice's own, whatever its type", () => {
    expect(printCurrency({ type: 'Agent Invoice', currency: 'PKR' })).toBe('PKR');
    expect(printCurrency({ type: 'Job Invoice', currency: 'usd' })).toBe('USD');
    expect(printsForeign({ type: 'Agent Bill', currency: 'PKR' })).toBe(false);
  });

  test('none recorded: by type, as the print always did', () => {
    expect(printCurrency({ type: 'Agent Invoice' })).toBe('USD');
    expect(printCurrency({ type: 'Job Bill', currency: '' })).toBe('PKR');
  });
});

describe('the figures', () => {
  test("an agent invoice changed to PKR prints its lines' PKR amounts", () => {
    expect(lineAmount(usdLines[1], false)).toBe(14150);
    expect(calculateTotal(usdLines, false)).toBe('42150.00');
    expect(invoiceFigures({ type: 'Agent Invoice', currency: 'PKR', roundOff: '0' }, usdLines))
      .toMatchObject({ currency: 'PKR', foreign: false, invoiceTotal: 42150, totalAmount: 42150 });
  });

  test('in its foreign currency, their own amounts', () => {
    expect(calculateTotal(usdLines, true)).toBe('150.00');
    expect(invoiceFigures({ type: 'Agent Invoice', currency: 'USD', roundOff: '0' }, usdLines))
      .toMatchObject({ currency: 'USD', foreign: true, invoiceTotal: 150 });
  });

  test('a job invoice in USD prints in USD - it always printed rupees', () => {
    const lines = usdLines.map((l) => ({ ...l, partyType: 'client' }));
    expect(invoiceFigures({ type: 'Job Invoice', currency: 'USD', roundOff: '0' }, lines))
      .toMatchObject({ currency: 'USD', invoiceTotal: 150 });
  });

  test('a customs line is always rupees', () => {
    expect(lineAmount({ CustomsJobId: 4, net_amount: '10', local_amount: '2800' }, true)).toBe(2800);
  });

  test('a line with no net of its own: its PKR amount back at its rate', () => {
    expect(lineAmount({ local_amount: '2800', ex_rate: '280' }, true)).toBe(10);
  });

  test('called without a currency, the old rule by party still holds', () => {
    expect(calculateTotal(usdLines)).toBe('150.00');
  });
});
