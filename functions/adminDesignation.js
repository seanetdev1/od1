import Cookies from 'js-cookie';

// WHO COUNTS AS AN ADMIN, for the screens that let one person do something the
// rest cannot.
//
// CEO, CFO and admin - the same three the backend's requireDesignation(['CEO',
// 'CFO', 'admin']) gates its routes with, and the same three
// functions/checkPartyCreateAccess allows. That list had been written out
// separately on every screen that needed it, which is how a fourth screen ends
// up with a fifth spelling of the same rule.
//
// THIS IS NOT A SECURITY BOUNDARY and must never be treated as one. It decides
// what a screen OFFERS; the server decides what actually happens. Anything
// gated here that is not also gated in routes/ is a convenience, not a
// restriction - see the fiscal-year picker in the header, where selecting a
// working year has no server side at all and every user may do it from the
// Fiscal Years page regardless.
const ADMIN_DESIGNATIONS = ['ceo', 'cfo', 'admin'];

/**
 * The signed-in user's designation, lowercased, or ''.
 *
 * Read from the cookie the login sets rather than decoded from the token,
 * because that is what the Setup screens already do and one source is worth
 * more here than the marginally better provenance of the other. The cookie is
 * written in Components/Layouts/Login.
 */
export const designationOf = () => (Cookies.get('designation') || '').toLowerCase();

/** Is the signed-in user a CEO, CFO or admin? */
export const isAdminDesignation = () => ADMIN_DESIGNATIONS.includes(designationOf());

export { ADMIN_DESIGNATIONS };
