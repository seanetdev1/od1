import { getNetInvoicesAmount } from 'functions/amountCalculations';
import openNotification from 'Components/Shared/Notification';
import Pagination from 'Components/Shared/Pagination';
import { Empty, InputNumber, Checkbox, Radio, Input, DatePicker, Select, Modal, Button } from 'antd';
import { Spinner, Table, Col, Row } from 'react-bootstrap';
import React, { useEffect, useReducer, useRef, useState } from 'react';
import { CloseCircleOutlined } from '@ant-design/icons';
import { incrementTab } from 'redux/tabs/tabSlice';
import { useDispatch, useSelector } from 'react-redux';
import { paymentProblems } from 'functions/paymentReceiptChecks';
import { isSettling, settleProblems, settlementFigures, settlementPayload, capToVoucher } from 'functions/advanceSettlement';
import {
  setAllocation, setAllocations, withSelection, selectedEntries,
  entriesToSubmit, knockOff, knockOffPool, hasPicked, receiptTotals,
  allowedAmount, isOverpaid, balanceAfter, isSettledHere, fullAmount,
} from 'functions/paymentReceiptSelection';
import { groupThousands, ungroupThousands } from 'functions/amountInput';
import { useRouter } from 'next/router';
import axiosClient from 'apis/axiosClient';
import moment from 'moment';
import { setPRField } from 'redux/paymentReciept/paymentRecieptSlice';
import Cookies from 'js-cookie';
import { byInvoiceDate, invoiceDate } from 'functions/invoiceDates';
import { isCashMode, pickerDate } from 'functions/cashCheque';
import { selectedPartyType } from 'functions/paymentReceiptParty';
import { notListedLines } from 'functions/invoiceNotListed';
import { PAID_BY_US, PAID_BY_PARTY, partyPaysTax, partyPaysCharges, bankCarries, costLines } from 'functions/paymentReceiptCosts';

const commas = (a) => a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/* What is settled, open and ticked on a row - one reading for the list's
 * Balance, its colour, its tick and what the tick puts against it:
 * functions/paymentReceiptSelection (balanceAfter, isSettledHere, fullAmount).
 * To the paisa - in floating point 566,674.52 received at 566,675 stood at
 * -0.4799999999, and -0.48 against it never read as settled (2026-10-26).
 * Settled means `recieved` on a receivable and `paid` on a payable; the tick
 * once took `recieved` off both. Editing, the tick puts the whole total, as it
 * always did: recieved/paid there already include this voucher's own amount. */
const isFullyAllocated = isSettledHere;
const allocationFor = fullAmount;

/* `actionRef` lets the page's toolbar press Make Transaction. The checks and
 * the journal it builds stay here, where the form is; only the trigger is
 * published upward - see Components/Shared/PageActions and the note on
 * functions/paymentReceiptChecks. */
const BillComp = ({back, companyId, state, dispatch, actionRef}) => {

  /* WHAT THE RECEIPT PAYS lives in state.selectedInvoices, not on the rows of
   * the list. The list is one page of one search or period; the selection is
   * every invoice chosen across all of them, and it is what the totals, the
   * journal and the save read. `rows` is the page on screen showing it, and
   * every change to an amount goes through setSelection. See
   * functions/paymentReceiptSelection. */
  const selection = state.selectedInvoices || {};
  // Settling, nothing ticked or typed may take more than the voucher has left -
  // the invoice that reaches the end takes what remains (functions/advanceSettlement).
  const setSelection = (next) => {
    const { selection: fitted, capped } = capToVoucher(state, selection, next);
    if (capped) {
      openNotification('Settled up to what is left', 'This voucher has no more to settle - the last invoice takes only what was left on it.', 'orange');
    }
    dispatch(setPRField({ field: 'selectedInvoices', value: fitted }));
  };
  // Oldest first - the order invoices are settled in. The server pages them
  // that way; this keeps a re-opened voucher's list (fetched unpaged) the same.
  const rows = byInvoiceDate(withSelection(state.invoices || [], selection));
  const chosen = selectedEntries(selection);
  const chosenTotal = chosen.reduce((t, e) => t + (parseFloat(e.receiving) || 0), 0);
  const [selectionOpen, setSelectionOpen] = useState(false);

  /* Where the select-all box sits. Derived from the rows rather than stored, so
   * it can never disagree with the ticks beneath it - clearing one row drops
   * the header out of "all" on its own. An empty list is NOT "all ticked",
   * which is what `length > 0` is guarding.
   *
   * Not an invoice paid over: "in full" there is a minus, which a tick on
   * the whole page should not slip into a receipt - its own row's tick or a
   * typed amount does it (allowedAmount). */
  const allocatable = rows.filter((inv) => !isOverpaid(inv));
  const allAllocated = allocatable.length > 0 && allocatable.every(isFullyAllocated);
  const someAllocated = allocatable.some(isFullyAllocated);
  const [firstCall, setFirstCall] = useState(true);
  const router =  useRouter()
  const fiscalYearId = useSelector((state) => state.fiscalYear.value);

  // useEffect(()=>{
  //   console.log("STATE INVOICES", state.invoices)
  // }, [state.invoices])

  /* AUTO KNOCK-OFF: the invoices picked, if any are; otherwise the list - the
   * page on screen, and then the pages after it, loaded one at a time until
   * the amount is settled or there are no more (knockOffPool). It used to stop
   * at the page on screen and put everything left on that page's last
   * invoice. Oldest first, both ways. The spreading itself lives in
   * functions/paymentReceiptSelection.
   *
   * Every keystroke of the amount runs this, so: each page is fetched once per
   * list (knockOffPages, emptied whenever the list is fetched afresh), and only
   * the LATEST run is applied - a slow page fetched for the "2" of "250" must
   * not land on top of the "250". The selection is read through a ref for the
   * same reason: by the time a page arrives, the one this run started with may
   * be several keystrokes old. */
  const knockOffPages = useRef({});
  const knockOffRun = useRef(0);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [knockOffLoading, setKnockOffLoading] = useState(false);

  useEffect(() => {
    if(!state.autoKnockOff) return;
    const run = ++knockOffRun.current;
    const latest = () => run === knockOffRun.current;
    const editing = Boolean(state.editing || state.edit);
    const rows = state.invoices || [];
    const spread = (pool) => setSelection(knockOff(selectionRef.current, pool, state.knockOffAmount, editing));
    // Picked invoices are paid wherever they were found. A saved receipt being
    // edited lists its invoices unpaged, so there is nothing after it to load.
    if(hasPicked(selectionRef.current) || state.edit){
      spread(rows);
      return;
    }
    const list = {
      period: state.invoicePeriod || 'all',
      custom: { from: state.invoiceFrom, to: state.invoiceTo },
      search: state.invoiceSearch || '',
    };
    knockOffPool({
      rows,
      amount: state.knockOffAmount,
      editing,
      page: state.invoicePage || 1,
      pageSize: state.invoicePageSize || 50,
      count: state.invoiceCount,
      loadPage: (n) => {
        if(!knockOffPages.current[n]){
          if(latest()) setKnockOffLoading(true);
          knockOffPages.current[n] = requestInvoices(n, list)
            .then((x) => x.rows)
            // A failed page is tried again next time, not remembered as failed.
            .catch((e) => { delete knockOffPages.current[n]; throw e; });
        }
        return knockOffPages.current[n];
      },
    }).then((pool) => {
      if(latest()) spread(pool);
    }).catch((e) => {
      console.log(e);
      if(!latest()) return;
      // What was on screen still gets paid - as before, the rest on its last
      // invoice - and the operator is told why it stopped there.
      spread(rows);
      openNotification('Error', 'Could not load the next page of invoices, so the knock-off stopped at this page. Enter the amount again to retry.', 'red');
    }).finally(() => {
      if(latest()) setKnockOffLoading(false);
    });
  }, [state.knockOffAmount]);
  

  useEffect(() => {
    console.log("STATE: ", state)
  }, [state])
  
  

  /* THE PERIOD IS PASSED IN, not read from state.
   *
   * The selector dispatched the new period and called this in the same
   * handler - but a dispatch is not applied until the next render, so this
   * closure still held the PREVIOUS value and every change fetched the window
   * before the one just clicked. The numbers lagged a click behind, which
   * reads as the periods returning nonsense.
   *
   * Defaulting from state is right for the callers that are not changing it
   * (the party/currency/pay-type effect), which want whatever is current. */
  /* One page of the list as the server sends it. Shared by the list and by the
   * auto knock-off, which reads the pages after the one on screen - so both
   * ask with the same party, period and search, and number pages alike. */
  const requestInvoices = async (page, { period, custom, search }) => {
    const x = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_INVOICE_BY_PARTY_ID, {
      // In the query string, not a header - see the route.
      params: search ? { search } : undefined,
      headers: {
        id: state.selectedAccount,
        companyid: companyId,
        invoicecurrency: state.currency,
        pay: state.payType,
        type: state.type,
        // How far back to look, and which page of it. Only the BROWSE path
        // sends these - the edit flow deliberately does not, so re-opening a
        // voucher still sees everything it allocated against. See the note on
        // the route.
        //
        // A SEARCH sends no period: it is a lookup, and the invoice being
        // looked up is usually older than the window - the reason this list
        // so often looks empty. A search confined to a fortnight would fail
        // in exactly the case it is for.
        //
        // ALL sends none either, rather than period 'all': the server reads
        // a period it does not know as the FORTNIGHT (deliberately - see
        // functions/reportPeriods), while no period at all is no window.
        ...(search || period === 'all' ? {} : {
          period,
          ...(period === 'custom' && custom.from && custom.to
            ? { from: custom.from, to: custom.to }
            : {}),
        }),
        page: `${page}`,
        limit: `${state.invoicePageSize || 50}`,
        // The browse list only ever wanted open invoices. Asking the server
        // for them is what makes the count, the pages and the rows describe
        // the same set - it used to drop the settled ones here, after
        // counting and paging had already happened.
        outstanding: 'true',
      }
    })
    // Already filtered to outstanding by the server - see the header
    // above. Filtering again here would be the same rule applied twice,
    // and applied to a page rather than to the book.
    const rows = x.data.result
    rows.forEach((x) => {
      x.receiving = 0.0;
      if(x.payType=="Payble"){
        x.constReceiving = x.paid
      }else{
        x.constReceiving = x.recieved
      }
    });
    return {
      rows, count: Number(x.data.count) || 0, period: x.data.period || null,
      notListed: Array.isArray(x.data.notListed) ? x.data.notListed : [],
    }
  }

  const fetchInvoices = async (page = 1, periodArg, customArg, searchArg) => {
    const period = periodArg || state.invoicePeriod || 'all';
    const custom = customArg || { from: state.invoiceFrom, to: state.invoiceTo };
    // Passed in for the same reason the period is: a search typed and run in
    // one handler has not reached state yet. Defaults to the active search, so
    // the pager pages through search results rather than dropping the search.
    const search = String(searchArg !== undefined ? searchArg : (state.invoiceSearch || '')).trim();
    dispatch(setPRField({ field: 'invoiceSearch', value: search }))
    dispatch(setPRField({ field: 'invoicesLoading', value: true }))
    // A fresh list: the pages the knock-off read of the last one may be stale.
    knockOffPages.current = {}
    try{
      console.log("Fetching Invoices")
      console.log(state.selectedAccount, state.currency, state.payType, state.type, companyId)
      const x = await requestInvoices(page, { period, custom, search })
      console.log("Invoices", x.rows)
      dispatch(setPRField({ field: 'invoices', value: x.rows }))
      // What the SERVER fetched, so the pager and the range caption describe
      // the whole window rather than the page in hand.
      dispatch(setPRField({ field: 'invoiceCount', value: x.count }))
      dispatch(setPRField({ field: 'invoicePeriodRange', value: x.period }))
      dispatch(setPRField({ field: 'invoiceNotListed', value: x.notListed }))
      dispatch(setPRField({ field: 'invoicePage', value: page }))
      dispatch(setPRField({ field: 'PRload', value: false }))
    }catch(e){
      console.log(e)
      // Said out loud rather than logged. A failed load used to leave the same
      // empty table a party with nothing outstanding leaves, so the operator
      // had no way to tell "nothing to pay" from "this did not load".
      openNotification('Error', e?.response?.data?.result || 'Could not load invoices for this party.', 'red')
      dispatch(setPRField({ field: 'invoices', value: [] }))
      dispatch(setPRField({ field: 'invoiceNotListed', value: [] }))
    }finally{
      // In a finally: an error used to leave the flag wherever it was, which is
      // how a spinner becomes permanent.
      dispatch(setPRField({ field: 'invoicesLoading', value: false }))
    }
  }
  /* The text in the search box. Separate from state.invoiceSearch, which is the
   * search the list was last FETCHED with: typing does not refetch, Enter (or
   * the search button, or clearing the box) does. */
  const [searchText, setSearchText] = useState(state.invoiceSearch || '')
  useEffect(() => { setSearchText(state.invoiceSearch || '') }, [state.invoiceSearch])

  // No warning about losing amounts: they live in the selection now, so a
  // search - like a page or a period - only changes what is on screen.
  const runSearch = (text) => {
    const q = String(text || '').trim()
    if (q === (state.invoiceSearch || '')) return
    fetchInvoices(1, undefined, undefined, q)
  }

  const [ first, setFirst] = useState(false)
  useEffect(() => {
    if(state.selectedAccount && !state.edit && (state.invoices.length == 0 || (state.invoices.length > 0 && state.invoices[0].party_Id != state.selectedAccount) || (state.invoices.length > 0 && state.invoices[0].currency != state.currency) || (state.invoices.length > 0 && state.invoices[0].payType != state.payType))){
      // A different party, currency or side is a fresh list: the last party's
      // search does not carry over to this one - and neither does its
      // selection, since one receipt cannot pay two parties, or two currencies.
      setSelection({})
      fetchInvoices(1, undefined, undefined, '')
      setFirst(true)
    }
    if(state.currency=="PKR"){
      dispatch(setPRField({ field: 'exRate', value: 1.0 }))
    }
  }, [state.selectedAccount, state.payType, state.currency])

  useEffect(() => {
    const fetchreceivingAccount = async () => {
      dispatch(setPRField({ field: 'PRload', value: true }))
      try{
        await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNT_FOR_TRANSACTION, {
          headers: {
            type: state.transactionMode,
            companyid: companyId,
          }
        }).then((x) => {
          // console.log(x.data.result)
          dispatch(setPRField({ field: 'receivingAccounts', value: x.data.result }))
          dispatch(setPRField({ field: 'PRload', value: false }))
        })
      }catch(e){
        console.log(e)
      }
    }
    fetchreceivingAccount()
  }, [state.transactionMode])

  useEffect(() => {
    const fetchreceivingAccount = async () => {
      dispatch(setPRField({ field: 'PRload', value: true }))
      try{
        await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNT_FOR_TRANSACTION, {
          headers: {
            type: "Adjust",
            companyid: companyId,
          }
        }).then((x) => {
          dispatch(setPRField({ field: 'adjustAccounts', value: x.data.result }))
          dispatch(setPRField({ field: 'PRload', value: false }))
        })
      }catch(e){
        console.log(e)
      }
    }
    fetchreceivingAccount()
  }, [state.transactionMode])

  const [ total, setTotal ] = useState(0.0)
  const [ isFirst, setIsFirst ] = useState(true)

  useEffect(() => {
    if((state.advance || state.edit) && isFirst){
      setTotal(state.totalReceivable)
      setIsFirst(false)
    }
    // if(state.advance && isFirst){
    //   setTotal(state.totalReceivable)
    //   setIsFirst(false)
    // }
    /* From the SELECTION - every invoice being paid, on screen or not - not
     * from the rows of the list. See receiptTotals for the one change to the
     * arithmetic: an invoice with nothing against it no longer adds gain/loss.
     *
     * Left alone on an advance, whose total is typed in directly and has no
     * invoices behind it. (This used to be guarded by "the list has rows",
     * which let an advance's typed total be overwritten by any list that
     * happened to load behind it.) */
    if(!state.advance){
      const { total: temp, gainLoss } = receiptTotals(entriesToSubmit(selection), state.exRate)
      dispatch(setPRField({ field: 'totalReceivable', value: temp }))
      dispatch(setPRField({ field: 'gainLossAmount', value: gainLoss }))
    }
  },[state.selectedInvoices, state.exRate, state.advance])

  useEffect(() => {
    let temp = 0.0
    if(state.percent){
      state.totalReceivable>0?
      temp = state.totalReceivable*(state.taxPercent/100):
      temp = (state.totalReceivable*-1)*(state.taxPercent/100)
      dispatch(setPRField({ field: 'taxAmount', value: temp }))
    }
  // On the total it is a percentage of - which now follows the selection, not
  // the page of the list on screen.
  },[state.taxPercent, state.totalReceivable])

  /* POSTING TWICE IS THE FAILURE THIS GUARDS.
   *
   * The button sat there pressable while the request was in flight, and a
   * second press posts a second voucher for the same receipt - which is then
   * somebody's afternoon in the ledger. `submitting` disables it and says what
   * is happening. */
  const [submitting, setSubmitting] = useState(false)

  const submitTransaction = async () => {
    if(submitting) return
    setSubmitting(true)
    try{
        console.log("Make Transaction:", state)
        await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/makeTransaction`, {
          transactions: state.transactions,
          // Every invoice chosen, whichever page or search it was found on -
          // plus, when editing, any of the receipt's invoices taken down to
          // zero, which the server needs in order to remove their settlement.
          invoices: entriesToSubmit(selection),
          gainLoss: state.gainLossAmount,
          totalReceiving: state.totalReceivable,
          partyId: state.selectedAccount,
          partyName: state.PRaccounts.find((x) => x.id === state.selectedAccount)?.name || "N/A",
          // What the party is - not `type`, the party list's filter ('all').
          partyType: selectedPartyType(state),
          type: state.onAccount,
          transactionMode: state.transactionMode,
          payType: state.payType,
          currency: state.currency,
          // Cash has no cheque - see functions/cashCheque.
          checkNo: isCashMode(state.transactionMode) ? '' : state.checkNo,
          checkDate: isCashMode(state.transactionMode) ? null : state.checkDate,
          transactionMode: state.transactionMode,
          subType: state.subType,
          exRate: state.exRate,
          date: state.date,
          companyId: companyId,
          fiscalYearId: fiscalYearId,
          tranDate: state.date,
          edit: state.edit,
          advance: state.advance,
          voucherId: state.voucherId,
          narration: state.voucherNarration,
          employeeId: Cookies.get("loginId")
        }).then((x) => {
          x.data.status=="success"?back():null
          x.data.status=="success"?openNotification('Success', `Transaction Saved`, 'green'):openNotification('Error', x.data.result || `Error saving transaction`, 'red')
          dispatch(setPRField({ field: 'modal', value: false }))
        })

      }catch(e){
        console.error(e)
      }finally{
        // Cleared even on failure: a refused post must leave the button
        // pressable, or the only way to try again is to reload the screen.
        setSubmitting(false)
      }
  }

  useEffect(()=>{
    // console.log("Change in GainLoss", state.gainLossAmount)
  },[state.gainLossAmount])

  // Kept current on every render: the handler closes over `state`, and a
  // toolbar holding last render's copy would post last render's figures.
  useEffect(() => {
    if (actionRef) actionRef.current = makeTransaction;
  });

  /* SETTLING an open voucher (Refresh was pressed): only the ticks are sent,
   * and the voucher and its ledger lines stay as they are - no journal to
   * preview, nothing posts. See functions/advanceSettlement. */
  const saveSettlement = async () => {
    if(submitting) return
    setSubmitting(true)
    try{
      const { data } = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/settleTransaction`,
        settlementPayload(state, selection, Cookies.get("loginId")))
      if(data.status=="success"){
        const left = Number(data.result?.left || 0)
        openNotification('Success', left ? `Settled - ${commas(Math.abs(left))} stays on this voucher as advance` : 'Settled - all of this voucher is now knocked off', 'green')
        back()
      }else{
        openNotification('Error', data.result || 'Could not save the settlement', 'red')
      }
    }catch(e){
      openNotification('Error', e?.response?.data?.result || 'Could not save the settlement', 'red')
    }finally{
      setSubmitting(false)
    }
  }

  const makeTransaction = () => {
    if(isSettling(state)){
      const problems = settleProblems(state, selection)
      if(problems.length){
        openNotification('Failure', problems.join(' · '), 'red')
        return
      }
      saveSettlement()
      return
    }
    /* EVERYTHING WRONG AT ONCE, rather than one thing per press.
     *
     * These were seven early returns, each with its own toast - so a form with
     * three things missing took three attempts to find that out. The checks
     * themselves are unchanged and live in functions/paymentReceiptChecks,
     * where the toolbar can ask the same question to decide whether Make
     * Transaction is pressable at all. */
    const problems = paymentProblems(state)
    if(problems.length){
      openNotification(
        problems.length === 1 ? 'Failure' : `${problems.length} things to fix`,
        problems.join(' · '),
        'red'
      )
      return
    }

    // console.log(state.totalReceivable)
    let temp = []
    if(!state.advance){
      if(state.totalReceivable!=0){
        temp.push({
          partyId: state.selectedAccount,
          onParty: true,
          accountType: "partyAccount",
          accountName: state.PRaccounts.find((x) => x.id === state.selectedAccount)?.name || "N/A",
          debit: state.totalReceivable<0?state.totalReceivable*-1:0,
          credit: state.totalReceivable>0?state.totalReceivable:0,
          type: state.totalReceivable<0?'debit':'credit'
        })
      }
      // The tax and the bank charges the bank carries come off a receipt and
      // go on top of a payment - who pays which: functions/paymentReceiptCosts.
      let accountAmount = state.totalReceivable<0?state.totalReceivable*-1:state.totalReceivable
      accountAmount = state.totalReceivable>0?accountAmount-bankCarries(state):accountAmount+bankCarries(state)
      // accountAmount = state.totalReceivable<0?(state.gainLossAmount/state.exRate)>0?accountAmount+(state.gainLossAmount/state.exRate):accountAmount-(state.gainLossAmount/state.exRate):(state.gainLossAmount/state.exRate)<0?accountAmount+(state.gainLossAmount/state.exRate):accountAmount-(state.gainLossAmount/state.exRate)
      if(state.totalReceivable!=0){
        temp.push({
          partyId: state.receivingAccount,
          accountType: "payAccount",
          accountName: state.receivingAccounts.find((x) => x.id === state.receivingAccount)?.title || "N/A",
          debit: state.totalReceivable>0?accountAmount:0,
          credit: state.totalReceivable<0?accountAmount:0,
          type: state.totalReceivable>0?'debit':'credit'
        })
      }
      if(state.gainLossAmount!=0){
        temp.push({
          partyId: state.gainLossAccount,
          accountType: "Gain/Loss Account",
          accountName: state.adjustAccounts.find((x) => x.id === state.gainLossAccount)?.title || "N/A",
          credit: state.gainLossAmount>0?state.gainLossAmount/state.exRate:0,
          debit: state.gainLossAmount<0?(state.gainLossAmount*-1)/state.exRate:0,
          type: state.gainLossAmount<0?'debit':'credit'
        })
        temp.push({
          partyId: state.selectedAccount,
          onParty: true,
          accountType: "Gain/Loss Account",
          accountName: state.PRaccounts.find((x) => x.id === state.selectedAccount)?.name || "N/A",
          debit: state.gainLossAmount>0?state.gainLossAmount/state.exRate:0,
          credit: state.gainLossAmount<0?(state.gainLossAmount*-1)/state.exRate:0,
          type: state.gainLossAmount>0?'debit':'credit'
        })
      }
      temp.push(...costLines(state, state.totalReceivable>0))
    }else{
      if(state.totalReceivable!=0){
        temp.push({
          partyId: state.selectedAccount,
          onParty: true,
          accountType: "partyAccount",
          accountName: state.PRaccounts.find((x) => x.id === state.selectedAccount)?.name || "N/A",
          debit: state.payType!="Recievable"?Math.abs(state.totalReceivable):0,
          credit: state.payType=="Recievable"?Math.abs(state.totalReceivable):0,
          type: state.payType!="Recievable"?'debit':'credit'
        })
      }
      /* As against invoices above: what the bank carries (functions/
       * paymentReceiptCosts) comes off a receipt and on top of a payment. An
       * advance PAYMENT took the tax and bank charges off what the bank paid
       * and credited them - the tax as withheld from the party, the bank
       * charges as income. */
      const advanceReceipt = state.payType=="Recievable"
      let accountAmount = state.totalReceivable<0?state.totalReceivable*-1:state.totalReceivable
      accountAmount = advanceReceipt?accountAmount-bankCarries(state):accountAmount+bankCarries(state)
      accountAmount -= state.gainLossAmount/state.exRate
      // console.log(accountAmount)
      if(state.totalReceivable!=0){
        temp.push({
          partyId: state.receivingAccount,
          accountType: "payAccount",
          accountName: state.receivingAccounts.find((x) => x.id === state.receivingAccount)?.title || "N/A",
          debit: state.payType=="Recievable"?accountAmount:0,
          credit: state.payType!="Recievable"?accountAmount:0,
          type: state.payType=="Recievable"?'debit':'credit'
        })
      }
    if(state.gainLossAmount!=0){
      temp.push({
        partyId: state.gainLossAccount,
        accountType: "Gain/Loss Account",
        accountName: state.adjustAccounts.find((x) => x.id === state.gainLossAccount)?.title || "N/A",
        debit: state.payType=="Recievable"?state.gainLossAmount>0.0?state.gainLossAmount/state.exRate:0:state.gainLossAmount<0?(state.gainLossAmount*-1)/state.exRate:0,
        credit: state.payType!="Recievable"?state.gainLossAmount>0.0?state.gainLossAmount/state.exRate:0:state.gainLossAmount<0?(state.gainLossAmount*-1)/state.exRate:0,
        type: state.payType!="Recievable"?state.gainLossAmount>0.0?'credit':'debit':state.gainLossAmount<0?'credit':'debit'
      })
    }
    temp.push(...costLines(state, advanceReceipt))
    }
    let totalDebit = 0.0
    let totalCredit = 0.0
    temp.forEach((x)=>{
      totalDebit+=x.debit
      totalCredit+=x.credit
    })
    temp.push({
      accountType: "",
      accountName: "Total",
      debit: totalDebit,
      credit: totalCredit
    })
    dispatch(setPRField({ field: 'transactions', value: temp }))
    dispatch(setPRField({ field: 'modal', value: true }))

  }

  // From the figure the Balance column shows, to the paisa - it was worked out
  // apart, unrounded, and on an edit by a different sum.
  const calculateColor = (invoice) => {
    const amountDue = balanceAfter(invoice, state.edit);
    if (amountDue > 0) {
      return 'green';
    } else if (amountDue < 0) {
      return 'red';
    } else {
      return 'black';
    }
  };
  

  /* An account picker's options - the code first, as everywhere. */
  const accountOptions = (list) => (list || []).map((account) => ({
    label: `(${account.code}) ${account.title}`,
    value: account.id,
  }));
  const findAccount = (input, option) => option?.label.toLowerCase().includes(input.toLowerCase());
  const receiving = state.payType != "Recievable" ? 'Paying' : 'Receiving';
  /* The figure in the Amounts card's big box, and what it is called. On an
     open voucher it is what its ticks knock off - not the voucher's amount,
     which is "This Voucher" below. Headed "Total Receivable Amount", a partly
     used advance read as a different receipt: ACS-BRV-00856/24, 1,775,000 on
     the list, opened at 96,386 (the user, 2026-11-06). */
  const amountTitle = state.edit && !state.advance ? 'Knocked Off'
    : state.totalReceivable < 0 || (state.advance && state.payType == 'Payble') ? 'Total Payable Amount' : 'Total Receivable Amount';
  const periodNote = state.invoiceCount > (state.invoicePageSize || 50)
    ? <> &middot; showing {Math.min(
        (state.invoicePageSize || 50),
        state.invoiceCount - (((state.invoicePage || 1) - 1) * (state.invoicePageSize || 50)),
      )} of them</>
    : null;

  /* THE TRANSACTION (2026-11-15 redesign). Three cards - how it was paid,
     the amounts, and the tax and bank charges on it - then the invoices it
     pays, in the shared list table (styles/dataList). It was two bootstrap
     columns of label-over-box pairs at four different widths, with the
     amounts and the tax mixed in one column. */
  return (
  <>
  <div className='pr-form'>
    {/* HOW IT WAS PAID. */}
    <section className='pr-card pr-card-details'>
      <h3 className='pr-card-title'>{state.payType == 'Recievable' ? 'Receipt' : 'Payment'} details</h3>
      <div className='pr-grid'>
        <div className='pr-field pr-span-2'>
          <span className='pr-field-label'>Transaction Mode</span>
          <Radio.Group className='dl-segmented' value={state.transactionMode} onChange={(e) => {
            dispatch(setPRField({ field: 'transactionMode', value: e.target.value })); e.target.value=="Cash"?dispatch(setPRField({ field: 'subType', value: "Cash" })):dispatch(setPRField({ field: 'subType', value: "Cheque" })); dispatch(setPRField({field: "receivingAccount", value: undefined}))
            // Cash has no cheque: what was typed for a bank receipt goes. Back
            // on a bank one, the date starts at today, as it always did.
            if(isCashMode(e.target.value)){
              dispatch(setPRField({ field: 'checkNo', value: '' }))
              dispatch(setPRField({ field: 'checkDate', value: null }))
            }else if(!state.checkDate){
              dispatch(setPRField({ field: 'checkDate', value: moment().toISOString() }))
            }
          }}>
            <Radio.Button value={"Cash"}>Cash</Radio.Button>
            <Radio.Button value={"Bank"}>Bank</Radio.Button>
            <Radio.Button value={"Adjust"}>Adjust</Radio.Button>
          </Radio.Group>
        </div>
        <div className='pr-field'>
          <span className='pr-field-label'>Date</span>
          <DatePicker allowClear={false} format='DD MMM YYYY' value={moment(state.date)} onChange={(e) => {dispatch(setPRField({ field: 'date', value: e ? e.toISOString() : null }))}}></DatePicker>
        </div>
        <div className='pr-field'>
          <span className='pr-field-label'>Sub Type</span>
          <Select value={state.subType} onChange={(e) => dispatch(setPRField({ field: 'subType', value: e }))}>
            <Select.Option value="Cheque">Cheque</Select.Option>
            <Select.Option value="Credit Cart">Credit Card</Select.Option>
            <Select.Option value="Online Transfer">Online Transfer</Select.Option>
            <Select.Option value="Wire Transfer">Wire Transfer</Select.Option>
            <Select.Option value="Cash">Cash</Select.Option>
          </Select>
        </div>
        <div className='pr-field'>
          <span className='pr-field-label'>Cheque/Tran #</span>
          <Input disabled={isCashMode(state.transactionMode)} value={isCashMode(state.transactionMode) ? '' : state.checkNo} onChange={(e) => dispatch(setPRField({ field: 'checkNo', value: e.target.value }))}></Input>
        </div>
        <div className='pr-field'>
          <span className='pr-field-label'>Cheque Date</span>
          <DatePicker disabled={isCashMode(state.transactionMode)} format='DD MMM YYYY' value={isCashMode(state.transactionMode) ? null : pickerDate(state.checkDate)} onChange={(e) => dispatch(setPRField({ field: 'checkDate', value: e ? e.toISOString() : null }))}></DatePicker>
        </div>
        <div className='pr-field pr-span-2'>
          <span className='pr-field-label'>{receiving} Account <span className='pr-required'>*</span></span>
          <Select
            allowClear
            showSearch
            status={!state.receivingAccount ? 'warning' : undefined}
            placeholder={`The ${state.transactionMode == 'Cash' ? 'cash' : 'bank'} account it goes ${state.payType != "Recievable" ? 'out of' : 'into'}`}
            value={state.receivingAccount}
            options={accountOptions(state.receivingAccounts)}
            filterOption={findAccount}
            onChange={(e) => {dispatch(setPRField({ field: 'receivingAccount', value: e }))}}
          />
        </div>
        <div className='pr-field pr-span-2'>
          <span className='pr-field-label'>On Account</span>
          {/* An antd Select hands onChange the value itself; this read
              e.target.value, so picking an option set nothing. */}
          <Select value={state.onAccount} onChange={(e)=>{dispatch(setPRField({field: 'onAccount', value: e?.target?.value ?? e}))}}>
            <Select.Option value="client">Client</Select.Option>
            <Select.Option value="shipper">Shipper</Select.Option>
            <Select.Option value="importer">Importer</Select.Option>
            <Select.Option value="clearingAgent">Clearing Agent</Select.Option>
          </Select>
        </div>
        <div className='pr-field pr-span-4'>
          <span className='pr-field-label'>Narration</span>
          <Input placeholder='Printed on the voucher' value={state.voucherNarration} onChange={(e)=>{
            dispatch(setPRField({ field: 'voucherNarration', value: e.target.value }))
          }}/>
        </div>
      </div>
    </section>

    {/* THE AMOUNTS. */}
    <section className='pr-card pr-card-amounts'>
      <h3 className='pr-card-title'>Amounts</h3>
      <div className='pr-amount'>
        <span className='pr-field-label'>{amountTitle}</span>
        {!state.advance&&!state.autoKnockOff&&
          <span className='pr-amount-value'>
            <span className='pr-amount-cur'>{state.currency}</span>{' '}
            <span>{state.totalReceivable>=0?commas(state.totalReceivable):commas(state.totalReceivable*-1)}</span>
          </span>}
        {(state.advance||state.autoKnockOff)&&<InputNumber
          className='pr-amount-input'
          value={state.autoKnockOff?state.knockOffAmount:state.totalReceivable}
          onChange={(e) => {
            if(state.advance){
              dispatch(setPRField({ field: 'totalReceivable', value: e }))
            }else if(state.autoKnockOff){
              dispatch(setPRField({ field: 'knockOffAmount', value: e }))
            }
          }}
          formatter={groupThousands}
          parser={ungroupThousands}
        />}
        {state.autoKnockOff&&knockOffLoading&&<div className='grey-txt fs-11'>
          <Spinner animation='border' size='sm' style={{width: 10, height: 10}} /> Loading the next pages to settle the rest&hellip;
        </div>}
      </div>
      {/* An open voucher: its own amount, as the list shows it, and what
          the ticks leave on it as advance - red when they come to more
          than it has (settling is refused then). functions/advanceSettlement. */}
      {state.edit && (() => {
        const { amount, left } = settlementFigures(state, selection)
        return (
          <div className='pr-tiles'>
            <div className='pr-tile'>
              <span className='pr-field-label'>This Voucher:</span>
              <span className='pr-tile-value' data-testid='settle-amount'>{commas(amount)}</span>
            </div>
            <div className={`pr-tile${left < 0 ? ' is-over' : ''}`}>
              <span className='pr-field-label'>{left < 0 ? 'Over by:' : 'Stays as Advance:'}</span>
              <span className='pr-tile-value' data-testid='settle-left'>{commas(Math.abs(left))}</span>
            </div>
          </div>
        )
      })()}
      <div className='pr-grid pr-grid-2'>
        <div className='pr-field'>
          <span className='pr-field-label'>Ex. Rate</span>
          <InputNumber disabled={state.currency=='PKR'} value={state.exRate} onChange={(e) => dispatch(setPRField({ field: 'exRate', value: e }))}></InputNumber>
        </div>
        <div className='pr-field pr-field-check'>
          {/* A labelled box, as the invoice page's Round off and Approved -
              green while it is on. */}
          <label className={`pr-check-box${state.autoKnockOff ? ' is-on' : ''}`}
            title={state.autoKnockOff ? 'Untick to allocate invoice by invoice' : 'Settle the oldest invoices first, up to the amount typed'}>
            <span className='pr-field-label'>Auto KnockOff</span>
            <input type='checkbox' className='cur' aria-label='Auto KnockOff' checked={Boolean(state.autoKnockOff)}
              onChange={(e) => {dispatch(setPRField({ field: 'autoKnockOff', value: e.target.checked }))}} />
          </label>
        </div>
        <div className='pr-field'>
          <span className='pr-field-label'>
            <span className={state.gainLossAmount > 0.00 ? 'pr-gain' : undefined}>Gain</span> / <span className={state.gainLossAmount < 0.00 ? 'pr-loss' : undefined}>Loss</span>
          </span>
          <span className={`pr-readout${state.gainLossAmount > 0 ? ' pr-gain' : state.gainLossAmount < 0 ? ' pr-loss' : ''}`}>{commas(state.gainLossAmount)}</span>
        </div>
        <div className='pr-field'>
          <span className={`pr-field-label${state.gainLossAmount != 0.00 && state.gainLossAccount == null ? ' pr-missing' : ''}`}>
            Gain/Loss Account {state.gainLossAmount!=0.00 ? <span className='pr-required'>*</span> : null}
          </span>
          <Select
            allowClear
            showSearch
            disabled={state.advance}
            placeholder={`Select Account`}
            value={state.gainLossAccount}
            options={accountOptions(state.adjustAccounts)}
            filterOption={findAccount}
            onChange={(e) => {dispatch(setPRField({ field: 'gainLossAccount', value: e }))}}
          />
        </div>
      </div>
    </section>

    {/* TAX AND BANK CHARGES - who pays each: functions/paymentReceiptCosts. */}
    <section className='pr-card pr-card-costs'>
      <h3 className='pr-card-title'>Tax &amp; bank charges</h3>
      <div className='pr-costs'>
        <div className='pr-cost'>
          <div className='pr-field'>
            <span className='pr-field-label'>Tax Amount</span>
            <InputNumber
              disabled={state.percent}
              formatter={groupThousands}
              parser={ungroupThousands}
              value={state.taxAmount} onChange={(e) => {
                const value = e || 0;
                dispatch(setPRField({ field: 'taxAmount', value: value }))
              }}></InputNumber>
          </div>
          <div className='pr-field pr-field-narrow'>
            <span className='pr-field-label'>
              <Checkbox checked={state.percent} onChange={(e) => {dispatch(setPRField({ field: 'percent', value: e.target.checked })); dispatch(setPRField({ field: 'taxPercent', value: 0 })); dispatch(setPRField({ field: 'taxAmount', value: 0 }))}}>Tax %</Checkbox>
            </span>
            <InputNumber value={state.taxPercent} onChange={(e) => {
              dispatch(setPRField({ field: 'taxPercent', value: e }))
            }} disabled={!state.percent}></InputNumber>
          </div>
          <div className='pr-field pr-field-auto'>
            <span className='pr-field-label'>Paid By</span>
            <Radio.Group className='dl-segmented' optionType='button'
              value={state.taxBy||PAID_BY_US}
              options={[{ label: 'Us', value: PAID_BY_US }, { label: 'Party', value: PAID_BY_PARTY }]}
              onChange={(e) => dispatch(setPRField({ field: 'taxBy', value: e.target.value }))}
            />
          </div>
          <div className='pr-field pr-field-grow'>
            <span className='pr-field-label'>Tax Account</span>
            <Select
              allowClear
              showSearch
              placeholder={`Select Account`}
              value={state.taxAccount}
              options={accountOptions(state.adjustAccounts)}
              filterOption={findAccount}
              onChange={(e) => {dispatch(setPRField({ field: 'taxAccount', value: e })), e==undefined?dispatch(setPRField({ field: 'taxAmount', value: 0.0 })):null}}
            />
          </div>
          {partyPaysTax(state)&&<div className='pr-note'>Charged to the party - not through our bank.</div>}
        </div>
        <div className='pr-cost'>
          <div className='pr-field'>
            <span className='pr-field-label'>Bank Charges</span>
            <InputNumber
              disabled={state.bankChargesAccount==undefined}
              title={state.bankChargesAccount==undefined ? 'Choose the bank charges account first' : undefined}
              formatter={groupThousands}
              parser={ungroupThousands}
              value={state.bankChargesAmount} onChange={(e) => dispatch(setPRField({ field: 'bankChargesAmount', value: e }))}></InputNumber>
          </div>
          {/* Under Tax %, which bank charges have no counterpart of. */}
          <div className='pr-cost-gap' aria-hidden />
          <div className='pr-field pr-field-auto'>
            <span className='pr-field-label'>Charges Paid By</span>
            <Radio.Group className='dl-segmented' optionType='button'
              value={state.bankChargesBy||PAID_BY_US}
              options={[{ label: 'Us', value: PAID_BY_US }, { label: 'Party', value: PAID_BY_PARTY }]}
              onChange={(e) => dispatch(setPRField({ field: 'bankChargesBy', value: e.target.value }))}
            />
          </div>
          <div className='pr-field pr-field-grow'>
            <span className='pr-field-label'>Bank Charges Account</span>
            <Select
              allowClear
              showSearch
              placeholder={`Select Account`}
              value={state.bankChargesAccount}
              options={accountOptions(state.adjustAccounts)}
              filterOption={findAccount}
              onChange={(e) => {dispatch(setPRField({ field: 'bankChargesAccount', value: e })); e==undefined?dispatch(setPRField({ field: 'bankChargesAmount', value: 0.0 })):null}}
            />
          </div>
          {partyPaysCharges(state)&&<div className='pr-note'>Charged to the party - not through our bank.</div>}
        </div>
      </div>
    </section>
  </div>

  {!state.advance&&<section className='pr-invoices'>
    {/* HOW FAR BACK THIS LIST LOOKS - calendar periods, matching the
        half-month the books reconcile in, so early in a period the
        fortnight is genuinely short. The resolved dates are printed under
        the choice for exactly that reason: an empty list should never be a
        mystery. Widen it, or pick Custom. */}
    <div className='pr-invoices-head'>
      <h3 className='pr-card-title'>{state.payType == 'Payble' ? 'Bills' : state.payType == 'Both' ? 'Invoices & bills' : 'Invoices'}
        {state.invoiceCount > 0 && <span className='pr-count'>{state.invoiceCount}</span>}
      </h3>
      <Radio.Group
        className='dl-segmented'
        size='small'
        value={state.invoicePeriod || 'all'}
        onChange={(e) => {
          dispatch(setPRField({ field: 'invoicePeriod', value: e.target.value }))
          // A different window is a different list, so it starts at its
          // own page 1 - page 3 of a fortnight is not page 3 of a year.
          dispatch(setPRField({ field: 'invoicePage', value: 1 }))
          // Handed over rather than left to state, which this dispatch
          // has not updated yet. Picking a period is browsing by
          // period, so it ends any search.
          if (e.target.value !== 'custom') fetchInvoices(1, e.target.value, undefined, '')
        }}
      >
        <Radio.Button value='fortnight'>Fortnight</Radio.Button>
        <Radio.Button value='month'>Month</Radio.Button>
        <Radio.Button value='quarter'>Quarter</Radio.Button>
        <Radio.Button value='fiscalYear'>Fiscal Year</Radio.Button>
        <Radio.Button value='all'>All</Radio.Button>
        {/* Last, so its dates open right beside it. */}
        <Radio.Button value='custom'>Custom</Radio.Button>
      </Radio.Group>
      {state.invoicePeriod === 'custom' && (
        <>
          <DatePicker
            size='small' format='DD-MM-YYYY' placeholder='From'
            value={state.invoiceFrom ? moment(state.invoiceFrom, 'YYYY-MM-DD') : null}
            onChange={(d) => dispatch(setPRField({
              field: 'invoiceFrom', value: d ? d.format('YYYY-MM-DD') : null,
            }))}
          />
          <DatePicker
            size='small' format='DD-MM-YYYY' placeholder='To'
            value={state.invoiceTo ? moment(state.invoiceTo, 'YYYY-MM-DD') : null}
            onChange={(d) => dispatch(setPRField({
              field: 'invoiceTo', value: d ? d.format('YYYY-MM-DD') : null,
            }))}
          />
          <button
            type='button'
            className='dl-tool'
            disabled={!state.invoiceFrom || !state.invoiceTo}
            onClick={() => {
              dispatch(setPRField({ field: 'invoicePage', value: 1 }))
              fetchInvoices(1, 'custom', { from: state.invoiceFrom, to: state.invoiceTo }, '')
            }}
          >Apply</button>
        </>
      )}

      {/* SEARCH. Runs on the server over every page and every period -
          see fetchInvoices - so "not found" means not found, not "not on
          this page". Hidden while editing a saved receipt: that list is
          the invoices the voucher already allocated against, and a search
          would replace it with a browse list. */}
      <div className='pr-invoices-tools'>
        {/* WHAT THIS RECEIPT PAYS, across every search and page - the
            rows on screen only ever show part of it. Opens the full list. */}
        {chosen.length > 0 && (
          <button type='button' className='dl-tool pr-chosen' onClick={() => setSelectionOpen(true)}
            title='See every invoice chosen for this receipt'>
            <b>{chosen.length}</b>&nbsp;selected &middot; {state.currency} {commas(chosenTotal)}
          </button>
        )}
        {!state.edit && (
          <Input.Search
            allowClear
            placeholder='Search invoice, job, HBL, MBL, container or amount'
            value={searchText}
            disabled={!state.selectedAccount}
            onChange={(e) => setSearchText(e.target.value)}
            // Enter, the button, and (antd 4) the clear icon all land here.
            onSearch={runSearch}
            style={{ width: 340 }}
          />
        )}
      </div>
    </div>

    <div className='pr-invoices-note'>
      {state.invoiceSearch ? (
        <>Matching &ldquo;{state.invoiceSearch}&rdquo; across all periods &middot; {state.invoiceCount} found{periodNote}</>
      ) : state.invoicePeriod === 'all' && state.selectedAccount ? (
        <>Every outstanding invoice, whenever raised &middot; {state.invoiceCount} in all{periodNote}</>
      ) : state.invoicePeriod !== 'all' && state.invoicePeriodRange ? (
        <>Raised {moment(state.invoicePeriodRange.from, 'YYYY-MM-DD').format('DD-MM-YYYY')} to {moment(state.invoicePeriodRange.to, 'YYYY-MM-DD').format('DD-MM-YYYY')} &middot; {state.invoiceCount} in this period{periodNote}</>
      ) : null}
    </div>

    <div className={`pr-invoices-table${state.invoicesLoading ? ' is-loading' : ''}`}>
      <table className='dl-table'>
        <thead>
          <tr>
            <th>#</th>
            <th>Job #</th>
            <th>Inv/Bill #</th>
            <th>Date</th>
            <th>HBL</th>
            <th>MBL</th>
            <th>Curr</th>
            <th className='dl-num'>Ex. Rate</th>
            <th>Type</th>
            <th className='dl-num'>Amount</th>
            <th className='dl-num'>{receiving}</th>
            <th className='dl-num'>Balance</th>
            {/* SELECT ALL - meaning every invoice ON THIS PAGE, which is
                what `state.invoices` now holds. The list is paged and
                windowed to a period, so silently allocating rows the
                operator cannot see would be the wrong reading of a tick
                box; the title says which it is. Indeterminate while only
                some are ticked, so a part-allocated page does not read as
                an empty one. */}
            <th className='dl-check'>
              <input
                type="checkbox"
                title={allAllocated
                  ? 'Clear every invoice on this page'
                  : 'Allocate every invoice on this page in full'}
                checked={allAllocated}
                ref={(el) => { if (el) el.indeterminate = someAllocated && !allAllocated; }}
                onChange={(e) => {
                  const checked = e.target.checked;
                  // The rows on THIS page, into or out of the selection.
                  // Invoices chosen on other pages or searches are kept.
                  setSelection(setAllocations(selection, allocatable.map((inv) => ({
                    invoice: inv,
                    amount: checked ? allocationFor(inv, state.edit) : 0,
                  }))));
                }}
              />
            </th>
            <th>Container</th>
          </tr>
        </thead>
        <tbody>
          {/* THREE STATES, NOT TWO. An empty <tbody> was shown both while
              the fetch was in flight and when the party genuinely had
              nothing outstanding, so the operator could not tell whether to
              wait or to move on. */}
          {state.invoicesLoading && (
            <tr>
              <td colSpan={14} className='pr-table-message'>
                <Spinner animation='border' role='status' size='sm' />
                <span style={{ marginLeft: 10 }}>Loading invoices…</span>
              </td>
            </tr>
          )}
          {!state.invoicesLoading && state.invoices.length === 0 && (
            <tr>
              <td colSpan={14} className='pr-table-message'>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={!state.selectedAccount
                    ? 'Select a party to see its invoices'
                    : state.invoiceSearch
                      ? (
                        <>
                          <div>No outstanding invoice for this party matches &ldquo;{state.invoiceSearch}&rdquo;</div>
                          {/* And why the invoice that number names is not
                              here, when the server found one. */}
                          {notListedLines(state.invoiceNotListed, { currency: state.currency, payType: state.payType })
                            .map((line) => <div key={line} className='pr-not-listed'>{line}</div>)}
                        </>
                      )
                      : 'Nothing outstanding for this party'}
                />
              </td>
            </tr>
          )}
          {/* `rows`: the page, carrying the selection's amounts. Keyed by
              invoice rather than position, since the same position holds a
              different invoice after every search. */}
          {!state.invoicesLoading && rows.length>0&&rows.map((invoice, index) => {
            const taken = parseFloat(invoice.receiving) > 0;
            return (
            <tr key={invoice.id ?? index} className={taken ? 'pr-row-taken' : undefined}>
              <td className='dl-muted'>{index + 1}</td>
              <td>
                {invoice?.SE_Job?.jobNo ? (
                  <button type='button' className='pr-link' tabIndex={-1} onClick={()=>{
                    let type = invoice.SE_Job?.operation;
                    let id = invoice.SE_Job?.id
                    dispatch(incrementTab({
                      "label":type=="SE"?"SE JOB":type=="SI"?"SI JOB":type=="AE"?"AE JOB":"AI JOB",
                      "key":type=="SE"?"4-3":type=="SI"?"4-6":type=="AE"?"7-2":"7-5",
                      "id":id
                    }))
                    router.push(type=="SE"?`/seaJobs/export/${id}`:type=="SI"?`/seaJobs/import/${id}`:
                      type=="AE"?`/airJobs/export/${id}`:`/airJobs/import/${id}`
                    )
                  }}>{invoice.SE_Job?.jobNo}</button>
                ) : null}
              </td>
              <td>
                <button type='button' className='pr-link pr-link-strong' tabIndex={-1} onClick={()=>{
                  if(invoice?.id){
                    dispatch(incrementTab({ "label": "Invoice Details", "key": "3-17", "id":`${invoice.id}`}))
                    router.push(`/reports/invoice/${invoice.id}`)
                  }
                }}>{invoice.invoice_No}</button>
              </td>
              <td className='dl-muted'>{invoiceDate(invoice)}</td>
              <td className='dl-muted'>{invoice.SE_Job?.Bl?.hbl}</td>
              <td className='dl-muted'>{invoice.SE_Job?.Bl?.mbl}</td>
              <td>{invoice.currency}</td>
              <td className='dl-num dl-muted'>{invoice.ex_rate}</td>
              <td><span className={`dl-badge ${invoice.payType=="Recievable" ? 'tone-green' : 'tone-violet'}`}>{invoice.payType=="Recievable"?"DN":"CN"}</span></td>
              <td className='dl-num dl-strong'>{commas(invoice.total)}</td>
              <td className='dl-num pr-receiving'>
                <InputNumber value={parseFloat(invoice.receiving)}
                  formatter={groupThousands}
                  parser={ungroupThousands}
                  onChange={(e) => {
                    // A minus only against an invoice paid over, to bring it
                    // back to zero - see allowedAmount.
                    setSelection(setAllocation(selection, invoice, allowedAmount(invoice, e, state.edit)));
                  }}
                />
              </td>
              <td className={`dl-num pr-balance pr-balance-${calculateColor(invoice)}`}>
                {commas(balanceAfter(invoice, state.edit))}
              </td>
              <td className='dl-check'>
                <input type="checkbox" checked={isFullyAllocated(invoice, state.edit)} onChange={(e) => {
                  setSelection(setAllocation(selection, invoice, e.target.checked ? allocationFor(invoice, state.edit) : 0));
                }} />
              </td>
              <td className='dl-muted'>{invoice.container}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>

    {/* The pager is built from the count the SERVER reports for the whole
        period, not from the rows in hand - the point of paging here is
        that the rows in hand are deliberately few. */}
    {state.invoiceCount > (state.invoicePageSize || 50) && (
      <div className='dl-footer'>
        <span />
        <Pagination
          noOfPages={Math.ceil(state.invoiceCount / (state.invoicePageSize || 50))}
          currentPage={state.invoicePage || 1}
          setCurrentPage={(p) => fetchInvoices(p, state.invoicePeriod)}
        />
      </div>
    )}
  </section>}
  {/* EVERYTHING THIS RECEIPT PAYS, found by whatever searches and pages it
      took. Amounts can be changed or taken off here, the same as on the list
      - it is the same selection. */}
  <Modal
    title={`Invoices selected for this ${state.payType == 'Recievable' ? 'receipt' : 'payment'}`}
    open={selectionOpen}
    onCancel={() => setSelectionOpen(false)}
    footer={null}
    width={'80%'}
    centered
    wrapClassName='pr-modal'
  >
    {chosen.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No invoices selected' />
    ) : (
      <div className='pr-modal-table'>
        <table className='dl-table'>
          <thead>
            <tr>
              {['#', 'Job #', 'Inv/Bill #', 'Date', 'HBL', 'Curr', 'Type', 'Amount', `${receiving} Amount`, 'Balance', ''].map((h, i) => (
                <th key={i} className={['Amount', `${receiving} Amount`, 'Balance'].includes(h) ? 'dl-num' : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byInvoiceDate(chosen)
              .map((inv, i) => {
                // The list's own Balance column, to the letter.
                const balance = balanceAfter(inv, state.edit);
                return (
                  <tr key={inv.id}>
                    <td className='dl-muted'>{i + 1}</td>
                    <td>{inv.SE_Job?.jobNo}</td>
                    <td className='dl-strong'>{inv.invoice_No}</td>
                    <td className='dl-muted'>{invoiceDate(inv)}</td>
                    <td className='dl-muted'>{inv.SE_Job?.Bl?.hbl}</td>
                    <td>{inv.currency}</td>
                    <td><span className={`dl-badge ${inv.payType == 'Recievable' ? 'tone-green' : 'tone-violet'}`}>{inv.payType == 'Recievable' ? 'DN' : 'CN'}</span></td>
                    <td className='dl-num'>{commas(inv.total)}</td>
                    <td className='dl-num pr-receiving'>
                      <InputNumber value={parseFloat(inv.receiving)}
                        formatter={groupThousands}
                        parser={ungroupThousands}
                        onChange={(e) => {
                          setSelection(setAllocation(selection, inv, allowedAmount(inv, e, state.edit)));
                        }}
                      />
                    </td>
                    <td className={`dl-num pr-balance pr-balance-${calculateColor(inv)}`}>{commas(balance)}</td>
                    <td className='dl-check'>
                      <CloseCircleOutlined className='cur pr-remove' title='Take off this receipt'
                        onClick={() => setSelection(setAllocation(selection, inv, 0))} />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    )}
    <div className='pr-modal-foot'>
      <span>
        {chosen.length} invoice{chosen.length === 1 ? '' : 's'} &middot; total{' '}
        <b>{state.currency} {commas(chosenTotal)}</b>
      </span>
      <span className='d-flex' style={{ gap: 8 }}>
        {chosen.length > 0 && (
          <button type='button' className='dl-tool pr-danger' onClick={() => {
            setSelection(setAllocations(selection, chosen.map((inv) => ({ invoice: inv, amount: 0 }))));
          }}>Clear all</button>
        )}
        <button type='button' className='btn-custom px-4' onClick={() => setSelectionOpen(false)}>Done</button>
      </span>
    </div>
  </Modal>
  {/* THE JOURNAL IT WILL POST - checked before Approve & Save posts it. */}
  <Modal title={null} open={state.modal} onOk={()=>dispatch(setPRField({ field: 'modal', value: false }))}
      onCancel={()=>dispatch(setPRField({ field: 'modal', value: false }))} footer={false} maskClosable={false} width={'80%'} centered
      wrapClassName='pr-modal'
    >
      <div className='pr-journal-head'>
        <div>
          <div className='pr-field-label'>Before it is posted</div>
          <h3 className='pr-journal-title'>Proceed with transaction?</h3>
        </div>
        <div className='pr-journal-meta'>
          <span>Currency <b>{state.currency}</b></span>
          <span>Ex. Rate <b>{state.exRate}</b></span>
        </div>
      </div>
      <div className='pr-modal-table'>
        <table className='dl-table'>
          <thead>
            <tr>
              <th>Account Type</th>
              <th>Account Name</th>
              <th className='dl-num'>Debit</th>
              <th className='dl-num'>Credit</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {state.transactions.map((x, i)=>{
              const isTotal = x.accountName === 'Total' && !x.accountType;
              return (
                <tr key={i} className={isTotal ? 'pr-journal-total' : undefined}>
                  <td className='dl-muted'>{x.accountType}</td>
                  <td className={isTotal ? 'dl-strong' : undefined}>{x.accountName}</td>
                  <td className='dl-num'>{x.debit ? commas(x.debit) : <span className='dl-muted'>-</span>}</td>
                  <td className='dl-num'>{x.credit ? commas(x.credit) : <span className='dl-muted'>-</span>}</td>
                  <td>{x.type ? <span className={`dl-badge ${x.type === 'debit' ? 'tone-blue' : 'tone-amber'}`}>{x.type}</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* A dialog's actions belong at its foot, on the right, with the
          way out beside the way on. */}
      <div className='pr-modal-foot pr-modal-foot-end'>
        <button type='button' className='dl-tool'
          disabled={submitting}
          onClick={()=>dispatch(setPRField({ field: 'modal', value: false }))}>
          Cancel
        </button>
        <button type='button'
          className={submitting ? 'btn-custom-disabled px-4' : 'btn-custom px-4'}
          disabled={submitting}
          onClick={()=>{submitTransaction()}}>
          {submitting ? 'Saving…' : 'Approve & Save'}
        </button>
      </div>
  </Modal>
  </>
  )
}

export default React.memo(BillComp)
