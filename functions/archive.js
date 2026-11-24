import Cookies from 'js-cookie';

// THE ARCHIVE (old Climax books) - whether this install has one.
//
// Read once after login (MainLayout asks /archive/books) and kept in a cookie,
// as the operation mode and the Program Book are, so the sidebar - which is
// built synchronously from the session - can decide whether to offer
// Reports > Archive. An install without archive books never shows it.

export const ARCHIVE_COOKIE = 'archiveBooks';

export const isArchiveOn = () => Cookies.get(ARCHIVE_COOKIE) === 'true';

export const rememberArchive = (enabled) => {
  Cookies.set(ARCHIVE_COOKIE, enabled ? 'true' : 'false', { expires: 3650 });
};

// The book the user last picked, so the screen reopens on it.
const BOOK_KEY = 'odyssey.archive.book';

export const lastBook = () => {
  try {
    return window.localStorage.getItem(BOOK_KEY) || null;
  } catch (_) {
    return null;
  }
};

export const rememberBook = (key) => {
  try {
    if (key) window.localStorage.setItem(BOOK_KEY, key);
  } catch (_) { /* reopens on the first book instead */ }
};
