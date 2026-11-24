// Jumping straight to a tab: Alt + a number.
//
// The rule is here rather than inline in MainLayout's keydown handler so it
// can be tested without rendering the whole application shell, and so the
// off-by-one that this kind of code always attracts has somewhere to be
// pinned down.
//
// THE DIGITS RUN ALONG THE KEYBOARD, NOT THE NUMBER LINE. Alt+1 is the first
// tab and Alt+0 is the TENTH, because 0 is the tenth key in the row - which is
// where the hand goes for it. Counting 0 as "tab zero" would give two
// shortcuts for the first tab and none for the tenth.
//
// ALT+9 IS THE NINTH TAB, not the last one. Browsers make Alt+9 jump to the
// final tab however many are open, and that is a good rule for a browser,
// where the tab count is unbounded and nobody knows it. Here the strip holds a
// handful and the ask was for ten direct positions; a 9 that sometimes means
// "ninth" and sometimes "last" is the one digit nobody would trust.

/** The digits this responds to, in the order they sit on the keyboard. */
export const SHORTCUT_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * Which tab a digit selects, or -1 for nothing.
 *
 * OUT OF RANGE DOES NOTHING. Alt+7 with three tabs open is not a request for
 * the third one - it is a reach for a tab that is not there, usually because
 * the strip is shorter than it was a moment ago. Snapping to the last tab
 * would move the user somewhere they did not ask to go, and would do it
 * differently every time depending on how many tabs happened to be open.
 *
 * @param {string} key      the event's `key` - '1'..'9' or '0'
 * @param {number} tabCount how many tabs are open
 * @returns {number} a 0-based index into the tab list, or -1
 */
export const tabIndexForDigit = (key, tabCount) => {
  const at = SHORTCUT_DIGITS.indexOf(String(key));
  if (at === -1) return -1;
  if (!Number.isFinite(tabCount) || at >= tabCount) return -1;
  return at;
};

/**
 * Is this keystroke a tab jump?
 *
 * ALT ALONE, NEVER WITH CTRL - and that is not tidiness. On Windows, AltGr is
 * delivered as Ctrl+Alt, so `e.altKey` is TRUE for every AltGr character
 * somebody types. Without the ctrl/meta check, a layout that needs AltGr for
 * a digit or a symbol would have the application jumping between tabs while
 * the user was typing into a field.
 *
 * Shift needs no check of its own: with Shift held, `key` for the 1 key is
 * '!', which is not in the digit list.
 */
export const isTabJump = (e) =>
  Boolean(e) && e.altKey && !e.ctrlKey && !e.metaKey &&
  SHORTCUT_DIGITS.includes(String(e.key));

/**
 * Is the keystroke going into something the user is typing in?
 *
 * Shared with the other tab shortcuts for one reason: a rule about when NOT to
 * steal a key should not be able to differ between two handlers listening on
 * the same window.
 */
export const isTypingTarget = (target) =>
  Boolean(target) && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable === true
  );

/* ---------------------------------------------------------------------------
 * THE PAGE'S ACTIONS - Alt + a letter.
 *
 * The same five verbs the toolbar draws, reachable without the mouse. The
 * letters are the initials of what they do, which is the only mapping anybody
 * will remember: S save, P print, E excel, N new, D delete.
 *
 * WHY NOT Ctrl+S. Ctrl+S is Save Page in every browser and cannot be taken
 * without a preventDefault that also breaks the browser's own behaviour on
 * pages where we have no business doing so. Alt is already this app's
 * modifier - Alt+W closes a tab, Alt+PageDown steps through them - so the
 * verbs join the set rather than starting a second one.
 *
 * ALT+D IS DELETE AND IT DOES NOT DELETE ANYTHING ON ITS OWN. The toolbar
 * asks first for any action carrying a `confirm`, and a shortcut goes through
 * the same button handler, so the keystroke opens the question rather than
 * answering it. That is deliberate: a destructive verb one keystroke from the
 * home row must not be one keystroke from done.
 * ------------------------------------------------------------------------ */

/** Letter -> the toolbar slot it fires. The letters are the verbs' initials. */
export const ACTION_KEYS = {
  s: 'save',
  p: 'print',
  e: 'excel',
  n: 'new',
  d: 'delete',
};

/**
 * Which toolbar slot this keystroke fires, or null.
 *
 * The same Alt-without-Ctrl rule as the tab jumps, and for the same reason:
 * AltGr arrives as Ctrl+Alt, so without the check every AltGr character typed
 * into a field would be firing Save.
 */
export const actionForKey = (e) => {
  if (!e || !e.altKey || e.ctrlKey || e.metaKey) return null;
  const letter = String(e.key || '').toLowerCase();
  return ACTION_KEYS[letter] || null;
};

/**
 * May this action be fired from the keyboard?
 *
 * "WHEN AVAILABLE" MEANS EXACTLY WHAT THE BUTTON MEANS. The toolbar shows every
 * slot on every page and greys out the ones this page does not offer, so a
 * shortcut that ran regardless would press buttons that are not there. The
 * three conditions are the button's own: declared with a handler, not
 * disabled, not already working.
 *
 * `busy` matters more here than on the button. A button being clicked twice
 * takes two deliberate movements; a held key repeats on its own, and the
 * second Save would post the same record again.
 */
export const isActionAvailable = (action) =>
  Boolean(action && action.onClick && !action.disabled && !action.busy);

/**
 * The keystroke that fires a slot, as a label - 'Alt+S' - or ''.
 *
 * Derived from ACTION_KEYS rather than written out again, so a letter changed
 * in one place cannot go on being advertised in the other. The toolbar puts
 * this in each button's tooltip: a shortcut nobody can discover is half a
 * feature.
 */
export const shortcutLabelFor = (slotKey) => {
  const letter = Object.keys(ACTION_KEYS).find((k) => ACTION_KEYS[k] === slotKey);
  return letter ? `Alt+${letter.toUpperCase()}` : '';
};

/* ---------------------------------------------------------------------------
 * A CHARGE LINE - Alt + R / Alt + B on a customs job's Charges tab.
 *
 * Add + on the Receivable or the Payable section, from the keyboard (the
 * user's choice, 2026-10-22). R for Receivable; B for Bill, because Alt+P is
 * Print. Neither letter is the app's or the browser's.
 *
 * The same Alt-without-Ctrl rule as everything above - AltGr arrives as
 * Ctrl+Alt - and no Shift: left Alt+Shift switches the keyboard language on a
 * PC with Urdu installed.
 * ------------------------------------------------------------------------ */

/** Letter -> the side of the charge line it adds. */
export const CHARGE_ROW_KEYS = {
  r: 'Recievable',
  b: 'Payble',
};

/** Which side's line this keystroke adds, or null. */
export const chargeRowForKey = (e) => {
  if (!e || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  return CHARGE_ROW_KEYS[String(e.key || '').toLowerCase()] || null;
};

/** The keystroke that adds a line on `type`'s side, as a label - 'Alt+R'. */
export const chargeRowShortcutLabel = (type) => {
  const letter = Object.keys(CHARGE_ROW_KEYS).find((k) => CHARGE_ROW_KEYS[k] === type);
  return letter ? `Alt+${letter.toUpperCase()}` : '';
};

/* ---------------------------------------------------------------------------
 * THE CATALOGUE - every keystroke the application answers to.
 *
 * Kept HERE, beside the rules that implement half of them, because a list of
 * shortcuts that lives away from the handlers is a list that goes stale: the
 * binding gets changed, the help does not, and the help is then worse than
 * nothing because somebody trusts it.
 *
 * The two groups this derives - the tab digits and the page actions - are
 * built FROM the maps above rather than typed out again, so a letter changed
 * in ACTION_KEYS changes what the header advertises in the same edit. The
 * three in `NAVIGATION_SHORTCUTS` are implemented by hand in
 * Components/Shared/MainLayout and are stated here; __tests__/tabShortcuts
 * checks that nothing in the derived maps is missing from the catalogue, which
 * is the half that can drift silently.
 * ------------------------------------------------------------------------ */

/** What each toolbar slot is called in the help, where the slot key is terse. */
const ACTION_LABELS = {
  save: 'Save',
  print: 'Print',
  excel: 'Export to Excel',
  new: 'New',
  delete: 'Delete (asks first)',
};

/* Implemented directly in MainLayout's own keydown handlers. Alt+W and Alt+L
 * predate this module; Alt+PageUp/PageDown came with the tab strip. */
export const NAVIGATION_SHORTCUTS = [
  { keys: 'Alt + L', what: 'Search the menu' },
  // Components/Shared/HeaderSearch (2026-11-23).
  { keys: 'Alt + K', what: 'Search jobs, B/Ls, invoices, vouchers and parties' },
  { keys: 'Alt + PageDown', what: 'Next tab' },
  { keys: 'Alt + PageUp', what: 'Previous tab' },
  { keys: 'Alt + W', what: 'Close the current tab' },
];

/** The whole catalogue, grouped the way somebody reads it. */
export const SHORTCUT_HELP = [
  {
    group: 'Tabs',
    items: [
      // One line for the ten digits rather than ten lines saying the same
      // thing - a help panel that has to be scrolled is one nobody reads.
      { keys: 'Alt + 1…9, 0', what: 'Go straight to that tab (0 is the tenth)' },
      ...NAVIGATION_SHORTCUTS,
    ],
  },
  {
    group: 'This page',
    items: Object.keys(ACTION_KEYS).map((letter) => ({
      keys: `Alt + ${letter.toUpperCase()}`,
      what: ACTION_LABELS[ACTION_KEYS[letter]] || ACTION_KEYS[letter],
    })),
  },
  {
    group: 'Customs job - Charges tab',
    items: Object.keys(CHARGE_ROW_KEYS).map((letter) => ({
      keys: `Alt + ${letter.toUpperCase()}`,
      what: `Add a ${CHARGE_ROW_KEYS[letter] === 'Recievable' ? 'Receivable' : 'Payable'} line`,
    })),
  },
];
