/**
 * A port's or airport's name as a print shows it - jsonData/ports and
 * jsonData/airports - without the code the list appends to it.
 *
 *   "Sanshui (CNSJQ)"  -> "Sanshui"
 *   "Karachi"          -> "Karachi"   (InvoicePrint cut the last two letters
 *                                       off any name without a "(": "Karac")
 *
 * Only a trailing "(...)" goes. A value not in the list - typed in, or a list
 * that no longer has it - prints as it is rather than blank.
 *
 * No React - unit tested.
 */
export function placeName(list, id) {
  if (id === undefined || id === null || id === '') return '';
  const hit = (Array.isArray(list) ? list : []).find((p) => p.id == id);
  if (!hit) return String(id);
  return String(hit.name || '').replace(/\s*\([^()]*\)\s*$/, '') || String(id);
}
