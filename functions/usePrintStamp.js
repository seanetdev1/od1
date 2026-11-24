import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';

/**
 * Who printed it and when, for a print laid out in the page (off-screen, and
 * copied out by react-to-print or rendered for a PDF).
 *
 * The server knows neither. It has no cookie to read the user from, and its
 * clock and time zone are not the browser's. Read while rendering, the server
 * drew "Printed by :" with no name, and the browser then drew it with one.
 * React found the two did not match, threw the server's page away and drew
 * it again: a hydration error every time a voucher, a Direct Job or an
 * invoice was opened (2026-11-16).
 *
 * So both are empty until the page is in the browser, and filled in from
 * then on. The time is read on every render after that, as it always was, so
 * a print shows when the screen was last drawn.
 */
export default function usePrintStamp() {
  const [inBrowser, setInBrowser] = useState(false);
  useEffect(() => { setInBrowser(true); }, []);
  if (!inBrowser) return { at: null, by: '' };
  return { at: new Date(), by: Cookies.get('username') || '' };
}
