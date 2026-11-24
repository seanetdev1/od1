import axiosClient from 'apis/axiosClient';
import moment from "moment";
import { reportFrom, reportTo } from 'functions/reportDates';
import { Select, Radio, Modal, DatePicker } from 'antd';
import React, { useEffect, useState } from 'react';
import { CloseCircleOutlined } from '@ant-design/icons';
import { Row, Col, Table, Spinner, Form } from 'react-bootstrap';
import { useDispatch } from 'react-redux';
import { useSelector } from 'react-redux';
import { setFilterValues } from '../../../../redux/filters/filterSlice';
import Pagination from '../../../Shared/Pagination';
import { companyOptions } from 'functions/companyBranding';
import { usePageActions } from 'Components/Shared/PageActions';

const AccountActivity = () => {

  const [visible, setVisible] = useState(false);
  const [load, setLoad] = useState(false);
  const [records, setRecords] = useState([]);
  const [voucherRecords, setVoucherRecords] = useState([]);
  const [debitAccount, setDebitAccount] = useState();
  const [creditAccount, setCreditAccount] = useState();
  const [company, setCompany] = useState(1);
  const [from, setFrom] = useState(reportFrom);
  const [to, setTo] = useState(reportTo);
  const dispatch = useDispatch()

  const commas = (a) => { return parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ", ") }

  const stateValues = {
    from,
    to,
    company,
    debitAccount,
    creditAccount
  }

  const getTotal = (type, list) => {
    let result = 0.00;
    list.forEach((x) => {
      if (type == x.type) {
        result = result + parseFloat(x.amount)
      }
    })
    return result;
  }

  const filterValues = useSelector(state => state.filterValues);
  const filters = filterValues.find(page => page.pageName === "accountActivity");
  const values = filters ? filters.values : null;

  useEffect(() => { getRecords(); }, [company])
  useEffect(() => {
    if (filters) {
      setFrom(values.from),
        setTo(values.to),
        setCompany(values.company),
        setDebitAccount(values.debitAccount),
        setCreditAccount(values.creditAccount)
    }
  }, [filters]);

  const getRecords = async () => {
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_CHILD_ACCOUNTS, {
      headers: { companyid: company }
    }).then((x) => {
      let temprecords = [];
      x.data.result.forEach((x) => {
        temprecords.push({ value: x.id, label: `(${x.code}) ${x.title}` });
      })
      setRecords(temprecords);
    })
  }

  const handleSubmit = async () => {
    setLoad(true);
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNT_ACTIVITY, {
      headers: {
        debitAccount,
        creditAccount,
        from,
        to
      }
    }).then((x) => {
      setVoucherRecords(x.data.result);
      setLoad(false);
      setVisible(true);
    })
    dispatch(setFilterValues({
      pageName: "accountActivity",
      values: stateValues
    }))
  }

  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage] = useState(20);
  const indexOfLast = currentPage * recordsPerPage;
  const indexOfFirst = indexOfLast - recordsPerPage;
  const currentRecords = voucherRecords ? voucherRecords.slice(indexOfFirst, indexOfLast) : [];
  const noOfPages = voucherRecords ? Math.ceil(voucherRecords.length / recordsPerPage) : 0;

  // console.log("currentPage:", currentPage);
  // console.log("indexOfLast:", indexOfLast);
  // console.log("indexOfFirst:", indexOfFirst);
  // console.log("Records:", records);

  // The title on the toolbar (PageActions); Go stays on the page.
  usePageActions({ title: 'Account Activity' }, []);

  return (

      <div className="base-page-layout">
        <div className="page-header">
            <button className='btn-custom my-1 px-4' disabled={load ? true : false} onClick={handleSubmit}>
              {load ? <Spinner size='sm' className='mx-3' /> : "Search"}
            </button>
        </div>
        <div className="form-card">  
          <Row gutter={16} className=" mt-3">
            <Col md={7}>
            <div className="card-section">
            <Row className='form-row'>
              <Col md={6} className="my-3">
              <label>From</label>
              <DatePicker
            format={'DD-MM-YYYY'}
            style={{ width: "100%", borderRadius:"6px" }} 
            className='datePicker-modern'
            value={from ? moment(from) : null} 
            onChange={(e) => setFrom(e ? e.startOf("day").toISOString() : null)} />
            </Col>
            <Col md={6} className="my-3">
              <label>To</label>
              <DatePicker 
            format={'DD-MM-YYYY'} 
            value={to ? moment(to) : null}
            style={{ width: "100%", borderRadius:"6px" }} 
            className='datePicker-modern'
            onChange={(e) => setTo(e ? e.endOf("day").toISOString() : null)} />
            </Col>
            </Row>
            <Row className='card-section2'>
              <Col md={8} className="my-2">
                <label className='mt-0'>Company</label>
                <Radio.Group className='mt-1'
                  value={company}
                  onChange={(e) => {
                    setCompany(e.target.value);
                  }}
                >
                  <Row style={{marginLeft: '5px'}}>
                    {companyOptions().map((c) => (
                      <Radio key={c.value} value={c.value}>{c.label}</Radio>
                    ))}
                  </Row>
                </Radio.Group>
              </Col>
            </Row>
          </div>
        </Col>
        <Col md={5} >
        <div className="card-section">
              <Col md={12} className="mt-3">
            <h6>Debit Account</h6>
            <Select
              showSearch
              allowClear
              style={{ width: '100%' }}
              onChange={(e) => setDebitAccount(e)}
              options={records}
              className='select-modern'
              value={debitAccount}
              placeholder="Debit Account"
              filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              filterSort={(optionA, optionB) =>
                (optionA?.label ?? '').toLowerCase().localeCompare((optionB?.label ?? '').toLowerCase())
              }
            />
          </Col>
          <br />
            <Col md={12} className="my-3">
              <h6>Credit Account</h6>
              <Select
                showSearch
                allowClear
                style={{ width: '100%' }}
                placeholder="Credit Account"
                onChange={(e) => setCreditAccount(e)}
                options={records}
                className='select-modern'
                value={creditAccount}
                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                filterSort={(optionA, optionB) =>
                  (optionA?.label ?? '').toLowerCase().localeCompare((optionB?.label ?? '').toLowerCase())
                }
                
              />
              
            </Col>
                </div>
              </Col>
          </Row>
      
      
      </div>
      {/* modal open  */}
      <Modal open={visible} width={"80%"} style={{ top: '20px' }} onOk={() => setVisible(false)}
        onCancel={() => { setVisible(false); setVoucherRecords([]); }}
        footer={false} maskClosable={false}
        title={`Account Activity`}
      >
        {currentRecords.length > 0 &&
          <div style={{ maxHeight: 500, overflowY: 'auto', overflowX: 'hidden' }}>
            {currentRecords.map((z, i) => {
              return (
                <div className='table-sm-1' key={i}>
                  <Row style={{ fontSize: 15 }} className="mb-2">
                    <Col md={4}>
                      <span>Voucher No:</span> <span className='grey-txt'>{z.voucher_Id}</span>
                    </Col>
                    <Col md={2}>
                      <span>Currency:</span> <span className='grey-txt'>{z.currency}</span>
                    </Col>
                    <Col md={2} className="text-end">
                      <span>Ex Rate:</span> <span className='grey-txt'>{z.exRate}</span>
                    </Col>
                    <Col md={4} className="text-end px-4">
                      <span>Dated:</span> <span className='grey-txt'>{moment(z.createdAt).format("DD-MM-YYYY")}</span>
                    </Col>
                  </Row>
                  <Table className='tableFixHead' bordered style={{ fontSize: 14 }}>
                    <thead>
                      <tr>
                        <th className='' style={{ width: 220 }}>Particular</th>
                        <th className='text-center' style={{ width: 35 }}>Debit</th>
                        <th className='text-center' style={{ width: 35 }}>Credit</th>
                        <th className='text-center' style={{ width: 35 }}>Debit</th>
                        <th className='text-center' style={{ width: 35 }}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {z.Voucher_Heads.length > 0 && z.Voucher_Heads.map((x, index) => {
                        return (
                          <tr key={index}>
                            <td className='fs-13'>{x.Child_Account?.title}</td>
                            <td className='text-end fs-13'>{x.type != "credit" ? <><span className='gl-curr-rep'>{(x.defaultAmount && x.defaultAmount != 0 && z.currency != "PKR") ? `${z.currency}. ` : ''}</span>{(x.defaultAmount && x.defaultAmount != 0 && z.currency != "PKR") ? `${commas(x.defaultAmount)}` : ''}</> : ''}</td>
                            <td className='text-end fs-13'>{x.type == "credit" ? <><span className='gl-curr-rep'>{(x.defaultAmount && x.defaultAmount != 0 && z.currency != "PKR") ? `${z.currency}. ` : ''}</span>{(x.defaultAmount && x.defaultAmount != 0 && z.currency != "PKR") ? `${commas(x.defaultAmount)}` : ''}</> : ''}</td>
                            <td className='text-end fs-13'>{x.type != "credit" ? <><span className='gl-curr-rep'>Rs.{" "}</span>{commas(x.amount)}</> : ''}</td>
                            <td className='text-end fs-13'>{x.type == "credit" ? <><span className='gl-curr-rep'>Rs.{" "}</span>{commas(x.amount)}</> : ''}</td>
                          </tr>
                        )
                      })}
                      <tr>
                        <td>Balance</td>
                        <td></td>
                        <td></td>
                        <td className='text-end fs-13'><span className='gl-curr-rep'>Rs.{" "}</span>{commas(getTotal('debit', z.Voucher_Heads))}</td>
                        <td className='text-end fs-13'><span className='gl-curr-rep'>Rs.{" "}</span>{commas(getTotal('credit', z.Voucher_Heads))}</td>
                      </tr>
                    </tbody>
                  </Table>
                  {voucherRecords.length - 1 > i && <hr />}
                </div>
              )
            })}
          </div>
        }
        <div className='d-flex justify-content-end items-end my-4' style={{ maxWidth: "100%" }} >
          <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={setCurrentPage} />
        </div>
      </Modal>
    </div>
  )
}

export default AccountActivity