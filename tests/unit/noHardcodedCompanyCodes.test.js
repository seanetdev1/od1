/**
 * No company code may be hardcoded in a document number.
 *
 * Job numbers, invoice numbers, voucher numbers, delivery orders and direct
 * job entry numbers all carry the company's short code as a prefix. Thirteen
 * places used to build it as
 *
 *     companyId == 1 ? "SNS" : companyId == 2 ? "CLS" : "ACS"
 *
 * which stamps Seanet's three codes onto every document a leased install
 * prints, whoever it belongs to. Company.short is set per install and
 * functions/companyCodes.companyShort() reads it.
 *
 * This is a guard, not a style rule: the failure is silent, it only shows up on
 * a customer's printed paperwork, and it reads as perfectly normal data until
 * someone notices the wrong company name on it.
 */
// functions/companyCodes requires ../models, and requiring THAT boots Sequelize
// and fires sync() in the background. This is a unit test in a project with no
// database teardown, so that connection outlives the test environment and Jest
// fails the run with:
//
//   ReferenceError: You are trying to `require` a file after the Jest
//   environment has been torn down
//
// - after reporting every test as passed, which is how the whole suite could go
// green while the job still exited 1. It only bites where the connection is
// slow enough to still be pending at teardown, so it passed locally and failed
// in CI.
//
// The test below only checks the module's exports, so an empty stub is all it
// needs; companyShort() reaches for db.Company lazily, inside the call.
jest.mock('../../models', () => ({}));

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SEARCH_DIRS = ['routes', 'functions'];

// Where the codes are legitimately mentioned: the module that replaced them,
// and the branding seed script that names the companies it seeds.
const ALLOWED = new Set([
  path.join('functions', 'companyCodes.js'),
  path.join('scripts', 'seedOwnBranding.js'),
]);

const CODE = /(["'])(SNS|CLS|ACS)\1/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

/** Strip comments so a code named in an explanation does not trip the guard. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('company codes are never hardcoded', () => {
  const offenders = [];

  beforeAll(() => {
    for (const dir of SEARCH_DIRS) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        const rel = path.relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
        lines.forEach((line, i) => {
          if (CODE.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        });
      }
    }
  });

  it('does not build document numbers from a literal SNS/CLS/ACS', () => {
    expect(offenders).toEqual([]);
  });
});

describe('companyCodes', () => {
  it('exports both directions and a cache reset', () => {
    const codes = require('../../functions/companyCodes');
    expect(typeof codes.companyShort).toBe('function');
    expect(typeof codes.companyIdFromNumber).toBe('function');
    expect(typeof codes.reset).toBe('function');
  });
});
