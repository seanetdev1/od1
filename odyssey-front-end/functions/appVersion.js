/**
 * WHICH RELEASE AN INSTALL IS ON - the chip in the header (BuildVersionChip).
 *
 * An install is two images, deployed one beside the other: the server reports
 * its release on /health (the tag CI stamped into it), and the screens carry
 * theirs, baked in by `next build` from the same tag (NEXT_PUBLIC_APP_VERSION -
 * see the Dockerfile and the release workflow). They are released together, so
 * the two agree; when they do not, one of them was not updated, and that is
 * worth seeing at a glance rather than finding out from a bug.
 *
 * A local run of either has no stamp and says 'dev'.
 */

// Written out in full, so `next build` can put the value in its place.
export const screensVersion = () => String(process.env.NEXT_PUBLIC_APP_VERSION || '').trim();

const isRelease = (v) => /^\d+\.\d+\.\d+/.test(v);
const shown = (v) => (isRelease(v) ? `v${v}` : v);

/**
 * What the chip says. `server` is /health's version; `screens` this build's.
 * null when neither is known (the server did not answer).
 */
export function versionChip(server, screens = screensVersion()) {
  const s = String(server || '').trim();
  const f = String(screens || '').trim();
  if (!s && !f) return null;
  const mismatch = isRelease(s) && isRelease(f) && s !== f;
  return {
    text: shown(s || f),
    mismatch,
    lines: mismatch
      ? [`Server ${shown(s)}, screens ${shown(f)} - two different releases.`, 'Deploy the same version of both.']
      : [s && f && s !== f ? `Server ${shown(s)}, screens ${shown(f)}` : `Version ${shown(s || f)}`],
  };
}
