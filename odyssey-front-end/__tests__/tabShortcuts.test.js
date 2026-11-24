/**
 * Alt + a number jumps straight to that tab.
 *
 * Three things here are easy to get wrong and impossible to notice from the
 * outside until somebody complains: which digit means which position, what
 * happens when the digit is past the end of the strip, and whether AltGr
 * counts as Alt. The last one is the reason this file exists at all.
 */
import {
  SHORTCUT_DIGITS, tabIndexForDigit, isTabJump, isTypingTarget,
  ACTION_KEYS, actionForKey, isActionAvailable, shortcutLabelFor, SHORTCUT_HELP,
} from 'functions/tabShortcuts';

describe('which tab a digit selects', () => {
  test('the digits run along the keyboard, 1 to 9 then 0', () => {
    expect(SHORTCUT_DIGITS).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
  });

  test('Alt+1 is the first tab', () => {
    // Which is always the pinned Dashboard - see redux/tabs/tabSlice.
    expect(tabIndexForDigit('1', 5)).toBe(0);
  });

  test('the middle digits are their own position', () => {
    expect(tabIndexForDigit('2', 5)).toBe(1);
    expect(tabIndexForDigit('5', 5)).toBe(4);
  });

  test('Alt+9 is the NINTH tab, not the last one', () => {
    // Browsers make Alt+9 mean "last tab" whatever the count. Deliberately not
    // copied: the ask was ten direct positions, and a 9 that sometimes means
    // ninth and sometimes last is the one digit nobody would trust.
    expect(tabIndexForDigit('9', 12)).toBe(8);
  });

  test('Alt+0 is the TENTH tab', () => {
    // 0 is the tenth key in the row, which is where the hand goes for it.
    // Treating it as "tab zero" would give the first tab two shortcuts and
    // the tenth none.
    expect(tabIndexForDigit('0', 12)).toBe(9);
  });
});

describe('a digit past the end of the strip does nothing', () => {
  test('Alt+7 with three tabs open selects nothing', () => {
    // Not the last tab. It is a reach for a tab that is not there - usually
    // because the strip is shorter than it was a moment ago - and snapping
    // somewhere else moves the user where they did not ask to go.
    expect(tabIndexForDigit('7', 3)).toBe(-1);
  });

  test('the last valid position is accepted and the one after it is not', () => {
    expect(tabIndexForDigit('3', 3)).toBe(2);
    expect(tabIndexForDigit('4', 3)).toBe(-1);
  });

  test('Alt+0 needs ten tabs, not nine', () => {
    expect(tabIndexForDigit('0', 9)).toBe(-1);
    expect(tabIndexForDigit('0', 10)).toBe(9);
  });

  test('no tabs, and a nonsense count, select nothing', () => {
    expect(tabIndexForDigit('1', 0)).toBe(-1);
    expect(tabIndexForDigit('1', undefined)).toBe(-1);
    expect(tabIndexForDigit('1', NaN)).toBe(-1);
  });

  test('a key that is not one of the ten selects nothing', () => {
    expect(tabIndexForDigit('a', 5)).toBe(-1);
    expect(tabIndexForDigit('PageDown', 5)).toBe(-1);
    expect(tabIndexForDigit('', 5)).toBe(-1);
    expect(tabIndexForDigit(undefined, 5)).toBe(-1);
  });
});

describe('isTabJump - which keystrokes are ours to take', () => {
  const ev = (over = {}) => ({ altKey: true, ctrlKey: false, metaKey: false, key: '3', ...over });

  test('Alt and a digit', () => {
    expect(isTabJump(ev())).toBe(true);
    expect(isTabJump(ev({ key: '0' }))).toBe(true);
  });

  test('a digit with no Alt is just a digit', () => {
    expect(isTabJump(ev({ altKey: false }))).toBe(false);
  });

  /* THE ONE THAT MATTERS. On Windows AltGr arrives as Ctrl+Alt, so altKey is
   * true for every AltGr character somebody types. Without the ctrl check, a
   * layout needing AltGr for a digit or symbol would send the application
   * hopping between tabs while the user typed. */
  test('AltGr is Ctrl+Alt and must NOT jump tabs', () => {
    expect(isTabJump(ev({ ctrlKey: true }))).toBe(false);
  });

  test('Cmd/Meta with Alt is not ours either', () => {
    expect(isTabJump(ev({ metaKey: true }))).toBe(false);
  });

  test('Shift needs no check of its own', () => {
    // With Shift held, the 1 key reports '!' - which is not in the digit list,
    // so Alt+Shift+1 falls out naturally rather than by a rule.
    expect(isTabJump(ev({ shiftKey: true, key: '!' }))).toBe(false);
  });

  test('Alt with a non-digit is left alone', () => {
    // Alt+W closes a tab and Alt+PageDown steps to the next one; neither may
    // be swallowed here.
    expect(isTabJump(ev({ key: 'w' }))).toBe(false);
    expect(isTabJump(ev({ key: 'PageDown' }))).toBe(false);
  });

  test('no event at all is not a jump', () => {
    expect(isTabJump(undefined)).toBe(false);
    expect(isTabJump(null)).toBe(false);
  });
});

describe('isTypingTarget - when not to steal the key', () => {
  test('inputs, textareas and contenteditable are left alone', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ isContentEditable: true })).toBe(true);
  });

  test('anything else is fair game', () => {
    expect(isTypingTarget({ tagName: 'DIV' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe('the page-action letters', () => {
  const ev = (over = {}) => ({ altKey: true, ctrlKey: false, metaKey: false, key: 's', ...over });

  test('are the initials of the verbs they fire', () => {
    expect(ACTION_KEYS).toEqual({ s: 'save', p: 'print', e: 'excel', n: 'new', d: 'delete' });
  });

  test('map a keystroke to its slot, whatever the case', () => {
    expect(actionForKey(ev({ key: 's' }))).toBe('save');
    expect(actionForKey(ev({ key: 'S' }))).toBe('save');
    expect(actionForKey(ev({ key: 'd' }))).toBe('delete');
  });

  test('AltGr (Ctrl+Alt) fires nothing', () => {
    // The whole reason the ctrl check exists - see the module.
    expect(actionForKey(ev({ ctrlKey: true }))).toBeNull();
  });

  test('a letter with no slot, and Alt+W, fire nothing', () => {
    expect(actionForKey(ev({ key: 'q' }))).toBeNull();
    expect(actionForKey(ev({ key: 'w' }))).toBeNull();   // Alt+W closes a tab
  });

  test('available means declared, enabled and not already working', () => {
    expect(isActionAvailable({ onClick: () => {} })).toBe(true);
    expect(isActionAvailable({ onClick: () => {}, disabled: true })).toBe(false);
    expect(isActionAvailable({ onClick: () => {}, busy: true })).toBe(false);
    expect(isActionAvailable({})).toBe(false);          // drawn but not offered
    expect(isActionAvailable(undefined)).toBe(false);
  });

  test('the label a button advertises comes from the same map', () => {
    expect(shortcutLabelFor('save')).toBe('Alt+S');
    expect(shortcutLabelFor('excel')).toBe('Alt+E');
    // A slot with no shortcut advertises none rather than an empty "Alt+".
    expect(shortcutLabelFor('viewPfm')).toBe('');
  });
});

/* THE HELP MUST NOT DRIFT FROM THE BINDINGS.
 *
 * The header's shortcut panel is read by somebody who does not know the
 * shortcuts - so a panel that names a key which does nothing, or omits one
 * that works, is worse than no panel at all. The catalogue is derived from the
 * maps above; these tests are what stop a later hand-edit from quietly
 * decoupling them. */
describe('the shortcut catalogue covers what is actually bound', () => {
  const allKeys = SHORTCUT_HELP.flatMap((s) => s.items.map((i) => i.keys)).join(' | ');

  test('every page-action letter is advertised', () => {
    for (const letter of Object.keys(ACTION_KEYS)) {
      expect(allKeys).toContain(`Alt + ${letter.toUpperCase()}`);
    }
  });

  test('the tab digits are advertised, including that 0 is the tenth', () => {
    const tabs = SHORTCUT_HELP.find((s) => s.group === 'Tabs');
    const digits = tabs.items.find((i) => i.keys.includes('1…9'));
    expect(digits).toBeTruthy();
    expect(digits.what).toMatch(/tenth/i);
  });

  test('every entry says both a key and what it does', () => {
    for (const section of SHORTCUT_HELP) {
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.keys.trim()).not.toBe('');
        expect(item.what.trim()).not.toBe('');
      }
    }
  });

  test('the destructive one says that it asks first', () => {
    // Somebody reading this list is deciding whether Alt+D is safe to try.
    expect(allKeys).toContain('Alt + D');
    const del = SHORTCUT_HELP.flatMap((s) => s.items).find((i) => i.keys === 'Alt + D');
    expect(del.what).toMatch(/asks/i);
  });
});
