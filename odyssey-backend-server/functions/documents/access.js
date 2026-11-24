/**
 * MAY THIS USER SEE, ATTACH OR REMOVE THIS RECORD'S DOCUMENTS?
 *
 * The record's own rights (./kinds.js), checked as any in-route part is
 * (permissions/middleware allowsPart): Seanet and full access always; a
 * refusal is a 403 in enforce mode and a logged-and-allowed one in audit mode,
 * as for every other route on the install. The company is always checked - a
 * user restricted to some companies sees no other company's documents,
 * whatever the mode, as functions/companyAccess does for what a request names.
 */

const { kindOf } = require('./kinds');
const { DocumentError } = require('./store');
const { allowsPart } = require('../permissions/middleware');
const { grantsFor } = require('../permissions/grants');
const { isSystem } = require('../systemAccess');

let db;
const models = () => (db = db || require('../../models'));

const RECORD_ID = /^\d{1,15}$/;

/** The record a request is about: { kind, record, entity, recordId }, or a DocumentError. */
async function findRecord(entity, recordId) {
  const kind = kindOf(String(entity || ''));
  if (!kind) throw new DocumentError(400, 'Documents cannot be attached to that kind of record.');
  const id = String(recordId ?? '').trim();
  if (!RECORD_ID.test(id)) throw new DocumentError(400, 'Which record? Save it first - a new one has nothing to attach to yet.');
  const record = await models()[kind.model].findByPk(id, { attributes: kind.attributes, raw: true });
  if (!record) throw new DocumentError(404, `That ${kind.label.toLowerCase()} no longer exists.`);
  return { kind, record, entity: String(entity), recordId: id };
}

/** Throws a 403 when the record belongs to a company this user does not work in. */
function checkCompany(req, { kind, record }) {
  const allowed = req.allowedCompanies; // null: every company; unset: Seanet
  if (!allowed || !kind.company) return;
  const company = String(record[kind.company] ?? '').trim();
  if (company && !allowed.has(company)) throw new DocumentError(403, 'You do not have access to that company.');
}

/**
 * Throws a 403 unless the user may do `action` ('view' | 'add' | 'delete') to
 * this record's documents. The company first, then the right.
 */
async function check(req, target, action) {
  checkCompany(req, target);
  const needed = target.kind.rights(target.record)[action];
  if (!(await allowsPart(req, needed, `documents:${action}`))) {
    const names = needed.map((a) => a.replace(':', ' - ')).join(', or ');
    throw new DocumentError(403, `You do not have permission for this. It needs: ${names}.`);
  }
}

/**
 * What the screen should offer: { add, delete } from the user's grants - as
 * the screens' own useMyPermissions does - without logging anything.
 */
async function rightsFor(req, { kind, record }) {
  if (isSystem(req)) return { add: true, delete: true };
  const grants = await grantsFor(req.user.id);
  const rights = kind.rights(record);
  const has = (alternatives) => grants.all || alternatives.some((a) => grants.perms.has(a));
  return { add: has(rights.add), delete: has(rights.delete) };
}

module.exports = { findRecord, checkCompany, check, rightsFor };
