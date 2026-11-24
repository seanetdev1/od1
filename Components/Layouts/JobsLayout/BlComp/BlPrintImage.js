import React from "react";
import ReactToPrint from "react-to-print";
import { PrinterOutlined } from "@ant-design/icons";
import parse from "html-react-parser";
import moment from "moment";
import { fitFontMm } from 'functions/fitText';
import { fitLines, uniformFontMm } from 'functions/blAttachSheet';
import { totalGross, blContainers } from 'functions/blWeights';
// What it prints, as text - shared with a B/L printed from a Word template.
import { pTagsToString, htmlLines, blPortName as portName, freightTerms, freightPayableAt, stampsOfGroup } from 'functions/blPrintText';

/* ON BLANK PAPER every value starts where its heading does. Measured off
 * /OriginalBl.jpg (1275px = 215.9mm); the values sit in a box 3mm in, so each
 * is its heading's x less 3mm:
 *   Shipper, Consignee, Notify, Vessel   11.3mm   Initial Place of Receipt,
 *   For Delivery Please Apply to         13.4mm     Port of Loading     77.0mm
 *   Number and kind of Packages          68.1mm   Port of Discharge,
 *   Freight payable at                  101.8mm     Place of Delivery  139.5mm
 *   Number of Original Bills            101.6mm   Date and Place      154.9mm
 *   As agent or on behalf of Carrier    134.8mm
 * EXCEPT the four ports and Vessel and Voy, which are centred in their boxes
 * - see `boxes` below.
 *
 * Marks run down the left column's edge (11.3mm, with Shipper and Vessel) -
 * not under the centred "Marks and Nos;" - so the package count, set to end
 * at the column's right border (58.1mm), has a clear gap after them.
 *
 * PRE-PRINTED PAPER IS THE SAME FORM - the SEANET stock is printed from this
 * artwork - so it takes the same positions. The stock is NOT A4: it is 8.5 x 12
 * inches, 215.9 x 304.8mm (the user measured it, 2026-10-14: 4mm wider and 7mm
 * longer than A4), the artwork's own proportions. So its page is exactly that
 * size, with no margin, and the browser has nothing to shrink - see
 * PREPRINTED_PAGE. The printer's own offset and scale are set on the print
 * screen (Adjust) - see `offset` below. */
const AT = {
  blank: {
    party: '8.3mm',
    marks: '8.3mm', marksWidth: '32mm', desc: '65.1mm', descWidth: '75mm',
    delivery: '10.4mm', payable: '98.8mm', issue: '151.9mm', originals: '98.6mm', agent: '131.8mm',
  },
};

/* The pre-printed stock: 8.5 x 12in. The layout is measured on the form drawn
 * at exactly this width, so it prints at 100%. Exported for the test. */
export const PREPRINTED_PAGE = { width: 215.9, height: 304.8 };

/* THE ATTACH SHEET. The marks and description boxes hold what fits (45mm and
 * 65mm: 12 and 18 lines - functions/blAttachSheet); the rest, then anything
 * typed in the two "continued" editors, then every container after the four
 * the form has room for, go on an attach sheet after the B/L - as Climax
 * printed it. Before, a long description ran down over the charges table and
 * a fifth container was never printed at all.
 *
 * Exported for the print options, which offer "attach sheets only" only when
 * there is one. */
// The party boxes' room on the form - their spans below.
const PARTY_BOXES = [
  { field: 'shipperContent', widthMm: 93, heightMm: 23 },
  { field: 'consigneeContent', widthMm: 93, heightMm: 23 },
  { field: 'notifyOneContent', widthMm: 93, heightMm: 20 },
  { field: 'deliveryContent', widthMm: 85, heightMm: 24 },
];

export function attachSheetOf(state, borders, { hideContainers = false, fromTemplate = false } = {}) {
  /* AFTER A WORD TEMPLATE'S B/L (Stamps, 2026-11-20): the template prints the
   * B/L's own boxes and the containers in its own layout, so the sheet is the
   * two "Attach sheet" editors and nothing else - see functions/
   * blTemplateFields. */
  if (fromTemplate) {
    const sheet = { marks: htmlLines(state?.marksContentTwo), desc: htmlLines(state?.descOfGoodsContentTwo), containers: [] };
    return { fontMm: 3, marks: [], desc: [], containers: [], sheet, hasSheet: sheet.marks.length > 0 || sheet.desc.length > 0 };
  }
  const at = AT.blank;
  // ONE SIZE for every big box: the largest at which all the party boxes fit
  // (functions/blAttachSheet uniformFontMm); the marks and description fit
  // their lines at it.
  const fontMm = uniformFontMm(PARTY_BOXES.map((b) => ({ ...b, lines: htmlLines(state?.[b.field]) })));
  const marks = fitLines(htmlLines(state?.marksContent), { widthMm: parseFloat(at.marksWidth), heightMm: 45, fontMm });
  const desc = fitLines(htmlLines(state?.descOfGoodsContent), { widthMm: parseFloat(at.descWidth), heightMm: 65, fontMm });
  const containers = hideContainers ? [] : (state?.Container_Infos || []);
  const sheet = {
    marks: [...marks.rest, ...htmlLines(state?.marksContentTwo)],
    desc: [...desc.rest, ...htmlLines(state?.descOfGoodsContentTwo)],
    containers: containers.slice(4),
  };
  return {
    fontMm,
    marks: marks.fits,
    desc: desc.fits,
    containers: containers.slice(0, 4),
    sheet,
    hasSheet: sheet.marks.length > 0 || sheet.desc.length > 0 || sheet.containers.length > 0,
  };
}

const BlPrintImage = ({
    allValues,
    state,
    borders,
    heading,
    border,
    inputRef,
    stamps,
    line,
    grossWeight,
    netWeight,
    // The print options' "Hide" boxes: true leaves it off the print.
    containerData,
    formE,
    cbm,
    caller,
    // On blank paper, which form is printed behind the values - see BL_FORMS.
    form = 'original',
    // Climax's "# of Original / Non-Negotiable copies": the form of each copy,
    // in print order - ['original', 'original', 'nonNegotiable']. One copy on
    // `form` when not given.
    copies,
    // Climax's "Print What": 'both' (B/L & attach sheets), 'bl' or 'attach'.
    printWhat = 'both',
    // Pre-printed paper: the printer's own offset and scale (Stamps' Adjust) -
    // { x: right, y: down } in mm on the paper, and scale in % - for a driver
    // that feeds the sheet off true or shrinks the page to its printable area.
    offset = { x: 0, y: 0, scale: 100 },
    // Printing the attach sheet after a Word template's B/L - see attachSheetOf.
    fromTemplate = false,
    // The Print button's words - "Print attach sheet" beside a template's own.
    printLabel = 'Print',
}) => {
const shift = borders
  ? { x: 0, y: 0, scale: 1 }
  : {
      // Millimetres on the paper - the page is drawn at the paper's size.
      x: Number(offset?.x) || 0,
      y: Number(offset?.y) || 0,
      scale: (Number(offset?.scale) || 100) / 100,
    };

// Every container's gross, as the B/L page totals it - it was the first
// container's alone (functions/blWeights). From the containers as they stand
// on the screen (state), as the page and this print's container rows read
// them: the form's copy is the one the B/L OPENED with and never follows an
// edit, so a changed gross, saved, still printed the old total (the user,
// 2026-11-04).
const gross_weight = totalGross(blContainers(state, allValues))
const at = AT.blank;
/* THE PORTS, AND VESSEL AND VOY, START AT THEIR HEADINGS - left-aligned, like
 * every other value (the user's request, 2026-10-14; they had been centred).
 * Each starts at its heading's x less the values' 3mm inset (11.3, 77.0 and
 * 139.5mm - see the table at the top) and runs to 1mm clear of the next rule:
 * the column rules are at 74.8 and 137.3mm and the form's lines end at
 * 204.6mm, measured off /OriginalBl.jpg. A name too long for its box shrinks to
 * fit on one line rather than wrap onto the heading below.
 *
 * The same on pre-printed paper - see AT. */
const boxes = {
  vessel: { left: 8.3, width: 62.5 },
  receipt: { left: 74.0, width: 59.3 },
  discharge: { left: 136.5, width: 64.1 },
};
// The gap between the vessel and its voyage, on their one line.
const VOY_GAP_MM = 4;
// The package count: up against the column's right border on blank paper.
const packagesBox = { left: '34.6mm', width: '20mm', textAlign: 'right' };
// One line each - "CONTAINER NO" broke over two at 21mm. 25mm holds the
// heading and an 11-character number in bold; nothing in that part of the form
// has a column line for the row to cross.
const containerRow = { display: 'flex', alignItems: 'baseline', lineHeight: 1.2, whiteSpace: 'nowrap' };
const containerNoCol = { width: '25mm', flex: 'none' };
const containerBar = { width: '3mm', flex: 'none', textAlign: 'center' };

/* THE FORM PRINTED BEHIND THE VALUES, on blank paper: the Original, or the
 * Non-Negotiable copy - a scan of the same form at another size and margin.
 *
 * Every position on this page is measured off /OriginalBl.jpg drawn 215.9mm
 * wide, so the Non-Negotiable scan is placed to lie exactly over it: fitted on
 * the form's own rules (the port rows, the charges table and its foot lines -
 * seven of them, within half a pixel) and checked on the two column rules it
 * was not fitted on (within 0.07mm). Its scale differs across and down by a
 * hair, so both sides are set. */
const BL_FORMS = {
  original: { src: '/OriginalBl.jpg', style: { left: '0mm', width: '215.9mm', height: 'auto' } },
  nonNegotiable: {
    src: '/BLScan1.jpg',
    style: { left: '2.287mm', top: '4.012mm', width: '213.934mm', height: '297.623mm' },
  },
};
const boxStyle = (top, box, text, reserveMm = 0) => ({
  position: 'absolute', zIndex: 1, top, left: `${box.left}mm`, width: `${box.width}mm`, height: '5mm',
  fontWeight: 'bold', whiteSpace: 'nowrap', textAlign: 'left',
  fontSize: `${fitFontMm(text, box.width - reserveMm)}mm`,
});
const vesselLine = [allValues.vessel, allValues.voyage].filter(Boolean).join(' ');

const split = attachSheetOf(state, borders, { hideContainers: containerData, fromTemplate });
// Every big box at the one size that fits them all - attachSheetOf.
const bigFont = `${split.fontMm}mm`;
const { sheet, hasSheet } = split;
const sheetHeading = { fontWeight: 'bold', textDecoration: 'underline', marginBottom: '3mm' };

/* THE PAGES, in print order: per copy, its B/L then its attach sheet - each
 * original carries its own. Every page after the first starts a new sheet. */
const pages = [];
(copies && copies.length ? copies : [form]).forEach((copyForm, n) => {
  if (printWhat !== 'attach') pages.push({ kind: 'bl', form: copyForm, key: `bl-${n}` });
  if (printWhat !== 'bl' && hasSheet) pages.push({ kind: 'attach', key: `attach-${n}` });
});
const pageBreak = (i) => (i > 0 ? { breakBefore: 'page', pageBreakBefore: 'always' } : {});

/* The attach sheet, laid out like Climax's. Plain paper either way - there is
 * no pre-printed attach sheet. In the flow, so a very long one carries on over
 * as many pages as it needs. */
const attachPage = (key, style) => (
  <div key={key} data-page='attach' style={{ padding: '14mm 14mm 10mm 14mm', boxSizing: 'border-box', fontSize: '3.2mm', lineHeight: 1.2, ...style }}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <div style={{ fontFamily: 'Impact, "Arial Narrow", sans-serif', fontSize: '13mm', lineHeight: 1, letterSpacing: '0.3mm' }}>ATTACH SHEET</div>
      <div style={{ fontWeight: 'bold' }}><span style={{ textDecoration: 'underline' }}>B/L NO :</span> {allValues.hbl}</div>
    </div>
    <div style={{ display: 'flex', marginTop: '14mm', gap: '10mm' }}>
      <div style={{ width: '58mm', flex: 'none' }}>
        <div style={sheetHeading}>MARKS &amp; CONTAINER NO.</div>
        <div style={{ whiteSpace: 'pre-line' }}>{sheet.marks.join('\n')}</div>
        {sheet.containers.length > 0 && (
          <div style={{ marginTop: '8mm', fontWeight: 'bold' }}>
            <div style={{ ...containerRow, textDecoration: 'underline', marginBottom: '2mm' }}>
              <span style={containerNoCol}>CONTAINER NO</span>
              <span style={containerBar}>|</span>
              <span>SIZE SEAL</span>
            </div>
            {sheet.containers.map((x, i) => (
              <div key={i} style={{ ...containerRow, marginTop: 2, marginBottom: 2 }}>
                <span style={containerNoCol}>{x.no}</span>
                <span style={containerBar}>|</span>
                <span style={{ width: '9mm', flex: 'none' }}>{x.size}</span>
                <span>{x.seal}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1 }}>
        <div style={sheetHeading}>DESCRIPTION</div>
        <div style={{ whiteSpace: 'pre-line' }}>{sheet.desc.join('\n')}</div>
      </div>
    </div>
  </div>
);

/* FORM E, on one line at the foot of the consignee box - where Climax's
 * template puts it: "FORM E NUMBER : <no>   DATE: <date>". Never printed here
 * before, so the "Hide Form E" box had nothing to hide. */
const formENo = String(allValues?.formE ?? '').trim();
const showFormE = !formE && formENo !== '' && formENo.toLowerCase() !== 'null';
const formEDate = allValues?.formEDate && moment(allValues.formEDate).isValid()
  ? moment(allValues.formEDate).format('DD/MMM/YYYY') : '';

// Safely pulls the labels for a given stamp_group, regardless of whether
// allValues.stamps is currently an array, undefined, or something else.
const getStamp = (group) => stampsOfGroup(allValues.stamps, group, stamps);

console.log(pTagsToString(state.notifyOneContent))


    console.log(state)
    console.log(allValues)
  return (
    <>
      {/* ✅ Print orientation control */}
      <style>
        {`
          @page {
            size: ${borders ? 'A4 portrait' : `${PREPRINTED_PAGE.width}mm ${PREPRINTED_PAGE.height}mm`};
            margin: ${borders ? '10mm' : '0'};
          }

          @media screen {
            #bl-print-content {
              display: none;
            }
          }

          @media print {
            #bl-print-content {
              display: block;
            }
            body {
              -webkit-print-color-adjust: exact;
            }
          }
        `}
      </style>

      {/* Print Button */}
      {caller === true && (
        <ReactToPrint
          trigger={() => (
            <button type="button" className="div-btn-custom" style={{ padding: '7px 22px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <PrinterOutlined /> {printLabel}
            </button>
          )}
          content={() => inputRef.current}
        />
      )}

      {/* Printable Area */}
      <div
        id="bl-print-content"
        ref={inputRef}
        style={{
          // Pre-printed: exactly the stock's width, on a page of the stock's
          // size with no margin, so the browser prints it at 100%. It was
          // 216.3mm on an A4 page with 10mm margins and printed shrunk to fit:
          // every value drifted up and left, the more the further down, onto
          // the form's headings.
          width: borders ? "216.3mm" : `${PREPRINTED_PAGE.width}mm`,
          backgroundColor: "white",
          fontFamily: "Times New Roman, serif",
          fontSize: "3mm",
          // In the flow, not absolute: the attach sheet below has to start
          // a new page, and a page break is only honoured in the flow.
          position: 'relative',
          // marginTop: '7mm',
          // border: '1px solid black'
        }}
      >
        {pages.map((p, i) => p.kind === 'attach' ? attachPage(p.key, pageBreak(i)) : (
        /* The B/L itself - one page, everything on it placed absolutely. */
        <div key={p.key} data-page='bl' data-copy={p.form} style={{ position: 'relative', height: borders ? '305mm' : `${PREPRINTED_PAGE.height - 0.8}mm`, overflow: borders ? undefined : 'hidden', ...pageBreak(i) }}>
        {/* Printed Values */}
        <div style={{
          zIndex: 1,
          position: 'absolute',
          top: `${4 + shift.y}mm`,
          left: `${3 + shift.x}mm`,
          // Grown from the top left to undo a driver's shrink-to-fit: the
          // test print of 2026-10-14 came out 2.1% short down the page and
          // 2.4% across, drifting further onto the headings the lower it got.
          ...(shift.scale !== 1 ? { transform: `scale(${shift.scale})`, transformOrigin: '0 0' } : {})
        }} zIndex={1}>
          {/*Shipper*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `17mm`, left: at.party, width: '93mm', height: '23mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', fontSize: bigFont }}>{pTagsToString(state.shipperContent)}</span>
          {/*Consignee*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `47mm`, left: at.party, width: '93mm', height: '23mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', fontSize: bigFont }}>{pTagsToString(state.consigneeContent)}</span>
          {/*Form E - at the consignee box's foot*/}
            {/* Clear of the rule under the box, and inside the column: 89mm to
                the logo box's rule, shrunk to fit like a long port name. */}
            {showFormE && (
              <span data-form-e style={{ position: 'absolute', zIndex: 1, top: `63.5mm`, left: at.party, width: '89mm', height: '4mm', fontWeight: 'bold', whiteSpace: 'nowrap',
                fontSize: `${fitFontMm(`FORM E NUMBER : ${formENo} DATE: ${formEDate}`, formEDate ? 85 : 89)}mm` }}>
                {`FORM E NUMBER : ${formENo}`}
                {formEDate && <span style={{ marginLeft: '4mm' }}>{`DATE: ${formEDate}`}</span>}
              </span>
            )}
          {/*Notify One*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `75mm`, left: at.party, width: '93mm', height: '20mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', fontSize: bigFont }}>{pTagsToString(state.notifyOneContent)}</span>
          {/*Job No*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `11mm`, left: '115mm', width: '35mm', height: '5mm', fontWeight: 'bold' }}>{allValues.jobNo}</span>
          {/*HBL No*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `11mm`, left: '163mm', width: '35mm', height: '5mm', fontWeight: 'bold' }}>{allValues.hbl}</span>
            {/* <span style={{ position: 'absolute', zIndex: 1, top: '112.5mm', left: '77mm', width: '55mm', height：'5mm', fontWeight: 'bold' }}>{(() => {
                const port = ports.ports.find((x) => x.id == allValues.por);
                return port ? `${port.name}` : allValues.por;
                })()}</span> */}
          {/*Initial Place of Reciept*/}
            {/* 1mm lower than it was, so it sits in the middle of the space under
                its heading - as the row below already did. */}
            <span style={boxStyle(`102mm`, boxes.receipt, portName(allValues.por))}>{portName(allValues.por)}</span>
            {/*Port of Discharge*/}
            <span style={boxStyle(`102mm`, boxes.discharge, portName(allValues.podTwo))}>{portName(allValues.podTwo)}</span>
            {/*Vessel and Voy - one line, centred in the box, the voyage after the vessel*/}
            <span data-box='vessel' style={boxStyle(`113mm`, boxes.vessel, vesselLine, VOY_GAP_MM)}>
              <span>{allValues.vessel}</span>
              {allValues.voyage && <span style={{ marginLeft: `${VOY_GAP_MM}mm` }}>{allValues.voyage}</span>}
            </span>
            {/*Port of Loading*/}
            <span style={boxStyle(`113mm`, boxes.receipt, portName(allValues.polTwo))}>{portName(allValues.polTwo)}</span>
            {/*Place of Delivery*/}
            <span style={boxStyle(`113mm`, boxes.discharge, portName(allValues.poDeliveryTwo))}>{portName(allValues.poDeliveryTwo)}</span>
            {/*CBM*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `127mm`, left: '182mm', width: '22mm', height: '5mm', fontWeight: 'bold' }}>{!cbm && `${parseFloat(allValues.cbm).toFixed(3)} CBM`}</span>
            {/*Marks and Nos;*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `127mm`, left: at.marks, width: at.marksWidth, height: '45mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', fontSize: bigFont }}>{split.marks.join('\n')}</span>
            {/*Container Nos;*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `127mm`, ...packagesBox, height: '45mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2' }}>{pTagsToString(state.noOfPckgs)}</span>
            {/*Container No | Size | Seal - unless "Hide Container Data"*/}
            {!containerData && (
            <span style={{ position: 'absolute', zIndex: 1, top: `173mm`, left: at.marks, width: '50mm', height: '30mm', fontWeight: 'bold' }}>
              {/* A | between the container number and its size and seal, on
                  both papers - heading and every row. */}
              <div style={containerRow}>
                <span style={containerNoCol}>CONTAINER NO</span>
                <span style={containerBar}>|</span>
                <span>SIZE SEAL</span>
              </div>
              {split.containers.map((x, i)=>{
                return(
                  <div key={i} style={{ ...containerRow, marginTop: 2, marginBottom: 2 }}>
                    <span style={containerNoCol}>{x.no}</span>
                    <span style={containerBar}>|</span>
                    <span style={{ width: '9mm', flex: 'none' }}>{x.size}</span>
                    <span>{x.seal}</span>
                  </div>
                )
              })}
              </span>
            )}
            {/*Stamp No 1*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `152mm`, left: '182mm', width: '20mm', height: '5mm', fontWeight: 'bold', fontSize: '4mm' }}>
              {getStamp("1").join(" ")}
            </span>
            {/*Stamp No 2*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `152mm`, left: '147mm', width: '20mm', height: '5mm', fontWeight: 'bold', fontSize: '4mm' }}>
              {getStamp("2").join(" ")}
              </span>
            {/* THE MIDDLE COLUMN, IN ONE BLOCK: Stamp No 4, Stamp No 5 (blank
                paper), then the description - each straight under the last,
                from the marks' and weights' first line (127mm). They sat at
                fixed places, the stamp 2mm and the description 7mm below that
                line, with a gap for a stamp that may not be there (the user's
                request, 2026-10-14). The description keeps its 65mm - see
                attachSheetOf. On blank paper Stamp No 4 once sat in the weight
                column, under the freight terms. */}
            <div data-middle style={{ position: 'absolute', zIndex: 1, top: `127mm`, left: at.desc, width: at.descWidth, fontWeight: 'bold' }}>
              {getStamp("4").filter(Boolean).length > 0 && (
                <div data-stamp='4' style={{ fontSize: '3mm', lineHeight: 1.2 }}>{getStamp("4").filter(Boolean).join(" ")}</div>
              )}
              {borders && getStamp("5").filter(Boolean).length > 0 && (
                <div data-stamp='5' style={{ fontSize: '4mm', lineHeight: 1.2 }}>{getStamp("5").filter(Boolean).join(" ")}</div>
              )}
              {/*Number and kind of Packages; Description of Goods*/}
              <div data-desc style={{ height: '65mm', whiteSpace: 'pre-line', lineHeight: '1.2', fontSize: bigFont }}>{split.desc.join('\n')}</div>
            </div>
            {/*As agent or on behalf of Carrier*/}
            {console.log("AllValues: ",allValues)}
            <span style={{ position: 'absolute', zIndex: 1, top: `279mm`, left: at.agent, width: '68mm', height: '15mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', fontSize: '4mm' }}>
              {borders && getStamp("5")}
            </span>
              {/*Gross Weight*/}
              <span style={{ position: 'absolute', zIndex: 1, top: `127mm`, left: '147mm', width: '30mm', height: '10mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2' }}>
                Gross Weight
                <br/>
                {!grossWeight && `${parseFloat(gross_weight).toFixed(3)} KGS`}
              </span>
              {/*Net Weight*/}
              <span style={{ position: 'absolute', zIndex: 1, top: `136mm`, left: '147mm', width: '30mm', height: '10mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2' }}>
                Net Weight
                <br/>
                {!netWeight && `${parseFloat(allValues.net).toFixed(3)} KGS`}
              </span>
              {/* Under the description, clear of "Above particulars" - where Climax put it. */}
              {hasSheet && (
                <span data-continued style={{ position: 'absolute', zIndex: 1, top: `200mm`, left: at.desc, width: at.descWidth, height: '5mm', fontWeight: 'bold', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  CONTINUED ON FOLLOWING PAGE
                </span>
              )}
              {/*Freight Perpaid / Collect*/}
              <span style={{ position: 'absolute', zIndex: 1, top: `166mm`, left: '145mm', width: '55mm', height: '22mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', textAlign: 'center' }}>
                <h6 style={{ margin: 0, padding: 0 }}><b>FREIGHT {freightTerms(allValues.freightType)}</b></h6>
              </span>
              <span style={{ position: 'absolute', zIndex: 1, top: `171mm`, left: '145mm', width: '55mm', height: '22mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', textAlign: 'center' }}>
                {"All Terminal charge/Demurrage\nEtc. at the port of discharge\nDestination as per Line's Tariff &\nAt the Account of Consignee"}
              </span>
              {/*For Delivery Please Apply to*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `261mm`, left: at.delivery, width: '85mm', height: '24mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2', fontSize: bigFont }}>{pTagsToString(state.deliveryContent)}</span>
              {/*Freight Payable At*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `261mm`, left: at.payable, width: '50mm', height: '9mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2' }}>{freightPayableAt(allValues.freightType)}</span>
              {/*Date and Place of Issue*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `261mm`, left: at.issue, width: '51mm', height: '9mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2' }}>
              {[
                allValues?.issueDate ? moment(allValues.issueDate).format('DD/MMM/YYYY') : null,
                allValues?.issuePlace || null
              ].filter(Boolean).join(' | ')}
            </span>
              {/*No of Original Bills of Lading*/}
            <span style={{ position: 'absolute', zIndex: 1, top: `279mm`, left: at.originals, width: '25mm', height: '10mm', fontWeight: 'bold', whiteSpace: 'pre-line', lineHeight: '1.2' }}>{allValues.noBls}</span>
        </div>
        {console.log("State in Print Image:", border)}
        <div style={{
            display: !borders ? "none" : "block",
          }}>
            <img style={{ position: 'absolute', ...(BL_FORMS[p.form] || BL_FORMS.original).style }} src={(BL_FORMS[p.form] || BL_FORMS.original).src} alt=''
              data-form={p.form === 'nonNegotiable' ? 'nonNegotiable' : 'original'} />
        </div>
        </div>
        ))}
      </div>
    </>
  );
};

export default BlPrintImage;
