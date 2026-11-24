import { useCallback, useContext, useState } from 'react';
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime';

/**
 * A report's page, remembered across tab switches.
 *
 * A report is a page of its own, and switching to another tab unmounts it, so
 * a `useState(1)` page went back to 1 every time the user came back to the
 * tab - they left Job Balancing on page 6 and returned to page 1 (the user's
 * report, 2026-10-22).
 *
 * Remembered for the session, per REPORT RUN: keyed by the report's address,
 * which carries its filters (?company=...&from=...&to=...), so going back to
 * the tab resumes where it was, while a run with other filters starts at the
 * beginning. `name` keeps two paginated parts of one page apart.
 *
 *   const [currentPage, setCurrentPage] = useRememberedPage('jobBalancing');
 *
 * Works like useState - a value or an updater - and remembers as it is set,
 * so a page left between renders is never lost.
 */
const remembered = new Map();

/* The report's address. The router's when there is one; the browser's when a
 * report is rendered outside the app's router (a test, a print window) -
 * read through the router's context, which is what useRouter reads, because
 * useRouter itself throws "NextRouter was not mounted" there. */
const useReportAddress = () => {
  const router = useContext(RouterContext);
  if (router?.asPath) return router.asPath;
  return typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`;
};

export const useRememberedPage = (name, initial = 1) => {
  const key = `${name}|${useReportAddress()}`;
  const [held, setHeld] = useState(() => ({ key, page: remembered.has(key) ? remembered.get(key) : initial }));
  // The same component can be handed another run - pressing Go again with
  // other filters - without remounting: that run's own page, not this one's.
  const page = held.key === key ? held.page : (remembered.has(key) ? remembered.get(key) : initial);

  const setPage = useCallback((next) => {
    setHeld((prev) => {
      const current = prev.key === key ? prev.page : (remembered.has(key) ? remembered.get(key) : initial);
      const value = typeof next === 'function' ? next(current) : next;
      remembered.set(key, value);
      return { key, page: value };
    });
  }, [key, initial]);

  return [page, setPage];
};

/** For tests: forget every remembered page. */
export const forgetRememberedPages = () => remembered.clear();
