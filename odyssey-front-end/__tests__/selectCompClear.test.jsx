/**
 * The cross on a SelectComp that opts in (clearTo) empties the field - on
 * screen, and in what is saved. It handed react-hook-form `undefined`, which
 * reads as "not set": the box went back to the value the form started with
 * and the save left the field out, so Inco Terms could not be unselected (the
 * user, 2026-11-04).
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import SelectComp from '../Components/Shared/Form/SelectComp';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
});

let submitted;
// As the job screen does it: a blank form, then the job loaded into it.
const Harness = (selectProps) => {
  const { control, register, reset, handleSubmit } = useForm({ defaultValues: { incoTerms: '' } });
  React.useEffect(() => { reset({ incoTerms: 'FOB' }); }, []);
  return (
    <form onSubmit={handleSubmit((d) => { submitted = d; })}>
      <SelectComp register={register} name='incoTerms' control={control} label='Inco Terms' width='100%'
        options={[{ id: 'FOB', name: 'FOB' }, { id: 'CFR', name: 'CFR' }]} {...selectProps} />
      <button type='submit'>save</button>
    </form>
  );
};

const shown = (container) => container.querySelector('.ant-select-selection-item');
const clear = async (container) => {
  await act(async () => { fireEvent.mouseDown(container.querySelector('.ant-select-clear')); });
};
const save = async (getByText) => {
  submitted = undefined;
  await act(async () => { fireEvent.click(getByText('save')); });
};

test('the cross empties the box, and the save sends it empty', async () => {
  const { container, getByText } = render(<Harness clearTo={null} />);
  expect(shown(container).textContent).toBe('FOB');
  await clear(container);
  expect(shown(container)).toBeNull();
  await save(getByText);
  // null, not left out: a field missing from the save keeps its old value.
  expect(Object.prototype.hasOwnProperty.call(submitted, 'incoTerms')).toBe(true);
  expect(submitted.incoTerms).toBeNull();
});

test('a value picked after clearing is the one saved', async () => {
  const { container, getByText } = render(<Harness clearTo={null} />);
  await clear(container);
  await act(async () => { fireEvent.mouseDown(container.querySelector('.ant-select-selector')); });
  await act(async () => { fireEvent.click(document.querySelector('.ant-select-item-option[title="CFR"]')); });
  await save(getByText);
  expect(submitted.incoTerms).toBe('CFR');
});

test('a field that has not opted in is left as it was', async () => {
  const { container, getByText } = render(<Harness />);
  await clear(container);
  await save(getByText);
  // Unchanged behaviour: such fields (a voucher's currency, a setup charge's
  // defaults) may not be saved empty.
  expect(submitted.incoTerms).not.toBeNull();
});
