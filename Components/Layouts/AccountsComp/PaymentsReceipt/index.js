import React, { useState, useRef, useEffect, useMemo, useCallback, useReducer } from 'react';
import { SearchOutlined, CloseCircleOutlined, SyncOutlined, PrinterOutlined, RollbackOutlined, PlusCircleOutlined, PlusOutlined, ArrowLeftOutlined, DollarOutlined } from "@ant-design/icons";
import { MdHistory } from "react-icons/md";
import { Input, Radio, Select, Alert, Spin, Empty } from 'antd';
import { recordsReducer, initialState, getNewInvoices } from './states';
import { useSelector, useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import Router, { useRouter } from 'next/router';
import BillComp from './BillComp';
import PrintTransaction from './PrintTransaction';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import DeleteVoucher from './DeleteVoucher';
import ChequeReturn from './ChequeReturn';
import { chequeReturnState } from 'functions/chequeReturn';
import Pagination from '../../../Shared/Pagination';
import openNotification from "../../../Shared/Notification";
import {checkEditAccess} from "functions/checkEditAccess";
import { usePageActions } from 'Components/Shared/PageActions';
import { useDocuments } from 'Components/Shared/Documents';
import { paymentProblems, postBlockedReason } from 'functions/paymentReceiptChecks';
import { isSettling, settleProblems, voucherAmountOf } from 'functions/advanceSettlement';
import { seedFromSaved } from 'functions/paymentReceiptSelection';
import { paidByFromHeads } from 'functions/paymentReceiptCosts';
import {checkEmployeeAccess} from "functions/checkEmployeeAccess";
import { setPRField, resetState, clearVoucher } from 'redux/paymentReciept/paymentRecieptSlice';
import Cookies from "js-cookie";
import { partyLabel } from 'functions/partyLabel';
import { isOwed } from 'functions/invoiceOwed';
import { byInvoiceDate } from 'functions/invoiceDates';
import { voucherRows } from 'functions/paymentReceiptVoucherRows';
import AuditStamp from 'Components/Shared/AuditStamp';

// Vouchers to a page of the list.
const PAGE_SIZE = 50;

/* What each kind of voucher is, for the list's label: receipts green, payments
 * violet, their adjustments a shade of each, a returned cheque red. */
const VOUCHER_KINDS = {
  BRV: { name: 'Bank receipt', tone: 'green' },
  CRV: { name: 'Cash receipt', tone: 'green' },
  'ADJ-R': { name: 'Receipt adjustment', tone: 'emerald' },
  BPV: { name: 'Bank payment', tone: 'violet' },
  CPV: { name: 'Cash payment', tone: 'violet' },
  'ADJ-P': { name: 'Payment adjustment', tone: 'blue' },
  CR: { name: 'Cheque return', tone: 'red' },
};

const commas = (a) => a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const PaymentsReceipt = ({ id, voucherData, q }) => {
  // console.log("Query: ", q)
  const dispatch = useDispatch();
  const state = useSelector((state) => state.paymentReciept);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  // How many vouchers the search finds in all - the server's count.
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);

  const [searchInput, setSearchInput] = useState(state.search || "");

  useEffect(() => {
    const handler = setTimeout(() => {
      dispatch(setPRField({ field: "search", value: searchInput }));
    }, 500); // 👈 delay in ms

    return () => clearTimeout(handler);
  }, [searchInput]);

  /* THE NEWEST REQUEST WINS. A fetch made while one was still loading was
   * dropped (`if (loading) return`), so a search typed before the last one
   * came back was never run, and the list kept the earlier word's results.
   * Every fetch now runs; an answer that is no longer the latest is thrown
   * away, so a slow earlier one cannot land on top of a newer one either. */
  const fetchSeq = useRef(0);
  const fetchOldVouchers = async (pageNum = 1) => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    try {
      const response = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_OLD_PAY_REC_VOUCHERS, {
        params: {
          companyid: Cookies.get("companyId"),
          page: pageNum,
          limit: PAGE_SIZE,
          search: state.search || ""
        }
      });

      if (seq !== fetchSeq.current) return;
      const { result, totalPages, total } = response.data;
      setTotalPages(totalPages);
      setTotal(Number(total) || 0);
      setPage(pageNum);

      // Nothing found is an answer too: the list empties. It was only ever
      // replaced by a non-empty one, so a search that matched nothing left the
      // previous list on screen - as if the search had not run.
      dispatch(setPRField({ field: "oldVouchers", value: voucherRows(result) }));
    } catch (error) {
      console.error("Error fetching old vouchers:", error);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchOldVouchers(1);
  }, []);

  useEffect(() => {
    setPage(1);
    fetchOldVouchers(1);
  }, [state.search]);

  const fetchAccounts = async () => {
    console.log("Fetching Accounts for type:", state.type)
    const accounts = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/misc/parties/getPartiesbyType`,
      { headers:{companyid: Cookies.get('companyId'), type: state.type} }
    ).then((x) => {
      console.log(">>>>>>>>>>>.", x.data.result)
      dispatch(setPRField({ field: 'PRaccounts', value: x.data.result }));
    })
  }

  useEffect(() => {
    fetchAccounts();
  }, [state.type])

  const columnDefs = [
    { title: "Voucher No.", dataIndex: "voucherNo", key: "voucherNo" },
    { title: "Name", dataIndex: "name", key: "name" },
    { title: "Party", dataIndex: "party", key: "party" },
    { title: "Type", dataIndex: "type", key: "type" },
    { title: "Date", dataIndex: "date", key: "date" },
    { title: "Currency", dataIndex: "currency", key: "currency" },
    { title: "Amount", dataIndex: "amount", key: "amount" },
  ]

  // The hidden print trigger inside PrintTransaction - the toolbar's Print
  // clicks it rather than owning a second copy of the print logic.
  const printTriggerRef = useRef(null);
  // BillComp keeps this pointed at its makeTransaction - see the note there.
  const makeTransactionRef = useRef(null);

  const back = async () => {
    dispatch(resetState())
    Router.push(`/accounts/paymentReceipt/undefined`);
    fetchOldVouchers();
    fetchAccounts();
  }

  const refresh = async () =>{
    // Same flag the first load uses, so re-opening a saved voucher shows the
    // list loading rather than briefly showing it empty.
    dispatch(setPRField({ field: 'invoicesLoading', value: true }))
    try{
      await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_INVOICE_BY_PARTY_ID, {
        headers: {
          id: state.selectedAccount,
          companyid: Cookies.get('companyId'),
          invoicecurrency: state.currency,
          pay: state.payType,
          type: state.type,
          edit: true,
        }
      }).then((x) => {
        console.log("Invoices", x.data.result)
        let temp = []
        // Only what still has money on it - see functions/invoiceOwed. It was
        // "total less received/paid is not exactly 0", which kept invoices paid
        // in full on the list at 0.00 (or at their round off).
        state.edit?temp  = x.data.result.filter(isOwed):
        temp = x.data.result;
        let temp2 = [...state.invoices];
        console.log("TEMP>>", temp)
        console.log("TEMP2>>", temp2)
        const map = new Map();
        temp2.forEach(item => map.set(item.id, item));
        temp.forEach(item => {
          console.log("Item:", item)
          console.log("State:", state)
          item.receiving = 0
          item.Invoice_Transactions.forEach((tran)=>{
            if(tran.VoucherId.toString()==state.voucherId){
              item.receiving += parseFloat(tran.amount)
            }
          })
          item.constReceiving = item.receiving
          console.log("ITEM: ", item)
          map.set(item.id, item);
        });

        // Get the union as an array - by date and time, ties in the order raised.
        const union = byInvoiceDate(Array.from(map.values()));
        console.log(union)
        dispatch(setPRField({ field: 'editing', value: true }))
        dispatch(setPRField({ field: 'advance', value: false }))
        dispatch(setPRField({ field: 'invoices', value: union }))
        // The receipt's own invoices, at what it paid, are what it starts out
        // paying - the list only displays them now. See paymentReceiptSelection.
        dispatch(setPRField({ field: 'selectedInvoices', value: seedFromSaved(union) }))
      })
    }catch(e){
      console.log(e)
      openNotification('Error', e?.response?.data?.result || 'Could not load invoices for this voucher.', 'red')
    }finally{
      dispatch(setPRField({ field: 'invoicesLoading', value: false }))
    }
  }

  const deleteVoucher = () => {
    axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_DELETE_PAY_REC,{
      id: state.voucherId,
      employeeId: Cookies.get("loginId")
    }).then((x) => {
      // console.log(x.data.status)
      if(x.data.status=="success"){
        back()
      }
    })
    
  }

  const openOldVouchers = (x) => {
    // The last voucher's invoices, charges and amounts go first - this one
    // sets only what it has. See clearVoucher in the store.
    dispatch(clearVoucher())

    console.log("CONSOLE: ", x.x)
    console.log("Selected Account>>", x.x.invoice);
    dispatch(setPRField({ field: 'type', value: x.party }))
    dispatch(setPRField({ field: 'edit', value: true }))
    dispatch(setPRField({ field: 'selectedAccount', value: parseInt(x.partyId) }))
    dispatch(setPRField({ field: 'currency', value: x.currency }))
    dispatch(setPRField({ field: 'date', value: x.data }))
    dispatch(setPRField({ field: 'checkNo', value: x.x.chequeNo }))
    // None when it has none - moment(null) is an invalid date, not an empty one.
    dispatch(setPRField({ field: 'checkDate', value: x.x.chequeDate ? moment(x.x.chequeDate) : null }))
    dispatch(setPRField({ field: 'exRate', value: x.x.exRate }))
    dispatch(setPRField({ field: 'subType', value: x.x.subType }))
    dispatch(setPRField({ field: 'voucherId', value: x.id }))
    // The whole record: its number, its stamps, a cheque return - see the store.
    dispatch(setPRField({ field: 'openedVoucher', value: x.x }))
    if(x.x.invoice.length == 0){
      dispatch(setPRField({ field: 'advance', value: true }))
    }else{
      // Each invoice keeps EVERY knock-off on it, as the list sent it - what
      // is settled on it is read from them (paymentReceiptSelection settled).
      // They were swapped for this voucher's one row, which nothing reads, so
      // the screen fell back on the invoice's received figure; this voucher's
      // own share is `receiving` / `constReceiving`, set when the list loaded.
      let temp = x.x.invoice.map((inv) => ({ ...inv }))
      console.log("TEMP: ", temp)
      dispatch(setPRField({ field: 'invoices', value: temp }))
      dispatch(setPRField({ field: 'selectedInvoices', value: seedFromSaved(temp) }))
    }
    // console.log("Invoice in P/R", x.x.invoice)
    dispatch(setPRField({ field: 'voucherNarration', value: x.x.voucherNarration }))
    // What settling it can knock off at most - functions/advanceSettlement.
    dispatch(setPRField({ field: 'voucherAmount', value: voucherAmountOf(x.x.Voucher_Heads) }))
    x.x.Voucher_Heads.forEach((y) => {
      console.log("Voucher Heads: ", y)
      if(y.accountType=="payAccount"){
        dispatch(setPRField({ field: 'receivingAccount', value: y.ChildAccountId }));
        dispatch(setPRField({ field: 'receivingAmount', value: parseFloat(y.amount) }))
      }
      if(y.accountType=="partyAccount"||y.accountType=="General"||y.accountType=="Admin Expense"){
        // dispatch(setPRField({ field: 'voucherNarration', value: y.narration }))
        dispatch(setPRField({ field: 'totalReceivable', value: parseFloat(y.amount) }));
        // dispatch(setPRField({ field: 'selectedAccount', value: parseInt(y.ChildAccountId) }))
      }
      if((y.accountType=="Gain/Loss Account") && y.ChildAccountId != x.x.Voucher_Heads.find((x)=>x.accountType=="partyAccount").ChildAccountId){
        y.type!='debit'?
        dispatch(setPRField({ field: 'gainLossAmount', value: parseFloat(y.amount)*parseFloat(x.x.exRate) })):
        dispatch(setPRField({ field: 'gainLossAmount', value: (parseFloat(y.amount)*-1)*parseFloat(x.x.exRate) }))
        dispatch(setPRField({ field: 'gainLossAccount', value: y.ChildAccountId }))
      }
      if(y.accountType.includes('Charges Account')){
        dispatch(setPRField({ field: 'bankChargesAmount', value: parseFloat(y.amount) }));
        dispatch(setPRField({ field: 'bankChargesAccount', value: y.ChildAccountId }))
      }
      if(y.accountType.includes('Tax Account')){
        dispatch(setPRField({ field: 'taxAmount', value: parseFloat(y.amount) }));
        dispatch(setPRField({ field: 'taxAccount', value: y.ChildAccountId }))
      }

    })
    // Who paid the tax and the bank charges: a line of theirs on the party's
    // own account means the party did. The amount and the account are the
    // account's own line - the party's twin of it is not an account to pick.
    // See functions/paymentReceiptCosts.
    const paidBy = paidByFromHeads(x.x.Voucher_Heads)
    dispatch(setPRField({ field: 'taxBy', value: paidBy.taxBy }))
    dispatch(setPRField({ field: 'bankChargesBy', value: paidBy.bankChargesBy }))
    if(paidBy.taxHead){
      dispatch(setPRField({ field: 'taxAmount', value: parseFloat(paidBy.taxHead.amount) }))
      dispatch(setPRField({ field: 'taxAccount', value: paidBy.taxHead.ChildAccountId }))
    }
    if(paidBy.chargesHead){
      dispatch(setPRField({ field: 'bankChargesAmount', value: parseFloat(paidBy.chargesHead.amount) }))
      dispatch(setPRField({ field: 'bankChargesAccount', value: paidBy.chargesHead.ChildAccountId }))
    }

    if(x.type.includes('P')){
      dispatch(setPRField({ field: 'payType', value: 'Payble' }))
    }else{
      dispatch(setPRField({ field: 'payType', value: 'Recievable' }))
    }
    if(x.type.includes('C')){
      dispatch(setPRField({ field: 'transactionMode', value: 'Cash' }))
      dispatch(setPRField({ field: 'subType', value: 'Cash' }))
    }else if(x.type.includes('B')){
      dispatch(setPRField({ field: 'transactionMode', value: 'Bank' }))
      dispatch(setPRField({ field: 'subType', value: 'Cheque' }))
    }else if(x.type.includes('ADJ')){
      console.log("Caught Adjust")
      dispatch(setPRField({ field: 'transactionMode', value: 'Adjust' }))
      dispatch(setPRField({ field: 'subType', value: 'Cheque' }))
    }
  }

  /* OPENED BY ITS ADDRESS - /accounts/paymentReceipt/<id>, from the Ledger or
   * a Job Balancing advance row. It looked only in the page of the list it
   * had loaded, and the list is a page of the newest - so an older voucher,
   * and any at all before the list had arrived, did not open (the user,
   * 2026-11-20). Now: on the page, opened from there; not, fetched by its id
   * in the list's own shape (routes/voucher getAllJobPayRecVouchers ?id=). */
  useEffect(() => {
    const want = parseInt(id, 10);
    if (!Number.isFinite(want) || String(state.voucherId) === String(want)) return undefined;
    const onPage = state.oldVouchers.find((x) => x.id == want);
    if (onPage) { openOldVouchers(onPage); return undefined; }
    let alive = true;
    axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_OLD_PAY_REC_VOUCHERS, { params: { id: want, page: 1, limit: 1 } })
      .then(({ data }) => {
        if (!alive) return;
        const [row] = voucherRows(data?.result);
        if (row) openOldVouchers(row);
        else openNotification('Not found', 'That payment or receipt is not here - deleted, or in a company you do not work in.', 'orange');
      })
      .catch(() => { if (alive) openNotification('Error', 'Could not open that payment or receipt.', 'red'); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if(q.partyId){
      dispatch(setPRField({ field: 'type', value: q.partyType }));
      dispatch(setPRField({ field: 'payType', value: q.payType }));
      dispatch(setPRField({ field: 'selectedAccount', value: q.partyId.toString() }));
    }else{
      console.log("No query")
    }
  }, [q])

  // console.log("State>", state)

  /* THE ACTION ROW MOVES TO THE TOOLBAR.
   *
   * These five used to appear and disappear as the screen changed state -
   * Delete, Print and Refresh only once a voucher was open, Advance only
   * before one was - so the row reflowed under the cursor and the buttons
   * landed somewhere new each time. In the toolbar they keep their positions
   * and go grey instead, and each says why it is unavailable.
   *
   * Delete does NOT take the toolbar's own confirm: this screen already has a
   * proper confirmation dialog of its own, and two questions in a row for one
   * click teaches people to click through both. */
  const chosen = !(state.selectedAccount == '' || state.selectedAccount == undefined);
  const openVoucher = chosen && state.edit;

  /* CHEQUE RETURN - on an open bank payment or receipt, whose cheque came
   * back (the user's request, 2026-10-13). The dialog shows the CR and posts
   * it; once returned, the voucher can no longer be changed or deleted, so
   * Make Transaction and Delete go grey and say why. See functions/
   * chequeReturn. */
  const [chequeReturnOpen, setChequeReturnOpen] = useState(false);
  const openedVoucher = openVoucher ? state.openedVoucher : null;
  const chequeReturn = chequeReturnState(openedVoucher);
  const returnedBy = chequeReturn.returnedBy;

  /* MAKE TRANSACTION IS THIS SCREEN'S PRIMARY ACTION, so it takes the Save
   * slot under its own name - the same override that makes the flight form's
   * destructive verb "Cancel Flight".
   *
   * It is honest about what it does: it validates and opens the journal
   * preview. Approve & Save inside that dialog is what actually posts, and
   * stays there, with the journal it is approving.
   *
   * Disabled until the form can be posted, with the tooltip naming everything
   * still missing. That is strictly more than the old button gave: it looked
   * pressable always, and told you one problem per press. */
  /* SETTLING (Refresh pressed on an open voucher): the save sends only the
   * ticks, the voucher does not change, and the only thing that can stop it
   * is ticking more than the voucher brought in - functions/advanceSettlement. */
  const settling = isSettling(state);
  const problems = !chosen ? [] : settling ? settleProblems(state, state.selectedInvoices) : paymentProblems(state);
  const canPost = chosen && problems.length === 0;

  // The open voucher's documents - a cheque, a deposit slip (the user's
  // request, 2026-11-13): the paperclip in the toolbar, as on the Voucher screen.
  const docs = useDocuments({
    entity: 'Vouchers',
    recordId: openVoucher ? state.voucherId : null,
    title: `Documents - Voucher ${openedVoucher?.voucher_Id || ''}`,
  });

  usePageActions({
    title: 'Payment / Receipt',
    subtitle: settling ? 'Settling invoices against this voucher' : openVoucher ? 'Editing a voucher' : undefined,
    save: {
      onClick: () => makeTransactionRef.current?.(),
      label: settling ? 'Save Settlement' : 'Make Transaction',
      disabled: !canPost || Boolean(returnedBy),
      title: !chosen
        ? 'Choose an account first'
        : returnedBy ? `Cheque returned - ${returnedBy}; this voucher can no longer be changed`
        : settling ? (problems[0] || 'Knock the ticked invoices off against this voucher - the voucher itself does not change')
        : (postBlockedReason(state) || 'Check the entries, then post this transaction'),
    },
    // Asks in the app's own delete dialog, as every screen's Delete does -
    // this screen had a box of its own ("Are you sure?").
    delete: {
      onClick: () => deleteVoucher(),
      confirm: { what: 'voucher', name: openedVoucher?.voucher_Id, body: 'Its lines go with it, out of the ledger. This cannot be undone.' },
      disabled: !openVoucher || Boolean(returnedBy),
      title: !openVoucher ? 'Open a voucher first'
        : returnedBy ? `Cheque returned - ${returnedBy}; this voucher can no longer be deleted` : 'Delete this voucher',
    },
    print: {
      onClick: () => printTriggerRef.current?.click(),
      disabled: !openVoucher,
      title: openVoucher ? 'Print this transaction' : 'Open a voucher first',
    },
    extras: [
      docs.extra,
      {
        key: 'advance',
        label: 'Advance transaction',
        Icon: DollarOutlined,
        onClick: () => dispatch(setPRField({ field: 'advance', value: true })),
        disabled: !chosen || state.edit,
        title: !chosen ? 'Choose an account first'
          : state.edit ? 'Not while a voucher is open' : 'Record an advance',
      },
      {
        key: 'chequeReturn',
        label: 'Cheque Return',
        Icon: RollbackOutlined,
        onClick: () => setChequeReturnOpen(true),
        disabled: !chequeReturn.available,
        title: chequeReturn.title,
      },
      {
        key: 'refresh',
        label: 'Refresh',
        Icon: SyncOutlined,
        onClick: refresh,
        disabled: !openVoucher,
        title: openVoucher ? 'Reload this voucher' : 'Open a voucher first',
      },
      {
        key: 'back',
        label: 'Back',
        Icon: ArrowLeftOutlined,
        onClick: back,
        disabled: !chosen,
        title: chosen ? 'Back to the account list' : 'Nothing to go back from',
      },
    ],
  }, [chosen, openVoucher, canPost, postBlockedReason(state), chequeReturn.available, chequeReturn.title, docs.count, docs.saved]);

  return (
    <div className='base-page-layout pr-screen'>
      {docs.modal}
      <ChequeReturn open={chequeReturnOpen} voucherId={state.voucherId}
        onClose={() => setChequeReturnOpen(false)}
        onDone={() => { setChequeReturnOpen(false); back(); }} />
      {returnedBy && (
        <Alert type='warning' showIcon style={{ marginBottom: 8 }}
          message={`This cheque was returned - ${returnedBy}. The voucher can no longer be changed or deleted.`} />
      )}
      {/* START ONE - the pay type, the party and the currency. Picking the
          party opens the transaction under the list's place; these stay at
          the top while it is open. They shared one row with the LIST's search,
          which did nothing once a party was picked (2026-11-15 redesign). */}
      <div className='pr-start'>
        <span className='pr-start-label'>{chosen ? (openVoucher ? 'Voucher' : 'New transaction') : 'New payment / receipt'}</span>
        {/* THE CLIENT / VENDOR / AGENT SELECTOR IS GONE. It made the user
            state how a party had been categorised before the screen would show
            them anybody - and a party filed as neither was simply unreachable.
            Every party is in one list now; see the `all` branch in
            routes/misc/parties.

            What it drove is not lost: what the party is, for the stored
            voucher.partyType and the print's title, is read from the party's
            own `types` - see functions/paymentReceiptParty. */}
        <Radio.Group className='dl-segmented' value={state.payType} onChange={(e)=>{dispatch(setPRField({ field: 'payType', value: e.target.value }))}}>
          <Radio.Button value={'Recievable'}>Receivable</Radio.Button>
          <Radio.Button value={'Payble'}>Payable</Radio.Button>
          {/* Payables AND receivables at once - what the agent branch used to
              do by skipping the filter entirely, now an explicit choice that
              works for any party. */}
          <Radio.Button value={'Both'}>Both</Radio.Button>
        </Radio.Group>
        <Select
          allowClear
          showSearch
          className='pr-party'
          placeholder={'Choose a party to start'}
          value={state.selectedAccount}
          // With the party code, as every report's party picker shows it -
          // and searchable by it, since the filter reads the label.
          options={state.PRaccounts?.map((account) => ({
            label: partyLabel(account),
            value: account.id,
          }))}
          filterOption={(input, option) =>
            option?.label.toLowerCase().includes(input.toLowerCase())
          }
          onChange={(e) => {
            if(e==undefined){
              dispatch(resetState());
              fetchOldVouchers();
              fetchAccounts();
            }else{
              // What the party IS is read from it when it is saved and
              // printed - functions/paymentReceiptParty.
              dispatch(setPRField({ field: 'selectedAccount', value: e }))
            }
          }}
        />
        <Select
          className='pr-currency'
          placeholder={`Currency`}
          value={state.currency}
          /* Always selectable. It used to unlock only for an agent, which
             meant a foreign-currency bill from anyone else could not be
             settled at all. Defaults to PKR, which is every invoice in the
             book today. */
          onChange={(e)=>{dispatch(setPRField({ field: 'currency', value: e }))}}
          // AED was offered as "vlaue", so picking it set nothing.
          options={['PKR', 'USD', 'EUR', 'GBP', 'AED', 'OMR', 'BDT', 'CHF'].map((c) => ({ value: c, label: c }))}
        />
        {/* The printable markup stays mounted while a voucher is open -
            ReactToPrint copies a live node - but its own button is hidden
            and the toolbar's Print clicks it. */}
        {/* WHO MADE IT AND WHO LAST CHANGED IT - the voucher's audit stamps
            (functions/auditStamp), as the Voucher screen shows them. They were
            on every P&R voucher and shown nowhere here (the user, 2026-11-20). */}
        {openVoucher && <AuditStamp className='pr-audit' record={state.openedVoucher} />}
        {openVoucher && (
          <PrintTransaction
            state={state}
            companyId={Cookies.get('companyId')}
            hideTrigger
            triggerRef={printTriggerRef}
          />
        )}
      </div>

      {/* THE VOUCHERS - the shared list look (styles/dataList). */}
      {!chosen && (
        <div className='pr-list'>
          <div className='dl-toolbar'>
            <Input
              allowClear
              className='dl-search'
              prefix={<SearchOutlined />}
              placeholder='Search voucher no, party, invoice no, cheque no, amount...'
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <span className='dl-total'>
              {loading && <Spin size='small' />}
              {total.toLocaleString()} voucher{total === 1 ? '' : 's'}
            </span>
          </div>
          <div className={`dl-table-wrap${loading ? ' is-loading' : ''}`} aria-busy={loading}>
            {state.oldVouchers.length === 0 ? (
              <div className='dl-empty'>
                <Empty description={loading ? 'Loading…' : state.search ? `Nothing found for "${state.search}"` : 'No payments or receipts yet'} />
              </div>
            ) : (
              <table className='dl-table'>
                <thead>
                  <tr>
                    <th>Voucher No.</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Party</th>
                    <th>Against</th>
                    <th>Cheque</th>
                    <th>Cur.</th>
                    <th className='dl-num'>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {state.oldVouchers.map((x, i) => {
                    const kind = VOUCHER_KINDS[String(x.type || '').toUpperCase()];
                    const returned = x.x?.returnedBy;
                    return (
                      <tr key={x.id ?? i} className='dl-click' onClick={() => openOldVouchers(x)}>
                        {/* NOT a way into the transaction - the rest of the row is.
                            The number is there to be selected and copied (the user's
                            request, 2026-10-22), and a click here opened the receipt
                            instead, so it never could be. */}
                        <td className='dl-strong voucher-no-copy' style={{ cursor: 'text', userSelect: 'text' }}
                          title='Select to copy - click elsewhere on the row to open it'
                          onClick={(e) => e.stopPropagation()}>{x.voucherNo}</td>
                        <td className='dl-muted'>{moment(x.data).format('DD MMM YYYY')}</td>
                        <td>
                          <span className={`dl-badge${kind ? ` tone-${kind.tone}` : ''}`} title={kind?.name}>{x.type}</span>
                          {returned && <span className='dl-badge tone-red pr-returned' title={`Cheque returned - ${returned}`}>Returned</span>}
                        </td>
                        <td><span className='dl-clip' title={x.name}>{x.name}</span></td>
                        <td>{x.party ? <span className='dl-badge'>{String(x.party).replace(/\b\w/g, (c) => c.toUpperCase())}</span> : null}</td>
                        <td className='dl-muted'>{x.x?.chequeNo || ''}</td>
                        <td>{x.currency}</td>
                        <td className='dl-num dl-strong'>{commas(x.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {state.oldVouchers.length > 0 && (
            <div className='dl-footer'>
              <span>Showing {(page - 1) * PAGE_SIZE + 1}&ndash;{(page - 1) * PAGE_SIZE + state.oldVouchers.length} of {total.toLocaleString()}</span>
              {totalPages > 1 && <Pagination noOfPages={totalPages} currentPage={page} setCurrentPage={fetchOldVouchers} />}
            </div>
          )}
        </div>
      )}
      {chosen && <BillComp back={back} companyId={Cookies.get('companyId')} state={state} dispatch={dispatch} actionRef={makeTransactionRef} />}
    </div>
  )
}

export default React.memo(PaymentsReceipt)
