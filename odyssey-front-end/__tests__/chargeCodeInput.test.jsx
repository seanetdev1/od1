/**
 * The charge on a customs line - CustomsJobs/ChargeCodeInput. It shows the
 * charge's short name; typing a code (or a short name) and leaving takes that
 * charge; Enter opens the picker, searching for what was typed.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ChargeCodeInput from '../Components/Layouts/CustomsJobs/ChargeCodeInput';
import { chargesWithCode, chargesWithShortName, chargesTyped } from '../functions/chargeSearch';
import openNotification from 'Components/Shared/Notification';

jest.mock('Components/Shared/Notification', () => jest.fn());

const THC = { id: 1, code: 'THC', short: 'Terminal', fullName: 'Terminal Handling - Import' };
const DOF = { id: 2, code: 'DOF', short: 'DO Fee', fullName: 'Delivery Order Fee' };
const DUP1 = { id: 3, code: 'X1', short: 'One' };
const DUP2 = { id: 4, code: 'x1', short: 'Two' };
// A code that is also another charge's short name.
const NUM = { id: 5, code: '212', short: 'LABOUR FEE', fullName: 'Labour Fee' };
const ODD = { id: 6, code: '300', short: 'DOF', fullName: 'Documents On File' };
const MASTER = [THC, DOF, DUP1, DUP2, NUM, ODD];

const setup = (props = {}) => {
  const onPick = jest.fn();
  const onSearch = jest.fn();
  render(<ChargeCodeInput charges={MASTER} onPick={onPick} onSearch={onSearch} {...props} />);
  return { onPick, onSearch, box: screen.getByRole('textbox') };
};

beforeEach(() => openNotification.mockClear());

describe('chargesWithCode', () => {
  test('the code exactly, whatever the case and spaces around it', () => {
    expect(chargesWithCode(MASTER, ' thc ')).toEqual([THC]);
  });
  test('never a code that only starts the same, or a name', () => {
    expect(chargesWithCode(MASTER, 'TH')).toEqual([]);
    expect(chargesWithCode(MASTER, 'Terminal')).toEqual([]);
    expect(chargesWithCode(MASTER, '')).toEqual([]);
  });
  test('every charge sharing a code', () => {
    expect(chargesWithCode(MASTER, 'X1')).toEqual([DUP1, DUP2]);
  });
});

describe('chargesWithShortName / chargesTyped', () => {
  test('the short name exactly, whatever the case and spaces around it', () => {
    expect(chargesWithShortName(MASTER, ' labour fee ')).toEqual([NUM]);
    expect(chargesWithShortName(MASTER, 'LABOUR')).toEqual([]);
  });
  test('the short name first: text that is one charge\'s short name and another\'s code means the short name\'s', () => {
    expect(chargesTyped(MASTER, 'DOF')).toEqual([ODD]);
    // No short name matches: the code still finds its charge.
    expect(chargesTyped(MASTER, '212')).toEqual([NUM]);
    expect(chargesTyped(MASTER, 'labour fee')).toEqual([NUM]);
    expect(chargesTyped(MASTER, '')).toEqual([]);
  });
});

describe('the charge box on a line', () => {
  test('shows the line\'s short name, not its code', () => {
    const { box } = setup({ charge: NUM });
    expect(box.value).toBe('LABOUR FEE');
    expect(box.title).toContain('code 212');
  });

  test('a charge with no short name shows its code', () => {
    const { box } = setup({ charge: { id: 9, code: 'ZZ' } });
    expect(box.value).toBe('ZZ');
  });

  test('typing a short name and leaving takes that charge', () => {
    const { box, onPick } = setup();
    fireEvent.change(box, { target: { value: 'labour fee' } });
    fireEvent.blur(box);
    expect(onPick).toHaveBeenCalledWith(NUM);
  });

  test('typing a code and leaving takes that charge, without opening the picker', () => {
    const { box, onPick, onSearch } = setup();
    fireEvent.change(box, { target: { value: 'thc' } });
    fireEvent.blur(box);
    expect(onPick).toHaveBeenCalledWith(THC);
    expect(onSearch).not.toHaveBeenCalled();
  });

  test('text that is a short name and another charge\'s code takes the short name\'s charge', () => {
    const { box, onPick } = setup();
    fireEvent.change(box, { target: { value: 'dof' } });
    fireEvent.blur(box);
    expect(onPick).toHaveBeenCalledWith(ODD);
    expect(onPick).not.toHaveBeenCalledWith(DOF);
  });

  test('an unknown code changes nothing and says so', () => {
    const { box, onPick } = setup({ charge: THC });
    fireEvent.change(box, { target: { value: 'NOPE' } });
    fireEvent.blur(box);
    expect(onPick).not.toHaveBeenCalled();
    expect(openNotification).toHaveBeenCalledWith('No such charge', expect.stringContaining('"NOPE"'), 'orange');
    expect(box.value).toBe('Terminal');
  });

  test('a code the master repeats opens the picker on it, to choose', () => {
    const { box, onPick, onSearch } = setup();
    fireEvent.change(box, { target: { value: 'X1' } });
    fireEvent.blur(box);
    expect(onPick).not.toHaveBeenCalled();
    expect(onSearch).toHaveBeenCalledWith('X1');
  });

  test('Enter opens the picker searching for what was typed - and the blur after is not a pick', () => {
    const { box, onPick, onSearch } = setup();
    fireEvent.change(box, { target: { value: 'termin' } });
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13 });
    expect(onSearch).toHaveBeenCalledWith('termin');
    fireEvent.blur(box);
    expect(onPick).not.toHaveBeenCalled();
    expect(openNotification).not.toHaveBeenCalled();
  });

  test('leaving without typing anything changes nothing', () => {
    const { box, onPick, onSearch } = setup({ charge: THC });
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onPick).not.toHaveBeenCalled();
    expect(onSearch).not.toHaveBeenCalled();
  });
});
