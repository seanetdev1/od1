/**
 * A Bill of Lading or Air Waybill printed from a Word template (the user's
 * request, 2026-11-01): the values are worked out with the built-in B/L
 * print's own helpers, from the same screen values - functions/blTemplateFields.
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import {
  blTemplateFields, blDocument, blDocumentType, BL_CATALOGUE, AWB_CATALOGUE, BILL_OF_LADING, AIR_WAYBILL,
} from 'functions/blTemplateFields';
import { INVOICE_CATALOGUE } from 'functions/invoiceTemplateFields';
import { pTagsToString, freightTerms, freightPayableAt, stampsOfGroup } from 'functions/blPrintText';

const p = (...lines) => lines.map((l) => `<p>${l}</p>`).join('');
const NOW = new Date(2026, 10, 1, 16, 38, 21);

const seaValues = {
  operation: 'SE', jobNo: 'SNS-SE-425/26', hbl: 'SNSL/KHI/0425', hblDate: '2026-10-24', mbl: 'MAEU263512345',
  vessel: 'MAERSK KENSINGTON', voyage: '612W', polTwo: 'PKKHI', podTwo: 'AEJEA', poDeliveryTwo: 'AEJEA',
  freightType: '2', issuePlace: 'KARACHI', issueDate: '2026-10-25', noBls: 'THREE (3)',
  formE: '12345', formEDate: '2026-10-20', net: '9800', cbm: '28', pkgs: '500', unit: 'CTNS',
  Container_Infos: [{ gross: '4968' }, { gross: '4968' }],
  stamps: [{ code: '1', stamp_group: '1' }, { code: '4', stamp_group: '4' }],
};
const seaState = {
  shipperContent: p('ABC TEXTILES (PVT) LTD', 'PLOT 12, SITE AREA, KARACHI', 'TEL null'),
  consigneeContent: p('TO ORDER'),
  notifyOneContent: p('XYZ IMPORTS LLC'),
  notifyTwoContent: p('null'),
  marksContent: p('ABC/DXB'),
  marksContentTwo: p('CTN 1-500'),
  descOfGoodsContent: p('COTTON YARN'),
  descOfGoodsContentTwo: p('HS CODE 5205.12'),
  Container_Infos: [
    { no: 'MSKU1234565', size: "40'HC", seal: 'ML-1', pkgs: '250', unit: 'CTNS', gross: '4968', cbm: '14' },
    { no: 'MSKU7654321', size: "40'HC", seal: 'ML-2', pkgs: '250', unit: 'CTNS', gross: '4968', cbm: '14' },
  ],
};
const company = { title: 'SEANET SHIPPING & LOGISTICS', address: 'KARACHI', phone: '021-35870000' };
const sea = (over = {}) => blTemplateFields({ values: seaValues, state: seaState, company, now: NOW, ...over });

describe('a Bill of Lading', () => {
  test('prints what the built-in B/L prints, as text', () => {
    const f = sea();
    expect(f).toMatchObject({
      documentType: BILL_OF_LADING,
      companyName: 'SEANET SHIPPING & LOGISTICS',
      blNo: 'SNSL/KHI/0425', blDate: '24/Oct/2026', jobNo: 'SNS-SE-425/26', mblNo: 'MAEU263512345',
      // The party boxes: a "TEL null" line is what an empty phone leaves.
      shipper: 'ABC TEXTILES (PVT) LTD\nPLOT 12, SITE AREA, KARACHI',
      notifyParty2: '',
      vesselVoyage: 'MAERSK KENSINGTON 612W',
      portOfLoading: 'KARACHI, PAKISTAN',
      // Every container's gross, as the print adds it up - not the first's.
      grossWeight: '9936.000 KGS', netWeight: '9800.000 KGS', cbm: '28.000 CBM',
      totalPackages: '500 CTNS',
      freightTerms: 'FREIGHT PREPAID', freightPayableAt: 'KARACHI, PAKISTAN',
      issueDateAndPlace: '25/Oct/2026 | KARACHI',
      formENo: '12345', formEDate: '20/Oct/2026',
      stamps1: 'SHIP ON BOARD', stamps4: 'SAID TO CONTAIN',
      containerNos: 'MSKU1234565, MSKU7654321', containerCount: '2',
      copyName: 'ORIGINAL', isOriginal: true, isPrepaid: true, isExport: true,
      hasNotifyParty2: false, hasFormE: true, hasContainers: true,
      printedOn: '01/11/2026 16:38:21',
    });
    // The B/L's own boxes. The second ones are the attach sheet's, which
    // prints after the template's B/L - they were joined on here, and no
    // attach sheet ever printed (2026-11-20). A template can still name them.
    expect(f.marks).toBe('ABC/DXB');
    expect(f.description).toBe('COTTON YARN');
    expect(f.attachMarks).toBe('CTN 1-500');
    expect(f.attachDescription).toBe('HS CODE 5205.12');
    expect(f.hasAttachSheet).toBe(true);
    expect(f.containers[1]).toEqual({
      sr: '2', no: 'MSKU7654321', size: "40'HC", seal: 'ML-2', packages: '250 CTNS',
      grossWeight: '4968.000 KGS', netWeight: '', cbm: '14.000 CBM',
    });
  });

  test("Stamps' Leave off boxes leave the same things off", () => {
    const f = sea({ options: { hideCbm: true, hideGrossWeight: true, hideNetWeight: true, hideContainers: true, hideFormE: true } });
    expect(f).toMatchObject({
      cbm: '', grossWeight: '', netWeight: '', formENo: '', formEDate: '',
      containers: [], containerNos: '', hasContainers: false, hasFormE: false,
      showCbm: false, showGrossWeight: false, showNetWeight: false, showContainers: false,
    });
  });

  test('freight collect is payable at destination', () => {
    const f = sea({ values: { ...seaValues, freightType: '1' } });
    expect([f.freightTerms, f.freightPayableAt, f.isCollect]).toEqual(['FREIGHT COLLECT', 'DESTINATION', true]);
  });

  test('every copy under Copies is a set of values, in order, as one document', () => {
    const doc = blDocument({ values: seaValues, state: seaState, company, copies: ['original', 'original', 'nonNegotiable'] })(NOW);
    expect(doc.docs.map((d) => [d.copyName, d.copyNo, d.isNonNegotiable])).toEqual([
      ['ORIGINAL', '1', false], ['ORIGINAL', '2', false], ['NON-NEGOTIABLE', '3', true],
    ]);
    expect(doc.fileName).toBe('SNSL/KHI/0425 Bill of Lading');
    expect(doc.what).toBe('B/L');
    // None set: one Original.
    expect(blDocument({ values: seaValues, state: seaState })(NOW).docs).toHaveLength(1);
  });
});

describe('an Air Waybill', () => {
  const airValues = {
    operation: 'AE', jobNo: 'SNS-AE-112/26', hbl: 'SNSA-0112', mbl: '176-12345675', polTwo: 'KHI', podTwo: 'DXB',
    toOne: 'DXB', byFirstCarrier: 'EK', currency: 'USD', charges: 'PP', wtValPPC: 'X', declareCarriage: 'NVD',
    air_line: 'EMIRATES', flightNo: 'EK-601', date1: '2026-10-25', issuePlace: 'KARACHI', issueDate: '2026-10-24',
    ppWeightCharges: 1250, ccWeightCharges: 0, ppTotal: '1420', freightType: '2',
  };
  const airState = {
    shipperContent: p('ABC GARMENTS'),
    descOfGoodsContent: p('READYMADE GARMENTS'),
    Item_Details: [
      { noOfPcs: '20', grossWt: '300.5', kh_lb: 'K', r_class: 'Q', chargableWt: '320', rate_charge: '2.78', total: '889.6' },
      { noOfPcs: '5', grossWt: '112', kh_lb: 'K', r_class: 'Q', chargableWt: '130', rate_charge: '0', total: '0' },
    ],
    Dimensions: [
      { length: '60', width: '40', height: '40', qty: '25', vol: '2.4', weight: '0' },
      // The empty row the screen starts with.
      { length: '0', width: '0', height: '0', qty: '0', vol: '0', weight: '0' },
    ],
  };
  const f = blTemplateFields({ values: airValues, state: airState, company, now: NOW });

  test('is the document of an air job', () => {
    expect(blDocumentType('AE')).toBe(AIR_WAYBILL);
    expect(blDocumentType('AI')).toBe(AIR_WAYBILL);
    expect(blDocumentType('SE')).toBe(BILL_OF_LADING);
    expect(f.documentType).toBe(AIR_WAYBILL);
    expect(blDocument({ values: airValues, state: airState })(NOW).what).toBe('air waybill');
  });

  test('prints its own boxes - numbers, airports by name, routing, values', () => {
    expect(f).toMatchObject({
      mawbNo: '176-12345675', hawbNo: 'SNSA-0112', airline: 'EMIRATES', flightNo: 'EK-601', flightDate1: '25/Oct/2026',
      routingTo1: 'DXB', routingBy1: 'EK', currency: 'USD', chargesCode: 'PP', wtValPrepaid: 'X', declaredValueCarriage: 'NVD',
      executedOn: '24/Oct/2026', executedAt: 'KARACHI',
    });
    // An airport by its name, not the sea ports' list.
    expect(f.airportOfDeparture).toMatch(/Karachi/);
    expect(f.airportOfDestination).toMatch(/Dubai/);
  });

  test('its items and dimensions, added up; an empty dimension row is left out', () => {
    expect(f.items[0]).toEqual({
      sr: '1', pieces: '20', grossWeight: '300.5', kgLb: 'K', rateClass: 'Q', commodityItemNo: '',
      chargeableWeight: '320', rate: '2.78', total: '889.60',
    });
    expect([f.items[1].rate, f.items[1].total]).toEqual(['', '']);
    expect([f.totalPieces, f.totalItemsGrossWeight, f.totalChargeableWeight, f.totalItemsCharge]).toEqual(['25', '412.5', '450', '889.60']);
    expect(f.dimensions).toHaveLength(1);
    expect([f.dimensionsText, f.totalVolume, f.hasDimensions]).toEqual(['60 x 40 x 40 x 25', '2.4', true]);
  });

  test('a charge box is empty when nothing is charged, as on a paper AWB', () => {
    expect([f.weightChargePrepaid, f.weightChargeCollect, f.totalPrepaid, f.totalCollect]).toEqual(['1,250.00', '', '1,420.00', '']);
  });
});

describe('the shared helpers - the built-in print uses them too', () => {
  test('party boxes, freight, stamps', () => {
    expect(pTagsToString(p('A', 'null', 'TEL', 'TEL null', ' B '))).toBe('A\nB');
    expect([freightTerms('2'), freightTerms('1'), freightTerms('prepaid'), freightTerms(undefined)]).toEqual(['PREPAID', 'COLLECT', 'PREPAID', '']);
    expect([freightPayableAt('Prepaid'), freightPayableAt('')]).toEqual(['KARACHI, PAKISTAN', 'DESTINATION']);
    expect(stampsOfGroup([{ code: '1', stamp_group: '1' }, { code: '2', stamp_group: '2' }], 1, [{ label: 'X' }, { label: 'Y' }])).toEqual(['X']);
  });
});

/* THE EXAMPLES the Configuration screen offers use only names it lists - a
 * name it does not would print nothing and warn on upload. */
const namesIn = async (file) => {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, '..', 'public', 'printing-templates', file)));
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|footer\d*|header\d*)\.xml$/.test(n));
  const textOf = await Promise.all(parts.map((n) => zip.file(n).async('string')));
  const tree = {};
  const stack = [tree];
  textOf.join('').replace(/<[^>]+>/g, '').replace(/\{([#/]?)([A-Za-z0-9]+)\}/g, (_, mark, name) => {
    const here = stack[stack.length - 1];
    if (mark === '#') { here[name] = here[name] || {}; stack.push(here[name]); }
    else if (mark === '/') stack.pop();
    else here[name] = here[name] || {};
    return '';
  });
  return tree;
};

test.each([
  ['bill-of-lading.docx', BL_CATALOGUE],
  ['air-waybill.docx', AWB_CATALOGUE],
  ['ho-enterprises-invoice.docx', INVOICE_CATALOGUE],
  ['sales-tax-invoice.docx', INVOICE_CATALOGUE],
])('the example %s uses only names the screen lists', async (file, catalogue) => {
  const tree = await namesIn(file);
  expect(Object.keys(tree).length).toBeGreaterThan(10);
  expect(catalogue.unknownNames(tree)).toEqual([]);
});
