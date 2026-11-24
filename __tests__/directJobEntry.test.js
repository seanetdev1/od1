/**
 * Opening a saved Direct Job E/R - functions/directJobEntry.
 *
 * CL-JER-145/27 opened with the blank-entry defaults (Revenue / Bank /
 * Cheque, today's date), no lines and "5448" in Account #: the loader threw on
 * its missing Paid To and stopped halfway.
 */
import { directJobFromSaved, lineFromSaved, lineAmount, entryDateOf } from '../functions/directJobEntry';

// A migrated entry as GET /voucher/getDirectJob returns it.
const migrated = (over = {}) => ({
  id: 812,
  Entry_No: 'CL-JER-145/27',
  Type: 'expense',
  Reference_No: 'REF-9',
  Operation: 'logistics',
  Job_Type: 'multiple',
  SubType: 'cash',
  Cheque_No: null,
  Cheque_Date: null,
  Currency: 'PKR',
  Ex_Rate: 1,
  Tran_Mode: 'Cash',
  Drawn_At: null,
  Account_No: 5448,
  Paid_To: null,
  createdAt: '2026-09-12T05:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
  Associations: [
    {
      id: 1, Job_No: 'CL-CCJ-2044/27', File_No: '56/27', Charge_Name: '41',
      Basis: 'unit', Currency: 'PKR', Rate_Group: null, Size_Type: null,
      Quantity: 2, Amount: 1000, Discount: 0, Tax_Apply: false, Tax_Amount: 0,
      VAT_Catagory: null, Ex_Rate: 1, Description: 'Two trips',
      Job_Id: null, AviationJobId: null, CustomsJobId: 77,
      Voucher: { id: 9001, voucher_Id: 'CL-CPV-00412/27', tranDate: '2026-09-11T00:00:00.000Z', voucherNarration: 'Paid for trips', costCenter: 'HEAD OFFICE' },
    },
    {
      id: 2, Job_No: 'CL-CCJ-2045/27', File_No: '57/27', Charge_Name: '42',
      Quantity: 1, Amount: 300, Discount: 0, Tax_Amount: 0, Ex_Rate: 1,
      CustomsJobId: 78,
      Voucher: { id: 9001, voucher_Id: 'CL-CPV-00412/27', tranDate: '2026-09-11T00:00:00.000Z' },
    },
  ],
  ...over,
});

describe('opening a saved entry', () => {
  it('reads everything, though it has no Paid To', () => {
    const { fields, lines } = directJobFromSaved(migrated());
    expect(fields).toMatchObject({
      directJob_EntryNumber: 'CL-JER-145/27',
      directJob_Type: 'expense',
      directJob_TransMode: 'Cash',
      directJob_SubType: 'cash',
      directJob_Reference: 'REF-9',
      directJob_JobType: 'multiple',
      directJob_PaidTo: undefined,
      directJob_Remarks: 'Paid for trips',
      directJob_CostCenter: 'HEAD OFFICE',
      directJob_VoucherNumber: 'CL-CPV-00412/27',
      directJob_VoucherId: 9001,
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ JobNumber: 'CL-CCJ-2044/27', FileNumber: '56/27', Charge: 41, JobId: 77 });
  });

  it('keeps Account # a number, as the dropdown options are', () => {
    expect(directJobFromSaved(migrated()).fields.directJob_Account).toBe(5448);
    expect(directJobFromSaved(migrated({ Paid_To: 6001 })).fields.directJob_PaidTo).toBe(6001);
  });

  it("dates the entry by its voucher, not by its last edit", () => {
    const { fields } = directJobFromSaved(migrated());
    expect(fields.directJob_EntryDate).toBe('2026-09-11T00:00:00.000Z');
    expect(entryDateOf(migrated())).toBe('2026-09-11T00:00:00.000Z');
  });

  // 2026-10-21: a cash entry has no cheque, so it shows none - it showed the
  // entry date, and saving it back stored that as the cheque's.
  it('opens a cash entry with no cheque date, even one saved with a date', () => {
    expect(directJobFromSaved(migrated()).fields.directJob_ChequeDate).toBeNull();
    const stamped = directJobFromSaved(migrated({ Cheque_Date: '2026-09-11T00:00:00.000Z' }));
    expect(stamped.fields.directJob_ChequeDate).toBeNull();
  });

  it('opens a bank entry on its cheque date, or its entry date when it has none', () => {
    const bank = (over) => directJobFromSaved(migrated({ Tran_Mode: 'Bank', ...over })).fields.directJob_ChequeDate;
    expect(bank({ Cheque_Date: '2026-09-05T00:00:00.000Z' })).toBe('2026-09-05T00:00:00.000Z');
    expect(bank({ Cheque_Date: null })).toBe('2026-09-11T00:00:00.000Z');
  });

  it('does not throw on an entry with no lines', () => {
    const { fields, lines } = directJobFromSaved(migrated({ Associations: [] }));
    expect(lines).toEqual([]);
    expect(fields.directJob_EntryDate).toBe('2026-09-12T05:00:00.000Z');
    expect(fields.directJob_VoucherNumber).toBe('');
  });
});

describe('a line amount is the line total', () => {
  it('shows a migrated 2 x 500 as 2 x 500, not 2 x 1,000', () => {
    expect(lineFromSaved(migrated().Associations[0])).toMatchObject({
      Quantity: 2, Rate: 500, Amount: 1000, NetAmount: 1000, LocalAmount: 1000,
    });
  });

  it('works the rate out before the discount', () => {
    expect(lineFromSaved({ Quantity: 4, Amount: 900, Discount: 100, Ex_Rate: 1 }))
      .toMatchObject({ Rate: 250, Amount: 1000, Discount: 100, NetAmount: 900 });
  });

  it('converts a foreign line to local', () => {
    expect(lineFromSaved({ Quantity: 1, Amount: 100, Ex_Rate: 280 }).LocalAmount).toBe(28000);
  });

  it('saves rate x quantity less discount - what the voucher posts', () => {
    expect(lineAmount({ Rate: 500, Quantity: 2, Discount: 0 })).toBe(1000);
    expect(lineAmount({ Rate: 250, Quantity: 4, Discount: 100 })).toBe(900);
  });

  it('saves back exactly what it opened', () => {
    for (const a of migrated().Associations) expect(lineAmount(lineFromSaved(a))).toBe(a.Amount);
  });
});
