/**
 * Which company to select for a user once the company list has loaded.
 *
 * Login picks the user's default company - when they have one. Without it
 * nothing was selected, and the job lists, which show the selected company's
 * jobs, then filtered by nothing: the user saw every company's jobs, and the
 * jobs THEY created were saved under no company at all - hidden from everyone
 * working in one, search included. 15 customs jobs on CargoLinkers.
 *
 *   a real company is selected        -> null: leave it alone
 *   the install has exactly one       -> its id: there is no other answer
 *   several, and none (or a stale id) -> '': nothing selected, the user picks
 *
 * @param current    the companyId cookie as it stands ('' / undefined / 'NaN' too)
 * @param companies  the list from getAllCompanies: [{ id, title }]
 */
export function companyToSelect(current, companies = []) {
  const ids = (companies || []).map((c) => String(c.id));
  if (ids.includes(String(current ?? '').trim())) return null;
  return ids.length === 1 ? ids[0] : '';
}

export default companyToSelect;
