// The freight job screen's Vessel picker - functions/vesselOptions.
import { vesselOptions } from 'functions/vesselOptions';

const list = [
  { id: 1, name: 'MSC ANNA', code: 11, active: true },
  { id: 2, name: 'OLD STAR', code: 12, active: false },
  { id: 3, name: 'PRE 1.2.96', code: 13 }, // a server that sends no flag
];

test('offers active vessels, and leaves inactive ones out', () => {
  expect(vesselOptions(list, undefined).map((o) => o.id)).toEqual([1, 3]);
});

test("keeps the job's own vessel, inactive or not, and says it is inactive", () => {
  const options = vesselOptions(list, 2);
  expect(options.map((o) => o.id)).toEqual([1, 2, 3]);
  expect(options.find((o) => o.id === 2).name).toBe('OLD STAR ~ 12 (inactive)');
});

test('matches the job vessel whether the form holds it as a number or text', () => {
  expect(vesselOptions(list, '2').map((o) => o.id)).toContain(2);
});

test('labels as before: name ~ code', () => {
  expect(vesselOptions(list, null)[0]).toEqual({ id: 1, name: 'MSC ANNA ~ 11', code: 11 });
});

test('copes with no list', () => {
  expect(vesselOptions(undefined, 1)).toEqual([]);
});
