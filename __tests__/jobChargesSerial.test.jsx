/**
 * The job's Charges tab (ChargesComp/Charges): a Sr. number on each charge,
 * counted on the side shown - receivable or payable - and a table taller than
 * the 300px it was (the user, 2026-11-02).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';

jest.mock('../Components/Layouts/JobsLayout/Jobs/states', () => ({
  getVendors: jest.fn(), getClients: jest.fn(), saveHeads: jest.fn(), calculateChargeHeadsTotal: jest.fn(() => ({})),
  makeInvoice: jest.fn(), getHeadsNew: jest.fn(), approveHeads: jest.fn(), autoInvoice: jest.fn(),
}));
jest.mock('Components/Shared/Form//SelectSearchComp', () => () => null);
jest.mock('Components/Shared/Form/SelectSearchComp', () => () => null);
jest.mock('Components/Shared/Form/InputNumComp', () => () => null);
jest.mock('Components/Shared/Form/SelectComp', () => () => null);
jest.mock('../Components/Shared/Form/InputNumberComp', () => () => null);
jest.mock('../Components/Layouts/JobsLayout/Jobs/ChargesComp/PartySearch', () => () => null);
jest.mock('Components/Shared/AuditStamp', () => ({ AuditTip: () => null }));
jest.mock('Components/Shared/Notification', () => jest.fn());

// eslint-disable-next-line import/first
import ChargesList from '../Components/Layouts/JobsLayout/Jobs/ChargesComp/Charges';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const line = (id, type) => ({
  id, type, charge: 'OCF', particular: `Line ${id}`, partyId: 1, name: 'ABC', currency: 'PKR',
  amount: 1, rate_charge: 100, discount: 0, tax_apply: false, taxPerc: 0, tax_amount: 0, net_amount: 100,
  ex_rate: 1, local_amount: 100, status: '0', invoice_id: null, Invoice: null, pp_cc: 'PP', basis: 'Per Unit', qty: 1,
});
const list = [line(1, 'Recievable'), line(2, 'Payble'), line(3, 'Recievable'), line(4, 'Recievable')];

const Harness = ({ type }) => {
  const { control, register, reset, setValue } = useForm({ defaultValues: { chargeList: list } });
  const { fields, append, remove } = useFieldArray({ control, name: 'chargeList', keyName: 'key_id' });
  const chargeList = useWatch({ control, name: 'chargeList' });
  const state = {
    permissions: {}, selection: { partyId: null }, deleteList: [], chargeLoad: false, exRate: 1, exRateBuying: 1,
    headVisible: false, fields: { chargeList: [] }, equipments: [], selectedRecord: { id: 1 }, chargesTab: '1',
  };
  return <ChargesList state={state} dispatch={jest.fn()} type={type} append={append} reset={reset} fields={fields}
    chargeList={chargeList} remove={remove} control={control} setValue={setValue} register={register} companyId='1'
    operationType='SE' allValues={{ approved: [] }} chargesLoading={false} readOnly />;
};

const serials = () => [...document.querySelectorAll('tbody tr')].map((tr) => tr.children[1]?.textContent);

test('each charge has a Sr. number, counted on the side shown', () => {
  render(<Harness type='Recievable' />);
  expect(screen.getByText('Sr.')).toBeTruthy();
  expect(serials()).toEqual(['1', '2', '3']);
});

test('the payable side counts from 1 as well', () => {
  render(<Harness type='Payble' />);
  expect(serials()).toEqual(['1']);
});

// 100vh - 320px ran the table into the buttons under it and, past the tab's
// fixed box, over the Receivable / Payable totals (a user's screenshot,
// 2026-11-04). It ends with room left for the buttons now.
test('the table is as tall as the window allows, never less than it was, leaving the buttons room', () => {
  render(<Harness type='Recievable' />);
  const box = document.querySelector('table').closest('.table-sm-1');
  expect(box.style.maxHeight).toBe('max(300px, calc(100vh - 400px))');
});

test('the floated buttons are cleared, so what follows the tab starts below them', () => {
  const { container } = render(<Harness type='Recievable' />);
  const last = container.lastElementChild;
  expect(last.className).toBe('charges-buttons-end');
  expect(last.style.clear).toBe('both');
});
