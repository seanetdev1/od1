import Router from 'next/router';
import { usePageActions } from 'Components/Shared/PageActions';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { Radio, Input, Spin, Empty } from 'antd';
import Cookies from 'js-cookie';
import axiosClient from 'apis/axiosClient';
import moment from 'moment';
import { DeleteOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import openNotification from 'Components/Shared/Notification';
import RowAction from 'Components/Shared/RowAction';

const commas = (a) => parseFloat(a || 0).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/* OPENING INVOICES (2026-11-16 redesign) - the shared list look (styles/
 * dataList): Opening Invoice / Opening Bill as a choice in the toolbar, with
 * a search and the count; the table filling the page, amounts right-aligned
 * and to the paisa, and what is still owed on each. It was a radio pair over
 * a bordered table of unformatted figures. */
const List = () => {

  const dispatch = useDispatch();
  const [ type, setType ] = useState("OI");
  const [records, setRecords] = React.useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const state = useSelector((state) => state.openingInvoice);
  const getInvoices = async () => {
    setLoading(true);
    try{
        const result = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/getOpeningInvoices`, {
        headers: {
          companyId: Cookies.get('companyId'),
          type: type,
        }
        })
      setRecords(result.data.status == 'success' && Array.isArray(result.data.result) ? result.data.result : [])
    }catch(e){
      openNotification('Error', e?.response?.data?.result || 'Could not load the opening invoices.', 'red')
    }finally{
      setLoading(false);
    }
  }

  /* From the row's bin, which asks first. It said "deleted" before the server
   * had answered, and whatever the answer was - the call was not awaited. */
  const deleteInvoice = async (record) => {
    try{
      const { data } = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/deleteOpeningInvoices`, {
        // Where the server reads them - see routes/invoice deleteOpeningInvoices.
        headers: { id: record.id, invoice_No: record.invoice_No },
        employeeId: Cookies.get('loginId'),
      })
      if (data?.status !== 'success') {
        openNotification('Error', data?.result || 'Could not delete it.', 'red')
        return
      }
      openNotification('Success', `${record.invoice_No || 'It'} deleted.`, 'green')
      await getInvoices()
    }catch(e){
      openNotification('Error', e?.response?.data?.result || 'Could not delete it.', 'red')
    }
  }

  useEffect(() => {
    getInvoices();
  }, [type])

  useEffect(() => {
    if(state.payType=="Recievable"){
      setType("OI")
    }else{
      setType("OB")
    }
  }, [state.payType])

  // The title and New on the toolbar (PageActions).
  usePageActions({
    title: 'Opening Invoices',
    new: {
      onClick: () => {
        dispatch(incrementTab({"label":"Opening Invoice","key":"3-12","id":"new"}))
        Router.push("/accounts/openingInvoices/new")
      },
      label: 'New Opening Invoice',
      title: 'Create a new opening invoice or bill',
    },
  }, []);

  const open = (record) => Router.push(`/accounts/openingInvoices/${record.id}`);
  const bill = type != "OI";

  /* Searched here - the list is the whole of them, as the server sends it. */
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) => [r.invoice_No, r.party_Name, r.total].some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [records, search]);

  return (
    <div className='base-page-layout dl-screen'>
      <div className='dl-toolbar'>
        <Input allowClear className='dl-search' prefix={<SearchOutlined />} placeholder='Search number, party, amount…'
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <Radio.Group className='dl-segmented' onChange={(e) => setType(e.target.value)} value={type}>
          <Radio.Button value="OI">Opening Invoice</Radio.Button>
          <Radio.Button value="OB">Opening Bill</Radio.Button>
        </Radio.Group>
        <span className='dl-total'>
          {loading && <Spin size='small' />}
          {shown.length.toLocaleString()} opening {bill ? 'bill' : 'invoice'}{shown.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className={`dl-table-wrap${loading ? ' is-loading' : ''}`}>
        {!shown.length ? (
          <div className='dl-empty'>
            <Empty description={loading ? 'Loading…' : search ? `Nothing matches “${search}”.` : `No opening ${bill ? 'bills' : 'invoices'} yet.`} />
          </div>
        ) : (
          <table className='dl-table ob-table'>
            <thead>
              <tr>
                <th>#</th>
                <th>{bill ? 'Bill #' : 'Invoice #'}</th>
                <th>Date</th>
                <th>Party</th>
                <th>Cur.</th>
                <th className='dl-num'>Amount</th>
                <th className='dl-num'>{bill ? "Paid" : "Received"}</th>
                <th className='dl-num'>Balance</th>
                <th aria-label='Actions' />
              </tr>
            </thead>
            <tbody>
              {shown.map((record, index) => {
                const settled = parseFloat(record.payType == "Payble" ? record.paid : record.recieved) || 0;
                const balance = (parseFloat(record.total) || 0) - settled;
                return (
                <tr key={record.id ?? index} className='dl-click' onClick={() => open(record)} title='Open this one'>
                  <td className='dl-muted'>{index+1}</td>
                  <td className='dl-strong'>{record.invoice_No}</td>
                  <td className='dl-muted'>{moment(record.createdAt).format('DD MMM YYYY')}</td>
                  <td><span className='dl-clip' title={record.party_Name}>{record.party_Name}</span></td>
                  <td>{record.currency || 'PKR'}</td>
                  <td className='dl-num dl-strong'>{commas(record.total)}</td>
                  <td className='dl-num'>{commas(settled)}</td>
                  <td className={`dl-num ${balance > 0.004 ? 'ob-due' : 'ob-clear'}`}>{commas(balance)}</td>
                  <td className='ob-actions' onClick={(e) => e.stopPropagation()}>
                    <RowAction Icon={EditOutlined} label='Edit' kind='primary' onClick={() => open(record)} />
                    <RowAction
                      Icon={DeleteOutlined} label='Delete' kind='danger'
                      confirm={{
                        what: bill ? 'opening bill' : 'opening invoice',
                        name: record.invoice_No || record.invoiceNo,
                        body: 'It is part of the opening position carried into Odyssey. This cannot be undone.',
                      }}
                      onClick={() => deleteInvoice(record)}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default List
