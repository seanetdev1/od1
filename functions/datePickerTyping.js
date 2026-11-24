/**
 * Every antd date box takes a typed date in the shapes people type them, not
 * only its display format - see functions/lenientDateParse. Imported once, by
 * pages/_app, for this effect alone.
 *
 * Both builds of the date library's moment config: the browser bundle uses
 * the ES one (antd/es), the server render the CommonJS one (antd/lib). They
 * are separate objects, so each is taught separately. The ES one only in the
 * browser: Node cannot load that build (its imports name files without their
 * .js), and the server render never uses it.
 */
import libMomentConfig from 'rc-picker/lib/generate/moment';
import { makeLenient } from './lenientDateParse';

makeLenient(libMomentConfig);

if (typeof window !== 'undefined') {
  // eslint-disable-next-line global-require
  const es = require('rc-picker/es/generate/moment');
  makeLenient(es?.default || es);
}
