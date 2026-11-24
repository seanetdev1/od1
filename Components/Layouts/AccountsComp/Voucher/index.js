import openNotification from "Components/Shared/Notification";
import { Col, Row, Spinner } from "react-bootstrap";
import React, { useState, useEffect } from "react";
import axiosClient from "apis/axiosClient";
import { useSelector, useDispatch } from 'react-redux';
import Router from "next/router";
import Cookies from 'js-cookie';
import VoucherPrint from "./VoucherPrint";
import Print from "./Print";
import { setField, resetState } from 'redux/vouchers/voucherSlice';
// Never imported: opening a voucher that no longer exists threw here instead
// of sending the tab to a new voucher.
import { incrementTab } from 'redux/tabs/tabSlice';
import { Alert, DatePicker, Input, InputNumber, Select, Radio } from "antd";
import { CloseCircleOutlined, PlusOutlined } from "@ant-design/icons";
import moment from "moment";
import { delay } from "functions/delay";
import { useReactToPrint } from "react-to-print";
import { useRef } from "react";
import { usePageActions } from 'Components/Shared/PageActions';
import { useDocuments } from 'Components/Shared/Documents';
import { sourceLink } from 'functions/voucherSource';
import AuditStamp from 'Components/Shared/AuditStamp';
import PostingPreview, { postingRows } from 'Components/Shared/PostingPreview';
import { companyTitle, getCompany } from 'functions/companyBranding';
import { downloadVoucherExcel } from 'functions/voucherExcel';
import { hasSettlementLine, voucherTotals, settlementAmount, defaultLineSide, isReceipt, voucherSummary } from 'functions/voucherTotals';
import { isCashVoucher, pickerDate } from 'functions/cashCheque';
import { voucherLineHasData, voucherLinesToSave, withBlankLastVoucherLine, blankVoucherLine, mirroredLines } from 'functions/voucherLines';

// The kinds of voucher, and what each is - the Type choice names them on hover.
const VOUCHER_TYPES = [
  ['CRV', 'Cash receipt'], ['CPV', 'Cash payment'], ['BRV', 'Bank receipt'],
  ['BPV', 'Bank payment'], ['JV', 'Journal voucher'], ['TV', 'Transfer voucher'],
];

const Voucher = ({ id }) => {
  const printRef = useRef(null);
  const [voucherBuffer, setVoucherBuffer] = useState(false)
  // The voucher save has built, shown for approval before it is sent - see
  // post() below. null when nothing is waiting.
  const [pending, setPending] = useState(null)
  const [posting, setPosting] = useState(false)
  const commas = (a) => a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

  const state  = useSelector((state) => state.vouchers);
  const fiscalYearId = useSelector((state) => state.fiscalYear.value);
  const dispatch = useDispatch();
  const [ CompanyId, setCompanyId] = useState(Cookies.get('companyId'))
  const box = { border: '1px solid silver', paddingLeft: 10, paddingTop: 5, paddingBottom: 3, minHeight: 31 }
  const summary = voucherSummary(state.Voucher_Heads, state.vType)
  const [ voucher, setVoucher ]  = useState({})
  // The record it belongs to, when another screen made it - functions/
  // voucherSource. Changing or deleting it is that screen's.
  const [ source, setSource ] = useState(null)
  const fetchVoucherData = async () => {
    return axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_VOUCHER_BY_ID, { 
        headers:{ "id": `${id}` }
    }).then((x)=>{
      console.log("Id ka Result:", x.data.result)
      if(x.data.result == null){
        dispatch(incrementTab({ "label": "Voucher", "key": "3-5", "id": "new" }))
        dispatch(resetState())
        Router.push(`/accounts/vouchers/new`)
      }
      setVoucher(x.data.result)
      setSource(x.data.source || null)
      dispatch(setField({ field: 'edit', value: true }))
      dispatch(setField({ field: 'id', value: x.data.result.id }))
      dispatch(setField({ field: 'voucher_id', value: x.data.result.voucher_Id }))
      dispatch(setField({ field: 'voucher_No', value: x.data.result.voucher_No }))
      // Its own date or none - a voucher without one used to keep whatever the
      // last voucher opened (or today) had left in the field.
      dispatch(setField({ field: 'chequeDate', value: x.data.result.chequeDate ? moment(x.data.result.chequeDate.toString()).toISOString() : null }))
      // Dates are kept as ISO text, as the slice starts them - a Moment is a
      // value Redux warns it cannot store. JSON sent a Moment as this same
      // text, so what is saved does not change; the pickers make a Moment of it.
      dispatch(setField({ field: 'date', value: moment(x.data.result.createdAt?.toString()).toISOString() }))
      dispatch(setField({ field: 'vType', value: x.data.result.vType }))
      setCompanyId(x.data.result.CompanyId)
      dispatch(setField({ field: 'chequeNo', value: x.data.result.chequeNo }))
      dispatch(setField({ field: 'currency', value: x.data.result.currency }))
      dispatch(setField({ field: 'exRate', value: x.data.result.exRate }))
      let temp = []
      // Cleared first: a JV / TV has no bank or cash line to set it from, and
      // the last voucher opened would otherwise fill this one's empty lines.
      dispatch(setField({ field: 'voucherNarration', value: '' }));
      x.data.result.Voucher_Heads.forEach((x)=>{
        if(x.accountType=="payAccount"){
          dispatch(setField({ field: 'settleVoucherHead', value: x }));
          dispatch(setField({ field: 'settlementAccount', value: x.ChildAccountId }));
          dispatch(setField({ field: 'voucherNarration', value: x.narration }));
        }else{
          temp.push(x)
        }
      })
      dispatch(setField({ field: 'Voucher_Heads', value: temp }))
      dispatch(setField({ field: 'edit', value: true }))
      console.log(">>>>>>>", x.data.result)
        // console.log(x)
    });
  }

  const fetchAccounts = async () => {
    try {
      const response = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_CHILD_ACCOUNTS, {
        headers: {
          CompanyId: CompanyId,
        },
      });
      dispatch(setField({ field: 'cAccounts', value: response.data.result }));
    } catch (error) {
      console.error("Error fetching child accounts:", error);
    }
  }

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect( () => {
    if(state.vType=="BPV" || state.vType=="BRV" || state.vType=="CPV" || state.vType=="CRV"){
      if(state.Voucher_Heads.length<1){
        let temp = [...state.Voucher_Heads]
        let Type = ""
        Type = state.vType=="CPV"||state.vType=="BPV"?"debit":state.vType=="CRV"||state.vType=="BRV"?"credit":""
        temp.push({
          defaultAmount: 0.0,
          amount: 0.0,
          type: Type,
          narration: "",
          settlement: "",
          accountType: "",
          ChildAccountId: undefined,
        })
        let temp1 = {
          ...state.settleVoucherHead,
          type: Type=="debit"?"credit":"debit"
        }
        dispatch(setField({ field: 'settleVoucherHead', value: temp1 }))
        dispatch(setField({ field: 'Voucher_Heads', value: temp }))
      }
    }else{
      if(state.Voucher_Heads.length<1){
        let temp = [...state.Voucher_Heads]
        let Type = ""
        // Type = state.vType=="CPV"||state.vType=="BPV"?"debit":state.vType=="CRV"||state.vType=="BRV"?"credit":""
        temp.push({
          defaultAmount: 0.0,
          amount: 0.0,
          type: "debit",
          narration: "",
          settlement: "",
          accountType: "",
          ChildAccountId: undefined,
        })
        // temp.push({
        //   defaultAmount: 0.0,
        //   amount: 0.0,
        //   type: "credit",
        //   narration: "",
        //   settlement: "",
        //   accountType: "",
        //   ChildAccountId: undefined,
        //   createdAt: moment()
        // })
        dispatch(setField({ field: 'Voucher_Heads', value: temp }))
      }
    }
  },[state.vType])

  const fetchreceivingAccount = async () => {
    let y = "";
  switch (state.vType) {
    case "BPV":
    case "BRV":
      y = "Bank";
      break;
    case "CPV":
    case "CRV":
      y = "Cash";
      break;
    case "TV":
      y = "Bank";
      break;
    default:
      y = "All"
      break;
  }
    try{
      await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNT_FOR_TRANSACTION_VOUCHER, {
        headers: {
          type: y,
          companyid: CompanyId,
        }
      }).then((x) => {
        console.log(x.data.result)
        dispatch(setField({ field: 'settlementAccounts', value: x.data.result }))
      })
    }catch(e){
      console.log(e)
    }
  }
  useEffect(() => {
    fetchreceivingAccount()
  }, [state.vType])

  /* A BLANK LINE AT THE BOTTOM, ALWAYS, as Direct Job E/R has one (the
   * user's request, 2026-11-16): typing into the last line adds the next, so
   * lines are entered without reaching for Add Row. It is never saved - see
   * save() and functions/voucherLines. */
  useEffect(() => {
    const lines = withBlankLastVoucherLine(state.Voucher_Heads, state.vType)
    if (lines) dispatch(setField({ field: 'Voucher_Heads', value: lines }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.Voucher_Heads, state.vType])

  useEffect(() => {
    if(id!="new"){
      dispatch(resetState())
      fetchVoucherData()
      dispatch(setField({ field: 'edit', value: true }))
    }
  }, [id])

  useEffect(() => {
    console.log("STATE:", state)
  },[state])

  // From the toolbar's Delete, which asks first. The server refuses a
  // voucher another record made, and says which.
  const deleteVoucher = async () => {
    try {
      const x = await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_DELETE_BASE_VOUCHER, {
        id, employeeId: Cookies.get("loginId")
      })
      if (x.data.status !== 'success') {
        openNotification('Error', x.data.result || 'The voucher could not be deleted.', 'red')
        return
      }
      openNotification('Success', `Voucher ${state.voucher_id || ''} deleted.`, 'green')
      Router.push("/accounts/voucherList")
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'The voucher could not be deleted.', 'red')
    }
  };

  const openSource = () => {
    const link = sourceLink(source?.open)
    if (!link) return
    dispatch(incrementTab(link.tab))
    Router.push(link.path)
  };

  const save = async () => {
    await setVoucherBuffer(true)
    await delay(500)
    if(voucherBuffer){
      openNotification('Please Wait', `Already Saving`, 'Orange')
      return
    }
    if(state.vType==""||state.vType==undefined){
      openNotification('Error', `Type not Selected`, 'red')
      await setVoucherBuffer(false)
      return
    }
    // The filled lines - the blank one at the bottom is never sent.
    const lines = voucherLinesToSave(state.Voucher_Heads)
    if(lines.length==0){
      openNotification('Error', 'No lines entered', 'red')
      await setVoucherBuffer(false)
      return
    }
    let i = 0
    for(let x of lines){
      i++
      if(x.ChildAccountId==""||x.ChildAccountId==undefined){
        openNotification('Error', `Account not Selected in Row ${i}`, 'red')
        await setVoucherBuffer(false)
        return
      }
    }
    // state.vType==""||state.vType==undefined?openNotification('Error', `Type not Selected`, 'red'):null
    if(state.vType!="JV"&&state.vType!="TV"){
      if(state.settlementAccount==""||state.settlementAccount==undefined){
        openNotification('Error', `Settlement Account not Selected`, 'red')
        await setVoucherBuffer(false)
        return
      }
    }else {
      if(lines.length<2){
        openNotification('Error', "Must have atleast two accoutns", 'orange')
        await setVoucherBuffer(false)
        return
      }else{
        let d = false
        let c = false
        lines.forEach((vh) => {
          vh.type=='debit'?d=true:null
          vh.type=='credit'?c=true:null
        })
        if(!d && !c){
          openNotification('Error', 'Must have a credit and debit Account', 'orange')
          await setVoucherBuffer(false)
          return
        }
      }
    }
    if(state.creditTotal==0.0&&state.debitTotal==0.0){
      openNotification('Error', `No amount entered`, 'red')
      await setVoucherBuffer(false)
      return
    }
    // A payment's lines may carry a credit (a loan instalment held back) and
    // a receipt's a debit (bank charges), but they must still come out on the
    // voucher's own side - otherwise the bank or cash would be paying where
    // it should receive, which is the other kind of voucher.
    if(hasSettlementLine(state.vType) && settlementAmount(lines, state.vType) <= 0){
      openNotification('Error', isReceipt(state.vType)
        ? 'The lines of a receipt must come to more credit than debit - the bank or cash receives the difference.'
        : 'The lines of a payment must come to more debit than credit - the bank or cash pays out the difference.', 'red')
      await setVoucherBuffer(false)
      return
    }
    // state.creditTotal==0.0||state.creditTotal==undefined?{openNotification('Error', `No amount entered`, 'red')
    //   await setVoucherBuffer(false)
    //   return
    // }:null
    // state.debitTotal==0.0||state.debitTotal==undefined?{openNotification('Error', `No amount entered`, 'red')
    //   await setVoucherBuffer(false)
    //   return
    // }:null
    lines.forEach((x)=>{
      x.ChildAccountId==""||x.ChildAccountId==undefined?openNotification('Error', `Account not Selected`, 'red'):null
    })
    let narration  = ""
    if(state.vType=="BPV"){
      narration = `Bank Payment ${state.chequeNo!=""?"on Cheque No: "+state.chequeNo+"Date: "+moment(state.chequeDate).format("DD-MM-YYYY"):""}from `
      lines.forEach((x)=>{
        narration = narration + `${(state.cAccounts.find(y=>y.id==x.ChildAccountId)?.title || '')}, `
      })
      narration = narration + `to ${(state.settlementAccounts.find(x=>x.id==state.settlementAccount)?.title || '')}`
    }
    if(state.vType=="BRV"){
      narration = `Bank Receipt ${state.chequeNo!=""?"on Cheque No: "+state.chequeNo+", "+"Date: "+moment(state.chequeDate).format("DD-MM-YYYY")+", ":""}from `
      lines.forEach((x)=>{
        narration = narration + `${(state.cAccounts.find(y=>y.id==x.ChildAccountId)?.title || '')}, `
      })
      narration = narration + `to ${(state.settlementAccounts.find(x=>x.id==state.settlementAccount)?.title || '')}`
    }
    // Cash has no cheque to name - see functions/cashCheque.
    if(state.vType=="CPV"){
      narration = `Cash Payment from `
      lines.forEach((x)=>{
        narration = narration + `${(state.cAccounts.find(y=>y.id==x.ChildAccountId)?.title || '')}, `
      })
      narration = narration + `to ${(state.settlementAccounts.find(x=>x.id==state.settlementAccount)?.title || '')}`
    }
    if(state.vType=="CRV"){
      narration = `Cash Receipt from `
      lines.forEach((x)=>{
        narration = narration + `${(state.cAccounts.find(y=>y.id==x.ChildAccountId)?.title || '')}, `
      })
      narration = narration + `to ${(state.settlementAccounts.find(x=>x.id==state.settlementAccount)?.title || '')}`
    }
    if(state.vType=="JV"){
      narration = `Journal Transaction ${state.chequeNo!=""?"on Cheque No: "+state.chequeNo+", "+"Date: "+moment(state.chequeDate).format("DD-MM-YYYY")+", ":""}between `
      lines.forEach((x)=>{
        narration = narration + `${(state.cAccounts.find(y=>y.id==x.ChildAccountId)?.title || '')}, `
      })
    }
    if(state.vType=="TV"){
      narration = `Transfer ${state.chequeNo!=""?"on Cheque No: "+state.chequeNo+", "+"Date: "+moment(state.chequeDate).format("DD-MM-YYYY")+", ":""}between `
      lines.forEach((x)=>{
        narration = narration + `${(state.cAccounts.find(y=>y.id==x.ChildAccountId)?.title || '')}, `
      })
    }

    
      let voucher = {
        type: `${state.vType=="CRV"||state.vType=="BRV"?"Receipt":state.vType=="CPV"||state.vType=="BPV"?"Payment":state.vType=="JV"?"Journal":"Transfer"} Voucher`,
        vType: state.vType,
        currency: state.currency,
        exRate: state.exRate,
        // The fields are disabled on cash, not empty - a cash voucher sent
        // the picker's default date. See functions/cashCheque.
        chequeNo: isCashVoucher(state.vType) ? '' : state.chequeNo,
        chequeDate: isCashVoucher(state.vType) ? null : state.chequeDate,
        costCenter: 'KHI',
        tranDate: state.date,
        subType: state.vType=="CPV"||state.vType=="CRV"?"Cash":state.vType=="BPV"||"BRV"?"Bank":state.vType=="JV"?"Journal":"Transfer",
        CompanyId: CompanyId,
        createdAt: state.date,
        fiscalYearId: fiscalYearId,
      }
      if(state.edit){
        voucher.voucher_No = state.voucher_No
        voucher.voucher_Id = state.voucher_id
      }
      // A line with no narration of its own: on a JV / TV (no bank or cash
      // line for the box above to name) the box's text when there is some,
      // otherwise the generated one.
      const noSettlement = state.vType=="JV"||state.vType=="TV"
      const lineDefault = noSettlement && String(state.voucherNarration||"").trim()!="" ? state.voucherNarration : narration
      let temp = []
      lines.forEach((x)=>{
        temp.push({
          ...x,
          narration: String(x.narration||"").trim()==""?lineDefault:x.narration,
          createdAt: state.date,
          accountType: 'partyAccount',
          defaultAmount: x.amount*state.exRate
        })
      })
      if(state.vType!="JV"&&state.vType!="TV"){
        let abc = {
          ...state.settleVoucherHead,
          createdAt: state.date,
          narration: state.voucherNarration==""?narration:state.voucherNarration,
          accountType: 'payAccount',
          defaultAmount: state.settleVoucherHead.amount*state.exRate,
          ChildAccountId: state.settlementAccount.toString()
        }
        temp.push(abc)
      }
      voucher.Voucher_Heads = temp
      // Shown before it is saved, as Payments & Receipts does on Make
      // Transaction (the user's request, 2026-10-26): every account it posts
      // to, debit and credit - the bank or cash line included. Approve &
      // Save sends it (post, below).
      setPending(voucher)
      await setVoucherBuffer(false)
  }

  // The approved voucher, sent. The table stays open on a refusal - with the
  // reason - so it can be cancelled and corrected; it closes on success.
  const post = async (voucher) => {
    setPosting(true)
    try {
      if(state.edit && id!="new"){
        const x = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/updateVoucher`, {
          id: state.id, employeeId: Cookies.get('loginId'),
          ...voucher
        })
        if (x.data.status !== 'success') {
          openNotification('Error', x.data.result || 'Error updating voucher', 'red')
          return
        }
        setPending(null)
        openNotification('Success', `Voucher Updated Successfully`, 'green')
        dispatch(setField({ field: 'edit', value: true }))
        fetchVoucherData()
      }else{
        const x = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/createVoucher`, { ...voucher, employeeId: Cookies.get("loginId")})
        if (x.data.status !== 'success') {
          openNotification('Error', x.data.result || 'Error saving voucher', 'red')
          return
        }
        setPending(null)
        openNotification('Success', `Voucher Saved Successfully`, 'green')
        dispatch(setField({ field: 'edit', value: true }))
        Router.push(`/accounts/vouchers/${x.data.result.id}`);
      }
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'The voucher could not be saved.', 'red')
    } finally {
      setPosting(false)
    }
  }

  // An account's name for the approval table - a line's or the bank / cash one.
  const accountName = (id) => {
    const all = [...(state.cAccounts || []), ...(state.settlementAccounts || [])]
    return all.find((a) => String(a.id) === String(id))?.title || ''
  }

  // Whenever ANY line changes - see functions/voucherTotals. It watched the
  // settlement line alone, so removing a line left the totals as they were.
  useEffect(()=>{
    const { debit, credit } = voucherTotals(state.Voucher_Heads, state.settleVoucherHead, state.vType)
    dispatch(setField({ field: 'debitTotal', value: debit }))
    dispatch(setField({ field: 'creditTotal', value: credit }))
  },[state.Voucher_Heads, state.settleVoucherHead, state.vType, dispatch])

  useEffect(()=>{
    if(state.settlementAccount!=undefined){
      // console.log(state.settlementAccounts.find((x)=>x.id==state.settlementAccount).title)
      console.log("Settlement Account for Closing Balance:", state.settlementAccount)
      axiosClient.get(
        process.env.NEXT_PUBLIC_CLIMAX_GET_VOUCEHR_LEDGER_FOR_CLOSING,
        {
          headers: {
            currency: "PKR",
            id: state.settlementAccount,
            company: CompanyId
          },
        }
      ).then((res) => {
        if (res.data.status === "success") {
          console.log(res.data.closingBalance)
          dispatch(
            setField({
              field: "closingBalance",
              value: res.data.closingBalance,
            })
          );
        }
      });
    }else{
      dispatch(setField({ field: 'closingBalance', value: 0 }))
    }
  },[state.settlementAccount])

  /* THE PAGE'S ACTIONS, IN THE TOOLBAR every other screen has (the user's
   * request, 2026-11-13) - they were a column of buttons of their own at the
   * right of this one. Save opens the postings for approval as before; Print
   * and Excel are of the saved voucher, so they wait for it; the paperclip is
   * its documents. */
  const saved = id !== "new" && Boolean(voucher?.id)
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: `Voucher ${state.voucher_id || ''}`,
  })
  const exportExcel = () => downloadVoucherExcel({
    voucher, company: getCompany(CompanyId), printedBy: Cookies.get("username"), printedAt: new Date(),
  }).catch((e) => {
    console.error(e);
    openNotification('Error', 'Could not export the voucher to Excel.', 'red');
  })
  const docs = useDocuments({
    entity: 'Vouchers',
    recordId: id !== "new" ? id : null,
    title: `Documents - Voucher ${state.voucher_id || ''}`,
  })
  const nothingYet = voucherLinesToSave(state.Voucher_Heads).length == 0
  const madeElsewhere = source ? `Made by ${source.label} - change it on the ${source.screen} screen` : ''
  usePageActions({
    title: id !== "new" && state.voucher_id ? `Voucher ${state.voucher_id}` : 'New Voucher',
    subtitle: state.vType || undefined,
    new: {
      onClick: () => { setSource(null); dispatch(resetState()); fetchAccounts(); fetchreceivingAccount() },
      disabled: nothingYet,
      label: 'New Voucher',
      title: nothingYet ? 'Nothing to clear yet' : 'Clear the screen for a new voucher',
    },
    save: {
      onClick: () => save(),
      busy: posting,
      disabled: Boolean(source) || (nothingYet && !voucherBuffer),
      title: madeElsewhere || (nothingYet && !voucherBuffer ? 'Add a line first' : 'Save - the postings are shown for approval first'),
    },
    delete: {
      onClick: deleteVoucher,
      disabled: !saved || Boolean(source),
      title: !saved ? 'Nothing saved to delete'
        : source ? `Made by ${source.label} - delete it on the ${source.screen} screen` : 'Delete this voucher',
      confirm: { what: 'voucher', name: state.voucher_id, body: 'Its lines go with it, out of the ledger. This cannot be undone.' },
    },
    print: {
      onClick: () => handlePrint(),
      disabled: !saved,
      title: saved ? 'Print this voucher' : 'Save the voucher first',
    },
    excel: {
      onClick: exportExcel,
      disabled: !saved,
      title: saved ? 'Export this voucher to Excel, laid out as its print' : 'Save the voucher first',
    },
    extras: [docs.extra],
  }, [id, state.voucher_id, state.vType, nothingYet, voucherBuffer, posting, saved, source, docs.count, docs.saved])

  /* A NEW TYPE STARTS AGAIN - the lines, the bank / cash line and the cheque
     belong to the type they were entered for. */
  const changeType = (e) => {
    dispatch(setField({ field: 'vType', value: e }))
    let Type = e=="CPV"||e=="BPV"?"debit":e=="CRV"||e=="BRV"?"credit":""
    e=="JV"||e=="TV"?Type="debit":null
    const updatedInvoiceList = [...state.Voucher_Heads];
    updatedInvoiceList.forEach((x, index)=>{
      updatedInvoiceList[index] = { ...updatedInvoiceList[index], type: Type };
    })
    dispatch(setField({ field: 'settlementAccount', value: undefined }))
    dispatch(setField({ field: 'chequeNo', value: "" }))
    dispatch(setField({ field: 'chequeDate', value: isCashVoucher(e) ? null : moment().toISOString() }))
    dispatch(setField({ field: 'currency', value: "PKR" }))
    dispatch(setField({ field: 'exRate', value: "1.00" }))
    dispatch(setField({ field: 'voucherNarration', value: "" }))
    dispatch(setField({ field: 'settleVoucherHead', value: {
      defaultAmount: 0.0,
      amount: 0.0,
      type: "",
      narration: "",
      settlement: "",
      accountType: "payAccount",
    } }))
    dispatch(setField({ field: 'Voucher_Heads', value: [] }));
    dispatch(setField({ field: 'settlementAccount', value: undefined }))
  }
  const accountOptions = (list) => (list || []).map((account) => ({
    label: `(${account.code}) ${account.title}`,
    value: account.id,
  }))
  const findAccount = (input, option) => option?.label.toLowerCase().includes(input.toLowerCase())
  const journal = state.vType=="JV"||state.vType=="TV"
  const settlementTitle = (state.settlementAccounts || []).find((a) => String(a.id) === String(state.settlementAccount))?.title

  /* THE VOUCHER (2026-11-16 redesign). A card for the voucher itself, one
     for its totals, then its lines in the shared list table (styles/
     dataList). It was a 6-3-3 bootstrap grid with a box per value drawn in
     inline styles, the totals in a narrow column and the lines below in a
     grey-bordered table with its own pill-shaped Add Row. */
  return(
    <div className="base-page-layout vo-screen">
      {docs.modal}
      {source && (
        <Alert type='info' showIcon className='vo-source'
          message={`This voucher was made by ${source.label}.`}
          description={`Change or delete it on the ${source.screen} screen - changed here, the voucher would stop matching the record it came from. Documents can still be attached to it here.`}
          action={sourceLink(source.open) ? (
            <button type='button' className='btn-custom' onClick={openSource}>Open {source.label}</button>
          ) : null} />
      )}

      <div className='vo-top'>
        {/* THE VOUCHER ITSELF. */}
        <section className='vo-card'>
          <div className='vo-card-head'>
            <div>
              <div className='vo-label'>Voucher No</div>
              <div className='vo-number'>{state.voucher_id || <span className='vo-muted'>Given when saved</span>}</div>
              {/* Who entered it and who last changed it - not the Date beside
                  it, which is the voucher's own (functions/auditStamp). */}
              {state.edit && <AuditStamp className='vo-audit' record={voucher} />}
            </div>
            <div className='vo-field vo-type'>
              <span className='vo-label'>Type</span>
              <Radio.Group className='dl-segmented' value={state.vType} onChange={(e) => changeType(e.target.value)}>
                {VOUCHER_TYPES.map(([code, name]) => (
                  <Radio.Button key={code} value={code} title={name}>{code}</Radio.Button>
                ))}
              </Radio.Group>
              <span className='vo-hint'>{(VOUCHER_TYPES.find(([code]) => code === state.vType) || [])[1] || 'Choose what kind of voucher it is'}</span>
            </div>
          </div>
          <div className='vo-grid'>
            <div className='vo-field'>
              <span className='vo-label'>Date</span>
              <DatePicker format='DD MMM YYYY' value={moment(state.date)} onChange={(e)=>{dispatch(setField({ field: 'date', value: e ? e.toISOString() : null }))}}></DatePicker>
            </div>
            <div className='vo-field'>
              <span className='vo-label'>Company</span>
              <span className='vo-readout' title={companyTitle(CompanyId)}>{companyTitle(CompanyId)}</span>
            </div>
            <div className='vo-field vo-span-2'>
              <span className='vo-label'>
                {state.vType=="CPV"||state.vType=="CRV" ? 'Cash Account' : 'Bank Account'}
                {!journal && <span className='vo-required'> *</span>}
              </span>
              <Select
                disabled={journal}
                allowClear
                showSearch
                placeholder={journal ? 'A JV or TV has none - its lines balance each other' : 'The account it is paid from or into'}
                value={state.settlementAccount}
                options={accountOptions(state.settlementAccounts)}
                filterOption={findAccount}
                onChange={(e) => {dispatch(setField({ field: 'settlementAccount', value: e }))}}
              />
            </div>
            <div className='vo-field'>
              <span className='vo-label'>Cheque No</span>
              <Input disabled={isCashVoucher(state.vType)} value={isCashVoucher(state.vType) ? '' : state.chequeNo} onChange={(e)=>{dispatch(setField({ field: 'chequeNo', value: e.target.value }))}}></Input>
            </div>
            <div className='vo-field'>
              <span className='vo-label'>Cheque Date</span>
              <DatePicker disabled={isCashVoucher(state.vType)} format='DD MMM YYYY' value={isCashVoucher(state.vType) ? null : pickerDate(state.chequeDate)} onChange={(e)=>{dispatch(setField({ field: 'chequeDate', value: e ? e.toISOString() : null }))}}></DatePicker>
            </div>
            <div className='vo-field'>
              <span className='vo-label'>Currency</span>
              <Select value={state.currency} onChange={(e)=>{dispatch(setField({ field: 'currency', value: e })); dispatch(setField({ field: 'exRate', value: 1 }))}}
                options={['PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF'].map((c) => ({ value: c, label: c }))} />
            </div>
            <div className='vo-field'>
              <span className='vo-label'>Ex Rate</span>
              <InputNumber disabled={state.currency=='PKR'} value={state.exRate} onChange={(e)=>{dispatch(setField({ field: 'exRate', value: e }))}}></InputNumber>
            </div>
            <div className='vo-field vo-span-4'>
              <span className='vo-label'>{journal ? "Narration" : "Settlement Account Narration"}</span>
              <Input value={state.voucherNarration} onChange={(e)=>{dispatch(setField({ field: 'voucherNarration', value: e.target.value }))}}></Input>
              <span className='vo-hint'>{journal
                ? "For any line left without its own narration; auto generated if this is empty too"
                : "Auto generated if empty, if account narrations are empty same will be entered there"}</span>
            </div>
          </div>
        </section>

        {/* ITS TOTALS - Debit / Credit / Net Amount as Climax works them out
            (the user's request, 2026-10-26): the lines entered, without the
            bank or cash line; see functions/voucherTotals voucherSummary. */}
        <section className='vo-card vo-totals'>
          <h3 className='vo-card-title'>Totals</h3>
          {[
            ['Debit Total', 'debit', summary.debit, false],
            ['Credit Total', 'credit', summary.credit, false],
            ['Net Amount', 'net-amount', summary.net, summary.off],
          ].map(([label, key, value, off]) => (
            <div key={key} className={`vo-tile${key === 'net-amount' ? ' vo-tile-net' : ''}${off ? ' is-off' : ''}`}
              title={off ? (hasSettlementLine(state.vType) ? 'The lines come out on the wrong side - this voucher cannot be saved like this.' : 'Debit and credit do not balance.') : ''}>
              <span className='vo-label'>{label}</span>
              <span className='vo-tile-value' data-testid={`voucher-${key}`}>{commas(value)}</span>
            </div>
          ))}
          <div className='vo-tile vo-tile-closing'>
            <span className='vo-label'>Closing Balance</span>
            <span className='vo-tile-value'>{commas(state.closingBalance)}</span>
            <span className='vo-hint'>{settlementTitle ? `Of ${settlementTitle}` : journal ? 'No bank or cash account on a JV or TV' : 'Of the bank or cash account, once chosen'}</span>
          </div>
        </section>
      </div>

      {/* Save, New Voucher, Print and Excel are in the toolbar above -
          usePageActions. What Save shows for approval opens from here. */}
      <PostingPreview open={Boolean(pending)} currency={pending?.currency} exRate={pending?.exRate}
        rows={pending ? postingRows(pending.Voucher_Heads, accountName) : []}
        submitting={posting} onCancel={() => !posting && setPending(null)} onApprove={() => post(pending)} />

      {/* ITS LINES. */}
      <section className='vo-lines'>
        <div className='vo-lines-head'>
          <h3 className='vo-card-title'>Lines <span className='vo-count'>{voucherLinesToSave(state.Voucher_Heads).length}</span></h3>
          <button type='button' className='dl-tool vo-add'
            onClick={()=>{
              // A payment's new line starts as a debit, a receipt's as a
              // credit; a JV / TV line on the side that is short -
              // functions/voucherLines newLineSide.
              dispatch(setField({ field: 'Voucher_Heads', value: [...state.Voucher_Heads, blankVoucherLine(state.Voucher_Heads, state.vType)] }))
            }}><PlusOutlined /> Add Row</button>
        </div>
        <div className='vo-lines-table'>
          <table className='dl-table'>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th className='dl-num'>Amount{state.currency && state.currency !== 'PKR' ? ` (${state.currency})` : ''}</th>
                <th className='dl-num'>Amount (LC)</th>
                <th>Narration</th>
                <th aria-label='Remove' />
              </tr>
            </thead>
            <tbody>
              {state.Voucher_Heads.length === 0 && (
                <tr><td colSpan={6} className='vo-empty'>No lines yet - choose a type, then Add Row.</td></tr>
              )}
              {state.Voucher_Heads.map((item, index) => (
                <tr key={index} className={index === state.Voucher_Heads.length - 1 && !voucherLineHasData(item) ? 'vo-line-blank' : undefined}>
                  <td className='vo-col-account'>
                    <Select
                      allowClear
                      showSearch
                      placeholder={`Select Account`}
                      status={!item.ChildAccountId && voucherLineHasData(item) ? 'warning' : undefined}
                      value={item.ChildAccountId}
                      options={accountOptions(state.cAccounts)}
                      filterOption={findAccount}
                      onChange={(e) => {
                        const updatedInvoiceList = [...state.Voucher_Heads];
                        updatedInvoiceList[index] = {
                          ...updatedInvoiceList[index],
                          ChildAccountId: e,
                        };
                        dispatch(setField({ field: 'Voucher_Heads', value: updatedInvoiceList }));
                      }}
                    />
                  </td>
                  <td className='vo-col-type'>
                    {/* OPEN ON EVERY TYPE. On a payment or receipt it was locked to
                        the voucher's own side, so a salary paid with a loan
                        instalment held back - salary Dr, loan Cr, the bank the
                        difference - could not be entered (the CFO's case). There
                        the box changes its own line only, and the bank / cash
                        line follows the lines' net - see settlementAmount. */}
                    <Select className={`vo-side vo-side-${item.type || 'none'}`} value={item.type} onChange={(e)=>{
                      if(hasSettlementLine(state.vType)){
                        const updatedLines = state.Voucher_Heads.map((voucherHead, i) => (
                          i === index ? { ...voucherHead, type: e } : voucherHead
                        ));
                        dispatch(setField({ field: 'Voucher_Heads', value: updatedLines }));
                        dispatch(setField({ field: 'settleVoucherHead', value: { ...state.settleVoucherHead, amount: settlementAmount(updatedLines, state.vType) } }));
                        return;
                      }
                      // A JV / TV: the other lines go to the other side, as before.
                      const updatedInvoiceList = state.Voucher_Heads.map((voucherHead, i) => ({
                        ...voucherHead,
                        type: i === index ? e : e === 'debit' ? 'credit' : 'debit',
                      }));
                      dispatch(setField({ field: 'Voucher_Heads', value: updatedInvoiceList }));
                    }}>
                      <Select.Option value="debit">Debit</Select.Option>
                      <Select.Option value="credit">Credit</Select.Option>
                    </Select>
                  </td>
                  <td className='vo-col-amount'>
                    <InputNumber value={item.amount} onChange={async (e) => {
                      e<0?e = e *-1:null
                      const value = e || 0;
                      const updatedInvoiceList = [...state.Voucher_Heads];
                      if(state.vType!="JV"&&state.vType!="TV"){
                        updatedInvoiceList[index] = {
                          ...updatedInvoiceList[index],
                          amount: value,
                        };
                        await dispatch(setField({ field: 'Voucher_Heads', value: updatedInvoiceList }));
                        // The bank / cash line: the lines' NET, a credit line
                        // taking off what it holds back - see settlementAmount.
                        dispatch(setField({ field: 'settleVoucherHead', value: { ...state.settleVoucherHead, amount: settlementAmount(updatedInvoiceList, state.vType) } }));
                        return;
                      }else{
                        // With two lines filled, both carry the one figure; the blank
                        // line at the bottom is left alone - functions/voucherLines.
                        const copyTo = mirroredLines(updatedInvoiceList, index)
                        const asd = updatedInvoiceList.map((voucherHead, i) => ({
                          ...voucherHead,
                          amount: copyTo.includes(i) ? value : voucherHead.amount,
                        }));
                        await dispatch(setField({ field: 'Voucher_Heads', value: asd }));
                      }
                      let total = 0.0
                      state.Voucher_Heads.forEach((x, i)=>{
                        i!=index?total = parseFloat(total) + parseFloat(x.amount):total = parseFloat(total) + parseFloat(value)
                      })
                      const updatedVoucherHead = {
                        ...state.settleVoucherHead,
                        amount: total,
                      };
                      dispatch(setField({ field: 'settleVoucherHead', value: updatedVoucherHead }))
                    }}
                    formatter={(value) =>
                      `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
                    }
                    parser={(value) =>
                      value?.replace(/,/g, '')
                    }
                    ></InputNumber>
                  </td>
                  <td className='dl-num vo-col-lc'>
                    {commas(item.amount*state.exRate)}
                  </td>
                  <td className='vo-col-narration'>
                    <Input placeholder='Its own narration - else the one above' value={item.narration} onChange={(e)=>{
                      // Each line its own narration, on every voucher type. A JV
                      // or TV copied whatever was typed on one line to all of
                      // them (the user's request, 2026-10-14). The box above is
                      // the common narration for lines left empty.
                      const updatedInvoiceList = [...state.Voucher_Heads];
                      updatedInvoiceList[index] = {
                        ...updatedInvoiceList[index],
                        narration: e.target.value,
                      };
                      dispatch(setField({ field: 'Voucher_Heads', value: updatedInvoiceList }));
                    }}/>
                  </td>
                  <td className='vo-col-remove'>
                    {(index < state.Voucher_Heads.length - 1 || voucherLineHasData(item)) && <CloseCircleOutlined className='vo-remove' title='Remove this line' onClick={()=>{
                      let temp = [...state.Voucher_Heads]
                      temp.splice(index, 1)
                      dispatch(setField({ field: 'Voucher_Heads', value: temp }))
                      // A payment or receipt's bank / cash line carries the lines'
                      // net, as the amount box sets it. The removed line's amount
                      // stayed in it, and the voucher saved unbalanced.
                      if(hasSettlementLine(state.vType)){
                        dispatch(setField({ field: 'settleVoucherHead', value: { ...state.settleVoucherHead, amount: settlementAmount(temp, state.vType) } }))
                      }
                    }}/>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {/* Off-screen, NOT display:none.
          react-to-print clones this subtree and carries its COMPUTED styles
          across, so a `display: none` ancestor makes the clone display:none
          too - it prints a blank page with no error. Positioning it off-screen
          keeps it invisible on screen while leaving it laid out, which is what
          the clone needs. The A4 width matters as well: without it the hidden
          node collapses to its parent's width and the table reflows on print. */}
      <div aria-hidden='true' style={{
        position: 'absolute',
        left: '-10000px',
        top: 0,
        width: '210mm'
      }}>
        <div ref={printRef}>
          {
            id !== "new" ?
            ( <Print compLogo={CompanyId} voucherData={voucher} /> )
            :null
          }
        </div>
      </div>
    </div>
  )

};

export default Voucher;
