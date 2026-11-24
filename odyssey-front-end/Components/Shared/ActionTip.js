import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';

/**
 * The name of an icon button, floating ABOVE it - for the page toolbar
 * (PageActions) and a list's row buttons (RowAction).
 *
 * WHY NOT THE OLD WAY. The button used to widen on hover and slide its label
 * out to the right. That pushed every button after it to the right as well,
 * so a pointer travelling from one button to the next chased a moving target
 * - and when it left the first, that one shrank back and the row slid under
 * the pointer again. People aiming at the second button pressed the third
 * (reported 2026-11-12). Here the button never changes size; only the label
 * appears, over the page, where it covers nothing that is being aimed at.
 *
 * WHEN IT SHOWS:
 *   - pointing at the button, after a moment's pause (a pointer passing over
 *     a row of them does not flash every label on the way);
 *   - reaching it with the KEYBOARD (Tab) - straight away, since that is how
 *     a keyboard user learns what they are on. Not on a mouse click's focus;
 *   - gone on leaving, on blur, and as soon as the button is pressed.
 * A disabled button sends no pointer events, so the wrapper listens for it:
 * the reason a button is off is exactly what people need to read.
 *
 * Rendered through antd's Tooltip into the page body, so a table's scroll
 * box cannot clip it on the last row of a list.
 */
const HOVER_DELAY_MS = 150;

const focusVisible = (el) => {
  try { return Boolean(el && el.matches && el.matches(':focus-visible')); } catch (_) { return false; }
};

export default function ActionTip({ tip, children, placement = 'top' }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const show = (delay) => {
    clear();
    if (delay) timer.current = setTimeout(() => setOpen(true), delay);
    else setOpen(true);
  };
  const hide = () => { clear(); setOpen(false); };
  useEffect(() => clear, []);

  if (!tip) return children;

  return (
    <Tooltip title={tip} open={open} placement={placement} trigger={[]} destroyTooltipOnHide>
      <span
        className='action-tip'
        onMouseEnter={() => show(HOVER_DELAY_MS)}
        onMouseLeave={hide}
        onMouseDown={hide}
        onFocus={(e) => { if (focusVisible(e.target)) show(0); }}
        onBlur={hide}
        onKeyDown={(e) => { if (e.key === 'Escape') hide(); }}
      >
        {children}
      </span>
    </Tooltip>
  );
}
