/**
 * Configuration > Printing Templates, and printing from a template
 * (functions/templatePrint): the screen lists and saves the Word
 * files; Print sends the invoice's values to be filled and opens the PDF.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNotify = jest.fn();
jest.mock('apis/axiosClient', () => ({
  get: (...a) => mockGet(...a),
  post: (...a) => mockPost(...a),
  delete: jest.fn(),
}));
jest.mock('Components/Shared/Notification', () => (...a) => mockNotify(...a));
jest.mock('functions/companyBranding', () => ({
  ...jest.requireActual('functions/companyBranding'),
  companyOptions: () => [{ value: 4, label: 'H.O Enterprises' }],
  getCompany: (id) => (String(id) === '4' ? { title: 'H.O Enterprises' } : null),
  companyBankAccounts: () => [],
}));

const PrintingTemplates = require('../Components/Layouts/Config/PrintingTemplates').default;
const {
  printFromTemplate, templatesFor, renderManyPdf, usePreparedTemplatePdf,
} = require('functions/templatePrint');

const listed = (rows) => mockGet.mockImplementation(async (url) => (
  url.endsWith('/list') ? { data: { status: 'success', result: rows, docTypes: ['Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill'] } } : { data: {} }
));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockNotify.mockReset();
});

describe('the screen', () => {
  test('lists the templates by company and document', async () => {
    listed([
      { id: 1, companyId: null, docType: '*', fileName: 'default.docx' },
      { id: 2, companyId: 4, docType: 'Job Invoice', fileName: 'ho.docx' },
    ]);
    render(<PrintingTemplates />);
    await waitFor(() => expect(screen.getByText('ho.docx')).toBeTruthy());
    const row = screen.getByText('ho.docx').closest('tr');
    expect(row.textContent).toContain('H.O Enterprises');
    expect(row.textContent).toContain('Job Invoice');
    expect(screen.getByText('default.docx').closest('tr').textContent).toContain('All companies');
    // Every invoice and bill - the Sales Tax Invoice needs one of its own.
    expect(screen.getByText('default.docx').closest('tr').textContent).toContain('All invoices & bills');
  });

  test('offers both examples to start from', async () => {
    listed([]);
    render(<PrintingTemplates />);
    expect(screen.getByText(/H.O Enterprises' invoice/).getAttribute('href')).toBe('/printing-templates/ho-enterprises-invoice.docx');
    expect(screen.getByText(/the Sales Tax Invoice$/).getAttribute('href')).toBe('/printing-templates/sales-tax-invoice.docx');
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
  });

  test('with none, says everything prints its built-in layout', async () => {
    listed([]);
    render(<PrintingTemplates />);
    // Printing Templates, not Invoice Templates - B/Ls and air waybills print from them too.
    expect(screen.getByText('Printing Templates')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/everything prints its built-in layout/)).toBeTruthy());
  });

  test('uploads the Word file, and warns about names that are not fields', async () => {
    listed([]);
    mockPost.mockResolvedValue({ data: { status: 'success', result: { id: 3, companyId: null, docType: '*', fileName: 'mine.docx', tags: { invoiceNo: {}, gdNumbr: {} } } } });
    const { container } = render(<PrintingTemplates />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    const file = new File(['PK-docx-bytes'], 'mine.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [file] } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toMatch(/\/printingTemplates\/save$/);
    expect(body).toMatchObject({ companyId: null, docType: '*', fileName: 'mine.docx' });
    expect(atob(body.content)).toBe('PK-docx-bytes');
    await waitFor(() => expect(screen.getByText('gdNumbr')).toBeTruthy());
  });

  test('a refused file shows each mistake the server named', async () => {
    listed([]);
    mockPost.mockRejectedValue({ response: { status: 422, data: { result: 'The Word file has a mistake in its {fields}.', details: ['The loop with tag "expenses" is unclosed'] } } });
    const { container } = render(<PrintingTemplates />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['x'], 'bad.docx')] } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText(/is unclosed/)).toBeTruthy());
  });

  test('lists the names authors can use', async () => {
    listed([]);
    render(<PrintingTemplates />);
    fireEvent.click(screen.getByText('Totals'));
    await waitFor(() => expect(screen.getByText('{netBalance}')).toBeTruthy());
  });
});

/* A job's Bill of Lading and Air Waybill (the user's request, 2026-11-01):
 * documents of their own, with their own names. */
describe('the Bill of Lading and the Air Waybill', () => {
  const listedWithForms = (rows) => mockGet.mockImplementation(async (url) => (
    url.endsWith('/list')
      ? { data: { status: 'success', result: rows, docTypes: ['Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill', 'Sales Tax Invoice', 'Bill of Lading', 'Air Waybill'] } }
      : { data: {} }
  ));
  const pick = async (container, label) => {
    // The second select under "Add or replace" is the document.
    fireEvent.mouseDown(container.querySelectorAll('.ant-select-selector')[1]);
    fireEvent.click(await screen.findByTitle(label));
  };

  test('each has an example to start from', async () => {
    listedWithForms([]);
    render(<PrintingTemplates />);
    expect(screen.getByText(/a Bill of Lading$/).getAttribute('href')).toBe('/printing-templates/bill-of-lading.docx');
    expect(screen.getByText(/an Air Waybill$/).getAttribute('href')).toBe('/printing-templates/air-waybill.docx');
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
  });

  test('picked, the names listed are its own', async () => {
    listedWithForms([]);
    const { container } = render(<PrintingTemplates />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await pick(container, 'Air Waybill');
    expect(screen.getByText('The names an Air Waybill template can use')).toBeTruthy();
    fireEvent.click(screen.getByText('Routing'));
    await waitFor(() => expect(screen.getByText('{routingBy1}')).toBeTruthy());
    await pick(container, 'Bill of Lading');
    expect(screen.getByText('The names a Bill of Lading template can use')).toBeTruthy();
    fireEvent.click(screen.getByText('Voyage'));
    await waitFor(() => expect(screen.getByText('{vesselVoyage}')).toBeTruthy());
  });

  test('an upload is checked against its own names', async () => {
    listedWithForms([]);
    mockPost.mockResolvedValue({ data: { status: 'success', result: { id: 9, companyId: null, docType: 'Bill of Lading', fileName: 'bl.docx', tags: { blNo: {}, invoiceNo: {}, containers: { seal: {}, sael: {} } } } } });
    const { container } = render(<PrintingTemplates />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await pick(container, 'Bill of Lading');
    fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['PK'], 'bl.docx')] } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][1].docType).toBe('Bill of Lading');
    // An invoice's name is not a B/L's.
    await waitFor(() => expect(screen.getByText('invoiceNo')).toBeTruthy());
    expect(screen.getByText('containers > sael')).toBeTruthy();
    expect(screen.queryByText('blNo')).toBeNull();
  });

  test("a B/L's template is previewed from the B/L, not with an invoice number", async () => {
    listedWithForms([{ id: 9, companyId: null, docType: 'Bill of Lading', fileName: 'bl.docx' }]);
    render(<PrintingTemplates />);
    const row = (await screen.findByText('bl.docx')).closest('tr');
    expect(row.textContent).toContain('Ref No\'s / Stamps tab');
    expect(row.querySelector('input')).toBeNull();
  });
});

describe('printing from a template', () => {
  const invoice = { id: 9, invoice_No: 'HO-9695/26', type: 'Job Invoice', payType: 'Recievable', operation: 'CC', roundOff: '0', recieved: '0', customsJob: { jobNo: 'TP-9588/26' } };

  test('sends the invoice\'s values and opens the PDF in a new tab', async () => {
    const tab = { document: { write: jest.fn() }, location: { href: '' }, close: jest.fn() };
    window.open = jest.fn(() => tab);
    global.URL.createObjectURL = jest.fn(() => 'blob:pdf');
    mockPost.mockResolvedValue({ data: new Blob(['%PDF']) });
    await printFromTemplate({ id: 7 }, { invoice, records: [], options: { hideBalance: true } });
    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toMatch(/\/printingTemplates\/render$/);
    expect(body).toMatchObject({ templateId: 7, format: 'pdf', fileName: 'HO-9695/26' });
    expect(body.fields).toMatchObject({ invoiceNo: 'HO-9695/26', jobNo: 'TP-9588/26', showBalance: false });
    // It reports its own failure - not "Something went wrong" on top of it.
    expect(config).toEqual({ responseType: 'blob', ownErrors: true });
    expect(tab.location.href).toBe('blob:pdf');
  });

  test('a failure closes the tab and says why', async () => {
    const tab = { document: { write: jest.fn() }, location: { href: '' }, close: jest.fn() };
    window.open = jest.fn(() => tab);
    mockPost.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ result: 'This server cannot make PDFs from Word files.' })]) } });
    await printFromTemplate({ id: 7 }, { invoice, records: [] });
    expect(tab.close).toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith('Error', 'This server cannot make PDFs from Word files.', 'red', 10);
  });

  // The user's 10-29 "The invoice could not be printed from its template.":
  // a session ended by a login elsewhere, which the reply said as `message`.
  test('a reply with a message and no result is said in its words', async () => {
    window.open = jest.fn(() => ({ document: { write: jest.fn() }, location: { href: '' }, close: jest.fn() }));
    mockPost.mockRejectedValue({ response: { status: 401, data: { isLoggedIn: false, message: 'User logged in elsewhere' } } });
    await printFromTemplate({ id: 7 }, { invoice, records: [] });
    expect(mockNotify).toHaveBeenCalledWith('Error', 'User logged in elsewhere', 'red', 10);
  });

  test('no reply at all says the server could not be reached, not that the template failed', async () => {
    window.open = jest.fn(() => ({ document: { write: jest.fn() }, location: { href: '' }, close: jest.fn() }));
    mockPost.mockRejectedValue({ isAxiosError: true, request: {}, message: 'Network Error' });
    await printFromTemplate({ id: 7 }, { invoice, records: [] });
    expect(mockNotify).toHaveBeenCalledWith('Error', 'The server could not be reached - check the connection and print again.', 'red', 10);
  });

  test('the Sales Tax Invoice is named as one', async () => {
    window.open = jest.fn(() => ({ document: { write: jest.fn() }, location: { href: '' }, close: jest.fn() }));
    mockPost.mockResolvedValue({ data: new Blob(['%PDF']) });
    await printFromTemplate({ id: 8 }, { invoice, records: [], salesTaxInvoice: true });
    expect(mockPost.mock.calls[0][1]).toMatchObject({ templateId: 8, fileName: 'HO-9695/26 Sales Tax Invoice' });
  });
});

describe('Print opens the invoice ready, made while Printing Options is open', () => {
  const invoice = { id: 9, invoice_No: 'HO-9695/26', type: 'Job Invoice', payType: 'Recievable', operation: 'CC', roundOff: '0', recieved: '0', customsJob: { jobNo: 'TP-9588/26' } };
  // Printing Options, as far as this goes: open or not, one option, Print.
  const Options = ({ open, hideBalance = false }) => {
    const pdf = usePreparedTemplatePdf({ id: 7 }, { invoice, records: [], options: { hideBalance } }, open);
    return <button type='button' onClick={pdf.print}>{pdf.status}</button>;
  };
  let finish;
  beforeEach(() => {
    let n = 0;
    global.URL.createObjectURL = jest.fn(() => { n += 1; return `blob:pdf-${n}`; });
    global.URL.revokeObjectURL = jest.fn();
    window.open = jest.fn(() => ({}));
    // The server answers when the test says so.
    mockPost.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ data: new Blob(['%PDF']) }); }));
  });

  test('nothing is made until the dialog opens; then it is, and Print opens it at once', async () => {
    const { rerender } = render(<Options open={false} />);
    await new Promise((r) => setTimeout(r, 500));
    expect(mockPost).not.toHaveBeenCalled();
    rerender(<Options open />);
    expect(screen.getByRole('button').textContent).toBe('preparing');
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    finish();
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('ready'));
    expect(window.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    expect(window.open).toHaveBeenCalledWith('blob:pdf-1', '_blank');
  });

  test('pressed while it is still being made: the tab opens the moment it is ready', async () => {
    render(<Options open />);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button'));
    expect(window.open).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:pdf-1', '_blank'));
  });

  test('an option changed makes it again, with that option', async () => {
    const { rerender } = render(<Options open />);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    finish();
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('ready'));
    rerender(<Options open hideBalance />);
    expect(screen.getByRole('button').textContent).toBe('preparing');
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    expect(mockPost.mock.calls[1][1].fields.showBalance).toBe(false);
  });

  test('a tab blocked that late: says so, and Print again opens it', async () => {
    window.open = jest.fn(() => null);
    render(<Options open />);
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button'));
    finish();
    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('Pop-up blocked', expect.stringMatching(/press Print again/), 'orange', 8));
  });

  test('a failure is said when Print is pressed, and Print tries again', async () => {
    mockPost.mockRejectedValueOnce({ response: { data: new Blob([JSON.stringify({ result: 'No LibreOffice.' })]) } });
    render(<Options open />);
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('failed'));
    expect(mockNotify).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2));
    finish();
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:pdf-1', '_blank'));
  });
});

describe('a bulk print', () => {
  const invoice = { id: 9, invoice_No: 'HO-9695/26', type: 'Job Invoice', payType: 'Recievable', operation: 'CC', roundOff: '0', recieved: '0', customsJob: { jobNo: 'TP-9588/26' } };

  test('asks once per company and document which template applies, and answers per invoice', async () => {
    mockGet.mockImplementation(async (url, { params }) => ({
      data: { result: params.companyId === 4 && params.type === 'Job Invoice' ? { id: 7 } : null },
    }));
    const invoices = [
      { companyId: 4, type: 'Job Invoice' }, { companyId: 5, type: 'Job Invoice' }, { companyId: 4, type: 'Job Invoice' },
    ];
    const found = await templatesFor(invoices, (inv) => inv);
    expect(found.map((t) => t?.id ?? null)).toEqual([7, null, 7]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test('sends every invoice\'s values in order, each with its template, for one PDF', async () => {
    mockPost.mockResolvedValue({ data: new Blob(['%PDF']) });
    const second = { ...invoice, invoice_No: 'HO-9696/26' };
    const pdf = await renderManyPdf([{ template: { id: 7 }, args: { invoice } }, { template: { id: 8 }, args: { invoice: second } }], 'Invoices');
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toMatch(/\/printingTemplates\/renderMany$/);
    expect(body.fileName).toBe('Invoices');
    expect(body.items.map((i) => [i.templateId, i.fields.invoiceNo])).toEqual([[7, 'HO-9695/26'], [8, 'HO-9696/26']]);
    expect(pdf.type).toBe('application/pdf');
  });

  test('a refusal comes back in the server\'s words', async () => {
    mockPost.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ result: 'HO-1: The invoice could not be put into the Word file.', details: ['Unclosed tag'] })]) } });
    await expect(renderManyPdf([{ template: { id: 7 }, args: { invoice } }])).rejects.toThrow('HO-1: The invoice could not be put into the Word file. Unclosed tag');
  });
});
