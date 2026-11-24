import { foreignRateProblem, rateFor, refreshUsdRates } from 'functions/chargeExRate';
import { rowMissingSize, EQUIPMENT_FIELDS, CONTAINER_FIELDS } from 'functions/requiredSize';
import { uniformFontMm } from 'functions/blAttachSheet';

/* THE USER'S REQUESTS OF 2026-10-13, FREIGHT: a foreign charge needs a rate
 * above 1; the job's USD Selling / Buying rates and their Refresh; container
 * sizes required; one font size for the B/L's big boxes. */
const usd = (over) => ({ type: 'Recievable', currency: 'USD', ex_rate: '280', net_amount: '100', status: '0', particular: 'OCEAN FREIGHT', ...over });

describe('a foreign charge needs a rate above 1', () => {
  test('an open USD line at 1 is refused, naming it', () => {
    expect(foreignRateProblem([usd(), usd({ ex_rate: '1' })])).toBe('Charge line 2 (OCEAN FREIGHT, USD) needs an exchange rate above 1.');
    expect(foreignRateProblem([usd({ currency: 'EUR', ex_rate: 0 })])).toMatch(/EUR/);
  });

  test('rupee lines, and lines already approved or on an approved invoice, are not', () => {
    expect(foreignRateProblem([{ currency: 'PKR', ex_rate: '1' }])).toBeNull();
    expect(foreignRateProblem([usd({ ex_rate: '1', status: '1' })])).toBeNull();
    expect(foreignRateProblem([usd({ ex_rate: '1', Invoice: { approved: '1' } })])).toBeNull();
  });
});

describe("the job's USD rates", () => {
  const rates = { selling: 280.5, buying: 279 };

  test('a receivable starts at the selling rate, a payable at the buying one - or selling, with none', () => {
    expect(rateFor('Recievable', rates)).toBe(280.5);
    expect(rateFor('Payble', rates)).toBe(279);
    expect(rateFor('Payble', { selling: 280.5, buying: '' })).toBe(280.5);
  });

  test('Refresh: every open USD line at its side\'s rate, its local amount again; the rest left', () => {
    const lines = [
      usd({ ex_rate: '1' }),
      usd({ type: 'Payble', ex_rate: '270' }),
      usd({ status: '1', ex_rate: '250' }),
      { type: 'Recievable', currency: 'PKR', ex_rate: '1', net_amount: '5000', status: '0' },
      usd({ ex_rate: '280.5' }),
    ];
    const { lines: out, changed } = refreshUsdRates(lines, rates);
    expect(changed).toBe(2);
    expect(out[0]).toMatchObject({ ex_rate: 280.5, local_amount: '28050.00' });
    expect(out[1]).toMatchObject({ ex_rate: 279, local_amount: '27900.00' });
    expect(out[2]).toBe(lines[2]);
    expect(out[3]).toBe(lines[3]);
    expect(out[4]).toBe(lines[4]);
  });
});

describe('container size required', () => {
  test('a row with anything on it needs a size; an empty row is not a row yet', () => {
    expect(rowMissingSize([{ size: '', qty: '', dg: '', gross: '', teu: '' }], EQUIPMENT_FIELDS)).toBeNull();
    expect(rowMissingSize([{ size: '40HC', qty: '2' }, { size: '', qty: '1' }], EQUIPMENT_FIELDS)).toBe(2);
    expect(rowMissingSize([{ no: 'MSCU1234567', size: '' }], CONTAINER_FIELDS)).toBe(1);
    expect(rowMissingSize([{ no: 'MSCU1234567', size: '20SD' }], CONTAINER_FIELDS)).toBeNull();
  });
});

describe("one size for the B/L's big boxes", () => {
  const em = (s) => String(s).length * 0.5;   // half an em a character - a fixed measure for the test
  const box = (lines) => ({ lines, widthMm: 93, heightMm: 23 });

  test('short text: the print\'s 3mm', () => {
    expect(uniformFontMm([box(['ACME LTD', 'KARACHI']), box(['TO ORDER'])], { em })).toBe(3);
  });

  test('one box too full at 3mm: every box comes down to the size that fits it', () => {
    const long = Array.from({ length: 8 }, (_, i) => `ADDRESS LINE ${i + 1}`);
    const f = uniformFontMm([box(['ACME LTD']), box(long)], { em });
    expect(f).toBeLessThan(3);
    expect(f).toBeGreaterThanOrEqual(2);
    expect(Math.floor(23 / (f * 1.2) + 1e-6)).toBeGreaterThanOrEqual(8);
  });

  test('not smaller than 2mm, however much there is', () => {
    expect(uniformFontMm([box(Array.from({ length: 40 }, () => 'X'))], { em })).toBe(2);
  });
});
