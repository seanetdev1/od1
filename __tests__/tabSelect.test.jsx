/**
 * Tab picks what was typed for in a searchable dropdown (2026-11-16, large
 * forms filled from the keyboard) - functions/tabSelect, on a real antd
 * Select. Tab closed the list and dropped the match.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, fireEvent, act } from '@testing-library/react';
import { Select } from 'antd';
import { installTabSelect, pickOnTab } from 'functions/tabSelect';

const ACCOUNTS = [
  { value: 11, label: '(1203020006) MEEZAN BANK LTD' },
  { value: 12, label: '(1203020007) BANK AL FALAH' },
  { value: 13, label: '(1203020008) BANK AL HABIB LTD' },
];

let uninstall;
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
  uninstall = installTabSelect(document);
});
afterAll(() => uninstall?.());

const picker = (onChange) => {
  const utils = render(
    <Select showSearch value={undefined} onChange={onChange} options={ACCOUNTS}
      filterOption={(input, option) => option.label.toLowerCase().includes(input.toLowerCase())} />,
  );
  return { ...utils, input: utils.container.querySelector('input.ant-select-selection-search-input') };
};
const tab = (input) => fireEvent.keyDown(input, { key: 'Tab', code: 'Tab', keyCode: 9, which: 9 });

test('typed for, then Tab: the highlighted match is picked', async () => {
  const onChange = jest.fn();
  const { input } = picker(onChange);
  await act(async () => { fireEvent.mouseDown(input.closest('.ant-select-selector')); });
  await act(async () => { fireEvent.change(input, { target: { value: 'meez' } }); });
  expect(input).toHaveAttribute('aria-expanded', 'true');
  await act(async () => { tab(input); });
  expect(onChange).toHaveBeenCalledWith(11, expect.anything());
});

test('the match narrowed to, not the first account in the list', async () => {
  const onChange = jest.fn();
  const { input } = picker(onChange);
  await act(async () => { fireEvent.mouseDown(input.closest('.ant-select-selector')); });
  await act(async () => { fireEvent.change(input, { target: { value: 'habib' } }); });
  await act(async () => { tab(input); });
  expect(onChange).toHaveBeenCalledWith(13, expect.anything());
});

test('nothing typed: tabbing through leaves the box as it was', async () => {
  const onChange = jest.fn();
  const { input } = picker(onChange);
  await act(async () => { fireEvent.mouseDown(input.closest('.ant-select-selector')); });
  await act(async () => { tab(input); });
  expect(onChange).not.toHaveBeenCalled();
});

test('typed for nothing that matches: nothing is picked', async () => {
  const onChange = jest.fn();
  const { input } = picker(onChange);
  await act(async () => { fireEvent.mouseDown(input.closest('.ant-select-selector')); });
  await act(async () => { fireEvent.change(input, { target: { value: 'zzzz' } }); });
  await act(async () => { tab(input); });
  expect(onChange).not.toHaveBeenCalled();
});

test('only Tab, and only in a dropdown', () => {
  const box = document.createElement('input');
  expect(pickOnTab({ key: 'Tab', target: box })).toBeNull();
  expect(pickOnTab({ key: 'Enter', target: box })).toBeNull();
  expect(pickOnTab({ key: 'Tab', ctrlKey: true, target: box })).toBeNull();
});
