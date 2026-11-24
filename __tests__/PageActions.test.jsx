/**
 * The page action toolbar - Components/Shared/PageActions.
 *
 * The rules worth pinning are the ones that make the bar trustworthy. A
 * toolbar whose buttons move, or which offers an action that does nothing, is
 * worse than the scattered buttons it replaced: people stop reading it and go
 * back to hunting the page.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
// The toolbar asks through the app's own PopConfirm (antd Modal.confirm),
// not window.confirm - so it is mocked here and the assertions are about what
// the toolbar ASKS, and that the action waits for the answer.
const mockPopConfirm = jest.fn();
const mockConfirmDelete = jest.fn();
jest.mock('Components/Shared/PopConfirm', () => ({
  __esModule: true,
  default: (...a) => mockPopConfirm(...a),
  confirmDelete: (...a) => mockConfirmDelete(...a),
}));

import {
  PageActionsProvider, PageActionBar, usePageActions, SLOTS,
} from 'Components/Shared/PageActions';

// A page that declares whatever the test hands it.
const Page = ({ actions }) => {
  usePageActions(actions, [actions]);
  return <div>page body</div>;
};

const mount = (actions) => render(
  <PageActionsProvider>
    <PageActionBar />
    {actions === null ? <div>page body</div> : <Page actions={actions} />}
  </PageActionsProvider>,
);

const button = (name) => screen.getByRole('button', { name });

describe('a page that declares nothing', () => {
  test('gets no header from here at all', () => {
    // What lets this be adopted one screen at a time: an unconverted page
    // keeps the title row it draws itself, and grows no second one.
    mount(null);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('a shared component that is not the page', () => {
  test('registering null claims nothing and disturbs nothing', () => {
    // InvoiceCharges is a page of its own, a modal on the invoice list, and a
    // tab inside a job. In the last two it must not put the invoice's Delete
    // where the job's Save belongs - so it registers null and the host page
    // keeps its own toolbar.
    render(
      <PageActionsProvider>
        <PageActionBar />
        <Page actions={{ title: 'Aviation Job AVJ-1', save: { onClick: () => {} } }} />
        <Page actions={null} />
      </PageActionsProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Aviation Job AVJ-1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('the title', () => {
  test('is the page header, so the page does not draw a second one', () => {
    mount({ title: 'Flight Summary', subtitle: 'One row per flight', save: { onClick: () => {} } });
    expect(screen.getByRole('heading', { name: 'Flight Summary' })).toBeInTheDocument();
    expect(screen.getByText('One row per flight')).toBeInTheDocument();
  });

  test('a page with no subtitle simply has none', () => {
    mount({ title: 'Aviation Job AVJ-1/26', save: { onClick: () => {} } });
    expect(screen.getByRole('heading', { name: 'Aviation Job AVJ-1/26' })).toBeInTheDocument();
  });
});

describe('the buttons are icons', () => {
  /* The name used to slide out of the button, widening it - which pushed
   * every button after it away from the pointer, so people aiming at one
   * pressed the next (2026-11-12). Now the button holds its icon only and the
   * name is a tooltip (ActionTip): nothing in the row ever moves. */
  const tipText = () => document.querySelector('.ant-tooltip:not(.ant-tooltip-hidden) .ant-tooltip-inner')?.textContent;

  test('are still NAMED - to a screen reader, and in a tooltip on hover', async () => {
    mount({ save: { onClick: () => {} } });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-label', 'Save');
    fireEvent.mouseEnter(save.parentElement);
    await waitFor(() => expect(tipText()).toBe('Save · Alt+S'));
    fireEvent.mouseLeave(save.parentElement);
    await waitFor(() => expect(tipText()).toBeUndefined());
  });

  test('never change size: the button holds the icon and no word', () => {
    mount({ save: { onClick: () => {} } });
    expect(button('Save').textContent).toBe('');
    expect(button('Save').querySelector('.pa-label')).toBeNull();
  });

  test('a press hides the name at once, so it does not sit over the page', async () => {
    mount({ save: { onClick: () => {} } });
    const wrap = button('Save').parentElement;
    fireEvent.mouseEnter(wrap);
    await waitFor(() => expect(tipText()).toBeTruthy());
    fireEvent.mouseDown(wrap);
    await waitFor(() => expect(tipText()).toBeUndefined());
  });

  test('what the tooltip adds to the name reaches a screen reader as well', () => {
    // The shortcut, where there is one; nothing for a slot with nothing to add.
    mount({ save: { onClick: () => {} } });
    expect(button('Save')).toHaveAttribute('aria-description', 'Save · Alt+S');
    mount({ extras: [{ key: 'thing', label: 'Thing', onClick: () => {} }] });
    expect(button('Thing')).not.toHaveAttribute('aria-description');
  });

  test('a disabled button does not advertise a shortcut that would do nothing', () => {
    mount({ save: { onClick: () => {}, disabled: true } });
    expect(button('Save').getAttribute('aria-description') || '').not.toMatch(/Alt\+/);
  });

  test('a disabled button still names itself on hover - its wrapper hears the pointer', async () => {
    mount({ save: { onClick: () => {}, disabled: true, title: 'Nothing has changed' } });
    fireEvent.mouseEnter(button('Save').parentElement);
    await waitFor(() => expect(tipText()).toBe('Nothing has changed'));
  });
});

describe('the standard slots', () => {
  test('are all drawn, in the same order, however few the page uses', () => {
    // The entire point. A page offering only Save still shows the other four,
    // so Save is in the same place on every screen in the app.
    mount({ save: { onClick: () => {} } });
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(SLOTS.map((s) => s.label));
  });

  test('an action the page does not offer is disabled, not hidden', () => {
    mount({ save: { onClick: () => {} } });
    expect(button('Delete')).toBeDisabled();
    expect(button('Save')).toBeEnabled();
  });

  test('a disabled button says why it is disabled', () => {
    // A greyed button with no explanation is the thing people file tickets
    // about. Unavailable on this page, or not available yet, are different
    // answers and the tooltip gives the right one.
    mount({ save: { onClick: () => {}, disabled: true, title: 'Nothing has changed' } });
    expect(button('Save')).toHaveAttribute('aria-description', 'Nothing has changed');
    expect(button('Print')).toHaveAttribute('aria-description', 'Print — not available on this page');
  });
});

describe('pressing one', () => {
  test('runs the page handler', () => {
    const onClick = jest.fn();
    mount({ save: { onClick } });
    fireEvent.click(button('Save'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('a disabled action does nothing at all', () => {
    const onClick = jest.fn();
    mount({ save: { onClick, disabled: true } });
    fireEvent.click(button('Save'));
    expect(onClick).not.toHaveBeenCalled();
  });

  test('a busy action says so and refuses a second press', () => {
    // Double-submitting a save is the oldest bug in any form.
    const onClick = jest.fn();
    mount({ save: { onClick, busy: true } });
    const b = button('Save');
    expect(b).toHaveAttribute('aria-description', 'Save — working…');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('a destructive action', () => {
  beforeEach(() => { mockPopConfirm.mockReset(); mockConfirmDelete.mockReset(); });

  test('asks before it runs - in the bar, not in each page', () => {
    // So that one screen cannot quietly be the one that deletes without
    // asking, which is exactly what happens when every page asks for itself.
    const onClick = jest.fn();
    mount({ delete: { onClick, confirm: 'This cannot be undone.' } });
    fireEvent.click(button('Delete'));

    expect(mockConfirmDelete).toHaveBeenCalledTimes(1);
    expect(mockConfirmDelete.mock.calls[0][0]).toMatchObject({
      body: 'This cannot be undone.',
      okText: 'Delete',
    });
    // Nothing has happened yet - the work is what the dialog will run.
    expect(onClick).not.toHaveBeenCalled();
  });

  test('runs only when the question is answered', () => {
    const onClick = jest.fn();
    mount({ delete: { onClick, confirm: 'This cannot be undone.' } });
    fireEvent.click(button('Delete'));
    // The dialog's onOk is the page's handler, held until somebody presses it.
    mockConfirmDelete.mock.calls[0][0].onOk();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('names what is being deleted when the page says what it is', () => {
    // "Delete this?" is a different question from "Delete flight PK-301?".
    const onClick = jest.fn();
    mount({ delete: { onClick, confirm: { what: 'flight', name: 'PK-301' } } });
    fireEvent.click(button('Delete'));
    expect(mockConfirmDelete.mock.calls[0][0]).toMatchObject({ what: 'flight', name: 'PK-301' });
  });

  test("the button in the dialog says the screen's own word for it", () => {
    // Cancel Flight, not OK - the dialog and the toolbar have to agree about
    // what is about to happen.
    const onClick = jest.fn();
    mount({ delete: { onClick, label: 'Cancel Flight', confirm: 'Its cargo stops counting.' } });
    fireEvent.click(button('Cancel Flight'));
    expect(mockConfirmDelete.mock.calls[0][0].okText).toBe('Cancel Flight');
  });

  test('an action with no confirm runs straight away', () => {
    // Only the screens that ask for it are interrupted.
    const onClick = jest.fn();
    mount({ delete: { onClick } });
    fireEvent.click(button('Delete'));
    expect(mockConfirmDelete).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('wears the destructive look, and Save does not', () => {
    // Delete looking identical to Save is the hazard this vocabulary exists
    // to remove; the class is the thing a user reads as "careful".
    mount({ save: { onClick: () => {} }, delete: { onClick: () => {} } });
    expect(button('Delete').className).toContain('page-action-danger');
    expect(button('Save').className).toContain('page-action-primary');
    expect(button('Save').className).not.toContain('page-action-danger');
  });
});

describe("a page's own verbs", () => {
  test('are drawn after the five, never between them', () => {
    // The fixed positions stay fixed, or the bar is just a different place to
    // go hunting.
    mount({
      save: { onClick: () => {} },
      extras: [{ key: 'columns', label: 'Columns', onClick: () => {} }],
    });
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([...SLOTS.map((s) => s.label), 'Columns']);
  });

  test('one given `pressed` is a toggle: it says whether it is on, and looks it', () => {
    const { rerender } = mount({
      extras: [
        { key: 'live', label: 'Live updates', onClick: () => {}, pressed: false },
        { key: 'columns', label: 'Columns', onClick: () => {} },
      ],
    });
    expect(button('Live updates')).toHaveAttribute('aria-pressed', 'false');
    expect(button('Live updates')).not.toHaveClass('is-pressed');
    // A verb has no state to report.
    expect(button('Columns')).not.toHaveAttribute('aria-pressed');

    // Turning it on redraws the bar - `pressed` is part of how it looks.
    rerender(
      <PageActionsProvider>
        <PageActionBar />
        <Page actions={{ extras: [{ key: 'live', label: 'Live updates', onClick: () => {}, pressed: true }] }} />
      </PageActionsProvider>,
    );
    expect(button('Live updates')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Live updates')).toHaveClass('is-pressed');
  });

  test('a page may rename a slot without moving it', () => {
    // "Cancel Flight" is this screen's destructive verb - nothing is ever
    // deleted - but it belongs in the same position as everyone's Delete.
    mount({ delete: { onClick: () => {}, label: 'Cancel Flight' } });
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels[2]).toBe('Cancel Flight');
  });
});

describe('moving between pages', () => {
  test('the bar follows the page that is showing', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(
      <PageActionsProvider>
        <PageActionBar />
        <Page actions={{ save: { onClick: first } }} />
      </PageActionsProvider>,
    );
    fireEvent.click(button('Save'));
    expect(first).toHaveBeenCalledTimes(1);

    act(() => {
      rerender(
        <PageActionsProvider>
          <PageActionBar />
          <Page actions={{ save: { onClick: second, label: 'Save Flight' } }} />
        </PageActionsProvider>,
      );
    });
    fireEvent.click(button('Save Flight'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  test('a page that leaves takes its bar with it', () => {
    const { rerender } = render(
      <PageActionsProvider>
        <PageActionBar />
        <Page actions={{ save: { onClick: () => {} } }} />
      </PageActionsProvider>,
    );
    expect(screen.getAllByRole('button').length).toBe(SLOTS.length);

    act(() => {
      rerender(
        <PageActionsProvider>
          <PageActionBar />
          <div>a page with no actions</div>
        </PageActionsProvider>,
      );
    });
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a page that re-registers on every render', () => {
  // The loop this guards against was real: InvoiceCharges listed two
  // unmemoised handlers in its deps, so the effect re-ran every render, the
  // provider set state, the page re-rendered, and React gave up with
  // "Maximum update depth exceeded". Every handler is a new function on every
  // render, so === can never be the test.
  const Unstable = ({ onSave, spy }) => {
    spy();
    // Deliberately hostile: a new object AND a new dep on every single render.
    usePageActions({ title: 'Unstable', save: { onClick: onSave } }, [{}, () => {}]);
    return <div>unstable page</div>;
  };

  test('settles instead of looping', () => {
    const spy = jest.fn();
    render(
      <PageActionsProvider>
        <PageActionBar />
        <Unstable onSave={() => {}} spy={spy} />
      </PageActionsProvider>,
    );
    // A loop shows up as an ever-growing render count; a settled tree renders
    // a handful of times and stops.
    expect(spy.mock.calls.length).toBeLessThan(5);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('and the button still calls the LATEST handler, not a stale one', () => {
    // The trap in fixing the loop: skipping the update keeps the old closure,
    // so Save would post what was on screen several renders ago.
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(
      <PageActionsProvider>
        <PageActionBar />
        <Unstable onSave={first} spy={() => {}} />
      </PageActionsProvider>,
    );
    act(() => {
      rerender(
        <PageActionsProvider>
          <PageActionBar />
          <Unstable onSave={second} spy={() => {}} />
        </PageActionsProvider>,
      );
    });
    fireEvent.click(button('Save'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  test('a change that is only visible redraws the bar', () => {
    // The other half: the signature has to notice a label or a disabled state
    // moving, or the bar would never update at all.
    const { rerender } = render(
      <PageActionsProvider>
        <PageActionBar />
        <Page actions={{ title: 'X', save: { onClick: () => {}, disabled: false } }} />
      </PageActionsProvider>,
    );
    expect(button('Save')).toBeEnabled();
    act(() => {
      rerender(
        <PageActionsProvider>
          <PageActionBar />
          <Page actions={{ title: 'X', save: { onClick: () => {}, disabled: true } }} />
        </PageActionsProvider>,
      );
    });
    expect(button('Save')).toBeDisabled();
  });
});

describe('a handler that closes over state the deps say nothing about', () => {
  /* THE BUG THIS EXISTS FOR.
   *
   * Setup > Charge Groups registered [editing, form.name, form.lines.length,
   * saving]. Typing a rate into a line changes none of them, so the toolbar
   * kept the Save closure captured when the line was ADDED - and saved a group
   * whose only charge line was still blank. The server dropped the blank line,
   * the list said zero charges, and nothing reported an error.
   *
   * deps say when the bar LOOKS different. They cannot also say when a
   * closure is stale, because a handler closes over the whole form. */
  const Form = ({ onSave, spy }) => {
    const [text, setText] = React.useState('');
    // Deliberately hostile: the deps never mention `text`.
    usePageActions({ title: 'Form', save: { onClick: () => onSave(text) } }, [spy]);
    return (
      <input aria-label='field' value={text} onChange={(e) => setText(e.target.value)} />
    );
  };

  test('Save runs on the CURRENT state, not the state when it last registered', () => {
    const onSave = jest.fn();
    render(
      <PageActionsProvider>
        <PageActionBar />
        <Form onSave={onSave} spy='never-changes' />
      </PageActionsProvider>,
    );

    fireEvent.change(screen.getByLabelText('field'), { target: { value: 'typed after' } });
    fireEvent.click(button('Save'));

    expect(onSave).toHaveBeenCalledWith('typed after');
  });

  test('and the bar does not redraw for a change it cannot show', () => {
    // The other half of the bargain: keeping handlers fresh must not put the
    // signature back to re-rendering on every keystroke.
    const onSave = jest.fn();
    render(
      <PageActionsProvider>
        <PageActionBar />
        <Form onSave={onSave} spy='never-changes' />
      </PageActionsProvider>,
    );
    const before = button('Save');
    fireEvent.change(screen.getByLabelText('field'), { target: { value: 'x' } });
    // Same DOM node: nothing about the bar changed, so React never replaced it.
    expect(button('Save')).toBe(before);
  });
});
