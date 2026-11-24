/**
 * Cheque Return on Payments & Receipts - functions/chequeReturn and the
 * PaymentsReceipt/ChequeReturn dialog (the user's request, 2026-10-13).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { chequeReturnState, returnPreview } from 'functions/chequeReturn';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockNotify = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => (...a) => mockNotify(...a));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ fiscalYear: { value: 7 } }) }));
jest.mock('js-cookie', () => ({ get: () => '12' }));

// eslint-disable-next-line import/first
import ChequeReturn from '../Components/Layouts/AccountsComp/PaymentsReceipt/ChequeReturn';

describe('when Cheque Return is offered', () => {
  test('on a bank payment or receipt not yet returned', () => {
    expect(chequeReturnState({ vType: 'BRV' }).available).toBe(true);
    expect(chequeReturnState({ vType: 'BPV' }).available).toBe(true);
  });

  test('greyed, saying why, on anything else', () => {
    expect(chequeReturnState(null)).toEqual({ available: false, title: 'Open a voucher first' });
    expect(chequeReturnState({ vType: 'CRV' }).title).toMatch(/Only a bank payment or receipt.*CRV/);
    expect(chequeReturnState({ vType: 'ADJ-R' }).available).toBe(false);
    expect(chequeReturnState({ vType: 'BRV', returnedBy: 'SNS-CR-3/27' }))
      .toEqual({ available: false, returnedBy: 'SNS-CR-3/27', title: 'Cheque already returned - SNS-CR-3/27' });
  });
});

describe('the dialog', () => {
  const voucher = {
    id: 41, voucher_Id: 'SNS-BRV-12/27', partyName: 'GETZ PHARMA', chequeNo: '11759974', currency: 'PKR', exRate: '1',
    Voucher_Heads: [
      { type: 'debit', amount: '400', accountType: 'payAccount', Child_Account: { title: 'BANK AL HABIB' } },
      { type: 'credit', amount: '400', accountType: 'partyAccount', Child_Account: { title: 'GETZ PHARMA' } },
    ],
  };

  test('the preview puts every line on the other side', () => {
    expect(returnPreview(voucher.Voucher_Heads)).toEqual([
      { account: 'BANK AL HABIB', accountType: 'payAccount', debit: 0, credit: 400 },
      { account: 'GETZ PHARMA', accountType: 'partyAccount', debit: 400, credit: 0 },
    ]);
  });

  test('shows the CR it will post, and Approve & Save posts it', async () => {
    mockGet.mockResolvedValue({ data: { result: voucher } });
    mockPost.mockResolvedValue({ data: { status: 'success', result: { voucher_Id: 'SNS-CR-1/27' } } });
    const onDone = jest.fn();
    render(<ChequeReturn open voucherId={41} onClose={() => {}} onDone={onDone} />);

    expect(await screen.findByText('SNS-BRV-12/27')).toBeTruthy();
    expect(screen.getByText('BANK AL HABIB')).toBeTruthy();
    fireEvent.click(screen.getByText('Approve & Save'));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][0]).toMatch(/\/voucher\/chequeReturn$/);
    expect(mockPost.mock.calls[0][1]).toMatchObject({ voucherId: 41, fiscalYearId: 7 });
    expect(mockNotify).toHaveBeenCalledWith('Success', 'Cheque returned - SNS-CR-1/27', 'green');
  });

  test("a refusal is shown, and the dialog stays", async () => {
    mockGet.mockResolvedValue({ data: { result: voucher } });
    mockPost.mockRejectedValue({ response: { data: { result: 'This cheque was already returned - SNS-CR-1/27.' } } });
    const onDone = jest.fn();
    render(<ChequeReturn open voucherId={41} onClose={() => {}} onDone={onDone} />);
    fireEvent.click(await screen.findByText('Approve & Save'));
    await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('Error', 'This cheque was already returned - SNS-CR-1/27.', 'red'));
    expect(onDone).not.toHaveBeenCalled();
  });
});
