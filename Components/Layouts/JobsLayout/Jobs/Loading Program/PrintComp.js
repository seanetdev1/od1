import React from "react";
import { Col, Row } from "react-bootstrap";
import moment from "moment";
import ports from "jsonData/ports";
import { companyDetails, companyLogo, currentCompanyId } from 'functions/companyBranding';
import { formatPortForPrint } from '../../BlComp/states';

// The port's full name and country - "Felixstowe, United Kingdom" - as the BL
// prints it, not its code. A code the port list does not know prints as it is.
export const portFullName = (code) => {
  const port = ports.ports.find((x) => x.id == code);   // eslint-disable-line eqeqeq
  return port ? formatPortForPrint(port) : (code || '');
};

// The Loading Program letter. Only the document: LoadingForm prints it, from
// its Print button, and keeps it out of sight on the screen.
const PrintComp = ({allValues, state}) => {
    let border = "1px solid";
    const heading = border ? "grey-txt" : "wh-txt";
    const line = "1px solid";

    // A party's, commodity's or vessel's name from its list, without the
    // "(code)" after it. Safe all the way: this is rendered (hidden) as soon
    // as a saved program loads, so anything missing here - a party no longer
    // in the list, a job with no voyage - would take the whole tab down. And
    // a name with no "(" is kept whole; it used to lose its last two letters.
    const nameOf = (list, id) => {
      if (id === null || id === undefined || id === '') return '';
      const name = (list || []).find((x) => x.id == id)?.name;   // eslint-disable-line eqeqeq
      if (!name) return '';
      const at = name.indexOf('(');
      return at > 0 ? name.slice(0, at).trim() : name;
    };
    const record = state?.selectedRecord || {};
    const fields = state?.fields || {};

  return (
        <div style={{ padding: "30px" }}>
          <div className="d-flex justify-content-center" style={{ position:"relative", borderBottom: "2px solid" }}>
            {/* Was a hardcoded Seanet logo/name/address. Now the selected
                company's own letterhead - see functions/companyBranding.js. */}
            {companyLogo(currentCompanyId(), { print: true }) &&
              <img src={companyLogo(currentCompanyId(), { print: true })} height={40} style={{ position:"absolute", left:"0"}} alt=""/>}
            <div style={{ textAlign: "center" }}>
              <p className="fs-16" style={{ lineHeight: "5px" }}>
                {companyDetails(currentCompanyId()).title}
              </p>
              <p className="fs-13" style={{ lineHeight: "5px" }}>
                {companyDetails(currentCompanyId()).address}
              </p>
              <p className="fs-13" style={{ lineHeight: "5px" }}>
                {companyDetails(currentCompanyId()).phone ? `Tel: ${companyDetails(currentCompanyId()).phone}` : ''}
              </p>
              <p className="fs-13" style={{ lineHeight: "5px" }}>
                {companyDetails(currentCompanyId()).email && `Email: ${companyDetails(currentCompanyId()).email} `}{companyDetails(currentCompanyId()).web && `Web ${companyDetails(currentCompanyId()).web}`}
              </p>
            </div>
            <p style={{ position: "absolute", top: "62px", right: "50px", background: "white", padding: "2px"}}>
              Loading Progress
            </p>
          </div>
          <div className="mt-3" style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
            <div>
              {/* The terminal's line is left empty: it said PICT on every
                  letter, whichever terminal the cargo was going to. The
                  line itself stays, so the address keeps its shape. */}
              <p className="fs-13" style={{ lineHeight: "5px" }}>The Assistant Traffic Manager</p>
              <p className="fs-13" style={{ lineHeight: "5px" }}>&nbsp;</p>
              <p className="fs-13" style={{ lineHeight: "5px" }}>Karachi</p>
            </div>
            <table className="table table-bordered" style={{ width: "300px", height: "40px" }}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Book #</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{record.jobDate?moment(record.jobDate).format("DD/MM/YYYY"):""}</td>
                  <td>{record.jobNo}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <p>Dear Sir</p>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
              }}
            >
              <p>C.V : </p>
              <p style={{ width: "150px", borderBottom: "1px solid" }}>
                {nameOf(fields.vessel, record.Voyage?.VesselId)}
              </p>
              <p>Voyage : </p>
              <p style={{ width: "100px", borderBottom: "1px solid" }}>
                {record.Voyage?.voyage}
              </p>
              <p>EGM No : </p>
              <p style={{ width: "100px", borderBottom: "1px solid" }}>
                {allValues.egm}
              </p>
              <p>Berth No : </p>
              <p style={{ width: "100px", borderBottom: "1px solid" }}>
              {allValues.berth} 

              </p>
              <div className="d-flex">
                <p>WHARF : </p>
                <p style={{ width: "180px", borderBottom: "1px solid" }}>
                  {allValues.wharf}
                </p>
              </div>
            </div>
          </div>

          <div>
            <p style={{lineHeight:"5px"}}>We have requested for the following cargo to be alongside :</p>
            <Row>
              <Col style={{ margin: 0, border: border, padding: 0, minWidth: "100%" }}>
                <Row style={{ position: "relative", left: 10 }}>
                  <Col style={{ maxWidth: "25%", margin:0, borderBottom:border, borderRight:border, paddingTop:7, paddingBottom:3 }} className="fs-12 text-center"
                  >Shipper / Clearing Agent
                  </Col>
                  <Col style={{ maxWidth: "15%", margin: 0, borderBottom: border, borderRight: border, paddingTop: 7, paddingBottom: 3 }}
                    className="fs-12 text-center">
                    Pkgs / No. of Cont.
                  </Col>
                  <Col style={{ maxWidth:"25%", borderBottom:border, borderRight:border, paddingTop:7, paddingBottom:3 }} className={`fs-12 px-4 m-0`}>
                    Description Of Goods
                  </Col>
                  <Col style={{ maxWidth:"15%", borderBottom: border, borderRight: border, paddingTop: 7, paddingBottom: 3}} className={`fs-12 px-4 m-0`} >
                    Date & Time Required
                  </Col>
                  <Col style={{ maxWidth: "17%", margin: 0, borderBottom: border, paddingTop: 7, paddingBottom: 3 }} className="fs-12 px-4">
                    Destination
                  </Col>
                </Row>
                <div
                  style={{ height: 1, width: "100%", backgroundColor: line }}
                ></div>
                <Row style={{ position: "relative", left: 10 }}>
                  <Col style={{ maxWidth:"25%", margin:0, borderRight:border, paddingTop:7, paddingBottom:3}} className={`${heading} fs-12`}>
                    <div className="mb-3">
                      Shipper:<br />
                      {nameOf(fields.party?.shipper, record.shipperId)}
                    </div>
                    <div className="mt-3 mb-1">
                      Clearing Agent :<br />
                      {nameOf(fields.vendor?.chaChb, record.customAgentId)}
                    </div>
                  </Col>
                  <Col style={{ maxWidth:"15%", margin:0, borderRight: border, paddingTop:7, paddingBottom:3}} className={`${heading} fs-12 text-center`}>
                    {record.pcs} <br /> {record.pkgUnit}
                  </Col>
                  <Col style={{ maxWidth:"25%", margin:0, borderRight: border, paddingTop:7, paddingBottom:3 }} className={`${heading} fs-12 px-4`}>
                    {nameOf(fields.commodity, record.commodityId)}
                  </Col>
                  <Col style={{ maxWidth:"15%", margin:0, borderRight: border, paddingTop:7, paddingBottom:3 }} className={`${heading} fs-12 px-4`}>
                    {allValues.loadingDate?moment(allValues.loadingDate).format("DD/MM/YYYY"):""}
                    <br />
                    {allValues.loadingTime?moment(allValues.loadingTime).format("hh:mm a"):""}
                  </Col>
                  <Col style={{ maxWidth: "17%", margin: 0, paddingTop: 7, paddingBottom: 3 }} className={`${heading} fs-12 px-4`}>
                    Discharge Port:
                    <br />
                    {portFullName(record.pod)}
                  </Col>
                </Row>
              </Col>
              <Col style={{ margin:0, borderLeft:"none", maxWidth:"54%", paddingLeft:1, paddingRight:1, paddingTop:0, paddingBottom:5}}>
              </Col>
            </Row>
            <p className="fs-15 mt-2" style={{lineHeight:"15px"}}>
              {allValues.instruction}
            </p>
          </div>
          <div style={{display:"flex", justifyContent:"space-between"}}>
            <div style={{width:"40%"}}>
                <p className="fs-13">Kindly allow the cargo to pass throught accordingly</p>
                <br/>
                <hr/>
                <p><b>For : {companyDetails(currentCompanyId()).title}</b></p>
                <p style={{textAlign:"center"}}><b>As Agent</b></p>
            </div>
            <div style={{width:"40%"}}>
                <p className="fs-13"> <i>C.C:</i></p>
                <br/>
                <p>{nameOf(fields.party?.shipper, record.shipperId)}</p>
            </div>
          </div>
        </div>
  );
};

export default PrintComp;
