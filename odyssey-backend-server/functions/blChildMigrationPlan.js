/**
 * Plan the things that hang off a B/L: containers, stamps, dimensions and the
 * air waybill's rate lines.
 *
 * All four attach to a Bl through Bl.climaxId, scoped by operation, so this
 * stage depends on the B/L stage having run.
 *
 * IDEMPOTENCY IS PARENT-SCOPED, NOT ROW-SCOPED
 *
 * Container_Info and Stamps have a climaxId column; Item_Details and
 * Dimensions do not, and Item_Details could not use one anyway - its rows are
 * not legacy rows at all, they are four inline blocks of columns on the
 * waybill. So a re-run asks "does this B/L already have children of this
 * kind?" and skips the whole B/L if so. That is correct because children are
 * always written as a complete set per B/L, and it needs no schema change.
 * Where the column exists, climaxId is still populated - the old import left
 * it null on every container and stamp it ever created.
 *
 * WHAT THE OLD IMPORT GOT WRONG
 *
 *   tare: GrossWt - NetWt   SExp_BL_Equipment has a real TareWt column. The
 *                           old import ignored it and subtracted instead,
 *                           which yields NaN whenever either weight is null.
 *
 *   detention / demurge /   Hardcoded to ''. The source carries
 *   plugin                  dFreeDaysDetention, dFreeDaysDemurrage and
 *                           dFreeDaysPlugIn - the free-day counts a container
 *                           is actually billed against.
 *
 *   date: bl.AddOn          Paired with `number: dFormENumber`, so the date
 *                           belongs to the form E, not the B/L's creation
 *                           timestamp. Uses dFormEDate.
 *
 *   climaxId                Never set on containers or stamps, so neither
 *                           could be verified or re-run.
 *
 *   Dimensions              Never imported at all. Nothing in any receiver
 *                           creates them from a B/L.
 *
 * AIR IMPORT DIMENSIONS are keyed by AIJobId, not a B/L id - they hang off the
 * job. They are resolved through that job's waybill, which is 1:1.
 *
 * No database access here - pure, so it can be unit-tested.
 */

const KINDS = ['containers', 'stamps', 'dimensions', 'items'];

/** Which legacy column points at the parent, per kind and operation. */
const PARENT_KEY = {
  containers: { SE: 'SEBLId', SI: 'SIBLId' },
  stamps: { SE: 'SEBLId', SI: 'SIBLId', AE: 'AEBLId' },
  // AI dimensions point at the job; the route resolves that to its waybill.
  dimensions: { AE: 'AEBLId', AI: 'AIJobId' },
  // An item block's "parent" is the waybill row it is part of.
  items: { AE: 'Id', AI: 'Id' },
};

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s || null;
}

function toLegacyId(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** A number if it really is one, otherwise null - never NaN. */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tare weight, preferring the column the source actually has.
 *
 * The old import always subtracted, so a container with a null gross or net
 * weight got NaN written into the column.
 */
function tareOf(row) {
  const tare = toNumber(row.TareWt);
  if (tare !== null) return tare;
  const gross = toNumber(row.GrossWt);
  const net = toNumber(row.NetWt);
  if (gross === null || net === null) return null;
  return gross - net;
}

function mapContainer(row, ctx = {}) {
  const packing = ctx.packing || new Map();
  return {
    no: cleanText(row.ContainerNo),
    seal: cleanText(row.SealNo),
    size: cleanText(row.EquipCode),
    rategroup: cleanText(row.RateGroup),
    gross: row.GrossWt ?? null,
    net: row.NetWt ?? null,
    tare: tareOf(row),
    wtUnit: Number(row.WTUnitId) === 2 ? 'KGS' : '',
    cbm: row.CBM ?? null,
    pkgs: row.NoOfPackages ?? null,
    unit: packing.get(String(row.PackagesCode)) ?? null,
    temp: row.Temperature ?? null,
    loadType: Number(row.LoadTypeId) === 2 ? 'FULL' : 'EMPTY',
    remarks: cleanText(row.Remarks),
    // The free-day counts the container is billed against. Hardcoded to ''
    // by the old import, while the source has all three.
    detention: row.dFreeDaysDetention ?? '',
    demurge: row.dFreeDaysDemurrage ?? '',
    plugin: row.dFreeDaysPlugIn ?? '',
    dg: Number(row.dDGNonDGId) === 2 ? 'non-DG' : 'DG',
    number: cleanText(row.dFormENumber),
    // Pairs with `number` above - the form E's date, not the B/L's.
    date: row.dFormEDate ?? null,
    top: row.OOG_TOP ?? null,
    right: row.OOG_RIGHT ?? null,
    left: row.OOG_LEFT ?? null,
    front: row.OOG_FRONT ?? null,
    back: row.OOG_BACK ?? null,
    climaxId: toLegacyId(row.Id),
  };
}

function mapStamp(row, ctx = {}) {
  const stamps = ctx.stamps || new Map();
  const hit = stamps.get(String(row.StampId)) || {};
  return {
    code: cleanText(hit.StampCode),
    stamps: cleanText(hit.StampName),
    stamp_group: row.StampGroupId ?? null,
    climaxId: toLegacyId(row.Id),
  };
}

function mapDimension(row) {
  return {
    length: row.dLength ?? null,
    width: row.dWidth ?? null,
    height: row.dHeight ?? null,
    qty: row.NoOfPcs ?? null,
    vol: row.Volume ?? null,
    weight: row.VolumetricWeight ?? null,
  };
}

/**
 * The air waybill's rate lines.
 *
 * These are not legacy rows - they are four inline blocks of columns on the
 * waybill (NoOfPcs1..4 and friends). A block with no pieces is not a line.
 */
function mapItemBlocks(row) {
  const out = [];
  for (let n = 1; n <= 4; n += 1) {
    const pcs = toNumber(row[`NoOfPcs${n}`]);
    if (pcs === null || pcs === 0) continue;
    out.push({
      noOfPcs: String(row[`NoOfPcs${n}`]),
      unit: cleanText(row[`UnitOfPcs${n}`]),
      grossWt: row[`GrossWeight${n}`] ?? null,
      kh_lb: Number(row[`UnitOfWeightId${n}`]) === 2 ? 'Kg' : 'Lb',
      r_class: cleanText(row[`RateClass${n}`]),
      itemNo: cleanText(row[`ItemNumber${n}`]),
      chargableWt: row[`ChargeableWeight${n}`] ?? null,
      rate_charge: row[`RatePerCharge${n}`] ?? null,
      total: row[`ItemTotal${n}`] ?? null,
      lineWeight: row[`LineWeight${n}`] ?? null,
    });
  }
  return out;
}

const MAPPERS = {
  containers: (row, ctx) => [mapContainer(row, ctx)],
  stamps: (row, ctx) => [mapStamp(row, ctx)],
  dimensions: (row) => [mapDimension(row)],
  items: (row) => mapItemBlocks(row),
};

/**
 * @param {string} kind        containers | stamps | dimensions | items
 * @param {Array}  legacyRows
 * @param {string} operation   SE | SI | AE | AI
 * @param {object} ctx
 * @param {Map} ctx.blIdByParentId    legacy parent id -> Odyssey Bl.id
 * @param {Iterable} ctx.parentsDone  Odyssey Bl.ids that already have this kind
 * @param {Map} ctx.packing           PackCode -> PackName (containers)
 * @param {Map} ctx.stamps            Gen_Stamps.Id -> { StampCode, StampName }
 */
function planBlChildren(kind, legacyRows, operation, ctx = {}) {
  if (!KINDS.includes(kind)) {
    throw new Error(`Unknown B/L child kind "${kind}". Expected one of: ${KINDS.join(', ')}.`);
  }
  const parentKey = PARENT_KEY[kind][operation];
  if (!parentKey) {
    throw new Error(
      `B/L child kind "${kind}" has no source for operation "${operation}".`,
    );
  }

  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const bls = ctx.blIdByParentId instanceof Map
    ? ctx.blIdByParentId : new Map(Object.entries(ctx.blIdByParentId || {}));
  const done = new Set([...(ctx.parentsDone || [])].map(String));

  const problems = { missingParentRef: 0, orphaned: [], emptyBlocks: 0 };

  const toCreate = [];
  const parentsTouched = new Set();
  let skippedParents = 0;

  for (const row of rows) {
    if (!row) { problems.missingParentRef += 1; continue; }

    const parentRef = toLegacyId(row[parentKey]);
    if (parentRef === null) { problems.missingParentRef += 1; continue; }

    const blId = bls.get(String(parentRef));
    if (blId === undefined || blId === null) {
      // The B/L is not in Odyssey - almost always means the B/L stage has not
      // run, or that B/L was skipped as an orphan itself.
      problems.orphaned.push(parentRef);
      continue;
    }

    // Parent-scoped skip: this B/L already has children of this kind.
    if (done.has(String(blId))) { skippedParents += 1; continue; }

    const mapped = MAPPERS[kind](row, ctx);
    if (!mapped.length) { problems.emptyBlocks += 1; continue; }

    for (const m of mapped) toCreate.push({ ...m, BlId: blId });
    parentsTouched.add(String(blId));
  }

  return {
    toCreate,
    problems,
    stats: {
      kind,
      operation,
      source: rows.length,
      toCreate: toCreate.length,
      parents: parentsTouched.size,
      skippedParents,
      orphaned: problems.orphaned.length,
      emptyBlocks: problems.emptyBlocks,
    },
    // An orphan is skipped rather than fatal: there is nothing to attach it to,
    // and refusing the whole batch would stall every other B/L's children.
    canApply: true,
  };
}

module.exports = {
  planBlChildren, mapContainer, mapStamp, mapDimension, mapItemBlocks,
  tareOf, toNumber, cleanText, toLegacyId, KINDS, PARENT_KEY,
};
