/**
 * The Loading Program tab's buttons and its letter - JobsLayout/Jobs/Loading
 * Program (LoadingForm, PrintComp).
 *
 *   - Save and Print sit together; Print prints (no popover with a second
 *     "Go"), and until the program is saved it says so instead.
 *   - The letter no longer names PICT whatever the terminal, and its
 *     destination is the port's full name, not its code.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LoadingForm from '../Components/Layouts/JobsLayout/Jobs/Loading Program/LoadingForm';
import PrintComp, { portFullName } from '../Components/Layouts/JobsLayout/Jobs/Loading Program/PrintComp';

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('functions/companyBranding', () => ({
  companyDetails: () => ({ title: 'SEA NET SHIPPING & LOGISTICS', address: 'Karachi', phone: '', email: '', web: '' }),
  companyLogo: () => null,
  currentCompanyId: () => 1,
}));
jest.mock('../Components/Layouts/JobsLayout/Jobs/Loading Program/Column1', () => function Column1() { return null; });
jest.mock('../Components/Layouts/JobsLayout/Jobs/Loading Program/Column2', () => function Column2() { return null; });
jest.mock('../Components/Layouts/JobsLayout/Jobs/Loading Program/Column3', () => function Column3() { return null; });

const state = {
  selectedRecord: {
    jobNo: 'SNS-SEJ-407/27', jobDate: '2026-10-05', pod: 'GBFXT', pcs: 70, pkgUnit: 'CARTONS',
    Voyage: { voyage: 'OB635R', VesselId: 1 },
  },
  fields: { vessel: [{ id: 1, name: 'MSC NAOMI' }], party: { shipper: [] }, vendor: { chaChb: [] }, commodity: [] },
};
const values = { berth: 'QICT', wharf: 'QFS', instruction: 'CARGO WILL BE DISCHARGED AT QFS' };

describe('the letter', () => {
  test('the destination is the port\'s full name and country', () => {
    expect(portFullName('GBFXT')).toBe('Felixstowe, United Kingdom');
    // A code the port list does not know prints as it is.
    expect(portFullName('ZZZZZ')).toBe('ZZZZZ');
    expect(portFullName(undefined)).toBe('');
  });

  test('prints it, and no PICT', () => {
    const { container } = render(<PrintComp allValues={values} state={state} />);
    expect(container.textContent).toContain('Felixstowe, United Kingdom');
    expect(container.textContent).not.toContain('GBFXT');
    expect(container.textContent).not.toContain('PICT');
    // Its line stays, empty, between the two others.
    const lines = [...container.querySelectorAll('p')].map((p) => p.textContent);
    const at = lines.indexOf('The Assistant Traffic Manager');
    expect(lines.slice(at, at + 3)).toEqual(['The Assistant Traffic Manager', ' ', 'Karachi']);
  });
});

describe('a job with things missing does not crash the tab', () => {
  // The letter is rendered (hidden) as soon as a saved program loads, and
  // Column1 always - so neither may throw on a job that lacks something.
  const { cutOff } = jest.requireActual('../Components/Layouts/JobsLayout/Jobs/Loading Program/Column1');

  test('no cut-off date or time is blank - it was .slice() on null', () => {
    expect(cutOff(null, 'DD-MM-YYYY')).toBe('');
    expect(cutOff(undefined, 'hh:mm A')).toBe('');
    expect(cutOff('', 'hh:mm A')).toBe('');
  });

  test('the cut-off time shows as a time, the date as the form\'s dates do', () => {
    const at = require('moment')('2026-10-06 16:00', 'YYYY-MM-DD HH:mm').toISOString();
    expect(cutOff(at, 'hh:mm A')).toBe('04:00 PM');
    expect(cutOff(at, 'DD-MM-YYYY')).toBe('06-10-2026');
  });

  test('the form\'s first column renders for a job with no cut-off at all', () => {
    const RealColumn1 = jest.requireActual('../Components/Layouts/JobsLayout/Jobs/Loading Program/Column1').default;
    const { useForm } = require('react-hook-form');
    const Harness = () => {
      const { register, control } = useForm();
      return <RealColumn1 register={register} control={control}
        state={{ selectedRecord: { jobNo: 'SNS-SEJ-1/27', cutOffDate: null, cutOffTime: null }, fields: {} }} />;
    };
    expect(() => render(<Harness />)).not.toThrow();
  });

  test('the letter, with no voyage, no lists, and a party not in its list', () => {
    const bare = { selectedRecord: { jobNo: 'SNS-SEJ-1/27', shipperId: 5, customAgentId: 9, commodityId: 3, Voyage: null }, fields: {} };
    expect(() => render(<PrintComp allValues={{}} state={bare} />)).not.toThrow();
  });

  test('a name is cut at its "(code)", and kept whole when it has none', () => {
    const withNames = {
      ...state,
      selectedRecord: { ...state.selectedRecord, shipperId: 1, customAgentId: 2 },
      fields: { ...state.fields, party: { shipper: [{ id: 1, name: 'H.A. RAUF & CO (0412)' }] }, vendor: { chaChb: [{ id: 2, name: 'CARGO LINKERS' }] } },
    };
    const { container } = render(<PrintComp allValues={values} state={withNames} />);
    expect(container.textContent).toContain('H.A. RAUF & CO');
    expect(container.textContent).not.toContain('(0412)');
    // It used to lose its last two letters: "CARGO LINKE".
    expect(container.textContent).toContain('CARGO LINKERS');
  });
});

describe('the buttons', () => {
  const setup = (allValues) => {
    const submit = jest.fn();
    const handleSubmit = jest.fn(() => submit);
    render(<LoadingForm handleSubmit={handleSubmit} onSubmit={jest.fn()} register={jest.fn()} control={{}}
      state={state} load={false} allValues={allValues} />);
    return { submit };
  };

  test('Save saves', () => {
    const { submit } = setup({ ...values });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(submit).toHaveBeenCalled();
  });

  test('Print waits for a save, and says so', () => {
    setup({ ...values });
    const print = screen.getByRole('button', { name: /print/i });
    expect(print.disabled).toBe(true);
    expect(print.title).toMatch(/save the loading program first/i);
  });

  test('once saved, Print is there to press - one button, no popover', () => {
    setup({ ...values, id: 12 });
    expect(screen.getByRole('button', { name: /print/i }).disabled).toBe(false);
    expect(screen.queryByText('Go')).toBeNull();
  });
});
