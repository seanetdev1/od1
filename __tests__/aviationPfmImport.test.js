/**
 * Building a flight from a PFM.
 *
 * The whole feature turns on one question - what is copied and what is not -
 * and the expensive half of the answer is the NOT. A weight that crossed over
 * by accident would arrive on the flight looking entered, so nobody would
 * weigh the cargo, and it would be invoiced off a figure an agent guessed at a
 * week earlier. These tests are what stops a later refactor from quietly
 * spreading the plan's line over the consignment and calling it tidier.
 */
import {
  plannedChargeable, pfmHeaderPatch, pfmLineToConsignment, pfmLinesToConsignments, realLineCount,
} from 'functions/aviationPfmImport';
import { isRealLine } from 'functions/aviationValidation';

// The flight grid's blank row, reduced to the fields these tests care about
// plus one the import never mentions - so "a field the grid adds later still
// arrives correct" is actually exercised rather than assumed.
const BLANK = {
  AviationCarrierId: null, AviationAwbId: null, awb: '',
  masterAgentId: null, destination: '', CommodityId: null,
  pieces: null, grossWeight: null, chargeableWeight: null,
  remarks: '',
  buyingExRate: 1, sellingExRate: 1, sellingRate: null, direct: false,
};

const line = (over = {}) => ({
  AviationCarrierId: 3,
  AviationAwbId: 77,
  awb: '10000018',
  masterAgentId: 12,
  destination: 'JED',
  CommodityId: 5,
  slCarrierId: 9,
  slFlightNo: 'EK-602',
  pieces: 40,
  grossWeight: 1200,
  chargeableWeight: 1250,
  loadPlan: 'Build up on two pallets, tail first',
  ...over,
});

const plan = (over = {}) => ({
  id: 4,
  pfmNo: 'IFA-PFM-4/26',
  flightNo: 'PK-301',
  operatingCarrierId: 2,
  AviationAircraftId: 6,
  origin: 'KHI',
  flightDate: '2026-09-30',
  status: 'Confirmed',
  remarks: 'Perishables on the forward hold',
  Aviation_Pfm_Lines: [line()],
  ...over,
});

describe('plannedChargeable - what lands in the flight PFM field', () => {
  test('totals the chargeable weights of every planned line', () => {
    const total = plannedChargeable(plan({
      Aviation_Pfm_Lines: [line({ chargeableWeight: 1250 }), line({ chargeableWeight: 800.5 })],
    }));
    expect(total).toBe(2050.5);
  });

  test('rounds once, at the end - these are sums of typed figures', () => {
    const total = plannedChargeable(plan({
      Aviation_Pfm_Lines: [
        line({ chargeableWeight: 0.1 }), line({ chargeableWeight: 0.2 }),
      ],
    }));
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point, and the
    // flight header would print it.
    expect(total).toBe(0.3);
  });

  test('a blank weight counts as nothing rather than poisoning the total', () => {
    expect(plannedChargeable(plan({
      Aviation_Pfm_Lines: [line({ chargeableWeight: null }), line({ chargeableWeight: 500 })],
    }))).toBe(500);
  });

  test('a plan with no lines totals 0, not null', () => {
    // 0 is honest: the plan says nothing is expected. null would read as "not
    // planned" on a field somebody did plan.
    expect(plannedChargeable(plan({ Aviation_Pfm_Lines: [] }))).toBe(0);
    expect(plannedChargeable(undefined)).toBe(0);
  });
});

describe('pfmHeaderPatch - what the flight header takes', () => {
  test('carries the link, the five shared facts and the planned weight', () => {
    expect(pfmHeaderPatch(plan(), {})).toEqual({
      AviationPfmId: 4,
      flightNo: 'PK-301',
      operatingCarrierId: 2,
      AviationAircraftId: 6,
      origin: 'KHI',
      flightDate: '2026-09-30',
      pfm: 1250,
      remarks: 'Perishables on the forward hold',
    });
  });

  test('does NOT bring the plan status, destination or document number across', () => {
    const patch = pfmHeaderPatch(plan(), {});
    // A flight's status is Operated/Canceled/... - a plan's is Draft/
    // Confirmed/Cancelled, and writing one into the other would put 'Confirmed'
    // in a column the reports branch on.
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('pfmNo');
    // The plan has no header destination at all - one departure, many
    // destinations - so the flight's must not be cleared by the import.
    expect(patch).not.toHaveProperty('destination');
  });

  test("fills the flight's remarks only when it has none", () => {
    expect(pfmHeaderPatch(plan(), { remarks: '' }).remarks).toBe('Perishables on the forward hold');
    expect(pfmHeaderPatch(plan(), { remarks: '   ' }).remarks).toBe('Perishables on the forward hold');
  });

  test('never overwrites remarks somebody typed on the flight', () => {
    // The one thing an import must not do. A gap is unhelpful; a replacement
    // destroys work and leaves no trace of what was there.
    const patch = pfmHeaderPatch(plan(), { remarks: 'ATD slipped, see ops log' });
    expect(patch).not.toHaveProperty('remarks');
  });

  test('a plan with no remarks leaves the field alone entirely', () => {
    expect(pfmHeaderPatch(plan({ remarks: '' }), { remarks: '' })).not.toHaveProperty('remarks');
  });

  test('nothing to import from nothing', () => {
    expect(pfmHeaderPatch(null, { flightNo: 'PK-301' })).toEqual({});
  });
});

describe('pfmLineToConsignment - what a planned line becomes', () => {
  const out = pfmLineToConsignment(line(), BLANK);

  test('carries carrier, AWB, agent, destination and commodity', () => {
    expect(out.AviationCarrierId).toBe(3);
    expect(out.awb).toBe('10000018');
    expect(out.masterAgentId).toBe(12);
    expect(out.destination).toBe('JED');
    expect(out.CommodityId).toBe(5);
  });

  test('carries the AWB STOCK ID, not just the digits', () => {
    // Without it every imported consignment would look like a number somebody
    // typed, and Setup > AWB Stock would never be claimed for a real flight.
    expect(out.AviationAwbId).toBe(77);
  });

  test('the Load Plan becomes the consignment remarks', () => {
    // The flight has nowhere else to put a loading instruction.
    expect(out.remarks).toBe('Build up on two pallets, tail first');
  });

  /* THE POINT OF THE WHOLE MODULE. */
  test('pieces and both weights are NOT imported', () => {
    expect(out.pieces).toBeNull();
    expect(out.grossWeight).toBeNull();
    expect(out.chargeableWeight).toBeNull();
  });

  test('the second leg does not reach the consignment', () => {
    // It has no column there and is not given one - the flight's View PFM
    // button is how the onward booking is read back.
    expect(out).not.toHaveProperty('slCarrierId');
    expect(out).not.toHaveProperty('slFlightNo');
  });

  test('fields the grid owns arrive at their blank defaults', () => {
    // Spreading the grid's own blank first means a column added to the flight
    // later is already correct here instead of silently missing.
    expect(out.sellingRate).toBeNull();
    expect(out.buyingExRate).toBe(1);
    expect(out.direct).toBe(false);
  });

  test('a planned line with nothing on it still produces a usable row', () => {
    const empty = pfmLineToConsignment({}, BLANK);
    expect(empty.awb).toBe('');
    expect(empty.destination).toBe('');
    expect(empty.AviationCarrierId).toBeNull();
  });
});

describe('pfmLinesToConsignments', () => {
  test('keeps the plan’s own order', () => {
    const rows = pfmLinesToConsignments(plan({
      Aviation_Pfm_Lines: [line({ awb: '10000018' }), line({ awb: '10000022' })],
    }), BLANK);
    expect(rows.map((r) => r.awb)).toEqual(['10000018', '10000022']);
  });

  test('a plan with no lines still gives the grid one blank row', () => {
    // The flight screen must never be a table with nothing to type into.
    const rows = pfmLinesToConsignments(plan({ Aviation_Pfm_Lines: [] }), BLANK);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(BLANK);
  });
});

describe('realLineCount - what a re-import would destroy', () => {
  test('counts rows the server would actually store', () => {
    const rows = [
      { ...BLANK, awb: '10000018' },
      { ...BLANK, masterAgentId: 12 },
      { ...BLANK },                       // an untouched "Add Consignment +"
    ];
    expect(realLineCount(rows, isRealLine)).toBe(2);
  });

  test('a grid of nothing but blanks counts as nothing to lose', () => {
    // So picking a PFM on a fresh flight imports without asking a question
    // whose honest answer is "there is nothing there".
    expect(realLineCount([{ ...BLANK }, { ...BLANK }], isRealLine)).toBe(0);
    expect(realLineCount(undefined, isRealLine)).toBe(0);
  });
});
