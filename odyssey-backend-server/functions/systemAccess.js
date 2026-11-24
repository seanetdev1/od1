// WHO IS "SYSTEM" - the vendor (Seanet) on a leased install.
//
// A leased install is run by the client: they own the server, its .env (so
// JWT_SECRET) and the Postgres superuser. Anything stored there - an Employees
// row, a designation, a signed session token - they can write themselves. So
// "is this the vendor?" cannot be answered from anything the install holds.
//
// It is answered by a SUPPORT CREDENTIAL: a short-lived blob signed by the
// licence server's Ed25519 PRIVATE key, which never leaves Seanet. The install
// only has the public key (functions/license/config.js), which can check a
// credential but never make one. Every request that needs system rights
// re-verifies the credential it carries, so a session token the client mints
// with their own JWT_SECRET gets nothing unless it also carries a genuine,
// unexpired credential issued for THIS install.
//
// Exempt installs (LICENSE_EXEMPT=true - Seanet's own) have no client to lock
// out: there, the admin designation is system.
//
// Credential format:  ods1.<base64url(json)>.<base64url(signature)>
// The signature covers SUPPORT_DOMAIN + json, never the bare json. Licences are
// signed by the same key over their bare json, so the prefix is what stops a
// licence blob from ever verifying as a credential, or the other way round.

const crypto = require('crypto');
const licenseConfig = require('./license/config');
const store = require('./license/store');
const { hasDesignation } = require('./requireDesignation');

const PREFIX = 'ods1.';
const SUPPORT_DOMAIN = 'odyssey-support-v1\n';
// Longest a credential may live, whatever the signer asked for. A credential is
// a bearer secret on a machine the client controls; one copied out of a
// browser must not be good for a month.
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
// Tolerance for an issue time slightly ahead of this server's clock.
const FUTURE_SKEW_MS = 10 * 60 * 1000;

// The designation stored on the hidden Employees row a support login creates.
// Password login refuses it, so writing it onto your own row in the database
// locks that account rather than promoting it.
const SYSTEM_DESIGNATION = 'system';

const b64urlDecode = (s) => Buffer.from(String(s), 'base64url');

// Overridable in tests, which cannot rebuild functions/license/config.
let configOverride = null;
const cfg = () => ({ ...licenseConfig, ...(configOverride || {}) });

/**
 * Check a support credential.
 * @returns {{ok:true, payload:object} | {ok:false, reason:string}}
 */
function verifySupportCredential(credential, { now } = {}) {
  if (typeof credential !== 'string' || !credential.startsWith(PREFIX)) {
    return { ok: false, reason: 'not a support credential' };
  }
  const parts = credential.slice(PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'malformed credential' };
  }

  let json;
  try {
    json = b64urlDecode(parts[0]).toString('utf8');
    const ok = crypto.verify(
      null,
      Buffer.from(SUPPORT_DOMAIN + json, 'utf8'),
      cfg().LICENSE_PUBLIC_KEY,
      b64urlDecode(parts[1])
    );
    if (!ok) return { ok: false, reason: 'signature does not verify' };
  } catch (_) {
    return { ok: false, reason: 'signature does not verify' };
  }

  let payload;
  try {
    payload = JSON.parse(json);
  } catch (_) {
    return { ok: false, reason: 'malformed credential' };
  }

  if (payload.typ !== 'support') return { ok: false, reason: 'not a support credential' };
  if (payload.install_id !== cfg().INSTALL_ID) {
    return { ok: false, reason: `issued for install "${payload.install_id}", this is "${cfg().INSTALL_ID}"` };
  }
  const iat = Number(payload.iat);
  const exp = Number(payload.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || exp <= iat) {
    return { ok: false, reason: 'malformed credential' };
  }
  if (exp - iat > MAX_LIFETIME_MS) return { ok: false, reason: 'credential lifetime exceeds 24 hours' };

  // The licence store's clock never runs backwards, so winding the server
  // clock back does not revive an expired credential.
  const t = now ?? store.guardedNow();
  if (iat > t + FUTURE_SKEW_MS) return { ok: false, reason: 'credential is not valid yet - check the server clock' };
  if (exp <= t) return { ok: false, reason: 'credential has expired' };

  return { ok: true, payload };
}

/** Is the signed-in user the vendor? Re-verified on every call. */
function isSystem(req) {
  if (!req || !req.user) return false;
  if (cfg().LICENSE_EXEMPT) return hasDesignation(req, ['admin']) || req.user.system === true;
  if (req.user.system !== true) return false;
  return verifySupportCredential(req.user.supportCredential).ok;
}

const MANAGED_MESSAGE =
  'This is managed by Seanet. Contact Seanet support to change it.';

/** Route guard: system only. */
function requireSystem(req, res, next) {
  if (isSystem(req)) return next();
  return res.status(403).json({ status: 'error', result: MANAGED_MESSAGE });
}

module.exports = {
  PREFIX,
  SUPPORT_DOMAIN,
  MAX_LIFETIME_MS,
  SYSTEM_DESIGNATION,
  MANAGED_MESSAGE,
  verifySupportCredential,
  isSystem,
  requireSystem,
  _setConfigForTest(override) { configOverride = override; },
};
