/**
 * describeSaveError - what a failed save tells the person who pressed Save.
 *
 * Ported from the live freight install, with one difference pinned here: our
 * routes answer a refused save with a 500 and the reason in `result` (the
 * fiscal-year guard included), where that install answered 200. Showing the
 * generic "server could not complete the save" for every 500 would hide the
 * one message that says what to do.
 */
import { describeSaveError } from '../functions/saveErrorMessage';

const axiosError = (status, data) => ({ response: { status, data } });

describe('describeSaveError', () => {
  test('a backend message written for users is shown as written', () => {
    expect(describeSaveError('Fiscal year 2025-26 is locked.')).toBe('Fiscal year 2025-26 is locked.');
  });

  test('raw database text is translated into what to fix', () => {
    expect(describeSaveError('invalid input syntax for type integer: ""'))
      .toMatch(/number or dropdown field was left blank/);
    expect(describeSaveError('null value in column "jobNo" violates not-null constraint'))
      .toBe('"jobNo" is required but was left empty. Fill it in and save again.');
  });

  test('a 500 that carries a reason shows the reason', () => {
    const err = axiosError(500, { status: 'error', result: 'Fiscal year 2025-26 is locked.' });
    expect(describeSaveError(err)).toBe('Fiscal year 2025-26 is locked.');
  });

  test('a 500 with nothing to say gets the generic message', () => {
    expect(describeSaveError(axiosError(500, {}))).toMatch(/server could not complete the save/);
  });

  test('no response at all is a connection problem, not the form', () => {
    expect(describeSaveError(new Error('Network Error'))).toMatch(/Could not reach the server/);
  });

  test('the licence read-only lock and an expired session say so', () => {
    expect(describeSaveError(axiosError(423, {}))).toMatch(/read-only/);
    expect(describeSaveError(axiosError(401, {}))).toMatch(/session has expired/);
  });

  test('falls back to the caller\'s wording when there is nothing to go on', () => {
    expect(describeSaveError(null, 'Could not register.')).toBe('Could not register.');
  });
});
