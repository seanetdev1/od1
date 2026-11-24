import React from 'react';
import { Row, Col } from 'react-bootstrap';
import moment from 'moment';
import { clientInvoiceNo } from 'functions/customsJobReference';

/**
 * The party and job boxes of a CUSTOMS CLEARANCE invoice - what InvoicePrint
 * prints between the title and the charges in place of the freight job's.
 *
 * A clearance file has no MAWB/HAWB, flight, sailing, route or chargeable
 * weight, so those boxes are gone rather than printed blank, and the ones a
 * clearing agent's client reads the invoice by take their place:
 *
 *   M/S                    the invoiced party in full - name, address, NTN -
 *                          or the job's shipper, if Printing Options says so
 *   GD # / Form-E / MBL / Job Type / S/R Page #, on one line
 *   Client Invoice #       the client's own (commercial) invoice on the file
 *   GST Invoice #          the Sale Tax Invoice's number - see below
 *   Job No / Job Date      the customs job's own
 *   Terminal / Yard, No. of Packages, Description (the goods)
 *
 * GST Invoice # is read from the SAME record the Sale Tax Invoice prints
 * (invoice.Sales_Tax_Invoice, joined by both print routes), so the two
 * documents cannot show different numbers. Blank on an invoice with no taxed
 * line - it has no Sale Tax Invoice, and so no number.
 *
 * S/R Page # is the shipping register page, held in jobRef - the job screen
 * binds the field to it. "Hide Ref" on Printing Options leaves it off. It
 * prints under the install's name for it (Configuration > Customs, sent as
 * invoice.printSettings.referenceLabel; Essani's is "File Job Number").
 *
 * A Freight Forwarding job (Configuration > Customs) prints its HBL # where
 * the others print the Client Invoice # - as its job screen has it.
 *
 * Reads `invoice.customsJob` and `invoice.recipient`, both attached by the
 * server's attachPrintContext (routes/invoice), so the screen print and the
 * emailed PDF get the same. Laid out in the same bordered grid as the freight
 * header, so the two invoices still read as one document.
 */
const paraStyles = { lineHeight: 1.2, fontSize: 11 };
const heading = { lineHeight: 1, fontSize: 11, fontWeight: '800', paddingBottom: 5 };
const border = '1px solid black';

const date = (v) => (v && moment(v).isValid() ? moment(v).format('DD-MMM-YYYY') : '');
const present = (x) => x !== null && x !== undefined && String(x).trim() !== '';
const joined = (...xs) => xs.filter(present).join(' / ');

const Party = ({ title, party }) => (
  <>
    <div style={heading}>{title}</div>
    {party?.name && <div style={{ ...paraStyles, fontWeight: 700 }}>{party.name}</div>}
    {party?.address1 && <div style={paraStyles}>{party.address1}</div>}
    {party?.address2 && <div style={paraStyles}>{party.address2}</div>}
    {party?.ntn && <div style={paraStyles}>NTN # {party.ntn}</div>}
  </>
);

const Cell = ({ label, children, md, nowrap = false }) => (
  <Col md={md}>
    <div style={nowrap ? { ...heading, whiteSpace: 'nowrap' } : heading}>{label}</div>
    <div style={nowrap ? { ...paraStyles, whiteSpace: 'nowrap' } : paraStyles}>{children}</div>
  </Col>
);

// Label and value side by side, as the S/R Page # line has always printed.
const Inline = ({ label, children, md, className = 'p-0 px-1' }) => (
  <Col md={md} className={className}>
    <span style={heading}>{label}</span>
    <span style={{ ...paraStyles, paddingLeft: 8 }}>{children}</span>
  </Col>
);

const CustomsInvoiceHeader = ({ invoice, reference, shipperInMs = false }) => {
  const job = invoice?.customsJob || {};
  const recipient = invoice?.recipient || {};
  const packages = [job.packages, job.pkgUnit].filter(present).join(' ');
  const gstNo = invoice?.Sales_Tax_Invoice?.taxInvoiceNo || '';
  const referenceLabel = invoice?.printSettings?.referenceLabel || 'S/R Page #';
  const freightForwarding = job.jobType === 'Freight Forwarding';
  // M/S is the invoiced party, or - ticked on Printing Options - the job's
  // shipper, which some clearing clients want their invoice addressed to.
  const msParty = shipperInMs && job.shipper?.name
    ? job.shipper
    : { ...recipient, name: recipient.name || invoice?.party_Name };

  return (
    <>
      <Row style={{ paddingLeft: 12, paddingRight: 12 }}>
        <Col md={12} style={{ border }} className='p-0 px-1'>
          <Party title='M/S' party={msParty} />
        </Col>
      </Row>
      <Row style={{ paddingLeft: 12, paddingRight: 12 }}>
        <Col md={12} style={{ borderRight: border, borderLeft: border, borderBottom: border }} className='p-0'>
          <Row className='mx-0'>
            {/* On a clearing file the GD number is sometimes only in the file
                number - the same figure, filled in the other box. A GD number
                is short, so it takes only the room it needs and Form-E / MBL
                the rest of the left half: in a quarter, a Form-E number like
                HMB-EXP-072302-29-09-2026 wrapped onto a second line. */}
            <Inline md='auto' className='p-0 ps-1 pe-3' label='GD #:'>{job.gdNumber || job.customFileNo || ''}</Inline>
            {/* Form-E on an export, the master B/L on an import; a file that
                has both prints both. */}
            <Inline md label='Form-E / MBL:'>{joined(job.formENo, job.mblNo)}</Inline>
            <Inline md={3} label='Job Type:'>{job.jobType || ''}</Inline>
            {/* Hidden, its quarter stays empty: Job Type keeps its place over
                Job No, rather than Form-E / MBL stretching it to the edge. */}
            {reference ? <Col md={3} /> : <Inline md={3} label={`${referenceLabel}:`}>{job.jobRef || job.regPageNo || ''}</Inline>}
          </Row>
        </Col>
      </Row>
      {/* No rule under this row: Client Invoice # / No. of Packages and
          Job No / Invoice No read as one box per side. */}
      <Row style={{ paddingLeft: 12, paddingRight: 12 }}>
        <Col md={6} style={{ borderRight: border, borderLeft: border }} className='p-1'>
          <Row>
            {freightForwarding
              ? <Cell md={7} label='HBL #'>{job.blNo || ''}</Cell>
              : <Cell md={7} label='Client Invoice #'>{clientInvoiceNo(job)}</Cell>}
            <Cell md={5} label='GST Invoice #'>{gstNo}</Cell>
          </Row>
        </Col>
        <Col md={6} style={{ borderRight: border }} className='p-1'>
          <Row>
            <Cell md={7} label='Job No'>{job.jobNo || ''}</Cell>
            <Cell md={5} label='Job Date'>{date(job.jobDate)}</Cell>
          </Row>
        </Col>
      </Row>
      <Row style={{ paddingLeft: 12, paddingRight: 12 }}>
        <Col md={6} style={{ borderRight: border, borderLeft: border, borderBottom: border }} className='p-1'>
          <Row>
            <Cell md={3} label='Terminal / Yard'>{job.terminal || ''}</Cell>
            {/* Held to one line, so "No. of Packages" and "718 CARTONS" each
                print on a single line. */}
            <Cell md={4} label='No. of Packages' nowrap>{packages}</Cell>
            <Cell md={5} label='Description'>{job.goodsDescription || ''}</Cell>
          </Row>
        </Col>
        <Col md={6} style={{ borderRight: border, borderBottom: border }} className='p-1'>
          <Row>
            <Cell md={7} label='Invoice No'>{invoice?.invoice_No}</Cell>
            <Cell md={5} label='Invoice Date'>{date(invoice?.createdAt)}</Cell>
          </Row>
        </Col>
      </Row>
    </>
  );
};

export default CustomsInvoiceHeader;
