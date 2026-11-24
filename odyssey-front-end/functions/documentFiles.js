/**
 * Documents attached to records - scans on a job, a voucher, an invoice (the
 * user's request, 2026-11-13). What the screen can tell about a file before
 * sending it, and how each kind is shown.
 *
 * The server decides (functions/documents/store.js there): it checks the
 * size, the type and that the file really is what its name says, and sends
 * its limits with every list. These defaults are only for before that list
 * has arrived. Checking here too means a 40 MB scan is turned away at once,
 * rather than after the minute it takes to send.
 *
 * HOW EACH IS OPENED (the user's request): PDFs in the browser's own viewer,
 * in a new tab; images in Odyssey, in a viewer over the page - both behind
 * the eye, with download beside it; Word, Excel and TIFF (which browsers
 * cannot draw) only download.
 */

export const DEFAULT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.doc', '.docx', '.xls', '.xlsx'],
};

export const extensionOf = (name) => {
  const m = /\.[^./\\]+$/.exec(String(name || ''));
  return m ? m[0].toLowerCase() : '';
};

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`; // a drive's free space
}

/** Why this file cannot be attached, or null when it can. */
export function checkFile(file, limits = DEFAULT_LIMITS) {
  const name = file?.name || 'This file';
  const ext = extensionOf(file?.name);
  if (!limits.extensions.includes(ext)) {
    return `${name}: ${ext ? `${ext} files` : 'files without an extension'} cannot be attached. `
      + 'Attach PDF, images (JPG, PNG, WEBP, TIFF), Word or Excel files.';
  }
  if (!file.size) return `${name} is empty.`;
  if (file.size > limits.maxBytes) return `${name} is ${formatSize(file.size)} - the limit is ${formatSize(limits.maxBytes)}.`;
  return null;
}

/** For its icon: 'pdf' | 'image' | 'word' | 'excel' | 'file'. */
export function fileKind(name) {
  const ext = extensionOf(name);
  if (ext === '.pdf') return 'pdf';
  if (['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'].includes(ext)) return 'image';
  if (['.doc', '.docx'].includes(ext)) return 'word';
  if (['.xls', '.xlsx'].includes(ext)) return 'excel';
  return 'file';
}

/** The server's reason a request failed, or a plain one. */
export const reasonOf = (err, fallback) => {
  const r = err?.response?.data?.result;
  if (typeof r === 'string' && r) return r;
  if (err?.response?.status === 413) return 'The file is over the size limit.';
  return fallback;
};
