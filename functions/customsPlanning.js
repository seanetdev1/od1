import Cookies from 'js-cookie';
import { isCustomsMode } from 'functions/terminology';

/**
 * JOB PLANNING - the customs Program Book - on or off for this install
 * (Configuration > Customs).
 *
 * Kept in a cookie, as the operation mode is, because the sidebar is built
 * synchronously on every render and cannot wait for a request: MainLayout
 * reads the setting when the app opens and remembers it here, and the Customs
 * tab remembers it again when an admin changes it. The server is the real
 * gate - its /customsJob/plans routes refuse while it is off - so a stale
 * cookie can show or hide a menu entry, never open the book.
 */
export const PLANNING_COOKIE = 'customsPlanning';

/** Whether the Program Book is offered: a customs install with planning on. */
export const isPlanningOn = () => isCustomsMode() && Cookies.get(PLANNING_COOKIE) === 'true';

export const rememberPlanning = (enabled) => {
  Cookies.set(PLANNING_COOKIE, enabled ? 'true' : 'false', { expires: 3650 });
};
