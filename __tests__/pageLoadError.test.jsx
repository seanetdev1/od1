/**
 * A page whose data the server refuses shows WHY, not a bare 500 (the user's
 * report, 2026-10-24: Job Balancing's Go crashed with "500 Internal Server
 * Error" - the backend had answered 403 for the company picked).
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

const mockGet = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a) }));
jest.mock('cookies', () => jest.fn().mockImplementation(() => ({ get: () => 'token', set: jest.fn() })));
jest.mock('next/router', () => ({ back: jest.fn() }));
jest.mock('Components/Layouts/Reports/JobBalancing/JobBalancingReport', () => () => null);

import { ssrErrorProps } from 'functions/withAuthRedirect';
import PageLoadError from 'Components/Shared/PageLoadError';
import { getServerSideProps } from 'pages/reports/jobBalancing/[id]';

const refused = (status, result) => Object.assign(new Error('Request failed'), { response: { status, data: { status: 'error', result } } });

beforeEach(() => {
  mockGet.mockReset();
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test("the server's reason, as props - not a thrown error", () => {
  expect(ssrErrorProps(refused(403, 'You do not have access to that company.')))
    .toEqual({ props: { ssrError: { status: 403, message: 'You do not have access to that company.' } } });
  expect(ssrErrorProps(new Error('connect ECONNREFUSED')).props.ssrError).toEqual({ status: null, message: 'The server could not be reached - is it running?' });
  expect(ssrErrorProps(refused(500, { weird: true })).props.ssrError.message).toBe('The server answered 500.');
});

test("Job Balancing's report page: a refusal is shown, not a crash", async () => {
  mockGet.mockRejectedValue(refused(403, 'You can only see the companies you work in - pick one.'));
  const out = await getServerSideProps({ query: { company: 'all' }, req: {}, res: {} });
  expect(out).toEqual({ props: { ssrError: { status: 403, message: 'You can only see the companies you work in - pick one.' } } });
});

test('the panel says what was refused, and offers a way back', () => {
  render(<PageLoadError status={403} message='You do not have access to that company.' />);
  expect(screen.getByText('Not allowed')).toBeInTheDocument();
  expect(screen.getByText('You do not have access to that company.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Go back/ })).toBeInTheDocument();
});
