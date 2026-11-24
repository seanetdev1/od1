import React from 'react';
import { Col, Row, Table } from "react-bootstrap";
import numToWords from 'functions/numToWords';
import usePrintStamp from 'functions/usePrintStamp';
// The de-branding change swapped hardcoded Seanet/ACS branding for this
// component here but never imported it, so both voucher prints threw
// "CompanyLetterhead is not defined" the moment they rendered. The other two
// callers (BlPrint, Delivery Order PrintComp) import it exactly like this.
import CompanyLetterhead from 'Components/Shared/CompanyLetterhead';
import {
  voucherDate, chequeDate, voucherNarration, counterparty, voucherTotals, money, voucherTitle, costCentre,
} from 'functions/voucherPrint';

/* Text that WRAPS, under a rule, where the print had single-line inputs.
 * Those cut a long narration off at the edge of the box - and, being
 * defaultValue inputs, kept whatever they held when the print first mounted,
 * which is before the voucher has loaded: they printed empty. */
const ruled = { borderBottom: '1px solid #dee2e6', minHeight: 18, fontSize: 10, paddingTop: 6, wordBreak: 'break-word' };

const Print = ({ compLogo, voucherData }) => {
  // Who and when: empty until in the browser - see functions/usePrintStamp.
  const stamp = usePrintStamp();

  const paraStyles = { lineHeight: 1.2, fontSize: 11 };
  const Line =() => <div style={{ backgroundColor: "grey", height: 1, position: 'relative', top: 12 }}></div>
  // See functions/voucherPrint for why each of these is what it is.
  const totals = voucherTotals(voucherData);
  const narration = voucherNarration(voucherData);
  const party = counterparty(voucherData);

  return (
    <div className='voucher-print-root pb-5 px-5 pt-4'>
      {/* A PLAIN @page rule, not a named one.
          This was `@page voucherPortrait { ... }` plus `page: voucherPortrait`
          on the root - CSS Paged Media named pages, which browsers barely
          support: Chrome ignores the `page` property in most versions, so the
          size never applied and the voucher printed in whatever orientation
          the print dialog defaulted to. An unnamed @page is honoured
          everywhere, and this element is the only thing in the print iframe,
          so there is nothing to scope it away from. */}
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } }`}</style>
      <Row>
        <Col md={4} className='text-center'>
          {/* Logo + name + address now come from the Company record, so a
              leased install prints its own letterhead rather than ours.
              See Components/Shared/CompanyLetterhead.js. */}
          <CompanyLetterhead companyId={compLogo} showTitle={false} showContact={false} />
        </Col>
        <Col className='mt-4'>
          <CompanyLetterhead companyId={compLogo} showLogo={false} paraStyles={paraStyles} />
        </Col>
      </Row>
      <Row className='my-2'>
        <Col md={4}><Line /></Col>
        <Col md={4}>
          <div className='text-center fs-15' style={{ whiteSpace: 'nowrap' }}>
            <strong>{voucherTitle(voucherData)}</strong>
          </div>
        </Col>
        <Col md={4}><Line /></Col>
      </Row>
      <Row className="my-2">
        <Col md={4}>
            <div style={{ display: "flex", alignItems: "center" }}>
            <label
                className="font-bold fs-10"
                style={{ width: "100px", marginRight: "8px", whiteSpace: "nowrap" }}
            >
                Voucher #:
            </label>
            <input
                readOnly
                type="text"
                className="border-top-0 border-start-0 border-end-0 fs-10"
                style={{
                outline: "none",
                width: "100%",
                padding: 0,
                margin: 0,
                textAlign: "center",
                }}
                value={voucherData.voucher_Id || ""}
            />
            </div>
        </Col>

        <Col md={4}>
            <div style={{ display: "flex", alignItems: "center" }}>
            <label
                className="font-bold fs-10"
                style={{ width: "100px", marginRight: "8px", whiteSpace: "nowrap" }}
            >
                Source No #:
            </label>
            <input
                readOnly
                type="text"
                className="border-top-0 border-start-0 border-end-0 fs-10"
                style={{
                outline: "none",
                width: "100%",
                padding: 0,
                margin: 0,
                textAlign: "center",
                }}
                value={voucherData.sourceNo || ""}
            />
            </div>
        </Col>

        <Col md={4}>
            <div style={{ display: "flex", alignItems: "center" }}>
            <label
                className="font-bold fs-10"
                style={{ width: "100px", marginRight: "8px", whiteSpace: "nowrap" }}
            >
                Date:
            </label>
            <input
                readOnly
                type="text"
                className="border-top-0 border-start-0 border-end-0 fs-10"
                style={{
                outline: "none",
                width: "100%",
                padding: 0,
                margin: 0,
                textAlign: "center",
                }}
                value={voucherDate(voucherData)}
            />
            </div>
        </Col>
        </Row>

        <Row className="my-2">
        <Col md={4}>
            <div style={{ display: "flex", alignItems: "center" }}>
            <label
                className="font-bold fs-10"
                style={{ width: "100px", marginRight: "8px", whiteSpace: "nowrap" }}
            >
                Cheque No:
            </label>
            <input
                readOnly
                type="text"
                className="border-top-0 border-start-0 border-end-0 fs-10"
                style={{
                outline: "none",
                width: "100%",
                padding: 0,
                margin: 0,
                textAlign: "center",
                }}
                value={voucherData.chequeNo || ""}
            />
            </div>
        </Col>

        <Col md={4}></Col>

        <Col md={4}>
            <div style={{ display: "flex", alignItems: "center" }}>
            <label
                className="font-bold fs-10"
                style={{ width: "100px", marginRight: "8px", whiteSpace: "nowrap" }}
            >
                Cheque Date:
            </label>
            <input
                readOnly
                type="text"
                className="border-top-0 border-start-0 border-end-0 fs-10"
                style={{
                outline: "none",
                width: "100%",
                padding: 0,
                margin: 0,
                textAlign: "center",
                }}
                value={chequeDate(voucherData)}
            />
            </div>
        </Col>
        </Row>

      {party && (
      <Row className='my-2'>
        <Col md={2}>
          <label className='mt-2 font-bold fs-10'>{party.label}:</label>
        </Col>
        <Col md={10}><div style={ruled}>{party.value}</div></Col>
      </Row>
      )}
      <Row className='my-2'>
        <Col md={2}>
          <label className='mt-2 font-bold fs-10'>Narration:</label>
        </Col>
        <Col md={10}><div style={ruled}>{narration}</div></Col>
      </Row>
      {/* No height cap: this was a 500px scroll box, which on paper cut a
          long voucher off after its first dozen lines. */}
      <div className='mt-4'>
            <Table bordered className='tableFixHead'>
            <thead style={{ fontSize: "10px" }}>
                <tr>
                <th>Code</th>
                <th>Head of Account</th>
                <th>Cost Center</th>
                <th>Debit</th>
                <th>Credit</th>
                </tr>
            </thead>
            <tbody>
                {voucherData?.Voucher_Heads?.map((x, index) => {
                return (
                <tr key={index} className='fs-10' >
                    <td>{index + 1}</td>
                    <td>
                    <span className=''>
                        {x.Child_Account?.title}<br/>
                        {x.narration && <span style={{fontSize:10, color:'grey'}}>{"( "}{x.narration}{" )"}</span>}
                    </span>
                    </td>
                    <td>
                    <span className=''>{costCentre(voucherData)}</span>
                    </td>
                    <td className='text-end'>
                    <span>{x.type === "debit" ? money(x.amount) : ""}</span>
                    </td>
                    <td className='text-end'>
                    <span>{x.type === "credit" ? money(x.amount) : ""}</span>
                    </td>
                </tr>
                )})}
                <tr className='text-end fw-bold fs-10'>
                    <td colSpan={3} >
                        Total
                    </td>
                    <td>
                        {money(totals.debit)}
                    </td>
                    <td>
                        {money(totals.credit)}
                    </td>
                </tr>
            </tbody>
            </Table>
      </div>
      <Row className='my-2'>
            <Col md={3}>
                <label className='fs-10'>Total amount in words :</label>
            </Col>
            <Col md={9}><div style={ruled}>{numToWords(totals.credit)}</div></Col>
      </Row>
      <Row
        style={{
            width: "95%",
            marginTop: "100px",
            marginLeft: "auto",
            marginRight: "auto", // ✅ this centers the Row horizontally
            display: "flex",
            justifyContent: "center" // ✅ centers columns inside the row
        }}
        >
        <Col md={3}>
          <div className='d-flex flex-column justify-content-center'>
                <input
                  style={{ outline: "none" }}
                  type='text'
                  className='border-top-0 border-start-0 border-end-0 fs-10'
                  readOnly
                />
                <label className='text-center fs-10 fw-bold'>Prepared by</label>
          </div>
        </Col>
        <Col md={3}>
          <div className='d-flex flex-column justify-content-center'>
                <input
                  style={{ outline: "none" }}
                  type='text'
                  className='border-top-0 border-start-0 border-end-0 fs-10'
                  readOnly
                />
                <label className='text-center fs-10 fw-bold'>Checked by</label>
          </div>
        </Col>
        <Col md={3}>
              <div className='d-flex flex-column justify-content-center'>
                <input
                  style={{ outline: "none" }}
                  type='text'
                  className='border-top-0 border-start-0 border-end-0 fs-10'
                  readOnly
                />
                <label className='text-center fs-10 fw-bold'>Approved by</label>
              </div>
        </Col>
        <Col md={3}>
              <div className='d-flex flex-column justify-content-center'>
                <input
                  style={{ outline: "none" }}
                  type='text'
                  className='border-top-0 border-start-0 border-end-0 fs-10'
                  readOnly
                />
                <label className='text-center fs-10 fw-bold'>Received by</label>
              </div>
        </Col>
      </Row>
      <Row style={{ marginTop: "20px", position: "fixed", bottom: 20, width: "90%" }}>
            <Col md={6}>
                <div className='text-start'>
                    <span className='fs-10'>Printed on : {stamp.at && `${stamp.at.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })} at ${stamp.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}</span>
                </div>
            </Col>
            <Col md={6}>
                <div className='text-end'>
                    <span className='fs-10'>Printed by :{stamp.by} </span>
                </div>
            </Col>
      </Row>
    </div>
  )
}

export default React.memo(Print)
