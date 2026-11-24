/**
 * The browser tab's icon follows the selected company's screen logo -
 * functions/tabIcon. jsdom loads no images, so Image is replaced with one the
 * test finishes by hand; jsdom has no canvas either, which exercises the
 * fallback of using the logo as it is.
 */
import { setTabIcon } from '../functions/tabIcon';

let pending;
beforeEach(() => {
  pending = [];
  document.head.innerHTML = '<link rel="icon" href="/favicon.ico">';
  global.Image = class {
    set src(v) { this._src = v; pending.push(this); }
    get src() { return this._src; }
  };
  // jsdom logs "not implemented" for canvas; the helper handles a null context.
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const href = () => document.querySelector("link[rel~='icon']").getAttribute('href');
const LOGO_A = 'data:image/png;base64,AAAA';
const LOGO_B = 'data:image/png;base64,BBBB';

test('the tab shows the company logo once it loads', () => {
  setTabIcon(LOGO_A);
  expect(href()).toBe('/favicon.ico'); // not yet
  pending[0].onload();
  expect(href()).toBe(LOGO_A);
});

test('no logo puts the shipped icon back', () => {
  setTabIcon(LOGO_A);
  pending[0].onload();
  setTabIcon(null);
  expect(href()).toBe('/favicon.ico');
});

test('switching company twice quickly ends on the second logo', () => {
  setTabIcon(LOGO_A);
  setTabIcon(LOGO_B);
  pending[1].onload();
  pending[0].onload(); // the slower, older one lands last
  expect(href()).toBe(LOGO_B);
});

test('a logo that will not load leaves the default icon', () => {
  setTabIcon(LOGO_A);
  pending[0].onerror();
  expect(href()).toBe('/favicon.ico');
});
