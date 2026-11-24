// WHICH COMPANIES A REQUEST MAY TOUCH.
//
// The company a screen works in was only ever the browser's choice - a cookie,
// sent back as a header, query or body field - so any user could read or
// write any company's books by changing it. Now a user restricted to some
// companies (Employee_Company rows) is refused a request that names any other.
//
// Checked by functions/permissions/middleware.js on every signed-in request,
// against every place a request names a company. Always enforced, audit mode
// or not: a restriction only exists because Seanet set one.
//
// It checks what a request NAMES. A route fetching a record by its own id does
// not name a company, and is not checked here - the screens only offer a
// restricted user their own companies' records to open.

// Every field the routes read a company from (grep: req.*company*).
//
// Not x-company-id: the screens send that on EVERY request (the company
// picked in the header), including the ones that load the picker. Refusing on
// it would lock out a user whose cookie still holds a company they have just
// lost - the very request that would put it right would be refused.
// ambientCompany() below reads it, and treats a disallowed one as none.
function namedCompanies(req) {
  const h = req.headers || {};
  const q = req.query || {};
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const d = (b.data && typeof b.data === 'object') ? b.data : {};
  return [
    h.companyid, h.company,
    q.companyId, q.companyid, q.CompanyId, q.company,
    b.companyId, b.CompanyId, b.company,
    d.companyId, d.CompanyId,
  ]
    .filter((v) => v !== undefined && v !== null && typeof v !== 'object')
    .map((v) => String(v).trim())
    .filter((v) => v !== '' && v !== 'undefined' && v !== 'null' && v !== 'NaN');
}

/**
 * null when the request may go ahead, else why not.
 * @param {Set<string>|null} allowed  null = every company
 */
function refusal(req, allowed) {
  if (!allowed) return null;
  for (const v of namedCompanies(req)) {
    if (v.toLowerCase() === 'all') return 'You can only see the companies you work in - pick one.';
    // Only ids are checked; anything else is not a company reference. A list
    // ('2,3' - see widenAll) is checked id by id: every one must be theirs.
    for (const part of v.split(',').map((x) => x.trim())) {
      if (/^\d+$/.test(part) && !allowed.has(part)) return 'You do not have access to that company.';
    }
  }
  return null;
}

/* "ALL COMPANIES", FOR SOMEONE WHO WORKS IN SOME.
 *
 * The reports offer "All" in their company picker, and their routes read it as
 * "no company filter". A user restricted to some companies was refused it
 * outright - and a report page that loads its data on the server crashed on
 * the refusal with a bare 500 (Job Balancing, 2026-10-24, the first day SNS
 * users had companies set). Their "all" is now every company THEY work in:
 * rewritten here, in the request, to the list of their ids ('2,3'), which the
 * report routes read through reportCompanies. A route that does not read lists
 * sees '2,3' as no company it knows - nothing, never more.
 *
 * Done before refusal(), which then checks the list id by id. */
const FIELDS = [
  ['headers', 'companyid'], ['headers', 'company'],
  ['query', 'companyId'], ['query', 'companyid'], ['query', 'CompanyId'], ['query', 'company'],
  ['body', 'companyId'], ['body', 'CompanyId'], ['body', 'company'],
  ['data', 'companyId'], ['data', 'CompanyId'],
];
function widenAll(req, allowed) {
  if (!allowed || !allowed.size) return;
  const list = [...allowed].sort((a, b) => Number(a) - Number(b)).join(',');
  const holders = {
    headers: req.headers,
    query: req.query,
    body: req.body && typeof req.body === 'object' ? req.body : null,
    data: req.body?.data && typeof req.body.data === 'object' ? req.body.data : null,
  };
  for (const [where, key] of FIELDS) {
    const h = holders[where];
    if (h && typeof h[key] === 'string' && h[key].trim().toLowerCase() === 'all') h[key] = list;
  }
}

/**
 * A report's company choice -> the company ids to filter by, or null for no
 * filter at all:
 *   'all' or blank   null - every company on the install
 *   '4'              the legacy Seanet "companies 1 and 3", as saved filters
 *                    from before the pickers listed real companies
 *   '2,3' / '2'      those
 *
 * `allowed` - the user's companies (req.allowedCompanies, set by the
 * permissions middleware; null = every company). A restricted user never gets
 * more than theirs: no filter is their companies, not everyone's. A report
 * route treated a MISSING company as "all", so leaving it out used to show a
 * restricted user every company's figures - the refusal only checks what a
 * request names.
 */
function reportCompanies(value, allowed = null) {
  const v = String(value ?? '').trim();
  let ids = null;
  if (v && !['all', 'undefined', 'null'].includes(v.toLowerCase())) {
    ids = v === '4' ? ['1', '3'] : v.split(',').map((x) => x.trim()).filter(Boolean);
    if (!ids.length) ids = null;
  }
  if (!allowed) return ids;
  return ids ? ids.filter((id) => allowed.has(id)) : [...allowed].sort((a, b) => Number(a) - Number(b));
}

/**
 * The company picked in the header (x-company-id), as a number, when the user
 * may work in it - else null. What per-company master lists are filtered by.
 * @param {Set<string>|null} allowed  null = every company
 */
function ambientCompany(req, allowed) {
  const v = String(req.headers?.['x-company-id'] ?? '').trim();
  if (!/^\d+$/.test(v)) return null;
  if (allowed && !allowed.has(v)) return null;
  return Number(v);
}

/**
 * The ONE company a request is about, for scoping master lists: the company
 * it names, else the header's. null when it names "all", or none it may use.
 */
function scopeCompany(req, allowed) {
  const named = namedCompanies(req);
  if (named.some((v) => v.toLowerCase() === 'all')) return null;
  const id = named.find((v) => /^\d+$/.test(v));
  if (id) return (!allowed || allowed.has(id)) ? Number(id) : null;
  return ambientCompany(req, allowed);
}

module.exports = { namedCompanies, refusal, widenAll, reportCompanies, ambientCompany, scopeCompany };
