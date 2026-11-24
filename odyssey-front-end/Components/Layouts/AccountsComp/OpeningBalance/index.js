import { Row, Col, Table, Spinner } from "react-bootstrap";
import React, { useEffect, useState } from 'react';
import { Select, InputNumber, Input } from 'antd';
import Router from "next/router";
import axiosClient from 'apis/axiosClient';
import { CloseCircleOutlined } from "@ant-design/icons";
import openNotification from "Components/Shared/Notification";
import Cookies from "js-cookie";
import { companyOptions } from 'functions/companyBranding';
import { usePageActions } from 'Components/Shared/PageActions';

const commas = (a) => a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const OpeningBalance = ({id, voucherData}) => {

  const [ voucher_Id, setVoucher_Id ] = useState("");
  const [ load, setLoad ] = useState(false);
  const [ exRate, setExRate ] = useState("1");
  const [ accounts, setAccounts ] = useState([]);
  const [ currency, setCurrency ] = useState("PKR");
  const [ companyId, setCompanyId ] = useState("");
  const [ voucherAccounts, setVoucherAccounts ] = useState([]);

  const [ deleteList, setDeleteList ] = useState([]);

  useEffect(() => {
    if(id!="new"){
      setExRate(voucherData.exRate)
      setCurrency(voucherData.currency)
      setVoucher_Id(voucherData.voucher_Id)
      setCompanyId(parseInt(voucherData.CompanyId))
      setVoucherAccounts(voucherData.Voucher_Heads)
    }else if(voucherAccounts.length==0){
      setCompanyId(parseInt(Cookies.get("companyId")))
      let tempAccounts = [...voucherAccounts];
      tempAccounts.push({ defaultAmount:0.0, amount:0.00, type:"debit", narration:"", ChildAccountId:"" });
      tempAccounts.push({ defaultAmount:0.0, amount:0.00, type:"credit", narration:"", ChildAccountId:"" });
      setVoucherAccounts(tempAccounts);
    }
  }, [])

  useEffect(() => {
    if(companyId!="") {
      setLoad(true);
      axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_CHILD_ACCOUNTS,{
        headers:{ companyid: companyId }
      }).then((x) => {
        setAccounts(x.data.result);
        setLoad(false);
      })
    }
  }, [companyId]);

  const setVouchers = (e, i, name, condition)=> {
    
    let tempState = [...voucherAccounts];
    console.log("TempState",tempState)
    if(name!="ChildAccountId"){
      tempState.forEach((x, index)=>{
        tempState[index][name] = e;
        // condition?tempState[index][defaultAmount] = (parseFloat(e) * parseFloat(exRate)).toFixed(2):null;
        // condition?tempState[index].defaultAmount = (parseFloat(e) * parseFloat(exRate)).toFixed(2):null;
        if(condition){
          if(currency!='PKR'){
            tempState[index].defaultAmount = (parseFloat(e) * parseFloat(exRate)).toFixed(2)
          }else{
            tempState[index].defaultAmount = (parseFloat(e)).toFixed(2)
          }
        }
      })
    }else{
      tempState[i][name] = e;
      // condition?tempState[i][defaultAmount] = (parseFloat(e) * parseFloat(exRate)).toFixed(2):null;
      // condition?tempState[i].defaultAmount = (parseFloat(e) * parseFloat(exRate)).toFixed(2):null;
      if(condition){
        if(currency!='PKR'){
          tempState[i].defaultAmount = (parseFloat(e) * parseFloat(exRate)).toFixed(2)
        }else{
          tempState[i].defaultAmount = (parseFloat(e)).toFixed(2)
        }
      }
    }
    setVoucherAccounts(tempState);
  }

  const filterOption = (input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase());

  // The server's reason when a save is refused - no fiscal year selected, a
  // locked year, no contra account. It used to leave the spinner turning with
  // nothing said, so a refused opening balance looked like a slow one.
  const refused = (e, fallback) => openNotification(
    "Error", e?.response?.data?.result || e?.message || fallback, "red"
  );

  // The date it stands on is the server's to decide - the day before the
  // fiscal year opens (functions/voucherDate) - so none is sent.
  const submitData = async() => {
    setLoad(true)
    if(id=="new"){
      try {
        const x = await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_OPENING_BALANCE, {
          exRate, currency, companyId, vType:"OP", costCenter:"KHI",
          type:"Opening Balance", Voucher_Heads:voucherAccounts,
          fiscalYearId: Cookies.get('fiscalYearId'),
        })
        if(x.data.status=="success"){
          openNotification("Success", `Opening Balance Saved Successfully!`, "green")
          Router.push(`/accounts/openingBalance/list`)
        } else {
          refused({ message: x.data.result }, "Could not save the opening balance.")
        }
      } catch (e) {
        refused(e, "Could not save the opening balance.")
      } finally {
        setLoad(false)
      }
    }else{
      try {
        const x = await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_UPDATE_VOUCEHR, {
          id, exRate, currency,
          companyId, vType:"OP", costCenter:"KHI",
          type:"Opening Balance", Voucher_Heads:voucherAccounts,
          employeeId: Cookies.get("loginId")
        })
        if(x.data.status=="success"){
          openNotification("Success", `Opening Balance Updated Successfully!`, "green")
        }else{
          refused({ message: x.data.result }, "Could not update the opening balance.")
        }
      } catch (e) {
        refused(e, "Could not update the opening balance.")
      } finally {
        setLoad(false)
      }
    }
  }

  const removeList = (id) => {
    let tempList = [...voucherAccounts];
    tempList = tempList.filter((x)=>{
      return x.id!==id;
    })
    setVoucherAccounts(tempList);
  }

  // The title and Save on the toolbar (PageActions); Save sat under the lines.
  usePageActions({
    title: id == "new" ? 'New Opening Balance' : `Opening Balance${voucher_Id ? ` ${voucher_Id}` : ''}`,
    save: { onClick: () => submitData(), busy: load, title: 'Save this opening balance' },
  }, [id, voucher_Id, load]);

  const debitTotal = voucherAccounts.filter((x) => x.type === 'debit').reduce((t, x) => t + (parseFloat(x.amount) || 0), 0);
  const creditTotal = voucherAccounts.filter((x) => x.type === 'credit').reduce((t, x) => t + (parseFloat(x.amount) || 0), 0);

  /* THE OPENING BALANCE (2026-11-16 redesign) - a card for the voucher, its
   * two lines in the shared list table (styles/dataList), the same field look
   * as the Voucher screen. It was bootstrap columns of label-over-box pairs,
   * a black pill Back, and a bordered table with the side as bare text. */
  return (
  <div className='base-page-layout ob-screen'>
    <section className='vo-card ob-card'>
      <div className='vo-card-head'>
        <div>
          <div className='vo-label'>Document #</div>
          <div className='vo-number'>{voucher_Id || <span className='vo-muted'>Given when saved</span>}</div>
          {/* The date it stands on is the server's - see submitData. */}
          <div className='vo-hint'>Dated the day before the fiscal year opens.</div>
        </div>
        <button type='button' className='dl-tool' onClick={() => Router.push(`/accounts/openingBalance/list`)}>Back to the list</button>
      </div>
      <div className='vo-grid'>
        <div className='vo-field vo-span-2'>
          <span className='vo-label'>Company</span>
          <Select value={companyId} disabled={id!="new"}
            options={[
              ...companyOptions(),
            ]}
            onChange={(e)=>{
              setCompanyId(e);
              if(voucherAccounts.length>0){
                let tempState = [...voucherAccounts];
                tempState.forEach((x)=>{
                  x.ChildAccountId = ""
                })
                setVoucherAccounts(tempState);
              }
          }}/>
        </div>
        <div className='vo-field'>
          <span className='vo-label'>Currency</span>
          <Select value={currency}
            onChange={(e)=>{
              setCurrency(e);
              if(id=='new'){
                setExRate('1')
              }
            }}
            options={['PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF'].map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div className='vo-field'>
          <span className='vo-label'>Ex. Rate</span>
          <InputNumber value={exRate}
            min={0} disabled={currency=="PKR"}
            onChange={(e)=>{
              setExRate(e);
              if(voucherAccounts.length>0){
                let tempState = [...voucherAccounts];
                tempState.forEach((x)=>{
                  x.defaultAmount = parseFloat(x.amount) * parseFloat(e)
                })
                setVoucherAccounts(tempState);
              }
            }}
          />
        </div>
      </div>
    </section>

    <section className='vo-lines'>
      <div className='vo-lines-head'>
        <h3 className='vo-card-title'>Lines</h3>
        {/* Both sides carry the one amount - typed once, on either line. */}
        <span className={`dl-badge ${Math.abs(debitTotal - creditTotal) < 0.005 ? 'tone-green' : 'tone-red'}`}
          title='Debit and credit must be the same'>
          Dr {commas(debitTotal)} · Cr {commas(creditTotal)}
        </span>
      </div>
      <div className='vo-lines-table'>
        <table className='dl-table'>
          <thead>
            <tr>
              <th>Account</th>
              <th>Side</th>
              <th className='dl-num'>{currency=="PKR" ? 'Amount' : currency}</th>
              {currency!="PKR"&&<th className='dl-num'>Amount (LC)</th>}
              <th>Narration</th>
            </tr>
          </thead>
          <tbody>
            {voucherAccounts.map((x, i)=>{
              return(
                <tr key={i}>
                <td className='vo-col-account'>
                  {!load && <Select defaultValue={""} value={x.ChildAccountId}
                    onChange={(e)=>setVouchers(e,i,'ChildAccountId')}
                    showSearch
                    placeholder='Select Account'
                    filterOption={filterOption}
                    options={ accounts?.map((y) => {
                      return { label:`(${y.code}) ${y.title}`, value:y.id }
                    })}
                  />}
                  {load && <div className='text-center pt-2'><Spinner size='sm' /></div> }
                </td>
                <td className='vo-col-type'>
                  <span className={`dl-badge ${x.type === 'debit' ? 'tone-blue' : 'tone-amber'}`}>{x.type === 'debit' ? 'Debit' : 'Credit'}</span>
                </td>
                <td className='vo-col-amount'>
                  <InputNumber value={x.amount} onChange={(e)=>setVouchers(e,i,'amount', true)} min={"0.0"} />
                </td>
                {currency!="PKR"&&<td className='dl-num vo-col-lc'>
                    {commas(x.amount*exRate)}
                  </td>}
                <td className='vo-col-narration'>
                  <Input value={x.narration} onChange={(e)=>setVouchers(e.target.value,i,'narration')} />
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </section>
  </div>
)}

export default OpeningBalance;
