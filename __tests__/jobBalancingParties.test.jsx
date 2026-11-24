/**
 * Job Balancing's Party Specific picker offers each party once.
 *
 * Its list is joined from the role lists /seaJob/getValues sends - client
 * (every active party), local vendor, air line, CHA/CHB, forwarder, shipping
 * line, transporter - and a party is in one for each role it has. OOCL
 * PAKISTAN, a forwarder and a local vendor, came up three times when searched.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import JobBalancing from '../Components/Layouts/Reports/JobBalancing';
import { uniqueGlParties } from '../functions/glParties';

const party = (id, name, types, nongl = '0') => ({ id, name, types, nongl });
const OOCL = party(217, 'OOCL PAKISTAN (PVT.) LTD. (217)', 'Forwarder/Coloader, Local Vendor');
const MAERSK = party(301, 'MAERSK LINE (301)', 'Shipping Line, Local Vendor');
const ZIA = party(2013, 'ZIA OOCL LOG (12010316)', 'Shipper, Consignee', '1');
const values = {
  party: { client: [OOCL, MAERSK, ZIA] },
  vendor: { localVendor: [OOCL, MAERSK], forwarder: [OOCL], sLine: [MAERSK], airLine: [], chaChb: [], transporter: [], overseasAgent: [] },
};

jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { result: mockValues() }, status: 'success' }) }));
// eslint-disable-next-line no-use-before-define
const mockValues = () => values;
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: (f) => f({ filterValues: [] }) }));
jest.mock('apis/jobs', () => ({ getJobValues: jest.fn() }));
jest.mock('next/router', () => ({ push: jest.fn() }));

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

describe('the parties a report picker offers', () => {
  test('each once, in the order of the first list it is in', () => {
    expect(uniqueGlParties(values.party.client, values.vendor.localVendor, values.vendor.forwarder, values.vendor.sLine).map((p) => p.id))
      .toEqual([217, 301]);
  });

  test('a party only in a later list is still offered; a non-GL one never is', () => {
    const vendorOnly = party(9, 'ONLY A VENDOR (9)', 'Local Vendor');
    expect(uniqueGlParties([OOCL, ZIA], [vendorOnly, OOCL]).map((p) => p.id)).toEqual([217, 9]);
  });

  test('ids that differ only as text and number are one party; missing lists are none', () => {
    expect(uniqueGlParties([OOCL], [{ ...OOCL, id: '217' }], undefined, null)).toHaveLength(1);
  });
});

test('searching OOCL in Party Specific finds it once', async () => {
  const { container } = render(<JobBalancing />);
  const picker = [...container.querySelectorAll('label')].find((l) => l.textContent === 'Party Specific').nextElementSibling;
  await act(async () => { fireEvent.mouseDown(picker.querySelector('.ant-select-selector')); });
  await act(async () => { fireEvent.change(picker.querySelector('input'), { target: { value: 'OOCL' } }); });
  const offered = [...document.querySelectorAll('.ant-select-item-option')].map((o) => o.textContent);
  expect(offered).toEqual(['OOCL PAKISTAN (PVT.) LTD. (217)']);
});
