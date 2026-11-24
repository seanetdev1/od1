/**
 * The Program Book's status rule, as the screen has it - functions/
 * customsPlanStatus. THE SAME CASES as the server's tests/unit/
 * customsPlan.test.js: the screen decides which rows can be ticked for a move,
 * the server whether the move happens, and they must answer alike.
 */
import {
  PLAN_STATUSES, PLAN_STATES, statusOf, stateOf, moveRefusal,
} from '../functions/customsPlanStatus';

test('the sheet\'s Job Status, and Moved, which is not stored', () => {
  expect(PLAN_STATUSES).toEqual(['Pending', 'Confirmed', 'Cancelled']);
  expect(PLAN_STATES).toEqual(['Pending', 'Confirmed', 'Cancelled', 'Moved']);
});

test('blank reads as Pending; a moved plan reads as Moved whatever it says', () => {
  expect(statusOf({})).toBe('Pending');
  expect(statusOf({ status: '  ' })).toBe('Pending');
  expect(stateOf({ status: 'Confirmed' })).toBe('Confirmed');
  expect(stateOf({ status: 'Confirmed', CustomsJobId: 9 })).toBe('Moved');
});

test.each([
  [{ status: 'Confirmed' }, null],
  [{ status: 'Pending' }, 'it is Pending - set its Job Status to Confirmed first.'],
  [{}, 'it is Pending - set its Job Status to Confirmed first.'],
  [{ status: 'Cancelled' }, 'it is Cancelled - a closed plan is not moved.'],
  [{ status: 'Confirmed', CustomsJobId: 4 }, 'it is already on the jobs list.'],
  [null, 'That plan no longer exists.'],
])('moveRefusal(%j)', (plan, why) => {
  expect(moveRefusal(plan)).toBe(why);
});

describe('with the statuses Configuration > Customs sets - the server\'s cases', () => {
  const list = [
    { value: 'Pending', label: 'Awaiting Client', color: 'gold', rules: ['shown'], hidden: false },
    { value: 'Docs Ready', label: 'Docs Ready', color: 'cyan', rules: ['start', 'shown'], hidden: false },
    { value: 'Confirmed', label: 'Booked', color: 'green', rules: ['movable', 'shown'], hidden: false },
    { value: 'Shut Out', label: 'Shut Out', color: 'orange', rules: ['movable'], hidden: false },
    { value: 'Cancelled', label: 'Lost', color: 'red', rules: ['faded'], hidden: false },
  ];

  test('blank reads as the status new rows start at', () => {
    expect(statusOf({}, list)).toBe('Docs Ready');
    expect(stateOf({}, list)).toBe('Docs Ready');
  });

  test.each([
    [{ status: 'Shut Out' }, null],
    [{ status: 'Confirmed' }, null],
    [{ status: 'Pending' }, 'it is Awaiting Client - set its Job Status to Booked or Shut Out first.'],
    [{ status: 'Cancelled' }, 'it is Lost - a closed plan is not moved.'],
  ])('moveRefusal(%j) by its rules, named by its label', (plan, why) => {
    expect(moveRefusal(plan, null, list)).toBe(why);
  });
});

test('a moved plan names its job when it is known', () => {
  expect(moveRefusal({ status: 'Confirmed', CustomsJobId: 4 }, 'CL-CCJ-91/27'))
    .toBe('it is already on the jobs list as CL-CCJ-91/27.');
});
