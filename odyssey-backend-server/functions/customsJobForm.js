/**
 * How a customs install's job screen is laid out and labelled -
 * Configuration > Customs, AppSetting `customsJobForm` (JSON). Mirrored by the
 * frontend's functions/customsJobForm.js, which lays the screen out by it.
 *
 * Asked for by Essani (the user, 2026-11-14), as options rather than changes,
 * so CargoLinkers and HO-ENT stay as they are. Unset, everything is as before:
 *
 *   referenceLabel     what the S/R Page # box is called - on the job screen,
 *                      the job list's search and the invoice print. The value
 *                      is still held in jobRef; only the name changes.
 *   layout             which tabs the job screen has, what they are called,
 *                      and which sections sit on each - null is the built-in
 *                      five. Charges is always its own last tab, never a
 *                      section.
 *   addPorts           the Port Of Loading / Discharge / Final Destination
 *                      headings open Setup > Ports' form.
 *   containerSizeList  a container's Size is picked from the list, not typed.
 *   freightForwarding  Freight Forwarding is offered as a Job Type; such a job
 *                      has an HBL # where the others have a Client Invoice #.
 *   commodities        the Commodity box on the Goods section (on unless
 *                      turned off).
 *   directJobFileFromRef
 *                      a Direct Job E/R line's File # is filled from the job's
 *                      S/R Page # (jobRef - Essani's "File Job Number"), not
 *                      the migrated customFileNo (Essani, 2026-11-17).
 *   uniqueGdNumber, uniqueClientInvoice, uniqueJobRef
 *                      no two live jobs of the company may share that number
 *                      (the user, 2026-11-14) - see functions/customsJobUnique.
 *
 * No database - unit tested.
 */

const KEY = 'customsJobForm';

// The job screen's sections, as the screen draws them. Charges is not one:
// it is always its own tab, last.
const SECTIONS = [
  'jobDetails', 'status', 'parties', 'route', 'haulage', 'containers',
  'documents', 'goodsDeclaration', 'goods', 'commercialInvoice',
];

const DEFAULT_REFERENCE_LABEL = 'S/R Page #';

const DEFAULTS = Object.freeze({
  referenceLabel: DEFAULT_REFERENCE_LABEL,
  layout: null,
  addPorts: false,
  containerSizeList: false,
  freightForwarding: false,
  commodities: true,
  uniqueGdNumber: false,
  uniqueClientInvoice: false,
  uniqueJobRef: false,
  directJobFileFromRef: false,
});

const MAX_TABS = 12;
const MAX_TITLE = 40;
const MAX_LABEL = 40;

class CustomsJobFormError extends Error {}

const SWITCHES = [
  'addPorts', 'containerSizeList', 'freightForwarding', 'commodities',
  'uniqueGdNumber', 'uniqueClientInvoice', 'uniqueJobRef', 'directJobFileFromRef',
];

/**
 * A layout as stored: { tabs: [{ key, title, sections: [...] }] }, or null for
 * the built-in one. Every section ends up on exactly one tab - a section named
 * twice stays where it was named first, one not named at all goes on the first
 * tab, a name nobody knows is dropped - so no box can go missing from the job
 * screen whatever is saved. A tab with no sections is kept (the screen hides it).
 */
function normalizeLayout(layout) {
  if (layout === null || layout === undefined) return null;
  if (typeof layout !== 'object' || !Array.isArray(layout.tabs)) {
    throw new CustomsJobFormError('layout must be { tabs: [...] } or null.');
  }
  if (!layout.tabs.length) throw new CustomsJobFormError('The layout needs at least one tab.');
  if (layout.tabs.length > MAX_TABS) throw new CustomsJobFormError(`At most ${MAX_TABS} tabs.`);

  const placed = new Set();
  const keys = new Set();
  const tabs = layout.tabs.map((t, i) => {
    if (!t || typeof t !== 'object') throw new CustomsJobFormError(`Tab ${i + 1} is not a tab.`);
    const title = String(t.title ?? '').trim();
    if (!title) throw new CustomsJobFormError(`Tab ${i + 1} needs a name.`);
    if (title.length > MAX_TITLE) throw new CustomsJobFormError(`Tab names are at most ${MAX_TITLE} characters.`);
    if (title.toLowerCase() === 'charges') throw new CustomsJobFormError('"Charges" is the charges tab\'s own name.');
    let key = String(t.key ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(key) || key === 'charges' || keys.has(key)) {
      let n = i + 1;
      while (keys.has(`t${n}`)) n += 1;
      key = `t${n}`;
    }
    keys.add(key);
    const sections = (Array.isArray(t.sections) ? t.sections : [])
      .map(String)
      .filter((s) => SECTIONS.includes(s) && !placed.has(s) && placed.add(s));
    return { key, title, sections };
  });
  const missing = SECTIONS.filter((s) => !placed.has(s));
  tabs[0].sections.push(...missing);
  return { tabs };
}

/** The setting as stored, from what was posted. Throws on a wrong type. */
function normalizeCustomsJobForm(input = {}) {
  if (!input || typeof input !== 'object') throw new CustomsJobFormError('Nothing to save.');
  const out = { ...DEFAULTS };
  if (input.referenceLabel !== undefined && input.referenceLabel !== null) {
    if (typeof input.referenceLabel !== 'string') throw new CustomsJobFormError('referenceLabel must be text.');
    const label = input.referenceLabel.trim();
    if (label.length > MAX_LABEL) throw new CustomsJobFormError(`The reference's name is at most ${MAX_LABEL} characters.`);
    out.referenceLabel = label || DEFAULT_REFERENCE_LABEL;
  }
  for (const name of SWITCHES) {
    if (input[name] === undefined) continue;
    if (typeof input[name] !== 'boolean') throw new CustomsJobFormError(`${name} must be true or false.`);
    out[name] = input[name];
  }
  out.layout = normalizeLayout(input.layout);
  return out;
}

/** The setting as stored - an AppSetting value - read leniently: anything
 *  unreadable is the default, never an error on a screen that only reads it. */
function parseCustomsJobForm(value) {
  if (!value) return { ...DEFAULTS };
  try {
    return normalizeCustomsJobForm(JSON.parse(value));
  } catch (e) {
    return { ...DEFAULTS };
  }
}

async function readCustomsJobForm(db) {
  const row = await db.AppSetting.findOne({ where: { key: KEY } });
  return parseCustomsJobForm(row?.value);
}

module.exports = {
  KEY, SECTIONS, DEFAULTS, DEFAULT_REFERENCE_LABEL, CustomsJobFormError,
  normalizeLayout, normalizeCustomsJobForm, parseCustomsJobForm, readCustomsJobForm,
};
