import axiosClient from "./axiosClient";

// Aviation jobs API. Talks only to /aviationJob on the backend, which is a
// separate router from /seaJob - nothing here can affect the freight screens.
const BASE = `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/aviationJob`;

export function getAviationValues() {
  return axiosClient.get(`${BASE}/getValues`).then((x) => x.data);
}

export function getAviationJobs({ companyId, flight } = {}) {
  return axiosClient
    .get(`${BASE}/get`, { headers: { companyid: `${companyId ?? ''}`, flight: `${flight ?? ''}` } })
    .then((x) => x.data);
}

export function getAviationJobById({ id }) {
  // "new" never reaches the server - there is nothing to fetch for a flight
  // that does not exist yet, and asking would be a guaranteed 404. The string
  // forms of undefined/null are caught here too: they come from a URL built
  // out of a missing tab id, and are not a flight anyone can load.
  if (!id || id === 'new' || id === 'undefined' || id === 'null') {
    return Promise.resolve({ status: 'success', result: null });
  }
  return axiosClient.get(`${BASE}/getById`, { headers: { id: `${id}` } }).then((x) => x.data);
}

export function createAviationJob(data, employeeId) {
  return axiosClient.post(`${BASE}/create`, { data, employeeId }).then((x) => x.data);
}

export function editAviationJob(data, employeeId) {
  return axiosClient.post(`${BASE}/edit`, { data, employeeId }).then((x) => x.data);
}

// Charges for the same AWBs on other flights - the other legs of a shipment
// split across aircraft. Keyed by AWB.
export function getRelatedCharges({ jobId }) {
  if (!jobId || jobId === 'new') return Promise.resolve({ status: 'success', result: {} });
  return axiosClient
    .get(`${BASE}/relatedCharges`, { headers: { jobid: `${jobId}` } })
    .then((x) => x.data);
}

// Raise invoices from selected charges. The server groups them by party,
// direction and currency and returns one entry per invoice created.
export function makeAviationInvoice({ chargeIds, companyId, fiscalYearId, employeeId }) {
  return axiosClient
    .post(`${BASE}/makeInvoice`, { chargeIds, companyId, fiscalYearId, employeeId })
    .then((x) => x.data);
}

export function deleteAviationJob(id, employeeId) {
  return axiosClient.post(`${BASE}/delete`, { id, employeeId }).then((x) => x.data);
}

/**
 * The aviation dashboard: flight counts, the month's uplift, and the AWBs
 * whose cargo was offloaded and never put on a later flight.
 */
export function getAviationDashboard({ companyId } = {}) {
  return axiosClient
    .get(`${BASE}/dashboard`, { params: { companyId } })
    .then((x) => x.data);
}

// --- carrier master -------------------------------------------------------
// Registered carriers: each holds its AWB prefix and its ER/IFA/Other tag.

export function getCarriers() {
  return axiosClient.get(`${BASE}/carriers`).then((x) => x.data);
}

export function saveCarrier(carrier) {
  return axiosClient.post(`${BASE}/carriers/save`, carrier).then((x) => x.data);
}

export function deleteCarrier(id) {
  return axiosClient.post(`${BASE}/carriers/delete`, { id }).then((x) => x.data);
}

// --- aircraft master ------------------------------------------------------
// The report splits each sector by aircraft, so a flight picks a registered
// one rather than carrying typed text.

export function getAircraft() {
  return axiosClient.get(`${BASE}/aircraft`).then((x) => x.data);
}

export function saveAircraft(aircraft) {
  return axiosClient.post(`${BASE}/aircraft/save`, aircraft).then((x) => x.data);
}

export function deleteAircraft(id) {
  return axiosClient.post(`${BASE}/aircraft/delete`, { id }).then((x) => x.data);
}

/**
 * The per-flight summary - one row per flight, uplift and offload split by
 * reporting tag.
 *
 * The period is a plain from/to. The fortnight/month/quarter/year presets are
 * worked out by the screen and sent as dates, so there is one date rule on the
 * server and a preset can never disagree with the free range beside it.
 */
export function getFlightSummary(params = {}) {
  return axiosClient
    .get(`${BASE}/flightSummary`, { params })
    .then((x) => x.data);
}

/**
 * The sales report - one row per approved AWB, buying against selling.
 *
 * Same period contract as the flight summary above: a plain from/to, with the
 * presets worked out by the screen, so there is one date rule on the server
 * and a preset can never disagree with the free range beside it.
 */
export function getSalesReport(params = {}) {
  return axiosClient
    .get(`${BASE}/salesReport`, { params })
    .then((x) => x.data);
}
