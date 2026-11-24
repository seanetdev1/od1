/**
 * A list row's icon buttons (Components/Shared/RowAction).
 *
 * Reported 2026-11-12: moving from one row button to the next landed on the
 * third. The button widened on hover to slide its label out, pushing the
 * buttons after it away from the pointer - and shrank back as it left. The
 * label is a tooltip now (Components/Shared/ActionTip): the button never
 * changes size.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import RowAction from 'Components/Shared/RowAction';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

const tipText = () => document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden) .ant-tooltip-inner')?.textContent;

test('holds its icon and no word, so it is the same size hovered or not', () => {
  render(<RowAction Icon={EditOutlined} label='Edit' onClick={() => {}} />);
  const b = screen.getByRole('button', { name: 'Edit' });
  expect(b.textContent).toBe('');
  expect(b.querySelector('.ra-label')).toBeNull();
});

test('names itself in a tooltip after a moment on it, and not before', async () => {
  render(<RowAction Icon={EditOutlined} label='Edit' onClick={() => {}} />);
  const wrap = screen.getByRole('button', { name: 'Edit' }).parentElement;
  fireEvent.mouseEnter(wrap);
  expect(tipText()).toBeUndefined(); // a pointer passing over does not flash it
  await waitFor(() => expect(tipText()).toBe('Edit'));
  fireEvent.mouseLeave(wrap);
  await waitFor(() => expect(tipText()).toBeUndefined());
});

test('a pointer that only passes over shows nothing', async () => {
  render(<RowAction Icon={EditOutlined} label='Edit' onClick={() => {}} />);
  const wrap = screen.getByRole('button', { name: 'Edit' }).parentElement;
  fireEvent.mouseEnter(wrap);
  fireEvent.mouseLeave(wrap);
  await new Promise((r) => setTimeout(r, 250));
  expect(tipText()).toBeUndefined();
});

test('says what more there is under the name, and tells a screen reader too', async () => {
  render(<RowAction Icon={DeleteOutlined} label='Delete' kind='danger' disabled
    title='It is on a posted voucher' onClick={() => {}} />);
  const b = screen.getByRole('button', { name: 'Delete' });
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute('aria-description', 'It is on a posted voucher');
  fireEvent.mouseEnter(b.parentElement); // a disabled button hears no pointer itself
  await waitFor(() => expect(tipText()).toBe('DeleteIt is on a posted voucher'));
});

test('still presses, without opening the row it sits in', () => {
  const onClick = jest.fn();
  const onRow = jest.fn();
  render(<table><tbody><tr onClick={onRow}><td>
    <RowAction Icon={EditOutlined} label='Edit' onClick={onClick} />
  </td></tr></tbody></table>);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(onRow).not.toHaveBeenCalled();
});
