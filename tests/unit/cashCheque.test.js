const { isCashVoucher, noCheque } = require('../../functions/cashCheque');

describe('functions/cashCheque', () => {
  test('CPV and CRV are cash vouchers, however they are written', () => {
    expect(['CPV', 'CRV', 'cpv', ' CRV '].map(isCashVoucher)).toEqual([true, true, true, true]);
  });

  test('nothing else is: bank, adjustment, journal, a missing type', () => {
    expect(['BPV', 'BRV', 'ADJ-P', 'ADJ-R', 'JV', 'TV', '', null, undefined].map(isCashVoucher))
      .toEqual(Array(9).fill(false));
  });

  test('no cheque is an empty number and no date', () => {
    expect(noCheque()).toEqual({ chequeNo: '', chequeDate: null });
  });

  test('each call is its own object, so assigning one into a body cannot leak', () => {
    const a = noCheque();
    a.chequeNo = 'x';
    expect(noCheque().chequeNo).toBe('');
  });
});
