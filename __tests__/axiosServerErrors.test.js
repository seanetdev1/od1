/**
 * A server failure (5xx) is never silent - apis/axiosClient says "Something
 * went wrong" whatever the call site does - unless the call says it reports
 * the failure itself (`ownErrors`), as the invoice-template file requests do.
 */
const mockError = jest.fn();
jest.mock('antd', () => ({ notification: { error: (...a) => mockError(...a), warning: jest.fn() } }));
jest.mock('functions/logout', () => jest.fn());

const axiosClient = require('apis/axiosClient').default;
const logout = require('functions/logout');

// The response interceptor's failure handler, as axios would call it.
const fail = (status, config = {}) => axiosClient.interceptors.response.handlers[0]
  .rejected({ response: { status, data: { result: 'Broke.' } }, config })
  .catch(() => 'rejected');

beforeEach(() => mockError.mockClear());

test('a 5xx is said, and still rejects to the caller', async () => {
  expect(await fail(500)).toBe('rejected');
  expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Something went wrong', description: 'Broke.' }));
});

test('...unless the call reports its own failure', async () => {
  expect(await fail(503, { ownErrors: true })).toBe('rejected');
  expect(mockError).not.toHaveBeenCalled();
});

/* A file request (responseType 'blob') gets its JSON reply as a Blob. It is
 * read first, so it is handled as any other reply - the user's 10-29 "The
 * invoice could not be printed from its template." was a session ended by a
 * login elsewhere, which never took them back to log in. */
const jsonBlob = (body) => new Blob([JSON.stringify(body)], { type: 'application/json; charset=utf-8' });
const failWith = (status, data, config = {}) => {
  const error = { response: { status, data }, config };
  return axiosClient.interceptors.response.handlers[0].rejected(error).catch((e) => e);
};

test('a file request\'s server failure is said in the server\'s words', async () => {
  await failWith(500, jsonBlob({ status: 'error', result: 'LibreOffice could not convert the invoice.' }));
  expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ description: 'LibreOffice could not convert the invoice.' }));
});

test('a file request\'s "logged in elsewhere" ends the session, and the caller gets the reply read', async () => {
  const e = await failWith(401, jsonBlob({ isLoggedIn: false, message: 'User logged in elsewhere' }), { ownErrors: true });
  expect(e.response.data).toEqual({ isLoggedIn: false, message: 'User logged in elsewhere' });
  expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Session ended' }));
  expect(logout).toHaveBeenCalled();
});

test('a file that is not JSON is left as it came', async () => {
  const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
  const e = await failWith(404, pdf);
  expect(e.response.data).toBe(pdf);
});
