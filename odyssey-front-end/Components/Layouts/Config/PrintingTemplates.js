import React, { useEffect, useRef, useState } from 'react';
import { Alert, Collapse, Input, Select, Spin, Table } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { companyOptions, getCompany, companyBankAccounts, defaultBankAccount } from 'functions/companyBranding';
import { INVOICE_CATALOGUE } from 'functions/invoiceTemplateFields';
import { BL_CATALOGUE, AWB_CATALOGUE, BILL_OF_LADING, AIR_WAYBILL } from 'functions/blTemplateFields';
import { printFromTemplate } from 'functions/templatePrint';
import { confirmDelete } from 'Components/Shared/PopConfirm';
import { Section, SubHead } from './parts';

/* Configuration > Printing Templates - an invoice printed from the client's
 * own Word file (the user's design, 2026-10-28). Laid out in Word, with the
 * names below typed in {curly brackets} where the data goes; uploaded here for
 * a company (or all of them) and a document (or all of them). The most
 * specific one prints the invoice - on screen, emailed, both the same PDF.
 * None: the built-in layout. A job's Bill of Lading and Air Waybill print
 * from one too (2026-11-01) - documents of their own, with their own names -
 * so the screen is Printing Templates, not Invoice Templates (user, same day).
 *
 * Saving and removing are Seanet's, like every Configuration write; the server
 * refuses anyone else. */

const BASE = () => `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/printingTemplates`;
const ALL_DOCS = '*';
const EXAMPLE = '/printing-templates/ho-enterprises-invoice.docx';
// The built-in Sales Tax Invoice's layout, as a template to start from.
const STI_EXAMPLE = '/printing-templates/sales-tax-invoice.docx';
const BL_EXAMPLE = '/printing-templates/bill-of-lading.docx';
const AWB_EXAMPLE = '/printing-templates/air-waybill.docx';

// The names a document's template can use: a B/L's and an Air Waybill's are their own.
const catalogueFor = (docType) => (docType === BILL_OF_LADING ? BL_CATALOGUE
  : docType === AIR_WAYBILL ? AWB_CATALOGUE : INVOICE_CATALOGUE);
const isJobForm = (docType) => docType === BILL_OF_LADING || docType === AIR_WAYBILL;

const companyName = (id) => (id === null || id === undefined ? 'All companies' : (getCompany(id)?.title || `Company ${id}`));
// Every invoice and bill - not the Sales Tax Invoice, which is its own form.
const docName = (t) => (t === ALL_DOCS ? 'All invoices & bills' : t);
// What a template's document prints as, for the sentence when it is removed.
const printedAs = (t) => ({ [BILL_OF_LADING]: 'B/Ls', [AIR_WAYBILL]: 'air waybills', 'Sales Tax Invoice': 'sales tax invoices' }[t] || 'invoices');

const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const errorOf = (e, fallback) => {
  const data = e?.response?.data;
  return { message: data?.result || fallback, details: Array.isArray(data?.details) ? data.details : [] };
};

const Name = ({ children }) => <code style={{ background: '#f4f6f8', padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap' }}>{children}</code>;

const PrintingTemplates = () => {
  const [rows, setRows] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [docType, setDocType] = useState(ALL_DOCS);
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState(null);       // a refused upload
  const [unknown, setUnknown] = useState([]);         // names that are not fields
  const [previewFor, setPreviewFor] = useState({});   // template id -> invoice no
  const fileRef = useRef(null);

  const load = () => {
    setLoading(true);
    axiosClient.get(`${BASE()}/list`)
      .then(({ data }) => { setRows(data?.result || []); setDocTypes(data?.docTypes || []); })
      .catch(() => openNotification('Error', 'Could not load the printing templates.', 'red'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const save = async () => {
    if (!file) return;
    setSaving(true);
    setProblem(null);
    setUnknown([]);
    try {
      const { data } = await axiosClient.post(`${BASE()}/save`, {
        companyId: companyId === '' ? null : companyId,
        docType,
        fileName: file.name,
        content: await toBase64(file),
      });
      const notFields = catalogueFor(data?.result?.docType).unknownNames(data?.result?.tags);
      setUnknown(notFields);
      openNotification('Success', `${file.name} saved for ${companyName(data.result.companyId)}, ${docName(data.result.docType)}.`, 'green');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      load();
    } catch (e) {
      setProblem(errorOf(e, 'The template could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = (row) => confirmDelete({
    what: 'the template',
    name: row.fileName,
    okText: 'Remove',
    body: `${companyName(row.companyId)}, ${docName(row.docType)}: ${printedAs(row.docType)} will print from the next template that fits, or the built-in layout.`,
    onOk: async () => {
      try {
        await axiosClient.delete(`${BASE()}/${row.id}`);
        openNotification('Success', `${row.fileName} removed.`, 'green');
        load();
      } catch (e) {
        openNotification('Error', errorOf(e, 'Could not remove it.').message, 'red');
      }
    },
  });

  const download = async (row) => {
    try {
      const { data } = await axiosClient.get(`${BASE()}/${row.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = row.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (_) {
      openNotification('Error', 'Could not download it.', 'red');
    }
  };

  // A real invoice through this template - what it will print like.
  const preview = async (row) => {
    const no = String(previewFor[row.id] || '').trim();
    if (!no) { openNotification('Error', 'Type an invoice number to preview with.', 'red'); return; }
    try {
      const { data } = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_INVOICE_BY_NO, { headers: { invoiceno: no } });
      const invoice = data?.result?.resultOne || data?.result;
      if (!invoice?.id) { openNotification('Error', `No invoice ${no}.`, 'red'); return; }
      const company = getCompany(invoice.companyId);
      printFromTemplate(row, {
        invoice,
        records: invoice.Charge_Heads || [],
        company,
        bankAccount: defaultBankAccount(companyBankAccounts(invoice.companyId), invoice),
      });
    } catch (_) {
      openNotification('Error', `Could not load invoice ${no}.`, 'red');
    }
  };

  const columns = [
    { title: 'Company', dataIndex: 'companyId', render: companyName },
    { title: 'Document', dataIndex: 'docType', render: docName },
    { title: 'Word file', dataIndex: 'fileName' },
    { title: 'Saved', dataIndex: 'updatedAt', render: (v) => (v ? new Date(v).toLocaleString() : '') },
    { title: 'Preview with invoice', key: 'preview', render: (_, row) => (isJobForm(row.docType) ? (
      <span style={{ fontSize: 12, color: '#666' }}>Print a B/L from its Ref No&apos;s / Stamps tab</span>
    ) : (
      <span className='d-flex gap-2'>
        <Input size='small' style={{ width: 130 }} placeholder='Invoice No' value={previewFor[row.id] || ''}
          onChange={(e) => setPreviewFor((p) => ({ ...p, [row.id]: e.target.value }))}
          onPressEnter={() => preview(row)} />
        <button type='button' className='btn-custom px-2 py-0' onClick={() => preview(row)}>Preview</button>
      </span>
    )) },
    { title: '', key: 'actions', render: (_, row) => (
      <span className='d-flex gap-2'>
        <button type='button' className='btn-custom px-2 py-0' onClick={() => download(row)}>Download</button>
        <button type='button' className='btn-custom px-2 py-0' style={{ background: '#c0392b', borderColor: '#c0392b' }} onClick={() => remove(row)}>Remove</button>
      </span>
    ) },
  ];

  // The names of the document picked under "Add or replace".
  const catalogue = catalogueFor(docType);

  const fieldTable = (list) => (
    <Table size='small' pagination={false} rowKey={(r) => r[0]} dataSource={list}
      columns={[
        { title: 'Type in Word', render: (_, r) => <Name>{`{${r[0]}}`}</Name>, width: 240 },
        { title: 'What it is', render: (_, r) => r[1] },
        { title: 'Example', render: (_, r) => <span style={{ color: '#666' }}>{r[2]}</span> },
      ]} />
  );

  return (
    <Section title='Printing Templates'
      hint={'An invoice, a Bill of Lading or an Air Waybill can print from the client\'s own Word file: the layout is theirs, the data comes from Odyssey. '
        + 'With no template, each prints its built-in layout.'}>

      <div style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 900 }}>
        Lay the invoice out in Word and type the names below, in curly brackets, where the data goes - for
        example <Name>{'{invoiceNo}'}</Name> or <Name>{'{gdDate}'}</Name>. For the charges, put{' '}
        <Name>{'{#expenses}'}</Name> at the start of a table row and <Name>{'{/expenses}'}</Name> at its end: the
        row repeats once per charge. A part that only some invoices have goes between a condition&apos;s{' '}
        <Name>{'{#hasServiceCharges}'}</Name> and <Name>{'{/hasServiceCharges}'}</Name>. Save it as a Word
        Document (.docx) and upload it here; <b>Preview</b> shows a real invoice through it before anyone prints one.
        <div className='mt-2 d-flex flex-wrap gap-3'>
          <a href={EXAMPLE} download>Download an example - H.O Enterprises&apos; invoice</a>
          <a href={STI_EXAMPLE} download>Download an example - the Sales Tax Invoice</a>
          <a href={BL_EXAMPLE} download>Download an example - a Bill of Lading</a>
          <a href={AWB_EXAMPLE} download>Download an example - an Air Waybill</a>
        </div>
        <div className='mt-2'>
          A job&apos;s <b>Bill of Lading</b> (sea) and <b>Air Waybill</b> (air) print from a template saved for
          that document - with its own names, listed below when it is picked - from the B/L&apos;s Ref No&apos;s /
          Stamps tab. Each copy set under Copies (Original, Non-Negotiable) prints once, with{' '}
          <Name>{'{copyName}'}</Name> on it; for the containers or the AWB&apos;s items, put{' '}
          <Name>{'{#containers}'}</Name> … <Name>{'{/containers}'}</Name> or <Name>{'{#items}'}</Name> …{' '}
          <Name>{'{/items}'}</Name> around a table row.
        </div>
      </div>

      <SubHead style={{ marginTop: 20 }}>Templates</SubHead>
      {loading ? <Spin /> : (
        <Table size='small' rowKey='id' dataSource={rows} columns={columns} pagination={false}
          locale={{ emptyText: 'None - everything prints its built-in layout.' }} />
      )}

      <SubHead style={{ marginTop: 20 }}
        hint={'Saving for a company and document that already has one replaces it. The most specific template prints an invoice: its company and its document, then its company, then all companies. '
          + 'The Sales Tax Invoice (VAT Tax Invoice), the Bill of Lading and the Air Waybill print only from one saved for them - else their built-in layout.'}>
        Add or replace
      </SubHead>
      <div className='d-flex flex-wrap align-items-center gap-2'>
        <Select style={{ width: 220 }} value={companyId} onChange={setCompanyId}
          options={[{ value: '', label: 'All companies' }, ...companyOptions().map((o) => ({ value: String(o.value), label: o.label }))]} />
        <Select style={{ width: 200 }} value={docType} onChange={setDocType}
          options={[{ value: ALL_DOCS, label: docName(ALL_DOCS) }, ...docTypes.map((t) => ({ value: t, label: t }))]} />
        <input ref={fileRef} type='file' accept='.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          onChange={(e) => { setFile(e.target.files?.[0] || null); setProblem(null); }} />
        <button type='button' className='btn-custom px-3' onClick={save} disabled={!file || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {problem && (
        <Alert className='mt-3' type='error' showIcon message={problem.message}
          description={problem.details.length ? <ul className='mb-0'>{problem.details.map((d, i) => <li key={i}>{d}</li>)}</ul> : null} />
      )}
      {unknown.length > 0 && (
        <Alert className='mt-3' type='warning' showIcon
          message='Saved - but these names are not in the list below, so they will print nothing. Check the spelling:'
          description={<span>{unknown.map((n) => <Name key={n}>{n}</Name>).reduce((a, b) => [a, ', ', b])}</span>} />
      )}

      <SubHead style={{ marginTop: 24 }}>
        {isJobForm(docType) ? `The names a${docType === AIR_WAYBILL ? 'n' : ''} ${docType} template can use` : 'The names an invoice template can use'}
      </SubHead>
      <Collapse>
        {catalogue.fields.map((g) => (
          <Collapse.Panel key={g.group} header={g.group}>{fieldTable(g.fields)}</Collapse.Panel>
        ))}
        <Collapse.Panel key='lists' header='Lists - table rows that repeat'>
          {catalogue.lists.map((l) => (
            <div key={l.name} className='mb-3'>
              <div className='mb-1'><Name>{`{#${l.name}}`}</Name> … <Name>{`{/${l.name}}`}</Name> - {l.about}</div>
              {fieldTable(l.fields)}
            </div>
          ))}
        </Collapse.Panel>
        <Collapse.Panel key='conditions' header='Conditions - parts that print only sometimes'>
          <Table size='small' pagination={false} rowKey={(r) => r[0]} dataSource={catalogue.conditions}
            columns={[
              { title: 'Around the part', render: (_, r) => <span><Name>{`{#${r[0]}}`}</Name> … <Name>{`{/${r[0]}}`}</Name></span>, width: 360 },
              { title: 'Prints it when', render: (_, r) => r[1] },
            ]} />
        </Collapse.Panel>
      </Collapse>
    </Section>
  );
};

export default PrintingTemplates;
