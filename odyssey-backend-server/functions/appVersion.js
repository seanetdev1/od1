// WHICH RELEASE THIS SERVER IS - read by /health (the version in every
// install's header) and by the licence status (Configuration's "App version").
//
// CI stamps the tag it built into the image as ODYSSEY_APP_VERSION (see the
// Dockerfile). package.json's version is never bumped and read 1.0.0 on every
// install, whatever was deployed (2026-11-15), so it is not used at all: a
// server with no stamp - a local run - says 'dev', which is what it is.
const appVersion = () => String(process.env.ODYSSEY_APP_VERSION || '').trim() || 'dev';

module.exports = { appVersion };
