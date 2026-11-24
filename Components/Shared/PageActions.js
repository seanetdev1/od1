import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  PlusOutlined, SaveOutlined, DeleteOutlined, PrinterOutlined, FileExcelOutlined,
} from '@ant-design/icons';
import PopConfirm, { confirmDelete } from 'Components/Shared/PopConfirm';
import ActionTip from 'Components/Shared/ActionTip';
// Alt + a letter fires the matching slot. The letters, the modifier rule and
// what "available" means live in the module, where they are tested.
import {
  actionForKey, isActionAvailable, isTypingTarget, shortcutLabelFor,
} from 'functions/tabShortcuts';

/**
 * THE PAGE HEADER, AND THE PAGE'S ACTIONS IN IT.
 *
 * Save, Delete, New, Print and Export used to be wherever each screen's author
 * put them - top right on one page, under the form on the next, inside the tab
 * on a third, and wearing whatever class was nearest to hand: Delete looked
 * exactly like Save on some screens, and Export came in four different colours
 * across the reports. A user on an unfamiliar page had to go hunting before
 * they could do anything.
 *
 * So the actions leave the page, and they land in the title bar the page
 * already had rather than in a second bar below it. A page DECLARES its title
 * and what it can do; this renders both, above the tab content, identically on
 * every screen. A converted page deletes its own <h4> row - two headers stacked
 * is what this is avoiding.
 *
 *   usePageActions({
 *     title: `Aviation Job ${jobNo}`,
 *     subtitle: 'By sector and aircraft',
 *     save:   { onClick: save, disabled: !dirty, title: 'Nothing to save' },
 *     delete: { onClick: remove, confirm: 'Delete this flight?' },
 *   }, [save, remove, dirty, jobNo]);
 *
 * THE SLOTS ARE IN A FIXED ORDER and an action a page does not offer is shown
 * DISABLED rather than removed, so a button never moves between screens - which
 * is the whole point, and why hiding the unsupported ones would undo it.
 *
 * ICONS, NOT WORDS, because the row has to hold a title as well and five
 * labelled buttons crowd it out. Every one carries its label as its accessible
 * name, and SHOWS that label when the pointer is on it or a keyboard tabs to
 * it - in a tooltip under the button (ActionTip). It used to widen the button
 * and slide the word out beside the glyph, which pushed the buttons after it
 * away from the pointer. So the row stays compact while it is being read and names itself while it is being
 * used, which is how someone learns which icon is which without a legend.
 *
 * THE DEPS ARRAY IS THE CALLER'S, deliberately. Handlers are rebuilt on every
 * render, so registering them unconditionally would loop; the page says when
 * its actions have actually changed, exactly as it does for any other effect.
 *
 * A page that declares NOTHING gets no header from here at all - it keeps the
 * one it draws itself. That is what lets this be adopted a screen at a time
 * rather than in one sweep across 120 files.
 */

// The slots, in the order they are drawn. Adding one here adds it everywhere,
// which is the point - a sixth verb should be a decision about the whole app.
export const SLOTS = [
  { key: 'new',    label: 'New',             kind: 'plain',   Icon: PlusOutlined },
  { key: 'save',   label: 'Save',            kind: 'primary', Icon: SaveOutlined },
  { key: 'delete', label: 'Delete',          kind: 'danger',  Icon: DeleteOutlined },
  { key: 'print',  label: 'Print',           kind: 'plain',   Icon: PrinterOutlined },
  { key: 'excel',  label: 'Export to Excel', kind: 'excel',   Icon: FileExcelOutlined },
];

const PageActionsContext = createContext({
  actionsRef: { current: null }, signature: '',
  claim: () => {}, refresh: () => {}, release: () => {},
});

/**
 * WHAT THE BAR ACTUALLY DRAWS, as a string.
 *
 * Every handler in a registration is a new function on every render of the
 * page - that is how closures work - so "have the actions changed?" cannot be
 * asked with ===. Asked that way it is always yes, and the answer sets state,
 * which re-renders the page, which builds new handlers, which sets state.
 * That loop is not hypothetical: it is what `Maximum update depth exceeded`
 * was, and any page registering with an unmemoised handler in its deps would
 * have found it.
 *
 * So the question asked here is the one that matters to a toolbar: does it
 * LOOK different? Labels, disabled, busy, tooltips, which slots are filled.
 * Handler identity is deliberately absent.
 */
const signatureOf = (a) => {
  if (!a) return '';
  const parts = [a.title || '', a.subtitle || ''];
  const one = (key, x) => (x
    ? [key, x.label || '', x.kind || '', x.title || '', x.glyph || '',
       x.disabled ? 1 : 0, x.busy ? 1 : 0, x.onClick ? 1 : 0, x.confirm ? 1 : 0,
       typeof x.pressed === 'boolean' ? (x.pressed ? 'on' : 'off') : ''].join(':')
    : `${key}:-`);
  for (const slot of SLOTS) parts.push(one(slot.key, a[slot.key]));
  for (const e of (Array.isArray(a.extras) ? a.extras : [])) parts.push(one(`x.${e.key}`, e));
  return parts.join('|');
};

export const PageActionsProvider = ({ children }) => {
  /* THE HANDLERS LIVE IN A REF, the look lives in state.
   *
   * The ref is rewritten on every registration, so a button always calls the
   * CURRENT page's current closure - press Save and it saves what is on screen
   * now, not what was there when the bar last re-rendered. The signature in
   * state is what makes React redraw, and only when something visible moved.
   *
   * Storing the actions in state instead would mean choosing between a render
   * loop and stale handlers. This is how it avoids having to choose. */
  const actionsRef = useRef(null);
  const [signature, setSignature] = useState('');

  /* Registration is OWNED, not just set.
   *
   * Switching tabs unmounts one page and mounts another in the same commit.
   * React runs every cleanup before any effect, so the order is safe today -
   * but a header that can be cleared by a page which has already gone is a
   * blank bar nobody can explain, so the owner is checked rather than
   * assumed. */
  const claim = useCallback((owner, actions) => {
    actionsRef.current = { owner, actions };
    const next = signatureOf(actions);
    setSignature((prev) => (prev === next ? prev : next));
  }, []);

  /* THE HANDLERS, REFRESHED ON EVERY RENDER OF THE PAGE.
   *
   * Without this the ref only moved when a page RE-CLAIMED, which happens when
   * its deps change - and a page's deps are what changes the bar's APPEARANCE,
   * not what its handlers close over. Setup > Charge Groups registered
   * `[editing, form.name, form.lines.length, saving]`; typing a rate into a
   * line changes none of them, so Save kept running the closure captured when
   * the line was first ADDED - and saved a group whose only charge line was
   * still blank. The server dropped the blank line, the list said zero, and
   * nothing anywhere reported an error.
   *
   * Cheap on purpose: it writes a ref and never sets state, so an extra render
   * costs nothing and the bar still only redraws when its signature moves. */
  const refresh = useCallback((owner, actions) => {
    if (actionsRef.current?.owner !== owner) return;
    actionsRef.current = { owner, actions };
  }, []);

  const release = useCallback((owner) => {
    if (actionsRef.current?.owner !== owner) return;
    actionsRef.current = null;
    setSignature('');
  }, []);

  const value = useMemo(
    () => ({ actionsRef, signature, claim, refresh, release }),
    [signature, claim, refresh, release],
  );

  return <PageActionsContext.Provider value={value}>{children}</PageActionsContext.Provider>;
};

/**
 * Declare this page's header and actions.
 *
 * CALL IT ABOVE ANY EARLY RETURN. It is a hook, so it has to run on every
 * render of the page - and most screens here return a spinner while they
 * fetch:
 *
 *     if (loading) return <Spin />;     <-- the call must be ABOVE this
 *
 * Below that guard it runs on the renders that get past it and not on the
 * ones that do not, and React refuses with "Rendered more hooks than during
 * the previous render" - a runtime error on the screen, not a warning in the
 * console. The natural place to put the call is right before the page's
 * `return (`, which on a screen that loads is exactly the wrong side of it.
 *
 * Registering early costs nothing: a page whose record has not arrived yet
 * declares a Save that is `disabled` until it has, which is what the disabled
 * state is for.
 *
 * PASS null TO REGISTER NOTHING. A component shared between a page of its own
 * and a modal or a tab inside some other page - InvoiceCharges is all three -
 * still has to call the hook unconditionally, but must only claim the toolbar
 * where it IS the page. Claiming from inside a job's Invoice tab would put the
 * invoice's Delete where the job's Save belongs. Passing null claims nothing
 * and releases nothing, so the host page keeps its own registration.
 *
 * @param {Object} actions  `title`, optional `subtitle`, then slot key ->
 *                          { onClick, disabled, title, label, busy, confirm }.
 *                          An extra with a boolean `pressed` is a TOGGLE: it
 *                          says whether it is on (aria-pressed) and looks it.
 *                          An optional `extras` array carries verbs that
 *                          belong to one screen only; they are drawn AFTER the
 *                          standard slots, never between them, so the five
 *                          fixed positions stay fixed.
 * @param {Array}  deps     when those actions have actually changed.
 */
export const usePageActions = (actions, deps = []) => {
  const { claim, refresh, release } = useContext(PageActionsContext);
  // A stable identity for this mounted page, so it can only clear its own
  // registration. Symbol rather than a counter: two pages cannot collide.
  const owner = useRef(null);
  if (owner.current === null) owner.current = Symbol('page-actions');

  useEffect(() => {
    // Nothing to declare: leave whatever the host page registered alone.
    if (!actions) return undefined;
    const me = owner.current;
    claim(me, actions);
    return () => release(me);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  /* NO DEPENDENCY ARRAY, deliberately: this runs after EVERY render and keeps
   * the handlers current.
   *
   * `deps` says when the bar looks different. It cannot also say when a
   * handler's closure is stale, because a handler closes over everything the
   * page has - every field of a form the deps say nothing about. Pressing Save
   * must run the newest one, or it saves what the screen held several
   * keystrokes ago. */
  useEffect(() => {
    if (actions) refresh(owner.current, actions);
  });
};

/**
 * DO THE ACTION - from a click, or from its keyboard shortcut.
 *
 * Shared between the two on purpose, and this is the part that matters: the
 * confirmation lives HERE rather than in the button's handler, so a shortcut
 * cannot be a way around it. Alt+D opens the same question the Delete button
 * opens; it does not delete.
 *
 * A destructive action asks first, in one place, so one screen cannot quietly
 * be the one that deletes without asking. Through the app's own PopConfirm
 * (antd) rather than window.confirm: the browser's dialog cannot be styled,
 * names the site rather than the record, and offers OK/Cancel where the button
 * should say Delete. The eight screens that already ask before deleting ask
 * this way.
 *
 * `confirm` may be a string - the question's body - or an object for the cases
 * that want to name what is being deleted.
 */
const runAction = (live, kind, label) => {
  if (!live || !live.onClick) return;

  if (live.confirm) {
    const c = typeof live.confirm === 'string' ? { body: live.confirm } : live.confirm;
    if (kind === 'danger' && c.title) {
      // A danger that is not a deletion - Cancel Job, Cancel Flight - asks
      // its own question rather than "Delete cancel job?".
      PopConfirm(c.title, c.body || '', live.onClick, { danger: true, okText: c.okText || label });
    } else if (kind === 'danger') {
      confirmDelete({
        what: c.what || (label.toLowerCase().startsWith('delete') ? 'this' : label.toLowerCase()),
        name: c.name,
        body: c.body,
        okText: c.okText || label,
        onOk: live.onClick,
      });
    } else {
      PopConfirm(c.title || `${label}?`, c.body || '', live.onClick, { okText: label });
    }
    return;
  }

  live.onClick();
};

/**
 * One icon button.
 *
 * `action` is what it LOOKS like, from the render that drew it. `resolve()` is
 * what it DOES, read at the moment of the click.
 *
 * The two are separate on purpose. The bar only re-renders when its appearance
 * changes (see the provider's signature), so a page that re-registers without
 * changing how it looks leaves this component holding the handler from an
 * earlier render - and pressing Save would then save what was on screen
 * several renders ago. Resolving at click time is what makes "do not re-render
 * needlessly" and "never act on stale state" both true.
 */
const ActionButton = ({ slot, action, resolve }) => {
  const declared = Boolean(action && action.onClick);
  const off = !declared || action.disabled || action.busy;
  const kind = (action && action.kind) || slot.kind;
  const label = (action && action.label) || slot.label;
  const Icon = (action && action.Icon) || slot.Icon;
  /* A WORD WHERE THE GLYPH GOES.
   *
   * The five fixed slots are icons, and rightly - Save, Delete and Print are
   * universal enough to be drawn. An extra that opens a particular DOCUMENT is
   * not: there is no picture of a PFM, and the fallback of showing the label's
   * first letter puts a bare "V" in the row, which names nothing.
   *
   * So a short document code may be given instead, and the square grows to fit
   * it rather than the word being shrunk into the square. Two to four
   * characters - it sits in a 32px row beside icons, and anything longer stops
   * reading as a glyph and starts reading as a button that forgot to collapse. */
  const glyph = action && action.glyph;
  /* A TOGGLE - a setting the page is in, like Live updates - says whether it
   * is on, to the eye and to a screen reader. Only when the page gives
   * `pressed` as a boolean: every other button is a verb, with no state. */
  const toggle = Boolean(action) && typeof action.pressed === 'boolean';
  const pressed = toggle && action.pressed;

  /* The REASON, where the button is off. A greyed icon with no explanation is
   * the thing people file tickets about, and "not on this page" and "not yet"
   * are different answers.
   *
   * `title` is what the tooltip shows - the label, or more. `tooltip` is only
   * what it adds to the label, given to a screen reader as the button's
   * description (the label is already its name). */
  const base = !declared
    ? `${label} — not available on this page`
    : (action.title || (action.busy ? `${label} — working…` : label));
  /* The keystroke is named on the button it fires, and only where the button
     can actually be pressed - advertising Alt+S on a greyed Save would be
     offering something that does nothing. */
  const hint = declared && !off ? shortcutLabelFor(slot.key) : '';
  const title = hint ? `${base} · ${hint}` : base;
  const tooltip = title === label ? undefined : title;

  const onClick = () => {
    if (off) return;
    // The CURRENT page's current closure, not the one this render captured.
    const live = (resolve ? resolve() : null) || action;
    runAction(live, kind, label);
  };

  /* THE NAME FLOATS BELOW THE BUTTON (ActionTip), with the shortcut or the
     reason it is off. The button used to widen and slide its label out to the
     right, pushing every button after it away from the pointer - people
     aiming at one pressed the next (2026-11-12). The bar is at the top of the
     page, so the name goes underneath, over the page rather than off it. */
  return (
    <ActionTip tip={title} placement='bottom'>
    <button
      type='button'
      className={`page-action page-action-${kind}${off ? ' is-off' : ''}${pressed ? ' is-pressed' : ''}`}
      disabled={off}
      aria-label={label}
      // What the tooltip adds to the name - the reason, the shortcut - for a
      // screen reader too.
      aria-description={tooltip}
      aria-pressed={toggle ? pressed : undefined}
      onClick={onClick}
    >
      <span className={`pa-icon${glyph ? ' pa-icon-text' : ''}`}>
        {glyph || (Icon ? <Icon /> : label.charAt(0))}
      </span>
    </button>
    </ActionTip>
  );
};

/**
 * The header itself - title on the left, actions on the right.
 *
 * Nothing declared, nothing drawn: an unconverted page keeps its own title row
 * and this renders no second one.
 */
export const PageActionBar = () => {
  // `signature` is read so this re-renders when the bar's appearance changes;
  // the actions themselves come from the ref, which is always the current
  // page's current closures. See the provider.
  const { actionsRef, signature } = useContext(PageActionsContext);

  /* THE SHORTCUTS - Alt+S, Alt+P, Alt+E, Alt+N, Alt+D.
   *
   * Registered here, once, rather than on each page: the bar already is the
   * one thing that knows what every screen can do, and a page declaring its
   * actions gets the keystrokes for free without knowing they exist.
   *
   * READ FROM THE REF AT KEYPRESS TIME, never from a captured render. The bar
   * only re-renders when its APPEARANCE changes, so a page that re-registers
   * without looking different would leave a captured handler several renders
   * stale - and Alt+S would save what was on screen a dozen keystrokes ago.
   * Same reasoning as `resolve` on the buttons.
   *
   * NO DEPENDENCY ARRAY BEYOND THE REF, which is stable: there is nothing to
   * re-subscribe for, because the handler looks everything up when it runs.
   */
  useEffect(() => {
    const onKeyDown = (e) => {
      const slot = actionForKey(e);
      if (!slot) return;

      // Not while typing. Alt+letter produces a character on several keyboard
      // layouts, and a Save that fires mid-word - or worse, a Delete - is a
      // far worse trade than not having the shortcut in a text box.
      if (isTypingTarget(e.target)) return;

      const live = actionsRef.current?.actions?.[slot];
      // "When available" means exactly what the greyed-out button means: a
      // page that does not offer this verb must not have it fired on it.
      if (!isActionAvailable(live)) return;

      const def = SLOTS.find((x) => x.key === slot);
      e.preventDefault();
      e.stopPropagation();
      runAction(live, live.kind || def?.kind, live.label || def?.label || slot);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actionsRef]);

  const actions = signature ? actionsRef.current?.actions : null;
  if (!actions) return null;

  const extras = Array.isArray(actions.extras) ? actions.extras : [];

  return (
    <div className='page-header-bar'>
      <div className='page-header-title'>
        <h4>{actions.title || ''}</h4>
        {actions.subtitle ? <span className='page-header-sub'>{actions.subtitle}</span> : null}
      </div>

      <div className='page-header-actions'>
        {SLOTS.map((slot) => (
          <ActionButton
            key={slot.key}
            slot={slot}
            action={actions[slot.key]}
            resolve={() => actionsRef.current?.actions?.[slot.key]}
          />
        ))}
        {extras.length > 0 && <span className='page-action-sep' />}
        {extras.map((x) => (
          <ActionButton
            key={x.key}
            slot={{ key: x.key, label: x.label, kind: x.kind || 'plain', Icon: x.Icon }}
            action={x}
            resolve={() => (actionsRef.current?.actions?.extras || []).find((e) => e.key === x.key)}
          />
        ))}
      </div>

      <style jsx global>{`
        /* THE PAGE BELOW HAS TO GIVE BACK THE HEIGHT THIS BAR TAKES.
         *
         * .dashboard-styles .base-page-layout is height:84vh with its own
         * overflow, so a page scrolls INSIDE itself and the document never
         * grows. This bar is 53px of new height above that fixed box, which
         * pushed the total past the viewport - the document then scrolls, and
         * the sidebar (maxHeight:100vh, not sticky) slides off the top with
         * it. That reads as the sidebar breaking, on every converted screen.
         *
         * Taken off the page rather than fixed by making the sider sticky:
         * the layout's promise is that only the page scrolls, and a sticky
         * sider would paper over a document that should not have been
         * scrollable in the first place.
         *
         * A SIBLING SELECTOR so it applies only where the bar exists - the
         * hundred-odd unconverted pages keep their full 84vh. */
        .page-header-bar ~ .content-tabs .base-page-layout {
          height: calc(84vh - 53px);
        }

        .page-header-bar {
          /* 53px: 32px button + 10px padding top and bottom + 1px border.
             The calc above depends on this, so the two are stated together. */
          box-sizing: border-box;
          min-height: 53px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          background: #fff;
          border: 1px solid #e9edf2;
          border-top: 0;
          flex-wrap: wrap;
        }
        .page-header-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
        .page-header-title h4 {
          margin: 0; font-size: 17px; font-weight: 700; color: #1f2937;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .page-header-sub { font-size: 12px; color: #8a97a3; }

        .page-header-actions { display: flex; align-items: center; gap: 6px; }

        /* Even, and the same size whatever the icon inside it - a row of
           buttons that each fit their own glyph is a row that never lines up,
           and this one is read by position.

           A 32px square that never changes size: its name is a tooltip
           (ActionTip), so no button moves while the pointer travels along
           the row. It used to grow to the right to show the word, moving
           every button after it. */
        .page-header-bar .page-action {
          height: 32px; min-width: 32px; padding: 0;
          display: inline-flex; align-items: center;
          overflow: hidden;
          border: 1px solid transparent;
          border-radius: 8px;
          font-size: 15px;
          background: #eef2f6;
          color: #1f2937;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .page-header-bar .pa-icon {
          flex: 0 0 32px; width: 32px; height: 32px;
          display: inline-flex; align-items: center; justify-content: center;
        }
        /* The word-glyph above. Full height with the rest of the row so the
           buttons still line up, but sized to its own text - and never
           wrapping, because a two-line glyph would make the whole bar taller. */
        .page-header-bar .pa-icon-text {
          flex: 0 0 auto;
          width: auto;
          padding: 0 9px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
        /* The name is a tooltip (ActionTip), shown on hover and on keyboard
           focus - for disabled buttons too: knowing what the greyed one IS is
           how its position gets learned. The button no longer widens to show
           it, so the row never moves under the pointer. */
        .page-header-bar .action-tip { display: inline-flex; }
        .page-header-bar .page-action-primary { background: rgb(31 41 55); color: #fff; }
        .page-header-bar .page-action-primary:hover { background: rgb(55 65 81); }
        .page-header-bar .page-action-danger  { background: rgb(146, 26, 18); color: #fff; }
        .page-header-bar .page-action-danger:hover { background: rgb(170, 40, 30); }
        .page-header-bar .page-action-excel   { background: #1D6F42; color: #fff; }
        .page-header-bar .page-action-excel:hover { background: #24854f; }
        .page-header-bar .page-action-plain:hover { background: #dde4ea; }
        /* A toggle that is ON: green, ringed, so it reads as a state the page
           is in rather than a button waiting to be pressed. */
        .page-header-bar .page-action.is-pressed { background: #e3f4ea; color: #1D6F42; border-color: #8fcca8; }
        .page-header-bar .page-action.is-pressed:hover { background: #d3eddd; }

        /* OFF IS FLAT AND GREY, never the action's own colour dimmed: a washed
           red still reads as a red button, and this row is mostly disabled on
           any page that does not use all five.

           GREY, THOUGH, NOT INVISIBLE. The first pass took the glyph down to
           #c3cad2 and the icons all but vanished - a button you cannot make
           out is one you cannot learn the position of, which is the whole
           reason the disabled ones are shown at all. The contrast now carries
           the glyph (about 4.3:1 on its own background, where the enabled ones
           sit near 12:1) and the difference between on and off is left to
           weight and colour rather than to fading it out. */
        .page-header-bar .page-action.is-off,
        .page-header-bar .page-action.is-off:hover {
          background: #f2f5f8;
          color: #6b7684;
          border-color: #dfe5ec;
          cursor: not-allowed;
        }

        .page-header-bar .page-action-sep {
          width: 1px; height: 20px; background: #e9edf2; margin: 0 4px;
        }

        @media (max-width: 640px) {
          .page-header-bar { align-items: flex-start; }
          .page-header-title h4 { white-space: normal; }
        }
      `}</style>
    </div>
  );
};

export default PageActionBar;
