/**
 * Building a charge row on an aviation AWB.
 *
 * The rule that matters here is that an AUTOMATIC Air Freight row and one
 * somebody picks by hand are the same row. They are built by one function for
 * exactly that reason, and these tests pin the parts that would otherwise
 * drift silently: which master is recognised as Air Freight, what the two rows
 * are priced at, and what un-approving takes away.
 */
import {
  blankCharge, chargeMasterPatch,
  findAirFreight, isAirFreightRow, airFreightRows,
  withoutAirFreight, hasAirFreight, invoicedAirFreight, airFreightOn,
  repriceAirFreight, repriceForAwb, repriceAll,
  sellingLocked, buyingLocked, lockingInvoice, isAwbRateField,
} from 'functions/aviationChargeRow';
import { RECEIVABLE, PAYABLE, PER_SHIPMENT, PER_UNIT } from 'functions/aviationPricing';

// An AWB priced at 1.70 a kilo out and 1.40 in, on 100 kg that flew.
const LINE = {
  chargeableWeight: 100,
  sellingRate: 1.7,
  buyingRate: 1.4,
  sellingExRate: 280,
  buyingExRate: 279,
  AviationCarrierId: 3,
  masterAgentId: 55,
  shipperId: 66,
};

const AF = {
  id: 9, name: 'Air Freight', short: 'AF', currency: 'USD',
  calculationType: 'Per Unit',
  defaultRecivableParty: '', defaultPaybleParty: '',
  taxApply: 'No', taxPerc: '', fixAmount: 0,
};

// The carrier's party, and the billable party list it has to be found in.
const VALUES = {
  charge: [{ id: 1, name: 'Handling', short: 'HND' }, AF],
  carrier: [{ id: 3, name: 'PIA', prefix: '214', partyId: 77 }],
  party: [{ id: 77, name: 'PIA (12)' }, { id: 55, name: 'Agent (13)' }],
};

describe('finding the Air Freight charge', () => {
  test('by short name, whatever the spacing or case', () => {
    expect(findAirFreight([{ id: 4, short: ' af ' }])).toMatchObject({ id: 4 });
    expect(findAirFreight([{ id: 4, short: 'AF' }])).toMatchObject({ id: 4 });
  });

  test('falls back to the full name', () => {
    // An install that filled in the name and left the short name as something
    // else still works.
    expect(findAirFreight([{ id: 5, short: 'FRT', name: 'air freight' }])).toMatchObject({ id: 5 });
  });

  test('short name WINS over a name match', () => {
    const found = findAirFreight([
      { id: 5, short: 'FRT', name: 'Air Freight' },
      { id: 6, short: 'AF', name: 'Freight' },
    ]);
    expect(found.id).toBe(6);
  });

  test('null when there is none, rather than guessing', () => {
    // Approval reports this rather than quietly raising nothing.
    expect(findAirFreight([{ id: 1, short: 'HND', name: 'Handling' }])).toBeNull();
    expect(findAirFreight([])).toBeNull();
    expect(findAirFreight(undefined)).toBeNull();
  });
});

describe('the pair an approved AWB raises', () => {
  const rows = airFreightRows(LINE, VALUES);
  const rec = rows.find((r) => r.type === RECEIVABLE);
  const pay = rows.find((r) => r.type === PAYABLE);

  test('is one receivable and one payable', () => {
    expect(rows).toHaveLength(2);
    expect(rec).toBeDefined();
    expect(pay).toBeDefined();
  });

  test('is priced off the AWB: chargeable weight at each side rate', () => {
    expect(rec.qty).toBe(100);
    expect(Number(rec.rate_charge)).toBe(1.7);
    expect(rec.net_amount).toBeCloseTo(170, 6);

    expect(Number(pay.rate_charge)).toBe(1.4);
    expect(pay.net_amount).toBeCloseTo(140, 6);
  });

  test('converts each side at its OWN ex-rate', () => {
    // The space was bought and sold on different days; one figure for both
    // moves the reported margin by the difference between them.
    expect(Number(rec.ex_rate)).toBe(280);
    expect(Number(pay.ex_rate)).toBe(279);
    expect(rec.local_amount).toBeCloseTo(170 * 280, 4);
  });

  test('names the charge, so an invoice prints it', () => {
    expect(rec.charge).toBe(9);
    expect(rec.particular).toBe('Air Freight');
    expect(rec.currency).toBe('USD');
  });

  test('the payable falls to the carrier - the airline sold the space', () => {
    expect(pay.partyId).toBe(77);
    expect(pay.partyType).toBe('Carrier');
  });

  test('the receivable gets no party: who is billed varies line to line', () => {
    expect(rec.partyId).toBeNull();
  });

  test('starts unapproved and uninvoiced - both are deliberate acts', () => {
    expect(rec.status).toBe('0');
    expect(rec.InvoiceId).toBeNull();
  });

  test('nothing at all when Air Freight is not registered', () => {
    expect(airFreightRows(LINE, { ...VALUES, charge: [] })).toEqual([]);
  });

  test('an AWB with no weight or rates still gives two rows worth nought', () => {
    // The charge is raised and corrected; refusing to raise it because a rate
    // is not typed yet would put the work back where it started.
    const bare = airFreightRows({}, VALUES);
    expect(bare).toHaveLength(2);
    expect(bare[0].net_amount).toBe(0);
  });
});

describe("the registered charge's own settings reach the rows", () => {
  test("a registered role decides the receivable's party", () => {
    const rows = airFreightRows(LINE, {
      ...VALUES,
      charge: [{ ...AF, defaultRecivableParty: 'Master Agent' }],
    });
    const rec = rows.find((r) => r.type === RECEIVABLE);
    expect(rec.partyId).toBe(55);
    expect(rec.partyType).toBe('Master Agent');
  });

  test('a registered role OVERRIDES the carrier default on the payable', () => {
    const rows = airFreightRows(LINE, {
      ...VALUES,
      charge: [{ ...AF, defaultPaybleParty: 'Shipper' }],
    });
    expect(rows.find((r) => r.type === PAYABLE).partyId).toBe(66);
  });

  test('tax comes from the charge, and Yes is a STRING there', () => {
    const rows = airFreightRows(LINE, {
      ...VALUES,
      charge: [{ ...AF, taxApply: 'Yes', taxPerc: '17' }],
    });
    const rec = rows.find((r) => r.type === RECEIVABLE);
    expect(rec.tax_apply).toBe(true);
    expect(rec.taxPerc).toBe(17);
    expect(rec.net_amount).toBeCloseTo(170 * 1.17, 6);
    expect(rec.tax_amount).toBeCloseTo(28.9, 6);
  });

  test('a fixed amount overrides the rate the AWB would have priced it at', () => {
    const rows = airFreightRows(LINE, { ...VALUES, charge: [{ ...AF, fixAmount: 2.5 }] });
    expect(Number(rows[0].rate_charge)).toBe(2.5);
    expect(rows[0].net_amount).toBeCloseTo(250, 6);
  });

  test('a Per Shipment Air Freight charge is a fee, counted once', () => {
    const rows = airFreightRows(LINE, {
      ...VALUES,
      charge: [{ ...AF, calculationType: PER_SHIPMENT, fixAmount: 500 }],
    });
    expect(rows[0].basis).toBe(PER_SHIPMENT);
    // qty is the AWB's weight, and on a Per Shipment row that is a COUNT - so
    // this is the one combination worth reading twice. 100 x 500 is what the
    // charge master asked for; the row is editable if that is not meant.
    expect(rows[0].net_amount).toBeCloseTo(100 * 500, 6);
  });
});

describe('taking the pair back off', () => {
  const af = AF;
  const other = { id: 1, charge: '1', type: RECEIVABLE };
  // `charge` arrives from the server as a STRING - see functions/chargeIds.
  const afRow = { id: 2, charge: '9', type: RECEIVABLE };
  const afBilled = { id: 3, charge: 9, type: PAYABLE, InvoiceId: 4, invoice_id: 'JB-1', Invoice: { approved: '1' } };

  test('recognises its rows however the id is typed', () => {
    expect(isAirFreightRow(afRow, af)).toBe(true);
    expect(isAirFreightRow(afBilled, af)).toBe(true);
    expect(isAirFreightRow(other, af)).toBe(false);
    expect(isAirFreightRow(afRow, null)).toBe(false);
  });

  test('removes only the Air Freight rows', () => {
    expect(withoutAirFreight([other, afRow], af)).toEqual([other]);
  });

  test('an EDITED Air Freight row still goes - it is still that charge', () => {
    const edited = { ...afRow, rate_charge: 99, description: 'negotiated' };
    expect(withoutAirFreight([other, edited], af)).toEqual([other]);
  });

  test('a row on an invoice is reported, so unapproving is refused', () => {
    // Its id is what puts it on the invoice. Delete it and the document has no
    // lines; raise a fresh one and that one points nowhere.
    expect(invoicedAirFreight([other, afBilled], af)).toEqual([afBilled]);
    expect(invoicedAirFreight([other, afRow], af)).toEqual([]);
  });

  test('an UNAPPROVED invoice counts too - that is the whole workflow', () => {
    // "Unapprove the invoice, fix the rate, re-approve" is the correction
    // path, and it works only because the charge STAYS on its invoice.
    // Deleting it there would empty the document being corrected.
    //
    // It would not even delete cleanly: saveCharges only destroys rows with no
    // invoice, so this one survives at the old figures and re-approving adds a
    // second pair beside it.
    const reopened = { ...afBilled, Invoice: { approved: '0' } };
    expect(invoicedAirFreight([reopened], af)).toEqual([reopened]);
    expect(airFreightOn([reopened], af)).toEqual([reopened]);
  });

  test('hasAirFreight stops approval doubling the charge', () => {
    expect(hasAirFreight([other], af)).toBe(false);
    expect(hasAirFreight([other, afRow], af)).toBe(true);
  });
});

describe('chargeMasterPatch', () => {
  test('clearing the charge clears its name too', () => {
    expect(chargeMasterPatch(null, LINE, VALUES, true)).toEqual({ charge: null, particular: null });
  });

  test('a charge with NO registered roles fills in no party', () => {
    // Both are optional. An absent role must fill in nothing rather than
    // something wrong - see models/Charges.js.
    const patch = chargeMasterPatch(AF, LINE, VALUES, true);
    expect(patch).not.toHaveProperty('partyId');
    expect(patch).not.toHaveProperty('partyType');
  });

  test('an unrecognised role fills in nothing either', () => {
    // A charge carrying a FREIGHT party type reaches the aviation screen on a
    // shared masters table; it must not resolve to a party that is not on the
    // AWB at all.
    const patch = chargeMasterPatch(
      { ...AF, defaultRecivableParty: 'Custom-Agent' }, LINE, VALUES, true
    );
    expect(patch).not.toHaveProperty('partyId');
  });

  test('a zero fixed amount is ignored, not applied as a waiver', () => {
    expect(chargeMasterPatch(AF, LINE, VALUES, true)).not.toHaveProperty('rate_charge');
  });
});

describe('blankCharge', () => {
  test('a payable pre-fills the party it was given', () => {
    const row = blankCharge(PAYABLE, 100, 1.4, 279, { partyId: 77, name: 'PIA', partyType: 'Carrier' });
    expect(row).toMatchObject({ type: PAYABLE, partyId: 77, partyType: 'Carrier', qty: 100 });
  });

  test('starts untaxed', () => {
    expect(blankCharge(RECEIVABLE).tax_apply).toBe(false);
  });
});

describe('re-approving reprices rather than raising a second pair', () => {
  const af = { id: 9, name: 'Air Freight', short: 'AF' };
  const CORRECTED = { ...LINE, sellingRate: 2.2, buyingRate: 1.9, chargeableWeight: 120 };

  // As it comes back from the server: on an invoice that has been unapproved,
  // which is the middle of the correction workflow.
  const onInvoice = {
    id: 41, charge: '9', type: RECEIVABLE, basis: PER_UNIT,
    qty: 100, rate_charge: 1.7, ex_rate: 280,
    InvoiceId: 7, invoice_id: 'JI-1', Invoice: { approved: '0' },
  };

  test('the row keeps its ID, which is what keeps it on the invoice', () => {
    const [row] = repriceAirFreight([onInvoice], CORRECTED, af);
    expect(row.id).toBe(41);
    expect(row.InvoiceId).toBe(7);
  });

  test('and takes the rate and weight it is being corrected to', () => {
    const [row] = repriceAirFreight([onInvoice], CORRECTED, af);
    expect(row.qty).toBe(120);
    expect(Number(row.rate_charge)).toBe(2.2);
    expect(row.net_amount).toBeCloseTo(120 * 2.2, 6);
  });

  test('a row frozen by an APPROVED invoice is left exactly as it is', () => {
    // An issued document; the server refuses to rewrite it anyway.
    const frozen = { ...onInvoice, Invoice: { approved: '1' } };
    expect(repriceAirFreight([frozen], CORRECTED, af)[0]).toBe(frozen);
  });

  test('other charges on the AWB are not touched', () => {
    const handling = { id: 42, charge: '1', type: RECEIVABLE, qty: 1, rate_charge: 50 };
    expect(repriceAirFreight([handling], CORRECTED, af)[0]).toBe(handling);
  });
});

describe('an AWB rate reaching the charges it governs', () => {
  const rec = { id: 1, type: RECEIVABLE, basis: PER_UNIT, qty: 100, rate_charge: 1.7, ex_rate: 280 };
  const pay = { id: 2, type: PAYABLE, basis: PER_UNIT, qty: 100, rate_charge: 1.4, ex_rate: 279 };
  const RAISED = { ...LINE, sellingRate: 2 };

  test('the four rate fields are recognised and nothing else is', () => {
    expect(isAwbRateField('sellingRate')).toBe(true);
    expect(isAwbRateField('buyingExRate')).toBe(true);
    expect(isAwbRateField('chargeableWeight')).toBe(false);
    expect(isAwbRateField('remarks')).toBe(false);
  });

  test('a selling rate moves the receivable and leaves the payable alone', () => {
    const [r, p] = repriceForAwb([rec, pay], RAISED, 'sellingRate');
    expect(Number(r.rate_charge)).toBe(2);
    expect(r.net_amount).toBeCloseTo(200, 6);
    expect(p).toBe(pay);
  });

  test('a PER SHIPMENT fee is not repriced - it is not a per-kg rate', () => {
    // Pushing 2.00 a kilo into a 750 handling fee would silently reprice it.
    const fee = { id: 3, type: RECEIVABLE, basis: PER_SHIPMENT, qty: 1, rate_charge: 750 };
    expect(repriceForAwb([fee], RAISED, 'sellingRate')[0]).toBe(fee);
  });

  test('...but its EX-RATE still follows the AWB - a fee converts like anything', () => {
    const fee = {
      id: 3, type: RECEIVABLE, basis: PER_SHIPMENT, qty: 1, rate_charge: 750, ex_rate: 280,
    };
    const [out] = repriceForAwb([fee], { ...LINE, sellingExRate: 300 }, 'sellingExRate');
    expect(Number(out.ex_rate)).toBe(300);
    expect(out.local_amount).toBeCloseTo(750 * 300, 4);
  });

  test('a row on an APPROVED invoice is never repriced', () => {
    const frozen = { ...rec, InvoiceId: 7, Invoice: { approved: '1' } };
    expect(repriceForAwb([frozen], RAISED, 'sellingRate')[0]).toBe(frozen);
  });

  test('a row on an UNAPPROVED invoice IS repriced - that is what it is for', () => {
    const reopened = { ...rec, InvoiceId: 7, Invoice: { approved: '0' } };
    expect(Number(repriceForAwb([reopened], RAISED, 'sellingRate')[0].rate_charge)).toBe(2);
  });

  test('repriceAll recomputes both sides, for a weight change', () => {
    // Chargeable weight prices both sides at once, so there is nothing to
    // split - every charge on the AWB follows it.
    const [r, p] = repriceAll([rec, pay], LINE);
    expect(r.net_amount).toBeCloseTo(170, 6);
    expect(p.net_amount).toBeCloseTo(140, 6);
  });

  test('repriceAll still skips an issued document', () => {
    const frozen = { ...rec, InvoiceId: 7, Invoice: { approved: '1' } };
    expect(repriceAll([frozen], LINE)[0]).toBe(frozen);
  });
});

describe('which side an invoice freezes', () => {
  const billedRec = {
    type: RECEIVABLE, InvoiceId: 7, invoice_id: 'JI-1', Invoice: { approved: '1' },
  };
  const billedPay = {
    type: PAYABLE, InvoiceId: 8, invoice_id: 'JB-1', Invoice: { approved: '1' },
  };
  const openRec = { type: RECEIVABLE };

  test('a receivable invoice shuts SELLING and leaves buying open', () => {
    // The difference between correcting one document and disturbing two: the
    // bill to the airline contains none of the figures being changed.
    expect(sellingLocked([billedRec])).toBe(true);
    expect(buyingLocked([billedRec])).toBe(false);
  });

  test('a payable bill shuts BUYING and leaves selling open', () => {
    expect(buyingLocked([billedPay])).toBe(true);
    expect(sellingLocked([billedPay])).toBe(false);
  });

  test('both invoiced shuts both', () => {
    expect(sellingLocked([billedRec, billedPay])).toBe(true);
    expect(buyingLocked([billedRec, billedPay])).toBe(true);
  });

  test('an UNAPPROVED invoice shuts nothing', () => {
    // It has been taken out of the books precisely so its figures can be
    // corrected; refusing the correction would make unapproving pointless.
    const reopened = { type: RECEIVABLE, InvoiceId: 7, Invoice: { approved: '0' } };
    expect(sellingLocked([reopened])).toBe(false);
  });

  test('names the document that shut it, so the message can say which', () => {
    expect(lockingInvoice([openRec, billedRec], RECEIVABLE).invoice_id).toBe('JI-1');
    expect(lockingInvoice([openRec], RECEIVABLE)).toBeNull();
  });
});
