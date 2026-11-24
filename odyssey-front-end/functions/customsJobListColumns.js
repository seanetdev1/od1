import { defaultColumnIds, pickerOrder } from './jobBalancingColumns';

/**
 * THE CUSTOMS JOB LIST'S COLUMNS - picked, not fixed (the user, 2026-11-20:
 * "make customs job list columns dynamic").
 *
 * The twelve it always had are the built-in set. The rest are the job's own
 * fields, ready to tick on: every list row is the whole job (routes/
 * customsJobs /get), so none of them costs the server anything - plus the
 * names of its other parties and its commodity, which the list joins.
 *
 * Where the list opens: Configuration > Reports (/settings/reportColumns/
 * customsJobList) sets the columns and their order for the install; each user
 * ticks columns on and off with the list's Columns button, kept in their
 * browser; Default goes back to the install's. The same three steps as the
 * Job Balancing grid and the VAT Detail (functions/jobBalancingColumns,
 * vatDetailColumns).
 *
 * No React - unit tested.
 */
export const CUSTOMS_JOB_LIST = 'customsJobList';

/** Every column the list can show. `off`: not in the built-in set. */
export const customsJobListColumns = (referenceLabel) => [
  { id: 'jobNo', heading: 'Job No.' },
  // The S/R Page #, under the install's name for it (Essani's "File Job Number").
  { id: 'jobRef', heading: String(referenceLabel || 'S/R Page #') },
  { id: 'gdNumber', heading: 'GD No.' },
  { id: 'gdDate', heading: 'GD Date' },
  { id: 'type', heading: 'Type' },
  { id: 'client', heading: 'Client' },
  { id: 'clientInvoice', heading: 'Client Invoice #' },
  { id: 'totalDuty', heading: 'Duty' },
  { id: 'invoiceCount', heading: 'Invoices' },
  { id: 'billCount', heading: 'Bills' },
  { id: 'createdByName', heading: 'Created By' },
  { id: 'status', heading: 'Status' },
  { id: 'jobDate', heading: 'Job Date', off: true },
  // The other parties on the job screen, and the commodity - linked records,
  // so the list joins their names (routes/customsJobs /get). Missed at first:
  // the extras were taken from the job's own columns (the user, 2026-11-20).
  { id: 'shipper', heading: 'Shipper', off: true },
  { id: 'consignee', heading: 'Consignee', off: true },
  { id: 'shippingLine', heading: 'Shipping Line', off: true },
  { id: 'forwarder', heading: 'Freight Forwarder', off: true },
  { id: 'transporter', heading: 'Transporter', off: true },
  { id: 'commodity', heading: 'Commodity', off: true },
  { id: 'blNo', heading: 'B/L - AWB No.', off: true },
  { id: 'channel', heading: 'Channel', off: true },
  { id: 'vesselOrFlight', heading: 'Vessel / Flight', off: true },
  { id: 'voyageNo', heading: 'Voyage', off: true },
  { id: 'igmNo', heading: 'IGM No.', off: true },
  { id: 'indexNo', heading: 'Index No.', off: true },
  { id: 'gdType', heading: 'GD Type', off: true },
  { id: 'collectorate', heading: 'Collectorate', off: true },
  { id: 'pol', heading: 'Port of Loading', off: true },
  { id: 'pod', heading: 'Port of Discharge', off: true },
  { id: 'terminal', heading: 'Terminal', off: true },
  { id: 'containers', heading: 'Containers', off: true },
  { id: 'packages', heading: 'Packages', off: true },
  { id: 'grossWeight', heading: 'Gross Weight', off: true },
  { id: 'invoiceValue', heading: 'Invoice Value', off: true },
  { id: 'formENo', heading: 'Form-E #', off: true },
  { id: 'psid', heading: 'PSID', off: true },
  { id: 'dutyPaidDate', heading: 'Duty Paid On', off: true },
  { id: 'reimbursableDuty', heading: 'Reimbursable Duty', off: true },
  { id: 'arrivalDate', heading: 'Arrival', off: true },
  { id: 'remarks', heading: 'Remarks', off: true },
  { id: 'createdAt', heading: 'Created On', off: true },
];

const CATALOGUE_IDS = customsJobListColumns().map((c) => c.id);
export const CUSTOMS_JOB_LIST_BUILT_IN = customsJobListColumns().filter((c) => !c.off).map((c) => c.id);

/** The columns the list opens with: Configuration's, else the built-in twelve. */
export const customsJobListDefaults = (configured) => {
  const named = (Array.isArray(configured) ? configured : []).map(String).filter((id) => CATALOGUE_IDS.includes(id));
  return defaultColumnIds(customsJobListColumns(), named.length ? named : CUSTOMS_JOB_LIST_BUILT_IN);
};

/** Every column, in the order the picker lists them: the defaults first. */
export const customsJobListOrder = (defaults) => pickerOrder(customsJobListColumns(), defaults);

/** The ticked columns, in picker order - never none, which is a blank list. */
export const customsJobListShown = (defaults, ticked) => {
  const on = new Set((Array.isArray(ticked) ? ticked : []).map(String));
  const ids = customsJobListOrder(defaults).filter((id) => on.has(id));
  return ids.length ? ids : defaults;
};

// This browser's picks - kept, unlike a report's session-long ones: the list
// is a working screen, opened every day.
export const CUSTOMS_JOB_LIST_PICKS_KEY = 'odyssey.customsJobList.columns';
export const readCustomsJobListPicks = () => {
  try {
    const v = JSON.parse(window.localStorage.getItem(CUSTOMS_JOB_LIST_PICKS_KEY) || 'null');
    return Array.isArray(v) ? v.map(String) : null;
  } catch (_) {
    return null;
  }
};
export const writeCustomsJobListPicks = (ids) => {
  try {
    if (ids) window.localStorage.setItem(CUSTOMS_JOB_LIST_PICKS_KEY, JSON.stringify(ids));
    else window.localStorage.removeItem(CUSTOMS_JOB_LIST_PICKS_KEY);
  } catch (_) { /* the picks just do not outlive the page */ }
};
