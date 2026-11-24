/**
 * The normal invoice print for a CUSTOMS CLEARANCE invoice -
 * Components/Shared/InvoicePrint with CustomsInvoiceHeader. Pins the layout
 * the user specified, and that a freight invoice still prints the freight
 * boxes.
 */
import React from 'react';
import { render, screen, within, cleanup } from '@testing-library/react';
import InvoicePrint from '../Components/Shared/InvoicePrint';
import SaleTaxInvoicePrint from '../Components/Shared/SaleTaxInvoicePrint';
// The real one, not a stand-in - a stand-in that summed local_amount is what
// let the customs totals print as 2.00 and 1,727 without a test noticing.
import { calculateTotal } from '../Components/Shared/invoicePrintDefaults';

jest.mock('functions/companyBranding', () => ({
  getCompany: () => null,
  // The real one: it only lays out the account's own fields.
  bankAccountFields: jest.requireActual('functions/companyBranding').bankAccountFields,
}));

const records = [
  { type: 'Recievable', CustomsJobId: 7, partyType: 'client', particular: 'OTHER CHARGES', description: 'PLOT RENT',
    qty: 1, rate_charge: 17800, currency: 'PKR', amount: 17800, discount: 0, tax_amount: 0, local_amount: 17800, ex_rate: 1, pp_cc: 'PP' },
];

const customsInvoice = {
  invoice_No: 'JI-2377/27', type: 'Job Invoice', payType: 'Recievable', operation: 'CC',
  createdAt: '2026-09-24T10:00:00Z', ex_rate: '1', roundOff: '0', recieved: '5000', paid: '0',
  party_Name: 'ALI MURTAZA ASSOCIATES (PVT) LTD',
  Sales_Tax_Invoice: { taxInvoiceNo: 'CL-24296' },
  recipient: { name: 'ALI MURTAZA ASSOCIATES (PVT) LTD', address1: 'PLOT 5, KARACHI', ntn: '0709571-6' },
  customsJob: {
    jobNo: 'TP-1726/27', jobDate: '2026-09-20', jobType: 'Clearing', jobRef: 'SR-1726',
    gdNumber: '50712', formENo: 'FE-9921', mblNo: 'MBL-4410', terminal: 'QICT',
    invoiceNo: 'AMA-18792-26', packages: 2157, pkgUnit: 'CARTONS', goodsDescription: 'GARMENTS',
    transportMode: 'Sea', pol: 'PKKHI', pod: 'USNYC',
  },
};

const printed = (invoice, props = {}) => render(
  <InvoicePrint invoice={invoice} records={records} company={{ title: 'CARGO LINKERS.' }}
    calculateTotal={calculateTotal} {...props} />,
);
// The react-bootstrap Row a label sits in, and the one around that.
const rowOf = (text) => screen.getByText(text).closest('.row');
const outerRowOf = (text) => rowOf(text).parentElement.closest('.row');
const headings = () => [...document.querySelectorAll('thead td')].map((td) => td.textContent.trim());

describe('the GST Invoice #', () => {
  test('is the same number the Sale Tax Invoice prints', () => {
    // Both read invoice.Sales_Tax_Invoice - one record, so one number.
    const { unmount } = printed(customsInvoice);
    expect(within(rowOf('Client Invoice #')).getByText('CL-24296')).toBeTruthy();
    unmount();
    render(<SaleTaxInvoicePrint invoice={customsInvoice} records={records} company={{ title: 'CARGO LINKERS.' }} />);
    expect(screen.getByText('CL-24296')).toBeTruthy();
  });

  test('is blank on an invoice with no Sale Tax Invoice', () => {
    printed({ ...customsInvoice, Sales_Tax_Invoice: null });
    const box = within(rowOf('Client Invoice #'));
    expect(box.getByText('GST Invoice #')).toBeTruthy();
    expect(box.queryByText('CL-24296')).toBeNull();
  });
});

describe('the customs clearance invoice', () => {
  beforeEach(() => printed(customsInvoice));

  test('M/S - the invoiced party in full - and no Shipper', () => {
    expect(screen.getByText('M/S')).toBeTruthy();
    expect(screen.queryByText(/INVOICE TO/)).toBeNull();
    expect(screen.queryByText(/SHIPPER|Shipper/)).toBeNull();
    expect(screen.getByText('ALI MURTAZA ASSOCIATES (PVT) LTD')).toBeTruthy();
    expect(screen.getByText('PLOT 5, KARACHI')).toBeTruthy();
    expect(screen.getByText('NTN # 0709571-6')).toBeTruthy();
  });

  test('"Job Invoice" one size up', () => {
    expect(screen.getByText('Job Invoice').closest('div').className).toContain('fs-16');
  });

  test('GD #, Form-E / MBL, Job Type and S/R Page # on the one line, in that order', () => {
    const line = within(rowOf('GD #:'));
    expect(line.getByText('50712')).toBeTruthy();
    expect(line.getByText('FE-9921 / MBL-4410')).toBeTruthy();
    expect(line.getByText('Clearing')).toBeTruthy();
    expect(line.getByText('SR-1726')).toBeTruthy();
    const labels = [...rowOf('GD #:').children].map((col) => col.firstChild.textContent);
    expect(labels).toEqual(['GD #:', 'Form-E / MBL:', 'Job Type:', 'S/R Page #:']);
  });

  test('GD # as wide as its number, Form-E / MBL the rest of the left half', () => {
    const [gd, formE, jobType, srPage] = rowOf('GD #:').children;
    expect(gd.className).toContain('col-md-auto');
    expect(formE.className.split(' ')).toContain('col-md'); // takes what is left
    expect(jobType.className).toContain('col-md-3');
    expect(srPage.className).toContain('col-md-3');
  });

  test('the charges table the size of the job boxes above it', () => {
    expect(rowOf('GD #:').querySelector('span').style.fontSize).toBe('11px');
    const rows = [...document.querySelectorAll('thead tr, tbody tr')];
    expect(rows).toHaveLength(3); // headings, the line, Total
    for (const tr of rows) expect(tr.style.fontSize).toBe('11px');
  });

  test('Terminal / Yard on the line below, with packages and description', () => {
    const line = within(rowOf('Terminal / Yard'));
    expect(line.getByText('QICT')).toBeTruthy();
    expect(line.getByText('No. of Packages')).toBeTruthy();
    expect(line.getByText('GARMENTS')).toBeTruthy();
  });

  test('Client Invoice #, with the GST Invoice # beside it', () => {
    expect(screen.queryByText(/Comm\. Invoice/)).toBeNull();
    const box = within(rowOf('Client Invoice #'));
    expect(box.getByText('AMA-18792-26')).toBeTruthy();
    expect(box.getByText('GST Invoice #')).toBeTruthy();
    expect(box.getByText('CL-24296')).toBeTruthy();
    expect(box.queryByText('Terminal / Yard')).toBeNull();
    expect(within(outerRowOf('Client Invoice #')).getByText('TP-1726/27')).toBeTruthy(); // beside Job No
  });

  test('no ports, currency or exchange rate - packages and description where the ports were', () => {
    expect(screen.queryByText(/Port of|Airport of/)).toBeNull();
    expect(screen.queryByText(/^Currency$|Exchange Rate/)).toBeNull();
    const row = within(outerRowOf('No. of Packages'));
    expect(row.getByText('2157 CARTONS')).toBeTruthy();
    expect(row.getByText('GARMENTS')).toBeTruthy();
    expect(row.getByText('Invoice Date')).toBeTruthy(); // the row the ports were on
    // Each on one line - the label used to wrap to "No. of / Packages".
    expect(screen.getByText('No. of Packages').style.whiteSpace).toBe('nowrap');
  });

  test('the charges: left aligned, a Description/Remarks column, no Curr, Amount or Dis', () => {
    expect(headings()).toEqual(['Sr.', 'Charges', 'Description/Remarks', 'Qty', 'Rate', 'Tax', 'Total Amount']);
    const charge = screen.getByText('OTHER CHARGES');
    expect(charge.style.textAlign).toBe('left');
    expect(within(charge.closest('tr')).getByText('PLOT RENT').style.textAlign).toBe('left');
  });

  test('the figure columns keep a minimum width, and their figures one line', () => {
    const widthOf = (h) => [...document.querySelectorAll('thead td')].find((td) => td.textContent === h).style.width;
    expect(['Qty', 'Rate', 'Tax', 'Total Amount'].map(widthOf)).toEqual(['50px', '80px', '70px', '95px']);
    const cells = [...screen.getByText('OTHER CHARGES').closest('tr').children];
    for (const td of cells.slice(-4)) expect(td.style.whiteSpace).toBe('nowrap');
  });

  test('no rule between Client Invoice # and No. of Packages, or Job No and Invoice No', () => {
    for (const label of ['Client Invoice #', 'Job No']) {
      expect(rowOf(label).parentElement.style.borderBottom).toBe('');
    }
    expect(rowOf('No. of Packages').parentElement.style.borderBottom).not.toBe('');
  });

  test('the charges headings shaded very light grey - on each cell, so it shows and prints', () => {
    for (const td of document.querySelectorAll('thead td')) {
      expect(td.style.backgroundColor).toBe('rgb(240, 240, 240)');
    }
  });

  test('Note and In-Words underlined', () => {
    expect(screen.getByText('Note').style.textDecoration).toBe('underline');
    expect(screen.getByText('In-Words').style.textDecoration).toBe('underline');
  });

  test('nothing under the charges table - no Advance Amount, Round Off or Total Discount', () => {
    // The fixture has 5,000 received: it must not surface anywhere.
    expect(screen.queryByText(/Advance Amount|Round Off|Net Payable|Total Discount/)).toBeNull();
    expect(screen.queryByText('5,000.00')).toBeNull();
  });
});

/* THE TAXED LINES GO BELOW THE OTHERS, as on the legacy invoice JI-2363/27:
 * expenses, Total Expenses, a Service Charges band, the taxed lines at their
 * value before tax, then Total For Sales Tax, Sales Tax @ 15 % and Total
 * Invoice. Run with the lines as the migration stores them (amount = the
 * money, partyType 'client', the taxed one at 2,500 with the 375 held apart)
 * and as the charges screen saves them, which is how CL-JI-1/27 came out
 * wrong: amount '1', partyType 'Client', the taxed one at 2,875. The two must
 * print the same. */
describe.each([
  ['migrated', (amount) => ({ amount, partyType: 'client' }), { local_amount: 2500, net_amount: 2500, taxPerc: 0 }],
  ['entered here', () => ({ amount: '1', partyType: 'Client' }), { local_amount: 2875, net_amount: 2875, taxPerc: 15 }],
])('a customs invoice with a taxed line (%s)', (_, stored, taxedStored) => {
  const line = (particular, value, extra = {}) => ({
    type: 'Recievable', CustomsJobId: 7, particular, qty: 1, rate_charge: value,
    discount: 0, currency: 'PKR', net_amount: value, local_amount: value, ex_rate: 1,
    tax_apply: false, tax_amount: 0, pp_cc: 'PP', ...stored(value), ...extra,
  });
  const taxedRecords = [
    line('PSID CHARGES', 1500),
    line('SERVICES CHARGES', 2500, { tax_apply: true, tax_amount: 375, ...taxedStored }),
    line('WHARFAGE EXP', 45030),
  ];
  const trOf = (text) => screen.getByText(text).closest('tr');
  const rowTexts = () => [...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent);

  beforeEach(() => render(
    <InvoicePrint invoice={customsInvoice} records={taxedRecords} company={{ title: 'CARGO LINKERS.' }}
      calculateTotal={calculateTotal} />,
  ));

  test('the untaxed lines first, then the taxed ones under Service Charges', () => {
    const rows = rowTexts();
    const at = (s) => rows.findIndex((t) => t.includes(s));
    expect(at('PSID CHARGES')).toBeLessThan(at('Total Expenses'));
    expect(at('WHARFAGE EXP')).toBeLessThan(at('Total Expenses'));
    expect(at('Total Expenses')).toBeLessThan(at('Service Charges'));
    expect(at('Service Charges')).toBeLessThan(at('SERVICES CHARGES'));
    expect(at('SERVICES CHARGES')).toBeLessThan(at('Total For Sales Tax'));
    // Numbered from 1 again, as the legacy form does.
    expect(trOf('SERVICES CHARGES').firstChild.textContent).toBe('1');
    // The band and the totals the same size as the lines.
    for (const tr of document.querySelectorAll('tbody tr')) expect(tr.style.fontSize).toBe('11px');
  });

  test('the taxed line\'s Total Amount includes its tax', () => {
    const cells = [...trOf('SERVICES CHARGES').children].map((td) => td.textContent.trim());
    expect(cells.slice(-2)).toEqual(['375.00', '2,875.00']); // Tax, Total Amount
  });

  test('Total Expenses, Total For Sales Tax, Sales Tax @ 15 %, then the total without tax and with it', () => {
    expect(trOf('Total Expenses :').textContent).toContain('46,530.00');
    expect(trOf('Total For Sales Tax :').textContent).toContain('2,500.00');
    expect(trOf('Sales Tax @ 15 % :').textContent).toContain('375.00');
    expect(trOf('Total Without Tax :').textContent).toContain('49,030.00');
    expect(trOf('Total With Tax :').textContent).toContain('49,405.00');
    // The summary rows span every column but the last, so the figures sit
    // under Total Amount.
    expect(trOf('Total With Tax :').firstChild.colSpan).toBe(headings().length - 1);
  });

  test('each total is printed once', () => {
    // It was three times: Total Invoice, Invoice Total (PKR), Total Amount.
    expect(screen.getAllByText('49,405.00')).toHaveLength(1);
    expect(screen.getAllByText('375.00')).toHaveLength(2); // the line's Tax, and Sales Tax @ 15 %
    expect(screen.queryByText(/Invoice Total|Balance Invoice|Total Invoice|Tax Amount|Net Payable/)).toBeNull();
  });

  /* HIDE TAX COLUMN - Printing Options, ticked by default from Configuration
   * > Invoices. No Tax column, the service charge at its value before tax, and
   * no Total For Sales Tax: Sales Tax @ 15 %, Total Without Tax, Total With
   * Tax under the lines. */
  describe('with Hide Tax Column', () => {
    beforeEach(() => {
      cleanup();
      render(
        <InvoicePrint invoice={customsInvoice} records={taxedRecords} company={{ title: 'CARGO LINKERS.' }}
          calculateTotal={calculateTotal} hideTax />,
      );
    });

    test('no Tax column', () => {
      expect(headings()).toEqual(['Sr.', 'Charges', 'Description/Remarks', 'Qty', 'Rate', 'Total Amount']);
      expect(trOf('PSID CHARGES').children).toHaveLength(6);
    });

    test('the service charge without its tax', () => {
      const cells = [...trOf('SERVICES CHARGES').children].map((td) => td.textContent.trim());
      expect(cells.slice(-2)).toEqual(['2,500.00', '2,500.00']); // Rate, Total Amount
    });

    test('no Total For Sales Tax: Sales Tax @ 15 %, then the total without tax and with it', () => {
      expect(screen.queryByText(/Total For Sales Tax/)).toBeNull();
      const rows = rowTexts();
      const at = (s) => rows.findIndex((t) => t.includes(s));
      expect(at('SERVICES CHARGES')).toBeLessThan(at('Sales Tax @ 15 %'));
      expect(at('Sales Tax @ 15 %')).toBe(at('SERVICES CHARGES') + 1);
      expect(at('Total Without Tax')).toBe(at('Sales Tax @ 15 %') + 1);
      expect(at('Total With Tax')).toBe(at('Total Without Tax') + 1);
      expect(trOf('Sales Tax @ 15 % :').textContent).toContain('375.00');
      expect(trOf('Total Without Tax :').textContent).toContain('49,030.00');
      expect(trOf('Total With Tax :').textContent).toContain('49,405.00');
      // Under Total Amount still.
      expect(trOf('Total With Tax :').firstChild.colSpan).toBe(5);
      // The tax is stated once.
      expect(screen.getAllByText('375.00')).toHaveLength(1);
    });
  });
});

test('Hide Tax Column on a customs invoice with no taxed line: no Tax column, one Total', () => {
  printed(customsInvoice, { hideTax: true });
  expect(headings()).not.toContain('Tax');
  expect(screen.getByText('Total :').closest('tr').textContent).toContain('17,800.00');
  expect(screen.getByText('Total :').closest('tr').firstChild.colSpan).toBe(5);
});

test('Hide Tax Column leaves a freight invoice as it is', () => {
  printed({
    invoice_No: 'SNS-AEJI-1/27', type: 'Job Invoice', payType: 'Recievable', operation: 'AE', ex_rate: '1', roundOff: '0',
    party_Name: 'FREIGHT CLIENT', SE_Job: { jobNo: 'SNS-AE-1/27' },
  }, { hideTax: true });
  expect(headings()).toContain('Tax');
});

test('a customs invoice with no taxed line has one Total, not a without and a with', () => {
  printed(customsInvoice);
  expect(screen.queryByText('Service Charges')).toBeNull();
  expect(screen.queryByText(/Without Tax|With Tax/)).toBeNull();
  expect(screen.getByText('Total :').closest('tr').textContent).toContain('17,800.00');
  expect(screen.getAllByText('17,800.00')).toHaveLength(3); // Rate, the line's Total Amount, Total
});

test('"Hide Ref" leaves S/R Page # off the line and keeps the rest', () => {
  printed(customsInvoice, { reference: true });
  expect(screen.queryByText('S/R Page #:')).toBeNull();
  expect(screen.getByText('GD #:')).toBeTruthy();
  // Its quarter stays, empty, so Job Type keeps its place.
  const cols = [...rowOf('GD #:').children];
  expect(cols).toHaveLength(4);
  expect(cols[2].textContent).toContain('Job Type:');
  expect(cols[3].className).toContain('col-md-3');
  expect(cols[3].textContent).toBe('');
});

test('a freight invoice still prints the freight boxes', () => {
  printed({
    invoice_No: 'SNS-AEJI-1/27', type: 'Job Invoice', payType: 'Recievable', operation: 'AE', ex_rate: '1', roundOff: '0',
    party_Name: 'FREIGHT CLIENT', SE_Job: { jobNo: 'SNS-AE-1/27', Bl: { mbl: '176-12345678', hbl: 'H1' } },
  });
  expect(screen.getByText('INVOICE TO')).toBeTruthy();
  expect(screen.getByText('Shipper/Consignee')).toBeTruthy();
  expect(screen.getByText('MAWB No.')).toBeTruthy();
  expect(screen.getByText('SNS-AE-1/27')).toBeTruthy();
  expect(screen.getByText('Total Discount')).toBeTruthy();
  expect(headings()).toContain('Curr');
  expect(screen.getByText('Job Invoice').closest('div').className).toContain('fs-15');
  // Its charges table as it was.
  expect(document.querySelector('thead tr').style.fontSize).toBe('9px');
});

describe('Shipper in M/S', () => {
  const withShipper = {
    ...customsInvoice,
    customsJob: { ...customsInvoice.customsJob, shipper: { name: 'GUANGZHOU TEXTILE CO', address1: 'GUANGZHOU, CHINA' } },
  };

  test('M/S is the invoiced party unless the option is ticked', () => {
    printed(withShipper);
    expect(screen.getAllByText('ALI MURTAZA ASSOCIATES (PVT) LTD').length).toBeGreaterThan(0);
    expect(screen.queryByText('GUANGZHOU TEXTILE CO')).toBeNull();
  });

  test('ticked, M/S is the job\'s shipper with its address', () => {
    printed(withShipper, { shipperInMs: true });
    expect(screen.getByText('GUANGZHOU TEXTILE CO')).toBeTruthy();
    expect(screen.getByText('GUANGZHOU, CHINA')).toBeTruthy();
    expect(screen.queryByText('PLOT 5, KARACHI')).toBeNull();
  });

  test('ticked on a job with no shipper, M/S stays the invoiced party', () => {
    printed(customsInvoice, { shipperInMs: true });
    expect(screen.getByText('PLOT 5, KARACHI')).toBeTruthy();
  });
});

describe('Bank Details', () => {
  /* Printed as one block of text at lineHeight 0.7, every line overprinted
   * the next. Each field is its own row now. */
  test('prints each field of the account on its own row', () => {
    printed(customsInvoice, {
      bankAccount: {
        bankName: 'BANK AL HABIB LIMITED', branch: 'TARIQ ROAD 1054, KARACHI',
        accountTitle: 'SEA NET SHIPPING & LOGISTICS', accountNo: '1054-0081-002182-01-5',
        iban: 'PK08 BAHL 1054 0081 0021 8201',
      },
    });
    const rows = [...document.querySelectorAll('tr')].map((tr) => tr.textContent);
    expect(rows).toEqual(expect.arrayContaining([
      'Bank Name: BANK AL HABIB LIMITED',
      'Bank Branch: TARIQ ROAD 1054, KARACHI',
      'A/c Title: SEA NET SHIPPING & LOGISTICS',
      'A/c #: 1054-0081-002182-01-5',
      'IBAN: PK08 BAHL 1054 0081 0021 8201',
    ]));
  });

  test('prints no rows for an invoice with no bank account', () => {
    printed(customsInvoice, { bankAccount: null });
    expect(screen.getByText('Bank Details')).toBeTruthy();
    expect([...document.querySelectorAll('tr')].some((tr) => /Bank Name/.test(tr.textContent))).toBe(false);
  });
});

/* Printing Options' Hide Printed On / By (the user, 2026-11-02): the line at
 * the foot of the page, on freight and customs invoices and on the Sales Tax
 * Invoice alike. */
describe('Hide Printed On / By', () => {
  const freightInvoice = { ...customsInvoice, operation: 'SE', customsJob: null, SE_Job: { jobNo: 'SNS-SE-1/27' } };
  const line = () => [...document.querySelectorAll('div, span')].filter((el) => /^Printed (On|By)/.test(el.textContent.trim()));

  test.each([['customs', customsInvoice], ['freight', freightInvoice]])('a %s invoice prints the line unless it is ticked', (_, invoice) => {
    const { unmount } = printed(invoice);
    expect(line().length).toBeGreaterThan(0);
    unmount();
    printed(invoice, { hidePrintedBy: true });
    expect(line()).toHaveLength(0);
  });

  test('the Sales Tax Invoice leaves it off too, and keeps its page number', () => {
    render(<SaleTaxInvoicePrint invoice={customsInvoice} records={records} company={{ title: 'CARGO LINKERS.' }} hidePrintedBy />);
    expect(screen.queryByText(/Printed On/)).toBeNull();
    expect(screen.queryByText(/Printed By/)).toBeNull();
    expect(screen.getByText('Page 1')).toBeTruthy();
  });
});
