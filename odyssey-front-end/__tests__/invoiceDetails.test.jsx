/**
 * The invoice page (2026-11-15 redesign: "details look scattered") - its
 * rules (functions/invoiceDetails) and the page itself (InvoiceCharges).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { jobLink, chargeColumns, invoiceMoney, grouped, settlementRows } from 'functions/invoiceDetails';
import { roundOffLine } from 'Components/Shared/invoicePrintDefaults';

const line = (over = {}) => ({
  charge: '184', particular: 'SERVICES CHARGES', basis: 'Per Shipment', pp_cc: '', size_type: '', dg_type: '',
  qty: '1', currency: 'PKR', type: 'Recievable', rate_charge: '2500', amount: '1', discount: '0',
  tax_apply: false, tax_amount: '0', net_amount: '2500', ex_rate: '1', local_amount: '2500', ...over,
});

describe('the job an invoice is for', () => {
  test.each([
    ['SE', '/seaJobs/export/7', '4-3', 'SE JOB'],
    ['SI', '/seaJobs/import/7', '4-6', 'SI JOB'],
    ['AE', '/airJobs/export/7', '7-2', 'AE JOB'],
    ['AI', '/airJobs/import/7', '7-5', 'AI JOB'],
  ])('a freight %s job opens on its own screen and tab - every kind was the sea export tab', (op, href, key, label) => {
    expect(jobLink({ operation: op, SEJobId: 7, SE_Job: { jobNo: `SNS-${op}-41/27` } }))
      .toEqual({ jobNo: `SNS-${op}-41/27`, href, tab: { label, key, id: '7' } });
  });

  test('without an operation, the kind is read off the job number', () => {
    expect(jobLink({ SEJobId: 9, SE_Job: { jobNo: 'SNS-AI-12/27' } }).tab.key).toBe('7-5');
  });

  test('a customs invoice names its customs job - it was blank', () => {
    expect(jobLink({ SE_Job: null, customsJob: { id: 24299, jobNo: 'TP-2780/27' } }))
      .toEqual({ jobNo: 'TP-2780/27', href: '/customsJobs/24299', tab: { label: 'TP-2780/27', key: '11-2', id: 24299 } });
  });

  test('an aviation invoice names its flight', () => {
    expect(jobLink({ aviation: { jobId: 3, jobNo: 'AVJ-3/27' } }).href).toBe('/aviationJobs/3');
  });

  test('no job, no link', () => {
    expect(jobLink({ SE_Job: { jobNo: '' } })).toBeNull();
    expect(jobLink(null)).toBeNull();
  });
});

describe('the charge table\'s columns', () => {
  const titles = (lines) => chargeColumns(lines).map((c) => c.title);

  test('a customs invoice in rupees: no PP/CC, size, DG, discount, tax or rate of exchange', () => {
    expect(titles([line(), line({ charge: '280' })])).toEqual(
      ['#', 'Code', 'Particular', 'Basis', 'Qty', 'Cur.', 'DN/CN', 'Rate', 'Amount', 'Net', 'Total'],
    );
  });

  test('a column comes back when any line fills it', () => {
    const t = titles([line(), line({ pp_cc: 'PP', size_type: "40'HC", discount: '50', tax_apply: true, tax_amount: '375', currency: 'USD', ex_rate: '280.5' })]);
    ['PP/CC', 'Size', 'Disc', 'Tax', 'Tax Amt', 'Ex.'].forEach((c) => expect(t).toContain(c));
  });

  test('a taxed line says so - the column was empty on every invoice', () => {
    const tax = chargeColumns([line({ tax_apply: true })]).find((c) => c.title === 'Tax');
    expect(tax.cell(line({ tax_apply: true }))).toBe('Yes');
    expect(tax.cell(line())).toBe('');
  });

  test('every column keeps its place in the eighteen, for the Round Off line', () => {
    const cols = chargeColumns([line()]);
    const round = roundOffLine({ roundOff: '0.4', payType: 'Recievable' }, 2);
    const cells = cols.map((c) => round[c.index]);
    expect(cells[0]).toBe(2);
    expect(cells[cells.length - 1]).toBe('+0.40');   // under Total
    expect(cells[2]).toBe('Round Off');             // under Particular
  });

  test('figures are grouped, their decimals kept', () => {
    expect(grouped('46072')).toBe('46,072');
    expect(grouped('280.5')).toBe('280.5');
    expect(grouped('')).toBe('');
    expect(grouped('n/a')).toBe('n/a');
  });
});

describe('settlementRows', () => {
  test('a payable: the exchange difference a gain when it cost less', () => {
    const rows = settlementRows({
      InvTran: [{ VoucherId: 1, amount: '100' }],
      vouchers: [{ id: 1, voucher_Id: 'BPV-1', vType: 'BPV', tranDate: '2026-10-01', exRate: '278' }],
      heads: [],
    }, { payType: 'Payble', currency: 'USD', ex_rate: '280' });
    expect(rows[0]).toMatchObject({ amount: 100, rate: 278, local: 27800, exchange: 200 });
  });
  test('a rupee invoice: rate 1, no exchange difference', () => {
    const rows = settlementRows({
      InvTran: [{ VoucherId: 1, amount: '2875' }],
      vouchers: [{ id: 1, voucher_Id: 'BRV-1', vType: 'BRV', tranDate: '2026-10-01', exRate: '1' }],
      heads: [{ VoucherId: 1, narration: 'X' }],
    }, { payType: 'Recievable', currency: 'PKR', ex_rate: '1' });
    expect(rows[0]).toMatchObject({ amount: 2875, rate: 1, local: 2875, exchange: 0, narration: 'X' });
  });
  test('nothing, or rubbish, is no rows', () => {
    expect(settlementRows(undefined, {})).toEqual([]);
    expect(settlementRows({ InvTran: null }, {})).toEqual([]);
  });
});

describe('the money at the top, as the print has it', () => {
  test('total with its round off, received and balance', () => {
    const m = invoiceMoney({ total: '117959.60', roundOff: '0.40', recieved: '100000', payType: 'Recievable', currency: 'PKR' });
    expect(m.total).toBe(117960);
    expect(m.settled).toEqual({ label: 'Received', value: 100000 });
    expect(m.balance.value).toBe(17960);
  });

  test('a bill is paid; a foreign invoice carries no rupee round off', () => {
    const m = invoiceMoney({ total: '600', roundOff: '0.4', paid: '600', payType: 'Payble', currency: 'USD' });
    expect(m.total).toBe(600);
    expect(m.settled.label).toBe('Paid');
    expect(m.balance.value).toBe(0);
  });
});

/* -------------------------------- the page -------------------------------- */
jest.mock('apis/axiosClient', () => ({ get: jest.fn(() => Promise.resolve({ data: {} })), post: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ removeQueries: jest.fn() }) }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => '1' }));
jest.mock('next/router', () => ({ push: jest.fn(() => Promise.resolve()) }));
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: (x) => x }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));
jest.mock('Components/Shared/InvoicePrint', () => () => null);
jest.mock('Components/Shared/SendInvoiceEmailModal', () => () => null);
jest.mock('Components/Shared/InvoiceEditor', () => () => <button type='button'>Charge</button>);
jest.mock('Components/Shared/Documents', () => ({
  useDocuments: () => ({ modal: null, count: 0, saved: true, open: jest.fn(), extra: {}, label: 'Documents', tip: '' }),
  PaperclipCount: () => null,
}));
jest.mock('functions/templatePrint', () => ({
  usePrintingTemplate: () => null,
  usePreparedTemplatePdf: () => ({ status: 'idle' }),
  downloadTemplateWord: jest.fn(),
  SALES_TAX_INVOICE: 'Sales Tax Invoice',
}));
jest.mock('functions/myPermissions', () => ({ useMyPermissions: () => () => true }));

describe('the invoice page', () => {
  beforeAll(() => {
    window.matchMedia = window.matchMedia || ((q) => ({
      matches: false, media: q, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    }));
  });

  // eslint-disable-next-line global-require
  const InvoiceCharges = require('Components/Shared/InvoiceCharges').default;
  const invoice = {
    id: 81335, invoice_No: 'JI-2907/27', type: 'Job Invoice', payType: 'Recievable', approved: '0', currency: 'PKR',
    ex_rate: '1', total: '2875', recieved: '1000', roundOff: '0', party_Name: 'CONVENIENCE FOOD', partyType: 'client',
    createdAt: '2026-10-08T10:00:00Z', SE_Job: null, customsJob: { id: 24299, jobNo: 'TP-2780/27' },
    Charge_Heads: [line({ tax_apply: true, tax_amount: '375', net_amount: '2875', local_amount: '2875' })],
  };
  const page = (over = {}) => render(<InvoiceCharges data={{ resultOne: { ...invoice, ...over } }} companyId='1' ownsPage />);

  test('who and what: the number, its type, whether approved, the party and the customs job', async () => {
    await act(async () => { page(); });
    const summary = document.querySelector('.inv-summary');
    expect(within(summary).getByRole('heading', { name: 'JI-2907/27' })).toBeInTheDocument();
    expect(within(summary).getByText('Unapproved')).toHaveClass('dl-badge', 'tone-amber');
    expect(within(summary).getByText('CONVENIENCE FOOD')).toBeInTheDocument();
    expect(within(summary).getByText('Client')).toBeInTheDocument();
    const link = within(summary).getByRole('button', { name: 'TP-2780/27' });
    await act(async () => { fireEvent.click(link); });
    expect(require('next/router').push).toHaveBeenCalledWith('/customsJobs/24299');
  });

  test('the money beside it: total, received, balance', async () => {
    await act(async () => { page(); });
    const money = document.querySelector('.inv-money');
    expect(money).toHaveTextContent('2,875.00');
    expect(money).toHaveTextContent('Received1,000.00');
    expect(money).toHaveTextContent('Balance1,875.00');
  });

  test('the charges: only the columns in use, a taxed line marked, the total under them', async () => {
    await act(async () => { page(); });
    const heads = [...document.querySelectorAll('.inv-charges thead th')].map((th) => th.textContent);
    expect(heads).toEqual(['#', 'Code', 'Particular', 'Basis', 'Qty', 'Cur.', 'DN/CN', 'Rate', 'Amount', 'Tax', 'Tax Amt', 'Net', 'Total']);
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(document.querySelector('.inv-charges tfoot')).toHaveTextContent('Total (PKR)2,875.00');
  });

  test('the four things set on it, each named', async () => {
    await act(async () => { page(); });
    ['Date', 'Currency', 'Round off', 'Approved'].forEach((l) => expect(screen.getByText(l, { selector: '.inv-field-label' })).toBeInTheDocument());
    expect(screen.getByLabelText('Approved')).not.toBeChecked();
  });

  test('a bill: Payable, Paid, and the vendor\'s tax invoice number', async () => {
    await act(async () => { page({ payType: 'Payble', type: 'Job Bill', paid: '0', recieved: '0' }); });
    expect(document.querySelector('.inv-meta')).toHaveTextContent('Payable');
    expect(document.querySelector('.inv-money')).toHaveTextContent('Paid0.00');
    expect(screen.getByPlaceholderText("The vendor's tax invoice number")).toBeInTheDocument();
  });

  test('in a job\'s tab or a modal, the actions are on the page itself', async () => {
    await act(async () => { render(<InvoiceCharges data={{ resultOne: invoice }} companyId='1' />); });
    const bar = document.querySelector('.inv-actions');
    ['Print', 'Email', 'Delete', 'Go to Payment / Receipt'].forEach((name) => expect(within(bar).getByText(name)).toBeInTheDocument());
  });

  /* THE SETTLEMENTS WINDOW (2026-11-16 redesign). Each voucher's SHARE of
   * this invoice, matched to its own voucher, dated - it showed the voucher's
   * whole party line, paired by position, every row dated today. */
  const settlementData = {
    InvTran: [
      { VoucherId: 202, amount: '25', gainLoss: '' },
      { VoucherId: 201, amount: '15', gainLoss: '' },
    ],
    // In InvTran's order, as the server sends them.
    vouchers: [
      { id: 202, voucher_Id: 'SNS-BRV-202/27', vType: 'BRV', tranDate: '2026-10-20', exRate: '285' },
      { id: 201, voucher_Id: 'SNS-BRV-201/27', vType: 'BRV', tranDate: '2026-10-05', exRate: '279' },
    ],
    // The party lines - one voucher with two, so pairing by position goes wrong.
    heads: [
      { VoucherId: 202, defaultAmount: '9000', narration: 'RECEIVED AGAINST 3 INVOICES' },
      { VoucherId: 202, defaultAmount: '500', narration: 'BANK CHARGES' },
      { VoucherId: 201, defaultAmount: '15', narration: 'PART PAYMENT' },
    ],
  };

  test('settlements: the share of each voucher, by its own voucher, dated', async () => {
    const axiosClient = require('apis/axiosClient');
    axiosClient.get.mockImplementation((url) => Promise.resolve({
      data: String(url).includes('getAllInvoiceData') ? { status: 'success', result: settlementData } : {},
    }));
    await act(async () => { page({ currency: 'USD', ex_rate: '280', total: '100', recieved: '40' }); });
    await act(async () => { fireEvent.click(screen.getByText('View settlements')); });
    const rows = [...document.querySelectorAll('.settle-table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    // Oldest first; this invoice's share (15, 25) - not 9,000; its own narration.
    expect(rows[0].slice(0, 4)).toEqual(['SNS-BRV-201/27', 'BRV', '05 Oct 2026', '15.00']);
    expect(rows[1].slice(0, 4)).toEqual(['SNS-BRV-202/27', 'BRV', '20 Oct 2026', '25.00']);
    expect(rows[0].at(-1)).toBe('PART PAYMENT');
    // Rupees at the voucher's rate, and the exchange difference against the
    // invoice's 280: 15 x 279 = 4,185, a loss of 15; 25 x 285 = 7,125, a gain of 125.
    expect(rows[0].slice(4, 7)).toEqual(['279', '4,185.00', '-15.00']);
    expect(rows[1].slice(4, 7)).toEqual(['285', '7,125.00', '+125.00']);
    expect(document.querySelector('.settle-table tfoot')).toHaveTextContent('2 vouchers40.00');
    // The invoice's own figures above, as its page has them.
    expect(document.querySelector('.settle-stats')).toHaveTextContent('Received40.00PKR 11,200.00');
  });

  test('settlements: nothing yet says so; a refused fetch says why', async () => {
    const axiosClient = require('apis/axiosClient');
    axiosClient.get.mockImplementation((url) => Promise.resolve({
      data: String(url).includes('getAllInvoiceData') ? { status: 'success', result: { InvTran: [], vouchers: [], heads: [] } } : {},
    }));
    let utils;
    await act(async () => { utils = render(<InvoiceCharges data={{ resultOne: { ...invoice } }} companyId='1' ownsPage />); });
    await act(async () => { fireEvent.click(screen.getByText('View settlements')); });
    expect(screen.getByText('Nothing received against this invoice yet.')).toBeInTheDocument();
    utils.unmount();
    axiosClient.get.mockImplementation((url) => (String(url).includes('getAllInvoiceData')
      ? Promise.reject({ response: { data: { result: 'Server unreachable' } } })
      : Promise.resolve({ data: {} })));
    await act(async () => { render(<InvoiceCharges data={{ resultOne: { ...invoice } }} companyId='1' ownsPage />); });
    await act(async () => { fireEvent.click(screen.getByText('View settlements')); });
    expect(screen.getByText('Server unreachable')).toBeInTheDocument();
  });
});
