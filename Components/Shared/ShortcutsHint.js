import React from 'react';
import { Tooltip } from 'antd';
import { SHORTCUT_HELP } from 'functions/tabShortcuts';

/**
 * THE KEYBOARD SHORTCUTS, on hover, in the header.
 *
 * Every shortcut in the application is already named on the thing it operates
 * - the tab strip says "Alt+3" on the third tab, the toolbar says "Save ·
 * Alt+S" on Save. That is the right place to LEARN one, because you find it
 * while reaching for the thing anyway. It is the wrong place to DISCOVER that
 * any of them exist: nobody hovers a button they were about to click.
 *
 * So this is the one control whose only job is to say the rest are there. A
 * glyph in the header, and the whole list under the pointer.
 *
 * A TOOLTIP, NOT A MODAL. Asking for the shortcut list should not be a thing
 * you have to dismiss, and a panel that needs closing is one people stop
 * opening. It reads and disappears.
 *
 * THE LIST IS DERIVED, NOT TYPED. SHORTCUT_HELP is built from the same maps
 * the handlers use - see functions/tabShortcuts - so a binding cannot be
 * changed while this goes on advertising the old one. A help panel that lies
 * is worse than no help panel, because somebody believes it.
 */
const ShortcutsHint = () => (
  <Tooltip
    placement='bottomRight'
    overlayStyle={{ maxWidth: 360 }}
    title={
      <div className='shortcut-help'>
        {SHORTCUT_HELP.map((section) => (
          <div key={section.group} className='shortcut-group'>
            <div className='shortcut-group-name'>{section.group}</div>
            {section.items.map((item) => (
              <div key={item.keys} className='shortcut-row'>
                <span className='shortcut-keys'>{item.keys}</span>
                <span className='shortcut-what'>{item.what}</span>
              </div>
            ))}
          </div>
        ))}
        {/* The one qualification worth making, because it is the question the
            list immediately raises: a greyed Save does not save. */}
        <div className='shortcut-note'>
          Page shortcuts work wherever that button is available, and never while
          you are typing in a field.
        </div>
      </div>
    }
  >
    {/* A span, not a button: it does nothing when pressed, and a button that
        does nothing is a promise the control cannot keep. tabIndex keeps it
        reachable from the keyboard, which is the audience most likely to want
        it - antd shows the tooltip on focus as well as hover. */}
    <span className='shortcut-hint' tabIndex={0} aria-label='Keyboard shortcuts'>
      ⌘
      <style jsx global>{`
        .shortcut-hint {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: 1px solid #d9d9d9;
          border-radius: 6px;
          background: #fafafa;
          color: #555;
          font-size: 14px;
          line-height: 1;
          cursor: help;
          user-select: none;
        }
        .shortcut-hint:hover,
        .shortcut-hint:focus-visible { border-color: #1668dc; color: #1668dc; }

        .shortcut-help { font-size: 12px; line-height: 1.5; }
        .shortcut-group + .shortcut-group { margin-top: 8px; }
        .shortcut-group-name {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          opacity: 0.65;
          margin-bottom: 2px;
        }
        .shortcut-row { display: flex; gap: 10px; align-items: baseline; }
        /* The keys column is fixed so the descriptions line up - a list of
           shortcuts is read down the key column, not across. */
        .shortcut-keys {
          flex: 0 0 108px;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
          white-space: nowrap;
        }
        .shortcut-what { flex: 1 1 auto; opacity: 0.9; }
        .shortcut-note {
          margin-top: 8px;
          padding-top: 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.18);
          font-size: 11px;
          opacity: 0.75;
        }
      `}</style>
    </span>
  </Tooltip>
);

export default ShortcutsHint;
