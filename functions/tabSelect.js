/**
 * TAB PICKS WHAT WAS TYPED FOR (2026-11-16): large forms filled from the
 * keyboard (the user's request).
 *
 * In a searchable dropdown - every account, party and charge picker - you
 * type part of a name, the list narrows and the first match is highlighted.
 * Enter picks it; Tab closed the list and DROPPED it, leaving the box as it
 * was, so somebody tabbing through a voucher's lines got to the end of a row
 * with no account on it. Now Tab picks the highlighted option, as Enter does,
 * and carries on to the next box.
 *
 * Only after something was typed: tabbing THROUGH a dropdown without typing
 * leaves it exactly as it was - the list may open on focus, and its first
 * option is highlighted then too.
 *
 * Installed once, for the whole app (MainLayout). It reads the option the
 * dropdown itself marks as active - antd 4 / rc-select 14 point the input's
 * aria-activedescendant at it - and has the dropdown pick it the way Enter
 * does, so the screen's own onChange runs as it would for Enter.
 */

const ENTER = 13;

/** The keydown that Tab sends, given what is focused - or null to do nothing. */
export function pickOnTab(event, doc = document) {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return null;
  const input = event.target;
  if (!input || input.tagName !== 'INPUT' || !input.classList?.contains('ant-select-selection-search-input')) return null;
  if (input.getAttribute('aria-expanded') !== 'true') return null;
  if (!String(input.value || '').trim()) return null;
  const activeId = input.getAttribute('aria-activedescendant');
  const active = activeId ? doc.getElementById(activeId) : null;
  if (!active || active.getAttribute('role') !== 'option') return null;
  return input;
}

/** As if Enter were pressed in the box - the dropdown picks its active option. */
export function pressEnter(input) {
  const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  // React reads which / keyCode, which a constructed event cannot be given.
  Object.defineProperty(enter, 'keyCode', { get: () => ENTER });
  Object.defineProperty(enter, 'which', { get: () => ENTER });
  input.dispatchEvent(enter);
}

/** Installs it on the document; returns the uninstall. */
export function installTabSelect(doc = document) {
  const onKeyDown = (event) => {
    const input = pickOnTab(event, doc);
    // Before the Tab itself is handled, so the pick lands and THEN the focus
    // moves on - the Tab is not stopped.
    if (input) pressEnter(input);
  };
  doc.addEventListener('keydown', onKeyDown, true);
  return () => doc.removeEventListener('keydown', onKeyDown, true);
}
