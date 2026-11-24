/**
 * A cash voucher has no cheque - functions/cashCheque, and Payments &
 * Receipts' Cash mode (Components/Layouts/AccountsComp/PaymentsReceipt/BillComp).
 *
 * Reported 2026-10-21: cash vouchers were saved with the date picker's default
 * - today - as their cheque date, and P&R kept a cheque number typed before
 * the mode was switched to Cash. The server refuses both now too; these pin
 * what the screens show and send.
 */
import React, { useReducer } from 'react';
import moment from 'moment';
import { render, screen, fireEvent } from '@testing-library/react';
import { isCashVoucher, isCashMode, pickerDate } from '../functions/cashCheque';
import reducer from '../redux/paymentReciept/paymentRecieptSlice';

const mockGet = jest.fn(() => Promise.resolve({ data: { result: [] } }));
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ fiscalYear: { value: 1 } }), useDispatch: () => jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));

// eslint-disable-next-line import/first
import BillComp from '../Components/Layouts/AccountsComp/PaymentsReceipt/BillComp';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

describe('functions/cashCheque', () => {
  test('CPV and CRV are the cash vouchers', () => {
    expect(['CPV', 'CRV', 'crv'].every(isCashVoucher)).toBe(true);
    expect(['BPV', 'BRV', 'JV', 'TV', 'ADJ-P', '', undefined].some(isCashVoucher)).toBe(false);
  });

  test('Cash is the cash mode, as P&R and Direct Job write it', () => {
    expect([isCashMode('Cash'), isCashMode('cash'), isCashMode('Bank'), isCashMode('Adjust')])
      .toEqual([true, true, false, false]);
  });

  test('a picker with no date shows nothing - not today, not "Invalid date"', () => {
    expect(pickerDate(null)).toBeNull();
    expect(pickerDate(undefined)).toBeNull();
    expect(pickerDate('')).toBeNull();
    expect(pickerDate('not a date')).toBeNull();
    expect(pickerDate('2026-09-05T00:00:00.000Z').isSame(moment('2026-09-05T00:00:00.000Z'))).toBe(true);
  });
});

describe('Payments & Receipts', () => {
  let store;
  const Harness = ({ init }) => {
    const [state, dispatch] = useReducer(reducer, init);
    store = { state, dispatch };
    return <BillComp back={() => {}} companyId={1} state={state} dispatch={dispatch} actionRef={{ current: null }} />;
  };
  const open = (over) => render(<Harness init={{ ...reducer(undefined, { type: 'init' }), ...over }} />);
  const chequeBox = () => screen.getByText('Cheque/Tran #').parentElement.querySelector('input');
  const dateBox = () => screen.getByText('Cheque Date').parentElement.querySelector('input');

  test('switching to Cash empties the cheque number and date', () => {
    open({ transactionMode: 'Bank', subType: 'Cheque', checkNo: '445566', checkDate: '2026-09-05T00:00:00.000Z' });
    expect(chequeBox().value).toBe('445566');

    fireEvent.click(screen.getByLabelText('Cash'));

    expect([store.state.checkNo, store.state.checkDate]).toEqual(['', null]);
    expect(chequeBox().value).toBe('');
    expect(chequeBox().disabled).toBe(true);
    expect(dateBox().value).toBe('');
  });

  test('a cash receipt shows no cheque date, even with one still in state', () => {
    open({ transactionMode: 'Cash', checkDate: moment().toISOString() });
    expect(dateBox().value).toBe('');
  });

  test('back on Bank, the date starts at today again', () => {
    open({ transactionMode: 'Cash', checkNo: '', checkDate: null });
    fireEvent.click(screen.getByLabelText('Bank'));
    expect(moment(store.state.checkDate).isSame(moment(), 'day')).toBe(true);
    expect(dateBox().value).not.toBe('');
  });
});
