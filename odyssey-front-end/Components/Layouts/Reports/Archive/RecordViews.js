import React from 'react';
import { Descriptions, Table, Tag } from 'antd';
import { showDate, money } from './shared';

// The three things a row in the archive opens: a job, an invoice or bill, and
// a voucher - each with links to the records around it (a job's invoices, an
// invoice's voucher, a voucher line's ledger). Read-only throughout.

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '' && v !== 0;

/** A link to another archive record. */
export const Go = ({ onClick, children }) => (
  <button type='button' className='archive-link' onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
);

/** Descriptions with the empty fields left out - a Climax job has 160 columns and most are blank. */
const Fields = ({ title, items, column = 3 }) => {
  const shown = items.filter(([, v]) => has(v));
  if (!shown.length) return null;
  return (
    <Descriptions title={title} size='small' bordered column={column} className='archive-fields'>
      {shown.map(([label, value, span]) => (
        <Descriptions.Item key={label} label={label} span={span || 1}>{value}</Descriptions.Item>
      ))}
    </Descriptions>
  );
};

const Section = ({ title, count, children }) => (
  <div className='archive-section'>
    <div className='archive-section-title'>{title}{count !== undefined && <span className='grey-txt'> ({count})</span>}</div>
    {children}
  </div>
);

const stamp = (s) => [s?.by, s?.on].filter(Boolean).join(' - ');
const fig = (v) => money(v);

// ----------------------------------------------------------------- job

export const JobView = ({ job, onOpen, onLedger }) => {
  const p = job.parties || {};
  const customer = p.customer || {};
  const mix = job.containerMix || {};
  const mixText = [['20\'', mix.c20], ['40\'', mix.c40], ['45\'', mix.c45], ['LCL', mix.lcl]]
    .filter(([, n]) => n > 0).map(([s, n]) => `${n} x ${s}`).join(', ');

  const chargeColumns = (side) => [
    { title: '#', dataIndex: 'sno', width: 40 },
    { title: 'Charge', dataIndex: 'charge', width: 180 },
    { title: 'Remarks', dataIndex: 'remarks' },
    { title: side === 'receivable' ? 'Billed to' : 'Payable to', dataIndex: 'party', width: 190 },
    { title: 'Qty', dataIndex: 'qty', width: 60, align: 'right' },
    { title: 'Rate', dataIndex: 'rate', width: 95, align: 'right', render: fig },
    { title: 'Amount', dataIndex: 'amount', width: 110, align: 'right', render: fig },
    side === 'receivable'
      ? { title: 'Invoice', dataIndex: 'invoiceNo', width: 100,
          render: (v, r) => (r.invoiceId ? <Go onClick={() => onOpen({ kind: 'invoice', id: r.invoiceId, label: v })}>{v}</Go> : '') }
      : { title: 'Bill', dataIndex: 'billNo', width: 100,
          render: (v, r) => (r.billId ? <Go onClick={() => onOpen({ kind: 'bill', id: r.billId, label: v })}>{v}</Go> : '') },
  ];
  const chargeTotal = (rows) => money(rows.reduce((t, r) => t + (Number(r.amount) || 0), 0));
  const voucherLink = (r) => (r.tranNo
    ? <Go onClick={() => onOpen({ kind: 'voucher', id: r.tranNo, label: r.voucherNo })}>{r.voucherNo || 'Voucher'}</Go> : '');

  return (
    <div>
      <Fields title='Job' items={[
        ['Job No', <b key='n'>{job.jobNo}</b>],
        ['Job Date', showDate(job.jobDate)],
        ['Status', [job.status, job.process].filter(Boolean).join(' - ')],
        ['Mode', [job.direction, job.mode].filter(Boolean).join(' ')],
        ['Activity', job.activity],
        ['Customs Stage', job.stage],
        ['Cargo Type', job.cargoType],
        ['Container Type', job.containerType],
        ['Client Ref', job.clientRef],
        ['Project Ref', job.projectRef],
        ['Convoy No', job.convoyNo],
      ]} />
      <Fields title='Parties' items={[
        ['Customer', customer.name ? (
          <span key='c'>
            {customer.name}
            {customer.accountId && <> {' '}<Go onClick={() => onLedger({ id: customer.accountId, name: customer.name })}>Ledger</Go></>}
          </span>
        ) : '', 2],
        ['Customer NTN / STRN', [customer.ntn, customer.strn].filter(Boolean).join(' / ')],
        ['Consignee', p.consignee?.name],
        ['Shipper', p.shipper?.name],
        ['Notify Party', p.notifyParty],
        ['Clearing Agent', p.clearingAgent],
        ['Transporter', p.transporter],
        ['Forwarder', p.forwarder],
        ['Shipping Line', p.shippingLine],
        ['Shipping Agent', p.shippingAgent],
        ['Terminal / Yard', p.terminal],
        ['Sales Person', p.salesPerson],
        ['Border Agent', p.borderAgent],
      ]} />
      <Fields title='Shipment' items={[
        ['HBL / HAWB', job.hbl],
        ['MBL / MAWB', job.mbl],
        ['B/L Date', showDate(job.blDate)],
        ['Vessel / Flight', [job.vessel, job.voyage].filter(Boolean).join(' / ')],
        ['Arrival / Sailing', showDate(job.arrivalOrSailing)],
        ['Port of Loading', job.pol],
        ['Port of Discharge', job.pod],
        ['Final Destination', job.finalDestination],
        ['IGM / EGM', [job.igm, showDate(job.igmDate)].filter(Boolean).join(' - ')],
        ['Index No', job.indexNo],
        ['Packages', [job.packages, job.packageType].filter(Boolean).join(' ')],
        ['Weight', has(job.weight) ? money(job.weight) : ''],
        ['Gross Weight', has(job.grossWeight) ? money(job.grossWeight) : ''],
        ['Containers', [job.containerCount ? String(job.containerCount) : '', mixText].filter(Boolean).join(' - ')],
        ['Container Nos', job.containerString, 3],
        ['Goods', job.goodsDescription, 3],
        ['Marks', job.marks, 3],
        ['Remarks', job.remarks, 3],
      ]} />
      <Fields title='Customs & Dates' items={[
        ['GD No', job.gdNo],
        ['GD Date', showDate(job.gdDate)],
        ['File No', job.customFileNo],
        ['Form-E', [job.formENo, showDate(job.formEDate)].filter(Boolean).join(' - ')],
        ['Shipping Bill', [job.shippingBillNo, showDate(job.shippingBillDate)].filter(Boolean).join(' - ')],
        ['LC No', job.lcNo],
        ['Commercial Invoice', job.commercialInvoiceNo],
        ['Import Value', has(job.importValue) ? money(job.importValue) : ''],
        ['VIR No', job.virNo],
        ['DO Date', showDate(job.doDate)],
        ['Gate Pass', showDate(job.gatePassDate)],
        ['Delivery', showDate(job.deliveryDate)],
        ['Completed', showDate(job.completedDate)],
        ['Empty Returned', showDate(job.emptyReturnDate)],
        ['Free Days', job.freeDays],
        ['Pick-up', job.pickupAddress, 3],
        ['Delivery Address', job.deliveryAddress, 3],
      ]} />

      {job.containers?.length > 0 && (
        <Section title='Containers' count={job.containers.length}>
          <Table size='small' bordered pagination={false} rowKey={(r, i) => `${r.sno}-${i}`} dataSource={job.containers}
            columns={[
              { title: '#', dataIndex: 'sno', width: 40 },
              { title: 'Container', dataIndex: 'containerNo', width: 130 },
              { title: 'Size / Type', render: (_, r) => [r.size, r.type].filter(Boolean).join(' '), width: 100 },
              { title: 'Seal', dataIndex: 'seal', width: 110 },
              { title: 'Truck', dataIndex: 'truck', width: 110 },
              { title: 'Driver', render: (_, r) => [r.driver, r.driverCell].filter(Boolean).join(' - ') },
              { title: 'Bilty', dataIndex: 'biltyNo', width: 90 },
              { title: 'Transporter', dataIndex: 'transporter' },
              { title: 'Gross Wt', dataIndex: 'grossWeight', width: 90, align: 'right', render: (v) => (v ? money(v) : '') },
              { title: 'Port Out', dataIndex: 'portOut', width: 100, render: showDate },
            ]} />
        </Section>
      )}
      <Section title='Receivable Charges' count={job.receivable?.length || 0}>
        <Table size='small' bordered pagination={false} rowKey='rowId' dataSource={job.receivable || []}
          columns={chargeColumns('receivable')}
          summary={(rows) => rows.length > 0 && (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6} align='right'><b>Total</b></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align='right'><b>{chargeTotal(rows)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={7} />
            </Table.Summary.Row>
          )} />
      </Section>
      <Section title='Payable Charges' count={job.payable?.length || 0}>
        <Table size='small' bordered pagination={false} rowKey='rowId' dataSource={job.payable || []}
          columns={chargeColumns('payable')}
          summary={(rows) => rows.length > 0 && (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6} align='right'><b>Total</b></Table.Summary.Cell>
              <Table.Summary.Cell index={6} align='right'><b>{chargeTotal(rows)}</b></Table.Summary.Cell>
              <Table.Summary.Cell index={7} />
            </Table.Summary.Row>
          )} />
      </Section>
      <Section title='Invoices' count={job.invoices?.length || 0}>
        <Table size='small' bordered pagination={false} rowKey='id' dataSource={job.invoices || []}
          columns={[
            { title: 'Invoice No', dataIndex: 'invoiceNo', width: 110,
              render: (v, r) => <Go onClick={() => onOpen({ kind: 'invoice', id: r.id, label: v })}>{v}</Go> },
            { title: 'Date', dataIndex: 'invoiceDate', width: 105, render: showDate },
            { title: 'Kind', dataIndex: 'kind', width: 95 },
            { title: 'Party', dataIndex: 'party' },
            { title: 'GST Inv', dataIndex: 'gstNo', width: 95 },
            { title: 'Sales Tax', dataIndex: 'tax', width: 100, align: 'right', render: fig },
            { title: 'Amount', dataIndex: 'net', width: 110, align: 'right', render: fig },
            { title: 'Voucher', width: 110, render: (_, r) => voucherLink(r) },
            { title: '', dataIndex: 'isVoid', width: 55, render: (v) => (v ? <Tag color='red'>Void</Tag> : null) },
          ]} />
      </Section>
      <Section title='Bills' count={job.bills?.length || 0}>
        <Table size='small' bordered pagination={false} rowKey='id' dataSource={job.bills || []}
          columns={[
            { title: 'Bill No', dataIndex: 'billNo', width: 110,
              render: (v, r) => <Go onClick={() => onOpen({ kind: 'bill', id: r.id, label: v })}>{v}</Go> },
            { title: 'Date', dataIndex: 'billDate', width: 105, render: showDate },
            { title: 'Vendor / Account', dataIndex: 'party' },
            { title: 'Vendor Bill', dataIndex: 'vendorBillNo', width: 110 },
            { title: 'Amount', dataIndex: 'net', width: 110, align: 'right', render: fig },
            { title: 'Voucher', width: 110, render: (_, r) => voucherLink(r) },
            { title: '', dataIndex: 'isVoid', width: 55, render: (v) => (v ? <Tag color='red'>Void</Tag> : null) },
          ]} />
      </Section>
      <div className='archive-stamp grey-txt'>
        {stamp(job.created) && <>Created: {stamp(job.created)}</>}
        {stamp(job.edited) && <>{'   '}Edited: {stamp(job.edited)}</>}
      </div>
    </div>
  );
};

// ------------------------------------------------------- invoice / bill

export const DocumentView = ({ doc, onOpen }) => {
  const isBill = doc.side === 'bill';
  const job = doc.job;
  const voucherGo = (v) => (v ? <Go onClick={() => onOpen({ kind: 'voucher', id: v.tranNo, label: v.voucherNo })}>{v.voucherNo || 'Voucher'}</Go> : '');
  const lineTotal = (r) => (Number(r.amount) || 0) + (Number(r.tax) || 0);

  return (
    <div>
      {doc.isVoid && <div className='archive-void'>This {isBill ? 'bill' : 'invoice'} is VOID in Climax.</div>}
      <Fields title={doc.kind} items={[
        [isBill ? 'Bill No' : 'Invoice No', <b key='n'>{doc.number}</b>],
        ['Date', showDate(doc.date)],
        ['Job', job ? <Go key='j' onClick={() => onOpen({ kind: 'job', id: job.id, label: job.jobNo })}>{job.jobNo}</Go> : ''],
        [isBill ? 'Vendor / Account' : 'Party', doc.party?.name, 2],
        ['NTN / STRN', [doc.party?.ntn, doc.party?.strn].filter(Boolean).join(' / ')],
        ['Address', doc.party?.address, 3],
        ['GST Invoice', doc.gstNo],
        ['Master Invoice', doc.masterInvoiceNo],
        ['Vendor\'s Bill No', doc.vendorBillNo],
        ['Pay To', doc.payTo],
        ['Cheque', [doc.chequeNo, showDate(doc.chequeDate)].filter(Boolean).join(' - ')],
        ['Due Date', [showDate(doc.dueDate), has(doc.creditDays) ? `${doc.creditDays} days` : ''].filter(Boolean).join(' - ')],
        ['Voucher', voucherGo(doc.voucher)],
        ['Settled By', voucherGo(doc.settlement)],
        ['Remarks', doc.remarks, 3],
        ['Created', stamp(doc.created)],
        ['Edited', stamp(doc.edited)],
      ]} />
      <Section title='Lines' count={doc.lines?.length || 0}>
        <Table size='small' bordered pagination={false} rowKey='rowId' dataSource={doc.lines || []}
          columns={[
            { title: '#', width: 40, render: (_, __, i) => i + 1 },
            { title: 'Charge', dataIndex: 'charge', width: 190 },
            { title: 'Description', dataIndex: 'remarks' },
            { title: 'Vehicle', dataIndex: 'vehicle', width: 100 },
            { title: 'Qty', dataIndex: 'qty', width: 60, align: 'right' },
            { title: 'Rate', dataIndex: 'rate', width: 95, align: 'right', render: fig },
            { title: 'Amount', dataIndex: 'amount', width: 105, align: 'right', render: fig },
            ...(isBill ? [] : [
              { title: 'Tax %', dataIndex: 'taxPerc', width: 60, align: 'right', render: (v) => (v ? v : '') },
              { title: 'Tax', dataIndex: 'tax', width: 90, align: 'right', render: fig },
            ]),
            { title: 'Total', width: 110, align: 'right', render: (_, r) => money(lineTotal(r)) },
          ]} />
      </Section>
      <div className='archive-totals'>
        <div><span>Total</span><b>{money(doc.total)}</b></div>
        {has(doc.discount) && <div><span>Discount</span><b>{money(doc.discount)}</b></div>}
        {!isBill && <div><span>Sales Tax</span><b>{money(doc.tax)}</b></div>}
        <div className='accent'><span>Net</span><b>{money(doc.net)}</b></div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------- voucher

export const VoucherView = ({ voucher: v, onOpen, onLedger }) => (
  <div>
    {v.isVoid && <div className='archive-void'>This voucher is VOID in Climax - its lines are at zero.</div>}
    <Fields title={v.typeName || 'Voucher'} items={[
      ['Voucher No', <b key='n'>{v.voucherNo}</b>],
      ['Date', showDate(v.date)],
      ['Entered On', showDate(v.entryDate)],
      ['Account', v.headAccount?.name],
      ['Party Account', v.partyAccount?.name],
      ['Cheque', [v.chequeNo, showDate(v.chequeDate)].filter(Boolean).join(' - ')],
      ['Pay To', v.payTo],
      ['Received By', v.receivedBy],
      ['Reference', v.refNo],
      ['Narration', v.narration, 3],
      ['Approved', v.approved?.by ? stamp(v.approved) : ''],
      ['Created', stamp(v.created)],
      ['Edited', stamp(v.edited)],
      ['Climax No', v.tranNo],
    ]} />
    {v.links?.length > 0 && (
      <div className='archive-links'>
        {v.links.map((l) => (
          <span key={`${l.side}-${l.id}-${l.role}`}>
            {l.role === 'posted' ? 'Posts' : 'Settles'} {l.side}{' '}
            <Go onClick={() => onOpen({ kind: l.side, id: l.id, label: l.number })}>{l.number}</Go>
          </span>
        ))}
      </div>
    )}
    <Section title='Lines' count={v.lines?.length || 0}>
      <Table size='small' bordered pagination={false} rowKey={(r, i) => `${r.sno}-${i}`} dataSource={v.lines || []}
        columns={[
          { title: '#', width: 40, render: (_, __, i) => i + 1 },
          { title: 'Code', dataIndex: 'accountCode', width: 90 },
          { title: 'Account', dataIndex: 'accountName', width: 220,
            render: (name, r) => (r.accountId ? <Go onClick={() => onLedger({ id: r.accountId, name })}>{name}</Go> : name) },
          { title: 'Narration', dataIndex: 'narration' },
          { title: 'Job', dataIndex: 'jobNo', width: 100 },
          { title: 'Cost Centre', dataIndex: 'costCentre', width: 110 },
          { title: 'Debit', dataIndex: 'debit', width: 115, align: 'right', render: (x) => (x ? money(x) : '') },
          { title: 'Credit', dataIndex: 'credit', width: 115, align: 'right', render: (x) => (x ? money(x) : '') },
        ]}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={6} align='right'><b>Total</b></Table.Summary.Cell>
            <Table.Summary.Cell index={6} align='right'><b>{money(v.totals?.debit)}</b></Table.Summary.Cell>
            <Table.Summary.Cell index={7} align='right'><b>{money(v.totals?.credit)}</b></Table.Summary.Cell>
          </Table.Summary.Row>
        )} />
    </Section>
  </div>
);
