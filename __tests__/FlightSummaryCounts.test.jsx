/**
 * Flight Counts renders EVERY aircraft the server sent.
 *
 * Written after a report showed six flights in its headline and a single
 * aircraft row beneath it - the five A330 flights, and with them the only PLA
 * figure in the period, were missing from the table while the totals row
 * counted them. The server was returning both groups; the loss was on this
 * side, so this test renders the real component against the real payload
 * shape and asserts what reaches the DOM.
 *
 * The value is not the assertion on two rows. It is that this fails loudly if
 * anything ever again drops a group between the response and the table, which
 * is invisible from the headline figures - they are built from `totals` and
 * stay right while the rows go wrong.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

// The screen reads the selected company off the store and nothing else.
jest.mock('react-redux', () => ({ useSelector: () => '1' }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('Components/Shared/PageActions', () => ({ usePageActions: () => {} }));

const getFlightSummary = jest.fn();
jest.mock('apis/aviationJobs', () => ({
  getFlightSummary: (...a) => getFlightSummary(...a),
  getCarriers: () => Promise.resolve({ status: 'success', result: [] }),
  getAircraft: () => Promise.resolve({ status: 'success', result: [] }),
  getAviationValues: () => Promise.resolve({ status: 'success', result: {} }),
}));

import FlightSummary from 'Components/Layouts/Reports/FlightSummary';

/* Exactly what /aviationJob/flightSummary returns for the local September
 * data: five A330 flights carrying the period's only PLA, and one B737. */
const PAYLOAD = {
  status: 'success',
  result: {
    from: '2026-09-01',
    to: '2026-09-30',
    labels: { gam: 'GAM', ifa: 'IFA', other: 'Other' },
    rows: [],
    byAircraft: [
      { aircraft: 'A330', ttlFlt: 5, opFlt: 5, xxld: 0, notOp: 0, totalUplift: 4300, pla: 1250, plaVaries: false, plaFrom: 1 },
      { aircraft: 'B737', ttlFlt: 1, opFlt: 1, xxld: 0, notOp: 0, totalUplift: 1000, pla: null, plaVaries: false, plaFrom: 0 },
    ],
    totals: {
      flights: 6, xxld: 0, notOp: 0, pfm: 0, manifest: 6100,
      uplift: { GAM: 0, IFA: 0, Other: 0, untagged: 5300 },
      offload: { GAM: 0, IFA: 0, Other: 0, untagged: 1000 },
      totalUplift: 5300, totalOffload: 1000,
    },
  },
};

beforeEach(() => {
  getFlightSummary.mockReset();
  getFlightSummary.mockResolvedValue(PAYLOAD);
  // The Columns picker remembers hidden columns per browser; a stored choice
  // must not be able to change what this test sees.
  try { window.localStorage.clear(); } catch (_) { /* jsdom without storage */ }
});

const showCounts = async () => {
  render(<FlightSummary />);
  await waitFor(() => expect(getFlightSummary).toHaveBeenCalled());
  // Per Flight is the default view; Flight Counts is the one under test.
  const toggle = await screen.findByText('Flight Counts');
  toggle.click();
};

describe('the Flight Counts table', () => {
  test('renders a row for every aircraft the server sent', async () => {
    await showCounts();
    await waitFor(() => expect(screen.getByText('B737')).toBeInTheDocument());
    // The row that went missing, and with it the period's only PLA.
    expect(screen.getByText('A330')).toBeInTheDocument();
  });

  test('the rows account for the flights the totals row claims', async () => {
    await showCounts();
    await waitFor(() => expect(screen.getByText('B737')).toBeInTheDocument());

    const a330 = screen.getByText('A330').closest('tr');
    const b737 = screen.getByText('B737').closest('tr');
    // 5 + 1 = the 6 in the headline. A table whose rows do not add up to its
    // own footer is the exact symptom this was reported as.
    // TTL FLT is the third cell of the row.
    expect(within(a330).getAllByRole('cell')[2]).toHaveTextContent('5');
    expect(within(b737).getAllByRole('cell')[2]).toHaveTextContent('1');
  });

  test("the aircraft that has a PLA shows it, and the one that has none shows a dash", async () => {
    await showCounts();
    await waitFor(() => expect(screen.getByText('B737')).toBeInTheDocument());

    const a330 = screen.getByText('A330').closest('tr');
    // Thousands-separated, and to no decimals - nobody plans a payload to a
    // hundredth of a kilo. See `dp` on the column.
    expect(within(a330).getAllByRole('cell')[1]).toHaveTextContent('1,250');

    const b737 = screen.getByText('B737').closest('tr');
    // A dash, not 0: nobody typed one, which is not "no payload".
    expect(within(b737).getAllByRole('cell')[1]).toHaveTextContent('—');
  });
});
