/**
 * Alt + a letter fires the page's action.
 *
 * S save, P print, E excel, N new, D delete - the verbs' initials, registered
 * once by the toolbar so every page that declares its actions gets them
 * without knowing they exist.
 *
 * TWO THINGS HERE ARE WORTH MORE THAN THE REST. That a shortcut cannot press a
 * button the page has not got - the toolbar draws all five slots on every
 * screen and greys out the ones that do not apply, so a keystroke that ignored
 * that would be firing nothing at best and the wrong thing at worst. And that
 * Alt+D does not delete: it opens the same question the button opens, because
 * a destructive verb one keystroke from the home row must not be one keystroke
 * from done.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PageActionsProvider, PageActionBar, usePageActions } from 'Components/Shared/PageActions';

const confirmSpy = jest.fn();
jest.mock('Components/Shared/PopConfirm', () => {
  const fn = (...a) => { global.__popConfirm(...a); };
  fn.confirmDelete = (...a) => { global.__confirmDelete(...a); };
  return { __esModule: true, default: fn, confirmDelete: (...a) => { global.__confirmDelete(...a); } };
});

let popConfirmCalls = [];
let confirmDeleteCalls = [];
global.__popConfirm = (...a) => popConfirmCalls.push(a);
global.__confirmDelete = (...a) => confirmDeleteCalls.push(a);

const Page = ({ actions }) => {
  usePageActions(actions, [actions]);
  return <div>page</div>;
};

const mount = (actions) => render(
  <PageActionsProvider>
    <PageActionBar />
    <Page actions={{ title: 'T', ...actions }} />
  </PageActionsProvider>
);

/** A keystroke on the window, as the handler sees it. */
const press = (key, over = {}) => {
  const e = new window.KeyboardEvent('keydown', {
    key, altKey: true, ctrlKey: false, metaKey: false, bubbles: true, cancelable: true, ...over,
  });
  window.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  popConfirmCalls = [];
  confirmDeleteCalls = [];
  confirmSpy.mockReset();
});

describe('the five letters fire the five slots', () => {
  const cases = [['s', 'save'], ['p', 'print'], ['e', 'excel'], ['n', 'new']];

  test.each(cases)('Alt+%s fires %s', (letter, slot) => {
    const onClick = jest.fn();
    mount({ [slot]: { onClick } });
    press(letter);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('the letter is case-insensitive - caps lock is not a different key', () => {
    const onClick = jest.fn();
    mount({ save: { onClick } });
    press('S');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('the keystroke is swallowed, so it cannot also do something else', () => {
    mount({ save: { onClick: jest.fn() } });
    expect(press('s').defaultPrevented).toBe(true);
  });
});

describe('a shortcut cannot press a button the page has not got', () => {
  test('a slot the page never declared does nothing', () => {
    const save = jest.fn();
    mount({ save: { onClick: save } });
    // The page declares Save and nothing else. Print is drawn but greyed.
    press('p');
    expect(save).not.toHaveBeenCalled();
  });

  test('a disabled action does nothing', () => {
    const onClick = jest.fn();
    mount({ save: { onClick, disabled: true } });
    press('s');
    expect(onClick).not.toHaveBeenCalled();
  });

  test('an action already working does nothing', () => {
    // A held key repeats on its own, where a button takes two deliberate
    // movements - so the second Save would post the same record again.
    const onClick = jest.fn();
    mount({ save: { onClick, busy: true } });
    press('s');
    expect(onClick).not.toHaveBeenCalled();
  });

  test('a page that declared nothing at all is inert', () => {
    render(<PageActionsProvider><PageActionBar /></PageActionsProvider>);
    expect(() => press('s')).not.toThrow();
  });
});

describe('when the key is not ours', () => {
  test('without Alt it is just a letter', () => {
    const onClick = jest.fn();
    mount({ save: { onClick } });
    press('s', { altKey: false });
    expect(onClick).not.toHaveBeenCalled();
  });

  /* AltGr arrives as Ctrl+Alt on Windows, so without this check every AltGr
   * character typed would be firing Save - or Delete. */
  test('AltGr (Ctrl+Alt) is not Alt', () => {
    const onClick = jest.fn();
    mount({ save: { onClick } });
    press('s', { ctrlKey: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  test('a letter with no slot is left alone', () => {
    const onClick = jest.fn();
    mount({ save: { onClick } });
    press('w');   // Alt+W closes a tab; it must not reach the toolbar
    expect(onClick).not.toHaveBeenCalled();
  });

  test('not while typing in a field', () => {
    const onClick = jest.fn();
    mount({ save: { onClick } });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 's', altKey: true, bubbles: true, cancelable: true,
    }));
    expect(onClick).not.toHaveBeenCalled();
    input.remove();
  });
});

describe('Alt+D asks, it does not delete', () => {
  test('a delete carrying a confirm opens the question instead of running', () => {
    const onClick = jest.fn();
    mount({ delete: { onClick, confirm: 'Really?' } });
    press('d');
    // The handler is NOT called; the confirmation owns it now.
    expect(onClick).not.toHaveBeenCalled();
    expect(confirmDeleteCalls).toHaveLength(1);
    // ...and it is handed the action, so answering yes still does the work.
    expect(confirmDeleteCalls[0][0].onOk).toBe(onClick);
  });

  test('a non-destructive action with a confirm asks through the ordinary prompt', () => {
    const onClick = jest.fn();
    mount({ save: { onClick, confirm: 'Sure?' } });
    press('s');
    expect(onClick).not.toHaveBeenCalled();
    expect(popConfirmCalls).toHaveLength(1);
  });

  test('a delete with no confirm declared still runs, exactly as its button does', () => {
    // The shortcut adds no safety the button does not have, and removes none.
    const onClick = jest.fn();
    mount({ delete: { onClick } });
    press('d');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('the shortcut fires the CURRENT handler', () => {
  test('a re-registered page is the one that runs', () => {
    // The bar only re-renders when its appearance changes, so a captured
    // handler would go stale and save what was on screen several renders ago.
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(
      <PageActionsProvider>
        <PageActionBar />
        <Page actions={{ title: 'T', save: { onClick: first } }} />
      </PageActionsProvider>
    );
    rerender(
      <PageActionsProvider>
        <PageActionBar />
        <Page actions={{ title: 'T', save: { onClick: second } }} />
      </PageActionsProvider>
    );
    press('s');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
