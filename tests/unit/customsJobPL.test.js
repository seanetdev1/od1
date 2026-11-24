/**
 * Customs jobs as Job Profit/Loss rows.
 *
 * The report reads several association fields without guarding
 * (x.Client.name, x.shipper.name, x.local_vendor.name), so the shape of a row
 * is load-bearing: a missing object is a crash, not a blank cell. These tests
 * pin that shape, and the filter rules that decide when a clearance file can
 * be part of a report at all.
 */
const {
  customsJobPLRows, customsAppliesTo, declarationRow,
  CUSTOMS_OPERATION, AIR_SUBTYPE,
} = require('../../functions/customsJobPL');

const JOB = {
  id: 4,
  jobNo: 'SNS-CCJ-1/26',
  gdDate: '2026-08-19',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  companyId: '1',
  exRate: '1',
  direction: 'Import',
  transportMode: 'Sea',
  gdNumber: 'KAPW-HC-123456-19-08-2026',
  blNo: 'MAEU12345',
  pol: 'CNSHA',
  pod: 'PKKHI',
  etaDate: '2026-08-15',
  arrivalDate: '2026-08-16',
  grossWeight: 12500,
  packages: 400,
  pkgUnit: 'CTN',
  // Duty is assessed per item on Customs_Duty, not as figures on the job.
  Customs_Duties: [
    { assessedValue: 4000000, customDutyPerc: 20, salesTaxPerc: 18 },
  ],
  client:    { name: 'ACME Traders' },
  shipper:   { name: 'Shanghai Supplies' },
  consignee: { name: 'ACME Traders' },
  Commodity: { name: 'Ceramic Tiles' },
  Charge_Heads: [
    { id: 1, InvoiceId: 9, local_amount: '25000', Invoice: {
      id: 9, total: '30000', payType: 'Recievable', recieved: '0', paid: '0',
      type: 'Job Invoice', status: '1', ex_rate: '1', currency: 'PKR',
      Invoice_Transactions: [{ gainLoss: 100 }],
    } },
    // Same invoice on a second charge: one invoice usually covers several
    // lines, and it must be counted once.
    { id: 2, InvoiceId: 9, local_amount: '5000', Invoice: { id: 9, total: '30000' } },
  ],
};

describe('which filters customs can answer', () => {
  test('a sales-representative filter excludes it entirely', () => {
    // A clearance file has none, so returning rows anyway would add ones that
    // do not meet the stated filter.
    expect(customsAppliesTo({ salesrepresentative: '3' })).toBe(false);
  });

  test('an overseas-agent filter excludes it entirely', () => {
    expect(customsAppliesTo({ overseasagent: '3' })).toBe(false);
  });

  test('a job-type filter that does not name CC excludes it', () => {
    expect(customsAppliesTo({ jobtype: 'SE,SI' })).toBe(false);
    expect(customsAppliesTo({ jobtype: 'SE,CC' })).toBe(true);
    expect(customsAppliesTo({ jobtype: ['CC'] })).toBe(true);
  });

  test('an unfiltered report includes it', () => {
    expect(customsAppliesTo({})).toBe(true);
    expect(customsAppliesTo({ jobtype: '' })).toBe(true);
  });

  test('a clearance file can answer all three sub-types', () => {
    /* THIS RULE CHANGED, and the old one is worth recording because it was
       right when it was written.

       FCL and LCL used to exclude customs outright: a GD recorded no cargo
       type, so the only true mapping was Air mode to AIR. The migration added
       Customs_Job.cargoType - 7,085 FCL and 4,609 LCL on CargoLinkers' book -
       and the filter was never revisited. The cost was silent: with all three
       boxes ticked, which is what the screen does by default, the report
       narrowed customs to its air files and returned 284 rows where 4,822
       existed. */
    expect(customsAppliesTo({ subtype: 'FCL' })).toBe(true);
    expect(customsAppliesTo({ subtype: 'LCL' })).toBe(true);
    expect(customsAppliesTo({ subtype: AIR_SUBTYPE })).toBe(true);
    expect(customsAppliesTo({ subtype: 'FCL,LCL,AIR' })).toBe(true);
  });

  test('a sub-type it knows nothing about still excludes it', () => {
    // A future fourth option must not silently match everything.
    expect(customsAppliesTo({ subtype: 'BREAKBULK' })).toBe(false);
  });

  test('a malformed sub-type or job type excludes it rather than erroring', () => {
    /* The filters arrive as request HEADERS, strings however the screen meant
       them. A screen sending the wrong shape does not fail loudly, it matches
       nothing - and an empty report reads as "no work" rather than "the
       question was malformed". Exactly how the Job P/L screen's "tick every
       job type" sent the option OBJECTS and produced this. */
    expect(customsAppliesTo({ jobtype: '[object Object],[object Object]' })).toBe(false);
  });

  test('accepts an array as well as a comma string', () => {
    expect(customsAppliesTo({ jobtype: ['CC'] })).toBe(true);
    expect(customsAppliesTo({ jobtype: ['SE', 'SI'] })).toBe(false);
  });
});

describe('the row a declaration becomes', () => {
  const row = declarationRow(JOB);

  test('is tagged as customs so the type filter can find it', () => {
    expect(row.operation).toBe(CUSTOMS_OPERATION);
    expect(row.jobType).toBe('Customs Clearance');
  });

  test('dates on the GD, not on when the record was typed', () => {
    // Otherwise a GD selected for August shows a July date and looks like it
    // should not be there.
    expect(row.createdAt).toBe('2026-08-19');
  });

  test('falls back to createdAt for a file whose GD is not filed yet', () => {
    const { gdDate, ...unfiled } = JOB;
    expect(declarationRow(unfiled).createdAt).toBe(JOB.createdAt);
  });

  test('reports the sub type only for an air clearance', () => {
    expect(row.subType).toBe('');
    expect(declarationRow({ ...JOB, transportMode: 'Air' }).subType).toBe(AIR_SUBTYPE);
  });

  test('counts each invoice once however many charges carry it', () => {
    expect(row.Invoices).toHaveLength(1);
    expect(row.Invoices[0].id).toBe(9);
  });

  test('gives every association the report dereferences unguarded', () => {
    // A missing object here is a crash in the report, not a blank cell.
    for (const key of ['Client', 'shipper', 'consignee', 'commodity',
                       'local_vendor', 'overseas_agent', 'shipping_line',
                       'sales_representator']) {
      expect(typeof row[key]?.name).toBe('string');
    }
    expect(Array.isArray(row.SE_Equipments)).toBe(true);
  });

  test('survives a job with no parties at all', () => {
    const bare = { id: 1, jobNo: 'X', Charge_Heads: [] };
    const r = declarationRow(bare);
    expect(r.Client.name).toBe('');
    expect(r.shipper.name).toBe('');
    expect(r.Invoices).toEqual([]);
  });

  test('puts the two numbers that identify the file where a B/L would be', () => {
    expect(row.Bl).toEqual({ hbl: 'MAEU12345', mbl: 'KAPW-HC-123456-19-08-2026' });
    expect(row.customerRef).toBe('KAPW-HC-123456-19-08-2026');
  });

  test('carries the duty, which is not revenue', () => {
    // The largest number on a clearance file, and only its reimbursement is
    // ever billed - carried so a reader can see why a file with a small margin
    // moved a large sum.
    //
    // 20% of 4,000,000 = 800,000 duty; sales tax at 18% of (4,000,000 +
    // 800,000) = 864,000. Derived from the duty LINES, so a row whose lines
    // were not included in the query reports 0 and this catches it.
    expect(row.totalDuty).toBeCloseTo(800000 + 864000, 6);
  });

  test('apportions an invoice split across files', () => {
    // Not reachable from the screen, which only offers one job's charges - but
    // a payload that reached /makeInvoice with two files' charges must not be
    // counted in full against each of them.
    const half = declarationRow(JOB, { 9: 0.5 });
    expect(Number(half.Invoices[0].total)).toBe(15000);
    expect(half.Invoices[0].Invoice_Transactions[0].gainLoss).toBe(50);
  });
});

describe('rows query', () => {
  test('returns nothing, and asks the database nothing, when the filters exclude customs', () => {
    // Costs nothing on an installation that files no declarations.
    const models = {
      Customs_Job: { findAll: jest.fn() },
      Charge_Head: { findAll: jest.fn() },
    };
    return customsJobPLRows({ salesrepresentative: '3' }, models).then((rows) => {
      expect(rows).toEqual([]);
      expect(models.Customs_Job.findAll).not.toHaveBeenCalled();
    });
  });

  test('stops after the first query when there are no matching jobs', () => {
    const models = {
      Customs_Job: { findAll: jest.fn().mockResolvedValue([]) },
      Customs_Duty: {},
      Charge_Head: { findAll: jest.fn() },
      Invoice: {}, Invoice_Transactions: {}, Clients: {}, Commodity: {},
    };
    return customsJobPLRows({}, models).then((rows) => {
      expect(rows).toEqual([]);
      expect(models.Charge_Head.findAll).not.toHaveBeenCalled();
    });
  });

  test('names a model the caller forgot, rather than letting Sequelize fail', async () => {
    // The bug this exists for, and it shipped: Customs_Duty was added to the
    // include here and not to the bundle in routes/misc/profitLoss.js. The
    // include was then built with `{ model: undefined }`, Sequelize threw, and
    // the WHOLE Job P/L report 500'd - freight and aviation rows with it. The
    // failure named neither the model nor this file.
    const models = {
      Customs_Job: { findAll: jest.fn() },
      Charge_Head: {}, Invoice: {}, Invoice_Transactions: {},
      Clients: {}, Commodity: {},
      // Customs_Duty deliberately absent.
    };
    await expect(customsJobPLRows({}, models)).rejects.toThrow(/Customs_Duty/);
    // And it fails BEFORE querying, so the message is the first thing that
    // happens rather than the second.
    expect(models.Customs_Job.findAll).not.toHaveBeenCalled();
  });

  test('lists every missing model at once, not just the first', async () => {
    await expect(customsJobPLRows({}, {})).rejects.toThrow(/Customs_Job.*Customs_Duty/);
  });

  // The rows are assembled from flat queries rather than one nested join (the
  // join returned a row per job x charge x transaction, and folding that back
  // up was most of the report's load time). This pins the assembly: every
  // piece still lands on the right file, in the shape the report reads.
  test('assembles each file from its duty lines, approved invoices, transactions and shares', async () => {
    const blank = { id: null, name: null };   // an absent party, as a raw join returns it
    const invoice = {
      id: '900', total: '1000', payType: 'Recievable', recieved: '400', paid: '0',
      type: 'Job Invoice', status: '1', ex_rate: '1', currency: 'PKR',
    };
    const models = {
      Customs_Job: {
        findAll: jest.fn().mockResolvedValue([
          { id: 7, jobNo: 'CCJ-7', gdDate: '2026-08-02', client: { id: 3, name: 'ACME' },
            shipper: blank, consignee: blank, Commodity: blank },
          // Nothing approved is billed against this one.
          { id: 8, jobNo: 'CCJ-8', gdDate: '2026-08-03', client: blank,
            shipper: blank, consignee: blank, Commodity: blank },
        ]),
      },
      Customs_Duty: {
        rawAttributes: { CustomsJobId: {} },
        findAll: jest.fn().mockResolvedValue([
          { id: 1, CustomsJobId: 7, assessedValue: '1000000', customDutyPerc: '20' },
        ]),
      },
      Charge_Head: {
        findAll: jest.fn()
          // Which approved invoices each file is billed on: two charges, one invoice.
          .mockResolvedValueOnce([
            { CustomsJobId: 7, Invoice: invoice },
            { CustomsJobId: 7, Invoice: invoice },
          ])
          // The shares: a quarter of that invoice sits on another file.
          .mockResolvedValueOnce([
            { InvoiceId: '900', CustomsJobId: 7, local_amount: '750' },
            { InvoiceId: '900', CustomsJobId: 99, local_amount: '250' },
          ]),
      },
      Invoice: {},
      Invoice_Transactions: {
        rawAttributes: { InvoiceId: {} },
        findAll: jest.fn().mockResolvedValue([
          { id: 1, InvoiceId: '900', amount: '400', gainLoss: '8' },
        ]),
      },
      Clients: {}, Commodity: {},
    };

    const rows = await customsJobPLRows({}, models);

    expect(rows.map((r) => r.jobNo)).toEqual(['CCJ-7']);   // CCJ-8 has no P/L to report
    const [row] = rows;
    expect(row.totalDuty).toBe(200000);                     // its duty line reached it
    expect(row.Invoices).toHaveLength(1);                   // two charges, one invoice, counted once
    expect(Number(row.Invoices[0].total)).toBe(750);        // this file's three quarters
    expect(Number(row.Invoices[0].recieved)).toBe(300);
    expect(row.Invoices[0].Invoice_Transactions).toHaveLength(1);
    expect(row.Invoices[0].Invoice_Transactions[0].gainLoss).toBe(6);
    expect(row.Client.name).toBe('ACME');
    expect(row.shipper.name).toBe('');                      // an absent party reads blank, not null
  });
});
