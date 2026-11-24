/**
 * Legacy LOG jobs -> Customs_Job + Customs_Duty.
 *
 * The mapping is the whole of this stage, so these tests are what stands
 * between a migrated clearance file and one that looks right but says the
 * wrong thing. The cases that matter are the ones the OLD import got wrong:
 * a job number it could not parse, a company that did not resolve, duty it
 * never read at all, and a legacy code nobody had seen.
 */
const {
  planLgJobs, mapJob, mapDuty, mapContainer, jobIdFrom, statusOf, toDateString,
  DUTY_RATE_MAP, DUTY_AMOUNT_MAP, DUTY_VALUE_MAP,
} = require('../../functions/lgJobMigrationPlan');
const { RATE_HEADS, AMOUNT_HEADS } = require('../../functions/customsDuty');

const resolvers = {
  clients: new Map([['10', 101], ['11', 102], ['12', 103]]),
  commodities: new Map([['20', 201]]),
  companies: new Map([['2', 7]]),
  packing: new Map([['CTN', 'Cartons']]),
  currency: new Map([['1', 'USD']]),
};

const JOB = {
  Id: 500,
  JobNumber: 'CL-CC-42/26',
  JobDate: new Date('2026-08-01T00:00:00Z'),
  MachineNo: 'KAPW-HC-123456',
  IGMorEGM: 'IGM-9911',
  IGMDate: new Date('2026-08-19T00:00:00Z'),
  IndexNo: '77',
  ImportExportId: 1,
  ModeId: 1,
  HBLNo: 'MAEU12345',
  VoyageOrFlightNo: 'V-204W',
  POLCode: 'CNSHA',
  PODCode: 'PKKHI',
  ArrivalDate: new Date('2026-08-16T00:00:00Z'),
  NoOfPackages: 400,
  PackagesCode: 'CTN',
  GrossWeight: 12500,
  ContainerString: 'MSKU1234567',
  CInvNumber: 'INV-88',
  CommInvValue: 250000,
  CurrencyId: 1,
  AssessedValue: 4000000,
  CashNumber: 'PSID-55',
  CashDate: new Date('2026-08-20T00:00:00Z'),
  SecurityPaidById: 2,
  CustomerId: 10,
  ShipperId: 11,
  ConsigneeId: 12,
  CommodityId: 20,
  SubCompanyId: 2,
  ApprovedStatusId: 2,
};

const DUTY = {
  Id: 900, LogJobId: 500, CommodityId: 20, ItemNo: '1',
  ASSValue: 4000000, ExchangeRate: 280, CDPerc: 20, SalesTaxPerc: 18,
  Demurrage: 45000, SRONumber: 'SRO-565',
};

describe('mapping the declaration', () => {
  const m = mapJob(JOB, resolvers);

  test('the WeBOC machine number becomes the GD number', () => {
    // This is the field a clearing agent's customer quotes back, and the old
    // import dropped it entirely - SE_Job has nowhere to put it.
    expect(m.gdNumber).toBe('KAPW-HC-123456');
  });

  test('carries the IGM and index, which a GD is filed against', () => {
    expect(m.igmNo).toBe('IGM-9911');
    expect(m.indexNo).toBe('77');
  });

  test('direction and mode come from their own fields', () => {
    expect(m.direction).toBe('Import');
    expect(m.transportMode).toBe('Sea');
  });

  test('falls back to OperationTypeId when they are absent', () => {
    // 2 was air export in the old import's own mapping.
    const m2 = mapJob({ ...JOB, ImportExportId: null, ModeId: null, OperationTypeId: 2 }, resolvers);
    expect(m2).toMatchObject({ direction: 'Export', transportMode: 'Air' });
  });

  test('defaults to sea import rather than throwing on an unknown type', () => {
    const m2 = mapJob({ ...JOB, ImportExportId: null, ModeId: null, OperationTypeId: 99 }, resolvers);
    expect(m2).toMatchObject({ direction: 'Import', transportMode: 'Sea' });
  });

  test('ports go across as CODES, not names', () => {
    // Which is what lets the stage skip the 108,182-row location table.
    expect(m.pol).toBe('CNSHA');
    expect(m.pod).toBe('PKKHI');
  });

  test('resolves parties, commodity and company through their legacy ids', () => {
    expect(m).toMatchObject({
      clientId: 101, shipperId: 102, consigneeId: 103,
      CommodityId: 201, companyId: 7,
    });
  });

  test('turns legacy dates into the plain strings every screen parses', () => {
    // The screens use moment(v, 'YYYY-MM-DD', true) - strict - so a Date or an
    // ISO timestamp renders blank rather than failing loudly.
    expect(m.gdDate).toBe('2026-08-19');
    expect(m.arrivalDate).toBe('2026-08-16');
    expect(toDateString(null)).toBeNull();
    expect(toDateString('not a date')).toBe('not a date');
  });

  test('maps the cash instrument to the PSID fields', () => {
    expect(m.psid).toBe('PSID-55');
    expect(m.dutyPaidDate).toBe('2026-08-20');
  });

  test('only an explicit agent-paid code makes duty reimbursable', () => {
    // 'Agent' is what puts duty on an invoice. Inventing it would bill a
    // client for money they already paid.
    expect(m.dutyPaidBy).toBe('Agent');
    expect(mapJob({ ...JOB, SecurityPaidById: 1 }, resolvers).dutyPaidBy).toBe('Client');
    expect(mapJob({ ...JOB, SecurityPaidById: null }, resolvers).dutyPaidBy).toBeNull();
    expect(mapJob({ ...JOB, SecurityPaidById: 99 }, resolvers).dutyPaidBy).toBeNull();
  });

  test('leaves gdType and channel unset rather than inventing them', () => {
    // Climax records neither. A migrated file claiming 'Home Consumption' /
    // 'Green' would be a fact nobody entered, in the column an audit reads.
    expect(m.gdType).toBeNull();
    expect(m.channel).toBeNull();
  });

  test('resolves the packing code to a unit name', () => {
    expect(m.pkgUnit).toBe('Cartons');
    expect(mapJob({ ...JOB, PackagesCode: 'XXX' }, resolvers).pkgUnit).toBeNull();
  });

  test('keeps the legacy id, so a re-run is not a second copy', () => {
    expect(m.climaxId).toBe(500);
  });
});

describe('which way the declaration goes', () => {
  const { resolveDirection, dominantDirection } = require('../../functions/lgJobMigrationPlan');
  const job = (over) => ({ Id: 1, JobNumber: 'TP-1/25', ...over });

  it('takes ImportExportId when the file states it', () => {
    expect(resolveDirection(job({ ImportExportId: 1 }))).toEqual({ direction: 'Import', from: 'stated' });
    expect(resolveDirection(job({ ImportExportId: 2 }))).toEqual({ direction: 'Export', from: 'stated' });
  });

  it('falls back to OperationTypeId', () => {
    // 4 = Sea Export in Gen_OperationType.
    expect(resolveDirection(job({ OperationTypeId: 4 })).direction).toBe('Export');
    expect(resolveDirection(job({ OperationTypeId: 1 })).direction).toBe('Import');
  });

  it('reads an export document when neither id is set', () => {
    // A Shipping Bill and a Form-E only exist on an export. Across the jobs
    // whose direction IS known, ShippBillNo appears on 1,652 exports against 2
    // imports, and FormENumber on 6,281 against 9.
    expect(resolveDirection(job({ ShippBillNo: '52235' })))
      .toEqual({ direction: 'Export', from: 'exportDocument' });
    expect(resolveDirection(job({ FormENumber: 'E-991' })).direction).toBe('Export');
    // An empty string is not a document.
    expect(resolveDirection(job({ ShippBillNo: '  ' })).from).not.toBe('exportDocument');
  });

  it('uses the run majority when the file says nothing at all', () => {
    expect(resolveDirection(job({}), 'Export'))
      .toEqual({ direction: 'Export', from: 'runMajority' });
    // And the historical default when there is no majority to lean on.
    expect(resolveDirection(job({})).direction).toBe('Import');
    expect(resolveDirection(job({}))).toEqual({ direction: 'Import', from: 'default' });
  });

  it('never lets a guess override something the file states', () => {
    // The majority must not tip a job that already knows its own answer.
    expect(resolveDirection(job({ ImportExportId: 1 }), 'Export').direction).toBe('Import');
    expect(resolveDirection(job({ OperationTypeId: 1 }), 'Export').direction).toBe('Import');
  });

  describe('dominantDirection', () => {
    const stated = (n, id) => Array.from({ length: n }, () => ({ ImportExportId: id }));

    it('finds a clear majority', () => {
      expect(dominantDirection([...stated(97, 2), ...stated(3, 1)])).toBe('Export');
      expect(dominantDirection([...stated(90, 1), ...stated(10, 2)])).toBe('Import');
    });

    it('refuses to call a mixed book', () => {
      // 60/40 is not a majority worth stamping on unknown jobs.
      expect(dominantDirection([...stated(60, 2), ...stated(40, 1)])).toBeNull();
    });

    it('is null when nothing states a direction', () => {
      expect(dominantDirection([{}, {}, null])).toBeNull();
      expect(dominantDirection([])).toBeNull();
    });
  });
});

describe('what was declared', () => {
  const map = (over) => mapJob({ ...JOB, ...over }, resolvers);

  it('keeps the goods description and the remarks apart', () => {
    // These used to share one column - `remarks: Remarks || GoodsDescription` -
    // so a job carrying both lost its description entirely. 511 of
    // CargoLinkers' 15,364 jobs carry both.
    const m = map({ GoodsDescription: 'DENIM FABRICS', Remarks: 'part shipment' });
    expect(m.goodsDescription).toBe('DENIM FABRICS');
    expect(m.remarks).toBe('part shipment');
  });

  it('carries the description when there are no remarks, and vice versa', () => {
    expect(map({ GoodsDescription: 'GARMENTS', Remarks: null }).goodsDescription).toBe('GARMENTS');
    expect(map({ GoodsDescription: 'GARMENTS', Remarks: null }).remarks).toBeNull();
    expect(map({ GoodsDescription: '', Remarks: 'held' }).goodsDescription).toBeNull();
    expect(map({ GoodsDescription: '', Remarks: 'held' }).remarks).toBe('held');
  });

  describe('the cost centre', () => {
    // The legacy system stores a LABEL against an id - "HEAD OFFICE", code HO.
    // Odyssey's field is the short code its vouchers carry, which for a
    // Karachi office is KHI.
    const oneCentre = new Map([['22', 'HO']]);
    const several = new Map([['22', 'HO'], ['23', 'LHE'], ['24', 'ISB']]);

    it('takes the installation code when the legacy system has ONE cost centre', () => {
      // One legacy cost centre means that cost centre IS the installation, so
      // the install's own code is the accurate value. CargoLinkers records HO
      // and calls it KHI.
      const r = { ...resolvers, costCenters: oneCentre, installCostCenter: 'KHI' };
      expect(mapJob({ ...JOB, CostCenterId: 22 }, r).costCenter).toBe('KHI');
    });

    it('keeps the legacy codes when the legacy system has SEVERAL', () => {
      // Then they are real distinctions and overwriting them would collapse
      // three cost centres into one.
      const r = { ...resolvers, costCenters: several, installCostCenter: 'KHI' };
      expect(mapJob({ ...JOB, CostCenterId: 23 }, r).costCenter).toBe('LHE');
      expect(mapJob({ ...JOB, CostCenterId: 22 }, r).costCenter).toBe('HO');
    });

    it('falls back to the legacy code when no installation code is set', () => {
      const r = { ...resolvers, costCenters: oneCentre };
      expect(mapJob({ ...JOB, CostCenterId: 22 }, r).costCenter).toBe('HO');
    });

    it('stays null for an id the lookup does not know', () => {
      const r = { ...resolvers, costCenters: oneCentre, installCostCenter: 'KHI' };
      expect(mapJob({ ...JOB, CostCenterId: 999 }, r).costCenter).toBeNull();
      expect(mapJob({ ...JOB, CostCenterId: null }, r).costCenter).toBeNull();
    });
  });

  it('keeps WHY a file was cancelled, not just that it was', () => {
    // The reason used to be read only to set the `canceled` boolean and then
    // dropped - so the one thing anybody would want to know was lost. 116 jobs
    // carry one and the text is specific.
    const m = map({ JobCancelReason: 'Duplicate job TP-643/25' });
    expect(m.canceled).toBe(true);
    expect(m.cancelReason).toBe('Duplicate job TP-643/25');
  });

  it('falls back to the coded cancellation reason', () => {
    const r = { ...resolvers, cancelReasons: new Map([['5', 'Job created in error']]) };
    // Free text wins - it is more specific than the code.
    expect(mapJob({ ...JOB, JobCancelReason: 'Duplicate', JobCancelReasonId: 5 }, r).cancelReason)
      .toBe('Duplicate');
    // With no text, the decoded id carries it.
    expect(mapJob({ ...JOB, JobCancelReason: '', JobCancelReasonId: 5 }, r).cancelReason)
      .toBe('Job created in error');
  });

  it('carries the remaining fields the legacy file records', () => {
    const m = map({
      ApprovedStatusOn: '2024-10-04T16:38:35.360Z',
      ProjectRefNo: '13832',
      InvoiceRemarks: 'sapt',
      GRT: 17683,
      NRT: 12947,
    });
    expect(m.approvedOn).toBe('2024-10-04');
    expect(m.projectRef).toBe('13832');
    expect(m.invoiceRemarks).toBe('sapt');
    expect(m.grt).toBe(17683);
    expect(m.nrt).toBe(12947);
  });

  it('carries the references a clearing file is found by', () => {
    // The customs module was designed before anyone had read a clearing
    // agent's database. ClientRefNo is on 75% of CargoLinkers' jobs and is the
    // number a customer quotes when they ring up; it had no field at all.
    const m = map({
      ClientRefNo: 'ITD/CP-30-2024',
      JobRefNo: 'DAL-5740/24',
      CustomFileNo: 'SDM/225/24-25',
      CarrierBookingNo: '21784',
    });
    expect(m.clientRef).toBe('ITD/CP-30-2024');
    expect(m.jobRef).toBe('DAL-5740/24');
    expect(m.customFileNo).toBe('SDM/225/24-25');
    expect(m.carrierBookingNo).toBe('21784');
  });

  it('resolves terminal, cargo type and Incoterms to their values', () => {
    // Stored as the VALUE, not the legacy id - a migrated job must not carry
    // "2" where "FCL" belongs.
    const r = {
      ...resolvers,
      terminals: new Map([['12911', 'QICT']]),
      cargoTypes: new Map([['2', 'FCL']]),
      incoTerms: new Map([['4', 'FREE ON BOARD']]),
    };
    const m = mapJob(
      { ...JOB, TerminalId: 12911, CargoTypeId: 2, IncoTermsId: 4, NetWeight: 8443 },
      r,
    );
    expect(m.terminal).toBe('QICT');
    expect(m.cargoType).toBe('FCL');
    expect(m.incoTerms).toBe('FREE ON BOARD');
    expect(m.netWeight).toBe(8443);
  });

  it('leaves an unknown lookup id null rather than storing it raw', () => {
    const m = mapJob({ ...JOB, TerminalId: 99999, CargoTypeId: 88, IncoTermsId: 77 }, resolvers);
    expect(m.terminal).toBeNull();
    expect(m.cargoType).toBeNull();
    expect(m.incoTerms).toBeNull();
  });

  it('takes the delivery ADDRESS, not the location id', () => {
    // DeliveryLocationId is populated on 3 rows out of 15,364; the address is
    // the real record.
    expect(map({ DeliveryLocationAddress: 'F-528/B SITE KARACHI-PAKISTAN' }).deliveryLocation)
      .toBe('F-528/B SITE KARACHI-PAKISTAN');
    expect(map({ DeliveryLocationAddress: '   ' }).deliveryLocation).toBeNull();
  });

  it('carries the port of final destination', () => {
    // POFDCode is on 7,414 of 15,364 jobs and had no column to land in, so it
    // was dropped on every one of them. Stored as the code, like pol and pod.
    expect(map({ POFDCode: 'PKLHE' }).pofd).toBe('PKLHE');
    expect(map({ POFDCode: '' }).pofd).toBeNull();
    expect(map({ POFDCode: null }).pofd).toBeNull();
  });

  it('survives a source with no commodity column at all', () => {
    // CargoLinkers' Log_Job has no CommodityId - every table referencing
    // Gen_Commodity there is empty - and the legacy server now omits absent
    // columns rather than failing the request. The field must resolve to null,
    // not throw or invent a link.
    const { CommodityId, ...noCommodity } = { ...JOB, GoodsDescription: 'ZIPPER' };
    const m = mapJob(noCommodity, resolvers);
    expect(m.CommodityId).toBeNull();
    expect(m.goodsDescription).toBe('ZIPPER');
  });
});

describe('the job number', () => {
  test('yields its sequence number', () => {
    expect(jobIdFrom('CL-CC-42/26')).toBe(42);
    expect(jobIdFrom('SNS-CCJ-7/25')).toBe(7);
  });

  test('returns null instead of throwing on a number it cannot parse', () => {
    // The old import did JobNumber.split("-")[1].split("/")[0] with no guard,
    // so one odd number threw a TypeError and took its whole batch - ten jobs
    // at a time - down with it.
    for (const v of [null, undefined, '', 'nonsense', 'CL-CC', 42]) {
      expect(() => jobIdFrom(v)).not.toThrow();
    }
    expect(jobIdFrom('nonsense')).toBeNull();
  });

  test('a job with an unparseable number is still imported', () => {
    // The sequence number is a convenience; the job number is what matters.
    const plan = planLgJobs([{ ...JOB, JobNumber: 'ODD FORMAT' }], [], { resolvers });
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].job.jobId).toBeNull();
    expect(plan.toCreate[0].job.jobNo).toBe('ODD FORMAT');
  });
});

describe('status', () => {
  test('a cancelled job is Canceled, and flagged as such', () => {
    expect(statusOf({ JobCancelReason: 'duplicate' })).toBe('Canceled');
    expect(mapJob({ ...JOB, JobCancelReason: 'duplicate' }, resolvers).canceled).toBe(true);
  });

  test('a closed job is Cleared', () => {
    expect(statusOf({ isClosed: true })).toBe('Complete');
    expect(statusOf({ isClosed: 1 })).toBe('Complete');
  });

  test('anything else is Open, which is the honest answer', () => {
    expect(statusOf({})).toBe('Incomplete');
    expect(statusOf({ JobStageId: 4 })).toBe('Incomplete');
  });
});

describe('mapping the duty', () => {
  const d = mapDuty(DUTY, 0, resolvers);

  test('carries RATES, not amounts', () => {
    expect(d.customDutyPerc).toBe(20);
    expect(d.salesTaxPerc).toBe(18);
    expect(d.assessedValue).toBe(4000000);
  });

  test('carries the flat charges as the amounts they are', () => {
    expect(d.demurrage).toBe(45000);
  });

  test('keeps the SRO, which justifies a concessionary rate', () => {
    expect(d.sroNumber).toBe('SRO-565');
  });

  test('resolves the item commodity and keeps the legacy id', () => {
    expect(d.CommodityId).toBe(201);
    expect(d.climaxId).toBe(900);
  });

  test('every mapped rate and amount is a head the arithmetic knows', () => {
    // A mapping onto a field name the cascade does not read would store the
    // figure and never charge it - money that vanishes silently.
    const rateFields = new Set(RATE_HEADS.map((h) => h.field));
    const amountFields = new Set(AMOUNT_HEADS.map((h) => h.field));
    for (const to of Object.values(DUTY_RATE_MAP)) expect(rateFields.has(to)).toBe(true);
    for (const to of Object.values(DUTY_AMOUNT_MAP)) expect(amountFields.has(to)).toBe(true);
  });

  test('every head the arithmetic knows has something mapped onto it', () => {
    // The other direction: a head with no legacy source would always be
    // empty on a migrated file, and nobody would know why.
    const mappedRates = new Set(Object.values(DUTY_RATE_MAP));
    const mappedAmounts = new Set(Object.values(DUTY_AMOUNT_MAP));
    for (const h of RATE_HEADS) expect(mappedRates.has(h.field)).toBe(true);
    for (const h of AMOUNT_HEADS) expect(mappedAmounts.has(h.field)).toBe(true);
  });

  test('the value fields land on real columns', () => {
    for (const to of Object.values(DUTY_VALUE_MAP)) expect(d).toHaveProperty(to);
  });
});

describe('planning a run', () => {
  test('attaches each job its own duty lines', () => {
    const plan = planLgJobs(
      [JOB, { ...JOB, Id: 501, JobNumber: 'CL-CC-43/26' }],
      [DUTY, { ...DUTY, Id: 901, LogJobId: 501 }, { ...DUTY, Id: 902, LogJobId: 500 }],
      { resolvers },
    );
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toCreate[0].duty).toHaveLength(2);
    expect(plan.toCreate[1].duty).toHaveLength(1);
    expect(plan.stats.dutyLines).toBe(3);
  });

  test('duty rows naming no job are dropped rather than attached to one', () => {
    const plan = planLgJobs([JOB], [{ ...DUTY, LogJobId: null }], { resolvers });
    expect(plan.toCreate[0].duty).toHaveLength(0);
    expect(plan.stats.withoutDuty).toBe(1);
  });

  test('skips what is already imported, so a re-run is a no-op', () => {
    const plan = planLgJobs([JOB], [DUTY], { resolvers, existingClimaxIds: [500] });
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.stats.alreadyImported).toBe(1);
  });

  test('a legacy id repeated in one export is imported once and reported', () => {
    const plan = planLgJobs([JOB, JOB], [], { resolvers });
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.problems.duplicateClimaxIds).toEqual([500]);
  });

  test('a job with no job number is reported, not imported blank', () => {
    // jobNo is how every screen and every search finds a job.
    const plan = planLgJobs([{ ...JOB, JobNumber: null }], [], { resolvers });
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.stats.missingJobNo).toBe(1);
  });

  test('counts unresolved links per relationship, not as one number', () => {
    const plan = planLgJobs([JOB], [], { resolvers: { ...resolvers, companies: new Map() } });
    expect(plan.unresolved.company).toBe(1);
    expect(plan.stats.withoutCompany).toBe(1);
    // Still imported: refusing every job over one lookup would be worse. But
    // a job with no company is invisible on every list, hence the count.
    expect(plan.toCreate).toHaveLength(1);
  });

  test('reports legacy codes it did not recognise', () => {
    // The default is a fact nobody entered, so an unanticipated id has to
    // surface rather than quietly becoming an Import.
    const plan = planLgJobs([{ ...JOB, ImportExportId: 9, ModeId: 8 }], [], { resolvers });
    expect(plan.unknownCodes.direction).toEqual([9]);
    expect(plan.unknownCodes.mode).toEqual([8]);
  });

  test('a row with no legacy id is counted and skipped', () => {
    const plan = planLgJobs([{ JobNumber: 'X' }, null], [], { resolvers });
    expect(plan.problems.missingId).toBe(2);
    expect(plan.toCreate).toHaveLength(0);
  });

  test('survives an empty or missing source', () => {
    expect(planLgJobs([], [], { resolvers }).toCreate).toEqual([]);
    expect(planLgJobs(null, null, {}).toCreate).toEqual([]);
  });
});

/**
 * The seam where the mapping meets the payload.
 *
 * Every case below is a field that WAS being dropped silently on real data:
 * the mapping was right, the value simply never arrived or never landed. None
 * of them failed anything - a null looks exactly like "the source had none" -
 * so they are pinned here by the count of jobs they affect on CargoLinkers.
 */
describe('fields that were arriving empty', () => {
  test('the commercial invoice currency is resolved, not dropped', () => {
    // 15,363 of 15,364 jobs carry a CurrencyId and 60% are not PKR, so a
    // value migrated without its currency is a figure with no unit.
    const job = mapJob({ ...JOB, CurrencyId: 1, CommInvValue: 50000 }, resolvers);
    expect(job.invoiceCurrency).toBe('USD');
    expect(job.invoiceValue).toBe(50000);
  });

  test('the legacy GPB misspelling is corrected to GBP', () => {
    // GL_Currencies really holds 'GPB' - not a currency code - on 128 jobs.
    // The GD screen offers ISO codes, so an uncorrected one would sit outside
    // the list on every one of them.
    const r = { ...resolvers, currency: new Map([['24', 'GPB'], ['2', 'USD']]) };
    expect(mapJob({ ...JOB, CurrencyId: 24 }, r).invoiceCurrency).toBe('GBP');
    // Everything else passes through untouched.
    expect(mapJob({ ...JOB, CurrencyId: 2 }, r).invoiceCurrency).toBe('USD');
  });

  test('every currency the migration emits is one the picker offers', () => {
    const OFFERED = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF'];
    // The seven codes GL_Currencies actually holds, GPB included.
    for (const code of ['PKR', 'USD', 'AED', 'GPB', 'EUR', 'BDT', 'OMR']) {
      const r = { ...resolvers, currency: new Map([['1', code]]) };
      expect(OFFERED).toContain(mapJob({ ...JOB, CurrencyId: 1 }, r).invoiceCurrency);
    }
  });

  test('an unknown currency id is left null rather than stored raw', () => {
    expect(mapJob({ ...JOB, CurrencyId: 99 }, resolvers).invoiceCurrency).toBeNull();
  });

  test('cost centre, container type and delivery terms resolve to their values', () => {
    // These read {} for every job because the legacy endpoint's response was
    // destructured one position out of step with its queries.
    const r = {
      ...resolvers,
      costCenters: new Map([['22', 'HO']]),
      containerTypes: new Map([['3', 'FCL']]),
      deliveryTypes: new Map([['5', 'CY/CY']]),
      installCostCenter: 'KHI',
    };
    const job = mapJob(
      { ...JOB, CostCenterId: 22, ContianerTypeId: 3, DeliveryDetailId: 5 }, r,
    );
    // One legacy cost centre means that cost centre IS the installation.
    expect(job.costCenter).toBe('KHI');
    expect(job.containerType).toBe('FCL');
    expect(job.deliveryTerms).toBe('CY/CY');
  });

  test('a padded CHAR lookup value is trimmed, not stored with its padding', () => {
    // Gen_DeliveryType is a fixed-width column: the legacy server really
    // returns "DR / CY        ", and that padding would reach the form.
    const r = { ...resolvers, deliveryTypes: new Map([['1', 'DR / CY        ']]) };
    expect(mapJob({ ...JOB, DeliveryDetailId: 1 }, r).deliveryTerms).toBe('DR / CY');
  });

  test('the job date is carried, not just borrowed for the GD date', () => {
    // Populated on all 15,364 jobs; the form asks for it and it was blank.
    const job = mapJob({ ...JOB, JobDate: new Date('2026-08-01T00:00:00Z') }, resolvers);
    expect(job.jobDate).toBe('2026-08-01');
  });

  test('the carrier resolves through the party lookup', () => {
    expect(mapJob({ ...JOB, ShippingLineId: 11 }, resolvers).shippingLineId).toBe(102);
    expect(mapJob({ ...JOB, ShippingLineId: null }, resolvers).shippingLineId).toBeNull();
  });
});

describe('containers on the declaration', () => {
  const CONTAINER = {
    Id: 700, Sno: null, LogJobId: 500, ContainerNo: 'MSKU1234567',
    EquipCode: '40HC', GrossWt: 0, NetWt: null, NoOfPackages: null, Remarks: null,
  };

  test('maps the two columns that are actually populated', () => {
    const c = mapContainer(CONTAINER, 0);
    expect(c.containerNo).toBe('MSKU1234567');
    expect(c.sizeType).toBe('40HC');
    expect(c.climaxId).toBe(700);
  });

  test('a zero weight is null, not a measurement nobody took', () => {
    // GrossWt is 0 on all but 241 of the 6,164 rows.
    expect(mapContainer(CONTAINER, 0).grossWeight).toBeNull();
    expect(mapContainer({ ...CONTAINER, GrossWt: 24000 }, 0).grossWeight).toBe(24000);
  });

  test('falls back to batch position when the legacy Sno is unset', () => {
    // Sno is set on 7 rows of 6,164.
    expect(mapContainer(CONTAINER, 3).sortOrder).toBe(3);
    expect(mapContainer({ ...CONTAINER, Sno: 2 }, 3).sortOrder).toBe(2);
  });

  test('attaches each job its own containers and counts them', () => {
    const plan = planLgJobs(
      [JOB, { ...JOB, Id: 501, JobNumber: 'CL-CC-43/26' }],
      [],
      {
        resolvers,
        containers: [
          CONTAINER,
          { ...CONTAINER, Id: 701, LogJobId: 501, ContainerNo: 'TGHU7654321' },
          { ...CONTAINER, Id: 702, LogJobId: 500, ContainerNo: 'CSNU1112223' },
        ],
      },
    );
    expect(plan.toCreate[0].containers).toHaveLength(2);
    expect(plan.toCreate[1].containers).toHaveLength(1);
    expect(plan.stats.containers).toBe(3);
  });

  test('a row with no container number is dropped rather than imported blank', () => {
    const plan = planLgJobs([JOB], [], {
      resolvers, containers: [{ ...CONTAINER, ContainerNo: '   ' }],
    });
    expect(plan.toCreate[0].containers).toHaveLength(0);
    expect(plan.stats.containers).toBe(0);
  });

  test('no container rows is not an error', () => {
    const plan = planLgJobs([JOB], [], { resolvers });
    expect(plan.toCreate[0].containers).toEqual([]);
  });
});

/**
 * The vocabulary the customer asked for (2026-09-04).
 *
 * These are renames on a screen, but the migration has to agree with them or a
 * migrated job carries a word the form no longer offers - which for a picker
 * means a box that looks empty and silently becomes whatever the next person
 * selects. transportMode is the sharp one: routes/customsJobs validates it
 * against a closed list, so a mismatch is a save that 400s.
 */
describe('the customer vocabulary', () => {
  const { renameCargoType, jobTypeOf, MODE_BY_ID } = require('../../functions/lgJobMigrationPlan');

  test('mode 3 is By Road, matching TRANSPORT_MODES on the route', () => {
    expect(MODE_BY_ID[3]).toBe('By Road');
    expect(mapJob({ ...JOB, ModeId: 3 }, resolvers).transportMode).toBe('By Road');
  });

  test('General Cargo is carried across unchanged, not renamed to Part', () => {
    // History says what it said. 7,624 legacy files are General Cargo, the
    // screen offers both words, and Part is for new jobs only.
    const r = {
      ...resolvers,
      cargoTypes: new Map([['5', 'General Cargo'], ['2', 'FCL']]),
      containerTypes: new Map([['5', 'General Cargo'], ['4', 'RO- RO Unit']]),
    };
    expect(mapJob({ ...JOB, CargoTypeId: 5 }, r).cargoType).toBe('General Cargo');
    expect(mapJob({ ...JOB, ContianerTypeId: 5 }, r).containerType).toBe('General Cargo');
    expect(mapJob({ ...JOB, CargoTypeId: 2 }, r).cargoType).toBe('FCL');
  });

  test('every shipment type the legacy book uses is offered, by sea and by air', () => {
    const { CARGO_TYPES_SEA, CARGO_TYPES_AIR } = require('../../functions/customsVocabulary');
    // The three values CargoTypeId actually holds, plus the word new jobs use.
    for (const name of ['FCL', 'LCL', 'Empty', 'General Cargo', 'Part']) {
      expect(CARGO_TYPES_SEA).toContain(name);
    }
    // Air carries FCL on 523 legacy jobs and Empty on 3 - mis-keyed or not,
    // the list has to be able to show what the file says.
    for (const name of ['LCL', 'FCL', 'Empty', 'Chartered']) {
      expect(CARGO_TYPES_AIR).toContain(name);
    }
  });

  test('job type is inferred from the haulier, not from the legacy booking type', () => {
    // Log_Job.JobTypeId is 'Direct' on 15,362 of 15,364 rows and describes a
    // freight booking's origin - it cannot say whether the agent moved the
    // goods. A named transporter can.
    expect(jobTypeOf({ TransporterId: 12892 })).toBe('Clearing + Transport');
    expect(jobTypeOf({ TransporterId: null })).toBe('Clearing');
    expect(jobTypeOf({})).toBe('Clearing');
    // And the legacy column is deliberately ignored.
    expect(jobTypeOf({ JobTypeId: 1, TransporterId: null })).toBe('Clearing');
  });

  test('every terminal the legacy book uses lands on one the picker offers', () => {
    // The list and the data disagreed on case and spacing - FAST TRACK vs
    // Fast Track, BAYWEST vs Bay West - which was 2,158 jobs carrying a
    // terminal the form could not show.
    const { TERMINAL_SEA, TERMINAL_AIR } = require('../../functions/customsVocabulary');
    const offered = new Set([...TERMINAL_SEA, ...TERMINAL_AIR].map((x) => x.id));
    const legacy = [
      'QICT', 'SAPT', 'KICT', 'AFU', 'FAST TRACK', 'KGTL', 'QFS', 'BY ROAD',
      'BADARUDDIN', 'BAYWEST', 'SUPREME OFF DOCK', 'KEPZ', 'PAK SHAHEEN (KPT)',
      'NLC', 'PAK SHAHEEN (PQ)',
    ];
    for (const name of legacy) {
      const r = { ...resolvers, terminals: new Map([['9', name]]) };
      expect(offered).toContain(mapJob({ ...JOB, TerminalId: 9 }, r).terminal);
    }
  });

  test('a terminal nobody has heard of is carried as recorded, not blanked', () => {
    const r = { ...resolvers, terminals: new Map([['9', 'SOME NEW YARD']]) };
    expect(mapJob({ ...JOB, TerminalId: 9 }, r).terminal).toBe('SOME NEW YARD');
  });

  test('every status the migration emits is one the route accepts', () => {
    // The route validates status against a closed list, so a migrated job
    // carrying a word it does not know fails the first time somebody opens
    // and saves it. This is the guard for that whole class of mismatch.
    const STATUSES = ['Complete', 'Incomplete', 'Canceled'];
    expect(STATUSES).toContain(statusOf({}));
    expect(STATUSES).toContain(statusOf({ isClosed: true }));
    expect(STATUSES).toContain(statusOf({ JobCancelReason: 'Duplicate job' }));
    expect(STATUSES).toContain(mapJob(JOB, resolvers).status);
  });

  test('a migrated job carries a job type the form offers', () => {
    const JOB_TYPES = ['Clearing', 'Transport', 'Clearing + Transport'];
    expect(JOB_TYPES).toContain(mapJob({ ...JOB, TransporterId: 11 }, resolvers).jobType);
    expect(JOB_TYPES).toContain(mapJob({ ...JOB, TransporterId: null }, resolvers).jobType);
  });
});
