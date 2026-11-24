const { planBls, mapBl, formatAddress, formatLines } = require('../../functions/blMigrationPlan');

const seaBl = (Id, over = {}) => ({
  Id, SEJobId: 100, HBLNo: `HBL-${Id}`, MBLNo: `MBL-${Id}`,
  HBLDate: '2024-01-01', StatusId: 2, ...over,
});
const airBl = (Id, over = {}) => ({
  Id, AEJobId: 100, HAWBNo: `HAWB-${Id}`, MAWBNo: `MAWB-${Id}`,
  HAWBDate: '2024-01-01', StatusId: 2,
  Shipper: 'AIR SHIPPER', Consignee: 'AIR CONSIGNEE',
  PlaceOfIssue: 'DUBAI', PlaceOfIssueDate: '2024-01-02', ...over,
});
const detail = (SEBLId, over = {}) => ({
  SEBLId, Shipper: 'SEA SHIPPER', Consignee: 'SEA CONSIGNEE',
  PlaceOfIssue: 'KARACHI', PlaceOfIssueDate: '2024-01-02',
  PortOfLoading: 'PKKHI', NoOfPkgs: '10', ...over,
});

const ctx = (over = {}) => ({
  existingClimaxIds: [],
  jobIdByLegacyId: new Map([['100', 'job-1']]),
  detailByBlId: new Map(),
  jobFieldsByLegacyId: new Map(),
  ...over,
});

describe('mapBl - the field the old import dropped', () => {
  it('writes issuePlace and issueDate, which the model actually declares', () => {
    // The old import wrote IssuePlace/IssueDate with a capital I. Sequelize
    // silently drops attributes it does not know, so the place and date of
    // issue were never migrated on any B/L - and both print on the document.
    const m = mapBl(seaBl(1), 'SE', { detail: detail(1), jobId: 'job-1' });
    expect(m.issuePlace).toBe('KARACHI');
    expect(m.issueDate).toBe('2024-01-02');
    // The misspelled names must not reappear.
    expect(m.IssuePlace).toBeUndefined();
    expect(m.IssueDate).toBeUndefined();
  });

  it('writes wtValCOLL, not the old import\'s wtVatCOLL', () => {
    const m = mapBl(seaBl(1), 'SE', { detail: detail(1), jobId: 'job-1' });
    expect(m).toHaveProperty('wtValCOLL');
    expect(m.wtVatCOLL).toBeUndefined();
  });

  it('reads the place of issue off the row itself for an air waybill', () => {
    const m = mapBl(airBl(1), 'AE', { jobId: 'job-1' });
    expect(m.issuePlace).toBe('DUBAI');
    expect(m.issueDate).toBe('2024-01-02');
  });
});

describe('mapBl - sea vs air', () => {
  it('takes the sea B/L numbers from HBLNo / MBLNo', () => {
    const m = mapBl(seaBl(1), 'SE', { detail: detail(1), jobId: 'job-1' });
    expect(m.hbl).toBe('HBL-1');
    expect(m.mbl).toBe('MBL-1');
    expect(m.operation).toBe('SE');
  });

  it('takes the air waybill numbers from HAWBNo / MAWBNo', () => {
    const m = mapBl(airBl(1), 'AE', { jobId: 'job-1' });
    expect(m.hbl).toBe('HAWB-1');
    expect(m.mbl).toBe('MAWB-1');
  });

  it('reads sea printable content from the detail row, air from the row itself', () => {
    const sea = mapBl(seaBl(1), 'SE', { detail: detail(1), jobId: 'job-1' });
    expect(sea.shipperContent).toContain('<p>SEA SHIPPER</p>');
    expect(sea.polTwo).toBe('PKKHI');

    const air = mapBl(airBl(1), 'AE', { jobId: 'job-1' });
    expect(air.shipperContent).toContain('<p>AIR SHIPPER</p>');
    // Sea-only route columns stay blank on a waybill rather than undefined.
    expect(air.polTwo).toBe('');
  });

  it('does not throw when a sea B/L has no detail row', () => {
    // The old import read bl.SExp_BL_Detail.X unguarded, so one detail-less
    // B/L threw inside its job's transaction and took the batch with it.
    expect(() => mapBl(seaBl(1), 'SE', { jobId: 'job-1' })).not.toThrow();
    const m = mapBl(seaBl(1), 'SE', { jobId: 'job-1' });
    // Still a string, still safe for the editor - just placeholders only.
    expect(typeof m.shipperContent).toBe('string');
    expect(m.hbl).toBe('HBL-1');       // the B/L itself still imports
  });

  it('maps the air waybill boxes the old import never touched', () => {
    // Routing, the charge/weight indicators and the declared values. These are
    // codes, not amounts: Charges is "PP"/"CC", WTPP/WTCC are "P"/"C", and
    // DeclareValueForCarriage is usually "NVD".
    const m = mapBl(airBl(1, {
      To1: 'DOH', To2: 'MAN', To3: 'SVD',
      ByFirstCarrier: 'QR', By2: 'BA', By3: 'EK',
      Currency: 'PKR', Charges: 'PP', WTPP: 'P', WTCC: 'C',
      OtherPP: 'P', OtherCC: 'C',
      DeclareValueForCarriage: 'NVD', DeclareValueForCustom: 'NCV',
      AmountOfInsurance: 0, HandlingInfo: 'KARACHI PAKISTAN',
      AirportOfLoading: 'JINNAH INTERNATIONAL AIRPORT',
      AirportOfDischarge: 'HEATHROW', AirportOfFinalDest: 'MANCHESTER',
    }), 'AE', { jobId: 'job-1' });

    expect(m.toOne).toBe('DOH');
    expect(m.toTwo).toBe('MAN');
    expect(m.toThree).toBe('SVD');
    // By1 is the first carrier and has its own column, so the rest shift down.
    expect(m.byFirstCarrier).toBe('QR');
    expect(m.byOne).toBe('BA');
    expect(m.byTwo).toBe('EK');
    expect(m.charges).toBe('PP');
    expect(m.wtValPPC).toBe('P');
    expect(m.wtValCOLL).toBe('C');
    expect(m.othersPPC).toBe('P');
    expect(m.othersCOLL).toBe('C');
    expect(m.declareCarriage).toBe('NVD');
    expect(m.declareCustoms).toBe('NCV');
    expect(m.handlingInfo).toBe('KARACHI PAKISTAN');
    expect(m.polTwo).toBe('JINNAH INTERNATIONAL AIRPORT');
    expect(m.podTwo).toBe('HEATHROW');
    expect(m.poDeliveryTwo).toBe('MANCHESTER');
  });

  it('writes currency lowercase, which is the name the model declares', () => {
    // fixAEBL wrote `Currency`, so Sequelize dropped it on all 9,453 rows it
    // "repaired" - the same class of bug as IssuePlace.
    const m = mapBl(airBl(1, { Currency: 'PKR' }), 'AE', { jobId: 'job-1' });
    expect(m.currency).toBe('PKR');
    expect(m.Currency).toBeUndefined();
  });

  it('maps the air boxes for air IMPORT too, which fixAEBL never covered', () => {
    const m = mapBl({
      Id: 1, AIJobId: 100, HAWBNo: 'H1', StatusId: 2,
      To1: 'DXB', ByFirstCarrier: 'EK', Charges: 'CC', Currency: 'USD',
    }, 'AI', { jobId: 'job-1' });

    expect(m.toOne).toBe('DXB');
    expect(m.byFirstCarrier).toBe('EK');
    expect(m.charges).toBe('CC');
    expect(m.currency).toBe('USD');
  });

  it('leaves the air boxes empty on a sea B/L rather than undefined', () => {
    // bulkCreate builds its column list from the first row, so every row has
    // to carry the same keys.
    const m = mapBl(seaBl(1), 'SE', { detail: detail(1), jobId: 'job-1' });
    for (const f of ['toOne', 'byFirstCarrier', 'currency', 'charges',
      'wtValPPC', 'declareCarriage', 'handlingInfo', 'insurance']) {
      expect(m[f]).toBe('');
    }
  });

  it('migrates the insurance amount faithfully, even though it is always zero', () => {
    expect(mapBl(airBl(1, { AmountOfInsurance: 0 }), 'AE', { jobId: 'job-1' }).insurance)
      .toBe('0');
    expect(mapBl(airBl(1, { AmountOfInsurance: null }), 'AE', { jobId: 'job-1' }).insurance)
      .toBe('');
  });

  it('prefers GrossWeight1 on an air waybill', () => {
    const m = mapBl(airBl(1, { GrossWeight1: '500 KG' }), 'AE', { jobId: 'job-1' });
    expect(m.grossWeightContent).toContain('<p>500 KG</p>');
  });
});

describe('mapBl - job-sourced fields', () => {
  it('takes shipDate and the M3 columns from the job, not the B/L', () => {
    const m = mapBl(seaBl(1), 'SE', {
      detail: detail(1), jobId: 'job-1',
      jobFields: { SailingDate: '2024-02-01', AgentM3: '12', ColoadM3: '3' },
    });
    expect(m.shipDate).toBe('2024-02-01');
    expect(m.agentM3).toBe('12');
    expect(m.coloadM3).toBe('3');
  });

  it('falls back to the agent instruction where the table has no M3 columns', () => {
    // Only SExp_SeaExportJob has AgentM3/ColoadM3; the other three carry only
    // an agent instruction, which is what the old import used there too.
    const m = mapBl(airBl(1), 'AE', {
      jobId: 'job-1', jobFields: { AgentInstruction: 'CALL ON ARRIVAL' },
    });
    expect(m.agentM3).toBe('CALL ON ARRIVAL');
    expect(m.coloadM3).toBeNull();
  });

  it('does not throw when the job fields are missing', () => {
    const m = mapBl(seaBl(1), 'SE', { detail: detail(1), jobId: 'job-1' });
    expect(m.shipDate).toBeNull();
    expect(m.agentM3).toBeNull();
  });
});

describe('formatAddress', () => {
  // The B/L content columns hold an HTML paragraph list, not plain text. The
  // editor reads them with cleanNullParagraphs(), which queries <p> elements
  // and strips the "null" / "TEL null" placeholders - so the padding is part
  // of the contract, not junk.
  const lines = (html) => (html.match(/<p>(.*?)<\/p>/g) || [])
    .map((p) => p.replace(/<\/?p>/g, ''));

  it('wraps every line in a paragraph', () => {
    // Newline-separated plain text reaches the editor as one unstructured
    // blob, so a four-line address renders on a single line.
    const out = formatAddress('ACME LTD\n12 DOCK RD\nKARACHI');
    expect(out.startsWith('<p>ACME LTD</p><p>12 DOCK RD</p><p>KARACHI</p>')).toBe(true);
    expect(lines(out).slice(0, 3)).toEqual(['ACME LTD', '12 DOCK RD', 'KARACHI']);
  });

  it('never returns null, because the editor calls .replace() on it', () => {
    // A null here white-screened the whole B/L detail page.
    for (const input of [null, undefined, '', '   ', 42, {}]) {
      const out = formatAddress(input);
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('pads to ten lines with the placeholders the editor strips', () => {
    const out = formatAddress('ACME LTD');
    expect(lines(out)).toHaveLength(10);
    expect(lines(out)[0]).toBe('ACME LTD');
    // cleanNullParagraphs() drops paragraphs reading "null" or "tel null".
    expect(lines(out).filter((l) => l === 'null' || l === 'TEL null').length).toBe(9);
  });

  it('adds the TEL placeholders only when the source has no TEL line', () => {
    expect(formatAddress('ACME LTD')).toContain('<p>TEL null</p>');
    const withTel = formatAddress('ACME LTD\nTEL 021-111');
    expect(withTel).toContain('<p>TEL 021-111</p>');
    expect(withTel).not.toContain('<p>TEL null</p>');
  });

  it('trims each line, drops blank ones, and splits on tabs and CRLF', () => {
    expect(lines(formatAddress('  ACME   LTD  \r\n\n\n  KARACHI  ')).slice(0, 2))
      .toEqual(['ACME   LTD', 'KARACHI']);
    expect(lines(formatAddress('A\tB')).slice(0, 2)).toEqual(['A', 'B']);
  });

  it('escapes markup characters instead of emitting broken HTML', () => {
    // 5,746 values in the real export contain & < or >. A bare `<` opens a tag
    // that swallows the text after it; every consumer reads the value back
    // through textContent, so the escape round-trips to the original.
    expect(formatAddress('100% COTTON & 60%')).toContain('<p>100% COTTON &amp; 60%</p>');
    expect(formatAddress('WIDTH < 20 > 10')).toContain('<p>WIDTH &lt; 20 &gt; 10</p>');
    // & must be escaped first, or &lt; would become &amp;lt;
    expect(formatAddress('A & B < C')).toContain('<p>A &amp; B &lt; C</p>');
    expect(formatAddress('A & B < C')).not.toContain('&amp;lt;');
  });
});

describe('formatLines', () => {
  it('wraps in paragraphs without the address padding', () => {
    // noOfPckgs goes through the editor AND both print paths, all of which
    // query <p> elements - written raw it has none and prints blank.
    expect(formatLines('511 PKGS')).toBe('<p>511 PKGS</p>');
  });

  it('keeps a multi-line package count as separate lines', () => {
    // 235 rows in the real export are multi-line.
    expect(formatLines('511 PKGS\n300 BALES')).toBe('<p>511 PKGS</p><p>300 BALES</p>');
  });

  it('returns an empty string for nothing, never null', () => {
    for (const input of [null, undefined, '', '   ']) {
      expect(formatLines(input)).toBe('');
    }
  });

  it('escapes markup the same way', () => {
    expect(formatLines('10 & 20')).toBe('<p>10 &amp; 20</p>');
  });
});

describe('planBls', () => {
  it('attaches each B/L to its Odyssey job', () => {
    const plan = planBls([seaBl(1)], 'SE', ctx({ detailByBlId: new Map([['1', detail(1)]]) }));
    expect(plan.toCreate[0].SEJobId).toBe('job-1');
    expect(plan.toCreate[0].climaxId).toBe(1);
  });

  it('skips a B/L whose job is not in Odyssey', () => {
    // Every B/L screen opens from its job, so a detached B/L is unreachable.
    const plan = planBls([seaBl(1), seaBl(2, { SEJobId: 999 })], 'SE', ctx());
    expect(plan.problems.orphaned).toEqual([2]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('uses the right job column per operation', () => {
    const air = planBls([airBl(1)], 'AE', ctx());
    expect(air.toCreate).toHaveLength(1);
    // An AE B/L carries AEJobId, so reading SEJobId would orphan every row.
    expect(air.problems.orphaned).toEqual([]);
  });

  it('skips B/Ls already imported instead of duplicating them', () => {
    const plan = planBls([seaBl(1), seaBl(2)], 'SE', ctx({ existingClimaxIds: [1] }));
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((b) => b.climaxId)).toEqual([2]);
  });

  it('imports a B/L with no detail row and counts it', () => {
    const plan = planBls([seaBl(1)], 'SE', ctx());
    expect(plan.problems.missingDetail).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);      // reported, not dropped
  });

  it('counts a B/L with no number without dropping it', () => {
    const plan = planBls([seaBl(1, { HBLNo: '  ' })], 'SE', ctx());
    expect(plan.problems.missingHbl).toEqual([1]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('counts how many rows gained a place of issue', () => {
    const plan = planBls([seaBl(1), seaBl(2)], 'SE', ctx({
      detailByBlId: new Map([['1', detail(1)], ['2', detail(2, { PlaceOfIssue: null })]]),
    }));
    expect(plan.stats.withIssuePlace).toBe(1);
  });

  it('flags two B/Ls on the same job', () => {
    // The legacy tables mark the job column unique, so this should not happen -
    // and the job screen would show only one of them.
    const plan = planBls([seaBl(1), seaBl(2)], 'SE', ctx());
    expect(plan.problems.duplicateJobBls).toEqual([2]);
    expect(plan.toCreate).toHaveLength(2);
  });

  it('counts rows with no usable id and duplicated ids', () => {
    const plan = planBls([{ SEJobId: 100 }, seaBl('x'), seaBl(2), seaBl(2)], 'SE', ctx());
    expect(plan.problems.missingId).toBe(2);
    expect(plan.problems.duplicateClimaxIds).toEqual([2]);
  });

  it('refuses an unknown operation', () => {
    expect(() => planBls([], 'XX', ctx())).toThrow(/Unknown B\/L operation "XX"/);
  });

  it('accepts the maps as plain objects', () => {
    const plan = planBls([seaBl(1)], 'SE', {
      jobIdByLegacyId: { 100: 'job-1' },
      detailByBlId: { 1: detail(1) },
      jobFieldsByLegacyId: { 100: { SailingDate: '2024-02-01' } },
    });
    expect(plan.toCreate[0].SEJobId).toBe('job-1');
    expect(plan.toCreate[0].shipDate).toBe('2024-02-01');
  });

  it('emits rows of a uniform shape, so bulkCreate does not drop columns', () => {
    const plan = planBls([seaBl(1), seaBl(2, { SEJobId: 100 })], 'SE', ctx({
      detailByBlId: new Map([['1', detail(1)]]),
    }));
    const keys = plan.toCreate.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
  });

  it('does not throw on an empty source', () => {
    expect(planBls([], 'SE', ctx()).stats.source).toBe(0);
    expect(planBls(undefined, 'SE', ctx()).canApply).toBe(true);
  });
});
