/* eslint-disable */
// Per-file bytecode seal (Docker / distributable build).
//
//   node build/seal-tree.js
//
// Unlike build-backend.js (a single esbuild bundle), this preserves the source
// directory structure and compiles EACH first-party .js file to V8 bytecode
// (.jsc) individually. That matters because models/index.js loads models with a
// dynamic `fs.readdirSync(__dirname)` + `require(path.join(__dirname, file))` -
// which a single bundle cannot statically include, but a compiled tree can
// (models/index.js accepts .jsc files too). node_modules are public packages,
// left as-is.
//
// Output: build/dist/ - a runnable, source-free tree. Run it with:
//   node -r bytenode index.jsc
// (bytenode registers the .jsc loader; index.jsc runs as the main module so its
//  `require.main === module` start() still fires.)

const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');
const babel = require('@babel/core');

/* ASYNC ARROW FUNCTIONS CRASH THE PROCESS ONCE SEALED.
 *
 * When code reads a property of null or undefined, V8 words the TypeError
 * ("Cannot read properties of null (reading 'x')") by RE-PARSING the function
 * the read happened in. A sealed file has no source - bytenode hands V8 a
 * filler of the right length - and for an ASYNC ARROW function that re-parse
 * does not fail, it aborts: "Fatal error ... Check failed: stack_overflow()"
 * and the whole server exits, every user with it. Plain functions, async
 * function declarations and ordinary arrows word the error without trouble;
 * only async arrows die - and every route handler here is one.
 *
 * Found when Auto Bill on SNS restarted the backend each time it was pressed
 * (a party with no ledger account: account.ChildAccountId on null).
 *
 * So, before compiling, each async arrow is rewritten as an async function
 * expression. Babel's own arrowFunctionToExpression keeps `this` and
 * `arguments` meaning what they meant (it hoists them), and retainLines keeps
 * stack-trace line numbers pointing where they did. Nothing else is touched. */
const asyncArrowsToFunctions = () => ({
  visitor: {
    ArrowFunctionExpression(p) {
      if (p.node.async) p.arrowFunctionToExpression({ allowInsertArrow: false, noNewArrows: true });
    },
  },
});

function rewriteAsyncArrows(code, filename) {
  return babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: 'unambiguous',
    retainLines: true,
    compact: false,
    plugins: [asyncArrowsToFunctions],
  }).code;
}

const ROOT = path.join(__dirname, '..');
const DIST = path.join(__dirname, 'dist');

// First-party code + the runtime files it needs. NOT node_modules, tests,
// build, .env, .git.
const INCLUDE = ['index.js', 'package.json', 'routes', 'models', 'functions', 'config'];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function compileDir(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) { compileDir(full); continue; }
    if (full.endsWith('.js')) {
      // Async arrows first - see rewriteAsyncArrows.
      fs.writeFileSync(full, rewriteAsyncArrows(fs.readFileSync(full, 'utf8'), full));
      // foo.js -> foo.jsc (bytecode), then drop the readable source.
      bytenode.compileFile({ filename: full, output: full + 'c' });
      fs.rmSync(full);
    }
  }
}

function seal() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const item of INCLUDE) {
    const src = path.join(ROOT, item);
    if (fs.existsSync(src)) copyRecursive(src, path.join(DIST, item));
  }
  compileDir(DIST);

  // Launcher (plain JS, no proprietary logic). Registers the bytecode loader and
  // calls index's exported start(). We can't rely on index's `require.main ===
  // module` guard because that is false when the entry is a .jsc loaded through
  // bytenode - so start() would never fire and the server would never listen.
  fs.writeFileSync(
    path.join(DIST, 'run.js'),
    "require('bytenode');\nrequire('./index.jsc').start();\n"
  );

  console.log('Sealed tree written to build/dist/ (source removed, bytecode only).');
  console.log('Run with:  node run.js   (needs node_modules alongside)');
}

// Run when invoked (npm run seal / the Dockerfile); importable for its tests.
if (require.main === module) seal();

module.exports = { rewriteAsyncArrows, seal };
