const { planVendorTaxInvoiceNumbers } = require('../../functions/vendorTaxInvoiceMigrationPlan');

/* Legacy GL_JobBill.VendorTaxInvoiceNo onto the migrated vendor bills -
 * functions/vendorTaxInvoiceMigrationPlan. */
describe('vendor tax invoice numbers from the legacy bills', () => {
  const bill = (id, invoice_No, vendorTaxInvoiceNo = null) => ({ id, invoice_No, vendorTaxInvoiceNo });
  const ctx = (entries) => ({ billsByLegacyId: new Map(entries) });

  test('puts the number on the bill its legacy id names', () => {
    const plan = planVendorTaxInvoiceNumbers(
      [{ Id: 57346, TranNumber: 'JB-8011/27', VendorTaxInvoiceNo: ' QITE0003124223 ' }],
      ctx([['57346', [bill(80664, 'JB-8011/27')]]]),
    );
    expect(plan.toUpdate).toEqual([{ id: 80664, vendorTaxInvoiceNo: 'QITE0003124223' }]);
  });

  test("never replaces a number typed in Odyssey; a re-run changes nothing", () => {
    const plan = planVendorTaxInvoiceNumbers(
      [
        { Id: 1, TranNumber: 'JB-1/27', VendorTaxInvoiceNo: 'IN-1' },
        { Id: 2, TranNumber: 'JB-2/27', VendorTaxInvoiceNo: 'IN-2' },
      ],
      ctx([['1', [bill(11, 'JB-1/27', 'IN-1')]], ['2', [bill(12, 'JB-2/27', 'TYPED-BY-HAND')]]]),
    );
    expect(plan.toUpdate).toEqual([]);
    expect(plan.problems.alreadySet).toBe(1);
    expect(plan.problems.different).toEqual(['JB-2/27: TYPED-BY-HAND (legacy IN-2)']);
  });

  test('reports what it cannot place, rather than guessing', () => {
    const plan = planVendorTaxInvoiceNumbers(
      [
        { Id: 3, TranNumber: 'JB-3/27', VendorTaxInvoiceNo: 'IN-3' },
        { Id: 4, TranNumber: 'JB-4/27', VendorTaxInvoiceNo: 'IN-4' },
        { Id: 5, TranNumber: 'JB-5/27', VendorTaxInvoiceNo: 'IN-5' },
        { Id: 6, TranNumber: 'JB-6/27', VendorTaxInvoiceNo: '  ' },
      ],
      ctx([
        ['4', [bill(14, 'JB-4/27'), bill(15, 'JB-4/27')]],
        ['5', [bill(16, 'JB-99/27')]],
      ]),
    );
    expect(plan.toUpdate).toEqual([]);
    expect(plan.problems.billNotFound).toEqual(['JB-3/27']);
    expect(plan.problems.ambiguous).toEqual(['JB-4/27']);
    expect(plan.problems.wrongBill).toEqual(['JB-5/27 (Odyssey JB-99/27)']);
    expect(plan.problems.noNumber).toBe(1);
  });
});
