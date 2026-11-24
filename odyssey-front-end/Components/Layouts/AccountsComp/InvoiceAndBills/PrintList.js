import React, { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { PrinterOutlined } from '@ant-design/icons';
import { Modal, Checkbox, Select } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import InvoicePrint from 'Components/Shared/InvoicePrint';
import { calculateTotal } from 'Components/Shared/invoicePrintDefaults';
import { getCompany, companyBankAccounts, defaultBankAccount, companyOptions } from 'functions/companyBranding';
import {
  fetchInChunks, removeFromPrintList, saleTaxDocuments, BULK_PRINT_OPTIONS, bulkPrintSettings,
} from 'functions/invoicePrintList';
import { isSaleTaxLine } from 'functions/saleTaxInvoice';
import { isCustomsMode } from 'functions/terminology';
import { templatesFor, renderManyPdf, SALES_TAX_INVOICE } from 'functions/templatePrint';

const money = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : (v ?? '');
};

// The same request the invoice page makes, so each prints from the same data.
const fetchInvoice = async (entry) => {
  const { data } = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_INVOICE_BY_ID, {
    headers: { invoiceid: `${entry.id}` },
  });
  return data?.result?.resultOne || null;
};

/**
 * The bulk print list on Invoice / Bills - see functions/invoicePrintList.
 *
 * Print all opens Printing Options - the invoice page's, for the whole list -
 * and its Print fetches every invoice on the list and prints them as ONE job,
 * each starting on a new page and laid out exactly as it prints on its own:
 * the same InvoicePrint, its own company's letterhead unless another is
 * picked, that company's client or agent default bank account, and DRAFT
 * across any not yet approved.
 *
 * VAT Tax Invoice prints the list as Sales Tax Invoices instead
 * (SaleTaxInvoicePrint, as on the invoice page) - the invoices with a taxed
 * charge; the rest are skipped and named.
 *
 * An invoice with a Word template (Configuration > Printing Templates) prints
 * from it, as on its own page: those come back from the server as ONE PDF,
 * shown here to print or save. Any on the list without one print as above,
 * from the same window - two documents, so the list's order holds within each.
 */
/* ON THE INVOICES / BILLS PAGE ITS PRINT IS THE TOOLBAR'S (PageActions):
 * the page passes `printFromToolbar` and a ref, and the toolbar's Print calls
 * `open()` - the same Printing Options this panel's own button opens when it
 * is shown anywhere else. */
const PrintList = React.forwardRef(({ list, setList, companyId, printFromToolbar = false }, ref) => {
  const printRef = useRef(null);
  // The fetched invoices, held only while a print is being made.
  const [docs, setDocs] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The templated ones' PDF: { url, count, builtIn } - builtIn, the invoices
  // on the list that have no template, still to print.
  const [templatePdf, setTemplatePdf] = useState(null);
  const pdfUrl = useRef(null);
  const closePdf = () => {
    if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current);
    pdfUrl.current = null;
    setTemplatePdf(null);
  };
  useEffect(() => () => { if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current); }, []);
  // Kept for the visit, so a second print starts from the first one's choices.
  const [options, setOptions] = useState(BULK_PRINT_OPTIONS);
  const toggle = (key) => () => setOptions((o) => ({ ...o, [key]: !o[key] }));
  // Hide Sign Line, Hide Tax Column and Hide Bank Details start as
  // Configuration > Invoices says.
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => axiosClient.get('/settings/invoicePrint'))
      .then(({ data }) => {
        if (alive) {
          setOptions((o) => ({
            ...o, hideSignLine: Boolean(data?.result?.hideSignLine), hideTax: Boolean(data?.result?.hideTax),
            hideBankDetails: Boolean(data?.result?.hideBankDetails),
          }));
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const title = options.vatInvoice ? 'Sales Tax Invoices' : 'Invoices';
  const handlePrint = useReactToPrint({
    content: () => printRef.current,
    documentTitle: title,
    onAfterPrint: () => setDocs(null),
  });

  // After the invoices have rendered, not when they arrive: printing in the
  // same tick as setDocs would print the empty container.
  useEffect(() => {
    if (docs && docs.length) handlePrint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  // One invoice's template values under these options - what its own page's
  // Printing Options would give it (functions/templatePrint).
  const templateArgs = (inv) => {
    const s = bulkPrintSettings(inv, options, companyId);
    return {
      invoice: inv,
      records: inv.Charge_Heads || [],
      company: getCompany(s.companyId),
      bankAccount: defaultBankAccount(companyBankAccounts(s.companyId), inv),
      options: {
        hideRef: s.reference, hideLogo: s.logo, hideBalance: s.hideBalance, hideNote: s.note,
        hideSignLine: s.hideSignLine, shipperInMs: s.shipperInMs, hideTax: s.hideTax,
        hidePrintedBy: s.hidePrintedBy, hideBankDetails: s.hideBankDetails,
      },
      salesTaxInvoice: options.vatInvoice,
    };
  };

  // Each through its Word template where it has one, as one PDF; the rest in
  // the built-in layout. A template that cannot be printed: all of them in
  // the built-in layout, saying why, rather than nothing.
  const print = async (invoices) => {
    let templates;
    try {
      templates = await templatesFor(invoices, (inv) => ({
        companyId: bulkPrintSettings(inv, options, companyId).companyId,
        type: options.vatInvoice ? SALES_TAX_INVOICE : inv.type,
      }));
    } catch (_) {
      // Not reachable: the built-in layout, as before templates existed.
      templates = invoices.map(() => null);
    }
    const templated = invoices.map((inv, i) => ({ inv, template: templates[i] })).filter((x) => x.template);
    const builtIn = invoices.filter((_, i) => !templates[i]);
    if (!templated.length) {
      setDocs(builtIn);
      return;
    }
    try {
      const pdf = await renderManyPdf(templated.map(({ inv, template }) => ({ template, args: templateArgs(inv) })), title);
      closePdf();
      pdfUrl.current = URL.createObjectURL(pdf);
      setTemplatePdf({ url: pdfUrl.current, count: templated.length, builtIn });
    } catch (e) {
      openNotification('Error', `${e.message} They print in the built-in layout instead.`, 'red', 10);
      setDocs(invoices);
    }
  };

  const printRest = () => {
    setDocs(templatePdf.builtIn);
    setTemplatePdf((p) => ({ ...p, builtIn: [] }));
  };

  const printAll = async () => {
    setOptionsOpen(false);
    setPreparing(true);
    try {
      const { invoices, failed } = await fetchInChunks(list, fetchInvoice);
      if (failed.length) {
        openNotification(
          'Error',
          `Could not load ${failed.map((f) => f.invoice_No).join(', ')}${invoices.length ? ' - printing the rest.' : '.'}`,
          'red',
        );
      }
      if (!options.vatInvoice) {
        if (invoices.length) await print(invoices);
        return;
      }
      const { printable, skipped } = saleTaxDocuments(invoices, isSaleTaxLine);
      if (skipped.length) {
        openNotification(
          printable.length ? 'Some skipped' : 'Nothing to print',
          `No taxed charge, so no Sales Tax Invoice: ${skipped.map((x) => x.invoice_No).join(', ')}.`,
          'orange',
        );
      }
      if (printable.length) await print(printable);
    } finally {
      setPreparing(false);
    }
  };

  React.useImperativeHandle(ref, () => ({ open: () => setOptionsOpen(true) }), []);

  /* THE LIST ITSELF IS FOLDED AWAY until asked for (2026-11-15). It was a
     table up to 220px tall above the results, which pushed the invoices being
     picked off the screen while they were being picked. The bar says how many
     are on it; Show lists them. */
  const [shown, setShown] = useState(false);

  if (!list.length) return null;

  return (
    <div className='dl-printlist'>
      <div className='dl-printlist-bar'>
        <PrinterOutlined className='dl-printlist-icon' />
        <b>Print list</b>
        <span className='dl-printlist-count'>{list.length} {list.length === 1 ? 'document' : 'documents'}</span>
        <button type='button' className='dl-printlist-link' onClick={() => setShown((v) => !v)} aria-expanded={shown}>
          {shown ? 'Hide' : 'Show'}
        </button>
        <span className='dl-printlist-spacer' />
        {printFromToolbar ? (
          preparing && <span className='dl-printlist-count'>Preparing {list.length}…</span>
        ) : (
          <button type='button' className='dl-tool' onClick={() => setOptionsOpen(true)} disabled={preparing}>
            {preparing ? `Preparing ${list.length}…` : `Print all (${list.length})`}
          </button>
        )}
        <button type='button' className='dl-tool' onClick={() => setList([])} disabled={preparing}>
          Clear list
        </button>
      </div>
      {shown && (
        <div className='dl-printlist-items'>
          <table className='dl-table'>
            <thead>
              <tr>
                <th>#</th><th>No.</th><th>Type</th><th>Party</th><th>Status</th>
                <th className='dl-num'>Amount</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((x, i) => (
                <tr key={x.id}>
                  <td className='dl-muted'>{i + 1}</td>
                  <td className='dl-strong'>{x.invoice_No}</td>
                  <td>{x.type}</td>
                  <td><span className='dl-clip'>{x.party_Name}</span></td>
                  <td>
                    {String(x.approved) === '1'
                      ? <span className='dl-badge tone-green'>Approved</span>
                      : <span className='dl-badge tone-amber' title='Prints with a DRAFT mark'>Unapproved · prints as DRAFT</span>}
                  </td>
                  <td className='dl-num'>{x.currency} {money(x.total)}</td>
                  <td className='dl-num'>
                    <button type='button' className='dl-printlist-link' disabled={preparing}
                      title='Take off the print list' onClick={() => setList(removeFromPrintList(list, x.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The invoice page's Printing Options, for every invoice on the list. */}
      <Modal title='Printing Options' open={optionsOpen} onCancel={() => setOptionsOpen(false)} footer={null} width={400}>
        <div style={po.checks}>
          <Checkbox onChange={toggle('hideRef')} checked={options.hideRef}>Hide Ref &amp; Sales Rep</Checkbox>
          <Checkbox onChange={toggle('hideLogo')} checked={options.hideLogo}>Hide Logo</Checkbox>
          <Checkbox onChange={toggle('hideNote')} checked={options.hideNote}
            title='An invoice with no note never prints one; this hides the rest'>
            Hide Note
          </Checkbox>
          <Checkbox onChange={toggle('hideBalance')} checked={options.hideBalance}
            title='Leave off Received / Paid, Adjustment and Balance'>
            Hide Balance
          </Checkbox>
          <Checkbox onChange={toggle('hideSignLine')} checked={options.hideSignLine}>Hide Sign Line</Checkbox>
          <Checkbox onChange={toggle('hidePrintedBy')} checked={options.hidePrintedBy}>Hide Printed On / By</Checkbox>
          <Checkbox onChange={toggle('hideBankDetails')} checked={options.hideBankDetails}>Hide Bank Details</Checkbox>
          {isCustomsMode() && (
            <Checkbox onChange={toggle('shipperInMs')} checked={options.shipperInMs}
              title="Print the job's shipper in M/S instead of the invoiced party, where the job has one">
              Shipper in M/S
            </Checkbox>
          )}
          {isCustomsMode() && (
            <Checkbox onChange={toggle('hideTax')} checked={options.hideTax}
              title='No Tax column; the service charges before tax, then Sales Tax, Total Without Tax and Total With Tax'>
              Hide Tax Column
            </Checkbox>
          )}
          <Checkbox onChange={toggle('vatInvoice')} checked={options.vatInvoice}
            title='Print the Sales Tax Invoice of each invoice with a taxed charge; the rest are skipped'>
            VAT Tax Invoice
          </Checkbox>
        </div>
        <div style={po.label}>Letterhead</div>
        <Select
          style={{ width: '100%' }}
          value={String(options.letterhead)}
          onChange={(v) => setOptions((o) => ({ ...o, letterhead: v }))}
          options={[
            { label: "Each invoice's own company", value: '' },
            ...companyOptions().map((o) => ({ label: o.label, value: String(o.value) })),
          ]}
        />
        <div style={po.actions}>
          <button type='button' style={po.cancel} onClick={() => setOptionsOpen(false)}>Cancel</button>
          <button type='button' className='btn-custom px-4' onClick={printAll}>
            Print {list.length}
          </button>
        </div>
      </Modal>

      {/* The ones with a Word template, as one PDF - the browser's own viewer,
          with its print and save buttons. Shown here rather than in a new tab:
          it arrives long after the click, when a pop-up would be blocked. */}
      {templatePdf && (
        <Modal title={`${title} from Word templates (${templatePdf.count})`} open onCancel={closePdf} footer={null} width={1000} centered>
          <iframe title={title} src={templatePdf.url} style={{ width: '100%', height: '72vh', border: '1px solid #e6e6e6' }} />
          <div style={po.actions}>
            {templatePdf.builtIn.length > 0 && (
              <span style={{ marginRight: 'auto', fontSize: 13 }}>
                {templatePdf.builtIn.length} on the list {templatePdf.builtIn.length === 1 ? 'has' : 'have'} no template:{' '}
                <button type='button' className='btn-custom px-3' onClick={printRest}>
                  Print {templatePdf.builtIn.length === 1 ? 'it' : `those ${templatePdf.builtIn.length}`}
                </button>
              </span>
            )}
            <a className='btn-custom px-3' href={templatePdf.url} download={`${title}.pdf`}>Download</a>
            <button type='button' style={po.cancel} onClick={closePdf}>Close</button>
          </div>
        </Modal>
      )}

      {/* Off-screen, NOT display:none - react-to-print clones this subtree with
          its computed styles, and a display:none ancestor prints a blank page.
          A4 wide, so the invoices lay out at the width they print at. */}
      <div aria-hidden='true' style={{ position: 'absolute', left: '-10000px', top: 0, width: '210mm' }}>
        <div ref={printRef}>
          {(docs || []).map((inv, i) => {
            const s = bulkPrintSettings(inv, options, companyId);
            return (
              <div key={inv.id} style={i ? { breakBefore: 'page', pageBreakBefore: 'always' } : undefined}>
                <InvoicePrint
                  logo={s.logo}
                  compLogo={s.companyId}
                  company={getCompany(s.companyId)}
                  records={inv.Charge_Heads || []}
                  bankAccount={defaultBankAccount(companyBankAccounts(s.companyId), inv)}
                  invoice={inv}
                  note={s.note}
                  reference={s.reference}
                  shipperInMs={s.shipperInMs}
                  vatInvoice={s.vatInvoice}
                  hideBalance={s.hideBalance}
                  hideSignLine={s.hideSignLine}
                  hidePrintedBy={s.hidePrintedBy}
                  hideTax={s.hideTax}
                  hideBankDetails={s.hideBankDetails}
                  calculateTotal={calculateTotal}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});


// The invoice page's Printing Options dialog, which styles itself with global
// CSS that only exists while that page's dialog is open.
const po = {
  checks: {
    display: 'flex', flexDirection: 'column', gap: 10,
    paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #f0f2f5',
  },
  label: { fontSize: 11, color: '#8a97a3', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 4 },
  actions: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 20 },
  cancel: { background: 'none', border: 0, color: '#6b7684', fontSize: 13, padding: '5px 10px', cursor: 'pointer' },
};

PrintList.displayName = 'PrintList';

export default PrintList;
