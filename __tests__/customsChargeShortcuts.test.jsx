/**
 * Alt+R / Alt+B on a customs job's Charges tab - a Receivable / Payable line,
 * as that section's Add + (the user's choice, 2026-10-22), with the shortcut
 * on the button's tooltip. functions/tabShortcuts and CustomsJobs/Charges.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  chargeRowForKey, chargeRowShortcutLabel, CHARGE_ROW_KEYS, SHORTCUT_HELP, ACTION_KEYS,
} from '../functions/tabShortcuts';

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => null }));
jest.mock('next/router', () => ({ push: jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));
jest.mock('apis/axiosClient', () => ({ get: jest.fn(() => Promise.resolve({ data: { status: 'success', result: [] } })), post: jest.fn() }));
jest.mock('apis/customsJobs', () => ({ getCustomsChargeSummary: jest.fn(() => Promise.resolve({ status: 'success', result: null })) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('functions/customsStatuses', () => {
  const real = jest.requireActual('functions/customsStatuses');
  return { ...real, useCustomsStatuses: () => real.DEFAULT_STATUSES };
});

// eslint-disable-next-line import/first
import Charges from '../Components/Layouts/CustomsJobs/Charges';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

describe('the keys', () => {
  const key = (k, mods = {}) => ({ key: k, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

  test('Alt+R is a Receivable line, Alt+B a Payable one - either case', () => {
    expect(chargeRowForKey(key('r'))).toBe('Recievable');
    expect(chargeRowForKey(key('B'))).toBe('Payble');
  });

  test('not without Alt, not with Ctrl (AltGr), Shift (language switch) or the Windows key', () => {
    expect(chargeRowForKey(key('r', { altKey: false }))).toBeNull();
    expect(chargeRowForKey(key('r', { ctrlKey: true }))).toBeNull();
    expect(chargeRowForKey(key('r', { shiftKey: true }))).toBeNull();
    expect(chargeRowForKey(key('b', { metaKey: true }))).toBeNull();
    expect(chargeRowForKey(key('p'))).toBeNull();
  });

  test('clash with nothing the app already answers to', () => {
    for (const letter of Object.keys(CHARGE_ROW_KEYS)) {
      expect(ACTION_KEYS[letter]).toBeUndefined();
      expect(['l', 'w']).not.toContain(letter);
    }
  });

  test('are labelled for the tooltip, and listed in the shortcuts help', () => {
    expect([chargeRowShortcutLabel('Recievable'), chargeRowShortcutLabel('Payble')]).toEqual(['Alt+R', 'Alt+B']);
    const group = SHORTCUT_HELP.find((g) => g.group === 'Customs job - Charges tab');
    expect(group.items).toEqual([
      { keys: 'Alt + R', what: 'Add a Receivable line' },
      { keys: 'Alt + B', what: 'Add a Payable line' },
    ]);
  });
});

describe('on the Charges tab', () => {
  const values = { charge: [], party: [] };
  let shown;
  const Sheet = ({ active = true, disabled = false }) => {
    const [charges, setCharges] = useState([]);
    shown = charges;
    return (
      <Charges job={{ id: 9, clientId: 3 }} jobId={9} charges={charges} setCharges={setCharges} values={values}
        disabled={disabled} onInvoice={() => {}} invoicing={false} onInvoiceApproval={() => {}}
        approvingInvoices={false} active={active} />
    );
  };
  const open = async (props) => { await act(async () => { render(<Sheet {...props} />); }); };
  const press = (k) => act(() => { fireEvent.keyDown(window, { key: k, altKey: true }); });

  test('Alt+R adds a Receivable line, Alt+B a Payable one', async () => {
    await open();
    press('r');
    press('b');
    press('r');
    expect(shown.map((c) => c.type)).toEqual(['Recievable', 'Payble', 'Recievable']);
  });

  test('the new line\'s charge box takes the cursor', async () => {
    await open();
    press('b');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Charge'));
  });

  test('nothing while another tab of the job is showing', async () => {
    await open({ active: false });
    press('r');
    expect(shown).toEqual([]);
  });

  test('nothing where Add + is greyed out - a cancelled job, or no right to change charges', async () => {
    await open({ disabled: true });
    press('r');
    press('b');
    expect(shown).toEqual([]);
  });

  test('hovering Add + names its shortcut', async () => {
    await open();
    const [receivableAdd, payableAdd] = screen.getAllByText('Add +');
    fireEvent.mouseEnter(receivableAdd);
    expect(await screen.findByText('Add a Receivable line (Alt+R)')).toBeTruthy();
    fireEvent.mouseEnter(payableAdd);
    expect(await screen.findByText('Add a Payable line (Alt+B)')).toBeTruthy();
  });
});
