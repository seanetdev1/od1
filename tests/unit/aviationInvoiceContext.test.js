/**
 * Flight context on aviation invoices.
 *
 * The shared job reports read their job columns off Invoice.SE_Job. An
 * aviation invoice has none, so this attaches the flight instead. The point of
 * these tests is as much what it must NOT do - a freight invoice has to come
 * back untouched, because the reports it feeds are shared.
 */
const { attachAviationContext } = require('../../functions/aviationInvoiceContext');

// Minimal stand-ins for the Sequelize models. Recording the calls is what lets
// us assert the "no aviation invoices, no query" behaviour.
const makeModels = (consignments = []) => {
  const calls = [];
  return {
    calls,
    models: {
      Aviation_Consignment: {
        findAll: async (opts) => {
          calls.push(opts);
          const wanted = opts.where.id;
          return consignments.filter((c) => wanted.includes(c.id));
        },
      },
      Aviation_Job: {},
      Aviation_Carrier: {},
    },
  };
};

// Sequelize instances expose columns directly and carry a dataValues bag that
// serialises to JSON; the enrichment writes there.
const invoice = (id, { SEJobId = null, charges = [] } = {}) => ({
  id, SEJobId, Charge_Heads: charges, dataValues: {},
});

const consignment = (id, awb, job, prefix) => ({
  id, awb,
  Aviation_Job: job,
  Aviation_Carrier: prefix ? { prefix } : null,
});

const FLIGHT = {
  id: 42, jobNo: 'IFA-AVJ-3/26', flightNo: 'ER-101',
  flightDate: '2026-09-04', origin: 'LHE', destination: 'JED',
};

describe('freight invoices', () => {
  test('are returned untouched, with aviation null', async () => {
    const { models, calls } = makeModels();
    const rows = [invoice(1, { SEJobId: 9 }), invoice(2, { SEJobId: 10 })];
    await attachAviationContext(rows, models);
    expect(rows.map((r) => r.dataValues.aviation)).toEqual([null, null]);
  });

  test('cost no extra query at all', async () => {
    // A freight-only period must not pay for a feature it does not use.
    const { models, calls } = makeModels();
    await attachAviationContext([invoice(1, { SEJobId: 9 })], models);
    expect(calls).toHaveLength(0);
  });
});

describe('aviation invoices', () => {
  test('carry the flight and its AWBs', async () => {
    const { models } = makeModels([
      consignment(100, '12345678', FLIGHT, '214'),
    ]);
    const inv = invoice(1, { charges: [{ AviationConsignmentId: 100 }] });
    await attachAviationContext([inv], models);

    expect(inv.dataValues.aviation).toEqual({
      jobId: 42,
      jobNo: 'IFA-AVJ-3/26',
      flightNo: 'ER-101',
      flightDate: '2026-09-04',
      sector: 'LHE - JED',
      awbs: ['214-12345678'],
    });
  });

  test('an AWB with no carrier still lists, without a prefix', async () => {
    const { models } = makeModels([consignment(100, '999', FLIGHT, null)]);
    const inv = invoice(1, { charges: [{ AviationConsignmentId: 100 }] });
    await attachAviationContext([inv], models);
    expect(inv.dataValues.aviation.awbs).toEqual(['999']);
  });

  test('an invoice covering several AWBs lists each once', async () => {
    const { models } = makeModels([
      consignment(100, '111', FLIGHT, '214'),
      consignment(101, '222', FLIGHT, '214'),
    ]);
    const inv = invoice(1, {
      charges: [
        { AviationConsignmentId: 100 },
        { AviationConsignmentId: 100 },   // two charges on one AWB
        { AviationConsignmentId: 101 },
      ],
    });
    await attachAviationContext([inv], models);
    expect(inv.dataValues.aviation.awbs).toEqual(['214-111', '214-222']);
  });

  test('one query however many invoices there are', async () => {
    const { models, calls } = makeModels([consignment(100, '1', FLIGHT, '214')]);
    const rows = Array.from({ length: 25 }, (_, i) =>
      invoice(i, { charges: [{ AviationConsignmentId: 100 }] }));
    await attachAviationContext(rows, models);
    expect(calls).toHaveLength(1);
  });
});

describe('mixed batches', () => {
  test('enrich the aviation rows and leave the freight ones null', async () => {
    const { models } = makeModels([consignment(100, '111', FLIGHT, '214')]);
    const rows = [
      invoice(1, { SEJobId: 9 }),
      invoice(2, { charges: [{ AviationConsignmentId: 100 }] }),
      invoice(3, { SEJobId: 11 }),
    ];
    await attachAviationContext(rows, models);
    expect(rows.map((r) => r.dataValues.aviation?.jobNo ?? null))
      .toEqual([null, 'IFA-AVJ-3/26', null]);
  });
});

describe('degenerate input', () => {
  test('an invoice with no job and no aviation charges gets null', async () => {
    const { models, calls } = makeModels();
    const inv = invoice(1, { charges: [{ AviationConsignmentId: null }] });
    await attachAviationContext([inv], models);
    expect(inv.dataValues.aviation).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('a consignment whose flight is missing does not throw', async () => {
    const { models } = makeModels([consignment(100, '111', null, '214')]);
    const inv = invoice(1, { charges: [{ AviationConsignmentId: 100 }] });
    await attachAviationContext([inv], models);
    expect(inv.dataValues.aviation).toBeNull();
  });

  test('an empty list is returned as-is', async () => {
    const { models } = makeModels();
    await expect(attachAviationContext([], models)).resolves.toEqual([]);
  });

  test('a non-array is tolerated', async () => {
    const { models } = makeModels();
    await expect(attachAviationContext(null, models)).resolves.toEqual([]);
  });
});
