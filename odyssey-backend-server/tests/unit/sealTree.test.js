const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const babel = require('@babel/core');
const { rewriteAsyncArrows } = require('../../build/seal-tree');

/* The sealed backend died outright - "Fatal error ... Check failed:
 * stack_overflow()" - whenever an ASYNC ARROW function read a property of null
 * or undefined: V8 re-parses the function to word the TypeError, and a sealed
 * file has no source to re-parse. Auto Bill on SNS restarted the server every
 * time it was pressed. build/seal-tree rewrites async arrows as async function
 * expressions before compiling; these pin that it does, that nothing else
 * changes meaning, and - in a real sealed child process - that the error is
 * now an ordinary, catchable one. */
const asyncArrowsIn = (code) => {
  let n = 0;
  const ast = babel.parseSync(code, { babelrc: false, configFile: false, sourceType: 'unambiguous' });
  babel.traverse(ast, { ArrowFunctionExpression(p) { if (p.node.async) n += 1; } });
  return n;
};

const run = (code) => {
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', code)(m, m.exports);
  return m.exports;
};

describe('rewriteAsyncArrows', () => {
  it('leaves no async arrow behind, and touches nothing else', () => {
    const src = [
      'const a = async (req, res) => { return req.x; };',
      'const b = async x => x + 1;',
      'const c = (x) => x * 2;',
      'async function d() { return 1; }',
    ].join('\n');
    const out = rewriteAsyncArrows(src, 'x.js');
    expect(asyncArrowsIn(out)).toBe(0);
    expect(out).toMatch(/const c = \(x\) => x \* 2/);
    expect(out).toMatch(/async function d\(\)/);
  });

  it('keeps `this` and `arguments` meaning what they meant', async () => {
    const out = rewriteAsyncArrows(`
      module.exports = {
        name: 'route',
        handler() { const f = async () => this.name; return f(); },
        args() { const f = async () => arguments[0]; return f(); },
      };`, 'x.js');
    const m = run(out);
    expect(await m.handler()).toBe('route');
    expect(await m.args('first')).toBe('first');
  });

  it('keeps line numbers, so stack traces still point at the right line', () => {
    const src = 'const a = 1;\n\n\nconst f = async () => {\n  return 1;\n};\n';
    expect(rewriteAsyncArrows(src, 'x.js').split('\n').findIndex((l) => l.includes('async function'))).toBe(3);
  });

  it('turns the fatal crash into a catchable error once sealed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-'));
    const file = path.join(dir, 'c.js');
    fs.writeFileSync(file, rewriteAsyncArrows(`
      const createInvoices = async (x) => {
        try { const account = await Promise.resolve(null); return account.ChildAccountId; }
        catch (e) { return 'caught: ' + e.message; }
      };
      module.exports = { createInvoices };`, file));
    require('bytenode').compileFile({ filename: file, output: `${file}c` });
    fs.rmSync(file);

    const out = execFileSync(process.execPath, ['-e',
      `require('bytenode'); require(${JSON.stringify(`${file}c`)}).createInvoices().then((r) => console.log(r));`,
    ], { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') });
    expect(out.trim()).toBe("caught: Cannot read properties of null (reading 'ChildAccountId')");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
