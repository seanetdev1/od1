import React, { useRef, useEffect, useState, useReducer } from "react";
import { Col, Form, Row, Table } from "react-bootstrap";
import { Radio, InputNumber, Card, Checkbox, Tag } from "antd";
import { Modal } from "antd";
import { groups, stamps } from "./groupData";
import { CloseCircleOutlined, FileWordOutlined, LoadingOutlined, PrinterOutlined } from "@ant-design/icons";
import Cookies from "js-cookie";
 import SelectSearchComp from "../../../Shared/Form/SelectSearchComp";
import BlPrint from "./BlPrint";
import BlPrintImage, { attachSheetOf } from "./BlPrintImage";
import BlPrintModal from "./BlPrintModal";
import { readOffset, saveOffset, clampOffset } from 'functions/blPrintOffset';
import { usePrintingTemplate, usePreparedDocumentPdf, downloadDocumentWord } from 'functions/templatePrint';
import { blDocument, blDocumentType, AIR_WAYBILL } from 'functions/blTemplateFields';
import { getCompany } from 'functions/companyBranding';

const Stamps = ({ state, control, register, useWatch, handleSubmit, fields, append, remove, onDelete, errors, data, type }) => {
  let inputRef = useRef(null);
  const [borders, setBorders] = useState(true);
  // On blank paper, Climax's "# of Original / Non-Negotiable copies": each
  // copy prints on its own form, all in one go. Never both none. It
  // starts at 0 Original, 1 Non-Negotiable (the user, 2026-11-02).
  const [originals, setOriginals] = useState(0);
  const [nonNegotiable, setNonNegotiable] = useState(1);
  // Climax's "Print What": 'both' (B/L & attach sheets), 'bl' or 'attach'.
  const [printWhat, setPrintWhat] = useState('both');
  const [showModal, setShowModal] = useState(false);
  const allValues = useWatch({ control });
  const [value, setValue] = useState(2);
  /* PRE-PRINTED: THE PRINTER'S OFFSET. Every printer feeds a sheet a little
     differently, and the form is not always printed in exactly the same place
     on the stock - so the values can be moved as one, in mm, from a test
     print. Kept on this PC (the printer is this PC's), not on the B/L. */
  const [offset, setOffsetState] = useState(() => readOffset(typeof window === 'undefined' ? null : window.localStorage));
  const setOffset = (axis, v) => {
    const next = { ...offset, [axis]: clampOffset(axis, v) };
    setOffsetState(next);
    saveOffset(window.localStorage, next);
  };
  const [visibleStamps, setVisibleStamps] = useState(false);
  const [checkModal, setCheckModal] = useState(false);
  const [cbm, setCbm] = useState(false);
  const [grossWeight, setgrossWeight] = useState(false);
  const [netWeight, setNetWeight] = useState(false);
  const [containerData, setcontainerData] = useState(false);
  const [formE, setFormE] = useState(false);
 
  const onChange = (e) => {
    e.target.value == 2 ? setBorders(true) : setBorders(false);
    setValue(e.target.value);
  };
  const Stamp = useWatch({ control, name: "stamps" });
  const onSubmit = () => {
    setVisibleStamps(false);
  };

  // Pre-printed paper has no form to choose: one copy, on whatever is loaded.
  const copies = borders
    ? [...Array(originals).fill('original'), ...Array(nonNegotiable).fill('nonNegotiable')]
    : ['original'];
  const form = copies[0] || 'original';
  // "Attach sheets only" when there is one to print.
  const hasSheet = attachSheetOf(state, borders, { hideContainers: containerData }).hasSheet;
  const printing = printWhat === 'attach' && !hasSheet ? 'both' : printWhat;

  // What the Print button will produce, said before it is pressed.
  const blCount = printing === 'attach' ? 0 : copies.length;
  const sheetCount = printing !== 'bl' && hasSheet ? copies.length : 0;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const summary = [blCount && plural(blCount, 'B/L'), sheetCount && plural(sheetCount, 'attach sheet')].filter(Boolean).join(' + ');
  const copyNote = borders && copies.length > 1
    ? ` (${[originals && `${originals} Original`, nonNegotiable && `${nonNegotiable} Non-Negotiable`].filter(Boolean).join(', ')})`
    : '';
  /* THE B/L'S WORD TEMPLATE - Configuration > Printing Templates, the
     document "Bill of Lading" or, for an air job, "Air Waybill" (the user's
     request, 2026-11-01). The job's company's, else every company's; none,
     the built-in layout. With one, Print prints it - its PDF made while this
     tab is open, as an invoice's is - and the built-in layout is a switch
     away. Every copy under Copies prints once, as one PDF. */
  const job = data?.result;
  const docType = blDocumentType(type || allValues.operation);
  const isAir = docType === AIR_WAYBILL;
  const template = usePrintingTemplate(job?.companyId ?? null, job ? docType : null);
  const [layout, setLayout] = useState('template');
  const fromTemplate = Boolean(template) && layout === 'template';
  const templateCopies = [...Array(originals).fill('original'), ...Array(nonNegotiable).fill('nonNegotiable')];
  const documentOf = blDocument({
    values: { ...allValues, jobData: job },
    state,
    company: getCompany(job?.companyId),
    options: { hideCbm: cbm, hideGrossWeight: grossWeight, hideNetWeight: netWeight, hideContainers: containerData, hideFormE: formE },
    copies: templateCopies,
    printedBy: Cookies.get('username') || '',
  });
  const templatePdf = usePreparedDocumentPdf(template, documentOf, fromTemplate && String(state?.tabState) === '4');
  /* THE ATTACH SHEET WITH A TEMPLATE (the user, 2026-11-20: lost when the
     Word template came in). The template prints the B/L; the two "Attach
     sheet" boxes print on the built-in attach sheet - plain paper, as it
     always was - one per copy, from its own button. See attachSheetOf. */
  const templateSheet = attachSheetOf(state, true, { hideContainers: containerData, fromTemplate: true }).hasSheet;
  const templatePrinting = printWhat === 'attach' && !templateSheet ? 'both' : printWhat;
  const preparing = templatePdf.status === 'preparing';
  // Copies are set on blank paper, and for a template.
  const showCopies = borders || fromTemplate;
  const templateSummary = [
    templatePrinting !== 'attach' && `${plural(templateCopies.length, isAir ? 'air waybill' : 'B/L')}${templateCopies.length > 1
      ? ` (${[originals && `${originals} Original`, nonNegotiable && `${nonNegotiable} Non-Negotiable`].filter(Boolean).join(', ')})`
      : ''}`,
    templatePrinting !== 'bl' && templateSheet && plural(templateCopies.length, 'attach sheet'),
  ].filter(Boolean).join(' + ');
  // With a template, the choice is there only when an Attach sheet box has something.
  const showPrintWhat = !fromTemplate || templateSheet;
  const shownPrinting = fromTemplate ? templatePrinting : printing;
  const sheetAvailable = fromTemplate ? templateSheet : hasSheet;

  // The stamps on this B/L, by name.
  const stampLabels = (Array.isArray(Stamp) ? Stamp : [])
    .map((s) => stamps[Number(s?.code) - 1]?.label)
    .filter(Boolean);

  const label = { fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 };
  const section = { marginBottom: 18 };
  const hint = { fontSize: 12, color: '#6b7280', marginTop: 6 };
  const card = { flex: '1 1 360px', maxWidth: 560 };

  const border = !borders ? "1px solid silver" : "1px solid white";
  const line = borders ? "silver" : "white";
  const heading = borders ? "grey-txt" : "wh-txt";
  return (
  <div style={{ height: 600, overflowY: "auto", overflowX: "hidden", paddingTop: 4 }}>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <Card size="small" title="Print" style={card}>
        {template && (
          <div style={section}>
            <div style={label}>Layout</div>
            <Radio.Group onChange={(e) => setLayout(e.target.value)} value={layout} optionType="button" buttonStyle="solid" aria-label="Layout">
              <Radio value="template">Word template</Radio>
              <Radio value="builtIn">Built-in layout</Radio>
            </Radio.Group>
            {fromTemplate && (
              <div style={{ ...hint, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <FileWordOutlined style={{ color: '#2b579a', fontSize: 14 }} />
                <span style={{ color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }} title={template.fileName}>{template.fileName}</span>
                <span>·</span>
                <button type="button" onClick={() => downloadDocumentWord(template, documentOf())}
                  style={{ background: 'none', border: 0, padding: 0, color: '#1677ff', cursor: 'pointer', fontSize: 12 }}>
                  Download as Word
                </button>
              </div>
            )}
          </div>
        )}
        {!fromTemplate && (
        <div style={section}>
          <div style={label}>Paper</div>
          <Radio.Group onChange={onChange} value={value} optionType="button" buttonStyle="solid">
            <Radio value={2}>Blank paper</Radio>
            <Radio value={1}>Pre-printed form</Radio>
          </Radio.Group>
          <div style={hint}>
            {borders
              ? "The form prints with the B/L, on A4."
              : "Values only, onto the form loaded in the printer. The form is 8.5 x 12 in (216 x 305 mm), not A4 - choose that paper size in the print dialog (add it to the printer as a custom size if it is not listed)."}
          </div>
          {!borders && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }} aria-label="Adjust for this printer">
                <InputNumber addonBefore="Down" addonAfter="mm" min={-20} max={20} step={0.5} precision={1} value={offset.y}
                  style={{ width: 170 }} onChange={(v) => setOffset('y', v)} aria-label="Move down (mm)" />
                <InputNumber addonBefore="Right" addonAfter="mm" min={-20} max={20} step={0.5} precision={1} value={offset.x}
                  style={{ width: 170 }} onChange={(v) => setOffset('x', v)} aria-label="Move right (mm)" />
                <InputNumber addonBefore="Scale" addonAfter="%" min={90} max={110} step={0.1} precision={1} value={offset.scale}
                  style={{ width: 170 }} onChange={(v) => setOffset('scale', v)} aria-label="Scale (%)" />
              </div>
              <div style={hint}>
                For this printer, saved on this PC. Down / Right move every value (negative is up / left); Scale undoes a
                printer that shrinks the page to fit (values drifting up and left, more toward the bottom).
              </div>
            </div>
          )}
        </div>
        )}

        <div style={section}>
          <div style={label}>Copies</div>
          {showCopies ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }} aria-label="Copies to print">
              <InputNumber addonBefore="Original" min={nonNegotiable > 0 ? 0 : 1} max={9} precision={0} value={originals}
                style={{ width: 150 }} onChange={(v) => setOriginals(Math.max(nonNegotiable > 0 ? 0 : 1, Number(v) || 0))} />
              <InputNumber addonBefore="Non-Negotiable" min={originals > 0 ? 0 : 1} max={9} precision={0} value={nonNegotiable}
                style={{ width: 190 }} onChange={(v) => setNonNegotiable(Math.max(originals > 0 ? 0 : 1, Number(v) || 0))} />
            </div>
          ) : (
            <div style={{ fontSize: 13 }}>One, on whichever form is loaded.</div>
          )}
        </div>

        {showPrintWhat && (
        <div style={section}>
          <div style={label}>Print what</div>
          <Radio.Group onChange={(e) => setPrintWhat(e.target.value)} value={shownPrinting} optionType="button" buttonStyle="solid" aria-label="Print what">
            <Radio value="both">B/L &amp; attach sheets</Radio>
            <Radio value="bl">B/L only</Radio>
            <Radio value="attach" disabled={!sheetAvailable}>Attach sheets only</Radio>
          </Radio.Group>
          <div style={hint}>
            {fromTemplate
              ? "The B/L prints from the Word template; the Attach sheet boxes print on an attach sheet, on plain paper - each from its own button."
              : !hasSheet
                ? "Everything fits on the B/L - there is no attach sheet."
                : !borders && printing === 'both'
                  ? "The attach sheet prints on the next sheet in the tray - put plain paper behind the form, or print it separately."
                  : "What does not fit on the B/L continues on an attach sheet."}
          </div>
        </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
          <div style={{ fontSize: 13, color: '#374151' }}>{fromTemplate ? templateSummary : <>{summary}{copyNote}</>}</div>
          {fromTemplate ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              {templatePrinting !== 'attach' && (
                <button type="button" className="div-btn-custom" onClick={templatePdf.print} aria-busy={preparing}
                  style={{ padding: '7px 22px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  {preparing ? <><LoadingOutlined /> Preparing…</> : <><PrinterOutlined /> {templateSheet && templatePrinting === 'both' ? `Print ${isAir ? 'air waybill' : 'B/L'}` : 'Print'}</>}
                </button>
              )}
              {templatePrinting !== 'bl' && templateSheet && (
                <BlPrintImage caller={true} fromTemplate printLabel="Print attach sheet" state={state} allValues={{...allValues, jobData: data.result}}
                  border="1px solid white" line="silver" borders={true} heading="grey-txt" inputRef={inputRef} stamps={stamps}
                  cbm={cbm} grossWeight={grossWeight} netWeight={netWeight} containerData={containerData} formE={formE}
                  form="original" copies={templateCopies} printWhat="attach" offset={offset} />
              )}
            </div>
          ) : <BlPrintImage caller={true} state={state} allValues={{...allValues, jobData: data.result}} border={border} line={line} borders={borders} heading={heading} inputRef={inputRef} stamps={stamps} cbm={cbm} grossWeight={grossWeight} netWeight={netWeight}  containerData={containerData} formE={formE} form={form} copies={copies} printWhat={printing} offset={offset}/>}
        </div>
      </Card>

      <Card size="small" title="On the B/L" style={card}>
        <div style={section}>
          <div style={{ ...label, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Stamps</span>
            <button type="button" onClick={() => setVisibleStamps(true)} className="btn-custom" style={{ fontSize: 12, textTransform: "none", letterSpacing: 0 }}>
              Edit stamps
            </button>
          </div>
          {stampLabels.length
            ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{stampLabels.map((s, i) => <Tag key={i} style={{ margin: 0 }}>{s}</Tag>)}</div>
            : <div style={{ fontSize: 13, color: '#6b7280' }}>No stamps on this B/L.</div>}
        </div>

        <div>
          <div style={label}>Leave off the print</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", rowGap: 8, columnGap: 12 }}>
            <Checkbox style={{ marginLeft: 0 }} checked={cbm} onChange={(e) => setCbm(e.target.checked)}>CBM</Checkbox>
            <Checkbox style={{ marginLeft: 0 }} checked={grossWeight} onChange={(e) => setgrossWeight(e.target.checked)}>Gross weight</Checkbox>
            <Checkbox style={{ marginLeft: 0 }} checked={netWeight} onChange={(e) => setNetWeight(e.target.checked)}>Net weight</Checkbox>
            <Checkbox style={{ marginLeft: 0 }} checked={containerData} onChange={(e) => setcontainerData(e.target.checked)}>Container data</Checkbox>
            <Checkbox style={{ marginLeft: 0 }} checked={formE} onChange={(e) => setFormE(e.target.checked)}>Form E no. &amp; date</Checkbox>
          </div>
        </div>
      </Card>

      <div>
        <Modal open={visibleStamps}
          width={"80%"}
          onOk={() => setVisibleStamps(false)}
          onCancel={() => setVisibleStamps(false)}
          footer={false}
          maskClosable={false}
          title={`View Stamps`}
        >
          <button type="button" className="btn-custom mb-3" style={{ width: "170px" }} onClick={()=>append()}> Add </button>
          <form onSubmit={handleSubmit(onSubmit)}>
            <Table className="tableFixHead" bordered style={{ fontSize: 14 }}>
              <thead>
                <tr className="">
                  <th className="text-center ">S.No</th>
                  <th className="text-center ">Code</th>
                  <th className="text-center ">Stamp</th>
                  <th className="text-center ">Stamp Group</th>
                  <th className="text-center ">Delete</th>
                </tr>
              </thead>
              <tbody>
                {fields?.map((field, index) => {
                  return (
                    <tr key={field.id}>
                      <td>{index}</td>
                      <td>{Stamp ? Stamp[index]?.code : ""}</td>
                      <td>
                        <SelectSearchComp name={`stamps.${index}.code`} register={register} placeholder="Stamps"
                          options={stamps.map((stamp) => ({ id: stamp.value, name: stamp.label }))} control={control}
                        />
                      </td>
                      <td>
                        <SelectSearchComp name={`stamps.${index}.stamp_group`}  options={groups?.map((x) => { return { id: x?.value, name: x?.label }})}
                          style={{ width: "80px !important" }} register={register} control={control}
                        />
                      </td>
                      <td className="text-center">
                        <CloseCircleOutlined className="cross-icon" onClick={() => ( remove(index), onDelete(Stamp[index]?.id))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <button className="btn-custom mb-3" type="submit">
              Submit
            </button>
          </form>
        </Modal>
      </div>
    </div>
    <BlPrintModal
        show={showModal}
        handleClose={() => setShowModal(false)}
        allValues={allValues}
        state={state}
        borders={borders}
        heading={heading}
        border={border}
        stamps={stamps}
        line={line}
        grossWeight={grossWeight}
        netWeight={netWeight}
        containerData={containerData}
        formE={formE}
        cbm={cbm}
        form={form}
      />
    {/* <BlPrint caller={true} state={state} allValues={{...allValues, jobData: data.result}} border={border} line={line} borders={borders} heading={heading} inputRef={inputRef} stamps={stamps} cbm={cbm} grossWeight={grossWeight} netWeight={netWeight}  containerData={containerData} formE={formE}/> */}
    {/* <BlPrintNEW caller={true} state={state} allValues={{...allValues, jobData: data.result}} border={border} line={line} borders={borders} heading={heading} inputRef={inputRef} stamps={stamps} cbm={cbm} grossWeight={grossWeight} netWeight={netWeight}  containerData={containerData} formE={formE}/> */}
  </div>
)};

export default Stamps;
