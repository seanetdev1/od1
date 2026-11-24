import { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';

/**
 * Is "One of each charge per job" on for this install? (Configuration >
 * Direct Job, asked 2026-11-17.) On, a job's charge sheet turns back a charge
 * picked for a side that already has it - the server refuses the save as well
 * (the backend's functions/jobChargeRepeats).
 *
 * Asked once a session and shared. Off until the answer is in, and if it
 * cannot be had: the server's check on save is the one that holds.
 */
let pending = null;
let known = null;

export const resetUniqueJobCharges = () => { pending = null; known = null; };

const fetchIt = () => {
  if (!pending) {
    let request;
    try { request = axiosClient.get('/settings/uniqueJobCharges'); } catch (_) { return Promise.resolve(false); }
    pending = Promise.resolve(request)
      .then(({ data } = {}) => { known = Boolean(data?.result?.enabled); return known; })
      .catch(() => { pending = null; return false; });
  }
  return pending;
};

export function useUniqueJobCharges() {
  const [on, setOn] = useState(Boolean(known));
  useEffect(() => {
    let alive = true;
    if (known === null) fetchIt().then((v) => { if (alive) setOn(Boolean(v)); });
    return () => { alive = false; };
  }, []);
  return on;
}

/**
 * The other line on the same side of the sheet that already has `chargeId`,
 * or null - the line being changed itself does not count, and re-picking the
 * charge a line already has is no change at all.
 *
 * @param lines    the sheet's lines (both sides)
 * @param row      the line the charge is being picked for
 * @param chargeId the picked charge's id
 * @param same     (a, b) => are these the same charge id
 */
export const otherLineWithCharge = (lines, row, chargeId, same) => {
  if (chargeId === null || chargeId === undefined || chargeId === '') return null;
  if (same(row?.charge, chargeId)) return null;
  return (lines || []).find((c) => c !== row && c?.type === row?.type && same(c?.charge, chargeId)) || null;
};
