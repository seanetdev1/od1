/**
 * Aviation flights as Job Profit/Loss rows.
 *
 * Two things matter here beyond "it produces a row":
 *
 *   1. The row must be shaped EXACTLY like an SE_Job row, because the screen
 *      and the Excel export read several fields without guarding them
 *      (x.Client.name, x.shipper.name, x.local_vendor.name). A missing object
 *      is a crash in the export, not a blank cell.
 *
 *   2. Revenue must not be double counted. A shipment too big for one aircraft
 *      flies out over several legs that share an AWB and are billed on ONE
 *      invoice - charging its full total to every leg would report the same
 *      money twice.
 */
const {
  flightRow, aviationAppliesTo, oneOrMany,
  AVIATION_OPERATION, AVIATION_SUBTYPE,
} = require('../../functions/aviationJobPL');

const client = (name) => ({ name });

const charge = (invoice, local_amount) => ({ InvoiceId: invoice?.id, local_amount, Invoice: invoice });

const invoice = (id, o = {}) => ({
  id, total: '1000', payType: 'Recievable', recieved: '400', paid: '0',
  type: 'Job Invoice', status: '1', ex_rate: '1', currency: 'PKR',
  Invoice_Transactions: [], ...o,
});

const flight = (o = {}) => ({
  id: 7, jobNo: 'IFA-AVJ-1/27', createdAt: '2026-09-04T00:00:00.000Z',
  companyId: '1', exRate: '1', flightNo: 'ER-101',
  origin: 'LHE', destination: 'JED', flightDate: '2026-09-04',
  Aviation_Consignments: [], ...o,
});

describe('which filters aviation can answer', () => {
  test('an unfiltered report includes aviation', () => {
    expect(aviationAppliesTo({})).toBe(true);
  });

  test.each([
    ['a sales representative', { salesrepresentative: '3' }],
    ['an overseas agent', { overseasagent: '9' }],
  ])('%s excludes aviation entirely', (_label, filters) => {
    // A flight has neither. Returning flights anyway would put rows in a
    // report that do not meet the filter the user asked for.
    expect(aviationAppliesTo(filters)).toBe(false);
  });

  test('a job-type filter must actually include AV', () => {
    expect(aviationAppliesTo({ jobtype: 'SE,SI' })).toBe(false);
    expect(aviationAppliesTo({ jobtype: 'AE,AV' })).toBe(true);
    expect(aviationAppliesTo({ jobtype: ['AV'] })).toBe(true);
  });

  test('a sub-type filter must include AIR - a flight is air', () => {
    expect(aviationAppliesTo({ subtype: 'FCL,LCL' })).toBe(false);
    expect(aviationAppliesTo({ subtype: 'LCL,AIR' })).toBe(true);
  });

  test('empty filter strings mean "no filter", not "matches nothing"', () => {
    expect(aviationAppliesTo({ jobtype: '', subtype: '', client: '' })).toBe(true);
    expect(aviationAppliesTo({ jobtype: [], subtype: [] })).toBe(true);
    expect(aviationAppliesTo({ jobtype: ' , ' })).toBe(true);
  });

  test('a client filter does not exclude aviation - an AWB has a shipper', () => {
    expect(aviationAppliesTo({ client: '12' })).toBe(true);
  });
});

describe('naming a party a flight has many of', () => {
  test('one shipper is named', () => {
    expect(oneOrMany(['ACME Ltd'])).toBe('ACME Ltd');
    expect(oneOrMany(['ACME Ltd', 'ACME Ltd'])).toBe('ACME Ltd');
  });

  test('several are counted rather than one being picked', () => {
    // Picking the first would state, on an accounting report, that a flight
    // belonged to a client that only part of it did.
    expect(oneOrMany(['ACME Ltd', 'Zenith Co'])).toBe('Multiple (2)');
  });

  test('none is an empty string, never undefined', () => {
    expect(oneOrMany([])).toBe('');
    expect(oneOrMany([undefined, null, ''])).toBe('');
  });
});

describe('the row a flight produces', () => {
  const row = flightRow(flight({
    Aviation_Consignments: [
      {
        awb: '214-12345678', grossWeight: 520, volume: 3.2, pieces: 10,
        shipper: client('ACME Ltd'), consignee: client('Gulf Trading'),
        masterAgent: client('Falcon Agencies'), Commodity: { name: 'Textiles' },
        Charge_Heads: [charge(invoice(1, { total: '145600' }), '145600')],
      },
      {
        awb: '214-87654321', grossWeight: 200, volume: 1.1, pieces: 4,
        shipper: client('ACME Ltd'), consignee: client('Gulf Trading'),
        masterAgent: client('Falcon Agencies'), Commodity: { name: 'Textiles' },
        Charge_Heads: [charge(invoice(2, { total: '98000', payType: 'Payble' }), '98000')],
      },
    ],
  }));

  test('is tagged so the report filters can find it', () => {
    expect(row.operation).toBe(AVIATION_OPERATION);
    expect(row.subType).toBe(AVIATION_SUBTYPE);
    expect(row.jobType).toBe('Aviation');
  });

  test('carries the flight identity, not a consignment one', () => {
    expect(row.id).toBe(7);
    expect(row.jobNo).toBe('IFA-AVJ-1/27');
  });

  test('reports the FLIGHT date as its date', () => {
    // The report filters on the flight date, so the Date column has to show
    // the same thing - a flight entered in August for a September departure
    // belongs to September, and must not display August.
    expect(row.createdAt).toBe('2026-09-04');
  });

  test('totals weight, volume and pieces across every AWB', () => {
    expect(row.weight).toBe(720);
    expect(row.vol).toBeCloseTo(4.3, 6);
    expect(row.pcs).toBe(14);
  });

  test('describes the route in the sea columns the report already has', () => {
    expect(row.pol).toBe('LHE');
    expect(row.fd).toBe('JED');
  });

  test('puts the AWBs where the bill of lading goes, and the flight as the master', () => {
    expect(row.Bl.hbl).toBe('214-12345678, 214-87654321');
    expect(row.Bl.mbl).toBe('ER-101');
  });

  test('names the single shipper as the Client', () => {
    expect(row.Client).toEqual({ name: 'ACME Ltd' });
    expect(row.shipper).toEqual({ name: 'ACME Ltd' });
    expect(row.consignee).toEqual({ name: 'Gulf Trading' });
    expect(row.local_vendor).toEqual({ name: 'Falcon Agencies' });
  });

  test('supplies every association the report reads UNGUARDED', () => {
    // Report.js does x.Client.name, x.shipper.name and x.local_vendor.name
    // with no optional chaining - a missing object takes the Excel export down
    // rather than leaving a cell blank.
    for (const key of ['Client', 'shipper', 'consignee', 'local_vendor',
                       'overseas_agent', 'shipping_line', 'sales_representator',
                       'commodity', 'Bl']) {
      expect(row[key]).toBeInstanceOf(Object);
      expect(row[key]).not.toBeNull();
    }
    expect(Array.isArray(row.SE_Equipments)).toBe(true);
  });

  test('leaves the parties an airline does not have blank rather than absent', () => {
    expect(row.overseas_agent.name).toBe('');
    expect(row.shipping_line.name).toBe('');
    expect(row.sales_representator.name).toBe('');
  });

  test('collects each invoice once, whatever it is attached to', () => {
    expect(row.Invoices.map((i) => i.id).sort()).toEqual([1, 2]);
  });

  test('keeps payType, so revenue and cost stay on the right sides', () => {
    const byId = Object.fromEntries(row.Invoices.map((i) => [i.id, i]));
    expect(byId[1].payType).toBe('Recievable');
    expect(byId[2].payType).toBe('Payble');
  });
});

describe('a flight with several AWBs for different shippers', () => {
  const row = flightRow(flight({
    Aviation_Consignments: [
      { awb: 'A', shipper: client('ACME Ltd'), Charge_Heads: [] },
      { awb: 'B', shipper: client('Zenith Co'), Charge_Heads: [] },
    ],
  }));

  test('says so instead of naming one of them', () => {
    expect(row.Client.name).toBe('Multiple (2)');
  });
});

describe('one invoice covering several charges on one flight', () => {
  test('is counted once, at its full value', () => {
    const inv = invoice(1, { total: '5000' });
    const row = flightRow(flight({
      Aviation_Consignments: [{
        awb: 'A', shipper: client('ACME Ltd'),
        Charge_Heads: [charge(inv, '3000'), charge(inv, '2000')],
      }],
    }));
    expect(row.Invoices).toHaveLength(1);
    expect(Number(row.Invoices[0].total)).toBe(5000);
  });
});

describe('a split shipment billed on ONE invoice across two flights', () => {
  // 800 kg AWB: 400 kg on this flight, 400 kg on the next. Both legs share the
  // AWB, and the customer gets a single invoice for the lot.
  const inv = invoice(1, { total: '8000', recieved: '2000' });

  const legWithShare = (share) => flightRow(
    flight({
      Aviation_Consignments: [{
        awb: 'SPLIT', shipper: client('ACME Ltd'), Charge_Heads: [charge(inv, '4000')],
      }],
    }),
    { 1: share }
  );

  test('each leg reports only its own share', () => {
    expect(Number(legWithShare(0.5).Invoices[0].total)).toBe(4000);
  });

  test('the two legs together add up to the invoice, not to double it', () => {
    const a = Number(legWithShare(0.5).Invoices[0].total);
    const b = Number(legWithShare(0.5).Invoices[0].total);
    expect(a + b).toBe(8000);
  });

  test('receipts are apportioned the same way as the total', () => {
    expect(Number(legWithShare(0.5).Invoices[0].recieved)).toBe(1000);
  });

  test('an invoice sitting entirely on one flight keeps its exact total', () => {
    // The ordinary case must be exact, not merely approximately right.
    expect(Number(legWithShare(1).Invoices[0].total)).toBe(8000);
    expect(Number(legWithShare(1).Invoices[0].recieved)).toBe(2000);
  });

  test('an unlisted invoice defaults to the whole of itself', () => {
    const row = flightRow(flight({
      Aviation_Consignments: [{ awb: 'A', Charge_Heads: [charge(inv, '4000')] }],
    }), {});
    expect(Number(row.Invoices[0].total)).toBe(8000);
  });
});

describe('exchange gain and loss', () => {
  test('is apportioned with the invoice it was realised against', () => {
    const inv = invoice(1, {
      total: '8000',
      Invoice_Transactions: [{ gainLoss: '100' }, { gainLoss: '-40' }],
    });
    const row = flightRow(flight({
      Aviation_Consignments: [{ awb: 'A', Charge_Heads: [charge(inv, '4000')] }],
    }), { 1: 0.5 });

    expect(row.Invoices[0].Invoice_Transactions.map((t) => t.gainLoss)).toEqual([50, -20]);
  });

  test('an invoice with no transactions gets an empty list, not undefined', () => {
    const row = flightRow(flight({
      Aviation_Consignments: [{ awb: 'A', Charge_Heads: [charge(invoice(1), '1')] }],
    }));
    expect(row.Invoices[0].Invoice_Transactions).toEqual([]);
  });
});

describe('degenerate flights', () => {
  test('one with no consignments still produces a complete row', () => {
    const row = flightRow(flight());
    expect(row.Invoices).toEqual([]);
    expect(row.weight).toBe(0);
    expect(row.Client).toEqual({ name: '' });
    expect(row.Bl.hbl).toBe('');
  });

  test('a consignment with no charges contributes nothing but does not throw', () => {
    const row = flightRow(flight({ Aviation_Consignments: [{ awb: 'A' }] }));
    expect(row.Invoices).toEqual([]);
  });

  test('one with no flight date falls back to when it was recorded', () => {
    // Better a sensible period than a row that vanishes from every ranged
    // report along with its revenue.
    const row = flightRow(flight({ flightDate: null }));
    expect(row.createdAt).toBe('2026-09-04T00:00:00.000Z');
  });

  test('a charge with no invoice is ignored', () => {
    const row = flightRow(flight({
      Aviation_Consignments: [{ awb: 'A', Charge_Heads: [{ local_amount: '500' }] }],
    }));
    expect(row.Invoices).toEqual([]);
  });

  test('non-numeric weights count as zero rather than NaN', () => {
    const row = flightRow(flight({
      Aviation_Consignments: [{ grossWeight: null, volume: undefined, pieces: 'x' }],
    }));
    expect([row.weight, row.vol, row.pcs]).toEqual([0, 0, 0]);
  });
});
