import { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';

/**
 * What the signed-in user may do - GET /authRoutes/myPermissions - for a
 * screen that shows or hides a part by it: a job's Charges tab, the Parties
 * screen's create buttons (the user's request, 2026-10-10: job details apart
 * from job charges; Non-GL, Customer and Vendor parties apart).
 *
 * Asked once a session and shared. Until the answer is in, and if it cannot
 * be had, everything is offered: the server decides every request regardless,
 * and a screen that blanks itself on a slow network is worse than one that
 * offers a button the server then refuses.
 *
 *   const can = useMyPermissions();
 *   can('jobCharges', 'edit')
 */
let pending = null;
let known = null;

export const resetMyPermissions = () => { pending = null; known = null; };

const fetchMine = () => {
  if (!pending) {
    let request;
    try { request = axiosClient.get('/authRoutes/myPermissions'); } catch (_) { return Promise.resolve(null); }
    pending = Promise.resolve(request)
      .then(({ data } = {}) => {
        known = data?.status === 'success'
          ? { all: Boolean(data.result?.all), granular: Boolean(data.result?.granular), perms: new Set(data.result?.perms || []) }
          : null;
        return known;
      })
      .catch(() => { pending = null; return null; });
  }
  return pending;
};

/** A checker for a set of grants; null grants (not known) allow everything.
 *  `.granular`: the user's rights are set in the permission grid. */
export const checker = (grants) => {
  const can = (module, action) => !grants || grants.all || grants.perms.has(`${module}:${action}`);
  can.all = Boolean(grants?.all);
  can.granular = Boolean(grants?.granular);
  return can;
};

/** For code outside a component (a screen's states file): the grants already
 *  read this session - by any screen's useMyPermissions - or, until then,
 *  everything, as the hook does. */
export const canNow = (module, action) => checker(known)(module, action);

export function useMyPermissions() {
  const [grants, setGrants] = useState(known);
  useEffect(() => {
    let alive = true;
    if (!known) fetchMine().then((g) => { if (alive && g) setGrants(g); });
    return () => { alive = false; };
  }, []);
  return checker(grants);
}
