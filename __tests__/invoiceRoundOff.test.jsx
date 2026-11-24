/**
 * Invoice round off on the frontend - the rule (the same as the server's
 * functions/invoiceRoundOff), what is owed on a rounded invoice wherever it is
 * asked, and Configuration > Invoices > Round off automatically.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { roundOffFor, hasRoundOff, isRoundable, computeRoundOff } from '../Components/Shared/invoicePrintDefaults';
import { knockOff } from '../functions/paymentReceiptSelection';
import { ageingFigures, ALL_CURRENCIES } from '../functions/ageingCurrency';
import Invoices from '../Components/Layouts/Config/Invoices';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: (...a) => mockPost(...a) }));
jest.mock('Components/Shared/Notification', () => jest.fn());
let mockMode = 'freight';
jest.mock('functions/terminology', () => ({ getMode: () => mockMode }));

describe('the rule', () => {
  test('to the nearest rupee - half a rupee or less rounds down', () => {
    expect(roundOffFor(1234.56)).toBe('+0.44');
    expect(roundOffFor(1234.5)).toBe('-0.50');
    expect(roundOffFor(1234)).toBe('0');
    expect(roundOffFor(0.1 + 0.2)).toBe('-0.30');
  });

  test('"0", "0.00" and "-0.00" are no round off', () => {
    for (const v of ['0', '0.00', '-0.00', '', undefined]) expect(hasRoundOff(v)).toBe(false);
    expect(hasRoundOff('+0.44')).toBe(true);
  });

  test('only an invoice in rupees', () => {
    expect(isRoundable({ type: 'Job Invoice', currency: 'PKR' })).toBe(true);
    expect(isRoundable({ type: 'Job Invoice', currency: 'USD' })).toBe(false);
    expect(isRoundable({ type: 'Agent Bill', currency: 'PKR' })).toBe(false);
  });

  test('the box ticks on with the charges\' round off, and off again', () => {
    const records = [{ type: 'Recievable', partyType: 'client', local_amount: '1234.56' }];
    expect(computeRoundOff(records, '0')).toBe('+0.44');
    expect(computeRoundOff(records, '+0.44')).toBe('0');
  });
});

describe('what is owed on a rounded invoice', () => {
  const rounded = { id: 7, createdAt: '2026-09-01', payType: 'Recievable', currency: 'PKR', ex_rate: '1', total: '1234.56', roundOff: '+0.44', recieved: '0', paid: '0' };

  test('the auto knock-off pays it in full, rounded, before the next', () => {
    // The last invoice takes whatever is left, so a newer one follows it.
    const newer = { ...rounded, id: 8, createdAt: '2026-09-20', total: '500', roundOff: '0' };
    const sel = knockOff({}, [rounded, newer], 2000);
    expect(sel['7'].receiving).toBeCloseTo(1235);
    expect(sel['8'].receiving).toBeCloseTo(765);
  });

  test('the ageing counts the rounded total, and nothing once it is paid', () => {
    expect(ageingFigures(rounded, ALL_CURRENCIES).balance).toBeCloseTo(1235);
    expect(ageingFigures({ ...rounded, recieved: '1235' }, ALL_CURRENCIES).balance).toBeCloseTo(0);
  });
});

describe('Configuration > Invoices', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockMode = 'freight';
  });

  const settings = (values) => mockGet.mockImplementation((url) => Promise.resolve({ data: { status: 'success',
    result: url === '/settings/invoicePrint'
      ? { hideSignLine: Boolean(values.hideSignLine), hideTax: Boolean(values.hideTax) }
      : { auto: values.auto } } }));
  const saveButton = () => screen.getByRole('button', { name: /^(Save|Saved|Saving…)$/ });

  test('shows both settings as saved, and nothing is sent until Save', async () => {
    settings({ auto: false, hideSignLine: true });
    mockPost.mockImplementation((url, body) => Promise.resolve({ data: { status: 'success', result: body } }));
    render(<Invoices />);
    const round = await screen.findByRole('switch', { name: 'Round off invoices automatically' });
    const sign = screen.getByRole('switch', { name: 'Hide the sign line by default' });
    expect([round.getAttribute('aria-checked'), sign.getAttribute('aria-checked')]).toEqual(['false', 'true']);
    expect(saveButton().textContent).toBe('Saved');
    expect(saveButton().disabled).toBe(true);

    fireEvent.click(round);
    expect(round.getAttribute('aria-checked')).toBe('true');
    expect(mockPost).not.toHaveBeenCalled();
    expect(saveButton().textContent).toBe('Save');

    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().textContent).toBe('Saved'));
    // Only what changed is sent.
    expect(mockPost.mock.calls).toEqual([['/settings/invoiceRoundOff', { auto: true }]]);
  });

  test('both changed: both saved', async () => {
    settings({ auto: true, hideSignLine: false });
    mockPost.mockImplementation((url, body) => Promise.resolve({ data: { status: 'success', result: body } }));
    render(<Invoices />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Round off invoices automatically' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Hide the sign line by default' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().textContent).toBe('Saved'));
    expect(mockPost).toHaveBeenCalledWith('/settings/invoiceRoundOff', { auto: false });
    expect(mockPost).toHaveBeenCalledWith('/settings/invoicePrint', { hideSignLine: true });
  });

  test('Hide the tax column: on a customs install, saved on its own', async () => {
    mockMode = 'customs';
    settings({ auto: false, hideSignLine: true, hideTax: false });
    mockPost.mockImplementation(() => Promise.resolve({ data: { status: 'success', result: { hideSignLine: true, hideTax: true } } }));
    render(<Invoices />);
    const tax = await screen.findByRole('switch', { name: 'Hide the tax column by default' });
    expect(tax.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(tax);
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().textContent).toBe('Saved'));
    expect(mockPost.mock.calls).toEqual([['/settings/invoicePrint', { hideTax: true }]]);
    expect(screen.getByRole('switch', { name: 'Hide the sign line by default' }).getAttribute('aria-checked')).toBe('true');
  });

  test('not offered on a freight install, which has no customs invoice', async () => {
    settings({ auto: false });
    render(<Invoices />);
    await screen.findByRole('switch', { name: 'Round off invoices automatically' });
    expect(screen.queryByRole('switch', { name: 'Hide the tax column by default' })).toBeNull();
  });

  test('a save that fails stays unsaved', async () => {
    settings({ auto: false, hideSignLine: false });
    mockPost.mockRejectedValue({ response: { data: { result: 'Only an admin can change this.' } } });
    render(<Invoices />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Hide the sign line by default' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saveButton().textContent).toBe('Save'));
    expect(saveButton().disabled).toBe(false);
  });
});

/* THE INVOICE PAGE - 2026-10-22, SNS-JI-574/27: Total Amount (Local) read
 * 117,959.60 beside a +0.40 round off, and the Round Off line had 16 cells
 * under 18 columns, so its figures sat under Type and Net and Total was empty. */
describe('the invoice page', () => {
  // eslint-disable-next-line global-require
  const { localTotal, roundOffLine } = require('../Components/Shared/invoicePrintDefaults');
  const SNS_JI_574 = { total: '117959.6', roundOff: '+0.40', currency: 'PKR', ex_rate: '282.2', payType: 'Recievable' };

  test('Total Amount (Local) is the rounded total, as printed and posted', () => {
    expect(localTotal(SNS_JI_574)).toBe(117960);
    expect(localTotal({ ...SNS_JI_574, total: '7462.5', roundOff: '-0.50' })).toBe(7462);
    expect(localTotal({ ...SNS_JI_574, roundOff: '0' })).toBe(117959.6);
    // A foreign-currency invoice at its rate, as before.
    expect(localTotal({ total: '100', roundOff: '0', currency: 'USD', ex_rate: '282.2' })).toBe(28220);
  });

  test('the Round Off line fills all 18 columns, its figure under Net and Total', () => {
    const cells = roundOffLine(SNS_JI_574, 8);
    expect(cells).toHaveLength(18);
    expect(cells.slice(0, 3)).toEqual([8, 'ROFC', 'Round Off']);
    // Type, Rate, Amount ... Net, Ex., Total - in that order.
    expect(cells.slice(9)).toEqual(['DN', '0.40', '0.40', '0', 'No', '0.00', '+0.40', '1.00', '+0.40']);
    expect(roundOffLine({ ...SNS_JI_574, roundOff: '-0.50', payType: 'Payble' }, 2).slice(9))
      .toEqual(['CN', '0.50', '0.50', '0', 'No', '0.00', '-0.50', '1.00', '-0.50']);
  });

  test('no line for no round off - "0.00" included, which used to show one', () => {
    for (const roundOff of ['0', '0.00', '-0.00', '', undefined]) expect(roundOffLine({ roundOff }, 1)).toBeNull();
    expect(roundOffLine(null, 1)).toBeNull();
  });
});
