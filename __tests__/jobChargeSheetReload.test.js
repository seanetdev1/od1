/* THE FREIGHT CHARGE SHEET RELOADS AFTER THE BILL IS APPROVED, NOT BEFORE -
 * Components/Layouts/JobsLayout/Jobs/states.js.
 *
 * ACS-AE-728/27 (SNS, 2026-11-13): the reload half a second after raising
 * ACS-JB-818/27 beat its approval, the sheet showed the bill unapproved, and
 * its lines could be removed - the cost then counted twice in Job P&L. */
jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('apis/queryClient', () => ({ setQueryData: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('functions/delay', () => ({ delay: () => Promise.resolve() }));
jest.mock('functions/myPermissions', () => ({ canNow: () => true }));
jest.mock('functions/jobDocRights', () => ({ jobDocRights: () => ({ approveInvoices: true }) }));
jest.mock('Components/Shared/Notification', () => jest.fn());

/* eslint-disable import/first */
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { makeInvoice, saveHeads, getHeadsNew } from '../Components/Layouts/JobsLayout/Jobs/states';
/* eslint-enable import/first */

const order = [];
let finishApproval;

beforeEach(() => {
  order.length = 0;
  jest.clearAllMocks();
  axiosClient.post.mockImplementation((url) => {
    if (String(url).endsWith('/invoice/approve')) {
      order.push('approve sent');
      return new Promise((resolve) => {
        finishApproval = () => { order.push('approved'); resolve({ data: { status: 'success' } }); };
      });
    }
    order.push(`post ${url}`);
    return Promise.resolve({ data: { status: 'success', result: { newInv: { id: 43955 } } } });
  });
  axiosClient.get.mockImplementation(() => {
    order.push('sheet reloaded');
    return Promise.resolve({ data: { status: 'success', result: [] } });
  });
});

const state = { selectedRecord: { id: 14845 }, deleteList: [], exRate: '1' };

test('raising a bill: the sheet reloads only once its approval is done', async () => {
  const done = makeInvoice([{ id: 1, type: 'Payble' }], 3, jest.fn(), 'AE', jest.fn(), state, jest.fn());
  await new Promise((r) => setTimeout(r, 0));
  expect(order).toContain('approve sent');
  expect(order).not.toContain('sheet reloaded');
  finishApproval();
  await done;
  expect(order.indexOf('approved')).toBeLessThan(order.indexOf('sheet reloaded'));
});

test("a save's warning is shown, not dropped", async () => {
  axiosClient.post.mockResolvedValueOnce({ data: { status: 'success', warning: 'ACS-JB-818/27 is approved, so the changes to its line were not saved.' } });
  await saveHeads([], state, jest.fn(), jest.fn());
  expect(openNotification).toHaveBeenCalledWith('Note', expect.stringMatching(/is approved/), 'orange', 10);
});

test('a reload clears removals still waiting for a save', async () => {
  const dispatch = jest.fn();
  await getHeadsNew(14845, dispatch, jest.fn());
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ deleteList: [] }) }));
});
