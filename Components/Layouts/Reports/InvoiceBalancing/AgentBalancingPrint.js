import React from 'react';
import moment from 'moment';
import { companyLogo, companyDetails, reportCompanyTitle, reportLetterheadId } from 'functions/companyBranding';

/**
 * The Agent Invoice Balancing report as printed - its own layout, as Job
 * Balancing's (JobBalancingPrint). It printed the screen table: the 20 rows of
 * the page on screen, at screen widths on portrait A4 so the money columns ran
 * off the paper, with "Printed On / By" pinned to the first page (the user's
 * report, 2026-10-15).
 *
 * Every row, A4 landscape. The letterhead, the title and the column headings
 * sit in the table's <thead> so they repeat on every page; the footer is drawn
 * in the page margin (@page margin boxes), the only place a page number can
 * come from. The rows and totals are the report's own (functions/
 * agentBalancing) - `rows` signed, a CN's below zero, `totals` one line per
 * currency - so the print says what the screen says. `oneAmount` puts Debit
 * and Credit in one Amount column.
 */

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (v) => num(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtSigned = (v) => (num(v) < 0 ? `(${fmt(-num(v))})` : fmt(v));
const fmtQty = (v) => (v === null || v === undefined || v === '' ? '' : fmt(v));

const DATE_FORMATS = [moment.ISO_8601, 'DD-MMM-YY', 'DD-MMM-YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY'];
const fmtDate = (v) => {
  if (!v) return '';
  const m = moment(v, DATE_FORMATS, true);
  return m.isValid() ? m.format('DD-MMM-YYYY') : String(v);
};

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

const jobNo = (x) => x.SE_Job?.jobNo || x.aviation?.jobNo || x.customs?.jobNo || '';

const AgentBalancingPrint = ({
  rows = [], totals = [], oneAmount = false, company, from, to, printedBy = '', printedAt,
}) => {
  const columns = [
    { label: 'S #', weight: 2.6, style: center, value: (x, i) => i + 1 },
    { label: 'Inv No', weight: 8, value: (x) => x.invoice_No },
    { label: 'Job No', weight: 8, value: jobNo },
    { label: 'Date', weight: 6, style: center, value: (x) => fmtDate(x.createdAt) },
    { label: 'HBL/HAWB', weight: 8, value: (x) => x.SE_Job?.Bl?.hbl },
    { label: 'Agent', weight: 12, value: (x) => x.party_Name },
    { label: 'F.Dest', weight: 5, style: center, value: (x) => x.SE_Job?.fd },
    { label: 'J/Tp', weight: 3, style: center, value: (x) => x.SE_Job?.subType },
    { label: 'F/Tp', weight: 3, style: center, value: (x) => (x.Charge_Heads?.length ? x.Charge_Heads[0].pp_cc : '') },
    { label: 'Cntrs', weight: 5, value: (x) => x.SE_Job?.container },
    { label: 'WT', weight: 4, style: right, value: (x) => fmtQty(x.SE_Job?.weight) },
    { label: 'Vol', weight: 4, style: right, value: (x) => fmtQty(x.SE_Job?.vol) },
    { label: 'Curr', weight: 4, style: center, value: (x) => x.currency, isCurrency: true },
    ...(oneAmount
      ? [{ label: 'Amount', weight: 8, style: right, money: 'amount', value: (x) => fmtSigned(x.amount) }]
      : [
        { label: 'Debit', weight: 7, style: right, money: 'debit', value: (x) => fmt(x.debit) },
        { label: 'Credit', weight: 7, style: right, money: 'credit', value: (x) => fmtSigned(x.credit) },
      ]),
    { label: 'Paid / Rcvd', weight: 7, style: right, money: 'paidRec', value: (x) => fmtSigned(x.paidRec) },
    { label: 'Balance', weight: 7, style: right, money: 'balance', value: (x) => fmtSigned(x.balance) },
    { label: 'Age', weight: 3, style: center, value: (x) => x.age ?? '' },
  ];
  const weightSum = columns.reduce((t, c) => t + c.weight, 0);
  const currencyIndex = columns.findIndex((c) => c.isCurrency);
  const totalFor = (c, t) => {
    switch (c.money) {
      case 'amount': return fmtSigned(Math.round((num(t.debit) - num(t.credit)) * 100) / 100);
      case 'debit': return fmt(t.debit);
      // Below zero, as the column's rows are.
      case 'credit': return fmtSigned(-num(t.credit));
      case 'paidRec': return fmtSigned(t.paidRec);
      case 'balance': return fmtSigned(t.balance);
      default: return '';
    }
  };

  const letterhead = reportLetterheadId(company);
  const title = reportCompanyTitle(company);
  const { address } = companyDetails(letterhead);
  const logo = companyLogo(letterhead, { print: true });
  const printedOn = moment(printedAt || undefined).format('DD/MM/YYYY HH:mm:ss');

  return (
    <div className='agent-balancing-print' style={{ color: '#000', fontFamily: 'Arial, sans-serif' }}>
      <style>{`
        @media print {
          @page agentBalancing {
            size: A4 landscape;
            margin: 8mm 8mm 12mm 8mm;
            @bottom-left { content: ${cssString(`Printed On :  ${printedOn}`)}; font: 9px Arial, sans-serif; }
            @bottom-center { content: ${cssString(`Printed By :  ${printedBy}`)}; font: 9px Arial, sans-serif; }
            @bottom-right { content: "Page " counter(page); font: 9px Arial, sans-serif; }
          }
          .agent-balancing-print { page: agentBalancing; }
          .agent-balancing-print thead { display: table-header-group; }
          .agent-balancing-print tr { page-break-inside: avoid; }
        }
      `}</style>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          {columns.map((c, i) => <col key={i} style={{ width: `${(c.weight / weightSum) * 100}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            <td colSpan={columns.length} style={{ padding: '0 0 6px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '20%' }}>
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
                <div style={{ padding: '0 10px', fontSize: 13, fontWeight: 700 }}>Agent Invoice Balancing Report</div>
                <div style={{ width: 60, ...doubleRule }} />
              </div>
            </td>
          </tr>
          <tr>
            {columns.map((c, i) => <th key={i} style={head}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={x.id ?? i} data-row>
              {columns.map((c, j) => (
                <td key={j} style={{ ...cell, ...(c.style || {}) }}>{c.value(x, i)}</td>
              ))}
            </tr>
          ))}
          {totals.map((t) => (
            <tr key={`total-${t.currency}`} data-total>
              <td colSpan={currencyIndex} style={{ ...cell, textAlign: 'right', fontWeight: 700, fontSize: 10 }}>
                Total :
              </td>
              <td style={{ ...cell, ...center, fontWeight: 700 }}>{t.currency}</td>
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

export default AgentBalancingPrint;
