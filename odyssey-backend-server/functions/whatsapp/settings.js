/* WHATSAPP DAILY UPDATE - its settings (Config > WhatsApp).
 *
 * The user's request (2026-10-24): a daily WhatsApp update to designated
 * users - the day's new bookings and new invoices, job by job, with selling,
 * buying and profit. Their choices: Meta's WhatsApp Cloud API; a short
 * summary with the full report attached as a PDF; per job; in the evening,
 * covering that day.
 *
 * WHY A TEMPLATE AND A PDF. Meta lets a business START a conversation only
 * with a message template it has approved, and a template's variables cannot
 * hold line breaks - a day's list cannot go in the message. So the message is
 * the approved template (TEMPLATE below) with the day's totals as its
 * variables, and the list is the PDF in its document header.
 *
 * Off until switched on. The access token is kept apart (TOKEN_KEY) and never
 * sent back to the screen - only whether one is stored.
 */
const db = () => require('../../models');

const KEY = 'whatsappUpdates';
const TOKEN_KEY = 'whatsappToken';

/* What to create in WhatsApp Manager (Message templates > Create): category
 * Utility, the language below, a Document header, and exactly this body. The
 * variables are filled in this order - see runner.bodyParams. */
const TEMPLATE = Object.freeze({
  name: 'odyssey_daily_update',
  language: 'en',
  category: 'UTILITY',
  header: 'DOCUMENT',
  body: 'Here is your Odyssey daily update for {{1}}. New bookings entered today: {{2}}. '
    + 'New invoices and bills raised today: {{3}}. Selling: PKR {{4}}. Buying: PKR {{5}}. '
    + 'Profit: PKR {{6}}. The full report, job by job, is attached.',
  footer: 'Sent by Odyssey',
  variables: ['the date', 'new bookings', 'new invoices and bills', 'selling', 'buying', 'profit'],
});

const DEFAULTS = Object.freeze({
  enabled: false,
  connection: { phoneNumberId: '', businessAccountId: '', apiVersion: 'v22.0' },
  template: { name: TEMPLATE.name, language: TEMPLATE.language },
  time: '20:00',
  timeZone: 'Asia/Karachi',
  defaultCountryCode: '92',
  recipients: [],
  sendWhenEmpty: true,
  companies: [],
});

class SettingsError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

const withDefaults = (stored) => {
  const out = clone(DEFAULTS);
  if (!isObject(stored)) return out;
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in out)) continue;
    out[k] = isObject(out[k]) && isObject(v) ? { ...out[k], ...v } : v;
  }
  return out;
};

/**
 * A WhatsApp number as the Cloud API takes it: digits only, with the country
 * code, no '+'. '0300 1234567' with country code 92 is 923001234567; '+92 300
 * 1234567' and '0092300...' are the same. Null when it cannot be one.
 */
const normalizePhone = (input, countryCode = '92') => {
  let s = String(input ?? '').trim();
  if (!s) return null;
  const plus = s.startsWith('+');
  s = s.replace(/[^\d]/g, '');
  if (!s) return null;
  if (!plus) {
    if (s.startsWith('00')) s = s.slice(2);
    else if (s.startsWith('0')) s = `${String(countryCode).replace(/\D/g, '')}${s.slice(1)}`;
  }
  return s.length >= 8 && s.length <= 15 ? s : null;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const validTimeZone = (tz) => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch (_) { return false; }
};

const validate = (input) => {
  const s = withDefaults(input);
  if (typeof s.enabled !== 'boolean') throw new SettingsError('The daily update must be on or off.');
  if (typeof s.sendWhenEmpty !== 'boolean') throw new SettingsError('"Send on a quiet day" must be on or off.');
  const time = String(s.time ?? '').trim();
  if (!TIME.test(time)) throw new SettingsError('The time must be like 20:00.');
  if (!validTimeZone(s.timeZone)) throw new SettingsError(`Not a time zone: ${s.timeZone}.`);
  const cc = String(s.defaultCountryCode ?? '').replace(/\D/g, '');
  if (!cc || cc.length > 4) throw new SettingsError('The country code must be digits, e.g. 92.');

  const phoneNumberId = String(s.connection.phoneNumberId ?? '').trim();
  if (phoneNumberId && !/^\d{5,25}$/.test(phoneNumberId)) throw new SettingsError('The phone number ID is the number Meta shows under API Setup - digits only, not the phone number itself.');
  const businessAccountId = String(s.connection.businessAccountId ?? '').trim();
  if (businessAccountId && !/^\d{5,25}$/.test(businessAccountId)) throw new SettingsError('The WhatsApp Business Account ID is digits only.');
  const apiVersion = String(s.connection.apiVersion ?? '').trim();
  if (!/^v\d{1,3}\.\d{1,2}$/.test(apiVersion)) throw new SettingsError('The API version must be like v22.0.');

  const name = String(s.template.name ?? '').trim();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new SettingsError('The template name is lowercase letters, digits and underscores, as WhatsApp Manager shows it.');
  const language = String(s.template.language ?? '').trim();
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) throw new SettingsError('The template language is a code like en or en_US.');

  const recipients = [];
  for (const r of Array.isArray(s.recipients) ? s.recipients : []) {
    const label = String(r?.name ?? '').trim();
    if (!label && !String(r?.phone ?? '').trim()) continue;
    const phone = normalizePhone(r?.phone, cc);
    if (!phone) throw new SettingsError(`Not a WhatsApp number: "${r?.phone ?? ''}"${label ? ` (${label})` : ''}.`);
    if (!recipients.some((x) => x.phone === phone)) recipients.push({ name: label || phone, phone });
  }
  if (s.enabled && !recipients.length) throw new SettingsError('Add at least one person to send the daily update to.');
  if (s.enabled && !phoneNumberId) throw new SettingsError('The phone number ID is needed to send - from WhatsApp Manager, API Setup.');

  return {
    enabled: s.enabled,
    connection: { phoneNumberId, businessAccountId, apiVersion },
    template: { name, language },
    time,
    timeZone: String(s.timeZone),
    defaultCountryCode: cc,
    recipients,
    sendWhenEmpty: s.sendWhenEmpty,
    companies: [...new Set((Array.isArray(s.companies) ? s.companies : []).map(String).filter(Boolean))],
  };
};

const readRow = async (key) => {
  try { return await db().AppSetting.findOne({ where: { key } }); } catch (_) { return null; }
};
const writeRow = async (key, value) => {
  const row = await db().AppSetting.findOne({ where: { key } });
  if (row) await row.update({ value });
  else await db().AppSetting.create({ key, value });
};

const readSettings = async () => {
  const row = await readRow(KEY);
  try { return withDefaults(row?.value ? JSON.parse(row.value) : null); } catch (_) { return withDefaults(null); }
};

/** The token - for sending only; never to the screen. */
const readToken = async () => String((await readRow(TOKEN_KEY))?.value || '');

/** Save the settings; `token` replaces the stored one only when given. */
const writeSettings = async (input, token) => {
  const value = validate(input);
  if (typeof token === 'string' && token.trim()) await writeRow(TOKEN_KEY, token.trim());
  if (value.enabled && !(await readToken())) throw new SettingsError('The access token is needed to send - from WhatsApp Manager / Business Settings > System users.');
  await writeRow(KEY, JSON.stringify(value));
  return value;
};

module.exports = {
  KEY, TOKEN_KEY, TEMPLATE, DEFAULTS, SettingsError,
  withDefaults, validate, normalizePhone, readSettings, readToken, writeSettings,
};
