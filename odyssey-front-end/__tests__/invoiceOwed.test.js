/**
 * What is still owed on an invoice - functions/invoiceOwed. The same cases as
 * the server's tests/unit/invoiceOwed.test.js.
 */
import { owedOn, isOwed, hasBalance } from '../functions/invoiceOwed';

test('the rounded total less what was received - or paid, on a bill', () => {
  expect(owedOn({ payType: 'Recievable', total: '1234.56', roundOff: '+0.44', recieved: '1000' })).toBeCloseTo(235);
  expect(owedOn({ payType: 'Payble', total: '500', roundOff: '0', paid: '200', recieved: '999' })).toBe(300);
  expect(owedOn({ payType: 'Recievable', total: '', roundOff: null, recieved: undefined })).toBe(0);
});

test.each([
  ['paid in full, round off and all', { payType: 'Recievable', total: '1234.56', roundOff: '+0.44', recieved: '1235' }, false],
  ["a knock-off's hair of floating point", { payType: 'Recievable', total: '1234.56', roundOff: '0', recieved: '1234.5599999999999' }, false],
  ['the same hair on a bill', { payType: 'Payble', total: '80', roundOff: '0', paid: '80.00000000000001' }, false],
  ['half a rupee still owed', { payType: 'Recievable', total: '1000', roundOff: '0', recieved: '999.5' }, true],
  ['a paisa still owed', { payType: 'Recievable', total: '1000', roundOff: '0', recieved: '999.99' }, true],
  ['paid without its round off - the 0.44 is still owed', { payType: 'Recievable', total: '1234.56', roundOff: '+0.44', recieved: '1234.56' }, true],
  ['over-paid', { payType: 'Recievable', total: '1000', roundOff: '0', recieved: '1100' }, true],
])('%s', (_, invoice, owed) => {
  expect(isOwed(invoice)).toBe(owed);
});

test('a worked-out balance: more than 0.00 or not', () => {
  expect(hasBalance(2.27e-13)).toBe(false);
  expect(hasBalance(-0.004)).toBe(false);
  expect(hasBalance(0.5)).toBe(true);
  expect(hasBalance('-0.01')).toBe(true);
  expect(hasBalance(undefined)).toBe(false);
});
