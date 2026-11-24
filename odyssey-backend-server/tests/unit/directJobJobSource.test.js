/**
 * Which job a Direct Job E/R line attaches to - functions/directJobJobSource.
 *
 * The screen was freight-only: it listed SE_Jobs, stored the id in a column
 * with a foreign key to SE_Jobs, and read it back by joining SE_Job. Under
 * aviation and customs that table is empty, so there was no job an entry could
 * be attached to.
 *
 * What is worth pinning is the part a reader of the screen cannot check: that
 * each mode gets its OWN column, that saving into one clears the other two,
 * and that a mode nobody configured still behaves like the freight install it
 * used to be.
 */
const src = require('../../functions/directJobJobSource');

describe('the job source for a mode', () => {
  test('each mode owns a different column', () => {
    expect(src.idColumnFor('freight')).toBe('Job_Id');
    expect(src.idColumnFor('aviation')).toBe('AviationJobId');
    expect(src.idColumnFor('customs')).toBe('CustomsJobId');
    // Three modes, three columns, no accidental sharing.
    expect(new Set(src.ID_COLUMNS).size).toBe(3);
  });

  test('names the model and the include alias each mode joins under', () => {
    expect(src.sourceFor('aviation').model).toBe('Aviation_Job');
    expect(src.sourceFor('aviation').alias).toBe('AviationJob');
    expect(src.sourceFor('customs').model).toBe('Customs_Job');
    expect(src.sourceFor('freight').alias).toBe('Job');
  });

  test('an unset or unknown mode reads as freight', () => {
    // operationMode was added after the freight module shipped, so its absence
    // means "the original one" - not "not configured". Same fallback the
    // frontend's terminology.getMode uses.
    for (const mode of [undefined, null, '', 'sea', 'nonsense']) {
      expect(src.sourceFor(mode).mode).toBe('freight');
    }
  });

  test('is not case or whitespace sensitive', () => {
    expect(src.sourceFor(' Aviation ').mode).toBe('aviation');
  });
});

describe('the picker columns', () => {
  test('every mode names the same number of columns', () => {
    // The screen renders whatever it is given, so a mode with a different
    // count would put the rows out of step with the headings.
    const counts = ['freight', 'aviation', 'customs'].map((m) => src.columnsFor(m).length);
    expect(new Set(counts).size).toBe(1);
  });

  test('a row fills exactly the keys its mode named', () => {
    const forMode = (mode, job) => {
      const row = src.rowFor(mode, job);
      for (const col of src.columnsFor(mode)) expect(row).toHaveProperty(col.key);
      return row;
    };

    expect(forMode('freight', {
      id: 1, jobNo: 'SNS-SE-1/26', fileNo: 'F1',
      Bl: { hbl: 'HBL1', mbl: 'MBL1' },
      Client: { name: 'Acme' }, consignee: { name: 'Beta' },
    })).toMatchObject({ jobNo: 'SNS-SE-1/26', ref1: 'HBL1', ref2: 'MBL1', party1: 'Acme', party2: 'Beta' });

    expect(forMode('aviation', {
      id: 2, jobNo: 'GEN-AVJ-9/26', flightNo: 'PK-301',
      origin: 'KHI', destination: 'JED', flightDate: '2026-07-15',
      operatingCarrier: { name: 'Fits Air' },
    })).toMatchObject({ jobNo: 'GEN-AVJ-9/26', ref1: 'PK-301', ref2: 'KHI → JED', party2: 'Fits Air' });

    expect(forMode('customs', {
      id: 3, jobNo: 'CL-CC-4/26', customFileNo: 'CF4',
      gdNumber: 'KAPE-1234', blNo: 'BL9', vesselOrFlight: 'MV Ship',
      client: { name: 'Gamma' },
    })).toMatchObject({ jobNo: 'CL-CC-4/26', ref1: 'KAPE-1234', ref2: 'BL9', party1: 'Gamma' });
  });

  test("a customs line's File #: the migrated customFileNo, unless the install takes the S/R Page #", () => {
    // Essani, 2026-11-17: Configuration > Customs > Job Screen,
    // "Direct E/R File # from the S/R Page #". Off, as before.
    const job = { id: 3, jobRef: 'SR-1726', customFileNo: 'CF4' };
    expect(src.rowFor('customs', job).fileNo).toBe('CF4');
    expect(src.rowFor('customs', job, { fileFromRef: true }).fileNo).toBe('SR-1726');
    expect(src.rowFor('customs', { id: 3, customFileNo: 'CF4' }, { fileFromRef: true }).fileNo).toBe('');
  });

  test('the aviation headings do not say HBL or Consignee', () => {
    // They mean nothing on a flight, and a picker headed with them would be
    // asking the operator to search by something the rows do not have.
    const labels = src.columnsFor('aviation').map((c) => c.label);
    expect(labels).not.toContain('HBL');
    expect(labels).not.toContain('Consignee');
    expect(labels).toContain('Flight #');
  });

  test('a missing half of a sector is not invented', () => {
    expect(src.rowFor('aviation', { origin: 'KHI' }).ref2).toBe('KHI');
    expect(src.rowFor('aviation', {}).ref2).toBe('');
  });

  test('a flight has no file number, and says so as a blank', () => {
    // Empty rather than undefined: the screen stores what it is given on the
    // line, and undefined would reach the save as a missing field.
    expect(src.rowFor('aviation', { id: 1 }).fileNo).toBe('');
  });

  test('an absent job is an empty row, not a crash', () => {
    for (const mode of ['freight', 'aviation', 'customs']) {
      expect(src.rowFor(mode, undefined).jobNo).toBe('');
    }
  });
});

describe('saving a line', () => {
  test('puts the id in its own column and clears the other two', () => {
    // Clearing matters on an EDIT: the row is rewritten in place, and a stale
    // id in another mode's column would leave two set at once.
    expect(src.ownerColumns('aviation', 42)).toEqual({
      Job_Id: null, AviationJobId: 42, CustomsJobId: null,
    });
    expect(src.ownerColumns('freight', 7)).toEqual({
      Job_Id: 7, AviationJobId: null, CustomsJobId: null,
    });
    expect(src.ownerColumns('customs', 9)).toEqual({
      Job_Id: null, AviationJobId: null, CustomsJobId: 9,
    });
  });

  test('accepts the id as the string a form sends', () => {
    expect(src.ownerColumns('aviation', '42').AviationJobId).toBe(42);
  });

  test('no job at all leaves every column null', () => {
    for (const bad of [undefined, null, '', 0, 'abc', -1]) {
      expect(src.ownerColumns('aviation', bad)).toEqual({
        Job_Id: null, AviationJobId: null, CustomsJobId: null,
      });
    }
  });
});

describe('reading a job back', () => {
  test('selects on the column this mode owns', () => {
    // A freight job id must never match an aviation row that happens to share
    // the number - the failure a single shared Job_Id column would have made
    // silent.
    expect(src.ownerWhere('aviation', 5)).toEqual({ AviationJobId: 5 });
    expect(src.ownerWhere('freight', 5)).toEqual({ Job_Id: 5 });
    expect(src.ownerWhere('customs', 5)).toEqual({ CustomsJobId: 5 });
  });
});
