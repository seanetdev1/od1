import axiosClient from './axiosClient';

// The PFM - the pre-flight manifest a flight is built from.
//
// Under /aviationJob/pfm rather than a path of its own: it is part of the
// aviation module and reads tables only that module owns, so nothing here can
// be reached from a freight or customs install. Same reasoning as apis/
// awbStock.js, which sits under the same router for the same reason.
const BASE = `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/aviationJob/pfm`;

/**
 * The register of plans.
 *
 * `flight` is a contains-match on the flight number AND the PFM number - those
 * are the two things anyone has in front of them when they come looking.
 */
export function getPfms({ companyId, flight, status } = {}) {
  return axiosClient
    .get(`${BASE}/get`, { params: { companyId, flight, status } })
    .then((x) => x.data);
}

export function getPfmById({ id }) {
  // "new" never reaches the server - there is nothing to fetch for a plan that
  // does not exist yet, and asking would be a guaranteed 404. The string forms
  // of undefined/null are caught here too: they come from a URL built out of a
  // missing tab id, and are not a PFM anyone can load. Same guard, and the
  // same reason for it, as getAviationJobById.
  if (!id || id === 'new' || id === 'undefined' || id === 'null') {
    return Promise.resolve({ status: 'success', result: null });
  }
  return axiosClient.get(`${BASE}/getById`, { params: { id } }).then((x) => x.data);
}

export function createPfm(data, employeeId) {
  return axiosClient.post(`${BASE}/create`, { data, employeeId }).then((x) => x.data);
}

export function editPfm(data, employeeId) {
  return axiosClient.post(`${BASE}/edit`, { data, employeeId }).then((x) => x.data);
}

/** Cancels rather than deletes - the number has been quoted. See the router. */
export function cancelPfm(id, employeeId) {
  return axiosClient.post(`${BASE}/delete`, { id, employeeId }).then((x) => x.data);
}

/**
 * The plans the flight screen may be built from: confirmed, not yet flown, and
 * dated today or later.
 *
 * `currentId` is the plan the flight being edited already points at, and the
 * server puts it at the head of the list whatever it fails - it is used, by
 * this very flight, which is exactly why it cannot be left to the rules. Pass
 * it on every call from a saved flight.
 *
 * Lightweight rows. The whole plan is fetched by getPfmById when one is
 * actually picked, because that is a deliberate act and the import is what
 * needs the lines.
 */
export function getSelectablePfms({ companyId, currentId } = {}) {
  return axiosClient
    .get(`${BASE}/selectable`, { params: { companyId, currentId } })
    .then((x) => x.data);
}
