/**
 * The browser tab's icon, set to the selected company's screen logo.
 *
 * The logo is the one uploaded on the Company screen (Company.logo, a data URL
 * - see functions/companyBranding). It is drawn onto a SQUARE canvas before it
 * becomes the icon: a sidebar logo is wide, and a tab squeezes whatever it is
 * given into a square, so handed over as-is it came out stretched. Drawn
 * "contain" - whole logo, centred, transparent either side.
 *
 * With no logo - no company chosen yet, or one without a logo - the icon goes
 * back to the one the page shipped with (/favicon.ico in pages/_document).
 */

const SIZE = 64;

// Which call is current. Loading a logo is asynchronous, and switching company
// twice quickly must not let the first logo land after the second.
let current = 0;

function iconLink() {
  if (typeof document === 'undefined') return null;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  // Remembered once, so every later reset goes back to the shipped icon.
  if (link.dataset.defaultHref === undefined) link.dataset.defaultHref = link.getAttribute('href') || '';
  return link;
}

function squared(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(SIZE / w, SIZE / h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(img, (SIZE - dw) / 2, (SIZE - dh) / 2, dw, dh);
    return canvas.toDataURL('image/png');
  } catch (_) {
    return null;
  }
}

/**
 * Point the tab icon at `src`, or back at the default when `src` is empty.
 * Never throws: a logo that will not load leaves the default icon in place.
 */
export function setTabIcon(src) {
  const link = iconLink();
  if (!link) return;
  const call = ++current;

  if (!src) {
    link.setAttribute('href', link.dataset.defaultHref);
    return;
  }

  const img = new Image();
  img.onload = () => {
    if (call !== current) return;
    // Where a canvas is unavailable, the logo itself is still better than
    // the default - just unsquared.
    link.setAttribute('href', squared(img) || src);
  };
  img.onerror = () => {
    if (call !== current) return;
    link.setAttribute('href', link.dataset.defaultHref);
  };
  img.src = src;
}
