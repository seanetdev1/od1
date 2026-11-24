/**
 * One of each charge per side on a customs job's charge sheet (Configuration
 * > Direct Job, "One of each charge per job" - asked 2026-11-17). On, a charge
 * picked for a side that already has it is turned back on the line; the
 * server refuses the save as well (backend functions/jobChargeRepeats).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import openNotification from 'Components/Shared/Notification';
import { otherLineWithCharge } from '../functions/uniqueJobCharges';
import { sameId } from '../functions/chargeIds';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => null }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn(() => Promise.resolve({ data: { status: 'success', result: [] } })), post: jest.fn() }));
jest.mock('apis/customsJobs', () => ({ getCustomsChargeSummary: jest.fn(() => Promise.resolve({ status: 'success', result: null })) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
let oneOfEach = true;
jest.mock('functions/uniqueJobCharges', () => {
  const real = jest.requireActual('functions/uniqueJobCharges');
  return { ...real, useUniqueJobCharges: () => oneOfEach };
});
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

const WEBOC = { id: 12, code: 'WBT', short: 'WEBOC', name: 'WEBOC TOKEN', fullName: 'WEBOC TOKEN' };
const LABOUR = { id: 13, code: 'LAB', short: 'LABOUR', name: 'LABOUR', fullName: 'LABOUR' };
const values = { charge: [WEBOC, LABOUR], party: [] };
const PAY = 'Payble';
const REC = 'Recievable';
const line = (type, charge, key) => ({ key, type, charge, qty: 1, rate_charge: 0, currency: 'PKR', basis: 'Per Shipment' });

let shown;
const Sheet = ({ start }) => {
  const [charges, setCharges] = useState(start);
  shown = charges;
  return (
    <Charges job={{ jobNo: 'CL-CCJ-31/27', clientId: 3 }} jobId={31} charges={charges} setCharges={setCharges}
      values={values} disabled={false} onInvoice={() => {}} invoicing={false} onInvoiceApproval={() => {}}
      approvingInvoices={false} active />
  );
};

const typeCharge = (box, code) => {
  fireEvent.change(box, { target: { value: code } });
  fireEvent.blur(box);
};

beforeEach(() => { jest.clearAllMocks(); oneOfEach = true; });

describe('the line a charge is picked for', () => {
  test('a charge already on that side is turned back, saying so', async () => {
    await act(async () => { render(<Sheet start={[line(PAY, 12, 'a'), line(PAY, null, 'b')]} />); });
    const boxes = screen.getAllByPlaceholderText('Charge');
    typeCharge(boxes[1], 'WBT');
    expect(shown[1].charge).toBeNull();
    expect(openNotification).toHaveBeenCalledWith('Charge already on this job',
      expect.stringContaining('WEBOC TOKEN is already on the Payable side'), 'orange', 8);
  });

  test('the same charge on the other side is fine', async () => {
    await act(async () => { render(<Sheet start={[line(PAY, 12, 'a'), line(REC, null, 'b')]} />); });
    const boxes = screen.getAllByPlaceholderText('Charge');
    // Receivable is drawn first.
    const recBox = boxes.find((b) => b.closest('.is-rec'));
    typeCharge(recBox, 'WBT');
    expect(shown.find((c) => c.type === REC).charge).toBe(12);
    expect(openNotification).not.toHaveBeenCalledWith('Charge already on this job', expect.anything(), expect.anything(), expect.anything());
  });

  test('with the install switch off, a repeat goes on as it always did', async () => {
    oneOfEach = false;
    await act(async () => { render(<Sheet start={[line(PAY, 12, 'a'), line(PAY, null, 'b')]} />); });
    typeCharge(screen.getAllByPlaceholderText('Charge')[1], 'WBT');
    expect(shown[1].charge).toBe(12);
  });
});

describe('otherLineWithCharge', () => {
  const a = line(PAY, '12', 'a');
  const b = line(PAY, 13, 'b');
  const c = line(REC, 12, 'c');
  test('another line on the same side with the charge', () => {
    expect(otherLineWithCharge([a, b, c], b, 12, sameId)).toBe(a);
  });
  test('the other side does not count, nor the line itself', () => {
    expect(otherLineWithCharge([a, b, c], c, 13, sameId)).toBeNull();
    expect(otherLineWithCharge([a], a, 12, sameId)).toBeNull();
  });
  test('re-picking the charge a line already has is no change', () => {
    const twin = line(PAY, 12, 'd');
    expect(otherLineWithCharge([a, twin], twin, 12, sameId)).toBeNull();
  });
});
