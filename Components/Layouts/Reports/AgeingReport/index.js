import axiosClient from 'apis/axiosClient';
import moment from "moment";
import { Select, Radio, DatePicker, Checkbox } from 'antd';
import React, { useEffect, useState } from 'react';
import { Row, Col, Form } from 'react-bootstrap';
import { useDispatch } from 'react-redux';
import { useSelector } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { setFilterValues } from 'redux/filters/filterSlice';
import Router from 'next/router';
import Cookies from "js-cookie";
import { FileExcelOutlined } from '@ant-design/icons';
import { setAgeingField } from '../../../../redux/ageing/ageingSlice';
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import ExcelJS from "exceljs";
import { companyOptions } from 'functions/companyBranding';
import { usePageActions } from 'Components/Shared/PageActions';
import { currencyOptions } from 'functions/ageingCurrency';


const AgeingReport = () => {
  const [exporting, setExporting] = useState(false);
  const state = useSelector((state) => state.ageing);
  const dispatch = useDispatch();

  const ExportExcel = async () => {
    setExporting(true);
    try {
      const result = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/ageingSummary`,{headers:{ ageing_reportType: state.ageing_reportType, ageing_company: state.ageing_company, from: state.ageing_sdate, to: state.ageing_edate, ageing_RP: state.ageing_RP, ageing_account: state.ageing_account, ageing_partyType: state.ageing_partyType }}).then((x)=>x.data);
      console.log("Export to Excel Result:", result)
    } catch (error) {
      console.error("Error exporting to Excel:", error);
    }
  };

    useEffect(()=>{
        if(state.ageing_accounts.length == 0){
            getAccounts();
        }
        if((state.ageing_salesReps || []).length == 0){
            getSalesReps();
        }
        if(state.ageing_company == undefined){
            dispatch(setAgeingField({field:"ageing_company",value:parseInt(Cookies.get('companyId'))}));
        }
    },[])

    
    useEffect(() => {
    if (Array.isArray(state?.data) && state.data.length > 0) {
        dispatch(setAgeingField({ field: "ageing_reportData", value: state.data }));
    }
    }, [state?.data, dispatch]);

    
    useEffect(() => {
        if (state?.data) {
        dispatch(setAgeingField({ field: "ageing_reportData", value: state.data }));
        }
    }, [state?.data, dispatch]);

    // The employees marked as sales reps, for the Sales Rep picker.
    const getSalesReps = async () => {
        try {
            const res = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/employeeRoutes/getRepresentativeEmployees`);
            const reps = (res.data?.result?.Sr || []).map((x) => ({ value: String(x.id), label: x.name }));
            dispatch(setAgeingField({ field: "ageing_salesReps", value: reps }));
        } catch (e) {
            console.error(e);
        }
    };

    const getAccounts = async () => {
   
        try{  
        const gotAccounts = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_CHILD_ACCOUNTS);
            const {data}= gotAccounts;
            const {result} = data
            let temprecords=[];
            result?.map((x) => {
            // console.log("x",x)
                return temprecords.push({ value: x.id, label: `(${x.code}) ${x.title}`, });
                });
                dispatch(setAgeingField({field:"ageing_accounts",value:temprecords}))
                // getAccountName(temprecords);
        }catch(e){
        console.log("e",e)
        }
    };
    console.log("AgeingState: ",state)

  /* Export runs the report route in a hidden iframe with autoExport=true -
   * the report page builds the workbook itself, so there is one implementation
   * of the figures rather than a second one here. Lifted out of the button's
   * onClick so the toolbar can call it; see Components/Shared/PageActions. */
  const exportToExcel = () => {
    setExporting(true);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = `/reports/ageingReport/report` + `?ageing_reportType=${state.ageing_reportType}` + `&ageing_company=${state.ageing_company}` + `&from=${state.ageing_sdate}` + `&to=${state.ageing_edate}` + `&ageing_RP=${state.ageing_RP}` + `&ageing_account=${state.ageing_account}` + `&ageing_partyType=${state.ageing_partyType}` + `&ageing_currency=${state.ageing_currency}` + `&ageing_salesRep=${state.ageing_salesRep}` + `&autoExport=true`;
    document.body.appendChild(iframe);
    setTimeout(() => setExporting(false), 1500);
  };

  usePageActions({
    title: 'Ageing Report',
    excel: {
      onClick: exportToExcel,
      busy: exporting,
      title: 'Export this report to Excel',
    },
  }, [exporting, state]);

    return (
        <div className="base-page-layout">
                    <div className="page-header">
                        <div className='btn-header'>
                          <button className='btn-custom my-1 px-4 mx-1'
                            onClick={() => {
                                Router.push({ 
                                    pathname: `/reports/ageingReport/report`, 
                                    query: { ageing_reportType: state.ageing_reportType, ageing_company: state.ageing_company, from: moment(state.ageing_sdate).toISOString(), to: moment(state.ageing_edate).toISOString(), ageing_RP: state.ageing_RP, ageing_account: state.ageing_account, ageing_partyType: state.ageing_partyType, ageing_currency: state.ageing_currency, ageing_salesRep: state.ageing_salesRep } 
                                });
                                // console.log(revenue)
                                dispatch(incrementTab({
                                    "label": "Ageing Report",
                                    "key": "5-14",
                                    "id": `?ageing_reportType=${state.ageing_reportType}&ageing_company=${state.ageing_company}&from=${moment(state.ageing_sdate).toISOString()}&to=${moment(state.ageing_edate).toISOString()}&ageing_RP=${state.ageing_RP}&ageing_account=${state.ageing_account}&ageing_partyType=${state.ageing_partyType}&ageing_currency=${state.ageing_currency}&ageing_salesRep=${state.ageing_salesRep}`
                                }))
                            }}>
                            Go
                        </button>

                        </div>
                    </div>
                <div className="form-card">
                   <Col gutter={1} className=" mt-3">
                    <div className="card-section">
                    <Row gutter={16} className='form-row'>
                    <Col md={2}>
                        {/* THE CUT-OFF: an invoice dated before it is left out,
                            however much is still owed on it - the user's
                            request, 2026-10-09. By the invoice's date; it read
                            updatedAt, which every migrated invoice has as the
                            day of the migration. See /invoice/ageingSummary. */}
                        <label title='Invoices dated before this are left out'>Cut-off date</label>
                        <DatePicker 
                        style={{ width: "100%", borderRadius:"6px" }}
                        className='datePicker-modern'
                        allowClear={false}
                        value={moment(state.ageing_sdate)}
                        onChange={(e) => dispatch(setAgeingField({ field: "ageing_sdate", value: moment(e).toISOString() }))}
                    />
                  </Col>
        
                  <Col md={2}>
                    {/* Picks the invoices only - each is aged as on today
                        (the user, 2026-11-02; functions/ageingRows). */}
                    <label title='Invoices dated after this are left out. Days are counted to today.'>To</label>
                    <DatePicker 
                      style={{ width: "100%", borderRadius:"6px" }}
                      className='datePicker-modern'
                      allowClear={false}
                      value={moment(state.ageing_edate)}
                      onChange={(e) => dispatch(setAgeingField({ field: "ageing_edate", value: moment(e).toISOString() }))}
                    />
                  </Col>
                  <Col md={3}>
                        <label>Sales Rep</label>
                        {/* The rep set on the party - see /invoice/ageingSummary. */}
                        <Select
                            showSearch
                            style={{ width: "100%" }}
                            className='select-modern'
                            value={state.ageing_salesRep || 'All'}
                            onChange={(e) => dispatch(setAgeingField({ field: "ageing_salesRep", value: e }))}
                            options={[{ value: 'All', label: 'All sales reps' }, ...(state.ageing_salesReps || [])]}
                            filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                        />
                  </Col>
                  <Col md={5}>
                        <label>Account</label>
                            <Select 
                            showSearch 
                            allowClear
                            style={{ width: "100%" }} 
                            placeholder="Select Account" 
                            className='select-modern'
                            value={state.ageing_account}
                            onChange={e => dispatch(setAgeingField({field:"ageing_account",value:e}))} 
                            options={state.ageing_accounts}
                                filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                                filterSort={(optionA, optionB) => (optionA?.label ?? "").toLowerCase().localeCompare((optionB?.label ?? "").toLowerCase())}
                            />
                    </Col>
                </Row>
                </div></Col>
                <Row gutter={16} className=" mt-3">
                        <Col md={4}>
                            <div className="card-section">
                              <h5>Report Type</h5>
                      <Checkbox.Group className="mt-1" 
                      value={state.ageing_RP}
                    //   disabled={state.ageing_partyType == "Local"}
                      onChange={e => {
                        if (e.length == 0) return;
                        dispatch(setAgeingField({field:"ageing_RP",value:e})
                      )}}>
                        <Checkbox value={"Recievable"}>Receivable</Checkbox>
                        <Checkbox value={"Payble"}>Payable</Checkbox>
                      </Checkbox.Group>
                      </div>
                    </Col>
                <Col md={8}>
                      <div className="card-section">
                      <h5 className="form-label">Company</h5>
                      <div className="checkbox-group">
                      <Checkbox.Group className="mt-1"
                      value={state.ageing_company}
                      onChange={(e)=> {
                        console.log(e.length)
                        if(e.length == 0){
                            dispatch(setAgeingField({field: 'ageing_company', value: [parseInt(Cookies.get('companyId'))] }))    
                        }else{
                            dispatch(setAgeingField({field: 'ageing_company', value: e}))
                        }
                      }}
                      >
                        {companyOptions().map((c) => (
                          <Checkbox key={c.value} value={c.value}>{c.label}</Checkbox>
                        ))}
                      </Checkbox.Group>
                        </div>
                        </div>
                  </Col>
                </Row>
                <Row className="mt-3">  
                  <Col md={3}>
                    <div className="card-section">
                      <h5 className='form-label'>Currency</h5>
                      {/* All currencies (a total line for each), one of them,
                          or everything converted to PKR - see
                          functions/ageingCurrency. */}
                      <Select
                        style={{ width: '100%' }}
                        className='select-modern'
                        value={state.ageing_currency || 'All'}
                        onChange={(e) => dispatch(setAgeingField({ field: 'ageing_currency', value: e }))}
                        options={currencyOptions}
                      />
                    </div>
                  </Col>
                  <Col md={4}>
                    <div className="card-section">
                      <h5 className='form-label'>Party Types</h5>
                    <Radio.Group className="mt-2" 
                    value={state.ageing_partyType} 
                    onChange={e => {
                      dispatch(setAgeingField({field:"ageing_partyType",value:e.target.value}))
                    }}>
                      <Radio value={"Local"}>Local Party</Radio>
                      <Radio value={"Agent"}>Agent</Radio>
                    </Radio.Group>
                    
                    </div>
                </Col>  
                <Col md={5}>
                    <div className="card-section">
                    <h5 className="form-label">Type</h5>
                    <Select
                        showSearch
                        style={{ width: '100%' }}
                        placeholder="Select Report Type"
                        className='select-modern'
                        value={state.ageing_reportType}
                        onChange={(e)=>{
                            // setageing_reportType(e)
                            dispatch(setAgeingField({field:"ageing_reportType",value:e}))
                        }}
                        options={[
                        //   { label: 'Ageing Detail', value: 'Ageing Detail' },
                          { label: 'Ageing Summary', value: 'Ageing Summary' },
                          { label: 'Ageing Weekly', value: 'Ageing Weekly' },
                        ]}
                        filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                        filterSort={(a, b) => (a?.label ?? '').toLowerCase().localeCompare((b?.label ?? '').toLowerCase())}
                    />
                    </div>
                </Col>
                </Row>
                
              </div>
        </div>
    )
}

export default React.memo(AgeingReport)
