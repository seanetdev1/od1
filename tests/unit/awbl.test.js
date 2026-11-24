// The AWB check digit is the one part of the number that is derived rather
// than entered, so a regression here would silently mint numbers no airline
// accepts - and it would not show up until a shipment was rejected. These
// pin the rule described in functions/awbl.js.

const {
  checkDigitFor,
  buildNumber,
  formatNumber,
  parseEntry,
  generateSeries,
} = require('../../functions/awbl');

describe('checkDigitFor', () => {
  test('is the serial modulo 7', () => {
    expect(checkDigitFor('1000000')).toBe('1'); // 1000000 = 142857*7 + 1
    expect(checkDigitFor('1000001')).toBe('2');
    expect(checkDigitFor('1000006')).toBe('0'); // wraps
  });

  test('never produces 7, 8 or 9', () => {
    for (let serial = 1000000; serial < 1000200; serial++) {
      expect(['0', '1', '2', '3', '4', '5', '6']).toContain(checkDigitFor(serial));
    }
  });
});

describe('parseEntry', () => {
  test('accepts a valid prefix and 8-digit code', () => {
    expect(parseEntry('125', '10000001')).toEqual({ ok: true, prefix: '125', serial: 1000000 });
  });

  test('tolerates spacing and dashes in the code', () => {
    expect(parseEntry('125', '1000000-1').ok).toBe(true);
    expect(parseEntry(' 125 ', '1000000 1').ok).toBe(true);
  });

  test('rejects a wrong check digit, and spells out the corrected number', () => {
    const result = parseEntry('125', '10000009');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/should be 1, not 9/);
    // The message has to carry the fixed number, because the list it lands on
    // is worked through by operations staff, not developers.
    expect(result.error).toContain('125-10000001');
  });

  test('rejects a prefix that is not exactly 3 digits', () => {
    expect(parseEntry('12', '10000001').ok).toBe(false);
    expect(parseEntry('1256', '10000001').ok).toBe(false);
    expect(parseEntry('12A', '10000001').ok).toBe(false);
  });

  test('rejects a code that is not exactly 8 digits', () => {
    expect(parseEntry('125', '1000000').ok).toBe(false);
    expect(parseEntry('125', '100000012').ok).toBe(false);
  });
});

describe('generateSeries', () => {
  test('increments the serial and recomputes the check digit, wrapping 6 -> 0', () => {
    const rows = generateSeries('125', 1000000, 9).map((r) => r.awbNumber);
    expect(rows).toEqual([
      '12510000001',
      '12510000012',
      '12510000023',
      '12510000034',
      '12510000045',
      '12510000056',
      '12510000060', // check digit wraps back to 0, serial keeps counting
      '12510000071',
      '12510000082',
    ]);
  });

  test('every generated number carries its own valid check digit', () => {
    for (const row of generateSeries('125', 9999000, 100)) {
      expect(parseEntry(row.prefix, `${row.serial}${row.checkDigit}`).ok).toBe(true);
    }
  });

  test('zero pads short serials to 7 digits', () => {
    const [first] = generateSeries('125', 42, 1);
    expect(first.serial).toBe('0000042');
    expect(first.awbNumber).toHaveLength(11);
  });

  test('stops at the 7-digit ceiling rather than rolling over', () => {
    expect(generateSeries('125', 9999998, 10)).toHaveLength(2);
  });

  test('defaults to a single number when count is missing or invalid', () => {
    expect(generateSeries('125', 1000000)).toHaveLength(1);
    expect(generateSeries('125', 1000000, 0)).toHaveLength(1);
  });
});

describe('formatNumber / buildNumber', () => {
  test('builds and displays the standard 3 + 8 grouping', () => {
    expect(buildNumber('125', 1000000)).toBe('12510000001');
    expect(formatNumber('12510000001')).toBe('125-10000001');
  });
});

/* SPECIAL FORMATS - 2026-10-21. DHL's master AWBs are not all IATA numbers:
 * SNS has flown DHL on 2102811410, 1737890254 (10-digit DHL waybills) and
 * SN-035-1873. The register takes them as printed, with no check digit. */
describe('special-format AWBs', () => {
  const {
    parseSpecial, parseSpecialList, specialRow, isSpecial, storedSpellings,
  } = require('../../functions/awbl');

  test('takes DHL\'s numbers as printed - one spelling, separators out, upper case', () => {
    expect(parseSpecial('2102811410')).toEqual({ ok: true, awbNumber: '2102811410' });
    expect(parseSpecial('SN-035-1873')).toEqual({ ok: true, awbNumber: 'SN0351873' });
    expect(parseSpecial(' sn 035.1873 ')).toEqual({ ok: true, awbNumber: 'SN0351873' });
    // A dash pasted from Word is still a dash.
    expect(parseSpecial('SN‑035–1873')).toEqual({ ok: true, awbNumber: 'SN0351873' });
  });

  test('refuses what is not letters and digits, or is wider than the column', () => {
    expect(parseSpecial('').ok).toBe(false);
    expect(parseSpecial('AWB#12').error).toMatch(/letters and digits only/);
    expect(parseSpecial('123456789012').error).toMatch(/at most 11 letters and digits - this has 12/);
  });

  test('will not take an 11-digit number - IATA\'s shape - whether it checks out or not', () => {
    // Valid: it belongs in the ordinary register, with its airline code.
    expect(parseSpecial('155-05444526').error).toMatch(/standard IATA number - register it without Special/);
    // Invalid: a typo Special must not wave through. Says what the digit should be.
    expect(parseSpecial('15505444527').error).toMatch(/last digit should be 6/);
  });

  test('a list is one per line or comma / semicolon separated, each number once', () => {
    expect(parseSpecialList('2102811410\n1737890254, 2102811410;\n\nSN-035-1873'))
      .toEqual({ ok: true, numbers: ['2102811410', '1737890254', 'SN0351873'] });
  });

  test('one bad entry refuses the whole list, naming it', () => {
    const res = parseSpecialList('2102811410\nbad!');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Nothing was registered\. bad!: letters and digits only/);
    expect(parseSpecialList('  \n ').error).toBe('Enter at least one AWB number.');
  });

  test('is stored with no prefix, serial or check digit - which is how it is told apart', () => {
    expect(specialRow('SN0351873')).toEqual({ prefix: '', serial: '', checkDigit: '', awbNumber: 'SN0351873' });
    expect(isSpecial(specialRow('SN0351873'))).toBe(true);
    expect(isSpecial({ checkDigit: '6' })).toBe(false);
    // And shown as stored: there is no 3 + 8 grouping to put back.
    expect(formatNumber('SN0351873')).toBe('SN0351873');
    expect(formatNumber('2102811410')).toBe('2102811410');
  });

  test('a MAWB typed on a BL is looked for under both spellings', () => {
    expect(storedSpellings('155-05444526')).toEqual(['15505444526']);
    // Digits alone would be 0351873 - a number nobody registered.
    expect(storedSpellings('SN-035-1873')).toEqual(['0351873', 'SN0351873']);
    expect(storedSpellings('  ')).toEqual([]);
  });
});
