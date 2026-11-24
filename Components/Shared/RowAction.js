import React from 'react';
import { confirmDelete } from 'Components/Shared/PopConfirm';
import ActionTip from 'Components/Shared/ActionTip';

/**
 * An action on one ROW of a list - edit it, delete it - as an icon that names
 * itself when the pointer or the keyboard reaches it.
 *
 * The same behaviour as the page toolbar (Components/Shared/PageActions) and
 * for the same reason: a table cannot spare the width for a column of worded
 * buttons, but an icon nobody can name is a guess, and a red dustbin is a
 * guess with consequences. So the word appears ABOVE the icon (ActionTip) -
 * it used to slide out beside it, widening the button and pushing the next
 * one away from the pointer - and the button carries its label as its
 * accessible name throughout.
 *
 * WHAT THIS REPLACES is a <td> with an onClick and an icon inside it. That has
 * three problems worth naming, since they are the reason this exists rather
 * than a style tweak:
 *
 *   - a cell is not a control. It cannot be tabbed to, cannot be pressed with
 *     the keyboard, and reads as nothing to a screen reader.
 *   - the whole cell is the target, so the click lands wherever in the column
 *     the pointer happens to be - including the padding beside the icon.
 *   - "disabled" was done by changing the icon's COLOUR while the click still
 *     fired, so a greyed dustbin still did something.
 *
 * `confirm` takes the same shape as the toolbar's: a string is the body of the
 * question, an object can name the record. Destructive actions ask through the
 * app's own dialog rather than each caller remembering to.
 */
const RowAction = ({
  Icon,
  label,
  onClick,
  kind = 'plain',   // 'plain' | 'danger' | 'primary'
  disabled = false,
  title,            // why it is disabled, or what it does
  confirm,          // string, or { what, name, body, okText }
}) => {
  const off = Boolean(disabled);

  const run = () => {
    if (off) return;
    if (confirm) {
      const c = typeof confirm === 'string' ? { body: confirm } : confirm;
      confirmDelete({
        what: c.what || label.toLowerCase(),
        name: c.name,
        body: c.body,
        okText: c.okText || label,
        onOk: onClick,
      });
      return;
    }
    onClick();
  };

  /* THE NAME FLOATS ABOVE - see ActionTip. The button used to widen and slide
     the label out to the right, pushing the next button away from a pointer
     on its way to it, so people pressed the one after. The extra line (why
     it is off, or what it does) goes under the name. */
  const more = title && title !== label ? title : '';
  const tip = more
    ? <><div style={{ fontWeight: 600 }}>{label}</div><div>{more}</div></>
    : label;

  return (
    <ActionTip tip={tip}>
    <button
      type='button'
      className={`row-action row-action-${kind}${off ? ' is-off' : ''}`}
      disabled={off}
      aria-label={label}
      aria-description={more || undefined}
      onClick={(e) => {
        // Rows are usually clickable themselves - opening the record - and an
        // action inside one must not also do that.
        e.stopPropagation();
        run();
      }}
    >
      <span className='ra-icon'>{Icon ? <Icon /> : label.charAt(0)}</span>

      <style jsx global>{`
        /* THE GLYPH IS THE THING BEING READ, so it carries most of the size.
           At 14px in a 26px box these were a pencil and a bin drawn at the
           size of body text, in a column with nothing beside them to give
           them scale - they read as marks rather than as controls.
           17px is a clear step up while the box grows by only 2px, which
           matters: the customs charge sheet puts one of these on every line
           of a table whose headers are 11px, and sizing the box to match the
           toolbar's 32px would have added six pixels to every row of it. */
        .row-action {
          height: 28px; width: 28px; padding: 0;
          display: inline-flex; align-items: center;
          overflow: hidden;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: #6b7684;
          font-size: 17px;
          cursor: pointer;
          vertical-align: middle;
          transition: background 0.12s, color 0.12s;
        }
        .row-action .ra-icon {
          flex: 0 0 28px; width: 28px; height: 28px;
          display: inline-flex; align-items: center; justify-content: center;
        }
        /* A FIXED SQUARE. It used to widen on hover to slide its label out,
           moving every button after it - the name is a tooltip now
           (ActionTip). */
        .action-tip { display: inline-flex; vertical-align: middle; }

        .row-action-plain:hover   { background: #eef2f6; color: #1f2937; }
        .row-action-primary       { color: #438995; }
        .row-action-primary:hover { background: #e8f1f2; color: #2f6b74; }
        .row-action-danger        { color: #c0392b; }
        .row-action-danger:hover  { background: #fdecea; color: #a3282a; }

        /* Off is flat and grey and CANNOT be pressed - the old version greyed
           the icon and fired anyway. */
        .row-action.is-off,
        .row-action.is-off:hover {
          color: #c3cad2; background: transparent; cursor: not-allowed;
        }
      `}</style>
    </button>
    </ActionTip>
  );
};

export default RowAction;
