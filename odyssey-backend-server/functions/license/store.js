// Local persistence for the licensing subsystem.
//
// Holds two things on disk next to the executable:
//   - the last valid SIGNED license (blob + signature) so the app keeps
//     working through internet outages, and
//   - a monotonic high-water clock mark, so setting the system clock backwards
//     can't be used to dodge the grace deadline or the offline hard-expiry.
//
// The file is tamper-evident by design: the license half is signed, so editing
// it just makes verification fail (-> treated as no license). The clock mark is
// only ever moved FORWARD in memory, so deleting the file can't rewind time
// within a running process.

const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { LICENSE_CACHE_PATH, CLOCK_SKEW_MS } = require('./config');

let cache = {
  firstBootAt: null, // epoch ms of the very first boot on this machine
  clockHighWater: 0, // highest trusted epoch ms ever observed
  licenseJson: null, // exact signed string
  signature: null, // base64 signature over licenseJson
};
let loaded = false;

// The clock high-water mark advances on essentially every request as real time
// passes. Persisting it to disk that often would be a synchronous write per
// request on a high-throughput server, so we only flush it periodically - a
// minute of un-persisted advance is harmless (on restart firstBootAt re-anchors
// it). Licence saves / server-time observations flush immediately.
const HIGHWATER_FLUSH_MS = 60 * 1000;
let lastFlushedAt = 0;

function load() {
  if (loaded) return cache;
  try {
    const raw = fs.readFileSync(LICENSE_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      firstBootAt: parsed.firstBootAt || null,
      clockHighWater: Number(parsed.clockHighWater) || 0,
      licenseJson: typeof parsed.licenseJson === 'string' ? parsed.licenseJson : null,
      signature: typeof parsed.signature === 'string' ? parsed.signature : null,
    };
  } catch (_) {
    // Missing/corrupt file - start fresh.
    cache = { firstBootAt: null, clockHighWater: 0, licenseJson: null, signature: null };
  }
  if (!cache.firstBootAt) {
    cache.firstBootAt = Date.now();
  }
  // Persisted first boot is also a clock anchor.
  cache.clockHighWater = Math.max(cache.clockHighWater, cache.firstBootAt);
  loaded = true;
  persist();
  return cache;
}

// Written atomically: serialise to a unique temp file in the same directory,
// then rename over the target. rename(2) within a filesystem is atomic, so a
// reader never observes a half-written file and a crash mid-write leaves the
// previous good copy intact.
//
// This matters more than it looks. The file holds the signed licence and the
// monotonic clock mark, and load() treats a corrupt/unparseable file as "no
// licence, first boot now" - so a single torn write silently resets the clock
// high-water mark, which is the thing that stops a customer dodging the grace
// deadline by winding the system clock back. Under `node server.js` every
// forked worker persists to this same path on its own schedule, which is
// exactly the interleaving that produces a torn write.
//
// The temp name includes pid so concurrent writers can't collide on it either.
// persist() runs on load, on every licence save and on every server-time
// observation, so a persistently-unwritable path produced the same line four
// times per process - times N workers. That volume is how a real problem gets
// scrolled past, so report the first failure loudly and then stay quiet until
// the reason changes.
let lastPersistError = null;

// Windows note: rename(2) onto an existing path is atomic on POSIX, but on
// Windows MoveFileEx fails with EPERM/EACCES if anything else has the target
// open even momentarily. With N cluster workers each persisting their own temp
// file onto the same target, that collision is routine - it showed up as a
// burst of EPERM at boot that then "recovered" on the next write. The data was
// never at risk (the temp file is complete before the rename, and the previous
// good copy stays intact on failure), but a dropped write is still a dropped
// write. A few short retries turn a routine collision into a non-event.
function renameWithRetry(from, to, attempts = 5) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const transient =
        err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY';
      if (!transient || i >= attempts - 1) throw err;
      // Busy-wait briefly - these collisions clear in single-digit ms, and
      // persist() is synchronous by design (it must survive a crash on exit).
      const until = Date.now() + 5 * (i + 1);
      while (Date.now() < until) { /* spin */ }
    }
  }
}

function persist() {
  const tmp = `${LICENSE_CACHE_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(cache), 'utf8');
    renameWithRetry(tmp, LICENSE_CACHE_PATH);
    lastFlushedAt = Date.now();
    if (lastPersistError) {
      console.log(`[license] cache is writable again (${LICENSE_CACHE_PATH})`);
      lastPersistError = null;
    }
  } catch (err) {
    // Non-fatal: we keep the in-memory copy and carry on. But this is not
    // cosmetic - without persistence the cached licence and the monotonic
    // clock mark don't survive a restart, so say what that means once.
    if (err.message !== lastPersistError) {
      lastPersistError = err.message;
      console.error(
        `[license] could not persist cache to ${LICENSE_CACHE_PATH}: ${err.message}\n` +
        '[license]   -> the licence and clock high-water mark will NOT survive a\n' +
        '[license]      restart. Set LICENSE_CACHE_PATH to a writable location.\n' +
        '[license]   (further identical errors suppressed)'
      );
    }
    // Don't leave the temp behind if the rename is what failed.
    try { fs.unlinkSync(tmp); } catch (_) { /* already gone */ }
  }
}

/**
 * A clock that never runs backwards. Returns max(system now, high-water mark).
 * If the system clock is behind the high-water mark by more than the allowed
 * skew, the clock was rolled back - we ignore it and use the high-water mark,
 * so signed grace/expiry deadlines can't be escaped.
 */
function guardedNow() {
  load();
  const sys = Date.now();
  if (sys > cache.clockHighWater) {
    cache.clockHighWater = sys;
    // Throttled flush - see HIGHWATER_FLUSH_MS. Keep the mark in memory always.
    if (sys - lastFlushedAt > HIGHWATER_FLUSH_MS) {
      lastFlushedAt = sys;
      persist();
    }
    return sys;
  }
  // sys <= high water: only trust the system clock if it's within skew.
  if (cache.clockHighWater - sys > CLOCK_SKEW_MS) {
    return cache.clockHighWater; // rolled back - pin to last trusted time
  }
  return cache.clockHighWater;
}

/** Fold a server-provided epoch (issued_at) into the high-water mark. */
function observeServerTime(epochMs) {
  load();
  if (Number.isFinite(epochMs) && epochMs > cache.clockHighWater) {
    cache.clockHighWater = epochMs;
    persist();
  }
}

function saveLicense(licenseJson, signature) {
  load();
  cache.licenseJson = licenseJson;
  cache.signature = signature;
  persist();
}

function getSavedLicense() {
  load();
  return { licenseJson: cache.licenseJson, signature: cache.signature };
}

function getFirstBootAt() {
  load();
  return cache.firstBootAt;
}

// Stable-ish machine fingerprint so the license server can detect a build
// copied to a different box. Best-effort: hostname + platform + first
// non-internal MAC. Not a security boundary on its own.
function getFingerprint() {
  const parts = [os.hostname(), os.platform(), os.arch()];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        parts.push(ni.mac);
        break;
      }
    }
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

module.exports = {
  load,
  guardedNow,
  observeServerTime,
  saveLicense,
  getSavedLicense,
  getFirstBootAt,
  getFingerprint,
};
