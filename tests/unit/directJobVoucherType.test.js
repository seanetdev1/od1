const { directJobVoucherType, keepsVoucherType } = require('../../functions/directJobVoucherType');

/* A Direct Job E/R posts the voucher Payments & Receipts would post for the
 * same money. The route compared the mode to lowercase 'bank' / 'cash' while
 * the screen sends 'Bank' / 'Cash' / 'Adjust', so every entry became a CN
 * (expense) or a DN (revenue). */
describe('directJobVoucherType', () => {
  it.each([
    ['expense', 'Bank', 'BPV'],
    ['revenue', 'Bank', 'BRV'],
    ['expense', 'Cash', 'CPV'],
    ['revenue', 'Cash', 'CRV'],
    ['expense', 'Adjust', 'ADJ-P'],
    ['revenue', 'Adjust', 'ADJ-R'],
  ])('a %s by %s posts a %s', (type, mode, vType) => {
    expect(directJobVoucherType(type, mode)).toBe(vType);
  });

  it('reads the mode and the side whatever their case', () => {
    expect(directJobVoucherType('expense', 'bank')).toBe('BPV');
    expect(directJobVoucherType('Revenue', ' CASH ')).toBe('CRV');
    expect(directJobVoucherType('expense', 'Adjustment')).toBe('ADJ-P');
  });

  it('never falls back to a credit or debit note', () => {
    expect(directJobVoucherType('expense', 'Cheque')).toBeNull();
    expect(directJobVoucherType('revenue', '')).toBeNull();
    expect(directJobVoucherType('revenue', undefined)).toBeNull();
  });
});

describe('keepsVoucherType', () => {
  it('keeps a voucher already in the right series', () => {
    expect(keepsVoucherType('CPV', 'CPV')).toBe(true);
  });

  it('moves one whose mode or side changed, and the CN/DN the old code issued', () => {
    expect(keepsVoucherType('CPV', 'BPV')).toBe(false);
    expect(keepsVoucherType('CPV', 'CRV')).toBe(false);
    expect(keepsVoucherType('CN', 'CPV')).toBe(false);
    expect(keepsVoucherType('DN', 'BRV')).toBe(false);
  });

  it('keeps the journal voucher Climax posted an adjustment as', () => {
    expect(keepsVoucherType('JV', 'ADJ-P')).toBe(true);
    expect(keepsVoucherType('JV', 'CPV')).toBe(false);
  });
});
