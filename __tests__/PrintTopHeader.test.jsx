/**
 * The letterhead on printed reports - Components/Shared/PrintTopHeader.
 * "All companies" prints the company selected in the HEADER. It printed a
 * blank letterhead for 'all' (no name, logo or address) and every company's
 * name run together for none.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import Cookies from 'js-cookie';
import { store } from 'redux/store';
import PrintTopHeader from '../Components/Shared/PrintTopHeader';

jest.mock('js-cookie', () => ({ get: jest.fn() }));
jest.mock('redux/store', () => ({ store: { getState: jest.fn() } }));

const COMPANIES = [
  { id: 1, title: 'SEA NET SHIPPING & LOGISTICS', address: 'Plot 7, Karachi', printLogo: 'data:image/png;base64,SNS' },
  { id: 2, title: 'AIR CARGO SERVICES (PVT) LIMITED', address: 'Plot A-230, PECHS, Karachi', printLogo: 'data:image/png;base64,ACS' },
];

beforeEach(() => {
  store.getState.mockReturnValue({ company: { companies: COMPANIES } });
  Cookies.get.mockReturnValue('2');      // the header has Air Cargo selected
});

test('"All companies" prints the header company\'s name, address and logo', () => {
  render(<PrintTopHeader company='all' from='01-07-2026' to='30-09-2026' />);
  expect(screen.getByText('AIR CARGO SERVICES (PVT) LIMITED')).toBeTruthy();
  expect(screen.getByText('Plot A-230, PECHS, Karachi')).toBeTruthy();
  expect(document.querySelector('img').getAttribute('src')).toContain('ACS');
  expect(screen.queryByText(/SEA NET/)).toBeNull();
});

test('no company at all is treated the same', () => {
  render(<PrintTopHeader company='' />);
  expect(screen.getByText('AIR CARGO SERVICES (PVT) LIMITED')).toBeTruthy();
});

test('a picked company prints itself, whatever the header says', () => {
  render(<PrintTopHeader company='1' />);
  expect(screen.getByText('SEA NET SHIPPING & LOGISTICS')).toBeTruthy();
  expect(screen.getByText('Plot 7, Karachi')).toBeTruthy();
});
