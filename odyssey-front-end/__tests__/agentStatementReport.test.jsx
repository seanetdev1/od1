/**
 * The International Report screen - Reports/AgentStatement. It asks for
 * today, for every company, as it opens; lists the agents we owe and those
 * owing us, each with a TOTAL, what we owe red in brackets - each agent's
 * currencies added as they stand, no rate and no currency shown; and keeps a
 * typed-in section between the two, saved on the server.
 */
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import AgentStatement from '../Components/Layouts/Reports/AgentStatement';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/companyBranding', () => ({
  reportCompanyOptions: () => [{ value: 'all', label: 'All companies' }, { value: 1, label: 'SEA NET' }],
  allCompanies: () => [{ id: 1, title: 'SEA NET' }, { id: 3, title: 'AIR CARGO SERVICES' }],
}));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const statement = (over = {}) => ({
  asOn: moment().format('YYYY-MM-DD'), company: 'all',
  payables: [{ accountId: 7, agent: 'GREEN WORLDWIDE', amount: -52783 }],
  receivables: [
    { accountId: 3, agent: 'MILESTONE TEXTILES', amount: 156762 },
    { accountId: 4, agent: 'RIV WORLDWIDE', amount: 1250.5 },
  ],
  totals: { payable: -52783, receivable: 158012.5 },
  ...over,
});

let manual;
const serve = (result = statement()) => axiosClient.get.mockImplementation((url) => Promise.resolve({
  data: { status: 'success', result: url.endsWith('/manual') ? manual : result },
}));

const open = async () => {
  let utils;
  await act(async () => { utils = render(<AgentStatement />); });
  return utils;
};
const statementCalls = () => axiosClient.get.mock.calls.filter(([url]) => url === '/misc/agentStatement');
const section = (container, heading) => [...container.querySelectorAll('.agent-statement .as-section')]
  .find((s) => s.querySelector('h6')?.textContent === heading);
const rows = (el) => [...el.querySelectorAll('tr.ant-table-row')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
const total = (el) => [...el.querySelectorAll('tr.as-total td')].map((td) => td.textContent);

beforeEach(() => {
  axiosClient.get.mockReset();
  axiosClient.post.mockReset();
  manual = { title: '', lines: [] };
});

test('opens on today, for every company', async () => {
  serve();
  await open();
  const [[, { headers }]] = statementCalls();
  // No cut-off: every invoice and bill to the date.
  expect(headers).toEqual({ ason: moment().format('YYYY-MM-DD'), from: '', company: 'all' });
});

test('a cut-off: the From date goes with the request, and the report says so', async () => {
  serve(statement({ from: '2026-07-01' }));
  const { container } = await open();
  const from = container.querySelector('input[placeholder="No cut-off"]');
  await act(async () => { fireEvent.mouseDown(from); });
  await act(async () => { fireEvent.change(from, { target: { value: '01-07-2026' } }); });
  await act(async () => { fireEvent.keyDown(from, { key: 'Enter', code: 'Enter', keyCode: 13 }); });
  await act(async () => { fireEvent.click(screen.getByText('Show')); });
  const [, { headers }] = statementCalls().pop();
  expect(headers.from).toBe('2026-07-01');
  // The printed copy names it beside the As on date.
  expect(container.querySelector('.as-print').textContent).toContain('Invoices from 01-07-2026');
});

test('the payables and the receivables, each with its TOTAL; what we owe red, in brackets', async () => {
  serve();
  const { container } = await open();
  const pay = section(container, 'AGENT PAYABLE STATEMENT');
  expect(rows(pay)).toEqual([['GREEN WORLDWIDE', '(52,783.00)']]);
  expect(pay.querySelector('.neg')).toBeTruthy();
  expect(total(pay)).toEqual(['TOTAL', '(52,783.00)']);
  const rec = section(container, 'AGENT RECEIVABLE REPORT');
  expect(rows(rec)).toEqual([['MILESTONE TEXTILES', '156,762.00'], ['RIV WORLDWIDE', '1,250.50']]);
  expect(total(rec)).toEqual(['TOTAL', '158,012.50']);
});

test('no rate and no currency: the amounts as the server added them', async () => {
  serve();
  const { container } = await open();
  expect(container.querySelector('.agent-statement .ant-input-number')).toBeNull();
  expect(container.textContent).not.toMatch(/USD|EUR|GBP|converted|rupees to the dollar/);
  expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toContain('Amount');
});

test('the typed-in section: none, then added and saved, between the two', async () => {
  serve();
  const { container } = await open();
  expect(screen.getByText(/None. Add any agents kept outside these books/)).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByText('Add')); });
  const editor = container.querySelector('.as-editor');
  const [heading, agent] = editor.querySelectorAll('input.ant-input');
  fireEvent.change(heading, { target: { value: 'IFA (PVT) LTD' } });
  fireEvent.change(agent, { target: { value: 'SKYGATE SERVICES FZCO' } });
  fireEvent.change(editor.querySelector('.ant-input-number input'), { target: { value: '-122551' } });
  const saved = { title: 'IFA (PVT) LTD', lines: [{ agent: 'SKYGATE SERVICES FZCO', amount: -122551 }] };
  axiosClient.post.mockResolvedValue({ data: { status: 'success', result: saved } });
  await act(async () => { fireEvent.click(within(editor).getByText('Save')); });

  expect(axiosClient.post).toHaveBeenCalledWith('/misc/agentStatement/manual', saved);
  const typed = section(container, 'IFA (PVT) LTD');
  expect(rows(typed)).toEqual([['SKYGATE SERVICES FZCO', '(122,551.00)']]);
  const headings = [...container.querySelectorAll('.as-section h6')].map((h) => h.textContent);
  expect(headings).toEqual(['AGENT PAYABLE STATEMENT', 'IFA (PVT) LTD', 'AGENT RECEIVABLE REPORT']);
});

test('the saved section is there when the report opens again', async () => {
  manual = { title: '', lines: [{ agent: 'FITS AIR', amount: 9495.7 }] };
  serve();
  const { container } = await open();
  expect(rows(section(container, 'OTHER AGENTS'))).toEqual([['FITS AIR', '9,495.70']]);
});

test('the print carries every section, a Remarks column, and the companies\' names', async () => {
  manual = { title: 'IFA', lines: [{ agent: 'FITS AIR', amount: 9495.7 }] };
  serve();
  const { container } = await open();
  const print = container.querySelector('.as-print');
  const banners = [...print.querySelectorAll('table.banners th[colspan]')].map((th) => th.textContent);
  expect(banners).toEqual(['SEA NET / AIR CARGO SERVICES', 'AGENT PAYABLE STATEMENT', 'IFA',
    'SEA NET / AIR CARGO SERVICES', 'AGENT RECEIVABLE REPORT']);
  const heads = [...print.querySelectorAll('table.lines thead th')].map((th) => th.textContent);
  expect(heads.slice(0, 3)).toEqual(['Agent', 'Amount', 'Remarks']);
  const last = [...print.querySelectorAll('.block.receivables tbody tr')].pop();
  expect([...last.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['TOTAL', '158,012.50', '']);
});
