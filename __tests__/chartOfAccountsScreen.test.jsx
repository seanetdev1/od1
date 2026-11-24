/**
 * The chart of accounts screen (2026-11-15 redesign): a table of rows, groups
 * opened by clicking them, open groups that SURVIVE the chart being reloaded
 * (after any create, edit or delete they all used to shut), and the actions
 * each row offers.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));
jest.mock('functions/adminDesignation', () => ({ isAdminDesignation: () => false }));
// The form is its own screen; here it only has to open.
jest.mock('Components/Layouts/AccountsComp/ChartOFAccount/CreateOrEdit', () => function Form() { return <div>Account form</div>; });

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || function scrollIntoView() {};
});

const ChartOFAccount = require('Components/Layouts/AccountsComp/ChartOFAccount').default;

const chart = (extra = []) => ({
  status: 'success',
  result: [
    {
      id: 1, title: 'ASSETS', code: '1', editable: '0', subCategory: 'General',
      children: [
        {
          id: 12, title: 'CURRENT ASSETS', code: '12', editable: '0', ChildAccountId: 1, subCategory: 'General',
          children: [
            { id: 121, title: 'HBL', code: '1201', editable: '0', ChildAccountId: 12, subCategory: 'Bank', children: [] },
            { id: 122, title: 'PETTY CASH', code: '1202', editable: '1', ChildAccountId: 12, subCategory: 'Cash', children: [] },
            ...extra,
          ],
        },
      ],
    },
    { id: 2, title: 'EXPENSE', code: '2', editable: '0', subCategory: 'General', children: [] },
  ],
});

const row = (title) => screen.getByText(title).closest('.coa-row');

test('top level only at first: codes in their own column, a group shows its count', () => {
  render(<ChartOFAccount accountsData={chart()} />);
  expect(screen.getByText('ASSETS')).toBeInTheDocument();
  expect(screen.queryByText('CURRENT ASSETS')).not.toBeInTheDocument();
  expect(row('ASSETS').querySelector('.coa-code')).toHaveTextContent('1');
  expect(row('ASSETS').querySelector('.coa-count')).toHaveTextContent('1');
  expect(row('ASSETS')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('5 accounts')).toBeInTheDocument();
});

test('clicking a group opens it; clicking again shuts it', () => {
  render(<ChartOFAccount accountsData={chart()} />);
  fireEvent.click(row('ASSETS'));
  expect(row('ASSETS')).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(row('CURRENT ASSETS'));
  expect(screen.getByText('HBL')).toBeInTheDocument();
  expect(row('HBL').querySelector('.dl-badge')).toHaveTextContent('Bank');
  fireEvent.click(row('ASSETS'));
  expect(screen.queryByText('CURRENT ASSETS')).not.toBeInTheDocument();
});

test('open groups stay open when the chart is reloaded - as it is after every save', () => {
  const { rerender } = render(<ChartOFAccount accountsData={chart()} />);
  fireEvent.click(row('ASSETS'));
  fireEvent.click(row('CURRENT ASSETS'));
  rerender(<ChartOFAccount accountsData={chart([{ id: 123, title: 'MEEZAN', code: '1203', editable: '0', ChildAccountId: 12, subCategory: 'Bank', children: [] }])} />);
  expect(screen.getByText('MEEZAN')).toBeInTheDocument();
  expect(screen.getByText('HBL')).toBeInTheDocument();
});

test('Collapse all shuts every group', () => {
  render(<ChartOFAccount accountsData={chart()} />);
  const collapse = screen.getByText('Collapse all').closest('button');
  expect(collapse).toBeDisabled();
  fireEvent.click(row('ASSETS'));
  fireEvent.click(row('CURRENT ASSETS'));
  fireEvent.click(collapse);
  expect(screen.queryByText('CURRENT ASSETS')).not.toBeInTheDocument();
});

test('a leaf offers delete, a group does not; the pencil follows the editable flag', () => {
  render(<ChartOFAccount accountsData={chart()} />);
  fireEvent.click(row('ASSETS'));
  fireEvent.click(row('CURRENT ASSETS'));
  expect(row('HBL').querySelector('[title="Delete HBL"]')).toBeInTheDocument();
  expect(row('HBL').querySelector('[title="Edit HBL"]')).toBeInTheDocument();
  expect(row('CURRENT ASSETS').querySelector('[title^="Delete"]')).not.toBeInTheDocument();
  // A standard account (editable '1') - not offered to a non-admin.
  expect(row('PETTY CASH').querySelector('[title^="Edit"]')).not.toBeInTheDocument();
});

test('the pencil opens the form without opening or shutting the group', () => {
  render(<ChartOFAccount accountsData={chart()} />);
  fireEvent.click(row('ASSETS'));
  fireEvent.click(row('CURRENT ASSETS').querySelector('[title="Edit CURRENT ASSETS"]'));
  expect(row('CURRENT ASSETS')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Account form')).toBeInTheDocument();
});

test('the keyboard opens a group too', () => {
  render(<ChartOFAccount accountsData={chart()} />);
  fireEvent.keyDown(row('ASSETS'), { key: 'Enter' });
  expect(screen.getByText('CURRENT ASSETS')).toBeInTheDocument();
});
