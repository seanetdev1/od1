/**
 * The field mapping the ledger import settled on.
 *
 * Two importers used to write these same columns with different rules, and
 * whichever ran second won - so these are the decisions that used to be made
 * by insertion order.
 */
const {
  resolveVoucherType,
  resolveAccountType,
  isPayableAccount,
  resolveInvoiceMeta,
  sequenceFromNumber,
  partyDetailLine,
  accountIdForLine,
} = require('../../functions/ledgerMapping');

describe('sequenceFromNumber', () => {
  it('pulls the sequence out of a voucher number', () => {
    expect(sequenceFromNumber('SNS-PV-1043/25')).toBe('1043');
  });

  it('strips leading zeros', () => {
    expect(sequenceFromNumber('ACS-JI-000042/25')).toBe('42');
  });

  it('reads a number with no company prefix, which is a whole customer', () => {
    // CargoLinkers numbers every voucher BPV-00001/25 - two dash-parts, not
    // three. Reading parts[2] returned null for all 59,993 of them, so the
    // ledger stage would have imported nothing while reporting success.
    expect(sequenceFromNumber('BPV-00001/25')).toBe('1');
    expect(sequenceFromNumber('BRV-12345/26')).toBe('12345');
  });

  it('takes the LAST segment, so an extra prefix does not shift it', () => {
    expect(sequenceFromNumber('ACS-BRV-KHI-00123/23')).toBe('123');
  });

  it('refuses a segment that is not a number', () => {
    // voucher_No is INTEGER NOT NULL - a non-numeric sequence has to be
    // refused here rather than reaching the insert as NaN.
    expect(sequenceFromNumber('ACS-BRV-ABC/23')).toBeNull();
  });

  it('returns null for a number it cannot parse instead of throwing', () => {
    // The old code did .split("-")[2].split("/")[0] unguarded, so a short
    // number threw and took the whole voucher down with it.
    expect(sequenceFromNumber('NOTANUMBER')).toBeNull();
    expect(sequenceFromNumber('')).toBeNull();
    expect(sequenceFromNumber(null)).toBeNull();
    expect(sequenceFromNumber(undefined)).toBeNull();
  });

  it('returns null when the sequence is all zeros', () => {
    expect(sequenceFromNumber('SNS-PV-0000/25')).toBeNull();
  });
});

describe('resolveVoucherType', () => {
  /* `type` is the ONLY thing deciding which screen a voucher appears on, and
   * the two are exactly complementary on it:
   *
   *   Payments & Receipts   type IN  ('Job Payment', 'Job Reciept')
   *   Voucher List          type NOT IN the same two
   *
   * So 'Job Payment' is a claim that this voucher SETTLES A DOCUMENT, not a
   * description of how the money moved. */
  it('maps a payment that settles an invoice to Job Payment', () => {
    expect(resolveVoucherType({ VoucherType: 'BANK PAYMENT', TypeCode: 'BPV' }, true))
      .toEqual({ type: 'Job Payment', vType: 'BPV' });
  });

  it('maps a receipt that settles an invoice to Job Reciept', () => {
    expect(resolveVoucherType({ VoucherType: 'CASH RECEIPT', TypeCode: 'CRV' }, true))
      .toEqual({ type: 'Job Reciept', vType: 'CRV' });
  });

  it('leaves a payment that settles NOTHING under its own legacy name', () => {
    // The bug this fixes. Mapping every CPV/BPV/BRV/CRV to Job Payment sent
    // 7,525 CargoLinkers vouchers to Payments & Receipts when only 136 settle
    // anything - burying those 136 among rows with no document to show, and
    // leaving the Voucher List empty.
    expect(resolveVoucherType({ VoucherType: 'CASH PAYMENT VOUCHER', TypeCode: 'CPV' }, false))
      .toEqual({ type: 'CASH PAYMENT VOUCHER', vType: 'CPV' });
    expect(resolveVoucherType({ VoucherType: 'BANK RECEIPT VOUCHER', TypeCode: 'BRV' }, false))
      .toEqual({ type: 'BANK RECEIPT VOUCHER', vType: 'BRV' });
  });

  it('defaults to settling nothing when the caller does not say', () => {
    // The safe direction. The Voucher List shows everything that is not a
    // settlement, so a voucher sent there wrongly is still findable; a
    // Payments & Receipts screen full of vouchers with no invoice is not
    // obviously wrong to anyone looking at it.
    expect(resolveVoucherType({ VoucherType: 'BANK PAYMENT', TypeCode: 'BPV' }))
      .toEqual({ type: 'BANK PAYMENT', vType: 'BPV' });
  });

  it('keeps the type code rewrite on a note whether it settles or not', () => {
    // A note is an adjustment document in its own right and never belongs in
    // Payments & Receipts. Only its vType is rewritten.
    for (const settles of [true, false]) {
      expect(resolveVoucherType({ VoucherType: 'CREDIT NOTE', TypeCode: 'CN' }, settles))
        .toEqual({ type: 'CREDIT NOTE', vType: 'ADJ-P' });
    }
  });

  it('overrides the type code for debit and credit notes', () => {
    expect(resolveVoucherType({ VoucherType: 'DEBIT NOTE', TypeCode: 'DN' }))
      .toEqual({ type: 'DEBIT NOTE', vType: 'ADJ-R' });
    expect(resolveVoucherType({ VoucherType: 'CREDIT NOTE', TypeCode: 'CN' }))
      .toEqual({ type: 'CREDIT NOTE', vType: 'ADJ-P' });
  });

  it('passes an unrecognised type through unchanged', () => {
    expect(resolveVoucherType({ VoucherType: 'JOURNAL', TypeCode: 'JV' }))
      .toEqual({ type: 'JOURNAL', vType: 'JV' });
  });

  it('does not throw on a missing voucher type', () => {
    expect(resolveVoucherType()).toEqual({ type: undefined, vType: undefined });
    expect(resolveVoucherType({})).toEqual({ type: undefined, vType: undefined });
  });
});

describe('resolveAccountType', () => {
  const coa = (SubCategory, AccountName = '') => ({
    AccountName, GL_COASubCategory: { SubCategory },
  });

  it('classifies customer and vendor sub-categories as party accounts', () => {
    expect(resolveAccountType(coa('Customer Control'))).toBe('partyAccount');
    expect(resolveAccountType(coa('Vendor Control'))).toBe('partyAccount');
  });

  it('classifies bank and cash as pay accounts', () => {
    expect(resolveAccountType(coa('Bank Accounts'))).toBe('payAccount');
    expect(resolveAccountType(coa('Cash In Hand'))).toBe('payAccount');
  });

  it('recognises the exchange gain/loss account by name', () => {
    expect(resolveAccountType(coa('Other', 'EX-CHANGE RATE GAIN / LOSS')))
      .toBe('Gain/Loss Account');
  });

  it('recognises tax accounts by name', () => {
    expect(resolveAccountType(coa('Other', 'SALES TAX PAYABLE'))).toBe('Tax Account');
  });

  it('falls back to the adjustment account', () => {
    expect(resolveAccountType(coa('Other', 'FREIGHT INCOME'))).toBe('Adjust Charges Account');
  });

  it('does not throw on missing COA data', () => {
    expect(resolveAccountType()).toBe('Adjust Charges Account');
    expect(resolveAccountType({})).toBe('Adjust Charges Account');
  });
});

describe('isPayableAccount', () => {
  const detail = (parentName) => ({ GL_COA: { GL_COA: { AccountName: parentName } } });

  it('treats payable and liability parents as payable', () => {
    expect(isPayableAccount(detail('ACCOUNTS PAYABLE'))).toBe(true);
    expect(isPayableAccount(detail('CURRENT LIABILITIES'))).toBe(true);
  });

  it('recognises the misspelling that exists in the legacy chart of accounts', () => {
    // "LAIBILITY" is in the real data. Dropping it would silently flip those
    // vouchers to the client side.
    expect(isPayableAccount(detail('CURRENT LAIBILITY'))).toBe(true);
  });

  it('treats receivable parents as not payable', () => {
    expect(isPayableAccount(detail('ACCOUNTS RECEIVABLE'))).toBe(false);
  });

  it('does not throw on missing data', () => {
    expect(isPayableAccount()).toBe(false);
    expect(isPayableAccount({})).toBe(false);
  });
});

describe('resolveInvoiceMeta', () => {
  it('reads a job invoice as receivable', () => {
    expect(resolveInvoiceMeta({ InvoiceNumber: 'SNS-JI-1043/25' }))
      .toEqual({ type: 'Job Invoice', payType: 'Recievable', operation: 'JI' });
  });

  it('reads a job bill as payable', () => {
    expect(resolveInvoiceMeta({ InvoiceNumber: 'SNS-JB-1043/25' }))
      .toEqual({ type: 'Job Bill', payType: 'Payble', operation: 'JB' });
  });

  it('takes the direction of an agent invoice from its mode, not its number', () => {
    expect(resolveInvoiceMeta({ InvoiceNumber: 'SNS-AI-7/25', GL_InvMode: { ModeType: 'Receivable' } }).payType)
      .toBe('Recievable');
    expect(resolveInvoiceMeta({ InvoiceNumber: 'SNS-AI-7/25', GL_InvMode: { ModeType: 'Payable' } }).payType)
      .toBe('Payble');
  });

  it('defaults an agent invoice with no mode to payable rather than guessing receivable', () => {
    expect(resolveInvoiceMeta({ InvoiceNumber: 'SNS-AI-7/25' }).payType).toBe('Payble');
  });

  it('returns empty meta for a number it does not recognise', () => {
    expect(resolveInvoiceMeta({ InvoiceNumber: 'SNS-XX-1/25' }))
      .toEqual({ type: '', payType: '', operation: '' });
  });

  it('does not throw on a missing invoice number', () => {
    expect(resolveInvoiceMeta({}).operation).toBe('');
  });
});

describe('partyDetailLine', () => {
  const line = (parentName, id) => ({
    COAAccountId: id,
    GL_COA: { Id: id, GL_COA: { AccountName: parentName } },
  });

  it('takes line 0 when it sits under a control category', () => {
    // The party's own subledger account lives under ACCOUNTS PAYABLE /
    // RECEIVABLE, so when line 0 is that account it IS the party line.
    const details = [line('ACCOUNTS PAYABLE', 500), line('BANK', 900)];
    expect(partyDetailLine(details).COAAccountId).toBe(500);
  });

  it('takes line 1 when line 0 is not under a control category', () => {
    // This is the case the ledger import used to get wrong: it always took
    // line 0, putting the bank account in party_Id.
    const details = [line('BANK', 900), line('ACCOUNTS RECEIVABLE', 501)];
    expect(partyDetailLine(details).COAAccountId).toBe(501);
  });

  it('recognises every control parent including the legacy misspelling', () => {
    for (const parent of ['ACCOUNTS PAYABLE', 'TRADE RECEIVABLE', 'CURRENT ASSETS',
                          'CURRENT LIABILITIES', 'CURRENT LAIBILITY']) {
      expect(partyDetailLine([line(parent, 1), line('BANK', 2)]).COAAccountId).toBe(1);
    }
  });

  it('falls back to line 0 when there is no second line', () => {
    expect(partyDetailLine([line('BANK', 900)]).COAAccountId).toBe(900);
  });

  it('returns null for no lines rather than throwing', () => {
    expect(partyDetailLine([])).toBeNull();
    expect(partyDetailLine()).toBeNull();
  });
});

describe('accountIdForLine', () => {
  it('reads COAAccountId when present', () => {
    expect(accountIdForLine({ COAAccountId: 742 })).toBe(742);
  });

  it('falls back to the nested COA id', () => {
    expect(accountIdForLine({ GL_COA: { Id: 742 } })).toBe(742);
  });

  it('prefers COAAccountId over the nested id', () => {
    expect(accountIdForLine({ COAAccountId: 1, GL_COA: { Id: 2 } })).toBe(1);
  });

  it('returns null when neither is present', () => {
    expect(accountIdForLine({})).toBeNull();
    expect(accountIdForLine()).toBeNull();
    expect(accountIdForLine(null)).toBeNull();
  });

  it('keeps a zero id rather than treating it as absent', () => {
    expect(accountIdForLine({ COAAccountId: 0 })).toBe(0);
  });
});

/**
 * A chart of accounts that names its control accounts differently.
 *
 * Every rule in this file that reads a PARENT ACCOUNT NAME is a rule about how
 * one customer happens to word their chart. CargoLinkers files parties under
 * SUNDRY DEBTORS and SUNDRY CREDITORS, and on that book the name-based rules
 * silently produced a blank party on 54,954 of 54,963 vouchers and typed every
 * vendor as a client.
 */
describe('a chart that words its control accounts differently', () => {
  const line = (sub, parentName) => ({
    COAAccountId: 1,
    GL_COA: {
      AccountName: 'A PARTY',
      GL_COASubCategory: { SubCategory: sub },
      GL_COA: { AccountName: parentName },
    },
  });

  it('finds the party line by sub-category, wherever it sits', () => {
    // Party FIRST, which is the shape of 54,954 CargoLinkers vouchers.
    const bank = line('Bank', 'CURRENT ASSETS');
    const party = line('Customer', 'SUNDRY DEBTORS');
    expect(partyDetailLine([party, bank])).toBe(party);
    // And still finds it when it is second.
    expect(partyDetailLine([bank, party])).toBe(party);
  });

  it('reads the payable side from the sub-category, not the parent name', () => {
    // SUNDRY CREDITORS matches no control word, so the old rule called every
    // one of these a client.
    expect(isPayableAccount(line('Vendor', 'SUNDRY CREDITORS'))).toBe(true);
    expect(isPayableAccount(line('Customer', 'SUNDRY DEBTORS'))).toBe(false);
  });

  it('falls back to the parent name when the sub-category cannot say', () => {
    // 'Customer/Vendor' exists on a handful of real accounts and says nothing.
    expect(isPayableAccount(line('Customer/Vendor', 'SUNDRY CREDITORS'))).toBe(true);
    expect(isPayableAccount(line('Customer/Vendor', 'SUNDRY DEBTORS'))).toBe(false);
    // The legacy misspelling still counts.
    expect(isPayableAccount(line('', 'LAIBILITY'))).toBe(true);
  });

  it('still uses position when a chart categorises nothing', () => {
    const a = line('', 'SOMETHING ELSE');
    const b = line('', 'SOMETHING ELSE');
    expect(partyDetailLine([a, b])).toBe(b);
    expect(partyDetailLine([line('', 'ACCOUNT RECEIVABLE'), b])).not.toBe(b);
  });
});
