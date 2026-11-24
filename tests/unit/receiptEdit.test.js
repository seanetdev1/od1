const { priorShares, settlementChange } = require('../../functions/receiptEdit');

// What a payment or receipt adds to an invoice's received / paid - the
// difference an edit makes, not its whole share (it used to SET the figure).
describe('settlementChange', () => {
  test('a new receipt adds its whole share', () => {
    expect(settlementChange(600)).toBe(600);
    expect(settlementChange('193582.65', undefined)).toBe(193582.65);
  });

  test('an edit adds the difference - nothing, saved unchanged', () => {
    expect(settlementChange(600, 600)).toBe(0);
    expect(settlementChange(450.5, 600)).toBe(-149.5);
    expect(settlementChange(700, 600)).toBe(100);
  });

  test('taken off the receipt: gives back what it had paid', () => {
    expect(settlementChange(0, 600)).toBe(-600);
  });

  test('to the paisa, with no floating point dust', () => {
    expect(settlementChange(0.3, 0.1)).toBe(0.2);
    expect(settlementChange(1234.56, 1234.5599999999999)).toBe(0);
  });
});

describe('priorShares', () => {
  const model = (rows) => ({ findAll: jest.fn(async () => rows) });

  test("what the voucher carried, per invoice, its rows added up", async () => {
    const m = model([
      { InvoiceId: 7, amount: '600' }, { InvoiceId: 8, amount: '500.25' }, { InvoiceId: 7, amount: '0.1' },
    ]);
    const shares = await priorShares(m, 42, 'tx');
    expect(m.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { VoucherId: 42 }, transaction: 'tx' }));
    expect(shares.get('7')).toBe(600.1);
    expect(shares.get('8')).toBe(500.25);
  });

  test('no voucher (a new receipt): nothing, and no query', async () => {
    const m = model([]);
    expect((await priorShares(m, undefined)).size).toBe(0);
    expect(m.findAll).not.toHaveBeenCalled();
  });
});
