/**
 * What the Sale Tax Invoice prints - functions/saleTaxInvoice. The reference
 * is the legacy JI-2378/27: eleven lines, 94,140, of which one SERVICES
 * CHARGES line of 2,500 carried 15% - so the Sale Tax Invoice read 2,500 +
 * 375 = 2,875.
 */
import { saleTaxFigures, isSaleTaxLine } from '../functions/saleTaxInvoice';

const customs = (over = {}) => ({ type: 'Recievable', CustomsJobId: 7, qty: 1, ex_rate: 1, tax_apply: false, ...over });

describe('the Sale Tax Invoice figures', () => {
  test('only the taxed lines: 2,500 + 15% = 2,875, whatever else is on the invoice', () => {
    const records = [
      customs({ rate_charge: 39940 }),                                      // duty reimbursement
      customs({ rate_charge: 18160 }),                                      // port charges
      customs({ rate_charge: 2500, tax_apply: true, taxPerc: 15, tax_amount: 375 }), // SERVICES CHARGES
    ];
    expect(saleTaxFigures(records)).toMatchObject({ serviceCharges: 2500, saleTax: 375, total: 2875, rate: 15, additionalTax: 0 });
  });

  test('a migrated line - tax amount, 0% rate, net stored without tax - prints the same', () => {
    const migrated = customs({ rate_charge: 2500, net_amount: 2500, tax_apply: true, taxPerc: 0, tax_amount: 375 });
    expect(saleTaxFigures([migrated])).toMatchObject({ serviceCharges: 2500, saleTax: 375, total: 2875, rate: 15 });
  });

  test('lines at different rates name no single rate', () => {
    const f = saleTaxFigures([
      customs({ rate_charge: 1000, tax_apply: true, taxPerc: 15 }),
      customs({ rate_charge: 1000, tax_apply: true, taxPerc: 13 }),
    ]);
    expect(f.rate).toBeNull();
    expect(f.saleTax).toBe(280);
  });

  test('a payable, or a ticked line whose tax came to nothing, is not on it', () => {
    expect(isSaleTaxLine(customs({ type: 'Payble', rate_charge: 1000, tax_apply: true, taxPerc: 15 }))).toBe(false);
    expect(isSaleTaxLine(customs({ rate_charge: 1000, tax_apply: true, taxPerc: 0 }))).toBe(false);
  });

  test('a freight line, whose net already includes its tax, gives its taxable value back', () => {
    const freight = { type: 'Recievable', qty: 1, ex_rate: 1, tax_apply: true, taxPerc: 15, tax_amount: 150, net_amount: 1150 };
    expect(saleTaxFigures([freight])).toMatchObject({ serviceCharges: 1000, saleTax: 150, total: 1150 });
  });
});
