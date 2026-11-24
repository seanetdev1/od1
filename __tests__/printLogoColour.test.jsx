/**
 * The company logo prints in its own colours.
 *
 * Every letterhead put the logo through `filter: invert(0.5)` (or the
 * `invert` class, 0.6). invert(0.5) turns EVERY pixel the same mid-grey, so
 * CargoLinkers' red logo printed - and saved to PDF - as a flat grey shape,
 * and the whole document read as black and white.
 */
import React from 'react';
import { render } from '@testing-library/react';
import Cookies from 'js-cookie';
import { store } from 'redux/store';
import PrintTopHeader from '../Components/Shared/PrintTopHeader';
import CompanyLetterhead from '../Components/Shared/CompanyLetterhead';

jest.mock('js-cookie', () => ({ get: jest.fn() }));
jest.mock('redux/store', () => ({ store: { getState: jest.fn() } }));

beforeEach(() => {
  store.getState.mockReturnValue({ company: { companies: [{ id: 1, title: 'CARGO LINKERS.', printLogo: 'data:image/png;base64,CL' }] } });
  Cookies.get.mockReturnValue('1');
});

const logo = () => document.querySelector('img');
const greyed = (img) => /invert|grayscale/.test(`${img.getAttribute('style') || ''} ${img.className || ''}`);

test('the report letterhead', () => {
  render(<PrintTopHeader company='1' />);
  expect(logo().getAttribute('src')).toContain('CL');
  expect(greyed(logo())).toBe(false);
});

test('the voucher, delivery order and direct job letterhead', () => {
  render(<CompanyLetterhead companyId={1} />);
  expect(logo().getAttribute('src')).toContain('CL');
  expect(greyed(logo())).toBe(false);
});
