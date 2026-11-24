/**
 * The company picked in the header, as the job lists and job forms use it.
 *
 * STRICT. A job list with no company picked shows NO jobs - an empty list
 * with a note saying why - and a job cannot be saved without one. Lists used
 * to drop the filter when there was no company, so such a user saw every
 * company's jobs and saved theirs under none: hidden from everyone working in
 * a company, search included (15 customs jobs on CargoLinkers).
 *
 * The header puts the company in the store a moment after the page loads, so
 * an empty store on the first render is not yet "none picked". Hence `ready`:
 * false until mounted (server render and first client render agree), then the
 * store's value, else the cookie the header is about to load into it.
 */
import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';

/** A company id, not '', 'NaN', 'undefined' or 'null'. */
export const isCompanySelected = (value) => /^\d+$/.test(String(value ?? '').trim());

export const NO_COMPANY_TO_SAVE = 'Pick your company at the top of the screen, then save again.';

export function useSelectedCompany(fromStore) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return { ready: false, companyId: '' };
  if (isCompanySelected(fromStore)) return { ready: true, companyId: String(fromStore).trim() };
  const cookie = Cookies.get('companyId');
  return { ready: true, companyId: isCompanySelected(cookie) ? String(cookie).trim() : '' };
}

export default useSelectedCompany;
