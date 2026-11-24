import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { DatePicker, InputNumber, Radio, Select } from 'antd'
import { setField, resetState } from '../../../../redux/openingInvoices/openingInvoicesSlice'
import axios from 'axios'
import Router from 'next/router'
import openNotification from "Components/Shared/Notification";
import Cookies from 'js-cookie'
import dayjs from 'dayjs'
import moment from 'moment'
import axiosClient from 'apis/axiosClient';
import { usePageActions } from 'Components/Shared/PageActions';
const commas = (a) => a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const OpeningInvoice = (id) => {
  const dispatch = useDispatch();
  const state = useSelector((state) => state.openingInvoice);


  const fetchAccounts = async () => {
    console.log(state.accountType)
    const accounts = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/misc/parties/getPartiesbyType`,
      { headers:{companyId: Cookies.get('companyId'), type: state.accountType} }
    ).then((x) => {
      console.log(">>", x.data.result)
      dispatch(setField({ field: 'accounts', value: x.data.result }));
    })
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNT_FOR_TRANSACTION, {
      headers: {
        type: "Adjust",
        companyid: Cookies.get('companyId'), 
      }
    }).then((x) => {
      console.log("Accounts:", x)
      dispatch(setField({ field: 'creditAccounts', value: x.data.result }));
    })
  }

  // The one an edit replaces - true once it is gone. See save().
  const deleteInvoice = async (id) => {
    try{
      const { data } = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/deleteOpeningInvoices`, {
        headers: { id }, employeeId: Cookies.get('loginId'),
      })
      return data?.status === 'success'
    }catch(e){
      return false
    }
  }

  const fetchOpeningInvoice = async () => {
    try{
      console.log("Fetching Invoice")
      const result = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/getOpeningInvoice`, {
        headers: {
          id: id.id.id
        }
      })
      console.log("Voucher Heads",result.data.result.voucher.Voucher_Heads)
      dispatch(setField({ field: 'accountType', value: result.data.result.result.partyType }));
      dispatch(setField({ field: 'payType', value: result.data.result.result.payType }));
      result.data.result.result.payType=="Payble"?
      dispatch(setField({ field: 'type', value: "OB" })):
      dispatch(setField({ field: 'type', value: "OI" }));
      dispatch(setField({ field: 'operation', value: result.data.result.result.operation }));
      dispatch(setField({ field: 'currency', value: result.data.result.result.currency }));
      dispatch(setField({ field: 'ex_rate', value: result.data.result.result.ex_rate }));
      result.data.result.voucher.Voucher_Heads.forEach((x)=>{
        if(x.accountType=="payAccount"){
          dispatch(setField({ field: 'creditAccount', value: x.ChildAccountId }));
        }
        if(x.accountType=="partyAccount"){
          // dispatch(setField({ field: 'account', value: x.ChildAccountId }));
        }
      })
      dispatch(setField({ field: 'account', value: result.data.result.result.party_Id }));
      // dispatch(setField({ field: 'creditAccount', value: parseInt(result.data.result.result.party_Id) }));
      // To the paisa - parseInt kept only the rupees, and saving again stored them.
      dispatch(setField({ field: 'total', value: parseFloat(result.data.result.result.total) || 0 }));
      // Its date as ISO text, as the slice starts it - a Moment is a value
      // Redux warns it cannot store; the picker makes a Moment of it.
      const saved = moment(result.data.result.result.date);
      dispatch(setField({ field: 'createdAt', value: saved.isValid() ? saved.toISOString() : null }));
      
      
      
    }catch(e){
      console.log(e)
    }
  }

  useEffect(() => {
    if(id.id.id!='new'){
      fetchOpeningInvoice(id.id.id)
      // dispatch(setField({ field: 'account', value: id.id.id }));
    }
  }, [id.id.id])

  useEffect(() => {
    fetchAccounts();
  }, [state.accountType])
  const selectedAccount = state.accounts?.find((x) => {
  const clientId = x?.Client_Associations?.[0]?.ChildAccountId;
  const vendorId = x?.Vendor_Associations?.[0]?.ChildAccountId;

    return clientId === state.account || vendorId === state.account;
  });
  const partyName = selectedAccount?.name || "N/A";
  /* SAVING AN EDIT REPLACES THE INVOICE: the new one is made, and only once
   * it is saved is the old one taken away. It was the other way round - the
   * old one deleted first, without waiting, then the new one made - so a save
   * refused ("Invalid Exchange Rate", a server error) left the invoice gone
   * and nothing in its place. */
  const save = async () => {
    if(state.currency!="PKR" && state.ex_rate<=100){
      openNotification("Error", `Invalid Exchange Rate`, "red")
      return
    }
    try {
      const result = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/openingInvoice`, {
        party_Id: state.account,
        party_Name: partyName,
        type: state.type,
        // Through moment: a new one starts with the date as TEXT (the store's
        // default), and text has no toISOString - the save threw before it was sent.
        date: state.createdAt ? moment(state.createdAt).toISOString() : null,
        amount: state.total,
        currency: state.currency,
        payType: state.payType,
        creditAccount: state.creditAccount,
        exRate: state.ex_rate,
        operation: state.operation,
        partyType: state.accountType,
        companyId: Cookies.get('companyId'),
        fiscalYearId: Cookies.get('fiscalYearId'),
      })
      if (result.data.status != 'success') {
        openNotification("Error", result.data.result || 'Could not save it.', "red")
        return
      }
      if(id.id.id != "new"){
        const removed = await deleteInvoice(id.id.id)
        if (!removed) {
          openNotification("Saved - check the list", 'The new one is saved, but the one it replaces could not be removed. Delete the old one from the list.', "orange")
        }
      }
      Router.push('/accounts/openingInvoices/list')
      dispatch(resetState())
    } catch (e) {
      openNotification("Error", e?.response?.data?.result || e?.message || 'Could not save it.', "red")
    }
  }

  // The title and Save on the toolbar (PageActions); Save sat under the form.
  usePageActions({
    title: id?.id?.id == 'new' ? 'New Opening Invoice' : 'Opening Invoice',
    save: { onClick: () => save(), title: 'Save this opening invoice' },
  }, [id?.id?.id]);

  const bill = state.payType == 'Payble';

  /* THE OPENING INVOICE (2026-11-16 redesign) - one card in the field look
   * of the Voucher screen. It was rows of label-and-box pairs at hand-set
   * percentage widths, a green Back above a rule, and the Type as a locked
   * dropdown. */
  return (
    <div className='base-page-layout oi-screen'>
      <section className='vo-card oi-card'>
        <div className='vo-card-head'>
          <div>
            <div className='vo-label'>{bill ? 'Opening Bill' : 'Opening Invoice'}</div>
            <div className='vo-number'>{partyName !== 'N/A' ? partyName : <span className='vo-muted'>Choose the party</span>}</div>
            <div className='vo-hint'>{bill ? 'What we owed them when the books moved to Odyssey.' : 'What they owed us when the books moved to Odyssey.'}</div>
          </div>
          <button type='button' className='dl-tool' onClick={()=>{
            dispatch(resetState())
            Router.push('/accounts/openingInvoices/list')
          }}>Back to the list</button>
        </div>

        <div className='vo-grid'>
          <div className='vo-field'>
            <span className='vo-label'>Account Type</span>
            <Radio.Group className='dl-segmented' value={state.accountType} onChange={(e)=>{
              if(e.target.value == 'client'){
                dispatch(setField({ field: 'accountType', value: e.target.value }));
                dispatch(setField({ field: 'payType', value: 'Recievable' }));
                dispatch(setField({ field: 'currency', value: 'PKR' }));
                dispatch(setField({ field: 'account', value: undefined}));
                dispatch(setField({ field: 'type', value: 'OI'}));
              }
            }}>
              <Radio.Button value={'client'}>Client</Radio.Button>
            </Radio.Group>
          </div>
          <div className='vo-field'>
            <span className='vo-label'>Pay Type</span>
            <Radio.Group className='dl-segmented' value={state.payType} onChange={(ev) => {
              const e = ev.target.value;
              dispatch(setField({ field: 'payType', value: e }));
              e==="Recievable"?dispatch(setField({ field: 'type', value: "OI" })):dispatch(setField({ field: 'type', value: "OB" }))
            }}>
              <Radio.Button value="Recievable">Receivable</Radio.Button>
              <Radio.Button value="Payble">Payable</Radio.Button>
            </Radio.Group>
          </div>
          <div className='vo-field'>
            <span className='vo-label'>Operation</span>
            <Select value={state.operation} placeholder='Operation' onChange={(e) => dispatch(setField({ field: 'operation', value: e }))}>
              <Select.Option value="AE">Air Export</Select.Option>
              <Select.Option value="AI">Air Import</Select.Option>
              <Select.Option value="SE">Sea Export</Select.Option>
              <Select.Option value="SI">Sea Import</Select.Option>
            </Select>
          </div>
          <div className='vo-field'>
            <span className='vo-label'>Date</span>
            <DatePicker
              format='DD MMM YYYY'
              value={state.createdAt ? moment(state.createdAt) : null}
              onChange={(date) => {
                dispatch(setField({ field: 'createdAt', value: date ? date.toISOString() : null }))
              }}
            />
          </div>

          <div className='vo-field vo-span-2'>
            <span className='vo-label'>Party Account</span>
            <Select
              allowClear
              showSearch
              placeholder="Select Account"
              value={state.account}
              options={state.accounts.map((account) => {
                const clientId = account.Client_Associations?.[0]?.ChildAccountId;
                const vendorId = account.Vendor_Associations?.[0]?.ChildAccountId;
                return {
                  label: `(${account.code}) ${account.name}`,
                  value: clientId || vendorId || null,
                };
              })}
              filterOption={(input, option) =>
                option?.label?.toLowerCase().includes(input.toLowerCase())
              }
              onChange={(e) => {
                dispatch(setField({ field: 'account', value: e }))
              }}
            />
          </div>
          <div className='vo-field vo-span-2'>
            <span className='vo-label'>Settlement Account</span>
            <Select
              allowClear
              showSearch
              placeholder={`Select Account`}
              value={state.creditAccount}
              options={state.creditAccounts.map((account) => ({
                label: `(${account.code}) ${account.title}`,
                value: account.id,
              }))}
              filterOption={(input, option) =>
                option?.label.toLowerCase().includes(input.toLowerCase())
              }
              onChange={(e) => {dispatch(setField({ field: 'creditAccount', value: e }))}}
            />
          </div>

          <div className='vo-field'>
            <span className='vo-label'>Currency</span>
            <Select disabled={state.accountType!='agent'} value={state.currency}
              title={state.accountType!='agent' ? "A client's opening invoice is in rupees" : undefined}
              onChange={(e) => {dispatch(setField({ field: 'currency', value: e })); e=='PKR'?dispatch(setField({ field: 'ex_rate', value: 1.0 })):null}}
              options={['PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF'].map((c) => ({ value: c, label: c }))} />
          </div>
          <div className='vo-field'>
            <span className='vo-label'>Ex. Rate</span>
            <InputNumber
              value={state.ex_rate}
              disabled={state.currency == 'PKR' ? true : false}
              onChange={(e) => dispatch(setField({ field: 'ex_rate', value: e }))}
            />
          </div>
          <div className='vo-field vo-span-2'>
            <span className='vo-label'>Amount</span>
            <InputNumber
              className='oi-amount'
              value={state.total}
              formatter={(value) =>
                `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
              }
              parser={(value) =>
                value?.replace(/,/g, '')
              }
              onChange={(e) => dispatch(setField({ field: 'total', value: e }))}
            />
            {state.currency!="PKR" && <span className='vo-hint'>Local amount: PKR {commas(state.total*state.ex_rate)}</span>}
          </div>
        </div>
      </section>
    </div>
  )
}

export default OpeningInvoice
