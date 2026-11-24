import { useEffect, useState } from 'react';

/**
 * Whether a CSS media query matches now, kept up to date as the window
 * changes. For what CSS alone cannot change - a select's displayed text, a
 * label's words (the header's compact company and year boxes, 2026-11-23).
 * false on the server and before the first effect, so the full layout is what
 * renders first.
 */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener('change', update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else mq.removeListener(update);
    };
  }, [query]);
  return matches;
}
