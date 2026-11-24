import React from 'react';

/**
 * Where a print copy waits for its Print button: laid out, so the print has
 * real sizes to work with, but CLIPPED TO NOTHING.
 *
 * It was the usual off-screen box - position:absolute, left:-10000px - which
 * moves a copy out of sight but not out of the page's height: a trial balance
 * of 1,900 accounts or a ledger of thousands of lines stretched the page by
 * all of its rows, and both scrollbars ran on into a screen of blank (the
 * user, 2026-11-11). Inside a 0 x 0 box that hides its overflow, the copy
 * takes no room at all. ReactToPrint prints the node inside, not this box.
 */
const PrintArea = ({ width, children }) => (
  <div aria-hidden='true' style={{ position: 'relative', width: 0, height: 0, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: 0, top: 0, ...(width ? { width } : {}) }}>{children}</div>
  </div>
);

export default PrintArea;
