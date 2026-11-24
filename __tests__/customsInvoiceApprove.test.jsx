/**
 * "Invoice & approve" on the customs charge sheet (CustomsJobs/Charges) - the
 * ticked charges raised already approved, for whoever may approve invoices
 * (the user's request, 2026-10-15). "Invoice N charge(s)" still raises them
 * unapproved.
 */
import React from 'react';
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
// eslint-disable-next-line import/first
import { jobDocRights } from 'functions/jobDocRights';

// A user's rights, as the grid would give them - functions/jobDocRights.
const rightsOf = (...perms) => jobDocRights((m, a) => perms.includes(`${m}:${a}`));
const EVERYTHING = jobDocRights(() => true);

const charge = {
  id: 41, type: 'Recievable', charge: 7, particular: 'SERVICE CHARGES', description: 'SERVICE CHARGES',
  basis: 'Per Shipment', qty: 1, rate_charge: 5000, currency: 'PKR', ex_rate: 1, net_amount: 5000, local_amount: 5000,
  status: '1', partyId: 3, name: 'CLIENT', InvoiceId: null,
};
const values = { charge: [{ id: 7, code: 'SRV', short: 'SERVICE CHARGES', name: 'SERVICE CHARGES' }], party: [{ id: 3, name: 'CLIENT' }] };

const sheet = async (onInvoice, rights = EVERYTHING, { disabled = false, charges = [charge], setCharges = () => {} } = {}) => {
  await act(async () => {
    render(<Charges job={{ id: 9, clientId: 3 }} jobId={9} charges={charges} setCharges={setCharges} values={values}
      disabled={disabled} rights={rights} onInvoice={onInvoice} invoicing={false} onInvoiceApproval={() => {}} approvingInvoices={false} />);
  });
  const tick = document.querySelector('tbody input[type="checkbox"]');
  await act(async () => { fireEvent.click(tick); });
};

test('Invoice & approve raises the ticked charges approved', async () => {
  const onInvoice = jest.fn();
  await sheet(onInvoice);
  fireEvent.click(screen.getByText('Invoice & approve 1'));
  expect(onInvoice).toHaveBeenCalledWith([41], expect.any(Function), { approve: true, approveChargeIds: [] });
});

test('Invoice N charge(s) still raises them for approval', async () => {
  const onInvoice = jest.fn();
  await sheet(onInvoice);
  fireEvent.click(screen.getByText('Invoice 1 charge(s)'));
  expect(onInvoice).toHaveBeenCalledWith([41], expect.any(Function), { approve: false, approveChargeIds: [] });
});

test('not offered to someone who cannot approve invoices', async () => {
  await sheet(jest.fn(), rightsOf('jobCharges:view', 'jobCharges:edit', 'jobInvoices:view', 'jobInvoices:raise'));
  expect(screen.queryByText(/Invoice & approve/)).toBeNull();
});

/* Charges and the invoices raised from them, apart (the user's request,
   2026-10-20): someone may raise invoices without approving them, or enter
   charges without raising them. */
test('raising without approving: Invoice is there, and raises them for approval', async () => {
  const onInvoice = jest.fn();
  await sheet(onInvoice, rightsOf('jobCharges:view', 'jobCharges:edit', 'jobInvoices:view', 'jobInvoices:raise'));
  fireEvent.click(screen.getByText('Invoice 1 charge(s)'));
  expect(onInvoice).toHaveBeenCalledWith([41], expect.any(Function), { approve: false, approveChargeIds: [] });
});

test('raising without being able to change the charges', async () => {
  const onInvoice = jest.fn();
  await sheet(onInvoice, rightsOf('jobCharges:view', 'jobInvoices:view', 'jobInvoices:raise'), { disabled: true });
  fireEvent.click(screen.getByText('Invoice 1 charge(s)'));
  expect(onInvoice).toHaveBeenCalled();
});

test('no Raise right, no Invoice button', async () => {
  await sheet(jest.fn(), rightsOf('jobCharges:view', 'jobCharges:edit', 'jobInvoices:view'));
  expect(screen.queryByText(/Invoice 1 charge/)).toBeNull();
  expect(screen.queryByText(/Invoice & approve/)).toBeNull();
});

test('approving a charge needs the charges’ Approve right', async () => {
  // A payable: nothing waits for the vessel, so only the right decides.
  const pending = { ...charge, id: 42, type: 'Payble', status: '0' };
  const setCharges = jest.fn();
  await sheet(jest.fn(), rightsOf('jobCharges:view', 'jobCharges:edit'), { charges: [pending], setCharges });
  fireEvent.click(screen.getByText('Pending'));
  expect(setCharges).not.toHaveBeenCalled();
  expect(screen.queryByText(/Approve all/)).toBeNull();
});

test('and with it, the same click approves', async () => {
  const pending = { ...charge, id: 42, type: 'Payble', status: '0' };
  const setCharges = jest.fn();
  await sheet(jest.fn(), rightsOf('jobCharges:view', 'jobCharges:edit', 'jobCharges:approve'), { charges: [pending], setCharges });
  fireEvent.click(screen.getByText('Pending'));
  expect(setCharges).toHaveBeenCalled();
});

/* APPROVED AS INVOICED (the user, 2026-11-11: create, save, approve, save,
   invoice was too many steps). A ticked line not yet approved goes on the
   invoice, approved on the way - when the Approve tag would approve it. */
describe('invoicing a charge not yet approved', () => {
  // A payable, so the job's status does not come into it; then a receivable.
  const pendingPay = { ...charge, id: 43, type: 'Payble', status: '0' };
  const pendingRec = { ...charge, id: 44, status: '0' };

  test('both buttons take it, and ask for it to be approved', async () => {
    const onInvoice = jest.fn();
    await sheet(onInvoice, EVERYTHING, { charges: [pendingPay] });
    expect(screen.getByText(/1 not yet approved - approved as they are invoiced/)).toBeTruthy();
    fireEvent.click(screen.getByText('Invoice 1 charge(s)'));
    expect(onInvoice).toHaveBeenCalledWith([43], expect.any(Function), { approve: false, approveChargeIds: [43] });
    fireEvent.click(screen.getByText('Invoice & approve 1'));
    expect(onInvoice).toHaveBeenLastCalledWith([43], expect.any(Function), { approve: true, approveChargeIds: [43] });
  });

  test('not for someone who may not approve charges - it waits, as before', async () => {
    const onInvoice = jest.fn();
    await sheet(onInvoice, rightsOf('jobCharges:view', 'jobCharges:edit', 'jobInvoices:view', 'jobInvoices:raise'),
      { charges: [pendingPay] });
    expect(screen.getByText('Invoice selected').closest('button').disabled).toBe(true);
    expect(screen.getByText(/waiting for someone to approve them/)).toBeTruthy();
  });

  test('not a receivable before the job is at a billable status - and says why', async () => {
    const onInvoice = jest.fn();
    await sheet(onInvoice, EVERYTHING, { charges: [pendingPay, pendingRec] });
    // Each row's own tick is its first cell. sheet() ticked the first row -
    // the receivable, as Receivable comes first; tick the payable's too.
    const rowTicks = [...document.querySelectorAll('tbody tr')]
      .map((tr) => tr.querySelector('td:first-child input[type="checkbox"]')).filter(Boolean);
    expect(rowTicks).toHaveLength(2);
    await act(async () => { fireEvent.click(rowTicks[1]); });
    fireEvent.click(screen.getByText('Invoice 1 charge(s)'));
    expect(onInvoice).toHaveBeenCalledWith([43], expect.any(Function), { approve: false, approveChargeIds: [43] });
    expect(screen.getByText(/1 ticked charge\(s\) left out: a receivable is approved once the job is/)).toBeTruthy();
  });

  test('on a job at a billable status, the receivable goes too', async () => {
    const onInvoice = jest.fn();
    await act(async () => {
      render(<Charges job={{ id: 9, clientId: 3, status: 'Complete' }} jobId={9} charges={[pendingRec]} setCharges={() => {}}
        values={values} disabled={false} rights={EVERYTHING} onInvoice={onInvoice} invoicing={false}
        onInvoiceApproval={() => {}} approvingInvoices={false} />);
    });
    await act(async () => { fireEvent.click(document.querySelector('tbody input[type="checkbox"]')); });
    fireEvent.click(screen.getByText('Invoice 1 charge(s)'));
    expect(onInvoice).toHaveBeenCalledWith([44], expect.any(Function), { approve: false, approveChargeIds: [44] });
  });
});
