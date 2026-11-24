import axios from 'axios';
import { notification } from 'antd';
import logout from 'functions/logout';
import Cookies from 'js-cookie';

// antd's `notification` directly rather than Components/Shared/Notification -
// that helper dispatches into the redux store, and this module is imported by
// almost everything (including code the store itself pulls in), so keeping the
// transport layer free of a store dependency avoids a circular import.
//
// These used to be alert(). alert() blocks the whole tab until dismissed,
// which is a bad way to tell someone a save failed and a worse way to tell
// them their session ended - it freezes the UI at exactly the moment they are
// trying to understand what happened.

const axiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL || '/api',
});

axiosInstance.interceptors.request.use(config => {
  if (typeof window !== 'undefined') {
    const token = Cookies.get('token');
    if (token) {
      config.headers.Authorization = token;
    }
    const fiscalYearId = Cookies.get('fiscalYearId');
    if (fiscalYearId) {
      config.headers['x-fiscal-year-id'] = fiscalYearId;
    }
    // The company picked in the header, on every request. The server checks
    // it against the companies this user may work in, and lists master data
    // (accounts, parties, charges...) for it where Seanet has separated them
    // per company. A request that names a company itself is unaffected.
    const companyId = Cookies.get('companyId');
    if (companyId && /^\d+$/.test(companyId)) {
      config.headers['x-company-id'] = companyId;
    }
  }
  return config;
});

let isLoggingOut = false;

// A file request's (responseType 'blob') error body is a Blob too - the JSON
// reply inside it.
const blobText = (blob) => (typeof blob.text === 'function'
  ? blob.text()
  : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  }));

axiosInstance.interceptors.response.use(
  response => response,
  async error => {
    const { response } = error;

    // Read a file request's JSON reply first, so the checks below see it as
    // they see any other: a session ended elsewhere used to read as the
    // invoice failing to print, and never took the user back to log in.
    if (typeof Blob !== 'undefined' && response?.data instanceof Blob && /json/i.test(response.data.type || '')) {
      try {
        response.data = JSON.parse(await blobText(response.data));
      } catch (_) { /* left as it came */ }
    }

    // 423 Locked: backend is in licence read-only mode and rejected a write.
    if (response?.status === 423 && typeof window !== 'undefined') {
      const msg =
        response.data?.message ||
        'The system is currently read-only. Changes cannot be saved.';
      notification.warning({
        key: 'licence-readonly', // one at a time, however many writes fail
        message: 'Read-only mode',
        description: msg,
        duration: 8,
      });
      return Promise.reject(error);
    }

    // 5xx: a genuine server-side failure. Handlers used to reply HTTP 200 with
    // {status:'error'} in the body, which meant axios resolved and any caller
    // that only checked for 'success' did nothing at all - the failure was
    // invisible. Now that those return real status codes, surface them here so
    // a rejected request can never be silent, whether or not the specific call
    // site has its own .catch(). A call that says its caller reports the
    // failure itself (`ownErrors` in its config) is left to it - it would
    // otherwise be said twice.
    if (response?.status >= 500 && typeof window !== 'undefined' && !error.config?.ownErrors) {
      const detail =
        (typeof response.data?.result === 'string' && response.data.result) ||
        response.data?.error ||
        response.data?.message ||
        'The server could not complete this request.';
      notification.error({
        key: 'server-error',
        message: 'Something went wrong',
        description: String(detail).slice(0, 300),
        duration: 8,
      });
      return Promise.reject(error);
    }

    // 403: the server refused this user the action - access control
    // (functions/permissions on the backend), or something only Seanet can
    // change. Many older screens only look for status 'success' and would
    // otherwise do nothing at all, so say why here. One at a time.
    if (response?.status === 403 && typeof window !== 'undefined') {
      const detail = typeof response.data?.result === 'string' ? response.data.result : '';
      notification.warning({
        key: 'forbidden',
        message: 'Not allowed',
        description: detail || 'You do not have permission for this.',
        duration: 6,
      });
      return Promise.reject(error);
    }

    if (response?.status === 401 && typeof window !== 'undefined') {
      const data = response.data || {};
      const sessionInvalidMessages = [
        'User logged in elsewhere',
        'Token expired',
        'Invalid token',
        'Invalid or expired token',
        // Returned when the server has no session on record for a token that
        // is otherwise valid - i.e. logged out, expired, or (before this
        // fix's DB-backed store) served by a worker that never saw the login.
        'Session expired',
        // Deactivated while signed in - the server ends the session on the
        // next request rather than when the token runs out.
        'Account deactivated',
      ];

      if (sessionInvalidMessages.includes(data.message) && !isLoggingOut) {
        isLoggingOut = true;
        notification.error({
          key: 'session-expired',
          message: 'Session ended',
          description:
            'Your session has expired or you have logged in from another device. ' +
            'Taking you back to the login page.',
          duration: 4,
        });
        // alert() used to block here, so the redirect only happened once the
        // user clicked OK. A toast doesn't block, so give it a moment to be
        // read before the route change tears it down.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await logout();
      }
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;