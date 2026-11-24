import axiosClient from './axiosClient';

// AWB stock: the register of air waybill numbers the office holds, and who
// they have been given out to.
//
// Under /aviationJob/awb rather than a path of its own - it is part of the
// aviation module and reads the same tables, so nothing here can be reached
// from a freight or customs install.
const BASE = `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/aviationJob/awb`;

/**
 * Register one number, or a series generated from it, against a carrier.
 *
 * `masterAgentId` is optional and hands the numbers over as they are
 * registered. Setup > AWB Stock leaves it out - a block arrives from the
 * airline and is given out later, which is two events. The flight screen's
 * quick registration sends it, because there the number is already on a
 * document that has been handed over, and one registered to nobody would not
 * even appear in the row's own dropdown.
 */
export function registerAwbs({ carrierId, masterAgentId, code, series, count, remarks, employeeId }) {
  return axiosClient
    .post(`${BASE}/register`, { carrierId, masterAgentId, code, series, count, remarks, employeeId })
    .then((x) => x.data);
}

/**
 * The register, filtered and paged on the server.
 *
 * `status` is one of all | available | assigned | unassigned | used | unused |
 * voided. Pass `all: true` for the whole filtered set rather than one page.
 */
export function getAwbList({ page, limit, search, carrierId, masterAgentId, status, all }) {
  return axiosClient
    .get(`${BASE}/list`, {
      params: { page, limit, search, carrierId, masterAgentId, status, all: all ? 1 : undefined },
    })
    .then((x) => x.data);
}

/**
 * Assign numbers to a master agent - either the ones ticked in the list
 * (`ids`), or a run starting at `code` (`carrierId` + `series` + `count`).
 *
 * The server checks the WHOLE set before writing anything, so a run that
 * overlaps another agent's numbers is refused outright rather than assigned
 * as far as the first clash.
 */
export function assignAwbs({ masterAgentId, ids, carrierId, code, series, count, employeeId }) {
  return axiosClient
    .post(`${BASE}/assign`, { masterAgentId, ids, carrierId, code, series, count, employeeId })
    .then((x) => x.data);
}

/**
 * Take numbers back off a master agent and return them to office stock.
 *
 * Refused for any already on a flight - the consignment names the AWB and the
 * agent it went out to - and for any voided one, which stays with the agent it
 * was voided under.
 */
export function unassignAwbs({ ids, employeeId }) {
  return axiosClient.post(`${BASE}/unassign`, { ids, employeeId }).then((x) => x.data);
}

/** Remove a number that should never have been registered. Unused only. */
export function deleteAwb({ id, employeeId }) {
  return axiosClient.post(`${BASE}/delete`, { id, employeeId }).then((x) => x.data);
}

/**
 * Mark numbers unusable - a torn, misprinted or lost air waybill.
 *
 * NOT a delete: the row stays, so the register can still answer what became of
 * a serial the airline allocated. The number stops being offered on the flight
 * screen and can no longer be assigned, unassigned or deleted.
 *
 * `reason` is required by the server - a void with no note is not a record of
 * anything. A number already on a flight is refused.
 */
export function voidAwbs({ ids, reason, employeeId }) {
  return axiosClient.post(`${BASE}/void`, { ids, reason, employeeId }).then((x) => x.data);
}

/** Undo a void. The number comes back to whoever it was with when it was voided. */
export function unvoidAwbs({ ids, employeeId }) {
  return axiosClient.post(`${BASE}/unvoid`, { ids, employeeId }).then((x) => x.data);
}

/**
 * The numbers the consignment grid's AWB dropdown picks from.
 *
 * Fetched once per flight rather than per row, and narrowed in the browser:
 * the register is a few thousand rows at most, and a request per keystroke in
 * a grid cell would be far worse.
 */
export function getAvailableAwbs({ carrierId, masterAgentId } = {}) {
  return axiosClient
    .get(`${BASE}/available`, { params: { carrierId, masterAgentId } })
    .then((x) => x.data);
}
