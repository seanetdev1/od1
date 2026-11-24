/**
 * Every file that calls axiosClient - or Cookies - must import it.
 *
 * Fourteen files used axiosClient.get/post without importing it. Each one threw
 *
 *     ReferenceError: axiosClient is not defined
 *
 * the moment its code path ran - the request never left the browser, so those
 * screens simply did not work. It survived because nothing catches it at build
 * time: an undefined identifier is only a problem when the line executes, and
 * these were spread across screens nobody exercised together.
 *
 * The shape suggests a search-and-replace from `axios` to `axiosClient` that
 * missed the import lines, which is exactly the kind of change that will happen
 * again. Hence a test rather than just a fix.
 *
 * Cookies (js-cookie) the same way: the freight job's Loading Program and
 * Delivery Order tabs read the login id through it without importing it, and
 * neither tab could save or show what was saved.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEARCH_DIRS = ['Components', 'pages', 'functions'];

const IDENTIFIERS = [
  {
    name: 'axiosClient',
    uses: /\baxiosClient\s*\./,
    imports: /^\s*(?:import\b.*\baxiosClient\b|const\s+axiosClient\s*=\s*require)/m,
  },
  {
    name: 'Cookies',
    uses: /\bCookies\.(?:get|set|remove)\s*\(/,
    imports: /^\s*(?:import\b.*\bCookies\b|const\s+Cookies\s*=\s*require)/m,
  },
];

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* walk(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.jsx')) {
      yield full;
    }
  }
}

describe.each(IDENTIFIERS)('$name usage', ({ uses, imports }) => {
  it('is imported everywhere it is used', () => {
    const offenders = [];

    for (const dir of SEARCH_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const src = fs.readFileSync(file, 'utf8');
        // Ignore mentions inside comments only - a real call is what matters.
        const code = src
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (uses.test(code) && !imports.test(src)) {
          offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
