/**
 * Date boxes take a date typed the way people type it (the user, 2026-11-14:
 * "Date not typing in multiple places - customs job page and invoice page date
 * components don't accept date if you completely erase it and retype").
 *
 * The cause: antd's box reads a typed date only in its display format, so
 * 15/11/2026 in a DD-MM-YYYY box, or 15/11/26 in the invoice page's DD/MMM/YY
 * one, was silently thrown away and the old date came back.
 * functions/lenientDateParse, installed for every box by pages/_app.
 */
import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { DatePicker } from 'antd';
import moment from 'moment';
import libMomentConfig from 'rc-picker/lib/generate/moment';
import { makeLenient, lenientParse, isDayFormat } from 'functions/lenientDateParse';

makeLenient(libMomentConfig);

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

// The customs job's way of holding a date: a YYYY-MM-DD string, a new moment
// each render.
const asMoment = (v) => { if (!v) return null; const m = moment(v, 'YYYY-MM-DD', true); return m.isValid() ? m : null; };
let held;
const Box = ({ initial, format }) => {
  const [v, setV] = useState(initial);
  held = v;
  return <DatePicker value={asMoment(v)} format={format} onChange={(d) => setV(d && d.isValid() ? d.format('YYYY-MM-DD') : '')} />;
};

// Erase it all, type the new date a key at a time, and leave the box.
const retype = (format, typed) => {
  const { container, unmount } = render(<Box initial='2026-11-01' format={format} />);
  const input = container.querySelector('input');
  fireEvent.mouseDown(input);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '' } });
  // A key at a time onto what the box NOW holds, as a browser does: the box
  // can rewrite its text between keys (it did - see below), and typing goes on
  // from what it shows, not from what was meant.
  for (const ch of typed) fireEvent.change(input, { target: { value: input.value + ch } });
  fireEvent.blur(input);
  const out = held;
  unmount();
  return out;
};

describe('erase the date and type another', () => {
  test.each([
    // the customs job's boxes
    ['DD-MM-YYYY', '15-11-2026', '2026-11-15'],
    ['DD-MM-YYYY', '15/11/2026', '2026-11-15'],
    ['DD-MM-YYYY', '15-11-26', '2026-11-15'],
    ['DD-MM-YYYY', '5-11-2026', '2026-11-05'],
    ['DD-MM-YYYY', '15112026', '2026-11-15'],
    ['DD-MM-YYYY', '15.11.2026', '2026-11-15'],
    // the invoice page's
    ['DD/MMM/YY', '15/Nov/26', '2026-11-15'],
    ['DD/MMM/YY', '15/11/26', '2026-11-15'],
    ['DD/MMM/YY', '15/11/2026', '2026-11-15'],
  ])('%s box, typed %s', (format, typed, expected) => {
    expect(retype(format, typed)).toBe(expected);
  });

  test('day first, as dates are written here: 05/11/2026 is the 5th of November', () => {
    expect(retype('DD-MM-YYYY', '05/11/2026')).toBe('2026-11-05');
  });

  // Typed key by key, 15-11-20 is on its way to 15-11-2026: read then as
  // 2020, the box rewrote its text to 15-11-2020 and the 26 landed after it.
  test('a four-digit year is not cut short at 19 or 20', () => {
    expect(retype('DD-MM-YYYY', '15-11-2026')).toBe('2026-11-15');
    expect(retype('DD-MM-YYYY', '01-01-2019')).toBe('2019-01-01');
    expect(retype('DD/MMM/YY', '15/11/2020')).toBe('2020-11-15');
    expect(lenientParse('15-11-20', ['DD-MM-YYYY'])).toBeNull();
    expect(lenientParse('15-11-26', ['DD-MM-YYYY']).format('YYYY-MM-DD')).toBe('2026-11-15');
  });

  test('nonsense leaves the date it had', () => {
    expect(retype('DD-MM-YYYY', '31/02/2026')).toBe('2026-11-01');
    expect(retype('DD-MM-YYYY', 'hello')).toBe('2026-11-01');
  });
});

describe('only a box of whole days', () => {
  test('month, year and time formats are left as they were', () => {
    expect(isDayFormat('DD-MM-YYYY')).toBe(true);
    expect(isDayFormat('DD/MMM/YY')).toBe(true);
    expect(isDayFormat('MMM-YYYY')).toBe(false);
    expect(isDayFormat('YYYY')).toBe(false);
    expect(isDayFormat('DD-MM-YYYY HH:mm')).toBe(false);
    expect(lenientParse('11-2026', ['MMM-YYYY'])).toBeNull();
  });

  test('taught once - a second call changes nothing', () => {
    const parse = libMomentConfig.locale.parse;
    makeLenient(libMomentConfig);
    expect(libMomentConfig.locale.parse).toBe(parse);
  });
});
