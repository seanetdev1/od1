import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactToPrint from 'react-to-print';
import moment from "moment";
import axiosClient from 'apis/axiosClient';
import openNotification from '../Shared/Notification';
import FullScreenLoader from './FullScreenLoader';
import InvoicePrint from './InvoicePrint';
import { isSaleTaxLine, gstNoField } from 'functions/saleTaxInvoice';
import { Checkbox, Popover, Input, Radio, Select, Modal, DatePicker, Spin } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import Router from 'next/router';
import InvoiceEditor from './InvoiceEditor';
import PartySearch from '../Layouts/JobsLayout/Jobs/ChargesComp/PartySearch';
import Cookies, { set } from 'js-cookie';
import { DeleteOutlined, PrinterOutlined, RightOutlined, MailOutlined, FileWordOutlined, LoadingOutlined } from '@ant-design/icons';
import { useMyPermissions } from 'functions/myPermissions';
import { jobDocRights } from 'functions/jobDocRights';
import { calculateTotal, computeRoundOff, roundOffFor, hasRoundOff, isRoundable, localTotal, roundOffLine } from './invoicePrintDefaults';
import { companyBankAccounts, formatBankAccount, bankAccountFields, getCompany, companyOptions, defaultBankAccount } from 'functions/companyBranding';
import SendInvoiceEmailModal from './SendInvoiceEmailModal';
import { confirmDelete } from './PopConfirm';
import { usePageActions } from 'Components/Shared/PageActions';
import { hasNote } from 'functions/invoiceNote';
import { downloadInvoiceExcel } from 'functions/invoiceExcel';
import { usePrintingTemplate, usePreparedTemplatePdf, downloadTemplateWord, SALES_TAX_INVOICE } from 'functions/templatePrint';
import AuditStamp from 'Components/Shared/AuditStamp';
import { personOf } from 'functions/auditStamp';
import { isSettled } from 'functions/invoiceBulkApproval';
import { useDocuments, PaperclipCount } from 'Components/Shared/Documents';
import { invoiceMoney, jobLink, chargeColumns, isForeign, grouped, settlementRows } from 'functions/invoiceDetails';

const { TextArea } = Input;

// The currencies an invoice can be changed to.
const CURRENCIES = ['PKR', 'USD', 'EUR', 'CHF', 'GBP', 'OMR', 'AED', 'BDT'];
// Who it is against, as the page shows it: 'client' -> 'Client'.
const titleCase = (v) => String(v || '').replace(/\b\w/g, (c) => c.toUpperCase());

// `ownsPage` says this is the invoice's OWN page rather than a modal on the
// Invoice/Bills list or a tab inside a job. Only there do the invoice's actions
// belong in the app's toolbar: claiming it from inside a job would put the
// invoice's Delete where the job's Save belongs. See Components/Shared/
// PageActions, and the null it is handed everywhere else.
//
// `onDeleted` is how the HOST reacts to the invoice being deleted, because
// what should happen depends entirely on where this is being shown. On its own
// page the tab has nothing left to display and should close; inside a job's
// Charges tab the screen goes back to the charge list; on the Invoice / Bills
// list the selection is simply cleared. Only the standalone page passes one.
const InvoiceCharges = ({data, state, dispatch, companyId, reload, onDeleted, ownsPage}) => {

  const commas = (a) => parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  let inputRef = useRef(null);
  const dispatchNew = useDispatch();
  const queryClient = useQueryClient();
  // Whose letterhead the print carries. null means "the invoice's own
  // company" - the one it was raised in - and only without one the company
  // the page is in; Printing Options sets it when the user picks another.
  // It was the page's company first, so an invoice opened while the header
  // was on the other company printed that company's name, address and bank
  // account. The bulk print already went by the invoice's (invoicePrintList).
  //
  // Held as an override rather than seeded with companyId so it cannot go
  // stale when the header's company changes, and so it never starts on a
  // hardcoded id that may not exist on this install.
  const [compLogo, setCompLogo] = useState(null);
  const letterheadId = compLogo ?? (data?.resultOne?.companyId || companyId);

  // The chosen BankAccount id. Was an index 1-4 into a hardcoded constant
  // holding our own Soneri / Bank Al Habib details, which shipped inside
  // every client's bundle. Now the company's own accounts from Config.
  //
  // Follows the letterhead, not the page: printing one company's letterhead
  // over another company's account number tells the customer to pay the wrong
  // entity. On a letterhead change `bank` no longer matches anything in the
  // new list, so selectedBankAccount (below `invoice`) falls back to that
  // company's default for this kind of document.
  const bankAccounts = companyBankAccounts(letterheadId);
  const [bank, setBank] = useState(null);
  const [invoiceData, setInvoiceData] = useState(false);
  const [records, setRecords] = useState([]);
  const [show, setShow] = useState(false);
  // The shape the render path assumes exists. Kept as a factory rather than a
  // single shared object so a reset can never hand back a mutated copy.
  const emptyInvoice = () => ({
    Charge_Heads:[],
    SE_Job:{
      Client:{},
      shipper:{},
      consignee:{},
      sales_representator:{},
      shipping_line:{},
      pol:'',
      pod:'',
      fd:'',
      customerRef: '',
      SE_Equipments:[]
    },
    note:''
  });

  const [invoice, setInvoice] = useState(emptyInvoice());
  // What this user may do with the invoice: approve, edit and delete are each a
  // right of their own (the user's request, 2026-10-20) - functions/jobDocRights.
  const rights = jobDocRights(useMyPermissions());
  // A bill carries the vendor's own tax invoice number, entered once it arrives.
  const isBill = invoice?.payType === 'Payble';
  // The one picked, else the company's client default (JI / JB) or agent
  // default (AI / AB) from Config > Bank Accounts, else its first account.
  const selectedBankAccount =
    bankAccounts.find((a) => String(a.id) === String(bank)) || defaultBankAccount(bankAccounts, invoice);
  const [load, setLoad] = useState(false);
  const [ref, setRef] = useState(false);
  // Customs: print the job's shipper in M/S instead of the invoiced party.
  const [shipperInMs, setShipperInMs] = useState(false);
  const [logo, setLogo] = useState(false);
  const [balance, setBalance] = useState(false);
  // Hide Note: ticked whenever the invoice has no note - see functions/invoiceNote.
  // Follows the note as it is typed or cleared; a click still overrides it.
  const [note, setNote] = useState(false);
  const noteWritten = hasNote(invoice);
  useEffect(() => { setNote(!noteWritten); }, [invoice?.id, noteWritten]);
  // Print as the Sale Tax Invoice (SaleTaxInvoicePrint): the taxed lines
  // only, under the invoice's GST number. Offered only when there is a taxed
  // line to print.
  const [vatInvoice, setVatInvoice] = useState(false);
  const hasSaleTax = (records || []).some(isSaleTaxLine);
  // Its GST invoice number (CL-24295) - see functions/saleTaxInvoice gstNoField.
  const gst = gstNoField(invoice, records);
  // A customs invoice carries its job (attachPrintContext on the server), and
  // the job its shipper - which "Shipper in M/S" prints.
  const isCustomsInvoice = Boolean(invoice?.customsJob);
  const hasShipper = Boolean(invoice?.customsJob?.shipper?.name);
  // Hide Tax Column is for the customs layout, which InvoicePrint gives a CC
  // or migrated LG invoice too - its own test, not isCustomsInvoice's.
  const customsLayout = isCustomsInvoice || invoice?.operation === 'CC' || invoice?.operation === 'LG';
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  // Print options move from a popover hung off the in-page button to a modal
  // opened by the toolbar, on the page that has a toolbar. Same options, same
  // Go button - only the thing they hang from changes, because a popover
  // cannot anchor to a button rendered in the layout above.
  const [printOpen, setPrintOpen] = useState(false);
  // The popover's own open state - see usePreparedTemplatePdf below.
  const [printPopoverOpen, setPrintPopoverOpen] = useState(false);

  useEffect(()=>{
    if(Object.keys(data).length>0){
      // `data` being non-empty does NOT mean it carries an invoice: the job
      // may not have one yet, or the lookup may have come back without a
      // result. Assigning a null resultOne straight into state was what threw
      // "Cannot read properties of null (reading 'currency')" when opening a
      // job - the render path below reads invoice.currency, invoice.payType,
      // invoice.ex_rate and so on without optional chaining, so a null here
      // takes the whole page down with a client-side exception.
      //
      // The original author already knew this value was unreliable - the very
      // next line guarded it with `?.` - so fall back to the empty shape the
      // render path expects instead of propagating null.
      if(!data.resultOne){
        setInvoice(emptyInvoice());
        setRecords([]);
        setInvoiceData(!invoiceData)
        return;
      }
      setInvoice(data.resultOne);
      setRecords(data.resultOne.Charge_Heads || []);
      setInvoiceData(!invoiceData)
    }
  }, [data])

  const cellClickListener = useCallback((e)=> {
    dispatchNew(incrementTab({"label": "Payment / Receipt","key": "3-4","id":e}))
    Router.push(`/accounts/paymentReceipt/${e}`)
  }, []);

  /* The settlements window's vouchers - fetched each time it opens, so a
     receipt made since shows. It opens at once, saying it is loading, and
     says so when the server cannot answer; it waited for the request with no
     sign of anything happening, and a failed one opened nothing at all. */
  const [settle, setSettle] = useState({ loading: false, error: null, rows: [] });
  const showSettlement = async (showing) => {
    setShow(showing);
    if (!showing) return;
    setSettle({ loading: true, error: null, rows: [] });
    try {
      const result = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/getAllInvoiceData`, {
        headers: { id: invoice.id, party_Id: invoice.party_Id, party_Type: invoice.partyType },
      });
      if (result?.data?.status && result.data.status !== 'success') throw new Error(result.data.result);
      setSettle({ loading: false, error: null, rows: settlementRows(result?.data?.result, invoice) });
    } catch (e) {
      setSettle({ loading: false, error: e?.response?.data?.result || e?.message || 'Could not load the settlements.', rows: [] });
    }
  };

  const getCurrencyInfoAdvanced = (id, heads) => {
    let tempHeads = heads.filter((x)=> x.InvoiceId==id)
    return tempHeads[0].ex_rate;
  };
  // Stores a round off on the invoice. `quiet` for the automatic one, which
  // the box shows on its own.
  const saveRoundOff = async (newRoundOff, quiet = false) => {
    try {
      const x = await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_ROUNDOFF_INVOICE, {
        id: invoice.id, total: invoice.total, roundOff: newRoundOff, approved: invoice.approved,
      });
      if (x.data.status !== 'success') throw new Error(x.data.result);
      setInvoice((inv) => ({ ...inv, roundOff: newRoundOff }));
      if (!quiet) {
        openNotification('Success', hasRoundOff(newRoundOff) ? 'Invoice rounded off.' : 'Round off taken off.', 'green');
      }
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not change the round off.', 'red');
    }
  };
  const roundOff = async() => {
    const newRoundOff = computeRoundOff(records, invoice?.roundOff);
    if (!hasRoundOff(newRoundOff) && !hasRoundOff(invoice?.roundOff)) {
      openNotification('Round Off', 'The total is a whole amount already - there is nothing to round off.', 'orange');
      return;
    }
    await saveRoundOff(newRoundOff);
  };

  /* ROUND OFF AUTOMATICALLY - Configuration > Invoices. On, every unapproved
     invoice in rupees is rounded here as it opens, so this page and its draft
     print show the rounded total; approval works it out again from the total
     it posts, either way (the server's functions/invoiceRoundOff). The box is
     then ticked and locked: turn the setting off to leave an invoice unrounded. */
  const [autoRoundOff, setAutoRoundOff] = useState(false);
  // Hide Sign Line and Hide Tax Column - ticked to begin with when
  // Configuration > Invoices says so.
  const [hideSign, setHideSign] = useState(false);
  const [hideTax, setHideTax] = useState(false);
  // The Printed On / Printed By line at the foot of the page (the user, 2026-11-02).
  const [hidePrinted, setHidePrinted] = useState(false);
  // The Bank Details box - ticked to begin with when Configuration > Invoices
  // says so (Essani, 2026-11-14).
  const [hideBank, setHideBank] = useState(false);
  /* THE INVOICE'S WORD TEMPLATE - Configuration > Printing Templates. The
     letterhead's company's, for this kind of document; none, the built-in
     layout. The Sales Tax Invoice (VAT Tax Invoice) from one saved for it,
     else its own built-in layout. */
  const invoiceTemplate = usePrintingTemplate(letterheadId, invoice?.type);
  const saleTaxTemplate = usePrintingTemplate(letterheadId, hasSaleTax ? SALES_TAX_INVOICE : null);
  const asSaleTax = vatInvoice && hasSaleTax;
  const printTemplate = asSaleTax ? saleTaxTemplate : invoiceTemplate;
  const usesTemplate = Boolean(printTemplate);
  const templateArgs = () => ({
    invoice,
    records,
    company: getCompany(letterheadId),
    bankAccount: selectedBankAccount,
    options: {
      hideRef: ref, hideLogo: logo, hideBalance: balance, hideNote: note,
      hideSignLine: hideSign, shipperInMs: shipperInMs && hasShipper, hideTax,
      hidePrintedBy: hidePrinted, hideBankDetails: hideBank,
    },
    salesTaxInvoice: asSaleTax,
  });
  // Its PDF, made while Printing Options is open, so Print opens it ready.
  const templatePdf = usePreparedTemplatePdf(printTemplate, templateArgs(), printOpen || printPopoverOpen);
  const preparing = templatePdf.status === 'preparing';
  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/invoicePrint')
      .then(({ data }) => {
        if (!alive) return;
        setHideSign(Boolean(data?.result?.hideSignLine));
        setHideTax(Boolean(data?.result?.hideTax));
        setHideBank(Boolean(data?.result?.hideBankDetails));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    axiosClient.get('/settings/invoiceRoundOff')
      .then(({ data }) => { if (alive) setAutoRoundOff(Boolean(data?.result?.auto)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const roundable = isRoundable(invoice);
  const autoRounding = Boolean(autoRoundOff && roundable && invoice?.id && String(invoice?.approved) !== '1');
  const chargesTotal = calculateTotal(records);
  useEffect(() => {
    // Saved only by someone who may edit the invoice; approval works the
    // round off out again from the final total in any case.
    if (!autoRounding || !rights.editInvoices || !(records || []).length) return;
    const target = roundOffFor(chargesTotal);
    if (target !== invoice?.roundOff && (hasRoundOff(target) || hasRoundOff(invoice?.roundOff))) {
      saveRoundOff(target, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRounding, invoice?.id, chargesTotal]);
  const approvingRoundOff = async(tempIvoice) => {
    let tempInv = {...tempIvoice};
    const newRoundOff = computeRoundOff(records, tempIvoice?.roundOff);
    if(newRoundOff !== tempIvoice?.roundOff){
      tempInv.roundOff = newRoundOff;
      axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_ROUNDOFF_INVOICE, {
        id:tempInv.id,
        total:tempInv.total,
        roundOff:tempInv.roundOff,
        approved:tempInv.approved
      })
    }
    return tempInv
  };

  
  /* Approving RECOMPUTES the header from the charges - total, and which side
   * the document falls on - because unapproving exists precisely so a rate can
   * be corrected and the invoice approved again. Patching only `approved` into
   * local state left the header showing the figure from BEFORE the correction:
   * the charge table below reads each line's own local_amount and updated,
   * while "Total Amount" above kept the pre-edit total, so one screen showed
   * two different answers for the same invoice.
   *
   * Both endpoints now return the stored row; it is taken verbatim rather than
   * merged field by field, so the screen cannot end up holding a mixture of
   * before and after. */
  const approve = async() => {
    setLoad(true);
    const url = invoice.approved=="0" ? 'approve' : 'unApprove';
    try{
      const x = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/${url}`,{
        id:data.resultOne.id,
        fiscalYearId: Cookies.get('fiscalYearId'),
        employeeId: Cookies.get('loginId'),
      })
      if(x.data.status!=='success'){
        openNotification('Error', x.data.result || 'Something went wrong', 'red')
        return
      }
      // The row as the server now holds it. Falls back to patching the flag
      // alone if an older backend sends nothing back, so the toggle still
      // works rather than appearing to do nothing.
      setInvoice(x.data.invoice
        ? {...invoice, ...x.data.invoice}
        : {...invoice, approved: invoice.approved=="0" ? "1" : "0"})
      await queryClient.removeQueries({ queryKey: ['charges'] })
    }finally{
      setLoad(false);
    }
  };
  const checkApprovability = (x) => {
    // Approving and unapproving are separate rights (2026-10-24): an operator
    // may post an invoice to the ledger and not take it back out of it.
    if(String(x?.approved) !== '0' ? !rights.unapproveInvoices : !rights.approveInvoices){
      return true
    }
    // Settled - received / paid against it - it stays as it is (the server
    // refuses too). Read as a NUMBER: a receipt edit writes the amount rounded,
    // so an invoice taken off its receipt holds "0.00", and compared as text
    // with "0" it stayed locked though nothing was settled (2026-11-10).
    return isSettled(x);
  };
  /* THE INVOICE AS AN EXCEL SHEET, in Climax's layout (functions/invoiceExcel)
     and with the print's own options - letterhead, bank account, Hide Logo /
     Ref / Balance / Note, Shipper in M/S - so the sheet is the print. */
  const exportExcel = () => {
    downloadInvoiceExcel({
      invoice,
      records,
      company: getCompany(letterheadId),
      bankAccount: selectedBankAccount,
      options: {
        hideLogo: logo, hideRef: ref, hideBalance: balance, hideNote: note,
        shipperInMs: shipperInMs && hasShipper, hideTax, hideBankDetails: hideBank,
      },
    }).catch((e) => {
      console.error(e);
      openNotification('Error', 'Could not export the invoice to Excel.', 'red');
    });
  };
  const PrintOptions = (
    <div>
      <Checkbox onChange={()=>setRef(!ref)} checked={ref} className='mb-2'>Hide Ref & Sales Rep</Checkbox><br/>
      <Checkbox onChange={()=>setLogo(!logo)} checked={logo} className='mb-2'>Hide Logo</Checkbox><br/>
      <Checkbox onChange={()=>setBalance(!balance)} checked={balance} className='mb-2'>Hide Balance</Checkbox><br/>
      <Checkbox onChange={()=>setNote(!note)} checked={note} className='mb-2'>Hide Note</Checkbox><br/>
      <Checkbox onChange={()=>setHideSign(!hideSign)} checked={hideSign} className='mb-2'>Hide Sign Line</Checkbox><br/>
      <Checkbox onChange={()=>setHidePrinted(!hidePrinted)} checked={hidePrinted} className='mb-2'>Hide Printed On / By</Checkbox><br/>
      <Checkbox onChange={()=>setHideBank(!hideBank)} checked={hideBank} className='mb-2'>Hide Bank Details</Checkbox><br/>
      {isCustomsInvoice && <><Checkbox onChange={()=>setShipperInMs(!shipperInMs)} checked={shipperInMs && hasShipper} disabled={!hasShipper}
        title={hasShipper ? "Print the job's shipper in M/S instead of the invoiced party" : 'No shipper on this job'}
        className='mb-2'>Shipper in M/S</Checkbox><br/></>}
      {customsLayout && <><Checkbox onChange={()=>setHideTax(!hideTax)} checked={hideTax}
        title='No Tax column; the service charges before tax, then Sales Tax, Total Without Tax and Total With Tax'
        className='mb-2'>Hide Tax Column</Checkbox><br/></>}
      <Checkbox onChange={()=>setVatInvoice(!vatInvoice)} checked={vatInvoice && hasSaleTax} disabled={!hasSaleTax}
        title={hasSaleTax ? 'Print the Sales Tax Invoice - the taxed charges only' : 'No charge on this invoice has Tax ticked'}
        className='mb-2'>VAT Tax Invoice</Checkbox><br/>
      Logo: {" "}
      <Radio.Group optionType="button" buttonStyle="solid" value={String(letterheadId ?? '')}
        // Was a fixed [SNS, ACS] pair, so another installation saw two
        // companies it does not have and could not pick its own.
        options={companyOptions().map((o) => ({ label: o.label, value: String(o.value) }))}
        onChange={(e)=>setCompLogo(e.target.value)}
      />
      <br/>
      <div className='mt-3'></div>
      {usesTemplate ? <>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>From the Word template {printTemplate.fileName}</div>
        <div className='div-btn-custom text-center p-2' style={{cursor:'pointer'}} onClick={templatePdf.print}>
          {preparing ? <><LoadingOutlined /> Preparing…</> : 'Go'}
        </div>
        <div className='div-btn-custom text-center p-2 mt-2' style={{cursor:'pointer'}} onClick={() => downloadTemplateWord(printTemplate, templateArgs())}>Word File</div>
      </> :
      <ReactToPrint content={()=>inputRef} trigger={()=><div className='div-btn-custom text-center p-2'>Go</div>} />}
      <div className='div-btn-custom text-center p-2 mt-2' style={{cursor:'pointer'}} onClick={exportExcel}>Export to Excel</div>
    </div>
  );
  const updateNote = async() => {
    await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_INVOICE_NOTE_UPDATE,{
      // The note only - the currency saves on its own (changeCurrency).
      id:invoice.id, note:invoice.note,
      ...(isBill ? { vendorTaxInvoiceNo: invoice?.vendorTaxInvoiceNo ?? '' } : {}),
    }).then((x)=>{
      if(x.data.status=="success"){
        openNotification("Success", "Note Saved!", "green")
      }
    })
  };

  /* THE INVOICE'S DATE - and its SI / PI voucher's, which always stands on it
     in the ledger. Saved as soon as it is confirmed; the server keeps it inside
     the invoice's fiscal year. See /invoice/changeDate. */
  const changeDate = (picked) => {
    if (!picked || !invoice?.id) return;
    const date = picked.format('YYYY-MM-DD');
    if (moment(invoice.createdAt).format('YYYY-MM-DD') === date) return;
    Modal.confirm({
      title: `Date ${invoice.invoice_No} ${picked.format('DD MMM YYYY')}?`,
      content: String(invoice.approved) === '1'
        ? 'Its voucher moves to this date in the ledger too.'
        : 'It has no voucher yet - approving it will post on this date.',
      okText: 'Change date',
      onOk: async () => {
        const res = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/changeDate`, {
          id: invoice.id, date, employeeId: Cookies.get('loginId'),
        }).catch((e) => e.response);
        if (res?.data?.status !== 'success') {
          openNotification('Error', res?.data?.result || 'Could not change the date.', 'red');
          return;
        }
        setInvoice((current) => ({ ...current, createdAt: res.data.invoice.createdAt }));
        openNotification('Success', res.data.vouchersMoved ? 'Date changed - its voucher moved with it.' : 'Date changed.', 'green');
      },
    });
  };

  const deleteInvoice = async () => {
    axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/deleteInvoice`,
      {
        headers: {id: invoice.id}
      }
    ).then((x)=>{
      if(x.data.status!="success"){
        openNotification("Error", x.data.result || "Could not delete this invoice.", "red")
        return
      }
      openNotification("Success", "Invoice Deleted!", "green")
      if(state){
        dispatch({type:'set', payload:{tabState:"4"}})
        dispatch({type:'set', payload:{selectedInvoice:""}})
        queryClient.removeQueries({ queryKey: ['charges'] })
      }
      // Nothing left to look at. The host decides what that means - see the
      // prop. Called only on success: a failed delete must leave the invoice,
      // and its tab, exactly where they were.
      onDeleted?.()
    })
    
  }


  const routeToPayRec = () => {
    console.log("Invoice>>",invoice)
    dispatchNew(incrementTab({
      "label": "Payment / Receipt",
      "key": "3-4",
      "id":`new?partyId=${invoice.party_Id}&partyType=${invoice.partyType}&payType=${invoice.payType}`
    }))
    Router.push({
      pathname:"/accounts/paymentReceipt/new", 
      query:{
        partyId: invoice.party_Id,
        partyType: invoice.partyType,
        payType: invoice.payType,
      }}, 
      undefined,
      {shallow:true}
    );
  };

  /* THE INVOICE'S ACTIONS, but only where this IS the page - see ownsPage.
   *
   * Delete refuses an approved invoice, which was already true of the button
   * this replaces; the toolbar now says WHY rather than merely greying out.
   * Email and Payment/Receipt are this screen's own verbs, so they ride in
   * extras after the five standard slots. */
  // The invoice's documents - its own, and its job's of a type marked for
  // invoices (the user's request, 2026-11-13). In the toolbar on its own
  // page; beside the print and email buttons everywhere else.
  const docs = useDocuments({
    entity: 'Invoice', recordId: invoice?.id, title: `Documents - Invoice ${invoice?.invoice_No || ''}`,
  });

  usePageActions(ownsPage ? {
    title: invoice?.invoice_No ? `Invoice ${invoice.invoice_No}` : 'Invoice',
    subtitle: invoice?.party_Name || undefined,
    print: {
      onClick: () => setPrintOpen(true),
      title: 'Printing options, then print',
    },
    excel: {
      onClick: exportExcel,
      title: 'Export this invoice to Excel, with the Printing Options set',
    },
    delete: {
      onClick: deleteInvoice,
      disabled: invoice?.approved != '0' || !rights.deleteInvoices,
      confirm: `Delete invoice ${invoice?.invoice_No || ''}? This cannot be undone.`,
      title: !rights.deleteInvoices
        ? 'Deleting invoices needs the right to delete job invoices'
        : invoice?.approved != '0'
          ? 'An approved invoice cannot be deleted - unapprove it first'
          : 'Delete this invoice',
    },
    extras: [
      docs.extra,
      {
        key: 'email',
        label: 'Email this invoice',
        Icon: MailOutlined,
        onClick: () => setEmailModalOpen(true),
      },
      {
        key: 'payrec',
        label: 'Go to Payment / Receipt',
        Icon: RightOutlined,
        onClick: routeToPayRec,
      },
    ],
  } : null, [ownsPage, invoice?.invoice_No, invoice?.party_Name, invoice?.approved, docs.count, docs.saved]);
  /* NOT deleteInvoice / routeToPayRec in the deps.
   *
   * Both are rebuilt on every render, so listing them re-ran this effect every
   * render - which is what produced "Maximum update depth exceeded" on this
   * screen. The provider no longer loops when that happens, and resolves the
   * handler at click time so the button is never stale either; but a dependency
   * that is new every render still says "I changed" when nothing did, so it
   * does not belong here. What this effect actually depends on is what the
   * toolbar SHOWS. */

  /* THE CURRENCY - saved as soon as it is picked, the total rebuilt by the
     server from the charge lines as approval does (functions/invoiceCurrency
     there). It used to change only this screen: the total times or divided by
     the invoice's one rate, a USD invoice relabelled EUR unconverted, and
     nothing saved until the note was. Refused, it stays as it was. */
  const changeCurrency = async (invoice, currency) => {
    if (!invoice?.id || currency === invoice.currency) return;
    try {
      const { data } = await axiosClient.post('/invoice/changeCurrency', {
        id: invoice.id, currency, employeeId: Cookies.get('loginId'),
      });
      if (data?.status !== 'success') throw new Error(data?.result);
      setInvoice((inv) => ({ ...inv, currency: data.result.currency, total: data.result.total }));
      openNotification('Success', `Invoice now in ${data.result.currency}.`, 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not change the currency.', 'red');
    }
  }


  /* What the page shows, worked out once a render - functions/invoiceDetails. */
  const approvedNow = String(invoice?.approved) !== '0' && invoice?.approved !== undefined && invoice?.approved !== null;
  const foreign = isForeign(invoice);
  const money = (() => {
    const m = invoiceMoney(invoice);
    return { total: m.total, settled: m.settled, adjustment: m.adjustment, balance: m.balance };
  })();
  const job = jobLink(invoice);
  const openJob = async () => {
    if (!job?.href) return;
    await Router.push(job.href);
    dispatchNew(incrementTab(job.tab));
  };
  const columns = chargeColumns(records);
  const settleTotals = settle.rows.reduce((t, r) => ({
    amount: t.amount + r.amount, local: t.local + r.local, exchange: t.exchange + r.exchange,
  }), { amount: 0, local: 0, exchange: 0 });
  // What has been settled, in rupees at the invoice rate - for the window's figure.
  const settledLocal = (parseFloat(money.settled.value) || 0) * (parseFloat(invoice?.ex_rate) || 0);
  const roundLine = roundOffLine(invoice, (records?.length || 0) + 1);

return (
  <>
    {load && <FullScreenLoader/>}
    {docs.modal}
    <div className='invoice-styles'>
      {Object.keys(data).length>0 &&
      /* THE INVOICE, LAID OUT (2026-11-15 redesign: "details look scattered").
         Top to bottom: who and what it is, with its money beside it; the
         four things that are set on it; its charges; its note and the bank
         account it prints. It was fourteen label-and-value pairs in a grid
         of uneven columns, the totals under the fold of a scrolling box. */
      <div className='inv-page'>
        {/* On its own page these live in the toolbar above; here they are
            what a modal or a job's Invoice tab has instead, since neither of
            those owns the app's header. */}
        {!ownsPage && (
          <div className='inv-actions'>
            <Popover content={PrintOptions} placement="bottomLeft" title="Printing Options" onOpenChange={setPrintPopoverOpen}>
              <button type='button' className='dl-tool'><PrinterOutlined /> Print</button>
            </Popover>
            <button type='button' className='dl-tool' onClick={()=>setEmailModalOpen(true)}><MailOutlined /> Email</button>
            <button type='button' className='dl-tool'
              disabled={!docs.saved} aria-label={docs.label} title={docs.tip} onClick={docs.open}>
              <PaperclipCount count={docs.count} />
            </button>
            <button type='button' className='dl-tool inv-danger' disabled={invoice?.approved!="0" || !rights.deleteInvoices}
              title={!rights.deleteInvoices ? 'Deleting invoices needs the right to delete job invoices'
                : invoice?.approved!="0" ? 'An approved invoice cannot be deleted - unapprove it first' : 'Delete this invoice'}
              onClick={()=>confirmDelete({
                what: 'invoice',
                name: invoice?.invoice_No,
                body: 'This cannot be undone.',
                onOk: deleteInvoice,
              })}>
              <DeleteOutlined /> Delete
            </button>
            <span className='inv-spacer' />
            <button type='button' className='dl-tool' onClick={routeToPayRec}>Go to Payment / Receipt <RightOutlined /></button>
          </div>
        )}

        {/* WHO AND WHAT, and the money. */}
        <section className='inv-card inv-summary'>
          <div className='inv-summary-main'>
            <div className='inv-title-row'>
              <h2 className='inv-number'>{invoice?.invoice_No || '—'}</h2>
              {invoice?.type && <span className='dl-badge'>{invoice.type}</span>}
              <span className={`dl-badge ${approvedNow ? 'tone-green' : 'tone-amber'}`}
                title={approvedNow ? 'In the ledger' : 'Not in the ledger yet - prints with a DRAFT mark'}>
                {approvedNow ? 'Approved' : 'Unapproved'}
              </span>
              {gst && (
                <span className={`dl-badge gst-no${gst.pending ? '' : ' tone-blue'}`}
                  title={gst.pending ? 'The GST invoice number is given when the invoice is approved' : 'GST invoice number'}>
                  GST {gst.text}
                </span>
              )}
            </div>
            <div className='inv-party'>
              <span>{invoice?.party_Name || '—'}</span>
              {invoice?.partyType && <span className='inv-party-type'>{titleCase(invoice.partyType)}</span>}
            </div>
            <div className='inv-meta'>
              <span>{isBill ? 'Payable' : 'Receivable'}</span>
              {job && (
                <span>
                  Job{' '}
                  {job.href
                    ? <button type='button' className='inv-link' onClick={openJob} title={`Open job ${job.jobNo}`}>{job.jobNo}</button>
                    : <b>{job.jobNo}</b>}
                </span>
              )}
              {/* Who generated it - its own stamp, or for an invoice made before
                  those, the first History 'Create' (see the server) - and who
                  last changed it, with when (functions/auditStamp). */}
              <span>Created by <b>{personOf(invoice?.createdByName) || '-'}</b></span>
              <AuditStamp className='inv-audit' record={{ createdOn: invoice?.createdOn, editedBy: invoice?.editedBy, editedOn: invoice?.editedOn }} />
            </div>
          </div>
          {/* The money, as the print has it: the total with its round off,
              then received (paid) and the balance - functions/invoiceDetails. */}
          <div className='inv-money'>
            <div className='inv-money-label'>Total</div>
            <div className='inv-money-total'>
              <span className='inv-money-cur'>{invoice?.currency}</span> {commas(money.total)}
            </div>
            {foreign && (
              <div className='inv-money-local' title='In rupees, at the invoice rate'>
                PKR {commas(localTotal(invoice))} <span>@ {invoice?.ex_rate}</span>
              </div>
            )}
            <dl className='inv-money-lines'>
              <dt>{money.settled.label}</dt><dd>{commas(money.settled.value)}</dd>
              {money.adjustment.value !== 0 && <><dt>Adjustment</dt><dd>{commas(money.adjustment.value)}</dd></>}
              <dt>Balance</dt>
              <dd className={money.balance.value > 0.004 ? 'is-due' : 'is-clear'}>{commas(money.balance.value)}</dd>
            </dl>
            <button type='button' className='inv-link inv-settlements' onClick={() => showSettlement(true)}>
              View settlements
            </button>
          </div>
        </section>

        {/* WHAT IS SET ON IT - each a labelled box, as the header's are. */}
        <div className='inv-fields'>
          <div className='inv-field'>
            <span className='inv-field-label'>Date</span>
            <DatePicker size='small' bordered={false} format='DD MMM YYYY' allowClear={false} style={{ width: 118 }}
              value={invoice?.createdAt ? moment(invoice.createdAt) : null}
              disabled={!invoice?.id || !rights.editInvoices}
              onChange={changeDate}
            />
          </div>
          <div className='inv-field'>
            <span className='inv-field-label'>Currency</span>
            <Select
              size='small'
              bordered={false}
              value={invoice?.currency} onChange={(e)=>{
                changeCurrency(invoice, e)
              }}
              // Its voucher is posted in this currency - unapprove first.
              disabled={String(invoice?.approved) === '1' || !rights.editInvoices}
              title={String(invoice?.approved) === '1' ? 'Approved - unapprove the invoice to change its currency' : undefined}
              style={{ width: 76 }}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <label className='inv-field inv-field-check'
            title={!roundable ? 'Only an invoice in rupees is rounded off'
              : autoRounding ? 'Rounded off automatically - Configuration > Invoices'
              : invoice?.approved=="1" ? 'Unapprove the invoice to change its round off' : 'Round the total off to the rupee'}>
            <span className='inv-field-label'>Round off</span>
            <input className='cur' type={"checkbox"}
              disabled={!roundable || invoice?.approved=="1" || autoRounding || !rights.editInvoices}
              checked={autoRounding || hasRoundOff(invoice?.roundOff)}
              onChange={roundOff}
              aria-label='Round off'
            />
          </label>
          <label className={`inv-field inv-field-check${approvedNow ? ' is-on' : ''}`}
            title={invoice?.approved != '0' && !rights.unapproveInvoices
              ? 'Approved - only someone with the Unapprove right can take it out of the ledger'
              : invoice?.approved == '0' && !rights.approveInvoices
                ? 'Only someone with the Approve right can approve it'
                : approvedNow ? 'Untick to take it out of the ledger' : 'Tick to post it to the ledger'}>
            <span className='inv-field-label'>Approved</span>
            <input className='cur' type={"checkbox"} checked={invoice?.approved!="0"}
              disabled={checkApprovability(invoice)}
              onChange={approve}
              aria-label='Approved'
            />
          </label>
        </div>

        {/* THE CHARGES - the shared list table, without the columns no line
            fills (functions/invoiceDetails chargeColumns). */}
        <section className='inv-section'>
          <div className='inv-section-head'>
            <h3>Charges <span className='inv-count'>{records?.length || 0}</span></h3>
            {/* The charge editor stays on the page wherever it is shown: it
                opens onto these lines. */}
            <InvoiceEditor data={data} invoice={invoice} lines={records} reload={reload} canEdit={rights.editInvoices} />
          </div>
          <div className='inv-charges'>
            <table className='dl-table'>
              <thead>
                <tr>{columns.map((c) => <th key={c.index} className={c.num ? 'dl-num' : undefined}>{c.title}</th>)}</tr>
              </thead>
              <tbody>
                {(records || []).map((x, index) => (
                  <tr key={x.id ?? index}>
                    {columns.map((c) => (
                      <td key={c.index} className={[c.num ? 'dl-num' : '', c.className || ''].join(' ').trim() || undefined}>
                        {c.money ? commas(c.cell(x, index)) : c.cell(x, index)}
                      </td>
                    ))}
                  </tr>
                ))}
                {/* A cell for every column shown - see roundOffLine. */}
                {roundLine &&
                  <tr className='inv-roundoff'>
                    {columns.map((c) => <td key={c.index} className={c.num ? 'dl-num' : undefined}>{roundLine[c.index]}</td>)}
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={columns.length - 1} className='dl-num'>Total (PKR)</td>
                  {/* With its round off, as printed and posted - see localTotal. */}
                  <td className='dl-num'>{commas(localTotal(invoice).toFixed(2))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* ITS NOTE, AND THE BANK ACCOUNT IT PRINTS. */}
        <div className='inv-lower'>
          <section className='inv-card'>
            <h3>Note</h3>
            {isBill && <>
              <div className='inv-field-label inv-block-label'>Vendor Tax Inv #</div>
              <Input className='mb-3' value={invoice?.vendorTaxInvoiceNo || ''} placeholder="The vendor's tax invoice number"
                onChange={(e)=>setInvoice({...invoice, vendorTaxInvoiceNo:e.target.value})} />
            </>}
            <TextArea showCount rows={4} value={invoice?.note} placeholder='Printed on the invoice, under the charges'
              onChange={(e)=>setInvoice({...invoice, note:e.target.value})} />
            <div className='inv-card-actions'>
              <button className={rights.editInvoices ? 'btn-custom' : 'btn-custom-disabled'} disabled={!rights.editInvoices}
                title={rights.editInvoices ? undefined : 'Changing an invoice needs the right to edit job invoices'}
                onClick={updateNote} type='button'>Save note</button>
            </div>
          </section>
          <section className='inv-card'>
            <div className='inv-card-head'>
              <h3>Bank details</h3>
              {bankAccounts.length > 1 && (
                <Radio.Group className='dl-segmented' size='small' onChange={(e)=>setBank(e.target.value)} value={selectedBankAccount?.id}>
                  {bankAccounts.map((a) => (
                    <Radio.Button key={a.id} value={a.id}>{a.label || a.bankName || `Account ${a.id}`}</Radio.Button>
                  ))}
                </Radio.Group>
              )}
            </div>
            {/* Label/value rows rather than a pre-wrapped blob: the block
                was rendering at lineHeight 0.8, so the lines overlapped and
                the account number ran into the title above it. */}
            {selectedBankAccount ? (
              <dl className='inv-bank'>
                {bankAccountFields(selectedBankAccount).map(([label, value]) => (
                  <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>
                ))}
              </dl>
            ) : (
              <span className='inv-empty'>
                No bank accounts set up for this company yet — add them in Config &gt; Bank Accounts.
              </span>
            )}
          </section>
        </div>
      </div>
      }
      {/* Printing Component - off-screen, NOT display:none. The DRAFT layer
          on an unapproved invoice measures the print to cover its last page
          (Shared/DraftWatermark), and inside display:none there is nothing to
          measure. A4 wide, so it lays out at the width it prints at. */}
      <div
        aria-hidden='true'
        style={{ position: 'absolute', left: '-10000px', top: 0, width: '210mm' }}
      >
        <div ref={(response)=>(inputRef=response)}>
          {/* ONE LAYOUT FOR EVERY COMPANY. This chose a different one -
              CLPrint - for company id "2", which was CargoLinkers on the
              system this was first written for. On a migrated install the ids
              are the legacy ones: on SNS's, 2 is SNS itself, so every SNS user
              got CargoLinkers' layout and its company details. InvoicePrint
              takes the company from Configuration > Companies, so it is right
              for any of them. */}
          {invoice &&
            /* company/compLogo resolve from the Printing Options letterhead,
               not from the page's company. InvoicePrint reads `company` in
               preference to `compLogo`, so passing the page's company here was
               what made the letterhead picker do nothing at all. */
            <InvoicePrint
              logo={logo}
              compLogo={letterheadId}
              company={getCompany(letterheadId)}
              records={records} 
              bankAccount={selectedBankAccount} 
              invoice={invoice}
              note={note} 
              reference={ref}
              shipperInMs={shipperInMs && hasShipper}
              vatInvoice={vatInvoice && hasSaleTax}
              hideSignLine={hideSign}
              hidePrintedBy={hidePrinted}
              hideBalance={balance}
              hideTax={hideTax}
              hideBankDetails={hideBank}
              calculateTotal={calculateTotal} 
            />
          }
        </div>
      </div>
    </div>
    {show && (
      /* SETTLEMENTS (2026-11-15 redesign) - what settled this invoice, voucher
         by voucher: this invoice's share of each, dated, with the exchange
         difference on a foreign one, and the invoice's own totals above. */
      <Modal
        open={show}
        onCancel={() => setShow(false)}
        width={foreign ? 1000 : 840}
        footer={null}
        centered
        wrapClassName='settle-modal'
      >
        <div className='settle'>
          <div className='settle-head'>
            <div className='settle-kicker'>Settlements</div>
            <h3 className='settle-title'>{invoice.invoice_No}</h3>
            <div className='settle-sub'>
              {invoice.party_Name}
              <span className='settle-dot'>·</span>
              {isBill ? 'Payable' : 'Receivable'} in {invoice.currency}
            </div>
          </div>

          {/* The invoice's own figures, as its page and print have them. */}
          <div className='settle-stats'>
            <div className='settle-stat'>
              <span>Total</span>
              <b>{invoice.currency} {commas(money.total)}</b>
            </div>
            <div className='settle-stat'>
              <span>{money.settled.label}</span>
              <b>{commas(money.settled.value)}</b>
              {foreign && <small>PKR {commas(settledLocal)}</small>}
            </div>
            {money.adjustment.value !== 0 && (
              <div className='settle-stat'>
                <span>Adjustment</span>
                <b>{commas(money.adjustment.value)}</b>
              </div>
            )}
            <div className={`settle-stat ${money.balance.value > 0.004 ? 'is-due' : 'is-clear'}`}>
              <span>Balance</span>
              <b>{commas(money.balance.value)}</b>
            </div>
          </div>

          {settle.loading ? (
            <div className='settle-empty'><Spin size='small' /> Loading the vouchers…</div>
          ) : settle.error ? (
            <div className='settle-empty is-error'>{settle.error}</div>
          ) : settle.rows.length === 0 ? (
            <div className='settle-empty'>Nothing {isBill ? 'paid against this bill' : 'received against this invoice'} yet.</div>
          ) : (
            <div className='settle-table'>
              <table className='dl-table'>
                <thead>
                  <tr>
                    <th>Voucher</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th className='dl-num'>Amount ({invoice.currency})</th>
                    {foreign && <>
                      <th className='dl-num'>Rate</th>
                      <th className='dl-num'>Amount (PKR)</th>
                      <th className='dl-num' title='Against the invoice rate - a gain is positive'>Exchange</th>
                    </>}
                    <th>Narration</th>
                  </tr>
                </thead>
                <tbody>
                  {settle.rows.map((r, i) => (
                    <tr key={`${r.id}-${i}`} className='dl-click' title='Open this voucher'
                      onClick={() => { setShow(false); cellClickListener(r.id); }}>
                      <td className='settle-voucher'>{r.voucherNo}</td>
                      <td>{r.type ? <span className='dl-badge'>{r.type}</span> : null}</td>
                      <td>{r.date ? moment(r.date).format('DD MMM YYYY') : '-'}</td>
                      <td className='dl-num dl-strong'>{commas(r.amount)}</td>
                      {foreign && <>
                        <td className='dl-num dl-muted'>{grouped(r.rate)}</td>
                        <td className='dl-num'>{commas(r.local)}</td>
                        <td className={`dl-num ${r.exchange > 0 ? 'settle-gain' : r.exchange < 0 ? 'settle-loss' : 'dl-muted'}`}>
                          {r.exchange > 0 ? '+' : ''}{commas(r.exchange)}
                        </td>
                      </>}
                      <td><span className='dl-clip settle-narration' title={r.narration}>{r.narration}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>{settle.rows.length} voucher{settle.rows.length === 1 ? '' : 's'}</td>
                    <td className='dl-num'>{commas(settleTotals.amount)}</td>
                    {foreign && <>
                      <td />
                      <td className='dl-num'>{commas(settleTotals.local)}</td>
                      <td className={`dl-num ${settleTotals.exchange > 0 ? 'settle-gain' : settleTotals.exchange < 0 ? 'settle-loss' : ''}`}>
                        {settleTotals.exchange > 0 ? '+' : ''}{commas(settleTotals.exchange)}
                      </td>
                    </>}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className='settle-foot'>
            <span className='settle-hint'>{settle.rows.length ? 'Click a voucher to open it.' : ''}</span>
            <button type='button' className='dl-tool' onClick={() => setShow(false)}>Close</button>
          </div>
        </div>
      </Modal>
    )}
      {/* Same options, same ReactToPrint Go button as the popover - a modal
          only because a popover has nothing to hang from once its button
          moved into the layout's header. */}
      <Modal
        title='Printing Options'
        open={printOpen}
        onCancel={() => setPrintOpen(false)}
        footer={null}
        width={400}
      >
        {/* NOT the popover's markup reused.
            That layout was built for a narrow popover hanging off a button:
            checkboxes separated by <br/>, and the logo as a solid radio group
            that becomes a full-width blue banner the moment an install has one
            company - which is most of them. In a dialog it needs dialog
            spacing, a Select for a single-choice field, and the action in the
            bottom-right where a dialog's action belongs. */}
        <div className='print-options'>
          <div className='po-checks'>
            <Checkbox onChange={()=>setRef(!ref)} checked={ref}>Hide Ref &amp; Sales Rep</Checkbox>
            <Checkbox onChange={()=>setLogo(!logo)} checked={logo}>Hide Logo</Checkbox>
            <Checkbox onChange={()=>setBalance(!balance)} checked={balance}>Hide Balance</Checkbox>
            <Checkbox onChange={()=>setNote(!note)} checked={note}>Hide Note</Checkbox>
            <Checkbox onChange={()=>setHideSign(!hideSign)} checked={hideSign}>Hide Sign Line</Checkbox>
            <Checkbox onChange={()=>setHidePrinted(!hidePrinted)} checked={hidePrinted}>Hide Printed On / By</Checkbox>
            <Checkbox onChange={()=>setHideBank(!hideBank)} checked={hideBank}>Hide Bank Details</Checkbox>
            {isCustomsInvoice && <Checkbox onChange={()=>setShipperInMs(!shipperInMs)} checked={shipperInMs && hasShipper} disabled={!hasShipper}
              title={hasShipper ? "Print the job's shipper in M/S instead of the invoiced party" : 'No shipper on this job'}>
              Shipper in M/S
            </Checkbox>}
            {customsLayout && <Checkbox onChange={()=>setHideTax(!hideTax)} checked={hideTax}
              title='No Tax column; the service charges before tax, then Sales Tax, Total Without Tax and Total With Tax'>
              Hide Tax Column
            </Checkbox>}
            <Checkbox onChange={()=>setVatInvoice(!vatInvoice)} checked={vatInvoice && hasSaleTax} disabled={!hasSaleTax}
              title={hasSaleTax ? 'Print the Sales Tax Invoice - the taxed charges only' : 'No charge on this invoice has Tax ticked'}>
              VAT Tax Invoice
            </Checkbox>
          </div>

          <div className='po-field'>
            <div className='po-label'>Letterhead</div>
            <Select
              style={{ width: '100%' }}
              value={String(letterheadId ?? '')}
              onChange={(v) => setCompLogo(v)}
              options={companyOptions().map((o) => ({ label: o.label, value: String(o.value) }))}
            />
          </div>

          {/* The Word template it prints from (Configuration > Printing
              Templates), with what else it can do: the filled Word file, or
              the built-in layout instead. Links here rather than buttons
              below, so the dialog's actions are the same three either way. */}
          {usesTemplate &&
            <div className='po-template'>
              <div className='po-label'>Word template</div>
              <div className='po-template-file' title={printTemplate.fileName}>
                <FileWordOutlined className='po-template-icon' />
                <span>{printTemplate.fileName}</span>
              </div>
              <div className='po-template-links'>
                <button type='button' className='po-link' onClick={() => downloadTemplateWord(printTemplate, templateArgs())}>
                  Download as Word
                </button>
                <span className='po-dot'>·</span>
                <ReactToPrint content={() => inputRef}
                  trigger={() => <button type='button' className='po-link'>Print the built-in layout</button>} />
              </div>
            </div>}

          <div className='po-actions'>
            <button type='button' className='po-cancel' onClick={() => setPrintOpen(false)}>
              Cancel
            </button>
            <button type='button' className='btn-custom-green px-3' onClick={exportExcel}>
              Export to Excel
            </button>
            {/* Go was the popover's word for it. In a dialog headed Printing
                Options the button says what it does. */}
            {usesTemplate
              ? <button type='button' className='btn-custom px-4' onClick={templatePdf.print} aria-busy={preparing}>
                  {preparing ? <><LoadingOutlined /> Preparing…</> : 'Print'}
                </button>
              : <ReactToPrint
                  content={() => inputRef}
                  trigger={() => <button type='button' className='btn-custom px-4'>Print</button>}
                />}
          </div>
        </div>

        <style jsx global>{`
          /* A Modal is a portal on document.body, so these cannot be scoped
             under the invoice's own class. */
          .print-options .po-checks {
            display: flex; flex-direction: column; gap: 10px;
            padding-bottom: 14px; margin-bottom: 14px;
            border-bottom: 1px solid #f0f2f5;
          }
          /* antd indents every checkbox after the first, for a row of them;
             stacked, that set the first one out on its own. */
          .print-options .po-checks .ant-checkbox-wrapper { margin-left: 0; margin-inline-start: 0; }
          .print-options .po-label {
            font-size: 11px; color: #8a97a3; text-transform: uppercase;
            letter-spacing: 0.03em; margin-bottom: 4px;
          }
          .print-options .po-actions {
            display: flex; justify-content: flex-end; align-items: center; gap: 8px;
            margin-top: 20px;
          }
          .print-options .po-actions button { white-space: nowrap; }
          .print-options .po-template {
            margin-top: 14px; padding: 10px 12px;
            background: #f7f9fb; border: 1px solid #e6eaef; border-radius: 6px;
          }
          .print-options .po-template .po-label { margin-bottom: 6px; }
          .print-options .po-template-file {
            display: flex; align-items: center; gap: 8px;
            font-size: 13px; font-weight: 600; color: #1f2937;
          }
          .print-options .po-template-file span {
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          }
          .print-options .po-template-icon { color: #2b579a; font-size: 16px; flex: none; }
          .print-options .po-template-links {
            display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
            margin-top: 8px; padding-left: 24px;
          }
          .print-options .po-dot { color: #b0b8c1; }
          .print-options .po-link {
            background: none; border: 0; padding: 0; color: #1677ff; cursor: pointer;
            font-size: 12px;
          }
          .print-options .po-link:hover { text-decoration: underline; }
          .print-options .po-cancel {
            background: none; border: 0; color: #6b7684; font-size: 13px;
            padding: 5px 10px; cursor: pointer;
          }
          .print-options .po-cancel:hover { color: #1f2937; }
        `}</style>
      </Modal>

      <SendInvoiceEmailModal
        open={emailModalOpen}
        onClose={()=>setEmailModalOpen(false)}
        invoice={invoice}
      />
  </>
)}

export default React.memo(InvoiceCharges)
