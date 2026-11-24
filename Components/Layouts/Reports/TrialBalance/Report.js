import React from 'react';
import { useRememberedPage } from 'functions/rememberedPage';
import moment from 'moment';
import PrintTopHeader from "Components/Shared/PrintTopHeader";
import { Table } from "react-bootstrap";
import Pagination from "Components/Shared/Pagination";
import ExcelJS from "exceljs";
import { companyLogoBlob, reportCompanyTitle, reportAddress } from 'functions/companyBranding';
import { COLUMN_LABELS, columnGroups, commas } from 'functions/trialBalanceView';
import { usePageActions } from 'Components/Shared/PageActions';

// The trial balance arrives BUILT - routes/misc/trialBalance (functions/
// trialBalance on the server) works out every figure for the report type
// picked and sends only the rows to show, groups already added up and the
// grand total already taken. This lays them out a page at a time and exports
// the same rows to Excel; it does no arithmetic of its own.

const RECORDS_PER_PAGE = 20;

const day = (d) => (d ? moment(d, ['YYYY-MM-DD', moment.ISO_8601]).format('DD-MM-YYYY') : '');

const Report = ({ query, result }) => {
  const report = result?.status === 'success' ? result.result : null;
  const rows = report?.rows || [];
  const columns = report?.columns || [];
  const totals = report?.totals || {};
  const groups = columnGroups(columns);
  const from = day(report?.from || query.from);
  const to = day(report?.to || query.to);

  // Kept when the user switches tabs and comes back - functions/rememberedPage.
  const [currentPage, setCurrentPage] = useRememberedPage('trialBalance');
  const noOfPages = Math.max(1, Math.ceil(rows.length / RECORDS_PER_PAGE));
  const currentRecords = rows.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE);

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Trial Balance');

    worksheet.columns = [
      { header: '#', key: 'index', width: 5 },
      { header: 'Code', key: 'code', width: 15 },
      { header: 'Title of Account', key: 'title', width: 45 },
      ...columns.map((k) => ({ header: COLUMN_LABELS[k].side, key: k, width: 20, style: { numFmt: '#,##0.00' } })),
    ];

    const border = {
      right: { style: 'thin', color: { argb: '000000' } },
      left: { style: 'thin', color: { argb: '000000' } },
      top: { style: 'thin', color: { argb: '000000' } },
      bottom: { style: 'thin', color: { argb: '000000' } },
    };
    const shade = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D3D3D3' } };

    worksheet.getRow(1).eachCell((cell) => {
      cell.fill = shade;
      cell.border = border;
      cell.font = { size: 14, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    rows.forEach((x, i) => {
      const row = worksheet.addRow({
        index: i + 1,
        code: x.code,
        title: x.title,
        ...Object.fromEntries(columns.map((k) => [k, x[k]])),
      });
      row.getCell('title').alignment = { indent: Math.max(0, x.level - 1) };
      if (x.group) {
        row.eachCell((cell) => {
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'd7d7d7' } };
        });
      }
    });
    const totalRow = worksheet.addRow({ title: 'Grand Total', ...totals });
    totalRow.eachCell((cell) => { cell.font = { bold: true }; cell.border = border; });

    // Above the table: company, address, dates, then the column groups -
    // inserted from the top down, so the last one inserted is row 1.
    const groupRow = ['', '', ''];
    groups.forEach((g) => { groupRow.push(g.label, ...g.keys.slice(1).map(() => '')); });
    worksheet.insertRow(1, groupRow);
    worksheet.insertRow(1, ['']);
    worksheet.insertRow(1, ['', '', '', `Date: From: ${from} To: ${to}`]);
    worksheet.insertRow(1, ['', '', '', reportAddress(query.company)]);
    // The report's company by its own record - see reportLetterheadId.
    worksheet.insertRow(1, ['', '', '', reportCompanyTitle(query.company)]);
    worksheet.insertRow(1, ['']);
    worksheet.insertRow(1, ['']);

    worksheet.getCell('D3').font = { size: 16, bold: true };
    worksheet.getCell('D4').font = { size: 16, bold: true };
    worksheet.getCell('D5').font = { size: 14, bold: true };

    let col = 4;
    groups.forEach((g) => {
      const first = worksheet.getColumn(col).letter;
      const last = worksheet.getColumn(col + g.keys.length - 1).letter;
      if (g.keys.length > 1) worksheet.mergeCells(`${first}7:${last}7`);
      const cell = worksheet.getCell(`${first}7`);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = { size: 14, bold: true };
      cell.fill = shade;
      worksheet.getCell(`${last}7`).border = border;
      col += g.keys.length;
    });

    // Logo now comes from the Company record (functions/companyBranding.js).
    // null when that company has no logo uploaded - the sheet then gets no
    // image rather than another tenant's artwork.
    const imageBlob = await companyLogoBlob(query.company);
    if (imageBlob) {
      const imageId = workbook.addImage({
        buffer: await imageBlob.arrayBuffer(),
        extension: 'png',
      });
      worksheet.addImage(imageId, {
        tl: { col: 1, row: 1 },
        ext: { width: 150, height: 100 },
      });
    }

    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'TrialBalance.xlsx';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    }
  };

  // The title and Excel on the toolbar (PageActions). Above the return for a
  // report that did not load: it is a hook.
  usePageActions({
    title: 'Trial Balance',
    subtitle: `${from} to ${to}`,
    excel: {
      onClick: () => exportToExcel(),
      disabled: rows.length === 0,
      title: rows.length ? 'Export the trial balance to Excel' : 'Nothing to export',
    },
  }, [from, to, rows.length]);

  if (!report) {
    return (
      <div className='p-3'>
        <PrintTopHeader company={query.company} from={from} to={to} />
        <p className='mt-3 text-danger'>
          {typeof result?.result === 'string' ? result.result : 'The trial balance could not be loaded.'}
        </p>
      </div>
    );
  }

  return (
    <div className='p-3'>
      <PrintTopHeader company={query.company} from={from} to={to} />
      <div className="printDiv mt-2" style={{ maxHeight: "60vh", overflowY: "auto", overflowX: "hidden", height: "auto" }}>
        <div className="table-sm-1 mt-2">
          <Table className="tableFixHead" bordered>
            <thead>
              <tr className="custom-width">
                <th className="class-1"></th>
                {groups.map((g) => <th key={g.label} className="class-1" colSpan={g.keys.length}>{g.label}</th>)}
              </tr>
              <tr className="custom-width">
                <th className="class-1">Account Title</th>
                {columns.map((k) => <th key={k} className="class-1">{COLUMN_LABELS[k].side}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="fs-12 text-center">Nothing to show for this period.</td></tr>
              )}
              {currentRecords.map((x, i) => (
                <tr key={`${x.id}-${i}`}>
                  <td
                    className={x.group ? 'fs-12' : 'blue-txt fs-12'}
                    style={{ paddingLeft: 8 + Math.max(0, x.level - 1) * 16 }}
                  >
                    {x.group ? <b>{x.title}</b> : x.title}
                  </td>
                  {columns.map((k) => (
                    <td key={k} className="fs-12">{x.group ? <b>{commas(x[k])}</b> : commas(x[k])}</td>
                  ))}
                </tr>
              ))}
              {rows.length > 0 && currentPage === noOfPages && (
                <tr>
                  <td className='text-end'><b>Grand Total:</b></td>
                  {columns.map((k) => <td key={k} className='fs-12'><b>{commas(totals[k])}</b></td>)}
                </tr>
              )}
            </tbody>
          </Table>
        </div>
        <div className="d-flex justify-content-end mt-4">
          <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={setCurrentPage} />
        </div>
      </div>
    </div>
  );
};

export default Report;
