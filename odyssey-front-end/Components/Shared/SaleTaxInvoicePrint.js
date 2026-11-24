import React from 'react';
import moment from 'moment';
import usePrintStamp from 'functions/usePrintStamp';
import inWords from 'functions/numToWords';
import { getCompany } from 'functions/companyBranding';
import { saleTaxFigures } from 'functions/saleTaxInvoice';
import { clientInvoiceNo } from 'functions/customsJobReference';
import DraftWatermark from './DraftWatermark';

/**
 * The Sales Tax Invoice - what "VAT Tax Invoice" on Printing Options prints.
 *
 * Laid out as the legacy system's form, which is what the client and the tax
 * authority already file: the GST invoice number, the recipient's STRN and
 * NTN, the declaration it was for, and ONLY the taxed lines - Service Charges,
 * Sales Tax @ rate, and the total inclusive of tax. See functions/saleTaxInvoice
 * for which lines those are. Printed as "Sales Tax" throughout, at the user's
 * instruction - the legacy form said "Sale Tax".
 *
 * Shipper in M/S on Printing Options addresses it to the job's shipper - name,
 * address, STRN and NTN all the shipper's own, as the normal invoice prints
 * them (CustomsInvoiceHeader). A job with no shipper keeps the invoiced party.
 *
 * `invoice.customsJob` and `invoice.recipient` come from the server's
 * attachPrintContext (routes/invoice), `invoice.Sales_Tax_Invoice` from the
 * GST number table. A freight invoice has no customsJob; the job lines then
 * read from its SE_Job where one has the field, and are blank otherwise.
 */
const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (v) => (v && moment(v).isValid() ? moment(v).format('DD-MMM-YYYY') : (v || ''));

const S = {
  // relative: the DRAFT overlay is positioned against it - see DraftWatermark.
  root: { fontFamily: 'Arial, Helvetica, sans-serif', color: '#000', fontSize: 12, padding: '28px 40px', position: 'relative' },
  label: { fontWeight: 700, whiteSpace: 'nowrap' },
  rule: { borderTop: '1px solid #000', margin: '10px 0' },
  dashed: { borderTop: '1px dashed #000', margin: '10px 0' },
  row: { display: 'flex', alignItems: 'baseline', gap: 12, margin: '6px 0' },
  value: { borderBottom: '1px solid #000', flex: 1, minHeight: 16, paddingLeft: 6 },
  plain: { paddingLeft: 6 },
};

const Field = ({ label, children, underline = false, style }) => (
  <div style={{ ...S.row, ...style }}>
    <span style={S.label}>{label}</span>
    <span style={underline ? S.value : S.plain}>{children}</span>
  </div>
);

const SaleTaxInvoicePrint = ({ invoice, records, company, compLogo, logo, shipperInMs = false, hidePrintedBy = false }) => {
  const comp = company || getCompany(compLogo) || {};
  // Who and when: empty until in the browser - see functions/usePrintStamp.
  const stamp = usePrintStamp();
  const logoSrc = comp.printLogo || comp.logo || null;
  const job = invoice?.customsJob || {};
  const freight = invoice?.SE_Job || {};
  // Who it is addressed to: the invoiced party, or the job's shipper when
  // Printing Options says so. Never one party's name with another's numbers.
  const recipient = shipperInMs && job.shipper?.name
    ? job.shipper
    : { ...(invoice?.recipient || {}), name: invoice?.recipient?.name || invoice?.party_Name };
  const f = saleTaxFigures(records);
  const gstNo = invoice?.Sales_Tax_Invoice?.taxInvoiceNo;
  const packages = [job.packages, job.pkgUnit].filter((x) => x !== null && x !== undefined && x !== '').join(' ')
    || (freight.pcs ? String(freight.pcs) : '');
  // On a clearing file the file number and the GD number are the same figure
  // more often than not, and either may be the one that was filled in. Plain:
  // the label already says "GD #".
  const gdNo = job.gdNumber || job.customFileNo || '';

  return (
    <div className='sale-tax-invoice' style={S.root}>
      <style>{`@media print { @page { size: A4 portrait; margin: 0; } }`}</style>
      <DraftWatermark invoice={invoice} />

      {/* Letterhead */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 160 }}>
          {!logo && logoSrc && <img src={logoSrc} alt='' style={{ maxWidth: 150, maxHeight: 70 }} />}
        </div>
        <div style={{ flex: 1, textAlign: 'center', lineHeight: 1.4 }}>
          {comp.title && <div style={{ fontSize: 20, fontWeight: 700 }}>{comp.title}</div>}
          {comp.address && <div>{comp.address}</div>}
          {comp.phone && <div>Tel: {comp.phone}</div>}
          {(comp.email || comp.web) && (
            <div>
              {comp.email && <>Email: {comp.email}</>}{comp.email && comp.web && <>{'   '}</>}{comp.web && <>Web: {comp.web}</>}
            </div>
          )}
          {/* The supplier's own registration, as the normal invoice prints it. */}
          {comp.ntn && <div>NTN # {comp.ntn}</div>}
          {comp.strn && <div>STRN # {comp.strn}</div>}
        </div>
        <div style={{ width: 160 }} />
      </div>

      <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 700, margin: '18px 0 14px', textDecoration: 'underline', textUnderlineOffset: '5px' }}>SALES TAX INVOICE</div>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          {/* An unapproved invoice has no number YET; an approved one without
              one is a migrated invoice whose number was not brought across. */}
          <Field label='GST Invoice # :'>{gstNo || (String(invoice?.approved) === '1' ? '' : <i>assigned on approval</i>)}</Field>
          <Field label='GD # :'>{gdNo}</Field>
        </div>
        <div>
          <Field label='Invoice No :'>{invoice?.invoice_No}</Field>
          <Field label='Invoice Date :'>{date(invoice?.createdAt)}</Field>
        </div>
      </div>
      <div style={S.rule} />

      <Field label='Name & Address of The Recipient :'>
        {recipient.name}
        {recipient.address1 ? <div>{recipient.address1}</div> : null}
        {recipient.address2 ? <div>{recipient.address2}</div> : null}
      </Field>
      <div style={S.rule} />

      <Field label='Sales Tax Registration No. of The Recipient' underline>{recipient.strn || ''}</Field>
      <Field label='NTN No. of The Recipient' underline>{recipient.ntn || ''}</Field>

      <div style={{ display: 'flex', gap: 24 }}>
        <Field label='Client Invoice # :' underline style={{ flex: 1 }}>{clientInvoiceNo(job)}</Field>
        <Field label='No. of Packages :' underline style={{ flex: 1 }}>{packages}</Field>
      </div>
      <Field label='Description :' underline>{job.goodsDescription || ''}</Field>
      <div style={S.dashed} />

      {/* The figures - taxed lines only */}
      <table style={{ margin: '14px auto', borderCollapse: 'collapse', minWidth: '70%' }}>
        <tbody>
          <tr>
            <td style={{ ...S.label, textAlign: 'right', padding: '3px 16px' }}>Service Charges</td>
            <td style={{ textAlign: 'right', padding: '3px 16px' }}>{money(f.serviceCharges)}</td>
          </tr>
          <tr>
            <td style={{ ...S.label, textAlign: 'right', padding: '3px 16px' }}>
              Sales Tax @ {f.rate !== null ? `${f.rate} %` : '(rates vary by line)'}
            </td>
            <td style={{ textAlign: 'right', padding: '3px 16px' }}>{money(f.saleTax)}</td>
          </tr>
          <tr>
            <td style={{ ...S.label, textAlign: 'right', padding: '3px 16px' }}>Amount of Additional Sales Tax (if any)</td>
            <td style={{ textAlign: 'right', padding: '3px 16px' }}>{money(f.additionalTax)}</td>
          </tr>
          <tr>
            <td style={{ ...S.label, textAlign: 'right', padding: '10px 16px 3px' }}>Total Value of Service inclusive of Tax</td>
            <td style={{ textAlign: 'right', padding: '10px 16px 3px', fontWeight: 700, borderTop: '1px solid #000', borderBottom: '3px double #000' }}>
              {money(f.total)}
            </td>
          </tr>
        </tbody>
      </table>

      {!f.lines.length && (
        <div style={{ textAlign: 'center', fontStyle: 'italic', margin: '8px 0' }}>
          This invoice carries no taxed charges.
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <div style={S.label}>Amount In Words :</div>
        <div style={{ marginTop: 6 }}>PKR {inWords(f.total)}</div>
      </div>

      <div style={{ textAlign: 'right', fontWeight: 700, marginTop: 30 }}>For {comp.title}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 120, fontSize: 11 }}>
        {/* Printing Options' Hide Printed On / By leaves the page number alone. */}
        <span>{!hidePrintedBy && <>Printed On : {stamp.at ? moment(stamp.at).format('DD-MMM-YYYY') : ''}</>}</span>
        <span>{!hidePrintedBy && <>Printed By : {stamp.by}</>}</span>
        <span>Page 1</span>
      </div>
    </div>
  );
};

export default SaleTaxInvoicePrint;
