import axiosClient from 'apis/axiosClient';

// Which installation this is, and what it is running.
//
// /health is PUBLIC - answerable before login - and carries the backend's
// version, its INSTALL_ID and whether the schema sync is unhappy. That makes
// it the one place the frontend can ask "which install am I?" without a
// session, which is why the browser tab can be named on the login screen too.
//
// FETCHED ONCE PER PAGE LOAD. The promise is memoised rather than the value,
// so several callers mounting at the same moment share one request instead of
// racing each other into three - the title, the version chip in the header,
// and anything added later all wait on the same one.
//
// It never rejects. Nothing here is important enough to break a screen over:
// callers get null and show their fallback.
let pending = null;

export const getInstallInfo = () => {
  if (!pending) {
    pending = axiosClient.get('/health')
      .then((x) => x.data || null)
      .catch(() => null);
  }
  return pending;
};

// The name this installation goes by, for the browser tab.
//
// INSTALL_ID is the right thing to show: it is what identifies one customer's
// install when they report a problem, and with several instances open at once
// - a test install beside a live one - a row of identically named tabs is
// exactly the situation where opening the wrong one does damage.
//
// Falls back to the product name rather than to nothing, so an install whose
// INSTALL_ID is unset still gets a named tab instead of a URL.
export const FALLBACK_TITLE = 'Odyssey';

export const titleFor = (info) => {
  const id = String(info?.installId || '').trim();
  return id || FALLBACK_TITLE;
};
