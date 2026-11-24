const { narrationPattern, invoiceVType } = require('../../functions/invoiceVoucher');

// The pattern runs in Postgres (`~`); its syntax here is the common subset, so
// a JS RegExp of the same text reads it the same way.
const finds = (invoiceNo, narration) => new RegExp(narrationPattern(invoiceNo)).test(narration);

describe('finding a migrated invoice in the narration Climax wrote', () => {
  test('an invoice, by "Inv #", in the middle of the line', () => {
    expect(finds('JI-2710/27', 'Receivable Against Job # TP-2273/27 LC # Inv # JI-2710/27 Job Ref # 34859')).toBe(true);
  });

  test('a bill, by "Bill #", followed by a comma or the end of the line', () => {
    expect(finds('JB-8012/27', 'Payable to PROLINE (PVT) LTD (16), Bill # JB-8012/27, Job Ref')).toBe(true);
    expect(finds('JB-8012/27', 'Payable Against Job # TP-1/27 Bill # JB-8012/27')).toBe(true);
  });

  test('never a longer number that starts the same', () => {
    expect(finds('JI-271/27', 'Inv # JI-2710/27 Job Ref')).toBe(false);
    expect(finds('JI-271/27', 'Inv # JI-271/270 Job Ref')).toBe(false);
  });

  test('a number with regex characters in it is matched literally', () => {
    expect(finds('SNS-JI-1.2/27', 'Inv # SNS-JI-1.2/27 Job')).toBe(true);
    expect(finds('SNS-JI-1.2/27', 'Inv # SNS-JI-1x2/27 Job')).toBe(false);
  });

  test('a number with no "Inv #" or "Bill #" before it is not the invoice', () => {
    expect(finds('JI-2710/27', 'Job # JI-2710/27')).toBe(false);
  });
});

describe('the vType an invoice posts as', () => {
  test('SI for a receivable, PI for a payable', () => {
    expect(invoiceVType('Recievable')).toBe('SI');
    expect(invoiceVType('Payble')).toBe('PI');
  });
});
