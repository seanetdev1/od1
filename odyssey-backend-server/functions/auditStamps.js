/**
 * WHO MADE A RECORD, AND WHO LAST CHANGED IT.
 *
 * Jobs (freight, customs, aviation), vouchers, invoices and charge lines carry
 *
 *   createdBy / createdOn   who entered it, and when
 *   editedBy  / editedOn    who last changed it, and when
 *
 * - the four Climax kept on every one of those tables (AddBy / AddOn / EditBy /
 * EditOn). The user's request, 2026-10-09.
 *
 * NOT createdAt / updatedAt. On an invoice or a voucher createdAt is the
 * document's DATE - what the ledger and every report read, and what Date
 * Change and back-dating move - so it says nothing about when the row was
 * entered. updatedAt moves on everything, a receipt knocked off an invoice
 * included. Charge lines have neither.
 *
 * STAMPED HERE, not in the routes: the hooks below are the one place every
 * create, update and upsert of these tables passes through - the same choke
 * point the fiscal-year lock uses - so no save path can forget it. The person
 * is the signed-in user behind the request (functions/fiscalYearContext), by
 * name, as Climax's logs read. A write outside a request (a script) stamps no
 * person and no edit.
 *
 * WHAT IS AN EDIT: a change to the record's own content. Not
 *   - a save that changes nothing. The charges screen saves every line of the
 *     job each time, and the job's exchange rate with them; a line, or a job,
 *     that came back as it was is not edited. Each is compared with what is
 *     stored before it is stamped.
 *   - on an invoice, what was received or paid against it (recieved, paid,
 *     status). That is a receipt or payment, recorded on its own voucher with
 *     its own creator.
 *   - a `silent` update: a repair, which the codebase marks that way.
 *
 * NEVER REWRITTEN: who created a record. An update cannot change createdBy or
 * createdOn, whatever the browser sends back, and editedBy / editedOn are only
 * ever what this file puts there.
 *
 * MIGRATED RECORDS (created with a climaxId) are left as the import wrote
 * them - a voucher's createdBy holds Climax's own add log - and whoever ran
 * the import does not become their creator. Editing one in Odyssey afterwards
 * is stamped like any other edit. Pass { audit: false } to skip all of this.
 */
const { getRequestUserId } = require('./fiscalYearContext');

const AUDIT_FIELDS = ['createdBy', 'createdOn', 'editedBy', 'editedOn'];

/** The four columns, for a model's define(). */
function auditAttributes(DataTypes) {
  return {
    createdBy: { type: DataTypes.STRING },
    createdOn: { type: DataTypes.DATE },
    editedBy: { type: DataTypes.STRING },
    editedOn: { type: DataTypes.DATE },
  };
}

/* Per model: fields whose change on its own is not an edit. */
const NOT_AN_EDIT = {
  Invoice: ['recieved', 'paid', 'status'],
};
const NEVER_CONTENT = new Set([...AUDIT_FIELDS, 'id', 'updatedAt']);

const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Is a stored value the same as the one being written? Loosely: "100" is
 *  100 and 100.00, null is '', a Date is its moment. */
function same(stored, given) {
  if (stored instanceof Date || given instanceof Date) {
    const t = (v) => (v == null || v === '' ? null : new Date(v).getTime());
    const a = t(stored);
    const b = t(given);
    return a === b || (Number.isNaN(a) && Number.isNaN(b));
  }
  const s = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).trim());
  const a = s(stored);
  const b = s(given);
  if (a === b) return true;
  return NUMERIC.test(a) && NUMERIC.test(b) && Math.abs(Number(a) - Number(b)) < 1e-9;
}

const isMigrated = (v) => v != null && v.climaxId != null && v.climaxId !== '';

/** Of these fields, the ones that are the record's own content. */
const contentKeys = (Model, keys) => {
  const notAnEdit = NOT_AN_EDIT[Model.name] || [];
  return keys.filter((k) => Model.rawAttributes[k] && !NEVER_CONTENT.has(k) && !notAnEdit.includes(k));
};

/* The signed-in user's name, looked up once in a while rather than on every
   write - a name changes rarely, and a job's charges are many writes. */
const NAME_TTL_MS = 10 * 60 * 1000;
const names = new Map();
async function actorName(db, transaction) {
  const id = getRequestUserId();
  if (!id) return null;
  const hit = names.get(String(id));
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.name;
  let person = null;
  try {
    person = await db.Employees.findByPk(id, { attributes: ['name', 'username'], raw: true, transaction });
  } catch (_) { /* no name: nothing stamped, the save goes on */ }
  const name = (person && (person.name || person.username)) || null;
  names.set(String(id), { name, at: Date.now() });
  return name;
}

function registerAuditStamps(db, modelNames) {
  const { SequelizeMethod } = db.Sequelize.Utils;
  const isLiteral = (v) => v instanceof SequelizeMethod;

  for (const modelName of modelNames) {
    const Model = db[modelName];
    if (!Model) continue;
    const content = (keys) => contentKeys(Model, keys);
    const withFields = (fields, more) => (Array.isArray(fields) ? [...new Set([...fields, ...more])] : fields);

    const stampNew = (instance, by, now) => {
      if (isMigrated(instance.get())) return;
      instance.set('createdOn', now);
      if (by) instance.set('createdBy', by);
      instance.set('editedBy', null);
      instance.set('editedOn', null);
    };

    Model.addHook('beforeCreate', async (instance, options) => {
      if (options.audit === false) return;
      stampNew(instance, await actorName(db, options.transaction), new Date());
      options.fields = withFields(options.fields, AUDIT_FIELDS);
    });

    // options.auditStamps: for a save that deletes its lines and writes them
    // again, each line's stamps as they should stand (carriedStamps), in the
    // order of the rows - null for a line that is new.
    Model.addHook('beforeBulkCreate', async (instances, options) => {
      if (options.audit === false) return;
      const by = await actorName(db, options.transaction);
      const now = new Date();
      instances.forEach((instance, i) => {
        const carried = options.auditStamps?.[i];
        if (carried) for (const f of AUDIT_FIELDS) instance.set(f, carried[f] ?? null);
        else stampNew(instance, by, now);
      });
      options.fields = withFields(options.fields, AUDIT_FIELDS);
    });

    // instance.update() / instance.save()
    Model.addHook('beforeUpdate', async (instance, options) => {
      if (options.audit === false || options.silent) return;
      options.fields = (options.fields || []).filter((f) => !AUDIT_FIELDS.includes(f));
      const changed = content(instance.changed() || [])
        .filter((f) => options.fields.includes(f))
        .filter((f) => isLiteral(instance.get(f)) || !same(instance.previous(f), instance.get(f)));
      if (!changed.length) return;
      const by = await actorName(db, options.transaction);
      if (!by) return;
      instance.set('editedBy', by);
      instance.set('editedOn', new Date());
      options.fields = withFields(options.fields, ['editedBy', 'editedOn']);
    });

    // Model.update(values, { where })
    Model.addHook('beforeBulkUpdate', async (options) => {
      if (options.audit === false || options.silent) return;
      const values = options.attributes || {};
      for (const f of AUDIT_FIELDS) delete values[f];
      options.fields = (options.fields || Object.keys(values)).filter((f) => !AUDIT_FIELDS.includes(f));
      const keys = content(Object.keys(values).filter((k) => options.fields.includes(k)));
      if (!keys.length) return;
      const by = await actorName(db, options.transaction);
      if (!by) return;
      // Unless an amount is worked out in SQL, look: a save that writes back
      // what is already there is not an edit.
      if (!keys.some((k) => isLiteral(values[k]))) {
        const rows = await Model.findAll({
          where: options.where, attributes: keys, transaction: options.transaction, raw: true,
        });
        if (!rows.some((r) => keys.some((k) => !same(r[k], values[k])))) return;
      }
      values.editedBy = by;
      values.editedOn = new Date();
      options.attributes = values;
      options.fields = withFields(options.fields, ['editedBy', 'editedOn']);
    });

    // Model.upsert(). Its beforeUpsert hook runs after Sequelize has already
    // built the INSERT and UPDATE values from what it was given, so a hook
    // cannot add to them - the values are stamped on the way in instead.
    const upsert = Model.upsert;
    Model.upsert = async function upsertWithAuditStamps(values, options = {}) {
      if (!values || options.audit === false) return upsert.call(this, values, options);
      const pk = this.primaryKeyAttribute;
      const existing = values[pk] != null
        ? await this.findByPk(values[pk], { transaction: options.transaction, raw: true })
        : null;
      if (!existing && isMigrated(values)) return upsert.call(this, values, options);

      const v = { ...values };
      for (const f of AUDIT_FIELDS) delete v[f];
      const by = await actorName(db, options.transaction);
      const now = new Date();
      if (!existing) {
        v.createdOn = now;
        if (by) v.createdBy = by;
      } else if (by && content(Object.keys(v)).some((k) => isLiteral(v[k]) || !same(existing[k], v[k]))) {
        v.editedBy = by;
        v.editedOn = now;
      }
      return upsert.call(this, v, options);
    };
  }
}

/**
 * A line a save deletes and writes again - the customs and aviation charge
 * sheets replace every line not on an invoice each time - is the same line,
 * and keeps who entered it. It is edited only if what is written differs from
 * what was there. For bulkCreate's options.auditStamps.
 *
 * @param old     the row as it was, before the delete
 * @param values  what is being written in its place
 */
async function carriedStamps(db, Model, old, values, transaction) {
  const kept = {};
  for (const f of AUDIT_FIELDS) kept[f] = old?.[f] ?? null;
  const changed = contentKeys(Model, Object.keys(values)).some((k) => !same(old?.[k], values[k]));
  if (changed) {
    const by = await actorName(db, transaction);
    if (by) Object.assign(kept, { editedBy: by, editedOn: new Date() });
  }
  return kept;
}

module.exports = { auditAttributes, registerAuditStamps, carriedStamps, AUDIT_FIELDS, same };
