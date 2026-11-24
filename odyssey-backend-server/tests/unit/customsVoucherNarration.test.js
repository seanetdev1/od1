const { customsVoucherNarration } = require('../../functions/customsVoucherNarration');

// The narration a customs invoice's voucher carries - shipper, client invoice
// #, Form-E #, job #, invoice #, GD #, in the order the user asked for. The
// shipper, not the client (the user, 2026-11-03).
describe('customsVoucherNarration', () => {
  const job = {
    jobNo: 'TP-2300/27', invoiceNo: 'AMA-18792-26', formENo: 'FE-9921', gdNumber: '50712',
    clientId: 12, client: { name: 'BUYING HOUSE CO' },
    shipperId: 34, shipper: { name: 'HAFIZ TANNERY' },
  };

  test('an invoice to the job\'s own shipper: every field, in order', () => {
    expect(customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'CL-JI-2/27', partyName: 'HAFIZ TANNERY (77)', partyId: 34, job,
    })).toBe('Receivable from HAFIZ TANNERY, Client Inv # AMA-18792-26, Form-E # FE-9921, '
      + 'Against Job # TP-2300/27, Inv # CL-JI-2/27, GD # 50712');
  });

  test('an invoice to the client: the client it is from, the shipper it is for', () => {
    const text = customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'CL-JI-2/27', partyName: 'BUYING HOUSE CO (12)', partyId: 12, job,
    });
    expect(text).toMatch(/^Receivable from BUYING HOUSE CO \(12\) for HAFIZ TANNERY, Client Inv # /);
  });

  test('the client is not named in the shipper\'s place', () => {
    const text = customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'CL-JI-2/27', partyName: 'HAFIZ TANNERY (77)', partyId: 34, job,
    });
    expect(text).not.toContain('BUYING HOUSE CO');
  });

  test('it always carries the invoice number - vouchers are matched to invoices by it', () => {
    const text = customsVoucherNarration({ payType: 'Recievable', invoiceNo: 'CL-JI-9/27', job: {} });
    expect(text).toContain('CL-JI-9/27');
  });

  test('a field the job has not got is left out, not printed blank', () => {
    expect(customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'CL-JI-2/27', partyId: 34,
      job: { ...job, formENo: '', invoiceNo: null },
    })).toBe('Receivable from HAFIZ TANNERY, Against Job # TP-2300/27, Inv # CL-JI-2/27, GD # 50712');
  });

  test('an old job holding the Client Invoice # in clientRef alone still carries it', () => {
    expect(customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'I', partyId: 34, job: { ...job, invoiceNo: null, clientRef: 'AMA-18792' },
    })).toContain('Client Inv # AMA-18792, ');
  });

  test('the GD number falls back to the file number', () => {
    expect(customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'I', partyId: 34, job: { ...job, gdNumber: null, customFileNo: '50715' },
    })).toMatch(/GD # 50715$/);
  });

  test('billed to someone other than the job\'s shipper: both are named', () => {
    expect(customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'CL-JI-2/27', partyName: 'AGENT CO', partyId: 99, job,
    })).toMatch(/^Receivable from AGENT CO for HAFIZ TANNERY, /);
  });

  test('a bill names the vendor it is payable to, and the shipper it was for', () => {
    expect(customsVoucherNarration({
      payType: 'Payble', invoiceNo: 'CL-JB-4/27', partyName: 'QICT TERMINAL', partyId: 50, job,
    })).toMatch(/^Payable to QICT TERMINAL for HAFIZ TANNERY, Client Inv # AMA-18792-26, /);
  });

  test('a job with no shipper names its client, as before', () => {
    const noShipper = { ...job, shipperId: null, shipper: null };
    expect(customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'CL-JI-2/27', partyName: 'BUYING HOUSE CO (12)', partyId: 12, job: noShipper,
    })).toMatch(/^Receivable from BUYING HOUSE CO, Client Inv # /);
    expect(customsVoucherNarration({
      payType: 'Payble', invoiceNo: 'CL-JB-4/27', partyName: 'QICT TERMINAL', partyId: 50, job: noShipper,
    })).toMatch(/^Payable to QICT TERMINAL for BUYING HOUSE CO, /);
  });

  test('a job with neither falls back to the party', () => {
    expect(customsVoucherNarration({
      payType: 'Recievable', invoiceNo: 'I', partyName: 'WALK-IN', job: { jobNo: 'J' },
    })).toBe('Receivable from WALK-IN, Against Job # J, Inv # I');
  });
});
