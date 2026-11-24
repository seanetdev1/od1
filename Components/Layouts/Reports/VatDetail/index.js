import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Table, DatePicker, Spin, Popover, Checkbox } from 'antd';
import { Row, Col } from 'react-bootstrap';
import { useSelector } from 'react-redux';
import moment from 'moment';
import ReactToPrint from 'react-to-print';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { usePageActions } from 'Components/Shared/PageActions';
import { reportCompanyTitle, reportAddress, companyLogo, reportLetterheadId } from 'functions/companyBranding';
import {
  VAT_COLUMNS, VAT_DETAIL, vatDefaultColumns, vatPickerOrder, vatShownColumns, vatColumn,
} from 'functions/vatDetailColumns';
import { returnDate, vatCellValue, buildVatDetailWorkbook, vatDetailFileName } from 'functions/vatDetailExcel';
import { logoForExcel } from 'functions/invoiceExcel';

// THE VAT DETAIL - every Sale Tax Invoice in a period, for the sales tax
// return: the buyer (NTN, name, district), the document, and its taxed
// services - value excluding tax, the tax, the rate. Built on the server
// (routes/misc/vatDetail, functions/vatDetail) to Climax's report, column for
// column, and exported to Excel in its layout (functions/vatDetailExcel).
//
// THE COLUMNS ARE PICKED (functions/vatDetailColumns): the screen, the print
// and the Excel export all carry the columns ticked under Columns, in its
// order. It opens on Configuration > Reports' set, or the built-in ten;
// a pick lasts the browser session, and All gives the return's fifteen.
//
// The period starts on LAST month: the return is filed for the month gone.

const DAY = 'YYYY-MM-DD';
const money = (v) => (v === null || v === undefined ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

// This browser session's column picks.
const PICKS_KEY = 'odyssey.vatDetail.columns';
const readPicks = () => {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(PICKS_KEY) || 'null');
    return Array.isArray(v) ? v : null;
  } catch (_) {
    return null;
  }
};
const writePicks = (ids) => {
  try {
    if (ids) window.sessionStorage.setItem(PICKS_KEY, JSON.stringify(ids));
    else window.sessionStorage.removeItem(PICKS_KEY);
  } catch (_) { /* the picks just do not outlive the page */ }
};

// What a cell shows, on screen and in print.
const shown = (c, r) => (c.money ? money(r[c.id]) : vatCellValue(c, r));

const VatDetail = () => {
  const companyId = useSelector((state) => state.company.value);
  const [from, setFrom] = useState(() => moment().subtract(1, 'month').startOf('month'));
  const [to, setTo] = useState(() => moment().subtract(1, 'month').endOf('month'));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const printRef = useRef(null);
  const printTriggerRef = useRef(null);

  // The columns: Configuration's defaults, and this session's picks.
  const [configured, setConfigured] = useState(null);
  const [picks, setPicks] = useState(readPicks);
  useEffect(() => {
    let alive = true;
    axiosClient.get(`/settings/reportColumns/${VAT_DETAIL}`)
      .then(({ data }) => { if (alive) setConfigured(data?.result || null); })
      .catch(() => { /* the built-in set */ });
    return () => { alive = false; };
  }, []);
  const defaults = vatDefaultColumns(configured);
  const shownIds = vatShownColumns(defaults, picks ?? defaults);
  const cols = shownIds.map(vatColumn);
  const pick = (ids) => { setPicks(ids); writePicks(ids); };
  const toggleColumn = (id, on) => pick(on ? [...shownIds, id] : shownIds.filter((x) => x !== id));

  const logoSrc = companyLogo(reportLetterheadId(companyId), { print: true });

  const run = useCallback(async () => {
    if (!from?.isValid() || !to?.isValid()) return;
    setLoading(true);
    try {
      const { data } = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/misc/vatDetail`, {
        headers: {
          from: from.format(DAY), to: to.format(DAY), utcoffset: String(moment().utcOffset()),
          company: String(companyId ?? ''),
        },
      });
      if (data?.status !== 'success') throw new Error(data?.result);
      setReport(data.result);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not build the VAT Detail.', 'red');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, companyId]);

  const exportExcel = async () => {
    if (!report) return;
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = buildVatDetailWorkbook(ExcelJS, {
        report,
        company: reportCompanyTitle(companyId),
        address: reportAddress(companyId),
        columns: shownIds,
        logo: await logoForExcel(logoSrc),
      });
      const buffer = await wb.xlsx.writeBuffer();
      const url = window.URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
      const link = document.createElement('a');
      link.href = url;
      link.download = vatDetailFileName(report);
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      openNotification('Error', 'Could not export the VAT Detail.', 'red');
    }
  };

  usePageActions({
    title: 'VAT Detail',
    subtitle: report ? `${returnDate(report.from)} to ${returnDate(report.to)}` : undefined,
    print: {
      onClick: () => printTriggerRef.current?.click(),
      disabled: !report,
      title: report ? 'Print the VAT Detail, with the columns shown' : 'Show a period first',
    },
    excel: {
      onClick: exportExcel,
      disabled: !report,
      title: report ? 'Export to Excel, with the columns shown' : 'Show a period first',
    },
  }, [Boolean(report), report?.from, report?.to, companyId, shownIds.join(',')]);

  /* Fixed widths, and a long name cut short with the whole of it on hover, so
     the table fits the page rather than scrolling it sideways. The name takes
     whatever width the other columns leave. */
  const ellipsis = (v) => <span title={v}>{v}</span>;
  const columns = cols.map((c) => ({
    title: c.short || c.heading,
    dataIndex: c.id,
    key: c.id,
    width: c.screen,
    align: c.figure ? 'right' : (c.align || 'left'),
    ...(c.ellipsis ? { ellipsis: { showTitle: false } } : {}),
    render: (v, r) => (c.ellipsis ? ellipsis(v) : shown(c, r)),
  }));

  // The Total row: under each money column its total, "Total" in the first.
  const totalCells = cols.map((c, i) => {
    if (c.money) return money(report?.totals?.[c.id]);
    return i === 0 ? 'Total' : '';
  });

  // The printed columns' widths: their shares, scaled to fill the page.
  const printShare = cols.reduce((t, c) => t + c.print, 0) || 1;

  const columnPicker = (
    <div style={{ minWidth: 230 }}>
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {vatPickerOrder(defaults).map((id) => (
          <div key={id}>
            <Checkbox checked={shownIds.includes(id)} onChange={(e) => toggleColumn(id, e.target.checked)}>
              {vatColumn(id).heading}
            </Checkbox>
          </div>
        ))}
      </div>
      <div className='d-flex justify-content-between mt-2 pt-2' style={{ borderTop: '1px solid #f0f0f0' }}>
        <button type='button' className='btn btn-link btn-sm p-0' onClick={() => pick(null)}
          title='The columns set in Configuration > Reports'>Default</button>
        <button type='button' className='btn btn-link btn-sm p-0' onClick={() => pick(VAT_COLUMNS.map((c) => c.id))}
          title="All fifteen of the return's columns">All</button>
      </div>
    </div>
  );

  const head = (
    <div className='vat-head'>
      <div className='letterhead'>
        <div className='logo'>
          {/* Nothing when the company has no logo - never a bundled fallback,
              which would be another tenant's artwork. */}
          {logoSrc && <img src={logoSrc} alt='' />}
        </div>
        <div className='names'>
          <div className='co'>{reportCompanyTitle(companyId)}</div>
          <div>{reportAddress(companyId)}</div>
          <div className='title'>VAT Detail</div>
        </div>
        <div className='logo' />
      </div>
      {report && (
        <div className='period'>
          From Date = {moment(report.from, DAY).format('DD-MMM-YYYY')} Till Date = {moment(report.to, DAY).format('DD-MMM-YYYY')}
        </div>
      )}
    </div>
  );

  return (
    <div className='client-styles vat-detail'>
      <Row className='align-items-center mb-3'>
        <Col className='d-flex justify-content-end align-items-center' style={{ gap: '0.5rem' }}>
          <span className='grey-txt'>From</span>
          <DatePicker value={from} onChange={(m) => setFrom(m)} format='DD-MM-YYYY' allowClear={false} />
          <span className='grey-txt'>To</span>
          <DatePicker value={to} onChange={(m) => setTo(m)} format='DD-MM-YYYY' allowClear={false} />
          <button type='button' className='btn-custom' onClick={run} disabled={loading || !from || !to}>
            {loading ? 'Building…' : 'Show'}
          </button>
          <Popover trigger='click' placement='bottomRight' title='Columns' content={columnPicker}>
            <button type='button' className='btn-custom'>Columns ({shownIds.length})</button>
          </Popover>
        </Col>
      </Row>

      {loading && <div className='text-center py-5'><Spin /></div>}

      {!loading && report && (
        <>
          <div className='vat-summary'>
            <div className='fig'><span>Documents</span><b>{report.rows.length}</b></div>
            <div className='fig'><span>Value excluding sales tax</span><b>{money(report.totals.value)}</b></div>
            <div className='fig accent'><span>Sales tax</span><b>{money(report.totals.tax)}</b></div>
            <div className='fig'><span>Withheld at source</span><b>{money(report.totals.withheld)}</b></div>
          </div>
          <Table
            rowKey='documentNo'
            size='small'
            bordered
            tableLayout='fixed'
            dataSource={report.rows}
            columns={columns}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [50, 100, 500] }}
            locale={{ emptyText: 'No Sale Tax Invoices in this period.' }}
            summary={() => (
              <Table.Summary>
                <Table.Summary.Row className='vat-total'>
                  {totalCells.map((v, i) => (
                    <Table.Summary.Cell key={cols[i].id} index={i} align={cols[i].figure || i === 0 ? 'right' : 'left'}>
                      <b>{v}</b>
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </>
      )}

      {!loading && !report && <p className='grey-txt'>Pick a period and press Show.</p>}

      {/* The printed copy: the letterhead, and every document - not a page of
          them - in the columns shown. ReactToPrint clones a live node, so its
          trigger stays mounted and hidden; the toolbar's Print clicks it. */}
      <ReactToPrint
        content={() => printRef.current}
        trigger={() => <button type='button' ref={printTriggerRef} style={{ display: 'none' }} aria-hidden='true' />}
      />
      <div style={{ position: 'absolute', left: '-10000px', top: 0 }} aria-hidden='true'>
        <div ref={printRef} className='vat-print'>
          {/* BUILT FOR MARGINS: NONE, as every print here is. A page of its
              own - A4 landscape, no margin - named, so the portrait rule other
              prints load into the same window cannot turn it round; and the
              white border is the print's own padding, so it is the same
              whatever the dialog's Margins say. */}
          <style>{`
            @media print {
              @page vatDetail { size: A4 landscape; margin: 0; }
              .vat-print { page: vatDetail; }
            }
          `}</style>
          {report && (
            <>
              {head}
              <table>
                <colgroup>
                  {cols.map((c) => <col key={c.id} style={{ width: `${(c.print / printShare) * 100}%` }} />)}
                </colgroup>
                <thead>
                  <tr>{cols.map((c) => <th key={c.id}>{c.heading}</th>)}</tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.documentNo}>
                      {cols.map((c) => (
                        <td key={c.id} className={c.figure ? 'num' : c.align === 'center' ? 'mid' : ''}>{shown(c, r)}</td>
                      ))}
                    </tr>
                  ))}
                  <tr className='total'>
                    {totalCells.map((v, i) => (
                      <td key={cols[i].id} className={cols[i].figure || i === 0 ? 'num' : ''}>{v}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      <style jsx global>{`
        .vat-detail { max-width: 100%; overflow-x: hidden; }
        .vat-detail .ant-table { font-size: 12px; }
        .vat-detail .vat-summary {
          display: flex; align-items: center; gap: 26px; flex-wrap: wrap;
          padding: 12px 16px; margin-bottom: 12px;
          border: 1px solid #eee; border-radius: 8px; background: #fcfcfc;
        }
        .vat-detail .vat-summary .fig { display: flex; flex-direction: column; font-variant-numeric: tabular-nums; }
        .vat-detail .vat-summary .fig span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #999; }
        .vat-detail .vat-summary .fig b { font-size: 17px; }
        .vat-detail .vat-summary .fig.accent b { color: #1890ff; }
        /* The page is 297mm across with no margin; the 8mm border is padding. */
        .vat-print {
          font-family: Arial, sans-serif; font-size: 10px; color: #000;
          width: 297mm; box-sizing: border-box; padding: 8mm 8mm 10mm;
        }
        /* Laid out here, not by the site's classes, so the printed copy reads
           the same wherever it is printed from. */
        .vat-print .vat-head { margin-bottom: 6px; font-size: 11px; }
        .vat-print .vat-head .letterhead { display: flex; align-items: center; }
        .vat-print .vat-head .logo { width: 20%; }
        .vat-print .vat-head .logo img { max-height: 60px; max-width: 100%; }
        .vat-print .vat-head .names { width: 60%; text-align: center; }
        .vat-print .vat-head .period { text-align: left; margin-top: 4px; }
        .vat-print .vat-head .co { font-size: 16px; font-weight: 700; text-decoration: underline; }
        .vat-print .vat-head .title { font-size: 13px; font-weight: 700; text-decoration: underline; margin: 3px 0 0; }
        .vat-print table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .vat-print th {
          background: #c0c0c0; font-weight: 700; text-align: center; line-height: 1.15;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        .vat-print th, .vat-print td { border: 1px solid #000; padding: 2px 4px; vertical-align: middle; }
        /* A heading wraps between words; only a value with no break in it -
           a long NTN or code - may be split. */
        .vat-print td { overflow-wrap: break-word; }
        .vat-print td.num { text-align: right; }
        .vat-print td.mid { text-align: center; }
        .vat-print tr.total td { font-weight: 700; }
        .vat-print thead { display: table-header-group; }
        .vat-print tr { page-break-inside: avoid; }
      `}</style>
    </div>
  );
};

export default VatDetail;
