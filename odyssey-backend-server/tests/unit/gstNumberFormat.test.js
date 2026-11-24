const {
  DEFAULT_GST_FORMAT, formatGstNumber, validateGstFormat, parseGstFormat, GstFormatError,
} = require('../../functions/gstNumberFormat');

// The GST invoice number's shape (Configuration > Invoices; Essani,
// 2026-11-14: four digits, and editable).
describe('GST invoice number format', () => {
  test('unset prints as numbers always have', () => {
    expect(DEFAULT_GST_FORMAT).toBe('{CODE}-#');
    expect(formatGstNumber(null, { code: 'CL', seq: 24295 })).toBe('CL-24295');
    expect(formatGstNumber(DEFAULT_GST_FORMAT, { code: 'CL', seq: 7 })).toBe('CL-7');
  });

  test('four digits - as hashes or regex-style', () => {
    expect(formatGstNumber('{CODE}-####', { code: 'ESS', seq: 1 })).toBe('ESS-0001');
    expect(formatGstNumber(String.raw`{CODE}-\d{4}`, { code: 'ESS', seq: 42 })).toBe('ESS-0042');
    expect(formatGstNumber(String.raw`GST/\d+`, { code: 'ESS', seq: 42 })).toBe('GST/42');
  });

  test('never cut: a number past the width prints whole', () => {
    expect(formatGstNumber('{CODE}-####', { code: 'ESS', seq: 12345 })).toBe('ESS-12345');
  });

  test('text after the number, and the code twice', () => {
    expect(formatGstNumber('{CODE}/###/{CODE}', { code: 'E', seq: 3 })).toBe('E/003/E');
  });

  test('refused: no number, two numbers, an unknown token, too wide', () => {
    expect(() => validateGstFormat('{CODE}-')).toThrow(GstFormatError);
    expect(() => validateGstFormat('##-##')).toThrow('Put the number in once');
    expect(() => validateGstFormat('{YEAR}-####')).toThrow('{YEAR} is not known');
    expect(() => validateGstFormat('#'.repeat(11))).toThrow('At most 10 digits.');
    expect(() => validateGstFormat('')).toThrow('Enter a format');
  });

  test('a stored format that no longer reads prints the default', () => {
    expect(formatGstNumber('nonsense', { code: 'CL', seq: 5 })).toBe('CL-5');
  });

  test('the parts', () => {
    expect(parseGstFormat(String.raw`INV-\d{6}-X`)).toEqual({ before: 'INV-', width: 6, after: '-X' });
  });
});
