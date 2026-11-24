import React, { useEffect, useRef, useState } from 'react';

/**
 * "DRAFT" across every printed page of an invoice that has not been approved.
 *
 * An unapproved invoice is not in the ledger and can still change - customs
 * raises every invoice unapproved for the director - so a copy of one must not
 * be mistakable for the issued document.
 *
 * DRAWN OVER the page, faintly, not behind it: Bootstrap paints every table
 * cell white, so a watermark underneath would show only in the margins.
 *
 * ONCE PER PAGE, as a background tile 297mm tall (A4) repeated down a layer
 * laid over the invoice. Two things decide that layer's shape:
 *
 *   - NOT position:fixed, which Chrome repeats on every page of the print
 *     job - in a bulk print that stamps DRAFT on the approved invoices too.
 *     Nor a background on @page: Chrome does not paint one.
 *   - It runs to the END OF THE INVOICE'S LAST PAGE, not to the end of its
 *     content: a layer the height of the content stopped part-way down the
 *     last page and cut the word off there - "FT" was all a long invoice's
 *     last page showed. So it measures the invoice and rounds up to whole
 *     pages, less a little, so that it can never spill onto a page of its own.
 *
 * The parent must be position:relative, start at the top of a page, and be
 * laid out when it is printed - NOT inside display:none, which has no height
 * to measure (it then falls back to the content's height).
 */
export const isDraftInvoice = (invoice) => Boolean(invoice) && String(invoice.approved) !== '1';

const PX_PER_MM = 96 / 25.4;
const PAGE_PX = 297 * PX_PER_MM;   // A4
const SLACK_PX = 4 * PX_PER_MM;    // short of the page end, never past it

/** The layer's height for content this tall: whole pages, less the slack. */
export const draftLayerHeight = (contentPx) => (contentPx > 0
  ? Math.ceil(contentPx / PAGE_PX) * PAGE_PX - SLACK_PX
  : null);

const TILE = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 210 297'>"
  + "<text x='105' y='148.5' text-anchor='middle' dominant-baseline='middle'"
  + " transform='rotate(-45 105 148.5)' font-family='Arial, Helvetica, sans-serif'"
  + " font-size='60' font-weight='700' letter-spacing='4' fill='#000' fill-opacity='0.09'>DRAFT</text>"
  + '</svg>',
);

const DraftWatermark = ({ invoice }) => {
  const ref = useRef(null);
  const [height, setHeight] = useState(null);
  const draft = isDraftInvoice(invoice);

  // Re-measured as the invoice changes size - its lines arrive after it mounts.
  useEffect(() => {
    const root = draft && ref.current ? ref.current.parentElement : null;
    if (!root) return undefined;
    const measure = () => setHeight(draftLayerHeight(root.offsetHeight));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [draft]);

  if (!draft) return null;
  return (
    <div
      ref={ref}
      aria-hidden='true'
      className='draft-watermark'
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, pointerEvents: 'none',
        ...(height ? { height } : { bottom: 0 }),
        backgroundImage: `url("data:image/svg+xml,${TILE}")`,
        backgroundRepeat: 'repeat-y',
        backgroundSize: '100% 297mm',
        backgroundPosition: 'top center',
        // Background images are dropped when printing unless asked for.
        WebkitPrintColorAdjust: 'exact',
        printColorAdjust: 'exact',
      }}
    />
  );
};

export default DraftWatermark;
