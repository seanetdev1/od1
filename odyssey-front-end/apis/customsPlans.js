import axiosClient from './axiosClient';

// The Program Book - planned customs jobs. Talks only to /customsJob/plans,
// which refuses everything while Configuration > Customs has planning off.
const BASE = `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/customsJob/plans`;

export function getPlans({ companyId }) {
  return axiosClient
    .get(`${BASE}/get`, { headers: { companyid: `${companyId ?? ''}` } })
    .then((x) => x.data);
}

/** The rows changed or added - each with `rowNo`, the number the screen shows. */
export function savePlans({ companyId, rows }) {
  return axiosClient.post(`${BASE}/save`, { companyId, rows }).then((x) => x.data);
}

export function deletePlans({ companyId, ids }) {
  return axiosClient.post(`${BASE}/delete`, { companyId, ids }).then((x) => x.data);
}

export function movePlans({ companyId, ids, fiscalYearId, employeeId }) {
  return axiosClient.post(`${BASE}/move`, { companyId, ids, fiscalYearId, employeeId }).then((x) => x.data);
}
