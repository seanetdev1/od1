import { jobTypeOptions } from 'functions/terminology';
import { reportCompanyOptions } from 'functions/companyBranding';
import React, { useEffect, useState } from 'react';
import { Row, Col, Form } from "react-bootstrap";
import { getJobValues } from 'apis/jobs';
import axiosClient from 'apis/axiosClient';
import { incrementTab } from 'redux/tabs/tabSlice';
import { setFilterValues } from "redux/filters/filterSlice";
import { Select, Input, Checkbox, Radio, DatePicker, Switch } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import Router from "next/router";
import moment from 'moment';
import { reportFrom, reportTo } from 'functions/reportDates';
import { glOnly, uniqueGlParties } from 'functions/glParties';
import { usePageActions } from 'Components/Shared/PageActions';

const JobBalancing = () => {

  const dispatch = useDispatch();  
  const [from, setFrom] = useState(reportFrom);
  const [to, setTo] = useState(reportTo);
  const [ company, setCompany ] = useState('all');
  const [ party, setParty ] = useState("");
  const [ overseasAgent, setOverseasAgent ] = useState("");
  const [ reportType, setReportType ] = useState("viewer");
  const [ options, setOptions ] = useState("exclude0");
  const [ representator, setRepresentator ] = useState("");
  const [ currency, setCurrency ] = useState("");
  const [ jobTypes, setJobTypes ] = useState([]);
  const [ values, setValues ] = useState({});
  const [ payType, setPayType ] = useState("Recievable");
  /* Advance money not yet knocked off, as rows of the report - the user,
   * 2026-11-10: on or off, starting where the install says (Configuration >
   * Reports; SNS on, CL off). null = not moved here, so nothing is
   * sent and the server applies the install's setting - right even when Go is
   * pressed before the setting has loaded. */
  const [ advances, setAdvances ] = useState(null);
  const [ installAdvances, setInstallAdvances ] = useState(true);
  const { data, status } = useQuery({ queryKey:['values'], queryFn:getJobValues });
    
  const stateValues = {
    from,
    to,
    company,
    payType,
    // party,
    // overseasAgent,
    representator,
    currency,
    jobTypes,
    reportType,
    options,
    advances,
  }

  const filterValues = useSelector(state=>state.filterValues);
  const filters = filterValues.find(page=>page.pageName==="jobBalancing");
  const value = filters ? filters.values : null ;

  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/jobBalancingAdvances')
      .then(({ data }) => { if (alive) setInstallAdvances(data?.result?.enabled !== false); })
      .catch(() => {});   // the switch shows on; the server still applies the setting
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if(status=="success"){
      // console.log(data.result)
      setValues(data.result)
    }
  }, [status]);

  useEffect(()=>{
    if(filters){
      setFrom(value.from),
      setTo(value.to),
      setCompany(value.company),
      setPayType(value.payType),
      setParty(value.party),
      setOverseasAgent(value.overseasAgent),
      setRepresentator(value.representator),
      setCurrency(value.currency),
      setJobTypes(value.jobTypes),
      setReportType(value.reportType),
      /* Show All was the one choice NOT brought back: coming back to change a
         date and pressing Go ran the report on Exclude 0 Balance again, which
         reads as "Show All does not work". */
      setOptions(value.options || "exclude0")
      // Moved on the last run: kept. Otherwise the install's setting.
      setAdvances(typeof value.advances === 'boolean' ? value.advances : null)
    }
  },[])

  const filterOption = (input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase());
  // Driven by the operation mode - an aviation install also gets 'Aviation'
  // (operation 'AV'), without which ticking any type hid aviation invoices.
  const plainOptions = jobTypeOptions();
  /* Advances belong to no job, so the server leaves them out when the report
   * is narrowed to some job types or to an overseas agent's jobs - whatever
   * the switch says. It shows off and greyed then, rather than "on" for rows
   * that will not come. */
  const narrowed = (jobTypes?.length > 0 && jobTypes.length < plainOptions.length) || !!overseasAgent;
  const advancesOn = advances ?? installAdvances;
  const pending = options === 'pending';
  // Only a choice made here is sent - see `advances`.
  const advancesParam = advances === null ? {} : { advances: advances ? "show" : "hide" };
  const handleSearch = async() => {
    /* Every type ticked is the same as none: no filter. Sent as a list, it
     * also read as "narrowed to some job types", which leaves a party's
     * advance money off the report (the server's jobBalancingAdvances). */
    const types = jobTypes?.length && jobTypes.length < plainOptions.length ? jobTypes : [];
    Router.push({
      pathname:`/reports/jobBalancing/report`, 
      query:{ 
        "company":company,
        "overseasagent":overseasAgent,
        "representator":representator,
        "jobtypes":types,
        "currency":currency,
        "from":from,
        "to":to,
        "paytype":payType,
        "party":party,
        "report":reportType,
        "options":options,
        ...advancesParam,
      }
    });
    dispatch(incrementTab({
      "label": "Job Balancing Report",
      "key": "5-1-1",
      "id":`report?company=${company}&overseasagent=${overseasAgent}&representator=${representator}&currency=${currency}&jobtypes=${types}&to=${to}&from=${from}&paytype=${payType}&party=${party}&report=${reportType}&options=${options}${advancesParam.advances ? `&advances=${advancesParam.advances}` : ""}`
    }));
    dispatch(setFilterValues({
      pageName:"jobBalancing",
      values:stateValues
    }))
  }

  // The title on the toolbar (PageActions); Go stays on the page.
  usePageActions({ title: 'Job Balancing' }, []);

  return(
  // <div className='base-page-layout fs-12'>
    <div className="base-page-layout">
  <div className="page-header d-flex justify-content-between align-items-center">
    <button className="btn-custom px-4" onClick={handleSearch}>
      Go
    </button>
  </div>

  {(status === "success" && Object.keys(values).length > 0) && (
    <div className="form-card">

      {/* ================= TOP FILTER SECTION ================= */}
      <div className="filter-section">
        <Row gutter={16}>
          <Col md={4}>
            <label>From</label>
            <DatePicker
            format={'DD-MM-YYYY'}
            style={{ width: "100%", borderRadius:"6px" }} 
            className='datePicker-modern'
            value={from ? moment(from) : null} 
            onChange={(e) => setFrom(e ? e.startOf("day").toISOString() : null)} />
          </Col>

          <Col md={4}>
            <label>To</label>
            <DatePicker 
            format={'DD-MM-YYYY'}
            value={to ? moment(to) : null}
            style={{ width: "100%", borderRadius:"6px" }} 
            className='datePicker-modern'
            onChange={(e) => setTo(e ? e.endOf("day").toISOString() : null)} />
          </Col>

          <Col md={4}>
            <label>Company</label>
            <Select
              
              style={{ width: "100%" }}
              className='select-modern'
              value={company}
              onChange={(e) => setCompany(e)}
              options={reportCompanyOptions()}
            />
          </Col>

          <Col md={4}>
            <label>Pay Type</label>
            <Select
              // size="small"
              style={{width: '100%'}}
              className='select-modern'
              value={payType}
              onChange={(e) => setPayType(e)}
              options={[
                { value: "Recievable", label: "Recievable" },
                { value: "Payble", label: "Payble" },
                { value: "All", label: "All" },
              ]}
            />
          </Col>

          <Col md={4}>
            <label>Party Specific</label>
            <Select
              // size="small"
              style={{width: '100%'}}
              showSearch
              allowClear
              className='select-modern'
              filterOption={filterOption}
              onChange={(e) => setParty(e)}
              // Each party once, whatever roles it has.
              options={uniqueGlParties(
                values?.party?.client, values?.vendor?.localVendor, values?.vendor?.airLine, values?.vendor?.chaChb,
                values?.vendor?.forwarder, values?.vendor?.sLine, values?.vendor?.transporter,
              ).map((x) => ({ value: x.id, label: x.name }))}
            />
          </Col>

          <Col md={4}>
            <label>Overseas Agent</label>
            <Select
              
              style={{width: '100%'}}
              showSearch
              allowClear
              className='select-modern'
              filterOption={filterOption}
              onChange={(e) => setOverseasAgent(e)}
              options={glOnly(values?.vendor?.overseasAgent).map((x) => ({
                value: x.id,
                label: x.name,
              }))}
            />
          </Col>
        </Row>
      </div>
      <div className="filter-section">
        <Row gutter={16}>
          <Col md={4}>
            <label>Sales Representor</label>
            {/* SHOWS WHAT IS SENT. This and Currency were uncontrolled, so a
                value brought back from the last run was applied to the report
                while the box read empty. */}
            <Select value={representator || undefined} allowClear
            style={{width:'100%'}}
            className='select-modern'
            onChange={(e)=>{setRepresentator(e || "") }}
            showSearch filterOption={filterOption} 
            options={values?.sr?.map((x)=>{ return { value:x.id, label:x.name }})} />
          </Col>

          <Col md={4}> 
          <label>Job # </label>
          <Input 
          style={{width:'100%', borderRadius: '6px', height: '35px', border: '1px solid #ccc'}}
          className='select-modern'
          /> 
          </Col>

          <Col md={4}>
            <label>File # </label>
            <Input 
            style={{width:'100%', borderRadius: '6px', height: '35px', border: '1px solid #ccc'}}
            className='select-modern'
             />
          </Col>

          <Col md={4}>
              <label>Currency </label>
              <Select
              value={currency || undefined}
              allowClear
              style={{width:'100%'}}
              className='select-modern'
              onChange={(e)=>{setCurrency(e || "") }}
              options={[ { value:"PKR", label:"PKR"}, { value:"USD", label:"USD"}, { value:"EUR", label:"EUR"}, { value:"GBP", label:"GBP"}, { value:"AED", label:"AED"}, { value:"OMR", label:"OMR"}, { value:"BDT", label:"BDT"}, { value:"CHF", label:"CHF"}, ]} 
              /> 
          </Col>

          <Col md={4}>
          <label>Flight #</label> 
          <Input 
          style={{width:'100%', borderRadius: '6px', height: '35px', border: '1px solid #ccc'}}
          className='input-modern'
          /> 
          </Col> 
          <Col md={4}> 
          <label>Voyage # </label>
          <Input 
          style={{width:'100%', borderRadius: '6px', height: '35px', border: '1px solid #ccc'}}
          className='input-modern'
          /> 
          </Col>
        </Row>
      </div>
      {/* ================= REPORT + TYPE SECTION ================= */}
      <div className='last'> <Row className="mt-3">
        <Col md={4}>
          <div className="filter-section">
            <h6 className="section-title">Report Type</h6>
            <Radio.Group
              onChange={(e) => setReportType(e.target.value)}
              value={reportType}
            >
              <Radio value={"viewer"}>Viewer</Radio>
              <Radio value={"grid"}>Grid</Radio>
            </Radio.Group>
          </div>
        </Col>
        
        <Col md={4}>
        <div className="filter-section1"> 
          <h6 className="section-title">Operation Types</h6>
          {/* Nothing picked means every type - so every type shows ticked. It
              showed the four freight types ticked whatever the mode: on a
              customs install Customs Clearance read as left out while it was
              included, and unticking one freight type then dropped every
              customs invoice from the report. */}
          <Checkbox.Group
            options={plainOptions}
            value={jobTypes?.length ? jobTypes : plainOptions.map((o) => o.value)}
            onChange={(e) => setJobTypes(e)}
          />
        </div>
      </Col>
      <Col md={4}>
        <div className="filter-section">
          <h6 className="section-title">Options</h6>
          <Radio.Group
            onChange={(e) => setOptions(e.target.value)}
            value={options}
          >
            <Radio value={"exclude0"}>Exclude 0 Balance</Radio>
            <Radio value={"showall"}>Show All</Radio>
            {/* The jobs in the period with no approved invoice of the Pay
                Type picked (the user, 2026-11-20) - the server's
                functions/jobBalancingPending. */}
            <Radio value={"pending"}>Pending (not invoiced)</Radio>
          </Radio.Group>
          <div className="mt-2">
            <label className="d-flex align-items-center" style={{ gap: 8, cursor: narrowed || pending ? 'default' : 'pointer' }}>
              <Switch
                size="small"
                checked={advancesOn && !narrowed && !pending}
                disabled={narrowed || pending}
                onChange={(on) => setAdvances(on)}
              />
              Show Advance Transactions
            </label>
            {pending ? (
              <div className="text-muted" style={{ fontSize: 11 }}>
                Pending lists jobs - an advance belongs to no job.
              </div>
            ) : narrowed && (
              <div className="text-muted" style={{ fontSize: 11 }}>
                Only with every operation type ticked and no overseas agent picked.
              </div>
            )}
          </div>
        </div>
      </Col>
      </Row>
      </div>
    </div>
  )}
</div>

  );
}
export default React.memo(JobBalancing);
