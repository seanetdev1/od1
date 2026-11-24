import React, { useState } from 'react';
import { Modal } from 'antd';
import { Row, Col, Table, Spinner } from 'react-bootstrap';
import { v4 as uuidv4 } from 'uuid';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { delay } from "functions/delay"
import { PlusOutlined } from '@ant-design/icons';
import Cookies from 'js-cookie';
import queryClient from 'apis/queryClient';

// canEdit: the user may edit invoices (functions/jobDocRights) - changing an
// invoice's lines is editing the invoice.
//
// invoice / lines: the invoice and its charge lines AS THEY STAND NOW, from
// InvoiceCharges. `data` is only what the page first loaded: reading the
// approved flag from it left "+ Charge" disabled after an Unapprove until the
// page was refreshed (the user's report, 2026-10-24), and the lines saved
// with a new one were the page's first copy. Without them (an older caller),
// `data` as before.
const InvoiceEditor = ({data, invoice, lines, reload, canEdit = true}) => {

  const [load, setLoad] = useState(false);
  const [visible, setVisible] = useState(false);
  const [charges, setCharges] = useState([]);

  const current = invoice || data?.resultOne;
  const locked = String(current?.approved) !== '0' || !canEdit;

  // The lines as they are now, each time it opens.
  const open = () => {
    setCharges([...(lines || data?.resultOne?.Charge_Heads || [])]);
    setVisible(true);
  };

  const appendCharge = () => {
    let tempState = [...charges];
    /* ONE OF ONE, THROUGHOUT. The line is a copy of the invoice's first, for
       its job, party, currency and invoice - and it used to keep that line's
       AMOUNT too: 580 beside a net of 1. The charge sheet works a line out as
       amount x rate x qty, so opening the job turned the placeholder into 580
       USD, and Save Charges stored it. Every figure is set here, the tax and
       discount included, so the sheet shows the same 1 the invoice does. */
    let tempCharge = {
      ...charges[0],
      key_id:uuidv4(),
      particular:'SAMPLE CHARGE',
      qty:'1',
      amount:'1',
      rate_charge:'1',
      discount:'0',
      tax_apply:false,
      taxPerc:'0',
      tax_amount:'0',
      net_amount:'1',
      local_amount:charges[0].ex_rate,
      charge:0
    }
    delete tempCharge.id
    tempState.push({
      ...tempCharge
    });
    setCharges(tempState)
  }

  const save = () => {
    if(!load){
      setLoad(true)
      axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_SAVE_SE_HEADS_NEW, {
        charges:charges, employeeId: Cookies.get("loginId")
      }).then(async(x) => {
        await delay(2000)
        setLoad(false)
        if(x.data.status!=='success'){
          openNotification('Error', x.data.result || 'Something went wrong', 'red')
          return
        }
        setVisible(false)
        openNotification('Success', `Sample Charge Added in Invoice!`, 'green')
        /* THE JOB'S CHARGES TAB READS A CACHED LIST (apis/queryClient keeps it
           for the session), so the new line did not show there - refreshing
           the tab re-read the cache - until Save Charges fetched it again.
           Marked stale here: an open Charges tab fetches now, any other the
           next time it opens. */
        queryClient.invalidateQueries({ queryKey: ['charges'] })
        // Not every screen showing an invoice hands one in: the line is saved
        // either way, and a missing reload must not turn that into a crash
        // ("reload is not a function", the invoice page, 2026-10-24).
        if (typeof reload === 'function') await reload()
      })
    }
  };

  return (
  <>
    <button disabled={locked} className={(locked?'btn-custom-disabled':'btn-custom')+' px-3 text-center'} type='button' onClick={open}>
    <PlusOutlined style={{fontSize:18, marginTop:1, paddingTop:2, paddingBottom:2}} /><span style={{ fontSize:14}}>Charge</span>
    </button>
    {visible &&
      <Modal 
        open={visible}
        onOk={()=>setVisible(false)}
        onCancel={()=> setVisible(false)}
        footer={false}
        maskClosable={false}
      >   
        <Row>
          <Col md={3}>
            <div className='div-btn-custom text-center py-1 fw-8' onClick={appendCharge}>
              Add +
            </div>
          </Col>
          <Col md={12}>
            <div className='table-sm-1 mt-3' style={{maxHeight:300, overflowY:'auto', fontSize:10}}>
              <Table className='tableFixHead' bordered>
                <thead>
                  <tr className=''>
                    <th>Charge Name</th>
                    <th>Amount</th>
                    <th>Currency</th>
                    <th>Ex. Rate</th>
                    <th>Local Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((charge)=>{
                    return(
                      <tr key={charge.key_id||charge.id} className='f table-row-center-singleLine'>
                        <td>{charge.particular}</td>
                        <td>{charge.amount}</td>
                        <td>{charge.currency}</td>
                        <td>{charge.ex_rate}</td>
                        <td>{charge.local_amount}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          </Col>
          <Col md={9}></Col>
          <Col md={3}>
            <div className='div-btn-custom text-center py-1 fw-8' onClick={save}>
              { load? <Spinner size='sm' /> : "Save" }
            </div>
          </Col>
        </Row>
      </Modal>
    }
  </>
  )
}

export default InvoiceEditor
