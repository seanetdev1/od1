/**
 * Which job a Direct Job E/R line is attached to - in EVERY operation mode.
 *
 * A Direct Job expense/revenue is money paid or received against jobs. It was
 * written for freight and hard-wired to it in four separate places: the picker
 * listed SE_Jobs, the association row's Job_Id had a foreign key to SE_Jobs,
 * the three read routes joined SE_Job, and the picker's columns were HBL, MBL
 * and Consignee. In aviation and customs the SE_Jobs table is EMPTY - the jobs
 * live in Aviation_Jobs and Customs_Jobs - so the screen opened, the picker
 * came back with nothing, and there was no job any entry could be attached to.
 *
 * ONE ROW, THREE POSSIBLE OWNERS - the same shape Charge_Heads already uses to
 * hang one charge off a freight job, an aviation consignment or a customs job:
 * a nullable id column per kind, each with its own foreign key, and exactly one
 * of them set. Not a single Job_Id with a discriminator, because that is a
 * foreign key the database cannot enforce, and this table is accounting.
 *
 * WHY THE MODE DECIDES, AND NOT THE PAYLOAD. operationMode is set once per
 * install and never changes (see routes/settings - the row's existence is the
 * lock), so a database only ever has one kind of job in it. The screen
 * therefore keeps sending a plain job id, exactly as it always did, and the
 * server puts it in the right column. A client that could name the column
 * would be a client that could put an aviation id in the freight one.
 *
 * THE PICKER'S COLUMNS COME FROM HERE TOO. 'HBL' and 'Consignee' mean nothing
 * on a flight, and a picker headed with them under aviation would be asking
 * the operator to search by something the rows do not have. Each mode names
 * its own four columns and maps its own job onto them, so the screen renders
 * whatever it is given and has no per-mode branch of its own.
 *
 * Kept free of model imports so the mapping can be tested without a database.
 * The route passes plain rows through `rowFor`.
 */

// The three operation modes, as AppSetting.operationMode stores them.
const FREIGHT = 'freight';
const AVIATION = 'aviation';
const CUSTOMS = 'customs';

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** 'KHI → JED', and neither half invented when it is missing. */
const sector = (from, to) => [str(from), str(to)].filter(Boolean).join(' → ');

/* Every mode's answer to: which table, which column, which four headings, and
 * how does one of its jobs fill them in.
 *
 * `idColumn` is the column on Direct_Job_Association. `alias` is the include
 * alias the read routes join under. `columns` are the picker's headings, in
 * order, and `row` maps a job onto exactly those keys - so adding a mode is
 * one entry here rather than a branch in the route and another in the screen. */
const SOURCES = {
  [FREIGHT]: {
    mode: FREIGHT,
    model: 'SE_Job',
    idColumn: 'Job_Id',
    alias: 'Job',
    label: 'Job',
    columns: [
      { key: 'jobNo', label: 'Job #' },
      { key: 'ref1', label: 'HBL' },
      { key: 'ref2', label: 'MBL' },
      { key: 'party1', label: 'Client' },
      { key: 'party2', label: 'Consignee' },
    ],
    row: (j) => ({
      id: j.id,
      jobNo: str(j.jobNo),
      fileNo: str(j.fileNo),
      ref1: str(j.Bl && j.Bl.hbl),
      ref2: str(j.Bl && j.Bl.mbl),
      party1: str(j.Client && j.Client.name),
      party2: str(j.consignee && j.consignee.name),
    }),
  },

  [AVIATION]: {
    mode: AVIATION,
    model: 'Aviation_Job',
    idColumn: 'AviationJobId',
    alias: 'AviationJob',
    label: 'Flight',
    columns: [
      { key: 'jobNo', label: 'Job #' },
      { key: 'ref1', label: 'Flight #' },
      { key: 'ref2', label: 'Sector' },
      { key: 'party1', label: 'Date' },
      { key: 'party2', label: 'Airline' },
    ],
    row: (j) => ({
      id: j.id,
      jobNo: str(j.jobNo),
      // A flight has no file number. Empty rather than absent: the screen
      // stores whatever it is given on the line, and undefined would reach the
      // save as a missing field rather than as a blank one.
      fileNo: '',
      ref1: str(j.flightNo),
      ref2: sector(j.origin, j.destination),
      party1: str(j.flightDate),
      party2: str(j.operatingCarrier && j.operatingCarrier.name),
    }),
  },

  [CUSTOMS]: {
    mode: CUSTOMS,
    model: 'Customs_Job',
    idColumn: 'CustomsJobId',
    alias: 'CustomsJob',
    label: 'Job',
    columns: [
      { key: 'jobNo', label: 'Job #' },
      { key: 'ref1', label: 'GD #' },
      { key: 'ref2', label: 'BL #' },
      { key: 'party1', label: 'Client' },
      { key: 'party2', label: 'Vessel / Flight' },
    ],
    row: (j, { fileFromRef = false } = {}) => ({
      id: j.id,
      jobNo: str(j.jobNo),
      /* THE S/R PAGE # (jobRef - Essani's "File Job Number") when the install
       * has Configuration > Customs > Job Screen "Direct E/R File # from the
       * S/R Page #" on (Essani, 2026-11-17); otherwise the migrated
       * customFileNo, as it always was - CargoLinkers and HO-ENT unchanged. */
      fileNo: str(fileFromRef ? j.jobRef : j.customFileNo),
      ref1: str(j.gdNumber),
      ref2: str(j.blNo),
      party1: str(j.client && j.client.name),
      party2: str(j.vesselOrFlight),
    }),
  },
};

/**
 * The job source for an operation mode.
 *
 * AN UNKNOWN MODE READS AS FREIGHT, which is what an install with no
 * operationMode row is - the setting was added after the freight module
 * shipped, so its absence means "the original one" rather than "not
 * configured". Same fallback as the frontend's terminology.getMode.
 */
function sourceFor(mode) {
  return SOURCES[str(mode).trim().toLowerCase()] || SOURCES[FREIGHT];
}

/** The Direct_Job_Association column that holds the job id, for this mode. */
const idColumnFor = (mode) => sourceFor(mode).idColumn;

/** The picker's headings, for this mode. */
const columnsFor = (mode) => sourceFor(mode).columns;

/** One job, as a row of the picker. `options.fileFromRef`: customs only - see
 *  its row. */
const rowFor = (mode, job, options = {}) => sourceFor(mode).row(job || {}, options);

/**
 * Where clause selecting the association rows belonging to one job.
 *
 * Keyed on the mode's OWN column, so a freight job id can never match an
 * aviation row that happens to share the number - which is the failure this
 * whole module exists to prevent, and the one a single shared Job_Id column
 * would have made silent.
 */
const ownerWhere = (mode, jobId) => ({ [idColumnFor(mode)]: jobId });

/**
 * The id columns a row must have EXACTLY ONE of.
 *
 * Exported so the save path and the migration's check constraint are written
 * from the same list rather than from two hand-kept copies.
 */
const ID_COLUMNS = [FREIGHT, AVIATION, CUSTOMS].map((m) => SOURCES[m].idColumn);

/**
 * Put a job id in the column its mode owns, and clear the other two.
 *
 * Clearing matters on an EDIT: the row is rewritten in place, and a stale id
 * left in another mode's column would leave two set at once - which the check
 * constraint refuses, and which nothing downstream could resolve if it did not.
 */
function ownerColumns(mode, jobId) {
  const out = {};
  for (const col of ID_COLUMNS) out[col] = null;
  const id = parseInt(jobId, 10);
  out[idColumnFor(mode)] = Number.isFinite(id) && id > 0 ? id : null;
  return out;
}

module.exports = {
  SOURCES, ID_COLUMNS, FREIGHT, AVIATION, CUSTOMS,
  sourceFor, idColumnFor, columnsFor, rowFor, ownerWhere, ownerColumns,
};
