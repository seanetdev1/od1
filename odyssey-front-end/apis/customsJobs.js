import axiosClient from "./axiosClient";

// Customs clearance jobs API. Talks only to /customsJob on the backend, which
// is a separate router from /seaJob - nothing here can affect the freight
// screens.
const BASE = `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/customsJob`;

export function getCustomsValues() {
  return axiosClient.get(`${BASE}/getValues`).then((x) => x.data);
}

export function getCustomsJobs({
  companyId, search, direction, status, billing, page, limit, period, from, to,
} = {}) {
  return axiosClient
    .get(`${BASE}/get`, {
      headers: {
        companyid: `${companyId ?? ''}`,
        search: `${search ?? ''}`,
        direction: `${direction ?? ''}`,
      },
      // Paging and the status filter go as query params - the list is served a
      // page at a time, so both have to reach the query rather than the table.
      params: {
        page: page ?? 1,
        limit: limit ?? 25,
        status: Array.isArray(status) ? status.join(',') : (status || ''),
        billing: billing || '',
        // A time period by job date - none is every date (routes/customsJobs).
        ...(period ? { period } : {}),
        ...(from && to ? { from, to } : {}),
      },
    })
    .then((x) => x.data);
}

export function getCustomsJobById({ id }) {
  // "new" never reaches the server - there is nothing to fetch for a job that
  // does not exist yet, and asking would be a guaranteed 404. The string forms
  // of undefined/null are caught here too: they come from a URL built out of a
  // missing tab id, and are not a job anyone can load.
  if (!id || id === 'new' || id === 'undefined' || id === 'null') {
    return Promise.resolve({ status: 'success', result: null });
  }
  return axiosClient.get(`${BASE}/getById`, { headers: { id: `${id}` } }).then((x) => x.data);
}

/**
 * What this declaration earned, per charge head.
 *
 * A separate call from getCustomsJob on purpose: it needs each invoice's
 * settlement figures and the DIRECT JOB lines booked against the file, neither
 * of which the job screen otherwise reads. Loading them with every job would
 * slow down opening one for a tab most people never look at.
 *
 * An unsaved job has no id and therefore no summary - answered here rather
 * than with a guaranteed 404, the same way getCustomsJob does.
 */
export function getCustomsChargeSummary(id) {
  if (!id || id === 'new' || id === 'undefined' || id === 'null') {
    return Promise.resolve({
      status: 'success',
      result: { rows: [], totals: null, directEntries: [] },
    });
  }
  return axiosClient.get(`${BASE}/chargeSummary`, { headers: { id: `${id}` } }).then((x) => x.data);
}

export function createCustomsJob(data, employeeId) {
  return axiosClient.post(`${BASE}/create`, { data, employeeId }).then((x) => x.data);
}

export function editCustomsJob(data, employeeId) {
  return axiosClient.post(`${BASE}/edit`, { data, employeeId }).then((x) => x.data);
}

// CEO / CFO / admin: open an invoiced declaration for the next save. The
// server records it in History - see /unlock in routes/customsJobs.
export function unlockCustomsJob(id, employeeId) {
  return axiosClient.post(`${BASE}/unlock`, { id, employeeId }).then((x) => x.data);
}

export function deleteCustomsJob(id, employeeId) {
  return axiosClient.post(`${BASE}/delete`, { id, employeeId }).then((x) => x.data);
}

// Tracing notes on a declaration - a dated running log, distinct from the
// single `remarks` field on the job itself. Stored in the shared Job_notes
// table under its own type, the same way the sea and air screens use it.
export function getCustomsNotes(id) {
  return axiosClient.post(`${BASE}/notes`, { id }).then((x) => x.data);
}

export function addCustomsNote({ id, title, note, createdBy, employeeId }) {
  return axiosClient
    .post(`${BASE}/addNote`, { id, title, note, createdBy, employeeId })
    .then((x) => x.data);
}

// Raise invoices from selected charges. The server groups them by party,
// direction and currency and returns one entry per invoice created. approve:
// raised approved - posted to the ledger as they are made ("Invoice & approve").
// approveChargeIds: ticked charges to approve as they are invoiced (2026-11-11).
export function makeCustomsInvoice({
  chargeIds, companyId, fiscalYearId, employeeId, approve = false, approveChargeIds = [],
}) {
  return axiosClient
    .post(`${BASE}/makeInvoice`, {
      chargeIds, companyId, fiscalYearId, employeeId,
      ...(approve ? { approve: true } : {}),
      ...(approveChargeIds.length ? { approveChargeIds } : {}),
    })
    .then((x) => x.data);
}

// The duty register: every GD filed in a month, its duty by head, and what the
// agent is owed back. Filed date is the GD date, not when the row was typed.
export function getCustomsRegister({ month, companyId, direction } = {}) {
  return axiosClient
    .get(`${BASE}/register`, { params: { month, companyId, direction } })
    .then((x) => x.data);
}

/**
 * The customs home-page counters.
 *
 * Its own endpoint rather than /home/getDashboard, which counts FCL and LCL
 * off SE_Job against two hardcoded company ids - figures a clearing agent has
 * no rows for and companies it does not own.
 */
export function getCustomsDashboard({ companyId } = {}) {
  return axiosClient.get(`${BASE}/dashboard`, { params: { companyId } }).then((x) => x.data);
}
