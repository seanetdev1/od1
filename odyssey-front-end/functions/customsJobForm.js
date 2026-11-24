import { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';

/**
 * How a customs install's job screen is laid out and labelled -
 * Configuration > Customs, the server's functions/customsJobForm (which this
 * mirrors: the same section keys, the same defaults). Asked for by Essani as
 * options rather than changes (the user, 2026-11-14), so an install that sets
 * nothing has the screen it had:
 *
 *   referenceLabel     what the S/R Page # box is called (still jobRef)
 *   layout             the tabs, their names, and the sections on each;
 *                      null is the built-in five. Charges is always last.
 *   addPorts           the port headings open Setup > Ports' form
 *   containerSizeList  a container's Size is picked from the list
 *   freightForwarding  Freight Forwarding is a Job Type, with an HBL # in
 *                      place of the Client Invoice #
 *   commodities        the Commodity box (on unless turned off)
 *
 * No React in the rules - unit tested. useCustomsJobForm reads the setting.
 */

// The job screen's sections, in the built-in order, with what the layout
// editor calls them.
export const SECTIONS = [
  { key: 'jobDetails', label: 'Job Details' },
  { key: 'status', label: 'Status' },
  { key: 'parties', label: 'Parties' },
  { key: 'route', label: 'Route' },
  { key: 'haulage', label: 'Haulage' },
  { key: 'containers', label: 'Containers' },
  { key: 'documents', label: 'Documents' },
  { key: 'goodsDeclaration', label: 'Goods Declaration' },
  { key: 'goods', label: 'Goods' },
  { key: 'commercialInvoice', label: 'Commercial invoice' },
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const sectionLabel = (key) => SECTIONS.find((s) => s.key === key)?.label || key;

export const DEFAULT_REFERENCE_LABEL = 'S/R Page #';
export const FREIGHT_FORWARDING = 'Freight Forwarding';

export const DEFAULT_CUSTOMS_JOB_FORM = Object.freeze({
  referenceLabel: DEFAULT_REFERENCE_LABEL,
  layout: null,
  addPorts: false,
  containerSizeList: false,
  freightForwarding: false,
  commodities: true,
  // No two live jobs of the company may share the number (the user,
  // 2026-11-14) - the server's functions/customsJobUnique.
  uniqueGdNumber: false,
  uniqueClientInvoice: false,
  uniqueJobRef: false,
  // A Direct Job E/R line's File # from the job's S/R Page # (jobRef) rather
  // than the migrated customFileNo - Essani, 2026-11-17. The server decides.
  directJobFileFromRef: false,
});

/**
 * The built-in tabs, as the screen had them before there was a layout.
 * `documentsOnGd` is the older switch (Configuration > Customs, 2026-10-10):
 * the Documents section at the top of Goods Declaration, Booking Info then
 * empty and so not shown.
 */
export function builtInLayout({ documentsOnGd = false } = {}) {
  return {
    tabs: [
      { key: 'details', title: 'Job Details', sections: ['jobDetails', 'status'] },
      { key: 'loading', title: 'Loading Program (CRO)', sections: ['parties', 'route'] },
      { key: 'transport', title: 'Transport', sections: ['haulage', 'containers'] },
      { key: 'booking', title: 'Booking Info', sections: documentsOnGd ? [] : ['documents'] },
      {
        key: 'gd',
        title: 'Goods Declaration',
        sections: [...(documentsOnGd ? ['documents'] : []), 'goodsDeclaration', 'goods', 'commercialInvoice'],
      },
    ],
  };
}

/**
 * The saved layout made whole, as the server does it: every section on
 * exactly one tab - first mention wins, any not mentioned go on the first tab,
 * unknown names dropped - so no part of the job can go missing whatever is
 * stored. null (or nothing usable) is the built-in layout.
 */
export function completeLayout(layout, { documentsOnGd = false } = {}) {
  if (!layout || !Array.isArray(layout.tabs) || !layout.tabs.length) return builtInLayout({ documentsOnGd });
  const placed = new Set();
  const tabs = layout.tabs.map((t, i) => ({
    key: String(t.key || `t${i + 1}`),
    title: String(t.title || `Tab ${i + 1}`),
    sections: (t.sections || []).filter((s) => SECTION_KEYS.includes(s) && !placed.has(s) && placed.add(s)),
  }));
  tabs[0].sections.push(...SECTION_KEYS.filter((s) => !placed.has(s)));
  return { tabs };
}

/**
 * The tabs a particular job shows, each with the sections it shows.
 *
 * Haulage is left off a clearing-only file (showHaulage false) - see the job
 * screen. Containers then go to the Route section's tab when they would
 * otherwise be left alone where Haulage was: so the built-in layout still
 * moves them up to the Loading Program and drops Transport, as it always did.
 * A tab with nothing to show is not shown.
 */
export function visibleTabs(layout, { showHaulage = true } = {}) {
  const tabs = layout.tabs.map((t) => ({
    ...t,
    sections: t.sections.filter((s) => showHaulage || s !== 'haulage'),
  }));
  if (!showHaulage) {
    const haulageTab = layout.tabs.find((t) => t.sections.includes('haulage'));
    const routeTab = tabs.find((t) => t.sections.includes('route'));
    const containersTab = tabs.find((t) => t.sections.includes('containers'));
    if (haulageTab && containersTab && routeTab && containersTab.key === haulageTab.key
      && containersTab.key !== routeTab.key && containersTab.sections.length === 1) {
      containersTab.sections = [];
      routeTab.sections = [...routeTab.sections, 'containers'];
    }
  }
  return tabs.filter((t) => t.sections.length > 0);
}

/** The key of the tab a section is on, among the shown ones - null if none. */
export const tabOf = (tabs, section) => (tabs.find((t) => t.sections.includes(section))?.key ?? null);

/** Whether two sections are shown on the same tab. */
export const sameTab = (tabs, a, b) => {
  const at = tabOf(tabs, a);
  return at !== null && at === tabOf(tabs, b);
};

/** The setting, as the server sends it, with anything missing at its default. */
export const withDefaults = (form) => ({ ...DEFAULT_CUSTOMS_JOB_FORM, ...(form || {}) });

/** A job with an HBL # rather than a Client Invoice # - see freightForwarding. */
export const isFreightForwarding = (job) => job?.jobType === FREIGHT_FORWARDING;

/**
 * Configuration > Customs' job screen setting, read once per mount. The
 * defaults until it arrives - and if it cannot be had - so the screen is
 * never held up by it, and an install without it is as it was.
 */
export function useCustomsJobForm() {
  const [form, setForm] = useState(DEFAULT_CUSTOMS_JOB_FORM);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    // Through a resolved promise, so a client that returns nothing (a test's
    // stand-in) falls to the defaults rather than throwing.
    Promise.resolve()
      .then(() => axiosClient.get('/settings/customsJobForm'))
      .then((res) => { if (alive && res?.data?.status === 'success') setForm(withDefaults(res.data.result)); })
      .catch(() => { /* not set, or an older server: as before */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);
  return { form, loaded };
}
