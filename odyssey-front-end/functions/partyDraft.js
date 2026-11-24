import moment from 'moment';

// Turning the party form's values into something redux can hold, and back.
//
// The store is the only place a half-filled form can live: switching tabs is a
// Router.push, which unmounts the page and takes every useState and
// react-hook-form value with it. Ten fields typed, one glance at another tab,
// all gone - which is what this exists to stop.
//
// TWO FIELDS ARE MOMENT OBJECTS. redux-toolkit's serializableCheck rejects
// those (rightly - a moment in the store is a mutable object the devtools
// cannot show and a rehydrate cannot restore), so they go in as ISO strings
// and come back out as moments. DateComp would accept the raw string too, but
// reviving them means a restored form holds exactly what a server-loaded one
// does, rather than something that merely renders the same.
//
// Kept free of react and redux imports so the round trip can be tested on its
// own.
const DATE_FIELDS = ['registerDate', 'bankAuthorizeDate'];

const serialiseDate = (value) => {
  if (!value) return '';
  const m = moment.isMoment(value) ? value : moment(value);
  // An invalid moment becomes '' rather than the string "Invalid date", which
  // would come back as an invalid moment and render as a real-looking blank.
  return m.isValid() ? m.toISOString() : '';
};

const reviveDate = (value) => {
  if (!value) return '';
  const m = moment(value);
  return m.isValid() ? m : '';
};

/** Form values -> a plain object safe to put in the store. */
export const toDraft = (values) => {
  if (!values) return null;

  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = DATE_FIELDS.includes(key) ? serialiseDate(value) : value;
  }

  // A blanket guard after the dates are already strings: anything else the
  // form picks up that JSON cannot represent - undefined, a function, a Date -
  // is dropped or flattened here rather than tripping serializableCheck at a
  // random later dispatch.
  return JSON.parse(JSON.stringify(out));
};

/** A stored draft -> values react-hook-form can be initialised with. */
export const fromDraft = (draft) => {
  if (!draft) return null;

  const out = { ...draft };
  for (const key of DATE_FIELDS) {
    if (key in out) out[key] = reviveDate(out[key]);
  }
  return out;
};

/**
 * Is this draft worth restoring?
 *
 * A form that was opened and left alone still fires a watch, so without this
 * every party ever opened would come back wearing an "unsaved changes" banner.
 * Compared against what the form would have shown anyway: same values, no
 * draft. Arrays are compared by content because `types` and `operations` are
 * rebuilt as new arrays on every load.
 */
export const draftDiffersFrom = (draft, baseline) => {
  if (!draft) return false;
  if (!baseline) return true;

  const keys = new Set([...Object.keys(draft), ...Object.keys(baseline)]);
  for (const key of keys) {
    const a = draft[key];
    const b = baseline[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      const aa = Array.isArray(a) ? a : [];
      const bb = Array.isArray(b) ? b : [];
      if (aa.length !== bb.length || aa.some((v, i) => String(v) !== String(bb[i]))) return true;
      continue;
    }
    // Loose on empty: '', null and undefined all mean "not filled in", and the
    // form uses them interchangeably depending on the input that produced it.
    const emptyA = a === '' || a === null || a === undefined;
    const emptyB = b === '' || b === null || b === undefined;
    if (emptyA && emptyB) continue;
    if (emptyA !== emptyB) return true;
    if (typeof a === 'object' || typeof b === 'object') {
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
      continue;
    }
    if (String(a) !== String(b)) return true;
  }
  return false;
};

export { DATE_FIELDS };
