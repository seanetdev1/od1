/**
 * The invoice as an Excel sheet - functions/invoiceExcel.
 *
 * Laid out as Climax's own export of a job invoice, and filled with what the
 * invoice PRINTS. The fixture is the reference file's invoice (ACS-JI-1386/26:
 * two USD lines at 279, 2,928,105 invoiced, 2,752,419 received), so the figures
 * below can be checked against that file.
 */
import ExcelJS from 'exceljs';
import {
  buildInvoiceWorkbook, invoiceFigures, invoiceExcelName, logoForExcel, COLUMN_WIDTHS,
} from '../functions/invoiceExcel';

jest.mock('functions/companyBranding', () => ({
  bankAccountFields: (acc) => (acc ? [
    ['Bank Name', acc.bankName], ['A/c Title', acc.accountTitle], ['A/c #', acc.accountNo], ['IBAN', acc.iban],
  ].filter(([, v]) => v) : []),
}));

const company = {
  title: 'AIR CARGO SERVICES (PVT) LIMITED',
  address: 'PLOT NO. A-230, BLOCK 2, P.E.C.H.S NEAR JHEEL PARK, KARACHI, PAKISTAN',
  phone: '9221 34395444-55-66', email: 'info@acs.com.pk', web: 'www.acs.com.pk', ntn: '8247922-7',
};
const bankAccount = { bankName: 'BANK AL HABIB LIMITED', accountTitle: 'AIR CARGO SERVICES (PRIVATE) LIMITED', accountNo: '1054-0981-013607-01-1', iban: 'PK84 BAHL 1054 0981 0136 0701' };

const line = (particular, rate, local) => ({
  particular, qty: '1', rate_charge: String(rate), amount: '1', currency: 'USD', discount: '0', tax_amount: '0',
  local_amount: String(local), net_amount: String(local), type: 'Recievable', partyType: 'client', ex_rate: '279',
});
const records = [line('AIR FREIGHT', 10245, 2858355), line('SERVICE CHARG', 250, 69750)];
const invoice = {
  type: 'Job Invoice', operation: 'AE', payType: 'Recievable', approved: '1',
  invoice_No: 'ACS-JI-1386/26', createdAt: '2026-04-15T00:00:00', currency: 'PKR', ex_rate: '279', roundOff: '0',
  recieved: '2752419', paid: '0', adjustment: 0, party_Name: 'AIR BLUE LTD', note: '',
  SE_Job: {
    jobNo: 'ACS-AE-1356/26', jobDate: '2026-04-15', shipDate: '2026-04-15', customerRef: 'PO-77',
    Client: { address1: 'BAY 70/71, JINNAH TERMINAL KARACHI SD 75200 PAKISTAN' },
    shipper: { name: 'AIR BLUE LTD' }, consignee: { name: 'AIR BLUE LTD' },
    sales_representator: { name: 'MANAGEMENT' },
    Bl: { mbl: 'PN-CFM56-5B', hbl: 'SN-643654' },
    air_line: { name: 'TURKISH AIR' }, flightNo: 'G9-', pol: 'IST', pod: 'IST', fd: 'ZRH',
    weight: '4800', cwtClient: '4800', pcs: 1,
  },
};

const build = (over = {}) => buildInvoiceWorkbook(ExcelJS, {
  invoice, records, company, bankAccount, logo: null, options: {}, ...over,
}).worksheets[0];

// Every master cell's value, row by row - a merged block counts once.
const cells = (ws) => {
  const out = [];
  ws.eachRow((row, r) => row.eachCell((cell) => {
    if (cell.isMerged && cell.master.address !== cell.address) return;
    const v = cell.value;
    const text = v && v.richText ? v.richText.map((t) => t.text).join('') : v;
    if (text !== null && text !== '') out.push({ r, address: cell.address, value: text, cell });
  }));
  return out;
};
const find = (ws, value) => cells(ws).find((c) => c.value === value);
// The value in the box under a label.
const under = (ws, label) => {
  const at = find(ws, label);
  return at && ws.getCell(at.r + 1, at.cell.col).value;
};
// The figure to the right of a label on the same row. The LAST such label:
// "Total Amount" heads the charges column before it labels the total.
const beside = (ws, label) => {
  const at = cells(ws).filter((c) => c.value === label).pop();
  return cells(ws).find((c) => c.r === at.r && c.cell.col > at.cell.col)?.value;
};

describe('the freight invoice, as Climax exported it', () => {
  test('is drawn on the reference file\'s 35 columns, A4 portrait', () => {
    const ws = build();
    expect(ws.columns.map((c) => c.width)).toEqual(COLUMN_WIDTHS);
    expect(ws.pageSetup).toMatchObject({ paperSize: 9, orientation: 'portrait' });
  });

  test('no column is so narrow that Excel hides it - and its borders', () => {
    // Excel rounds a width under about 0.15 to no pixels and treats the column
    // as hidden; the right edge of every box is on R or AI.
    expect(Math.min(...COLUMN_WIDTHS)).toBeGreaterThanOrEqual(0.3);
    // The halves still divide at the start of S: A..R is half the sheet.
    const total = COLUMN_WIDTHS.reduce((s, w) => s + w, 0);
    expect(COLUMN_WIDTHS.slice(0, 18).reduce((s, w) => s + w, 0)).toBeCloseTo(total / 2, 6);
  });

  test('the title is centred on the page, between two rules of one length', () => {
    const ws = build();
    const title = find(ws, 'Job Invoice');
    const block = ws.model.merges.find((m) => m.startsWith(title.address));
    const [, startCol, endCol] = /^([A-Z]+)\d+:([A-Z]+)\d+$/.exec(block);
    const index = (letters) => ws.getColumn(letters).number;
    const width = (from, to) => COLUMN_WIDTHS.slice(from - 1, to).reduce((s, w) => s + w, 0);
    const left = width(1, index(startCol) - 1);
    const right = width(index(endCol) + 1, COLUMN_WIDTHS.length);
    expect(Math.abs(left - right)).toBeLessThan(0.01);
    expect(title.cell.alignment.horizontal).toBe('center');
  });

  test('letterhead: the company\'s name and details', () => {
    const ws = build();
    expect(ws.getCell('H1').value).toBe(company.title);
    expect(find(ws, 'NTN # 8247922-7')).toBeTruthy();
    expect(find(ws, 'Email: info@acs.com.pk   Web: www.acs.com.pk')).toBeTruthy();
  });

  test('the job boxes, labelled as the reference', () => {
    const ws = build();
    expect(under(ws, 'MAWB No.')).toBe('PN-CFM56-5B');
    expect(under(ws, 'HAWB No.')).toBe('SN-643654');
    expect(under(ws, 'Job No')).toBe('ACS-AE-1356/26');
    expect(under(ws, 'Air Line / Flight No.')).toBe('TURKISH AIR / G9-');
    expect(under(ws, 'Departure Date')).toBe('15-Apr-2026');
    expect(under(ws, 'Invoice No')).toBe('ACS-JI-1386/26');
    expect(under(ws, 'Air Line')).toBe('TURKISH AIR');
    expect(under(ws, 'Weight')).toBe(4800);
    expect(under(ws, 'Ch.Wt')).toBe(4800);
    expect(under(ws, 'Currency')).toBe('PKR');
    expect(under(ws, 'Exchange Rate')).toBe(279);
    expect(beside(ws, 'Sales Rep')).toBe('MANAGEMENT');
    expect(under(ws, 'INVOICE TO')).toBe('AIR BLUE LTD\nBAY 70/71, JINNAH TERMINAL KARACHI SD 75200 PAKISTAN');
  });

  test('the charges under a grey heading, figures as numbers', () => {
    const ws = build();
    const heading = find(ws, 'Charges');
    expect(heading.cell.fill.fgColor.argb).toBe('FFC0C0C0');
    const row = cells(ws).filter((c) => c.r === heading.r).map((c) => c.value);
    expect(row).toEqual(['S #', 'Charges', 'Qty', 'Rate', 'Curr', 'Amount', 'Dis', 'Tax', 'Total Amount']);
    const first = cells(ws).filter((c) => c.r === heading.r + 1).map((c) => c.value);
    expect(first).toEqual([1, 'AIR FREIGHT', 1, 10245, 'USD', 10245, 0, 0, 2858355]);
    expect(cells(ws).find((c) => c.value === 2858355).cell.numFmt).toBe('#,##0.00 ;(#,##0.00)');
  });

  test('the totals down the right: Received, Adjustment and Balance under Total Amount', () => {
    const ws = build();
    expect(beside(ws, 'Invoice Total (PKR)')).toBe(2928105);
    expect(beside(ws, 'Round Off')).toBe(0);
    expect(beside(ws, 'Total Amount')).toBe(2928105);
    expect(beside(ws, 'Received')).toBe(2752419);
    expect(beside(ws, 'Adjustment')).toBe(0);
    expect(beside(ws, 'Balance')).toBe(175686);
  });

  test('Hide Balance leaves the three off', () => {
    const ws = build({ options: { hideBalance: true } });
    expect(find(ws, 'Received')).toBeUndefined();
    expect(find(ws, 'Balance')).toBeUndefined();
    expect(beside(ws, 'Total Amount')).toBe(2928105);
  });

  test('Hide Ref leaves Reference No. and Sales Rep off', () => {
    const ws = build({ options: { hideRef: true } });
    expect(find(ws, 'Reference No.')).toBeUndefined();
    expect(find(ws, 'Sales Rep')).toBeUndefined();
  });

  test('In-Words and the bank account', () => {
    const ws = build();
    expect(under(ws, 'In-Words')).toBe('PKR Two Million Nine Hundred Twenty Eight Thousand One Hundred Five only');
    expect(beside(ws, 'IBAN')).toBe(': PK84 BAHL 1054 0981 0136 0701');
  });

  test('the note, unless Hide Note', () => {
    const noted = { ...invoice, note: 'Payment within 15 days' };
    expect(under(build({ invoice: noted }), 'Note:')).toBe('Payment within 15 days');
    expect(under(build({ invoice: noted, options: { hideNote: true } }), 'Note:')).toBe('');
  });

  test('an unapproved invoice says DRAFT', () => {
    const ws = build({ invoice: { ...invoice, approved: '0' } });
    expect(find(ws, 'Job Invoice  DRAFT')).toBeTruthy();
  });

  test('a sea invoice: MBL, vessel, ports, and its containers', () => {
    const sea = {
      ...invoice, operation: 'SE',
      SE_Job: {
        ...invoice.SE_Job, vessel: { name: 'MSC ANNA' }, Voyage: { voyage: '412W' }, pol: 'PKKHI', pod: 'AEJEA', vol: '33.5',
        shipping_line: { name: 'MSC' }, SE_Equipments: [{ qty: 2, size: '40HC' }],
        Bl: { mbl: 'MSCU1', hbl: 'SNS-1', Container_Infos: [{ no: 'MSCU1234567' }, { no: 'MSCU7654321' }] },
      },
    };
    const ws = build({ invoice: sea });
    expect(under(ws, 'MBL No.')).toBe('MSCU1');
    expect(under(ws, 'Vessel / Voyage')).toBe('MSC ANNA / 412W');
    expect(under(ws, 'Shipping Line')).toBe('MSC');
    expect(under(ws, 'Volume')).toBe(33.5);
    expect(under(ws, 'PCS')).toBe('2 x 40HC');
    expect(beside(ws, 'Container #')).toBe('MSCU1234567, MSCU7654321');
  });

  test('an agent invoice: in its own currency, no Invoice Total (PKR)', () => {
    const agent = { ...invoice, type: 'Agent Invoice', currency: 'USD', recieved: '0' };
    const lines = records.map((x) => ({ ...x, partyType: 'agent', net_amount: x.rate_charge }));
    const ws = build({ invoice: agent, records: lines });
    expect(find(ws, 'Invoice Total (PKR)')).toBeUndefined();
    expect(under(ws, 'Currency')).toBe('USD');
    expect(beside(ws, 'Total Amount')).toBe(10495);
    expect(cells(ws).some((c) => c.value === 10245 && c.cell.col === 32)).toBe(true);   // AF: 2,858,355 / 279
  });
});

describe('the customs invoice', () => {
  const customs = {
    ...invoice, operation: 'CC', SE_Job: undefined, roundOff: '-0.40',
    recipient: { name: 'ATLAS FOODS', address1: 'SITE, KARACHI', ntn: '1234567-8' },
    customsJob: { jobNo: 'CL-IM-77/27', jobDate: '2026-09-01', gdNumber: 'KPPI-1234', jobType: 'Import', packages: 718, pkgUnit: 'CARTONS', invoiceNo: 'CI-55' },
  };
  const lines = [{ particular: 'PLOT RENT', description: 'Sunday', qty: '1', rate_charge: '1500.40', amount: '1', local_amount: '1500.40', type: 'Recievable', partyType: 'Client', CustomsJobId: 1 }];

  test('M/S, the clearance boxes, its own columns, and no Received or Balance', () => {
    const ws = build({ invoice: customs, records: lines });
    expect(under(ws, 'M/S')).toBe('ATLAS FOODS\nSITE, KARACHI\nNTN # 1234567-8');
    expect(beside(ws, 'GD #:')).toBe('KPPI-1234');
    expect(under(ws, 'Client Invoice #')).toBe('CI-55');
    expect(under(ws, 'No. of Packages')).toBe('718 CARTONS');
    const heading = find(ws, 'Description/Remarks');
    expect(cells(ws).filter((c) => c.r === heading.r).map((c) => c.value))
      .toEqual(['Sr.', 'Charges', 'Description/Remarks', 'Qty', 'Rate', 'Tax', 'Total Amount']);
    expect(beside(ws, 'Total :')).toBe(1500.4);
    expect(beside(ws, 'Round Off :')).toBe(-0.4);
    expect(beside(ws, 'Total Amount :')).toBe(1500);
    expect(find(ws, 'Received')).toBeUndefined();
    expect(find(ws, 'MAWB No.')).toBeUndefined();
  });

  test('Job Type, then S/R Page #, as the print - Hide Ref leaves S/R Page # off and keeps Job Type', () => {
    const withRef = { ...customs, customsJob: { ...customs.customsJob, jobRef: 'SR-1726' } };
    const ws = build({ invoice: withRef, records: lines });
    const row = find(ws, 'Job Type:').r;
    expect(cells(ws).filter((c) => c.r === row).map((c) => c.value)).toEqual(['Job Type:', 'Import', 'S/R Page #:', 'SR-1726']);
    const hidden = build({ invoice: withRef, records: lines, options: { hideRef: true } });
    expect(find(hidden, 'S/R Page #:')).toBeUndefined();
    expect(beside(hidden, 'Job Type:')).toBe('Import');
  });

  test('a taxed one: expenses, then Service Charges and the sales tax, as the print', () => {
    const taxed = [
      ...lines,
      { particular: 'WHARFAGE', description: 'KPT', qty: '1', rate_charge: '22000', amount: '1', local_amount: '22000', type: 'Recievable', partyType: 'Client', CustomsJobId: 1 },
      { particular: 'AGENCY CHARGES', description: '', qty: '1', rate_charge: '10000', amount: '1', local_amount: '11500', type: 'Recievable', partyType: 'Client', CustomsJobId: 1, tax_apply: true, taxPerc: '15', tax_amount: '1500' },
    ];
    const ws = build({ invoice: { ...customs, roundOff: '0' }, records: taxed });
    expect(beside(ws, 'Total Expenses :')).toBe(23500.4);
    expect(find(ws, 'Service Charges')).toBeTruthy();
    expect(beside(ws, 'Total For Sales Tax :')).toBe(10000);
    expect(beside(ws, 'Sales Tax @ 15 % :')).toBe(1500);
    expect(beside(ws, 'Total Without Tax :')).toBe(33500.4);
    expect(beside(ws, 'Total With Tax :')).toBe(35000.4);
    const agency = cells(ws).find((c) => c.value === 'AGENCY CHARGES');
    expect(cells(ws).filter((c) => c.r === agency.r).map((c) => c.value)).toEqual([1, 'AGENCY CHARGES', 1, 10000, 1500, 11500]);
  });

  test('Hide Tax Column, as the print: no Tax column, the service charge before tax, no Total For Sales Tax', () => {
    const taxed = [
      ...lines,
      { particular: 'AGENCY CHARGES', description: '', qty: '1', rate_charge: '10000', amount: '1', local_amount: '11500', type: 'Recievable', partyType: 'Client', CustomsJobId: 1, tax_apply: true, taxPerc: '15', tax_amount: '1500' },
    ];
    const ws = build({ invoice: { ...customs, roundOff: '0' }, records: taxed, options: { hideTax: true } });
    expect(find(ws, 'Tax')).toBeUndefined();
    expect(find(ws, 'Total For Sales Tax :')).toBeUndefined();
    const agency = cells(ws).find((c) => c.value === 'AGENCY CHARGES');
    expect(cells(ws).filter((c) => c.r === agency.r).map((c) => c.value)).toEqual([1, 'AGENCY CHARGES', 1, 10000, 10000]);
    // The totals under Total Amount, as without the option.
    const labels = cells(ws).filter((c) => /^(Sales Tax @|Total Without|Total With)/.test(c.value));
    expect(labels.map((c) => c.value)).toEqual(['Sales Tax @ 15 % :', 'Total Without Tax :', 'Total With Tax :']);
    expect(labels.map((c) => c.r)).toEqual([agency.r + 1, agency.r + 2, agency.r + 3]);
    expect(beside(ws, 'Sales Tax @ 15 % :')).toBe(1500);
    expect(beside(ws, 'Total With Tax :')).toBeCloseTo(beside(ws, 'Total Without Tax :') + 1500);
  });

  test('a long GD number is not cut off', () => {
    const long = { ...customs, customsJob: { ...customs.customsJob, gdNumber: 'KPPI-HC-12345-01092026-EXTRA-LONG-REFERENCE' } };
    const ws = build({ invoice: long, records: lines });
    const gd = find(ws, 'GD #:');
    expect(beside(ws, 'GD #:')).toBe('KPPI-HC-12345-01092026-EXTRA-LONG-REFERENCE');
    expect(ws.getRow(gd.r).height).toBeGreaterThanOrEqual(13);
  });

  test('Shipper in M/S addresses it to the job\'s shipper', () => {
    const withShipper = { ...customs, customsJob: { ...customs.customsJob, shipper: { name: 'ATLAS EXPORTS' } } };
    expect(under(build({ invoice: withShipper, records: lines, options: { shipperInMs: true } }), 'M/S')).toBe('ATLAS EXPORTS');
  });
});

describe('the file', () => {
  test('writes, with the logo when there is one', async () => {
    // A 2 x 1 PNG.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGGEMAB3iA/3D1E8pAAAAAElFTkSuQmCC';
    const logo = await logoForExcel(`data:image/png;base64,${png}`);
    expect(logo).toMatchObject({ extension: 'png', width: 2, height: 1 });
    const wb = buildInvoiceWorkbook(ExcelJS, { invoice, records, company, bankAccount, logo, options: {} });
    expect(wb.worksheets[0].getImages()).toHaveLength(1);
    const noLogo = buildInvoiceWorkbook(ExcelJS, { invoice, records, company, bankAccount, logo, options: { hideLogo: true } });
    expect(noLogo.worksheets[0].getImages()).toHaveLength(0);
    const buffer = await wb.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  test('no logo, or one that cannot be read, is no logo', async () => {
    expect(await logoForExcel(null)).toBeNull();
    expect(await logoForExcel('data:image/png;base64,')).toBeNull();
  });

  test('is named after the invoice', () => {
    expect(invoiceExcelName(invoice)).toBe('ACS-JI-1386-26.xlsx');
  });

  test('the figures are the print\'s', () => {
    expect(invoiceFigures(invoice, records)).toMatchObject({ invoiceTotal: 2928105, totalAmount: 2928105, currency: 'PKR', isCustoms: false });
  });
});
