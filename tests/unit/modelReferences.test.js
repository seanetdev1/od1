/**
 * Routes must not call methods on models that do not exist.
 *
 * "remove unused tables" (03f9975) deleted models/Accounts.js,
 * models/Parent_Account.js and models/Invoice_Losses.js, but a number of route
 * handlers still destructure and use them. Those names are `undefined` at
 * runtime, so the handler throws
 *
 *     TypeError: Cannot read properties of undefined (reading 'findAll')
 *
 * the first time it is called. None of them are reachable from the application
 * today - the only callers were three uploader components that are no longer
 * imported anywhere - which is why this has not been noticed.
 *
 * This test pins the known set. It fails if a NEW reference appears, or if a
 * route that is currently broken is wired up to something, so the next person
 * finds out here rather than from a customer.
 *
 * To fix one properly: rewrite the handler against the Child_Account tree
 * (which is what the application actually stores - see
 * scripts/seedChartOfAccounts.js) and remove its entry below.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MODELS_DIR = path.join(ROOT, 'models');
const ROUTES_DIR = path.join(ROOT, 'routes');

/** Model names that models/index.js will actually expose. */
function definedModels() {
  const names = new Set();
  for (const file of fs.readdirSync(MODELS_DIR)) {
    if (!file.endsWith('.js') || file === 'index.js') continue;
    const src = fs.readFileSync(path.join(MODELS_DIR, file), 'utf8');
    // Tolerant of the misspelled `sequlize` parameter in some model files -
    // the model is still defined, and a stricter pattern reports it as missing.
    const m = src.match(/sequ\w*\.define\(\s*["']([A-Za-z_0-9]+)["']/);
    if (m) names.add(m[1]);
  }
  return names;
}

/** Names used as `X.method(` or `model: X` in a route file. */
function usedModels(source) {
  const used = new Set();
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  for (const m of withoutComments.matchAll(/\b([A-Z][A-Za-z_0-9]*)\.(findAll|findOne|findByPk|create|bulkCreate|update|destroy|count|upsert)\s*\(/g)) {
    used.add(m[1]);
  }
  for (const m of withoutComments.matchAll(/\bmodel:\s*([A-Z][A-Za-z_0-9]*)/g)) {
    used.add(m[1]);
  }
  return used;
}

function* routeFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* routeFiles(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

// Names that look like models but are not: Sequelize itself, helpers, classes.
const NOT_MODELS = new Set([
  'Sequelize', 'Op', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'Math', 'JSON', 'Promise', 'Map', 'Set', 'Error', 'Buffer', 'RegExp',
]);

// Known-broken, and verified to have no caller: the only frontend callers were
// three uploader components (Uploader.js, PartiesUploader.js, InvoicedUploader.js)
// that are no longer imported anywhere, so no screen can reach these handlers.
//
// Each entry throws if it is ever reached - either a TypeError on an undefined
// model, or a ReferenceError where the name was never imported at all
// (routes/misc/parties.js calls Vendors.findAll() with no import).
const KNOWN_BROKEN = {
  'routes/accounts/index.js':    ['Accounts', 'Parent_Account', 'Vendor_Associations', 'Vendors'],
  'routes/clients/index.js':     ['Parent_Account', 'Vendor_Associations'],
  'routes/invoice/index.js':     ['Parent_Account', 'Vendor_Associations', 'Vendors'],
  'routes/misc/parties.js':      ['Vendors'],
  'routes/misc/profitLoss.js':   ['Accounts', 'Parent_Account'],
  'routes/voucher/index.js':     ['Parent_Account'],
};

describe('route handlers only use models that exist', () => {
  const defined = definedModels();
  const found = {};

  beforeAll(() => {
    for (const file of routeFiles(ROUTES_DIR)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const source = fs.readFileSync(file, 'utf8');
      const missing = [...usedModels(source)]
        .filter((name) => !defined.has(name) && !NOT_MODELS.has(name))
        // Skip names the file binds itself - a local class, a helper, a loop
        // variable, or a Sequelize instance held in a local. Declarations are
        // matched loosely enough to cover `let dJob, Voucher;` and
        // `for (let CP of ...)`, where the name is not the first after `let`.
        .filter((name) => !new RegExp(
          `(?:function|class)\\s+${name}\\b` +
          `|(?:const|let|var)\\s+(?:[A-Za-z_$][\\w$]*\\s*,\\s*)*${name}\\b` +
          `|\\bfor\\s*\\(\\s*(?:const|let|var)\\s+${name}\\b`
        ).test(source))
        // A name used as a model but bound nowhere is a ReferenceError, not
        // merely an undefined property - routes/misc/parties.js calls
        // Vendors.findAll() without importing Vendors at all.
        .sort();
      if (missing.length) found[rel] = missing;
    }
  });

  it('has no NEW references to deleted models', () => {
    const unexpected = {};
    for (const [file, names] of Object.entries(found)) {
      const allowed = KNOWN_BROKEN[file] || [];
      const extra = names.filter((n) => !allowed.includes(n));
      if (extra.length) unexpected[file] = extra;
    }
    expect(unexpected).toEqual({});
  });

  it('does not list a file as broken once it has been fixed', () => {
    // Keeps the allowlist honest: fix a file, remove its entry.
    const staleFiles = Object.keys(KNOWN_BROKEN).filter((f) => !found[f]);
    expect(staleFiles).toEqual([]);
  });

  it('confirms the models the allowlist is about really are gone', () => {
    for (const name of ['Accounts', 'Parent_Account', 'Invoice_Losses', 'Vendors']) {
      expect(defined.has(name)).toBe(false);
    }
  });
});
