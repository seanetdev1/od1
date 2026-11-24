/**
 * A customs job's Charges tab, in tabs or on one page - Configuration >
 * Customs, "Charges in tabs" (the user, 2026-11-11: one install wants
 * Receivable, Payable and Summary apart; CargoLinkers keeps one page).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => null }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn(() => Promise.resolve({ data: { status: 'success', result: [] } })), post: jest.fn() }));
jest.mock('apis/customsJobs', () => ({ getCustomsChargeSummary: jest.fn(() => Promise.resolve({ status: 'success', result: null })) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/customsStatuses', () => {
  const real = jest.requireActual('functions/customsStatuses');
  return { ...real, useCustomsStatuses: () => real.DEFAULT_STATUSES };
});

// eslint-disable-next-line import/first
import Charges from '../Components/Layouts/CustomsJobs/Charges';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const values = { charge: [], party: [] };
let shown;
const Sheet = ({ tabbed }) => {
  const [charges, setCharges] = useState([]);
  shown = charges;
  return (
    <Charges job={{ id: 9, clientId: 3 }} jobId={9} charges={charges} setCharges={setCharges} values={values}
      disabled={false} onInvoice={() => {}} invoicing={false} onInvoiceApproval={() => {}}
      approvingInvoices={false} active tabbed={tabbed} />
  );
};
const open = async (tabbed) => { await act(async () => { render(<Sheet tabbed={tabbed} />); }); };
const press = (k) => act(() => { fireEvent.keyDown(window, { key: k, altKey: true }); });
const tabNames = () => screen.queryAllByRole('tab').map((t) => t.textContent);
const activeTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('on one page - the default, and CargoLinkers\'', () => {
  test('Receivable, Payable and Summary one under another, with no tabs', async () => {
    await open(undefined);
    expect(tabNames()).toEqual([]);
    expect(screen.getAllByText('Add +')).toHaveLength(2);
    expect(screen.getByText('Summary')).toBeTruthy();
  });
});

describe('in tabs', () => {
  test('three tabs, each saying how many lines it holds, opening on Receivable', async () => {
    await open(true);
    expect(tabNames()).toEqual(['Receivable (0)', 'Payable (0)', 'Summary']);
    expect(activeTab()).toBe('Receivable (0)');
  });

  test('a line added on a tab counts on that tab', async () => {
    await open(true);
    fireEvent.click(screen.getByText('Add +'));
    expect(shown.map((c) => c.type)).toEqual(['Recievable']);
    expect(tabNames()).toEqual(['Receivable (1)', 'Payable (0)', 'Summary']);
  });

  test('Alt+B brings up Payable with its new line, Alt+R goes back - never adding out of sight', async () => {
    await open(true);
    press('b');
    expect(shown.map((c) => c.type)).toEqual(['Payble']);
    expect(activeTab()).toBe('Payable (1)');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Charge'));
    press('r');
    expect(activeTab()).toBe('Receivable (1)');
    expect(shown.map((c) => c.type)).toEqual(['Payble', 'Recievable']);
  });

  test('the lines entered on one tab are still there after visiting the others', async () => {
    await open(true);
    press('r');
    press('r');
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Receivable (2)' }));
    expect(shown).toHaveLength(2);
    expect(screen.getAllByPlaceholderText('Charge').length).toBeGreaterThanOrEqual(2);
  });
});
