/**
 * The BL print (BlPrintImage) - blank paper (borders: the form image behind
 * the values) and pre-printed paper (values only).
 *
 *   - On blank paper every value starts where its heading does (measured off
 *     /OriginalBl.jpg; values sit in a box 3mm in); pre-printed paper keeps
 *     its positions.
 *   - Except the ports and Vessel and Voy: centred in their boxes, on both.
 *   - Container no, size and seal on one line - the heading too.
 *   - Port names stay on one line in their box, shrinking to fit.
 *   - The package count ends at the Marks column's right border, clear of the
 *     marks.
 *   - Stamp group 4 above the description on both papers, at 3mm.
 *   - A | between the container number and its size and seal, on both.
 */
import React from 'react';
import { render } from '@testing-library/react';
import BlPrintImage, { PREPRINTED_PAGE } from '../Components/Layouts/JobsLayout/BlComp/BlPrintImage';
import moment from 'moment';
import { fitFontMm } from 'functions/fitText';

jest.mock('../Components/Layouts/JobsLayout/BlComp/states', () => ({
  cleanNullParagraphs: (x) => x,
  formatPortForPrint: (p) => p?.name || '',
}));

const para = (t) => `<p>${t}</p>`;
const state = {
  shipperContent: para('GETZ PHARMA (PVT) LTD'),
  consigneeContent: para('TO ORDER'),
  notifyOneContent: para('SAME AS CONSIGNEE'),
  deliveryContent: para('AGENT AT DESTINATION'),
  marksContent: para('ARTICLE NUMBER :'), noOfPckgs: para('1066 ctns'), descOfGoodsContent: para('01x40HC FCL CONTAINER'),
  Container_Infos: [{ no: 'ECMU5181038', size: '40HC', seal: 'R9408733' }],
};
const allValues = {
  jobNo: 'SNS-SEJ-385/27', hbl: 'SNSL5906', freightType: '2', cbm: '1', net: '1', noBls: '3',
  vessel: 'MSC VANESSA', por: 'Karachi, Pakistan', polTwo: 'Karachi, Pakistan',
  podTwo: 'Muhammad Bin Qasim/Karachi, Pakistan', poDeliveryTwo: 'Muhammad Bin Qasim/Karachi, Pakistan',
  stamps: [{ stamp_group: '4', code: '1' }],
};
const stamps = [{ label: 'SHIPPED ON BOARD' }];

const printed = (borders) => render(
  <BlPrintImage borders={borders} state={state} allValues={allValues} stamps={stamps} inputRef={{ current: null }} />,
);
const spanWith = (text) => [...document.querySelectorAll('span')].find((s) => s.textContent === text);
const leftOf = (text) => spanWith(text).style.left;
// The middle column: Stamp No 4, Stamp No 5, then the description, as one block.
const middle = () => document.querySelector('[data-middle]');
const descOf = () => document.querySelector('[data-desc]');

describe('BL print', () => {
  test('on blank paper every value starts at its heading', () => {
    printed(true);
    for (const t of ['GETZ PHARMA (PVT) LTD', 'TO ORDER', 'SAME AS CONSIGNEE', 'ARTICLE NUMBER :']) expect(leftOf(t)).toBe('8.3mm');
    expect(leftOf('AGENT AT DESTINATION')).toBe('10.4mm');
    expect(middle().style.left).toBe('65.1mm');
    expect(descOf().textContent).toBe('01x40HC FCL CONTAINER');
    expect(leftOf('3')).toBe('98.6mm');                       // Number of Original Bills
    // Freight payable at - prepaid prints KARACHI, PAKISTAN, after the two ports.
    const payable = [...document.querySelectorAll('span')].filter((s) => s.textContent === 'KARACHI, PAKISTAN').pop();
    expect(payable.style.left).toBe('98.8mm');
  });

  /* PRE-PRINTED PAPER IS THE SAME SEANET FORM, on 8.5 x 12in stock - not A4
   * (the user's test prints and measurement, 2026-10-14): the values at the
   * blank paper's positions, the page exactly the stock's size with no margin
   * so nothing scales it, and the printer's offset and scale moving them all.
   * It had positions of its own, 3mm left of the headings and lower, on a 216mm
   * page with 10mm margins - printed shrunk onto the headings. */
  test("pre-printed paper takes the form's own positions", () => {
    printed(false);
    for (const t of ['GETZ PHARMA (PVT) LTD', 'TO ORDER', 'SAME AS CONSIGNEE']) expect(leftOf(t)).toBe('8.3mm');
    expect(leftOf('AGENT AT DESTINATION')).toBe('10.4mm');
    expect(middle().style.left).toBe('65.1mm');
  });

  test("pre-printed paper prints at the stock's own size, 8.5 x 12in, with no margin", () => {
    expect(PREPRINTED_PAGE).toEqual({ width: 215.9, height: 304.8 });
    const { container } = printed(false);
    expect(container.querySelector('#bl-print-content').style.width).toBe('215.9mm');
    const css = container.querySelector('style').textContent;
    expect(css).toMatch(/size: 215\.9mm 304\.8mm;/);
    expect(css).toMatch(/margin: 0;/);
    // No taller than the sheet, or a blank one follows it.
    expect(parseFloat(container.querySelector('[data-page="bl"]').style.height)).toBeLessThan(304.8);
    // Blank paper is untouched.
    const blank = printed(true).container;
    expect(blank.querySelector('#bl-print-content').style.width).toBe('216.3mm');
    expect(blank.querySelector('style').textContent).toMatch(/size: A4 portrait;/);
  });

  /* The printer's offset and scale (Stamps' Adjust): millimetres on the paper,
   * the scale from the top left, for a driver that shrinks the page to its
   * printable area. Pre-printed only. */
  test("the printer's offset and scale move every value on pre-printed paper - and nothing on blank", () => {
    const values = (c) => c.querySelector('#bl-print-content [data-page="bl"] > div');
    const adjust = { x: -3.7, y: 2.7, scale: 102.3 };
    const moved = values(render(<BlPrintImage borders={false} state={state} allValues={allValues} stamps={stamps} inputRef={{ current: null }} offset={adjust} />).container);
    expect(parseFloat(moved.style.top)).toBeCloseTo(6.7, 6);
    expect(parseFloat(moved.style.left)).toBeCloseTo(-0.7, 6);
    expect(moved.style.transform).toBe('scale(1.023)');
    expect(moved.style.transformOrigin).toBe('0 0');

    const blank = values(render(<BlPrintImage borders state={state} allValues={allValues} stamps={stamps} inputRef={{ current: null }} offset={adjust} />).container);
    expect([blank.style.top, blank.style.left, blank.style.transform]).toEqual(['4mm', '3mm', '']);
  });

  // The box a value is centred in, in the values' coordinates (3mm in from the page).
  const box = (el) => [el.style.textAlign, el.style.left, el.style.width];
  const portBox = (text) => box(spanWith(text));
  const vesselBox = () => document.querySelector('[data-box="vessel"]');

  /* Left-aligned at their headings again (the user's request, 2026-10-14):
   * each heading's x less the 3mm inset, to 1mm clear of the next rule (74.8,
   * 137.3mm; the form ends at 204.6mm). */
  test('on blank paper the ports and the vessel start at their headings', () => {
    printed(true);
    expect(portBox('MUHAMMAD BIN QASIM/KARACHI, PAKISTAN')).toEqual(['left', '136.5mm', '64.1mm']);
    const receipts = [...document.querySelectorAll('span')].filter((s) => s.textContent === 'KARACHI, PAKISTAN');
    expect(box(receipts[0])).toEqual(['left', '74mm', '59.3mm']);
    expect(box(vesselBox())).toEqual(['left', '8.3mm', '62.5mm']);
  });

  test('pre-printed paper puts them in the same places', () => {
    printed(false);
    expect(portBox('MUHAMMAD BIN QASIM/KARACHI, PAKISTAN')).toEqual(['left', '136.5mm', '64.1mm']);
    expect(box(vesselBox())).toEqual(['left', '8.3mm', '62.5mm']);
  });

  test('vessel and voyage share one line, the voyage after a gap', () => {
    render(<BlPrintImage borders state={state} allValues={{ ...allValues, voyage: '612W' }} stamps={stamps} inputRef={{ current: null }} />);
    const vessel = vesselBox();
    expect(vessel.style.whiteSpace).toBe('nowrap');
    expect([...vessel.children].map((s) => s.textContent)).toEqual(['MSC VANESSA', '612W']);
    expect(vessel.children[1].style.marginLeft).toBe('4mm');
  });

  test.each([true, false])('a port name stays on one line in its box (borders %s)', (borders) => {
    printed(borders);
    const long = spanWith('MUHAMMAD BIN QASIM/KARACHI, PAKISTAN');
    expect(long.style.whiteSpace).toBe('nowrap');
    expect(parseFloat(long.style.fontSize)).toBeLessThan(3);
    // A short one prints at the full size.
    expect(spanWith('KARACHI, PAKISTAN').style.fontSize).toBe('3mm');
  });

  test('on blank paper the package count ends at the column border, clear of the marks', () => {
    printed(true);
    const count = spanWith('1066 ctns');
    expect(count.style.textAlign).toBe('right');
    expect(parseFloat(count.style.left) + parseFloat(count.style.width)).toBeCloseTo(54.6);   // 57.6mm on the page
  });

  /* The middle column is one block from the marks' first line (127mm): the
   * stamp, then the description straight under it (the user's request,
   * 2026-10-14 - they sat 2mm and 7mm lower, at fixed places). */
  test.each([true, false])('stamp group 4 prints above the description, at 3mm (borders %s)', (borders) => {
    printed(borders);
    const block = middle();
    expect(block.style.top).toBe('127mm');
    const stamp = block.querySelector('[data-stamp="4"]');
    expect(stamp.textContent).toBe('SHIPPED ON BOARD');
    expect(stamp.style.fontSize).toBe('3mm');
    // First in the block, the description after it.
    expect(block.firstElementChild).toBe(stamp);
    expect(block.lastElementChild).toBe(descOf());
    // Once only - not in the weight column as well.
    expect([...document.querySelectorAll('div, span')].filter((s) => s.textContent === 'SHIPPED ON BOARD')).toHaveLength(1);
  });

  test('with no stamp the description starts on the marks\' line', () => {
    render(<BlPrintImage borders state={state} allValues={{ ...allValues, stamps: [] }} stamps={stamps} inputRef={{ current: null }} />);
    expect(middle().firstElementChild).toBe(descOf());
    // The marks start on the same line.
    expect(spanWith('ARTICLE NUMBER :').style.top).toBe(middle().style.top);
  });

  test.each([true, false])('a | separates container no from size and seal (borders %s)', (borders) => {
    printed(borders);
    const row = [...document.querySelectorAll('div')].find((d) => d.textContent === 'ECMU5181038|40HCR9408733');
    expect(row).toBeTruthy();
    expect([...document.querySelectorAll('div')].some((d) => d.textContent === 'CONTAINER NO|SIZE SEAL')).toBe(true);
  });

  test.each([true, false])('"CONTAINER NO" stays on one line, as every container row does (borders %s)', (borders) => {
    printed(borders);
    const heading = [...document.querySelectorAll('div')].find((d) => d.textContent === 'CONTAINER NO|SIZE SEAL');
    expect(heading.style.whiteSpace).toBe('nowrap');
    expect(heading.firstChild.style.width).toBe('25mm');
    const row = [...document.querySelectorAll('div')].find((d) => d.textContent === 'ECMU5181038|40HCR9408733');
    expect(row.style.whiteSpace).toBe('nowrap');
  });
});

/* SNSL5927 (SNS-SEJ-383/27) as it reached Odyssey from Climax: 34 lines of
 * description in the one field. Climax printed it on the form plus an attach
 * sheet; it must not run down over the charges table. */
const SNSL5927 = [
  '01X40HC FCL CONTAINER', 'TOTAL (715) CARTONS', 'SALES TERMS CNF NEW YORK',
  'FI:NO.HMB-EXP-070290-23092026 DTD: 23-09-2026', 'Youth 55/45 Cttn/Poly 270-GSM Classic Fleece',
  'Crewneck Sweatshirt Knitted & Uncoated', 'PO#530858 STYLE #23154Y', 'Youth 65/35 Cttn/Poly Peach Fleece Color Block',
  'Crewneck Sweat Shirt Knitted & Uncoated.', 'PO#530985 STYLE #26145 YCR', 'Ladies 55/45 Cttn/Poly Stripe Sleeve Crewneck',
  'Sweatshirt Knitted & Uncoated', 'PO#531027 STYLE #W23152', 'Ladies 65/35 Cttn/Poly Colorblock Hooded Sweatshirt',
  'Knitted & Uncoated PO#531065 STYLE #W23716', 'Mens 60/40 Ctn/Poly Fundamental Fleece Full Zip',
  'Hoody Sweat Jacket Knitted & Uncoated', 'PO#531086 STYLE #20349', 'Youth 55/45 Cttn/Poly Classic Fleece Crewneck Sweatshirt',
  'Knitted & Uncoated PO#531088 STYLE #23154Y', 'Mens 65/35 Cttn/Poly Vintage Fleece SweatPant',
  'Knitted & Uncoated PO#531132 STYLE #22744', "Men's 65% Cotton 35% Poly Peach Fleece Raglan Crewneck",
  'Sweatshirt Knitted & Uncoated PO#531133 STYLE #17116', 'Mens 60% Organic Cttn 40% Recycled Poly Sustainable Jersey',
  'T-Shirt Knitted & Uncoated PO#531161 STYLE #21459', '2ND NOTIFY', 'AMM MERCHANDISING INC 356 MIDDLE COUNTRY',
  'RD, SUIT # 304 CORAM, NY 11727 USA', '3ND NOTIFY', 'AMM MERCHANDISING GENERAL TRADING LLC', '916 IT PLAZA,DUBAI SILICON OASIS-UAE',
];
const paras = (lines) => lines.map(para).join('');

describe('the attach sheet', () => {
  const sheet = () => document.querySelector('[data-page="attach"]');
  const continued = () => document.querySelector('[data-continued]');
  const descBox = () => document.querySelector('[data-desc]');
  const printWith = (extra, borders = true) => render(
    <BlPrintImage borders={borders} state={{ ...state, ...extra }} allValues={allValues} stamps={stamps} inputRef={{ current: null }} />,
  );

  test('a B/L that fits prints no attach sheet and no "continued"', () => {
    printed(true);
    expect(sheet()).toBeNull();
    expect(continued()).toBeNull();
  });

  test.each([true, false])('a long description fills the form, and the rest goes on the attach sheet (borders %s)', (borders) => {
    printWith({ descOfGoodsContent: paras(SNSL5927) }, borders);
    const onForm = descBox().textContent.split('\n');
    const onSheet = sheet().textContent;

    expect(onForm[0]).toBe('01X40HC FCL CONTAINER');
    expect(onForm.length).toBeLessThan(SNSL5927.length);
    // Every line once, in order: the form's, then the sheet's.
    const rest = SNSL5927.slice(onForm.length);
    expect(onForm).toEqual(SNSL5927.slice(0, onForm.length));
    expect(onSheet).toContain(rest.join('\n'));
    expect(onSheet).toContain('916 IT PLAZA,DUBAI SILICON OASIS-UAE');
    expect(continued().textContent).toBe('CONTINUED ON FOLLOWING PAGE');
  });

  test('the attach sheet is its own page, with the B/L number on it', () => {
    printWith({ descOfGoodsContent: paras(SNSL5927) });
    expect(sheet().style.pageBreakBefore).toBe('always');
    expect(sheet().textContent).toContain('ATTACH SHEET');
    expect(sheet().textContent).toContain('B/L NO : SNSL5906');
    // The B/L itself is still one page, before it.
    const page = document.querySelector('[data-page="bl"]');
    expect(page.style.height).toBe('305mm');
    expect(page.compareDocumentPosition(sheet()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the "continued" editors print on the attach sheet, after any overflow', () => {
    printWith({ marksContentTwo: para('CARTON NO. 1-715'), descOfGoodsContentTwo: para('HS CODE 6110.20') });
    expect(sheet().textContent).toContain('CARTON NO. 1-715');
    expect(sheet().textContent).toContain('HS CODE 6110.20');
    expect(continued()).not.toBeNull();
    // Not on the form as well.
    expect(descBox().textContent).toBe('01x40HC FCL CONTAINER');
  });

  test('a fifth container and on go on the attach sheet - they used to be dropped', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ no: `CONT000000${i + 1}`, size: '40HC', seal: `S${i + 1}` }));
    printWith({ Container_Infos: six });
    const page = document.querySelector('[data-page="bl"]');
    for (const n of [1, 2, 3, 4]) expect(page.textContent).toContain(`CONT000000${n}`);
    for (const n of [5, 6]) {
      expect(page.textContent).not.toContain(`CONT000000${n}`);
      expect(sheet().textContent).toContain(`CONT000000${n}|40HCS${n}`);
    }
  });
});

/* Climax's print options: "# of Original / Non-Negotiable copies", "Print
 * What", and the Hide boxes that had nothing to hide - Form E was never
 * printed, and container data printed whatever the box said. */
describe('print options', () => {
  const long = { descOfGoodsContent: paras(SNSL5927) };
  const printAs = (props, extra = long, values = allValues) => render(
    <BlPrintImage borders state={{ ...state, ...extra }} allValues={values} stamps={stamps} inputRef={{ current: null }} {...props} />,
  );
  const pages = () => [...document.querySelectorAll('[data-page]')]
    .map((p) => (p.dataset.page === 'bl' ? `bl:${p.dataset.copy}` : 'attach'));

  test('each copy prints on its own form, followed by its own attach sheet', () => {
    printAs({ copies: ['original', 'original', 'nonNegotiable'] });
    expect(pages()).toEqual(['bl:original', 'attach', 'bl:original', 'attach', 'bl:nonNegotiable', 'attach']);
    expect([...document.querySelectorAll('img[data-form]')].map((i) => i.getAttribute('src')))
      .toEqual(['/OriginalBl.jpg', '/OriginalBl.jpg', '/BLScan1.jpg']);
    // Every page after the first starts a new sheet.
    const all = [...document.querySelectorAll('[data-page]')];
    expect(all[0].style.pageBreakBefore).toBe('');
    for (const p of all.slice(1)) expect(p.style.pageBreakBefore).toBe('always');
  });

  test('B/L only leaves the attach sheets out', () => {
    printAs({ copies: ['original', 'nonNegotiable'], printWhat: 'bl' });
    expect(pages()).toEqual(['bl:original', 'bl:nonNegotiable']);
    // The form still says it continues: the attach sheet is printed separately.
    expect(document.querySelector('[data-continued]')).not.toBeNull();
  });

  test('attach sheets only - for after the B/L went through on pre-printed paper', () => {
    printAs({ printWhat: 'attach' });
    expect(pages()).toEqual(['attach']);
    expect(document.querySelector('[data-page="attach"]').style.pageBreakBefore).toBe('');
  });

  test('Form E prints at the foot of the consignee box, unless hidden', () => {
    const values = { ...allValues, formE: 'AHB-EXP-141303-03092026', formEDate: moment('2026-09-03') };
    printAs({}, {}, values);
    const line = document.querySelector('[data-form-e]');
    expect(line.textContent).toBe('FORM E NUMBER : AHB-EXP-141303-03092026DATE: 03/Sep/2026');
    expect(line.style.left).toBe('8.3mm');
    // Below the consignee, above the notify party.
    const top = parseFloat(line.style.top);
    expect(top).toBeGreaterThan(parseFloat(spanWith('TO ORDER').style.top));
    expect(top).toBeLessThan(parseFloat(spanWith('SAME AS CONSIGNEE').style.top));
  });

  test('Form E: hidden by the box, and absent when there is none', () => {
    printAs({ formE: true }, {}, { ...allValues, formE: 'AHB-EXP-141303-03092026' });
    expect(document.querySelector('[data-form-e]')).toBeNull();
    document.body.innerHTML = '';
    printAs({}, {}, { ...allValues, formE: 'null' });
    expect(document.querySelector('[data-form-e]')).toBeNull();
  });

  test('Hide Container Data takes the containers off the B/L and the attach sheet', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ no: `CONT000000${i + 1}`, size: '40HC', seal: `S${i + 1}` }));
    printAs({ containerData: true }, { Container_Infos: six });
    expect(document.body.textContent).not.toContain('CONT0000001');
    expect(document.body.textContent).not.toContain('CONTAINER NO');
    // The sixth container alone no longer needs an attach sheet.
    expect(document.querySelector('[data-page="attach"]')).toBeNull();
  });
});

describe('fitting a line by its font size', () => {
  test('full size when it fits, smaller when not, never below the floor', () => {
    expect(fitFontMm('KARACHI', 50)).toBe(3);
    const f = fitFontMm('MUHAMMAD BIN QASIM/KARACHI, PAKISTAN', 64.5);
    expect(f).toBeLessThan(3);
    expect(f).toBeGreaterThan(2.2);
    expect(fitFontMm('X'.repeat(200), 20)).toBe(2.2);
    expect(fitFontMm('', 20)).toBe(3);
  });
});

describe('the form behind the values, on blank paper', () => {
  const form = () => document.querySelector('img[data-form]');

  test('the Original, unless told otherwise', () => {
    printed(true);
    expect(form().getAttribute('src')).toBe('/OriginalBl.jpg');
    expect(form().style.width).toBe('215.9mm');
  });

  test('the Non-Negotiable scan, laid exactly over where the Original sits', () => {
    render(<BlPrintImage borders form='nonNegotiable' state={state} allValues={allValues} stamps={stamps} inputRef={{ current: null }} />);
    expect(form().getAttribute('src')).toBe('/BLScan1.jpg');
    expect(form().getAttribute('data-form')).toBe('nonNegotiable');
    expect([form().style.left, form().style.top, form().style.width, form().style.height])
      .toEqual(['2.287mm', '4.012mm', '213.934mm', '297.623mm']);
    // The values do not move - they are measured off the Original, which the scan now matches.
    expect(spanWith('GETZ PHARMA (PVT) LTD').style.left).toBe('8.3mm');
  });

  test('pre-printed paper prints no form at all, whichever is picked', () => {
    render(<BlPrintImage borders={false} form='nonNegotiable' state={state} allValues={allValues} stamps={stamps} inputRef={{ current: null }} />);
    expect(form().parentElement.style.display).toBe('none');
  });
});

/* THE GROSS WEIGHT - every container's, added up, as the B/L page totals it.
   It was the first container's alone: two boxes of 4,968 kg printed 4,968
   against the page's 9,936 (the user's report, 2026-10-13). */
describe('gross weight', () => {
  const { totalGross } = require('functions/blWeights');

  test('every container, a blank one as none', () => {
    expect(totalGross([{ gross: '4968' }, { gross: 4968 }, { gross: '' }, {}])).toBe(9936);
    expect(totalGross(undefined)).toBe(0);
  });

  test('printed as the total of the containers; net as the B/L says', () => {
    const boxes = [{ no: 'ECMU5181038', size: '40HC', gross: '4968' }, { no: 'ECMU5181039', size: '40HC', gross: '4968' }];
    const { container } = render(
      <BlPrintImage borders state={{ ...state, Container_Infos: boxes }}
        allValues={{ ...allValues, Container_Infos: boxes, net: '9114' }} stamps={stamps} inputRef={{ current: null }} />,
    );
    expect(container.textContent).toContain('9936.000 KGS');
    expect(container.textContent).not.toContain('4968.000 KGS');
    expect(container.textContent).toContain('9114.000 KGS');
  });

  /* A gross changed on Container Info and saved printed the old total: the
   * print read the form's copy of the containers, taken when the B/L opened,
   * not the containers on the screen (the user, 2026-11-04). */
  test('the containers as they stand now, not as the B/L opened with them', () => {
    const opened = [{ no: 'ECMU5181038', size: '40HC', gross: '4968' }];
    const edited = [{ no: 'ECMU5181038', size: '40HC', gross: '5100.5' }];
    const { container } = render(
      <BlPrintImage borders state={{ ...state, Container_Infos: edited }}
        allValues={{ ...allValues, Container_Infos: opened }} stamps={stamps} inputRef={{ current: null }} />,
    );
    expect(container.textContent).toContain('5100.500 KGS');
    expect(container.textContent).not.toContain('4968.000 KGS');
  });

  test("which containers: the screen's, the form's only where there is no screen state", () => {
    const { blContainers } = require('functions/blWeights');
    const now = [{ gross: '2' }];
    const then = [{ gross: '1' }];
    expect(blContainers({ Container_Infos: now }, { Container_Infos: then })).toBe(now);
    expect(blContainers({ Container_Infos: [] }, { Container_Infos: then })).toEqual([]);
    expect(blContainers(undefined, { Container_Infos: then })).toBe(then);
    expect(blContainers(undefined, undefined)).toEqual([]);
  });
});
