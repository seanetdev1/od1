/**
 * THE SIDEBAR'S RULES (2026-11-15 redesign) - kept out of MainLayout so they
 * can be tested without rendering the app shell.
 *
 * The menu itself is functions/setAccesLevels: sections ('4', '11', ...) whose
 * children are the pages this user may open ('4-1', '11-1', ...). A tab's key
 * is a page's key, or one of the records and reports opened FROM a page
 * ('11-2' is a customs job, opened from the list at '11-1').
 */

/**
 * Tabs that are not in the menu, and the menu entry they were opened from -
 * so the sidebar still says where you are while you are inside a job or a
 * report. A report page keyed 'a-b-c' needs no entry here: it belongs to
 * 'a-b' (menuKeyFor).
 */
export const OPENED_FROM = Object.freeze({
  '2-5': '2-2', '2-7': '2-2', '2-8': '2-2', '2-9': '2-2', // party lists and records -> Parties
  '3-10': '3-9', // an opening balance
  '3-12': '3-11', // an opening invoice
  '3-13': '3-4', // a payment / receipt
  '3-17': '3-3', // an invoice
  '4-2': '4-1', '4-3': '4-1', '4-4': '4-1', // a sea export job, its B/L
  '4-6': '4-5', '4-7': '4-5', // a sea import job, its B/L
  '5-7': '5-5', // a ledger
  '5-8': '5-6', // agent invoice balancing's report
  '5-10': '5-9', // a trial balance
  '5-12': '5-11', '5-20': '5-11', // an income statement, the comparative one
  '5-14': '5-13', // an ageing
  '5-16': '5-15', // an audit log
  '6-2': '6-1', // a rider's assignments
  '7-2': '7-1', '7-3': '7-1', // an air export job, its AWB
  '7-5': '7-4', '7-6': '7-4', // an air import job, its AWB
  '7-8': '7-7', // a manifest
  '10-2': '10-1', // a flight
  '10-4': '10-3', // a PFM
  '11-2': '11-1', // a customs job
});

/** Every page key in the menu. */
export const pageKeys = (items) =>
  (items || []).flatMap((section) => (section?.children || []).filter(Boolean).map((page) => page.key));

/** The section a page key is in: '11-1' -> '11'. */
export const sectionOf = (key) => String(key ?? '').split('-')[0];

/**
 * The menu entry to show as current while `tabKey` is the open tab: the page
 * itself, the page it was opened from, or none (the dashboard, a page this
 * user's menu does not have).
 */
export function menuKeyFor(tabKey, items) {
  if (tabKey === null || tabKey === undefined || tabKey === 0) return null;
  const key = String(tabKey);
  const pages = new Set(pageKeys(items));
  if (pages.has(key)) return key;
  const from = OPENED_FROM[key];
  if (from && pages.has(from)) return from;
  const parts = key.split('-');
  if (parts.length > 2) {
    const parent = parts.slice(0, 2).join('-');
    if (pages.has(parent)) return parent;
  }
  return null;
}

/** A page of the menu by its key - the { label, key } a tab is made from. */
export function findPage(items, key) {
  for (const section of items || []) {
    const page = (section?.children || []).find((p) => p && String(p.key) === String(key));
    if (page) return page;
  }
  return null;
}

/**
 * The page finder's choices: every page in the menu, under its section's
 * name, in the menu's order. `search` is what a typed word is matched
 * against - a section's name finds all its pages ("reports"), a page's name
 * finds that page wherever it is.
 */
export const searchOptions = (items) =>
  (items || [])
    .filter((section) => section && (section.children || []).some(Boolean))
    .map((section) => ({
      label: section.label,
      search: String(section.label || '').toLowerCase(),
      options: section.children.filter(Boolean).map((page) => ({
        value: page.key,
        label: page.label,
        search: String(page.label || '').toLowerCase(),
      })),
    }));

/** Whether a typed word matches a page finder choice (or its section). */
export const matchesSearch = (input, option) =>
  String(option?.search || '').includes(String(input || '').trim().toLowerCase());

/**
 * ONE SECTION OPEN AT A TIME. Opening a section closes the one that was open,
 * so the menu stays short enough to see whole; closing it leaves none open.
 * `next` is what the menu asks for (the old keys plus the new one).
 */
export function accordion(current, next) {
  const opened = (next || []).filter((k) => !(current || []).includes(k));
  if (opened.length) return [opened[opened.length - 1]];
  return (next || []).filter((k) => (current || []).includes(k)).slice(-1);
}
