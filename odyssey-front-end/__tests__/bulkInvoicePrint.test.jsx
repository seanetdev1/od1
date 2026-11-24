/**
 * Bulk invoice printing on Accounts > Invoice / Bills, and DRAFT on every
 * unapproved invoice.
 *
 *   - functions/invoicePrintList: the list kept apart from the search results
 *   - InvoiceAndBills/PrintList: prints the whole list as one job
 *   - Shared/DraftWatermark: on InvoicePrint and SaleTaxInvoicePrint
 *   - Printing Options before a bulk print, VAT Tax Invoice among them
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  addToPrintList, removeFromPrintList, inPrintList, printListEntry, fetchInChunks, saleTaxDocuments,
  bulkPrintSettings, BULK_PRINT_OPTIONS,
} from 'functions/invoicePrintList';
import { isSaleTaxLine } from 'functions/saleTaxInvoice';
import InvoicePrint from '../Components/Shared/InvoicePrint';
import SaleTaxInvoicePrint from '../Components/Shared/SaleTaxInvoicePrint';
import { calculateTotal } from '../Components/Shared/invoicePrintDefaults';
import { isDraftInvoice, draftLayerHeight } from '../Components/Shared/DraftWatermark';

const mockPrint = jest.fn();
jest.mock('react-to-print', () => ({ useReactToPrint: () => mockPrint }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/companyBranding', () => ({
  getCompany: () => null,
  companyBankAccounts: () => [],
  defaultBankAccount: () => null,
  bankAccountFields: () => [],
  companyOptions: () => [{ value: 1, label: 'SNS' }, { value: 2, label: 'ACS' }],
}));

describe('the print list', () => {
  const row = (id, extra = {}) => ({ id, invoice_No: `SNS-JI-${id}/27`, party_Name: 'MSC', currency: 'PKR', total: '100', approved: '1', ...extra });

  test('keeps what it shows, with the type it was found under', () => {
    expect(printListEntry(row(1), 'Agent Invoice')).toEqual({
      id: 1, invoice_No: 'SNS-JI-1/27', type: 'Agent Invoice', party_Name: 'MSC', currency: 'PKR', total: '100', approved: '1',
    });
  });

  test('adds in the order picked, once only, and removes', () => {
    let list = addToPrintList([], row(3), 'Job Invoice');
    list = addToPrintList(list, row(1), 'Job Invoice');
    list = addToPrintList(list, row(3), 'Job Invoice');
    expect(list.map((x) => x.id)).toEqual([3, 1]);
    expect(inPrintList(list, '1')).toBe(true);           // ids compared as strings
    expect(removeFromPrintList(list, '3').map((x) => x.id)).toEqual([1]);
  });

  test('fetches in the list\'s order, a few at a time, and names what failed', async () => {
    let inFlight = 0; let peak = 0;
    const fetchOne = async (e) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (e.id === 4) throw new Error('gone');
      return { id: e.id };
    };
    const entries = [1, 2, 3, 4, 5, 6].map((id) => ({ id }));
    const { invoices, failed } = await fetchInChunks(entries, fetchOne, 2);
    expect(invoices.map((x) => x.id)).toEqual([1, 2, 3, 5, 6]);
    expect(failed.map((x) => x.id)).toEqual([4]);
    expect(peak).toBe(2);
  });

  test('a Sales Tax print keeps the invoices with a taxed charge, in order, and names the rest', () => {
    const taxed = { type: 'Recievable', CustomsJobId: 1, qty: 1, ex_rate: 1, rate_charge: 2500, tax_apply: true, taxPerc: 15 };
    const untaxed = { ...taxed, tax_apply: false };
    const payable = { ...taxed, type: 'Payble' };   // a bill's tax is not sales tax
    const invoices = [
      { id: 1, Charge_Heads: [untaxed, taxed] },
      { id: 2, Charge_Heads: [untaxed] },
      { id: 3, Charge_Heads: [payable] },
      { id: 4 },
      { id: 5, Charge_Heads: [taxed] },
    ];
    const { printable, skipped } = saleTaxDocuments(invoices, isSaleTaxLine);
    expect(printable.map((x) => x.id)).toEqual([1, 5]);
    expect(skipped.map((x) => x.id)).toEqual([2, 3, 4]);
    expect(saleTaxDocuments(null, isSaleTaxLine)).toEqual({ printable: [], skipped: [] });
  });

  describe('one invoice under the bulk Printing Options', () => {
    const noted = { companyId: '2', note: 'Payable within 7 days' };

    test('start as the invoice page does: nothing hidden, the invoice\'s own letterhead', () => {
      expect(bulkPrintSettings(noted, BULK_PRINT_OPTIONS, '1')).toEqual({
        companyId: '2', logo: false, reference: false, note: false, shipperInMs: false, vatInvoice: false,
        hideBalance: false, hideSignLine: false, hidePrintedBy: false, hideTax: false, hideBankDetails: false,
      });
      // No company of its own: the page's.
      expect(bulkPrintSettings({ note: 'x' }, BULK_PRINT_OPTIONS, '1').companyId).toBe('1');
    });

    test('a picked letterhead is every invoice\'s', () => {
      expect(bulkPrintSettings(noted, { letterhead: '1' }, '3').companyId).toBe('1');
    });

    test('Hide Logo, Hide Ref and VAT Tax Invoice pass straight through', () => {
      const s = bulkPrintSettings(noted, { hideLogo: true, hideRef: true, vatInvoice: true }, '1');
      expect([s.logo, s.reference, s.vatInvoice]).toEqual([true, true, true]);
    });

    test('a note prints unless Hide Note; no note never prints', () => {
      expect(bulkPrintSettings(noted, {}, '1').note).toBe(false);
      expect(bulkPrintSettings(noted, { hideNote: true }, '1').note).toBe(true);
      expect(bulkPrintSettings({ note: '  ' }, {}, '1').note).toBe(true);
    });

    test('Shipper in M/S only where the customs job has a shipper', () => {
      const withShipper = { customsJob: { shipper: { name: 'ALI MURTAZA' } } };
      expect(bulkPrintSettings(withShipper, { shipperInMs: true }, '1').shipperInMs).toBe(true);
      expect(bulkPrintSettings({ customsJob: {} }, { shipperInMs: true }, '1').shipperInMs).toBe(false);
      expect(bulkPrintSettings({}, { shipperInMs: true }, '1').shipperInMs).toBe(false);
      expect(bulkPrintSettings(withShipper, {}, '1').shipperInMs).toBe(false);
    });
  });
});

describe('DRAFT on an unapproved invoice', () => {
  const invoice = {
    invoice_No: 'JI-1/27', type: 'Job Invoice', payType: 'Recievable', operation: 'SE', currency: 'PKR',
    createdAt: '2026-09-24T10:00:00Z', ex_rate: '1', roundOff: '0', recieved: '0', paid: '0', party_Name: 'MSC',
    SE_Job: { Client: {}, shipper: {}, consignee: {}, SE_Equipments: [] },
  };
  const records = [{ type: 'Recievable', partyType: 'client', particular: 'FREIGHT', qty: 1, rate_charge: 100,
    currency: 'PKR', amount: 1, discount: 0, local_amount: 100, net_amount: 100, ex_rate: 1, pp_cc: 'PP' }];
  const draftMarks = () => document.querySelectorAll('.draft-watermark').length;

  test('is decided by the approved flag alone', () => {
    expect(isDraftInvoice({ approved: '0' })).toBe(true);
    expect(isDraftInvoice({ approved: 0 })).toBe(true);
    expect(isDraftInvoice({ approved: '1' })).toBe(false);
    expect(isDraftInvoice({ approved: 1 })).toBe(false);
    expect(isDraftInvoice(null)).toBe(false);
  });

  test('marks the invoice print, and only while unapproved', () => {
    const { unmount } = render(<InvoicePrint invoice={{ ...invoice, approved: '0' }} records={records} calculateTotal={calculateTotal} />);
    expect(draftMarks()).toBe(1);
    unmount();
    render(<InvoicePrint invoice={{ ...invoice, approved: '1' }} records={records} calculateTotal={calculateTotal} />);
    expect(draftMarks()).toBe(0);
  });

  test('runs to the end of the invoice\'s last page, never onto a page of its own', () => {
    const page = (297 * 96) / 25.4;
    const slack = (4 * 96) / 25.4;
    // Content ending part-way down page 1, and part-way down page 2.
    expect(draftLayerHeight(0.6 * page)).toBeCloseTo(page - slack);
    expect(draftLayerHeight(1.45 * page)).toBeCloseTo(2 * page - slack);
    expect(draftLayerHeight(0)).toBeNull();
  });

  test('takes the measured height, so the last page carries a whole DRAFT', () => {
    const page = (297 * 96) / 25.4;
    const spy = jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(1.45 * page);
    try {
      render(<InvoicePrint invoice={{ ...invoice, approved: '0' }} records={records} calculateTotal={calculateTotal} />);
      const layer = document.querySelector('.draft-watermark');
      expect(parseFloat(layer.style.height)).toBeCloseTo(draftLayerHeight(1.45 * page));
    } finally {
      spy.mockRestore();
    }
  });

  test('marks the Sale Tax Invoice too', () => {
    render(<SaleTaxInvoicePrint invoice={{ ...invoice, approved: '0' }} records={records} company={{ title: 'X' }} />);
    expect(draftMarks()).toBe(1);
  });
});

describe('Print all', () => {
  // eslint-disable-next-line global-require
  const axiosClient = require('apis/axiosClient');
  // eslint-disable-next-line global-require
  const openNotification = require('Components/Shared/Notification');
  // eslint-disable-next-line global-require
  const PrintList = require('../Components/Layouts/AccountsComp/InvoiceAndBills/PrintList').default;

  // The server's answers. Which Word template applies (Configuration > Printing
  // Templates) by "company|document" - none unless given; everything else, `fn`.
  const mockGets = (fn, templates = {}) => axiosClient.get.mockImplementation((url, opts) => (
    String(url).endsWith('/printingTemplates/applies')
      ? Promise.resolve({ data: { status: 'success', result: templates[`${opts.params.companyId}|${opts.params.type}`] || null } })
      : fn(url, opts)
  ));

  const list = [
    { id: 7, invoice_No: 'SNS-JI-7/27', type: 'Job Invoice', party_Name: 'MSC', currency: 'PKR', total: '100', approved: '1' },
    { id: 3, invoice_No: 'SNS-JI-3/27', type: 'Job Invoice', party_Name: 'ONE', currency: 'PKR', total: '50', approved: '0' },
  ];
  const detail = (id, approved) => ({ data: { result: { resultOne: {
    id, invoice_No: `SNS-JI-${id}/27`, type: 'Job Invoice', payType: 'Recievable', operation: 'SE', currency: 'PKR',
    approved, createdAt: '2026-09-24T10:00:00Z', ex_rate: '1', roundOff: '0', recieved: '0', paid: '0',
    party_Name: 'X', companyId: '1', Charge_Heads: [],
    SE_Job: { Client: {}, shipper: {}, consignee: {}, SE_Equipments: [] },
  } } } });

  // Print all opens Printing Options; its Print starts the print.
  const printWith = (...ticks) => {
    fireEvent.click(screen.getByText('Print all (2)'));
    ticks.forEach((t) => fireEvent.click(screen.getByText(t)));
    fireEvent.click(screen.getByText('Print 2'));
  };
  const withNote = (url, { headers }) => {
    const res = detail(Number(headers.invoiceid), '1');
    res.data.result.resultOne.note = 'Payable within 7 days of the invoice date, by bank transfer only';
    return Promise.resolve(res);
  };

  beforeEach(() => {
    mockPrint.mockClear();
    openNotification.mockClear();
    axiosClient.get.mockReset();
    axiosClient.post.mockReset();
    global.URL.createObjectURL = jest.fn(() => 'blob:invoices');
    global.URL.revokeObjectURL = jest.fn();
  });

  test('Print all asks for the Printing Options first, and prints nothing until Print', () => {
    render(<PrintList list={list} setList={() => {}} companyId='1' />);
    fireEvent.click(screen.getByText('Print all (2)'));
    expect(screen.getByText('Printing Options')).toBeTruthy();
    ['Hide Ref & Sales Rep', 'Hide Logo', 'Hide Note', 'VAT Tax Invoice', 'Letterhead'].forEach((o) => expect(screen.getByText(o)).toBeTruthy());
    expect(axiosClient.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(axiosClient.get).not.toHaveBeenCalled();
    expect(mockPrint).not.toHaveBeenCalled();
  });

  test('Shipper in M/S is offered on a customs install only', () => {
    const { unmount } = render(<PrintList list={list} setList={() => {}} companyId='1' />);
    fireEvent.click(screen.getByText('Print all (2)'));
    expect(screen.queryByText('Shipper in M/S')).toBeNull();
    unmount();
    document.cookie = 'operationMode=customs';
    try {
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      fireEvent.click(screen.getByText('Print all (2)'));
      expect(screen.getByText('Shipper in M/S')).toBeTruthy();
    } finally {
      document.cookie = 'operationMode=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  });

  test('Hide Sign Line starts as Configuration says, and can be unticked', async () => {
    mockGets((url, opts) => (url === '/settings/invoicePrint'
      ? Promise.resolve({ data: { status: 'success', result: { hideSignLine: true } } })
      : Promise.resolve(detail(Number(opts.headers.invoiceid), '1'))));
    render(<PrintList list={list} setList={() => {}} companyId='1' />);
    fireEvent.click(screen.getByText('Print all (2)'));
    await waitFor(() => expect(screen.getByText('Hide Sign Line').closest('label').querySelector('input').checked).toBe(true));
    fireEvent.click(screen.getByText('Print 2'));
    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('.invoice-print-root')).toHaveLength(2);
    expect(document.querySelector('.invoice-sign-line')).toBeNull();

    printWith('Hide Sign Line');   // unticked for this print
    await waitFor(() => expect(document.querySelectorAll('.invoice-sign-line')).toHaveLength(2));
  });

  test('Hide Tax Column: offered on a customs install, ticked as Configuration says', async () => {
    const taxed = { type: 'Recievable', CustomsJobId: 1, qty: 1, ex_rate: 1, rate_charge: 2500, amount: '1', tax_apply: true, taxPerc: 15, particular: 'SERVICES CHARGES' };
    mockGets((url, opts) => {
      if (url === '/settings/invoicePrint') return Promise.resolve({ data: { status: 'success', result: { hideSignLine: false, hideTax: true } } });
      const res = detail(Number(opts.headers.invoiceid), '1');
      Object.assign(res.data.result.resultOne, { operation: 'CC', customsJob: { jobNo: 'CL-1/27' }, Charge_Heads: [taxed] });
      return Promise.resolve(res);
    });
    const { unmount } = render(<PrintList list={list} setList={() => {}} companyId='1' />);
    fireEvent.click(screen.getByText('Print all (2)'));
    expect(screen.queryByText('Hide Tax Column')).toBeNull();   // not a customs install
    unmount();
    document.cookie = 'operationMode=customs';
    try {
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      fireEvent.click(screen.getByText('Print all (2)'));
      await waitFor(() => expect(screen.getByText('Hide Tax Column').closest('label').querySelector('input').checked).toBe(true));
      fireEvent.click(screen.getByText('Print 2'));
      await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
      const heads = [...document.querySelectorAll('.invoice-print-root thead td')].map((td) => td.textContent.trim());
      expect(heads).not.toContain('Tax');
      expect(document.querySelector('.invoice-print-root').textContent).not.toContain('Total For Sales Tax');
    } finally {
      document.cookie = 'operationMode=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }
  });

  test('a note prints when Hide Note is left alone', async () => {
    mockGets(withNote);
    render(<PrintList list={list} setList={() => {}} companyId='1' />);
    printWith();
    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.invoice-print-root').textContent).toContain('Payable within 7 days of the invoice date');
  });

  test('the options picked are the ones printed', async () => {
    mockGets(withNote);
    render(<PrintList list={list} setList={() => {}} companyId='1' />);
    printWith('Hide Note');
    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('.invoice-print-root')).toHaveLength(2);
    expect(document.querySelector('.invoice-print-root').textContent).not.toContain('Payable within 7 days of the invoice date');
  });

  test('prints every invoice on the list, in its order, each from a new page', async () => {
    mockGets((url, { headers }) => Promise.resolve(
      detail(Number(headers.invoiceid), headers.invoiceid === '3' ? '0' : '1'),
    ));
    render(<PrintList list={list} setList={() => {}} companyId='1' />);
    printWith();

    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
    const printed = [...document.querySelectorAll('.invoice-print-root')];
    expect(printed).toHaveLength(2);
    expect(printed[0].textContent).toContain('SNS-JI-7/27');
    expect(printed[1].textContent).toContain('SNS-JI-3/27');
    // The second starts a page of its own; only the unapproved one says DRAFT.
    expect(printed[1].parentElement.style.breakBefore).toBe('page');
    expect(printed[0].querySelector('.draft-watermark')).toBeNull();
    expect(printed[1].querySelector('.draft-watermark')).not.toBeNull();
  });

  test('says which it could not load, and prints the rest', async () => {
    mockGets((url, { headers }) => (headers.invoiceid === '3'
      ? Promise.reject(new Error('404'))
      : Promise.resolve(detail(7, '1'))));
    render(<PrintList list={list} setList={() => {}} companyId='1' />);
    printWith();

    await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
    expect(openNotification).toHaveBeenCalledWith('Error', expect.stringContaining('SNS-JI-3/27'), 'red');
    expect(document.querySelectorAll('.invoice-print-root')).toHaveLength(1);
  });

  describe('as Sales Tax Invoices', () => {
    const taxed = { type: 'Recievable', CustomsJobId: 1, qty: 1, ex_rate: 1, rate_charge: 2500, tax_apply: true, taxPerc: 15 };
    const withCharges = (id, approved, Charge_Heads) => {
      const res = detail(id, approved);
      Object.assign(res.data.result.resultOne, { Charge_Heads, Sales_Tax_Invoice: { taxInvoiceNo: `CL-${id}` } });
      return res;
    };

    test('prints each taxed invoice on the list as its Sales Tax Invoice, from a new page', async () => {
      mockGets((url, { headers }) => Promise.resolve(
        withCharges(Number(headers.invoiceid), headers.invoiceid === '3' ? '0' : '1', [taxed]),
      ));
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith('VAT Tax Invoice');

      await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
      expect(document.querySelectorAll('.invoice-print-root')).toHaveLength(0);
      const printed = [...document.querySelectorAll('.sale-tax-invoice')];
      expect(printed).toHaveLength(2);
      expect(printed[0].textContent).toContain('CL-7');
      expect(printed[1].textContent).toContain('CL-3');
      expect(printed[1].parentElement.style.breakBefore).toBe('page');
      // Unapproved still prints as DRAFT.
      expect(printed[0].querySelector('.draft-watermark')).toBeNull();
      expect(printed[1].querySelector('.draft-watermark')).not.toBeNull();
      expect(openNotification).not.toHaveBeenCalled();
    });

    test('skips an invoice with no taxed charge, and says which', async () => {
      mockGets((url, { headers }) => Promise.resolve(
        withCharges(Number(headers.invoiceid), '1', headers.invoiceid === '3' ? [{ ...taxed, tax_apply: false }] : [taxed]),
      ));
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith('VAT Tax Invoice');

      await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
      expect(openNotification).toHaveBeenCalledWith('Some skipped', expect.stringContaining('SNS-JI-3/27'), 'orange');
      const printed = [...document.querySelectorAll('.sale-tax-invoice')];
      expect(printed).toHaveLength(1);
      expect(printed[0].textContent).toContain('CL-7');
    });

    test('prints nothing when none on the list is taxed', async () => {
      mockGets((url, { headers }) => Promise.resolve(withCharges(Number(headers.invoiceid), '1', [])));
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith('VAT Tax Invoice');

      await waitFor(() => expect(openNotification).toHaveBeenCalledWith(
        'Nothing to print', expect.stringContaining('SNS-JI-7/27, SNS-JI-3/27'), 'orange',
      ));
      await waitFor(() => expect(screen.getByText('Print all (2)')).toBeTruthy());
      expect(mockPrint).not.toHaveBeenCalled();
      expect(document.querySelectorAll('.sale-tax-invoice')).toHaveLength(0);
    });

    test('from the Sales Tax Invoice\'s own Word template where there is one', async () => {
      mockGets((url, { headers }) => Promise.resolve(withCharges(Number(headers.invoiceid), '1', [taxed])),
        { '1|Sales Tax Invoice': { id: 9, fileName: 'sti.docx' } });
      axiosClient.post.mockResolvedValue({ data: new Blob(['%PDF']) });
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith('VAT Tax Invoice');

      await waitFor(() => expect(document.querySelector('iframe[src="blob:invoices"]')).not.toBeNull());
      const { items } = axiosClient.post.mock.calls[0][1];
      expect(items.map((i) => [i.templateId, i.fields.gstInvoiceNo, i.fields.gstTotal])).toEqual([[9, 'CL-7', '2,875.00'], [9, 'CL-3', '2,875.00']]);
      expect(screen.getByText('Sales Tax Invoices from Word templates (2)')).toBeTruthy();
      expect(mockPrint).not.toHaveBeenCalled();
    });

    test('unticked again, the next print is the invoices', async () => {
      mockGets((url, { headers }) => Promise.resolve(withCharges(Number(headers.invoiceid), '1', [taxed])));
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith('VAT Tax Invoice');
      await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
      // The dialog keeps the first print's choices: untick it.
      printWith('VAT Tax Invoice');
      await waitFor(() => expect(document.querySelectorAll('.invoice-print-root')).toHaveLength(2));
      expect(document.querySelectorAll('.sale-tax-invoice')).toHaveLength(0);
    });
  });

  describe('with Word templates', () => {
    const tpl = { id: 7, fileName: 'ho.docx' };
    const approved = (url, { headers }) => Promise.resolve(detail(Number(headers.invoiceid), '1'));

    test('the list prints from them as ONE PDF, in its order - nothing in the print dialog', async () => {
      mockGets(approved, { '1|Job Invoice': tpl });
      axiosClient.post.mockResolvedValue({ data: new Blob(['%PDF']) });
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith('Hide Logo');

      await waitFor(() => expect(document.querySelector('iframe[src="blob:invoices"]')).not.toBeNull());
      const [url, body] = axiosClient.post.mock.calls[0];
      expect(url).toMatch(/\/printingTemplates\/renderMany$/);
      expect(body.items.map((i) => [i.templateId, i.fields.invoiceNo])).toEqual([[7, 'SNS-JI-7/27'], [7, 'SNS-JI-3/27']]);
      // The Printing Options picked reach the template.
      expect(body.items[0].fields.showLogo).toBe(false);
      expect(screen.getByText('Invoices from Word templates (2)')).toBeTruthy();
      expect(mockPrint).not.toHaveBeenCalled();
      expect(document.querySelectorAll('.invoice-print-root')).toHaveLength(0);
    });

    test('one without a template prints in the built-in layout, from the same window', async () => {
      mockGets((url, opts) => approved(url, opts).then((res) => {
        if (opts.headers.invoiceid === '3') res.data.result.resultOne.companyId = '2';   // another company: none
        return res;
      }), { '1|Job Invoice': tpl });
      axiosClient.post.mockResolvedValue({ data: new Blob(['%PDF']) });
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith();

      await waitFor(() => expect(screen.getByText('Print it')).toBeTruthy());
      expect(axiosClient.post.mock.calls[0][1].items.map((i) => i.fields.invoiceNo)).toEqual(['SNS-JI-7/27']);
      expect(mockPrint).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Print it'));
      await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
      const printed = [...document.querySelectorAll('.invoice-print-root')];
      expect(printed).toHaveLength(1);
      expect(printed[0].textContent).toContain('SNS-JI-3/27');
      expect(screen.queryByText('Print it')).toBeNull();
    });

    test('a template that cannot print: says why, and prints them all in the built-in layout', async () => {
      mockGets(approved, { '1|Job Invoice': tpl });
      axiosClient.post.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ result: 'This server cannot make PDFs from Word files.' })]) } });
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith();

      await waitFor(() => expect(mockPrint).toHaveBeenCalledTimes(1));
      expect(openNotification).toHaveBeenCalledWith('Error', expect.stringMatching(/cannot make PDFs.*built-in layout instead/), 'red', 10);
      expect(document.querySelectorAll('.invoice-print-root')).toHaveLength(2);
      expect(document.querySelector('iframe')).toBeNull();
    });

    test('closing the PDF lets go of it', async () => {
      mockGets(approved, { '1|Job Invoice': tpl });
      axiosClient.post.mockResolvedValue({ data: new Blob(['%PDF']) });
      render(<PrintList list={list} setList={() => {}} companyId='1' />);
      printWith();
      await waitFor(() => expect(screen.getByText('Close')).toBeTruthy());
      fireEvent.click(screen.getByText('Close'));
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:invoices');
      await waitFor(() => expect(document.querySelector('iframe')).toBeNull());
    });
  });

  test('shows nothing until something is on the list', () => {
    const { container } = render(<PrintList list={[]} setList={() => {}} companyId='1' />);
    expect(container.textContent).toBe('');
  });
});

/* The print list bar (2026-11-15): how many are on it, the list itself
 * folded away until Show - it pushed the invoices being picked off the screen. */
describe('the print list bar', () => {
  // eslint-disable-next-line global-require
  const PrintList = require('../Components/Layouts/AccountsComp/InvoiceAndBills/PrintList').default;
  const list = [
    { id: 7, invoice_No: 'SNS-JI-7/27', type: 'Job Invoice', party_Name: 'MSC', currency: 'PKR', total: '100', approved: '1' },
    { id: 3, invoice_No: 'SNS-JI-3/27', type: 'Job Invoice', party_Name: 'ONE', currency: 'PKR', total: '50', approved: '0' },
  ];

  test('says how many, and lists them only when asked', () => {
    render(<PrintList list={list} setList={() => {}} companyId='1' />);
    expect(screen.getByText('2 documents')).toBeTruthy();
    expect(screen.queryByText('SNS-JI-7/27')).toBeNull();
    fireEvent.click(screen.getByText('Show'));
    expect(screen.getByText('SNS-JI-7/27')).toBeTruthy();
    expect(screen.getByText('Unapproved · prints as DRAFT')).toBeTruthy();
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.queryByText('SNS-JI-7/27')).toBeNull();
  });

  test('Remove takes one off; Clear list empties it', () => {
    const setList = jest.fn();
    render(<PrintList list={list} setList={setList} companyId='1' />);
    fireEvent.click(screen.getByText('Show'));
    fireEvent.click(within(screen.getByText('SNS-JI-3/27').closest('tr')).getByText('Remove'));
    expect(setList).toHaveBeenLastCalledWith([list[0]]);
    fireEvent.click(screen.getByText('Clear list'));
    expect(setList).toHaveBeenLastCalledWith([]);
  });
});
