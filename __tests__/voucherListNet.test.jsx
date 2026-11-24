/**
 * The Voucher List's Net Amount - what a payment's bank or cash paid out, or
 * a receipt's took in, as the server works it out (the user's request,
 * 2026-10-26). AccountsComp/Voucher/list/List.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import ListData from '../Components/Layouts/AccountsComp/Voucher/list/List';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/checkEmployeeAccess', () => ({ checkEmployeeAccess: () => true }));
jest.mock('functions/checkEditAccess', () => ({ checkEditAccess: () => true }));
jest.mock('apis/axiosClient', () => ({
  get: jest.fn(() => Promise.resolve({
    data: {
      status: 'success', count: 3,
      result: [
        { id: 1, voucher_Id: 'SNS-BPV-1/27', vType: 'BPV', currency: 'PKR', exRate: '1', createdAt: '2026-10-01',
          Voucher_Heads: [{ type: 'debit', amount: '100000', defaultAmount: '100000' }], netAmount: 80000, netAmountPkr: 80000 },
        { id: 2, voucher_Id: 'SNS-BRV-2/27', vType: 'BRV', currency: 'USD', exRate: '280', createdAt: '2026-10-02',
          Voucher_Heads: [{ type: 'debit', amount: '1000', defaultAmount: '280000' }], netAmount: 995, netAmountPkr: 278600 },
        { id: 3, voucher_Id: 'SNS-JV-3/27', vType: 'JV', currency: 'PKR', exRate: '1', createdAt: '2026-10-03',
          Voucher_Heads: [{ type: 'debit', amount: '500', defaultAmount: '500' }], netAmount: null, netAmountPkr: null },
      ],
    },
  })),
}));

const show = async (props) => {
  jest.useFakeTimers();
  render(<ListData {...props} />);
  await act(async () => { jest.runAllTimers(); });
  jest.useRealTimers();
  await screen.findByText('SNS-BPV-1/27');
};

const netOf = (voucherId) => screen.getByText(voucherId).closest('tr').querySelector('[data-testid="voucher-list-net"]');

test('General shows each payment and receipt net, beside its Amount, and a dash on a journal', async () => {
  await show({ category: 'general' });
  expect(screen.getByText('Net Amount').tagName).toBe('TH');
  expect(netOf('SNS-BPV-1/27').textContent).toBe('Rs. 80,000.00');
  expect(screen.getByText('SNS-BPV-1/27').closest('tr').textContent).toContain('Rs. 100,000.00'); // the Amount, unchanged
  expect(netOf('SNS-BRV-2/27').textContent).toBe('USD 995.00Rs. 278,600.00 @ 280');
  expect(netOf('SNS-JV-3/27').textContent).toBe('—');
});

test('SI / PI and opening balances have no bank or cash side, so no column', async () => {
  await show({ category: 'sipi' });
  expect(screen.queryByText('Net Amount')).toBeNull();
  expect(netOf('SNS-BPV-1/27')).toBeNull();
});
