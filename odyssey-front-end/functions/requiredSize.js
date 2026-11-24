/**
 * A CONTAINER SIZE IS REQUIRED - on a job's Equipment Info and a B/L's
 * Container Info (the user's request, 2026-10-13). Both rows start with no
 * size; a row with anything else on it cannot be saved without one. A row
 * with nothing on it at all - the empty one a new job opens with - is not a
 * row yet, and is left alone.
 *
 * No React - unit tested.
 */
export const EQUIPMENT_FIELDS = ['qty', 'dg', 'gross', 'teu'];
export const CONTAINER_FIELDS = ['no', 'seal', 'gross', 'net', 'cbm', 'pkgs'];

const filled = (v) => {
  const s = String(v ?? '').trim();
  return s !== '' && s !== '0';
};

/** The row number (from 1) of the first row with something on it but no size, or null. */
export function rowMissingSize(rows, fields) {
  const list = Array.isArray(rows) ? rows : [];
  const i = list.findIndex((r) => !String(r?.size ?? '').trim() && fields.some((f) => filled(r?.[f])));
  return i === -1 ? null : i + 1;
}
