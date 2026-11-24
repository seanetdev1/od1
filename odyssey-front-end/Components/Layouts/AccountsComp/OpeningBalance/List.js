import React, { useEffect, useMemo, useState } from 'react';
import Router from 'next/router';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import { DeleteOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import { Input, Spin, Empty } from 'antd';
import Cookies from 'js-cookie';
import { usePageActions } from 'Components/Shared/PageActions';
import RowAction from 'Components/Shared/RowAction';
import openNotification from 'Components/Shared/Notification';

const commas = (a) => { return parseFloat(a || 0).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") };

/* The account an opening balance is FOR - not its contra line, which every
 * one of them has (the opening balance account). */
const accountOf = (x) => {
  const heads = x?.Voucher_Heads || [];
  const own = heads.find((h) => !String(h?.Child_Account?.title || '').toUpperCase().includes('CONTRA'));
  return own || heads[0] || null;
};

/* OPENING BALANCES (2026-11-16 redesign) - the shared list look (styles/
 * dataList): a search and the count, the table filling the page, a row's
 * click opening it and the pencil and bin on the row the pointer is on. It
 * was a bordered bootstrap table opened only from its Voucher Id cell, its
 * delete asking "Are You Sure To Remove This Charge?". */
const OpeningBalance = () => {

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  // The title and New on the toolbar (PageActions).
  usePageActions({
    title: 'Opening Balances',
    new: {
      onClick: () => Router.push("/accounts/openingBalance/new"),
      label: 'New Opening Balance',
      title: 'Create a new opening balance',
    },
  }, []);

  useEffect(() => {
    getData()
  }, [])

  const getData = async() => {
    setLoading(true);
    try {
      const openingBalances = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_OPENING_BALANCES,{
        headers:{"id": `${Cookies.get('companyId')}`}
      }).then((x)=>x.data);
      setRecords(Array.isArray(openingBalances?.result) ? openingBalances.result : []);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not load the opening balances.', 'red');
    } finally {
      setLoading(false);
    }
  }

  // From the row's bin, which asks first (RowAction's confirm).
  const handleDelete = async (x) => {
    try {
      const { data } = await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_DELETE_BASE_VOUCHER, {
        id: x.id,
        employeeId: Cookies.get("loginId")
      });
      if (data?.status && data.status !== 'success') {
        openNotification('Error', data.result || 'Could not delete the opening balance.', 'red');
        return;
      }
      openNotification('Success', `Opening balance ${x.voucher_Id || ''} deleted.`, 'green');
      getData();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not delete the opening balance.', 'red');
    }
  };

  const open = (x) => Router.push(`/accounts/openingBalance/${x.id}`);

  /* Searched here - the list is the whole of them, as the server sends it. */
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter((x) => [x?.voucher_Id, accountOf(x)?.Child_Account?.title, x?.currency, accountOf(x)?.amount]
      .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [records, search]);

  return (
  <div className='base-page-layout dl-screen'>
    <div className='dl-toolbar'>
      <Input allowClear className='dl-search' prefix={<SearchOutlined />} placeholder='Search voucher, account, amount…'
        value={search} onChange={(e) => setSearch(e.target.value)} />
      <span className='dl-total'>
        {loading && <Spin size='small' />}
        {shown.length.toLocaleString()} opening balance{shown.length === 1 ? '' : 's'}
      </span>
    </div>
    <div className={`dl-table-wrap${loading ? ' is-loading' : ''}`}>
      {!shown.length ? (
        <div className='dl-empty'>
          <Empty description={loading ? 'Loading…' : search ? `Nothing matches “${search}”.` : 'No opening balances yet.'} />
        </div>
      ) : (
      <table className='dl-table ob-table'>
        <thead>
          <tr>
            <th>#</th>
            <th>Voucher</th>
            <th>Account</th>
            <th>Side</th>
            <th>Cur.</th>
            <th className='dl-num'>Ex. Rate</th>
            <th className='dl-num'>Amount</th>
            <th>Date</th>
            <th aria-label='Actions' />
          </tr>
        </thead>
        <tbody>
        {shown.map((x, index) => {
          const head = accountOf(x);
          return (
            <tr key={x.id ?? index} className='dl-click' onClick={() => open(x)} title='Open this opening balance'>
              <td className='dl-muted'>{index + 1}</td>
              <td className='dl-strong'>{x?.voucher_Id}</td>
              <td><span className='dl-clip' title={head?.Child_Account?.title}>{head?.Child_Account?.title}</span></td>
              <td>{head?.type ? <span className={`dl-badge ${head.type === 'debit' ? 'tone-blue' : 'tone-amber'}`}>{head.type === 'debit' ? 'Debit' : 'Credit'}</span> : null}</td>
              <td>{x?.currency}</td>
              <td className='dl-num dl-muted'>{x?.exRate}</td>
              <td className='dl-num dl-strong'>{commas(head?.amount)}</td>
              <td className='dl-muted'>{moment(x?.createdAt).format("DD MMM YYYY")}</td>
              <td className='ob-actions' onClick={(e) => e.stopPropagation()}>
                <RowAction Icon={EditOutlined} label='Edit' kind='primary' onClick={() => open(x)} />
                <RowAction Icon={DeleteOutlined} label='Delete' kind='danger'
                  confirm={{ what: 'opening balance', name: x?.voucher_Id, body: 'Its lines go with it, out of the ledger. This cannot be undone.' }}
                  onClick={() => handleDelete(x)} />
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

export default OpeningBalance
