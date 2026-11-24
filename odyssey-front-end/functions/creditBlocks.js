import axiosClient from 'apis/axiosClient';

/* CREDIT CONTROL ON A JOB'S CLIENT BOX (the user's request, 2026-10-23).
 *
 * A party over its Credit Limit (Amount) is blocked by the daily check (the
 * backend's functions/creditControl): it cannot be picked as the CLIENT on a
 * job until an approver - CEO / CFO by default - lets it through, and an
 * approver can pick it anyway. The server refuses the save as well; this is
 * so the user hears it on the pick, with the way out (ask for approval),
 * rather than on Save.
 *
 * The list is read once a minute at most - every job screen opens with it -
 * and a pick of a listed party is checked again on the server, which lifts the
 * block there and then if the party has paid since last night.
 */
const TTL_MS = 60 * 1000;
const EMPTY = { active: false, approver: false, blocked: [], requested: [] };

let cache = null;
let cachedAt = 0;
let inFlight = null;

export const loadCreditBlocks = ({ fresh = false } = {}) => {
  if (!fresh && cache && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cache);
  if (!fresh && inFlight) return inFlight;
  // Through a promise, so a client that throws rather than rejects is caught too.
  inFlight = Promise.resolve().then(() => axiosClient.get('/creditControl/blocked'))
    .then(({ data }) => {
      cache = { ...EMPTY, ...(data?.result || {}) };
      cachedAt = Date.now();
      return cache;
    })
    // Not reachable (an older backend, offline): nothing is marked, and the
    // server still has the last word on Save.
    .catch(() => EMPTY)
    .finally(() => { inFlight = null; });
  return inFlight;
};

/** For tests. */
export const forgetCreditBlocks = () => { cache = null; cachedAt = 0; inFlight = null; };

/** Is this client one the list says is blocked? */
export const isListedBlocked = (state, clientId) => Boolean(state?.active && clientId != null && clientId !== ''
  && (state.blocked || []).some((b) => String(b.clientId) === String(clientId)));

/** The client options, a blocked party marked - for everyone, approvers too. */
export const markBlockedOptions = (options, state, { nameKey = 'name', idKey = 'id' } = {}) => {
  if (!state?.active || !(state.blocked || []).length) return options;
  const blocked = new Set(state.blocked.map((b) => String(b.clientId)));
  return (options || []).map((o) => (blocked.has(String(o[idKey]))
    ? { ...o, [nameKey]: `${o[nameKey]} — over credit limit` }
    : o));
};

/** The server's word on picking this client now: { block, approver, requested }. */
export const checkClientPick = async (clientId) => {
  const { data } = await axiosClient.post('/creditControl/check', { clientId });
  return data?.result || { block: null };
};

export const requestUnblock = async (clientId, note) => {
  const { data } = await axiosClient.post('/creditControl/requestUnblock', { clientId, note });
  return data?.result || {};
};

export const formatPkr = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
