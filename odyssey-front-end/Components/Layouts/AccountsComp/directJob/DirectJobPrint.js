import React from 'react';
import moment from 'moment';
import usePrintStamp from 'functions/usePrintStamp';
import CompanyLetterhead from 'Components/Shared/CompanyLetterhead';
import { directJobPrintModel } from 'functions/directJobPrint';

/**
 * The Direct Job Expense / Revenue print - laid out after the voucher Climax
 * printed for these entries, which the office files and signs: letterhead,
 * "Job Direct Expense Revenue", the entry header, one row per job line,
 * totals, the amount in words and the remarks. The figures come from
 * functions/directJobPrint; this only arranges them.
 */
const fs = { fontSize: 11 };
const label = { ...fs, fontWeight: 700, whiteSpace: 'nowrap', paddingRight: 6 };
const value = { ...fs, borderBottom: '1px solid #000', minWidth: 90, display: 'inline-block', paddingRight: 8 };
const cell = { border: '1px solid #000', padding: '2px 4px', fontSize: 10, verticalAlign: 'middle' };
const head = { ...cell, fontWeight: 700, textAlign: 'center', backgroundColor: '#f0f0f0', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' };
const num = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };

const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v) => (v && moment(v).isValid() ? moment(v).format('DD/MM/YYYY') : '');

const Field = ({ name, children, width }) => (
  <span style={{ display: 'inline-flex', alignItems: 'baseline', width, marginBottom: 6 }}>
    <span style={label}>{name}</span>
    <span style={value}>{children || ' '}</span>
  </span>
);

const DirectJobPrint = ({ state, companyId, printedBy }) => {
  const m = directJobPrintModel(state);
  // Empty until in the browser - see functions/usePrintStamp. A name given
  // (the tests) is used as it is.
  const stamp = usePrintStamp();

  return (
    <div className='direct-job-print-root' style={{ padding: '18px 24px', color: '#000', fontFamily: 'Arial, sans-serif' }}>
      <style>{'@media print { @page { size: A4 portrait; margin: 10mm; } }'}</style>

      {/* Letterhead - logo left, the company's name and contact centred. */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '22%' }}>
          <CompanyLetterhead companyId={companyId} showTitle={false} showContact={false} logoHeight={60} />
        </div>
        <div style={{ width: '56%' }}>
          <CompanyLetterhead companyId={companyId} showLogo={false} titleSize={18} paraStyles={{ fontSize: 11 }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', margin: '10px 0 12px' }}>
        <div style={{ flex: 1, borderTop: '3px double #000' }} />
        <div style={{ padding: '0 12px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>Job Direct Expense Revenue</div>
        <div style={{ flex: 1, borderTop: '3px double #000' }} />
      </div>

      {/* The entry. */}
      <div>
        <Field name='Entry # :' width='26%'>{m.entryNo}</Field>
        <Field name='Entry Date :' width='26%'>{date(m.entryDate)}</Field>
        <Field name='Type :' width='24%'>{m.type}</Field>
        <Field name='Ref # :' width='24%'>{m.reference}</Field>
      </div>
      <div>
        <Field name='Cost Center :' width='76%'>{m.costCenter}</Field>
        <Field name='Curr :' width='24%'>{m.currency}</Field>
      </div>
      <div>
        <Field name='Tran Mode :' width='26%'>{m.tranMode}</Field>
        <Field name='Sub Type :' width='26%'>{m.subType}</Field>
        <Field name='Chq # :' width='24%'>{m.chequeNo}</Field>
        <Field name='Chq Date :' width='24%'>{date(m.chequeDate)}</Field>
      </div>
      <div><Field name='Account :' width='76%'>{m.account}</Field></div>
      {m.paidTo && <div><Field name='Paid To :' width='76%'>{m.paidTo}</Field></div>}
      <div><Field name='Drawn At :' width='76%'>{m.drawnAt}</Field></div>
      <div>
        <Field name='Operation :' width='26%'>{m.operation}</Field>
        <Field name='Job Type :' width='26%'>{m.jobType}</Field>
        <Field name='Job No :' width='48%'>{m.jobNo}</Field>
      </div>

      {/* One row per job line. */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <td style={head}>S#</td>
            <td style={head}>Job No</td>
            <td style={head}>File No</td>
            <td style={head}>Charges</td>
            <td style={head}>Curr</td>
            <td style={head}>Qty</td>
            <td style={head}>Rate</td>
            <td style={head}>Amount</td>
            <td style={head}>Discount Amount</td>
            <td style={head}>Net Amount</td>
            <td style={head}>Exch Rate</td>
            <td style={head}>Local Amount</td>
            <td style={head}>Description</td>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.sno}>
              <td style={{ ...cell, textAlign: 'center' }}>{r.sno}</td>
              <td style={cell}>{r.jobNo}</td>
              <td style={cell}>{r.fileNo}</td>
              <td style={cell}>{r.charge}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{r.currency}</td>
              <td style={num}>{money(r.qty)}</td>
              <td style={num}>{money(r.rate)}</td>
              <td style={num}>{money(r.amount)}</td>
              <td style={num}>{r.discount ? money(r.discount) : ''}</td>
              <td style={num}>{money(r.net)}</td>
              <td style={num}>{r.exRate.toFixed(3)}</td>
              <td style={num}>{money(r.local)}</td>
              <td style={{ ...cell, fontSize: 9, maxWidth: 120 }}>{r.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals - Amount / Net on the left, Discount / Local on the right. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 130px auto 130px', columnGap: 12, rowGap: 8, justifyContent: 'center', marginTop: 12, ...fs }}>
        <b style={{ textAlign: 'right' }}>Amount :</b>
        <span style={{ ...value, textAlign: 'right' }}>{money(m.totals.amount)}</span>
        <b style={{ textAlign: 'right' }}>Discount Amount :</b>
        <span style={{ ...value, textAlign: 'right' }}>{money(m.totals.discount)}</span>
        <b style={{ textAlign: 'right' }}>Net Amount :</b>
        <span style={{ ...value, textAlign: 'right' }}>{money(m.totals.net)}</span>
        <b style={{ textAlign: 'right' }}>Local Amount :</b>
        <span style={{ ...value, textAlign: 'right' }}>{money(m.totals.local)}</span>
      </div>

      <div style={{ marginTop: 16, ...fs }}>
        <b>In Words :</b>&nbsp;&nbsp;<b>{m.inWords}</b>
      </div>
      <div style={{ marginTop: 14, ...fs }}>
        <b>Remarks :</b>&nbsp;&nbsp;{m.remarks}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 70, fontSize: 9 }}>
        <span><b>Printed On :</b> {stamp.at ? moment(stamp.at).format('DD/MM/YYYY HH:mm:ss') : ''}</span>
        <span><b>Printed By :</b> {printedBy ?? stamp.by}</span>
      </div>
    </div>
  );
};

export default DirectJobPrint;
