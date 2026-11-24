import React from 'react';
import moment from 'moment';
import { companyLogo, companyDetails, reportCompanyTitle, reportLetterheadId } from 'functions/companyBranding';
import { usesColumn } from 'functions/invoiceJobColumns';

/**
 * The Job Balancing report as printed - laid out as Climax printed it, which
 * is the statement the accounts staff and the customers already read: the
 * letterhead, "From = … Till = …", the report title between double rules, the
 * Climax columns in the Climax order, a Total line, and "Printed On / Printed
 * By / Page N" at the foot of every page.
 *
 * The letterhead, the title and the column headings sit in the table's <thead>,
 * so the browser repeats all three at the top of every printed page, as Climax
 * does. The footer is drawn in the page margin (@page margin boxes), which is
 * the only place a page number can come from.
 *
 * Columns a mode never fills are left out, the same rule the screen follows
 * (functions/invoiceJobColumns): a flight has no containers, a declaration no
 * final destination. Freight shows every Climax column.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (v) => num(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
// Negative as (1,234.00), the way the screen shows a payable balance.
const fmtSigned = (v) => (num(v) < 0 ? `(${fmt(-num(v))})` : fmt(v));
// A weight or volume the job does not record stays blank rather than 0.00.
const fmtQty = (v) => (v === null || v === undefined || v === '' ? '' : fmt(v));

/* The rows arrive with createdAt already rewritten to "DD-MMM-YY" by the
 * report, and a delivery order's date is whatever the DO screen saved - so
 * parse leniently, strictly, and show the raw text rather than "Invalid date". */
const DATE_FORMATS = [moment.ISO_8601, 'DD-MMM-YY', 'DD-MMM-YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY'];
const fmtDate = (v) => {
  if (!v) return '';
  const m = moment(v, DATE_FORMATS, true);
  return m.isValid() ? m.format('DD-MMM-YYYY') : String(v);
};

const receivable = (x) => x.payType === 'Recievable';
const ppcc = (v) => (v === 'Prepaid' ? 'PP' : v === 'Collect' ? 'CC' : '');

/* "AIR BLUE LTD ( 704 )" - the client code Climax printed beside the name.
 * The code the server sends is the JOB's client's, so it is only printed when
 * that client is the party this invoice is raised on; an invoice to anyone
 * else shows the name alone rather than borrowing somebody else's code. */
const clientCell = (x) => {
  const name = x.party_Name || '';
  const client = x.SE_Job && x.SE_Job.Client;
  const same = client && client.code
    && String(client.name || '').trim().toUpperCase() === name.trim().toUpperCase();
  return same ? `${name} ( ${client.code} )` : name;
};

// For a CSS content: string - the footer text is the user's name.
const cssString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

const border = '1px solid #444';
const cell = { border, padding: '2px 3px', fontSize: 9, verticalAlign: 'middle', wordBreak: 'break-word' };
const head = {
  ...cell, fontWeight: 700, textAlign: 'center', background: '#d9d9d9',
  WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
};
const right = { textAlign: 'right', whiteSpace: 'nowrap' };
const center = { textAlign: 'center' };
const doubleRule = { borderTop: '3px double #000' };

const JobBalancingPrint = ({
  records = [], company, from, to, docLabel = 'HBL/HAWB', mode = 'freight',
  showAge = true, printedBy = '', printedAt,
}) => {
  const show = (key) => usesColumn(mode, key);

  /* ONE MONEY COLUMN, as Climax had, when the report is one side - which is
   * how it is run. Odyssey can also run it for both at once; then receivable
   * and payable keep a column each, because one column holding both would
   * make its total mean nothing. */
  const hasRec = records.some(receivable);
  const hasPay = records.some((x) => !receivable(x));
  const mixed = hasRec && hasPay;
  const amountLabel = hasPay && !hasRec ? 'Payable' : 'Receivable';
  const settledLabel = mixed ? 'Paid / Rcvd' : hasPay ? 'Paid' : 'Received';
  const settled = (x) => (receivable(x) ? x.recieved : x.paid);
  const balance = (x) => (mixed && !receivable(x) ? -num(x.balance) : num(x.balance));

  /* weight: the column's share of the width, from Climax's own proportions,
   * normalised below over the columns this mode actually prints. */
  const columns = [
    { label: 'S #', weight: 2.6, style: center, value: (x, i) => i + 1 },
    { label: 'Inv No', weight: 7, value: (x) => x.invoice_No },
    { label: 'Job No', weight: 8, value: (x) => x.jobCols?.jobNo },
    { label: 'Date', weight: 6, style: center, value: (x) => fmtDate(x.createdAt) },
    show('doDate') && { label: 'DO Date', weight: 6, style: center, value: (x) => fmtDate(x.jobCols?.doDate) },
    { label: docLabel, weight: 8, value: (x) => x.jobCols?.docPrimary },
    show('gdDate') && { label: 'GD Date', weight: 6, style: center, value: (x) => fmtDate(x.jobCols?.gdDate) },
    show('clientInvoiceNo') && { label: 'Client Inv #', weight: 8, value: (x) => x.jobCols?.clientInvoiceNo },
    show('vendorTaxInvoiceNo') && { label: 'Vendor Tax Inv #', weight: 8, value: (x) => x.jobCols?.vendorTaxInvoiceNo },
    { label: 'Client', weight: 10, value: clientCell },
    show('finalDestination') && { label: 'F.Dest', weight: 5, style: center, value: (x) => x.jobCols?.finalDestination },
    { label: 'J/Tp', weight: 3, style: center, value: (x) => x.jobCols?.jobType },
    show('freightType') && { label: 'F/Tp', weight: 3, style: center, value: (x) => ppcc(x.jobCols?.freightType) },
    show('containers') && { label: 'Cntrs', weight: 5, value: (x) => x.jobCols?.containers },
    show('weight') && { label: 'WT', weight: 4, style: right, value: (x) => fmtQty(x.jobCols?.weight) },
    show('volume') && { label: 'Vol', weight: 4, style: right, value: (x) => fmtQty(x.jobCols?.volume) },
    { label: 'Curr', weight: 4, style: center, value: (x) => x.currency, isCurrency: true },
    ...(mixed
      ? [
        { label: 'Receivable', weight: 7, style: right, money: 'rec', value: (x) => (receivable(x) ? fmt(x.total) : '-') },
        { label: 'Payable', weight: 7, style: right, money: 'pay', value: (x) => (receivable(x) ? '-' : fmt(x.total)) },
      ]
      : [{ label: amountLabel, weight: 7, style: right, money: 'amount', value: (x) => fmt(x.total) }]),
    /* Odyssey records every settlement as received or paid; there is no
     * separate adjustment figure to put here, so it reads 0.00 - as it did in
     * Climax for every invoice nobody adjusted, and as the Excel export does. */
    { label: 'Adjust', weight: 5, style: right, money: 'adjust', value: () => fmt(0) },
    { label: settledLabel, weight: 7, style: right, money: 'settled', value: (x) => fmt(settled(x)) },
    { label: 'Balance', weight: 7, style: right, money: 'balance', value: (x) => fmtSigned(balance(x)) },
    showAge && { label: 'Age', weight: 3, style: center, value: (x) => x.age ?? '' },
  ].filter(Boolean);

  const weightSum = columns.reduce((t, c) => t + c.weight, 0);
  const currencyIndex = columns.findIndex((c) => c.isCurrency);

  /* THE TOTAL LINE, from the rows printed above it - so it always adds up to
   * what is on the page. One line per currency: adding USD to PKR gives a
   * figure that is neither. */
  const byCurrency = new Map();
  for (const x of records) {
    const key = x.currency || '';
    const t = byCurrency.get(key) || { rec: 0, pay: 0, settled: 0, balance: 0 };
    // Both sides at once nets received against paid, as the screen's total does.
    if (receivable(x)) { t.rec += num(x.total); t.settled += num(x.recieved); }
    else { t.pay += num(x.total); t.settled += mixed ? -num(x.paid) : num(x.paid); }
    t.balance += balance(x);
    byCurrency.set(key, t);
  }
  const totalFor = (c, t) => {
    switch (c.money) {
      case 'rec': return fmt(t.rec);
      case 'pay': return fmt(t.pay);
      case 'amount': return fmt(t.rec + t.pay);
      case 'adjust': return fmt(0);
      case 'settled': return fmtSigned(t.settled);
      case 'balance': return fmtSigned(t.balance);
      default: return '';
    }
  };

  // "All companies" prints the header company's letterhead - see
  // reportLetterheadId.
  const letterhead = reportLetterheadId(company);
  const title = reportCompanyTitle(company);
  const { address } = companyDetails(letterhead);
  const logo = companyLogo(letterhead, { print: true });
  const printedOn = moment(printedAt || undefined).format('DD/MM/YYYY HH:mm:ss');

  return (
    <div className='job-balancing-print' style={{ color: '#000', fontFamily: 'Arial, sans-serif' }}>
      <style>{`
        @media print {
          @page jobBalancing {
            size: A4 landscape;
            margin: 8mm 8mm 12mm 8mm;
            @bottom-left { content: ${cssString(`Printed On :  ${printedOn}`)}; font: 9px Arial, sans-serif; }
            @bottom-center { content: ${cssString(`Printed By :  ${printedBy}`)}; font: 9px Arial, sans-serif; }
            @bottom-right { content: "Page " counter(page); font: 9px Arial, sans-serif; }
          }
          .job-balancing-print { page: jobBalancing; }
          .job-balancing-print thead { display: table-header-group; }
          .job-balancing-print tr { page-break-inside: avoid; }
        }
      `}</style>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map((c, i) => <col key={i} style={{ width: `${(c.weight / weightSum) * 100}%` }} />)}
        </colgroup>
        <thead>
          {/* A <td>, not a <th>: the letterhead is part of what repeats, not a
              column heading. */}
          <tr>
            <td colSpan={columns.length} style={{ padding: '0 0 6px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '20%' }}>
                  {/* Nothing when the company has no logo - never a bundled
                      fallback, which would be another tenant's artwork. */}
                  {logo && <img src={logo} alt='' style={{ maxHeight: 60, maxWidth: '100%' }} />}
                </div>
                <div style={{ width: '60%', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
                  {address && <div style={{ fontSize: 11, marginTop: 4 }}>{address}</div>}
                </div>
                <div style={{ width: '20%' }} />
              </div>
              <div style={{ textAlign: 'right', fontSize: 10, margin: '14px 0 8px' }}>
                From = {from}&nbsp;&nbsp;Till = {to}
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1, ...doubleRule }} />
                <div style={{ padding: '0 10px', fontSize: 13, fontWeight: 700 }}>Job Balancing Reports</div>
                <div style={{ width: 60, ...doubleRule }} />
              </div>
            </td>
          </tr>
          <tr>
            {columns.map((c, i) => <th key={i} style={head}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {records.map((x, i) => (
            <tr key={x.id ?? i}>
              {columns.map((c, j) => (
                <td key={j} style={{ ...cell, ...(c.style || {}) }}>{c.value(x, i)}</td>
              ))}
            </tr>
          ))}
          {[...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, t]) => (
            <tr key={`total-${currency}`}>
              <td colSpan={currencyIndex} style={{ ...cell, textAlign: 'right', fontWeight: 700, fontSize: 10 }}>
                Total :
              </td>
              <td style={{ ...cell, ...center, fontWeight: 700 }}>{currency}</td>
              {columns.slice(currencyIndex + 1).map((c, j) => (
                <td key={j} style={{ ...cell, ...right, fontWeight: 700 }}>{totalFor(c, t)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default JobBalancingPrint;
