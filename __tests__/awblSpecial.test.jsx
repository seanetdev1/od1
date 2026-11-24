/**
 * Special-format AWBs in Setup > AWB Numbers - functions/awblSpecial and the
 * Register modal (Components/Layouts/Setup/Awbl/RegisterModal).
 *
 * 2026-10-21: DHL's master AWBs are not all IATA numbers (2102811410,
 * SN-035-1873), and the register refused them. "Special format" registers
 * them as printed. The server decides (functions/awbl there); this pins the
 * preview and what the modal sends.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { normalizeSpecial, previewSpecial } from '../functions/awblSpecial';

const mockRegister = jest.fn();
jest.mock('apis/awbl', () => ({ registerAwbl: (...a) => mockRegister(...a) }));
const mockNotify = jest.fn();
jest.mock('Components/Shared/Notification', () => (...a) => mockNotify(...a));

// eslint-disable-next-line import/first
import RegisterModal from '../Components/Layouts/Setup/Awbl/RegisterModal';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => { mockRegister.mockReset(); mockNotify.mockReset(); });

describe('functions/awblSpecial', () => {
  test('one spelling per number, as the server stores it', () => {
    expect(normalizeSpecial(' sn-035 1873 ')).toBe('SN0351873');
    expect(normalizeSpecial('SN‑035–1873')).toBe('SN0351873');
  });

  test('a pasted list: one per line or comma separated, each once', () => {
    expect(previewSpecial('2102811410\n1737890254, 2102811410\n\nSN-035-1873'))
      .toEqual({ numbers: ['2102811410', '1737890254', 'SN0351873'], errors: [] });
  });

  test('names what will be refused', () => {
    const { errors } = previewSpecial('AWB#1\n123456789012\n155-05444526');
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/letters and digits only/);
    expect(errors[1]).toMatch(/at most 11/);
    expect(errors[2]).toMatch(/11 digits is an IATA number/);
  });
});

describe('the Register modal', () => {
  const open = () => render(
    <RegisterModal open onClose={jest.fn()} onSaved={jest.fn()} airlines={[{ id: 422, name: 'DHL CARGO' }]} />,
  );
  // The airline is an antd Select; choose it the way a user does.
  const pickAirline = () => {
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(screen.getByText('DHL CARGO'));
  };

  test('Special swaps the airline code and serial for a list, and previews it', () => {
    open();
    expect(screen.getByText('Airline Code *')).toBeTruthy();
    fireEvent.click(screen.getByText('Special format (not IATA)'));
    expect(screen.queryByText('Airline Code *')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2102811410\nSN-035-1873' } });
    expect(screen.getByText(/will be registered/).textContent).toMatch(/2102811410, SN0351873/);
  });

  test('sends the list, flagged special, for the airline picked', async () => {
    mockRegister.mockResolvedValue({ status: 'success', result: { created: 2, skipped: 0, from: '2102811410', to: 'SN0351873' } });
    open();
    pickAirline();
    fireEvent.click(screen.getByText('Special format (not IATA)'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2102811410\nSN-035-1873' } });
    fireEvent.click(screen.getByText('Register'));
    await waitFor(() => expect(mockRegister).toHaveBeenCalledWith({
      airlineId: 422, special: true, numbers: '2102811410\nSN-035-1873',
    }));
  });

  test('a list with a bad entry is not sent', () => {
    open();
    pickAirline();
    fireEvent.click(screen.getByText('Special format (not IATA)'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2102811410\n155-05444526' } });
    fireEvent.click(screen.getByText('Register'));
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith('Error', expect.stringMatching(/11 digits is an IATA number/), 'red', 10);
  });
});
