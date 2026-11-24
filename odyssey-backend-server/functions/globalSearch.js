/* THE HEADER'S SEARCH - type a job, B/L, invoice or bill, voucher number or a
 * party's name, and jump to it (the user, 2026-11-23: records, covering jobs,
 * invoices & bills, vouchers, parties and B/Ls).
 *
 * Each kind is a contains-match on the number (or name), most recent first, a
 * few of each. My calls:
 *  - Jobs: freight job numbers; customs job numbers and GD numbers.
 *  - B/Ls: a freight job's HBL and MBL (HAWB and MAWB on an air job - the same
 *    columns), the AWB stock number it holds, and a customs job's B/L number.
 *    Each is listed under B/Ls (opening the B/L, or the job where there is no
 *    B/L screen) AND its job under Jobs, saying which number matched (the user,
 *    2026-11-23: "it should also show the job it belongs to").
 *  - Invoices & bills by number; vouchers by voucher number; parties by name or
 *    code.
 *  - Each kind only for a user who may see it (the module's view right, as the
 *    route table reads it - audit mode lets everything through), and records
 *    only in their companies. Parties through the model, so the per-company
 *    master lists (functions/companySeparation) scope them as they do every
 *    party picker.
 *  - Two characters at least; a cancelled job is still found (it is a record
 *    somebody may be looking for), and says so.
 *
 * Each result says what it is (`tag`: "Sea Export Job", "Sea B/L"...), its
 * number, who it is for (`party`), and the facts a row shows - route, load,
 * date - for the results panel the user laid out (2026-11-23).
 */
const { OPERATION_MODULE, PARTY_MODULES } = require('./permissions/catalog');
const { LINKING_REPORTS } = require('./permissions/routeRules');
const { escapeLike } = require('./directJobSearch');

const PER_KIND = 6;
const MIN_LENGTH = 2;

// What the job screens call the two numbers: a sea job's B/L, an air job's waybill.
const AIR = new Set(['AE', 'AI']);
const numberNames = (operation) => (AIR.has(String(operation || '').toUpperCase())
  ? { house: 'HAWB', master: 'MAWB' } : { house: 'HBL', master: 'MBL' });
const OPERATION_TAG = { SE: 'Sea Export Job', SI: 'Sea Import Job', AE: 'Air Export Job', AI: 'Air Import Job' };
const BL_TAG = { SE: 'Sea B/L', SI: 'Sea B/L', AE: 'Air AWB', AI: 'Air AWB' };

const view = (...modules) => modules.flat().map((m) => `${m}:view`);
const INVOICE_READERS = view('invoices', 'payments', 'jobInvoices', 'jobCharges', LINKING_REPORTS);
const VOUCHER_READERS = view('vouchers', 'payments', 'directJob', 'openingBalances', LINKING_REPORTS);

async function canSee(req, grants, alternatives) {
  if (req.user?.system === true || grants.all) return true;
  if (alternatives.some((a) => grants.perms.has(a))) return true;
  const { getMode } = require('./permissions/middleware');
  return (await getMode()) !== 'enforce';
}

const trim = (v) => String(v ?? '').trim();
const route = (pol, pod) => (trim(pol) || trim(pod) ? `${trim(pol) || '?'} → ${trim(pod) || '?'}` : '');
// A day as the row shows it; jobDate is typed, createdAt a timestamp.
const dayOf = (v) => {
  const s = trim(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
};

/** Search every kind this user may see for `q`. */
async function searchFor(req, q) {
  const term = String(q || '').trim();
  const empty = { term, jobs: [], bls: [], invoices: [], vouchers: [], parties: [] };
  if (term.length < MIN_LENGTH) return empty;

  const db = require('../models');
  const { Op } = db.Sequelize;
  const { grantsFor } = require('./permissions/grants');
  const system = req.user?.system === true;
  const grants = system ? { all: true, perms: new Set() } : await grantsFor(req.user.id);
  const companies = system ? null : (req.allowedCompanies || null);
  const inCompanies = (field) => (companies ? { [field]: { [Op.in]: [...companies] } } : {});
  const like = { [Op.iLike]: `%${escapeLike(term)}%` };
  const lower = term.toLowerCase();
  const out = { ...empty };

  // A job found through one of its numbers - under Jobs too, once, after the
  // jobs whose own number matched.
  const jobKeys = new Set();
  const viaNumber = [];
  const alsoJob = (job, matchedOn) => {
    const key = `${job.kind}-${job.id}`;
    if (jobKeys.has(key)) return;
    jobKeys.add(key);
    viaNumber.push({ ...job, matchedOn });
  };

  const freightJob = (j) => ({
    kind: 'freightJob', id: j.id, no: j.jobNo, operation: j.operation,
    tag: OPERATION_TAG[String(j.operation || '').toUpperCase()] || 'Job',
    party: j.Client?.name || '', load: trim(j.subType), route: route(j.pol, j.pod),
    date: dayOf(j.jobDate) || dayOf(j.createdAt), cancelled: Boolean(j.canceled),
  });
  const customsJob = (j) => ({
    kind: 'customsJob', id: j.id, no: j.jobNo, jobNo: j.jobNo,
    tag: `Customs ${j.direction === 'Import' ? 'Import' : 'Export'} Job`,
    party: j.client?.name || '', load: j.gdNumber ? `GD ${trim(j.gdNumber)}` : '', route: route(j.pol, j.pod),
    date: dayOf(j.gdDate) || dayOf(j.jobDate) || dayOf(j.createdAt), cancelled: Boolean(j.canceled),
  });
  const FREIGHT_JOB_ATTRS = ['id', 'jobNo', 'operation', 'canceled', 'subType', 'pol', 'pod', 'jobDate', 'createdAt'];
  const CUSTOMS_JOB_ATTRS = ['id', 'jobNo', 'gdNumber', 'gdDate', 'jobDate', 'createdAt', 'direction', 'canceled', 'pol', 'pod', 'blNo'];

  // Freight jobs, by operation's right.
  const freightOps = [];
  for (const [op, module] of Object.entries(OPERATION_MODULE)) {
    if (await canSee(req, grants, view(module))) freightOps.push(op);
  }

  if (freightOps.length) {
    const theJob = {
      model: db.SE_Job, attributes: FREIGHT_JOB_ATTRS, required: true,
      where: { operation: { [Op.in]: freightOps }, ...inCompanies('companyId') },
      include: [{ model: db.Clients, attributes: ['name'], required: false }],
    };

    const rows = await db.SE_Job.findAll({
      where: { jobNo: like, operation: { [Op.in]: freightOps }, ...inCompanies('companyId') },
      attributes: FREIGHT_JOB_ATTRS,
      include: [{ model: db.Clients, attributes: ['name'], required: false }],
      order: [['id', 'DESC']], limit: PER_KIND,
    });
    for (const r of rows) {
      jobKeys.add(`freightJob-${r.id}`);
      out.jobs.push(freightJob(r));
    }

    const bls = await db.Bl.findAll({
      where: { [Op.or]: [{ hbl: like }, { mbl: like }] },
      attributes: ['id', 'hbl', 'mbl', 'hblDate', 'mblDate'],
      include: [theJob],
      order: [['id', 'DESC']], limit: PER_KIND,
    });
    for (const b of bls) {
      // Numbers are stored as typed - some with a leading space.
      const house = trim(b.hbl);
      const master = trim(b.mbl);
      const op = String(b.SE_Job?.operation || '').toUpperCase();
      const names = numberNames(op);
      const onHouse = house.toLowerCase().includes(lower);
      out.bls.push({
        kind: 'freightBl', id: b.id, no: onHouse ? house : master, operation: op,
        tag: BL_TAG[op] || 'B/L', jobNo: b.SE_Job?.jobNo || '', party: b.SE_Job?.Client?.name || '',
        house, master, houseName: names.house, masterName: names.master,
        date: dayOf(onHouse ? b.hblDate : b.mblDate) || dayOf(b.SE_Job?.jobDate),
      });
      if (b.SE_Job) alsoJob(freightJob(b.SE_Job), `${onHouse ? names.house : names.master} ${onHouse ? house : master}`);
    }

    // An air job's waybill from the AWB stock (Setup > AWB Stock) - its MAWB.
    const awbs = await db.Awbl.findAll({
      where: { awbNumber: like },
      attributes: ['id', 'awbNumber'],
      include: [theJob],
      order: [['id', 'DESC']], limit: PER_KIND,
    });
    for (const a of awbs) {
      if (!a.SE_Job) continue;
      const job = freightJob(a.SE_Job);
      const number = trim(a.awbNumber);
      if (!out.bls.some((b) => b.no === number)) {
        out.bls.push({
          ...job, no: number, tag: 'AWB Stock', jobNo: job.no, house: '', master: number,
          houseName: 'HAWB', masterName: 'MAWB',
        });
      }
      alsoJob(job, `MAWB ${number}`);
    }
  }

  if (await canSee(req, grants, view('customs'))) {
    const client = { model: db.Clients, as: 'client', attributes: ['name'], required: false };
    const rows = await db.Customs_Job.findAll({
      where: { [Op.or]: [{ jobNo: like }, { gdNumber: like }], ...inCompanies('companyId') },
      attributes: CUSTOMS_JOB_ATTRS, include: [client],
      order: [['id', 'DESC']], limit: PER_KIND,
    });
    for (const r of rows) {
      jobKeys.add(`customsJob-${r.id}`);
      out.jobs.push(customsJob(r));
    }
    const bls = await db.Customs_Job.findAll({
      where: { blNo: like, ...inCompanies('companyId') },
      attributes: CUSTOMS_JOB_ATTRS, include: [client],
      order: [['id', 'DESC']], limit: PER_KIND,
    });
    for (const r of bls) {
      const job = customsJob(r);
      out.bls.push({
        ...job, no: trim(r.blNo), tag: 'Customs B/L', jobNo: r.jobNo,
        house: '', master: trim(r.blNo), houseName: '', masterName: 'B/L',
      });
      alsoJob(job, `B/L ${trim(r.blNo)}`);
    }
  }
  out.jobs = [...out.jobs, ...viaNumber].slice(0, PER_KIND * 2);
  out.bls = out.bls.slice(0, PER_KIND);

  if (await canSee(req, grants, INVOICE_READERS)) {
    const rows = await db.Invoice.findAll({
      where: { invoice_No: like, ...inCompanies('companyId') },
      attributes: ['id', 'invoice_No', 'party_Name', 'payType', 'type', 'currency', 'total', 'approved', 'createdAt'],
      order: [['id', 'DESC']], limit: PER_KIND,
    });
    for (const r of rows) {
      out.invoices.push({
        kind: 'invoice', id: r.id, no: r.invoice_No, tag: r.type || (r.payType === 'Payble' ? 'Bill' : 'Invoice'),
        party: r.party_Name || '', currency: r.currency || 'PKR', amount: Number(r.total || 0),
        unapproved: String(r.approved) !== '1', date: dayOf(r.createdAt),
      });
    }
  }

  if (await canSee(req, grants, VOUCHER_READERS)) {
    const rows = await db.Vouchers.findAll({
      where: { voucher_Id: like, ...inCompanies('CompanyId') },
      attributes: ['id', 'voucher_Id', 'type', 'vType', 'partyName', 'createdAt'],
      order: [['id', 'DESC']], limit: PER_KIND,
    });
    for (const r of rows) {
      out.vouchers.push({
        kind: 'voucher', id: r.id, no: r.voucher_Id, type: r.type, vType: r.vType,
        tag: r.vType || 'Voucher', detail: r.type || '', party: r.partyName || '', date: dayOf(r.createdAt),
      });
    }
  }

  if (await canSee(req, grants, view(PARTY_MODULES))) {
    const rows = await db.Clients.findAll({
      where: { [Op.or]: [{ name: like }, { code: like }] },
      attributes: ['id', 'name', 'code', 'types'],
      order: [['name', 'ASC']], limit: PER_KIND,
    });
    for (const r of rows) {
      const types = trim(r.types).split(',').map((t) => t.trim()).filter(Boolean);
      out.parties.push({
        kind: 'party', id: r.id, no: r.name, tag: types[0] || 'Party',
        detail: [r.code ? `Code ${r.code}` : null, types.slice(1).join(', ') || null].filter(Boolean).join(' · '),
      });
    }
  }

  return out;
}

module.exports = { searchFor, PER_KIND, MIN_LENGTH };
