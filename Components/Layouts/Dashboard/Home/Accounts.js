import React, { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';
import SecondaryLoader from 'Components/Shared/SecondaryLoader';
import { Table, Row, Col } from 'react-bootstrap';
import { Tag, Tooltip } from 'antd';
import moment from "moment";
import Router from 'next/router';

// Pending Invoices/Bills - what is still owed.
//
// INVOICE-DRIVEN, not job-driven. The panel used to list SE_Jobs and count the
// invoices under each, which meant an aviation or customs invoice could not
// appear at all: neither has an SE_Job (their charges hang off an AWB and a
// goods declaration respectively), so the inner join excluded them and the
// panel showed nothing on those installs.
//
// It also asked for `approved:'0'` - pending APPROVAL rather than pending
// payment - and aviation/customs invoices are approved the moment they are
// raised. So the rows a user was looking for were excluded twice over.
//
// Columns are therefore the invoice's own. `source` is where it came from,
// resolved server-side, because a flight, a sea job and a goods declaration
// describe themselves differently and the panel should not have to know that.
const SOURCE_LABEL = { freight: 'Job', aviation: 'Flight', customs: 'GD' };
const SOURCE_COLOR = { freight: 'blue', aviation: 'purple', customs: 'gold' };

// 'Payble' and 'Recievable' are the app's own misspellings and are what the
// column actually contains - see the backend. Matching the correct spelling
// here would classify every bill as a receivable.
const isBill = (x) => x.payType === 'Payble';

const fmt = (n) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Accounts = () => {

  useEffect(() => { getData(); }, [])

  const [records, setRecords] = useState([]);
  const [summary, setSummary] = useState({ shown: 0, count: 0, amount: 0 });
  const [load, setLoad] = useState(true);

  const getData = async() => {
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_HOME_ACCOUNTS)
    .then((x)=>{
      // Default to []: a failing query on the backend can reply with no
      // `result` at all, and rendering the table then crashes the whole
      // dashboard on records.map rather than just showing an empty panel.
      setRecords(Array.isArray(x.data.result) ? x.data.result : []);
      setSummary(x.data.summary || { shown: 0, count: 0, amount: 0 });
      setLoad(false);
    })
    .catch(()=>{ setRecords([]); setLoad(false); })
  }

  // Opening the invoice, the same way every other invoice link in the app
  // does it.
  const openInvoice = (x) => {
    if (!x?.id) return;
    Router.push(`/reports/invoice/${x.id}`);
  };

  return (
    <div className='pending-invoices'>
      {load?
        <div className='text-center'> <SecondaryLoader/> </div>
      :
      <>
      <Row>
        <Col className='d-flex justify-content-between align-items-start'>
          <h4 className='fw-7 mb-0'>
            Pending Invoices/Bills
            <span className='grey-txt fs-13'>
              {' '}(unpaid{summary.count > records.length ? ` — ${records.length} most recent of ${summary.count}` : ''})
            </span>
          </h4>
          <span className='custom-link fs-12' onClick={()=>Router.push('/accounts/invoiceAndBills')}>View All →</span>
        </Col>
      </Row>
      <hr className='mb-0'/>

      {records.length === 0 ? (
        <div className='grey-txt fs-13 py-4 text-center'>
          Nothing outstanding — every invoice and bill has been settled.
        </div>
      ) : (
      <>
        {/* The figure the panel exists for, before the list of what makes it
            up. */}
        <div className='outstanding-bar'>
          <span className='label'>Total outstanding</span>
          <span className='value'>{fmt(summary.amount)}</span>
          <span className='grey-txt fs-11'>
            across {summary.count} document{summary.count === 1 ? '' : 's'}
          </span>
        </div>

        <div style={{maxHeight:320, overflowY:'auto'}}>
          <Table className='tableFixHead'>
          <thead>
            <tr style={{whiteSpace:"nowrap"}}>
              <th>Invoice No.</th>
              <th>Source</th>
              <th>Party</th>
              <th className='text-end'>Total</th>
              <th className='text-end'>Outstanding</th>
              <th className='text-center'>Date</th>
            </tr>
          </thead>
          <tbody>
          {records.map((x, index) => (
            <tr key={x.id ?? index} className='f fs-12 tr-clickable' onClick={()=>openInvoice(x)}>
              <td className='fw-7'>
                {x.invoice_No}
                <Tag className='ms-2' color={isBill(x) ? 'volcano' : 'green'}>
                  {isBill(x) ? 'Bill' : 'Invoice'}
                </Tag>
                {/* An invoice that has not been approved is not in the ledger
                    yet. Shown rather than filtered out - it is still money
                    expected, and hiding it is how the old panel came to show
                    only unapproved rows. */}
                {String(x.approved) !== '1' && (
                  <Tooltip title='Not approved yet — this has not reached the ledger'>
                    <Tag color='orange'>Unapproved</Tag>
                  </Tooltip>
                )}
              </td>
              <td className='fs-11'>
                {x.source ? (
                  <>
                    <Tag color={SOURCE_COLOR[x.source.kind] || 'default'}>
                      {SOURCE_LABEL[x.source.kind] || x.source.kind}
                    </Tag>
                    <span className='fw-6'>{x.source.jobNo || '—'}</span>
                    {x.source.detail && <span className='grey-txt'> · {x.source.detail}</span>}
                  </>
                ) : <span className='grey-txt'>—</span>}
              </td>
              <td className='fw-5 grey-txt'>{x.party_Name || x.source?.client || '—'}</td>
              <td className='text-end num'>{fmt(x.total)}</td>
              <td className='text-end num outstanding'>{fmt(x.outstanding)}</td>
              <td className='text-center fw-5 grey-txt'>{moment(x.createdAt).format("DD-MM-YYYY")}</td>
            </tr>
          ))}
          </tbody>
          </Table>
        </div>
      </>
      )}
      </>
      }

      <style jsx global>{`
        .pending-invoices .outstanding-bar {
          display: flex;
          align-items: baseline;
          gap: 10px;
          padding: 8px 0 6px;
        }
        .pending-invoices .outstanding-bar .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
        }
        .pending-invoices .outstanding-bar .value {
          font-size: 20px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: #cf1322;
        }
        .pending-invoices th {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          white-space: nowrap;
        }
        .pending-invoices td { vertical-align: middle; }
        .pending-invoices td.num { font-variant-numeric: tabular-nums; }
        .pending-invoices td.outstanding { font-weight: 700; color: #cf1322; }
        .pending-invoices .ant-tag { margin-right: 4px; line-height: 17px; font-size: 10px; }
      `}</style>
    </div>
  )
}

export default Accounts
