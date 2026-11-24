/**
 * The Voucher List shows each voucher in its own currency - AccountsComp/
 * Voucher/list/List. Every amount was labelled "Rs." and no currency was shown
 * (the user's report, 2026-10-15).
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import ListData, { voucherCurrency } from '../Components/Layouts/AccountsComp/Voucher/list/List';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/checkEmployeeAccess', () => ({ checkEmployeeAccess: () => true }));
jest.mock('functions/checkEditAccess', () => ({ checkEditAccess: () => true }));
jest.mock('apis/axiosClient', () => ({
  get: jest.fn(() => Promise.resolve({
    data: {
      status: 'success', count: 2,
      result: [
        { id: 1, voucher_Id: 'SNS-JV-1/27', vType: 'JV', currency: 'USD', exRate: '280', createdAt: '2026-10-01',
          Voucher_Heads: [{ type: 'debit', amount: '100', defaultAmount: '28000' }, { type: 'debit', amount: '50', defaultAmount: '14000' }] },
        { id: 2, voucher_Id: 'SNS-JV-2/27', vType: 'JV', currency: null, exRate: '1', createdAt: '2026-10-02',
          Voucher_Heads: [{ type: 'debit', amount: '5000', defaultAmount: '5000' }] },
      ],
    },
  })),
}));

test('no currency is PKR', () => {
  expect(voucherCurrency({ currency: ' usd ' })).toBe('USD');
  expect(voucherCurrency({ currency: null })).toBe('PKR');
});

test('a USD voucher shows USD, its amount in USD and the rupee figure under it; a PKR one Rs.', async () => {
  jest.useFakeTimers();
  render(<ListData />);
  await act(async () => { jest.runAllTimers(); });
  jest.useRealTimers();
  const usd = (await screen.findByText('SNS-JV-1/27')).closest('tr');
  expect(usd.textContent).toContain('USD');
  expect(usd.textContent).toContain('USD 150.00');
  expect(usd.textContent).toContain('Rs. 42,000.00 @ 280');
  const pkr = screen.getByText('SNS-JV-2/27').closest('tr');
  expect(pkr.textContent).toContain('PKR');
  expect(pkr.textContent).toContain('Rs. 5,000.00');
  expect(pkr.textContent).not.toContain('@');
});
