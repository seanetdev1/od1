import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Table, DatePicker, Spin, Select, InputNumber, Input } from 'antd';
import { Row, Col } from 'react-bootstrap';
import moment from 'moment';
import ReactToPrint from 'react-to-print';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { usePageActions } from 'Components/Shared/PageActions';
import { reportCompanyOptions, allCompanies } from 'functions/companyBranding';
import {
  asOnText, cutOffText, statementTitle, statementSections,
  buildAgentStatementWorkbook, agentStatementFileName, MANUAL_HEADING,
} from 'functions/agentStatementExcel';

// THE INTERNATIONAL REPORT - the accounts team's "International Report Recd &
// Pay": every overseas agent we owe and every one owing us, as on a date - an
// approximation, each agent's foreign currencies added as they stand (USD
// 1,000 + GBP 200 = 1,200), as the team's workbook adds them. Built on the
// server from each agent's ledger (routes/misc/agentStatement,
// functions/agentStatement), so a receipt not yet knocked off an invoice
// already counts - the deduction the team used to make by hand.
//
// Laid out as their workbook: the payables, a typed-in section (agents kept
// outside these books - theirs was another company's), then the receivables,
// each with its total. The typed-in section is kept on the server, so it is
// there the next time. Remarks are left to the Excel copy: the report keeps
// none.

const DAY = 'YYYY-MM-DD';
const money = (v) => Math.abs(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// As the workbook shows an amount: what we owe red, in brackets.
const Amount = ({ value }) => (Number(value) < 0
  ? <span className='neg'>({money(value)})</span>
  : <span>{money(value)}</span>);

const emptyLine = () => ({ agent: '', amount: null });

const AgentStatement = () => {
  const [asOn, setAsOn] = useState(() => moment());
  // The cut-off: invoices and bills dated before it are left out. None = all.
  const [from, setFrom] = useState(null);
  const [company, setCompany] = useState('all');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState({ title: '', lines: [] });
  const [draft, setDraft] = useState(null);           // the typed-in section, while being edited
  const [saving, setSaving] = useState(false);
  const printRef = useRef(null);
  const printTriggerRef = useRef(null);

  const run = useCallback(async () => {
    if (!asOn?.isValid()) return;
    setLoading(true);
    try {
      const { data } = await axiosClient.get('/misc/agentStatement', {
        headers: { ason: asOn.format(DAY), from: from?.isValid() ? from.format(DAY) : '', company: String(company) },
      });
      if (data?.status !== 'success') throw new Error(data?.result);
      setReport(data.result);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not build the report.', 'red');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [asOn, from, company]);

  // Today's, for all companies, straight away; and the typed-in section.
  useEffect(() => {
    run();
    axiosClient.get('/misc/agentStatement/manual')
      .then(({ data }) => { if (data?.status === 'success') setManual(data.result); })
      .catch(() => { /* none yet */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = statementTitle(allCompanies(), report?.company ?? company);
  const sections = statementSections(report, manual);
  const payables = sections[0];
  const receivables = sections[sections.length - 1];
  const typed = sections.find((s) => s.key === 'manual');

  const exportExcel = async () => {
    if (!report) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = buildAgentStatementWorkbook(ExcelJS, { report, manual, title });
      const buffer = await wb.xlsx.writeBuffer();
      const url = window.URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = agentStatementFileName(report);
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      openNotification('Error', 'Could not export the report.', 'red');
    }
  };

  usePageActions({
    title: 'International Report',
    subtitle: report
      ? `Agents payable & receivable as on ${asOnText(report.asOn)}${report.from ? ` - ${cutOffText(report)}` : ''}`
      : undefined,
    print: {
      onClick: () => printTriggerRef.current?.click(),
      disabled: !report,
      title: report ? 'Print the report' : 'Show a date first',
    },
    excel: {
      onClick: exportExcel,
      disabled: !report,
      title: report ? 'Export to Excel, with a Remarks column to fill in' : 'Show a date first',
    },
  }, [report, manual, title]);

  /* THE TYPED-IN SECTION: its heading and lines, edited here and saved. */
  const saveManual = async () => {
    setSaving(true);
    try {
      const lines = draft.lines.filter((l) => (l.agent || '').trim() || (l.amount !== null && l.amount !== ''));
      const { data } = await axiosClient.post('/misc/agentStatement/manual', { title: draft.title, lines });
      if (data?.status !== 'success') throw new Error(data?.result);
      setManual(data.result);
      setDraft(null);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save the section.', 'red');
    } finally {
      setSaving(false);
    }
  };
  const editLine = (i, patch) => setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const startEdit = () => setDraft({
    title: manual.title || '',
    lines: manual.lines?.length ? manual.lines.map((l) => ({ ...l })) : [emptyLine()],
  });

  const manualEditor = draft && (
    <div className='as-editor'>
      <Input
        value={draft.title}
        maxLength={150}
        placeholder={`Heading - e.g. another company's name (blank: ${MANUAL_HEADING})`}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
      />
      {draft.lines.map((l, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div className='as-edit-line' key={i}>
          <Input value={l.agent} maxLength={150} placeholder='Agent' onChange={(e) => editLine(i, { agent: e.target.value })} />
          <InputNumber
            value={l.amount}
            placeholder='Amount'
            precision={2}
            style={{ width: 170 }}
            onChange={(v) => editLine(i, { amount: v })}
          />
          <button type='button' className='btn btn-link btn-sm' title='Remove this line'
            onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))}>Remove</button>
        </div>
      ))}
      <div className='d-flex justify-content-between mt-2'>
        <button type='button' className='btn btn-link btn-sm p-0'
          disabled={draft.lines.length >= 100}
          onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, emptyLine()] }))}>+ Add line</button>
        <div className='d-flex' style={{ gap: '0.5rem' }}>
          <button type='button' className='btn-custom' onClick={() => setDraft(null)} disabled={saving}>Cancel</button>
          <button type='button' className='btn-custom' onClick={saveManual} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      <p className='grey-txt mt-2 mb-0' style={{ fontSize: 12 }}>
        Negative what we owe, positive what is owed to us. Kept for the next time the report is run.
      </p>
    </div>
  );

  const columns = [
    { title: 'Agent', dataIndex: 'agent', key: 'agent' },
    { title: 'Amount', dataIndex: 'amount', key: 'amount', width: 170, align: 'right', render: (v) => <Amount value={v} /> },
  ];

  const sectionTable = (s) => (
    <Table
      rowKey='rowKey'
      size='small'
      bordered
      dataSource={s.lines.map((l, i) => ({ ...l, rowKey: l.accountId ?? `line-${i}` }))}
      columns={columns}
      pagination={false}
      locale={{ emptyText: 'None as on this date.' }}
      summary={() => (
        <Table.Summary>
          <Table.Summary.Row className='as-total'>
            <Table.Summary.Cell index={0}><b>TOTAL</b></Table.Summary.Cell>
            <Table.Summary.Cell index={1} align='right'><b><Amount value={s.total} /></b></Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
      )}
    />
  );

  const cols =<colgroup><col style={{ width: '42%' }} /><col style={{ width: '18%' }} /><col style={{ width: '40%' }} /></colgroup>;

  return (
    <div className='client-styles agent-statement'>
      <Row className='align-items-center mb-3'>
        <Col md={12} className='d-flex justify-content-end align-items-center flex-wrap' style={{ gap: '0.5rem' }}>
          <span className='grey-txt' title='Invoices and bills dated before this are left out. Empty: all of them.'>From</span>
          <DatePicker
            value={from}
            onChange={setFrom}
            format='DD-MM-YYYY'
            placeholder='No cut-off'
            disabledDate={(d) => Boolean(asOn) && d.isAfter(asOn, 'day')}
          />
          <span className='grey-txt'>As on</span>
          <DatePicker
            value={asOn}
            onChange={setAsOn}
            format='DD-MM-YYYY'
            allowClear={false}
          />
          <Select
            style={{ width: 230 }}
            className='select-modern'
            value={company}
            onChange={setCompany}
            options={reportCompanyOptions()}
          />
          <button type='button' className='btn-custom' onClick={run} disabled={loading || !asOn}>
            {loading ? 'Building…' : 'Show'}
          </button>
        </Col>
      </Row>

      {loading && <div className='text-center py-5'><Spin /></div>}

      {!loading && report && (
        <>
          <div className='as-summary'>
            <div className='fig'><span>We owe agents</span><b><Amount value={report.totals.payable} /></b></div>
            <div className='fig'><span>Agents owe us</span><b>{money(report.totals.receivable)}</b></div>
            <div className='fig'><span>Agents</span><b>{report.payables.length + report.receivables.length}</b></div>
          </div>

          <div className='as-section'>
            <h6>{payables.heading}</h6>
            {sectionTable(payables)}
          </div>

          {/* Agents kept outside these books, typed in - between the two, as
              the workbook had another company's. */}
          <div className='as-section as-manual'>
            <div className='d-flex justify-content-between align-items-center'>
              <h6>{typed ? typed.heading : 'Agents outside these books'}</h6>
              {!draft && (
                <button type='button' className='btn btn-link btn-sm p-0' onClick={startEdit}>
                  {typed ? 'Edit' : 'Add'}
                </button>
              )}
            </div>
            {draft ? manualEditor : typed ? sectionTable(typed) : (
              <p className='grey-txt mb-0' style={{ fontSize: 12 }}>
                None. Add any agents kept outside these books - another company&apos;s, say - to show them between the payables and the receivables.
              </p>
            )}
          </div>

          <div className='as-section'>
            <h6>{receivables.heading}</h6>
            {sectionTable(receivables)}
          </div>
        </>
      )}

      {!loading && !report && <p className='grey-txt'>Pick a date and press Show.</p>}

      {/* The printed copy, laid out as the team's workbook. ReactToPrint
          clones a live node, so its trigger stays mounted and hidden; the
          toolbar's Print clicks it. */}
      <ReactToPrint
        content={() => printRef.current}
        trigger={() => <button type='button' ref={printTriggerRef} style={{ display: 'none' }} aria-hidden='true' />}
      />
      <div style={{ position: 'absolute', left: '-10000px', top: 0 }} aria-hidden='true'>
        <div ref={printRef} className='as-print'>
          {/* BUILT FOR MARGINS: NONE, as every print here is - A4 portrait, a
              page of its own, the border its own padding. */}
          <style>{`
            @media print {
              @page agentStatement { size: A4 portrait; margin: 0; }
              .as-print { page: agentStatement; }
            }
          `}</style>
          {report && sections.map((s) => (
            <div key={s.key} className={`block ${s.key}`}>
              <table className='banners'>
                {cols}
                <tbody>
                  {s.key !== 'manual' && <tr><th colSpan={3}>{title}</th></tr>}
                  <tr><th colSpan={3}>{s.heading}</th></tr>
                  {s.key !== 'manual' && (
                    <tr className='ason'>
                      <th className='left'>
                        {[s.key === 'receivables' && 'Current Receivable', cutOffText(report)].filter(Boolean).join(' - ')}
                      </th>
                      <th>As on</th>
                      <th>{moment(report.asOn, DAY).format('D-MMM-YY')}</th>
                    </tr>
                  )}
                </tbody>
              </table>
              <table className='lines'>
                {cols}
                <thead>
                  <tr><th className='left'>Agent</th><th>Amount</th><th>Remarks</th></tr>
                </thead>
                <tbody>
                  {s.lines.map((l, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <tr key={`${l.accountId ?? 'm'}-${i}`}>
                      <td>{l.agent}</td>
                      <td className='num'><Amount value={l.amount} /></td>
                      <td />
                    </tr>
                  ))}
                  <tr className='total'>
                    <td>TOTAL</td>
                    <td className='num'><Amount value={s.total} /></td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .agent-statement { max-width: 100%; overflow-x: hidden; }
        .agent-statement .ant-table { font-size: 12px; }
        .agent-statement .neg { color: #cf1322; }
        .agent-statement .as-summary {
          display: flex; align-items: center; gap: 26px; flex-wrap: wrap;
          padding: 12px 16px; margin-bottom: 12px;
          border: 1px solid #eee; border-radius: 8px; background: #fcfcfc;
        }
        .agent-statement .as-summary .fig { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
        .agent-statement .as-summary .fig > span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #999; }
        .agent-statement .as-summary .fig b { font-size: 17px; }
        .agent-statement .as-section { margin-bottom: 18px; max-width: 760px; }
        .agent-statement .as-section h6 { font-weight: 700; margin: 0 0 6px; }
        .agent-statement .as-editor { border: 1px solid #eee; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
        .agent-statement .as-edit-line { display: flex; gap: 6px; align-items: center; }
        .agent-statement .as-edit-line .ant-input { flex: 1; }
        /* The page is 210mm across with no margin; the border is padding. */
        .as-print {
          font-family: Arial, sans-serif; font-size: 10px; color: #000;
          width: 210mm; box-sizing: border-box; padding: 10mm 10mm 12mm;
        }
        .as-print table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .as-print .block { margin-bottom: 6mm; }
        /* The lines' table runs on from the headings', on the same rule. */
        .as-print table.lines { margin-top: -1px; }
        .as-print th, .as-print td { border: 1px solid #000; padding: 2px 5px; vertical-align: middle; }
        .as-print th { font-size: 11px; font-weight: 700; text-align: center; }
        .as-print th.left { text-align: left; }
        .as-print tr.ason th:first-child:empty { border-left-color: transparent; border-bottom-color: transparent; }
        .as-print td { font-size: 9px; overflow-wrap: break-word; }
        .as-print td.num { text-align: right; font-variant-numeric: tabular-nums; }
        .as-print .neg { color: #c00; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .as-print tr.total td { font-weight: 700; font-size: 10px; }
        .as-print thead { display: table-header-group; }
        .as-print tr { page-break-inside: avoid; }
      `}</style>
    </div>
  );
};

export default AgentStatement;
