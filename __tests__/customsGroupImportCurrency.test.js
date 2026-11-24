/**
 * A line imported from a customs charge group takes a currency - the group's,
 * or the charge master's when the group leaves it empty (CustomsJobs/Charges,
 * importedLineCurrency).
 *
 * It stayed blank, while the same charge picked by hand carried the master's
 * "PKR"; the server then raised the two on separate invoices for one client.
 */
import { importedLineCurrency } from '../Components/Layouts/CustomsJobs/Charges';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));

const master = { id: 7, currency: 'PKR' };

test('an empty group currency takes the charge master\'s - as a hand-picked line does', () => {
  expect(importedLineCurrency({ charge: 7, currency: null }, master)).toBe('PKR');
  expect(importedLineCurrency({ charge: 7, currency: '' }, master)).toBe('PKR');
});

test('the group\'s own currency wins, in capitals', () => {
  expect(importedLineCurrency({ charge: 7, currency: 'USD' }, master)).toBe('USD');
  expect(importedLineCurrency({ charge: 7, currency: ' usd ' }, master)).toBe('USD');
});

test('neither says: none', () => {
  expect(importedLineCurrency({ charge: 7 }, {})).toBeNull();
  expect(importedLineCurrency({ charge: 7 }, undefined)).toBeNull();
});
