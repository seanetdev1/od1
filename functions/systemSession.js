import Cookies from 'js-cookie';
import jwt_decode from 'jwt-decode';

// IS THIS SESSION "SYSTEM" - Seanet on a leased install, or the admin of an
// install exempt from licensing (Seanet's own)?
//
// System owns Config and user management; a client's admin does not. Read
// from the `system` claim the backend puts in the token at sign-in.
//
// NOT A SECURITY BOUNDARY: it decides what a screen offers. The backend
// re-checks every request (functions/systemAccess.js there), verifying the
// signed support credential rather than trusting this claim.

/** The decoded session token, or null. */
export const sessionToken = () => {
  const raw = Cookies.get('token');
  if (!raw || raw === 'undefined') return null;
  try { return jwt_decode(raw); } catch (_) { return null; }
};

export const isSystemSession = (decoded = sessionToken()) => decoded?.system === true;

export default isSystemSession;
