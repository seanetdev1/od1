/**
 * The install's outgoing mail settings, set by an admin rather than by whoever
 * deploys the container.
 *
 * These used to live only in the backend's .env - SMTP_HOST, SMTP_USER,
 * SMTP_PASS and the rest - which is fine for the company that builds the
 * software and wrong for everyone who leases it: a customer with their own mail
 * server had to send their credentials to us, wait for a redeploy, and do it
 * again every time the password changed. Now Configuration > Email writes them
 * to AppSetting and this reads them back.
 *
 * THE ENVIRONMENT IS STILL THE FALLBACK, and deliberately so. Every install
 * running today is configured through .env; if the saved settings are absent,
 * blank or unusable, mail keeps going out exactly as it did. Nothing has to be
 * migrated and nothing breaks on the deploy that introduces this.
 *
 *     saved settings (complete)  ->  used
 *     otherwise                  ->  SMTP_* from the environment
 *
 * THE PASSWORD NEVER GOES BACK TO THE BROWSER. `readEmailConfig` is for the
 * mailer; `describeEmailConfig` is what the settings screen is allowed to see,
 * and it reports only whether a password is stored. A field that round-trips a
 * secret to every admin who opens the page is a secret with a much larger
 * audience than the one person who typed it.
 *
 * It IS stored readable in the database, like the Postgres and SMTP passwords
 * in .env before it. That is the same posture the rest of the install takes -
 * the customer owns the database and is a superuser on it - and it is worth
 * stating plainly rather than implying encryption that is not there.
 */

const { AppSetting } = require('../models');

const KEY = 'smtpConfig';

// What a settings row holds. `pass` is the only field that is not echoed back.
const FIELDS = ['host', 'port', 'secure', 'user', 'pass', 'fromName', 'fromEmail'];

let _cached = null;

/** Parse a stored row into a plain object, never throwing on bad JSON. */
const parse = (raw) => {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch (_) {
    return null;
  }
};

const str = (v) => String(v ?? '').trim();

/**
 * Is this set of settings usable?
 *
 * Host, user and password, which is exactly what the mailer needed from the
 * environment before. A half-filled form must NOT take precedence over a
 * working .env - that would take an install's mail off the air the moment
 * somebody opened the settings page and saved it by accident.
 */
const isComplete = (c) => Boolean(c && str(c.host) && str(c.user) && str(c.pass));

/** The settings the environment supplies, in the same shape. */
const fromEnv = () => ({
  host: str(process.env.SMTP_HOST),
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  user: str(process.env.SMTP_USER),
  pass: str(process.env.SMTP_PASS),
  fromName: str(process.env.SMTP_FROM_NAME),
  fromEmail: str(process.env.SMTP_FROM_EMAIL),
  source: 'environment',
});

/**
 * What the mailer should use. Cached, because every email sent reads it.
 *
 * Never throws: failing to read a preference is not a reason to lose the
 * fallback. A database blip returns the environment rather than nothing.
 */
const readEmailConfig = async () => {
  if (_cached) return _cached;

  let saved = null;
  try {
    const row = await AppSetting.findOne({ where: { key: KEY } });
    saved = parse(row?.value);
  } catch (_) {
    // Deliberately not cached - a blip should not pin the fallback in memory
    // for the life of the process.
    return fromEnv();
  }

  if (isComplete(saved)) {
    _cached = {
      host: str(saved.host),
      port: Number(saved.port) || 587,
      secure: Boolean(saved.secure),
      user: str(saved.user),
      pass: String(saved.pass),
      fromName: str(saved.fromName),
      fromEmail: str(saved.fromEmail),
      source: 'settings',
    };
  } else {
    _cached = fromEnv();
  }
  return _cached;
};

/**
 * What the settings SCREEN may see: everything except the password, plus
 * whether one is stored and which source is currently in force.
 */
const describeEmailConfig = async () => {
  const [saved, env] = await Promise.all([
    (async () => {
      try {
        const row = await AppSetting.findOne({ where: { key: KEY } });
        return parse(row?.value);
      } catch (_) {
        return null;
      }
    })(),
    Promise.resolve(fromEnv()),
  ]);

  const active = isComplete(saved) ? 'settings' : (isComplete(env) ? 'environment' : 'none');

  return {
    host: str(saved?.host),
    port: Number(saved?.port) || 587,
    secure: Boolean(saved?.secure),
    user: str(saved?.user),
    fromName: str(saved?.fromName),
    fromEmail: str(saved?.fromEmail),
    // Never the password itself.
    hasPassword: Boolean(str(saved?.pass)),
    // So the screen can say "these settings are saved but the environment is
    // what is actually sending" rather than leaving an admin to guess.
    active,
    envConfigured: isComplete(env),
  };
};

/**
 * Save, merging over what is stored.
 *
 * A BLANK PASSWORD MEANS "leave it alone", because the screen never receives
 * the stored one and therefore cannot send it back. Without this rule, editing
 * the port would silently wipe the password.
 */
const writeEmailConfig = async (input) => {
  const row = await AppSetting.findOne({ where: { key: KEY } });
  const existing = parse(row?.value) || {};

  const next = {
    host: str(input.host),
    port: Number(input.port) || 587,
    secure: Boolean(input.secure),
    user: str(input.user),
    pass: str(input.pass) || str(existing.pass),
    fromName: str(input.fromName),
    fromEmail: str(input.fromEmail),
  };

  const value = JSON.stringify(next);
  if (row) await row.update({ value });
  else await AppSetting.create({ key: KEY, value });

  resetEmailConfig();
  return next;
};

/** Forget the cached settings - call after any save. */
const resetEmailConfig = () => { _cached = null; };

module.exports = {
  KEY, FIELDS,
  readEmailConfig, describeEmailConfig, writeEmailConfig, resetEmailConfig,
  isComplete, fromEnv,
};
