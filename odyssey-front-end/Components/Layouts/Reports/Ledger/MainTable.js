import React, { useRef, useEffect, useState } from "react";
import { useRememberedPage } from 'functions/rememberedPage';
import { Table as AntTable } from "antd";
import { useDispatch } from "react-redux";
import { incrementTab } from "redux/tabs/tabSlice";
import Router from "next/router";
import ReactToPrint from "react-to-print";
import moment from "moment";
import Cookies from "js-cookie";
import PrintTopHeader from "Components/Shared/PrintTopHeader";
import axiosClient from "apis/axiosClient";
import { usePageActions } from "Components/Shared/PageActions";
import { FilePdfOutlined } from "@ant-design/icons";
import openNotification from "Components/Shared/Notification";
import ExcelJS from "exceljs";
import { reportLetterheadId } from "functions/companyBranding";
import { ledgerDataSource, ledgerSheetRows, ledgerTotals, SHEET_HEADER, OPENING_KEY, balanceSide } from "functions/ledgerRows";
import usePrintStamp from 'functions/usePrintStamp';

/* -----------------------------
   UTILS
------------------------------ */
const commas = (a) =>
  parseFloat(a)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/* -----------------------------
   EXCEL EXPORT
------------------------------ */
/* With borders, the figures as numbers, and the balance's Dr/Cr in a column
 * of its own. The opening balance is the table's first row, as on screen -
 * see functions/ledgerRows. */
const exportLedgerToExcel = async ({
  dataSource,
  closing,
  name,
  company,
  from,
  to,
}) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ledger");
  const thin = { style: "thin", color: { argb: "FF000000" } };
  const boxed = { top: thin, left: thin, bottom: thin, right: thin };
  const money = "#,##0.00";

  sheet.columns = [
    { width: 5 }, { width: 18 }, { width: 12 }, { width: 45 }, { width: 22 },
    { width: 15 }, { width: 15 }, { width: 16 }, { width: 7 },
  ];

  sheet.addRow([company]).font = { bold: true, size: 13 };
  sheet.addRow([`Ledger: ${name}`]).font = { bold: true };
  sheet.addRow([`Period: ${from} to ${to}`]);
  sheet.addRow([]);

  const head = sheet.addRow(SHEET_HEADER);
  head.eachCell((c) => {
    c.font = { bold: true };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    c.border = boxed;
  });

  const firstRow = sheet.rowCount + 1;
  ledgerSheetRows(dataSource).forEach((values, i) => {
    const row = sheet.addRow(values);
    for (let col = 1; col <= SHEET_HEADER.length; col += 1) {
      const c = row.getCell(col);
      c.border = boxed;
      if (col >= 6 && col <= 8) { c.numFmt = money; c.alignment = { horizontal: "right" }; }
      if (col === 1 || col === 3 || col === 9) c.alignment = { horizontal: "center" };
      if (col === 4) c.alignment = { wrapText: true, vertical: "top" };
    }
    if (dataSource[i]?.key === OPENING_KEY) row.font = { bold: true };
  });
  const lastRow = sheet.rowCount;

  // The Debit and Credit columns added up - as SUMs, so they follow an edit
  // made in the sheet, with the figure already in them for a viewer that
  // does not recalculate.
  const totals = ledgerTotals(dataSource);
  const grand = sheet.addRow(["", "", "", "Total", "", null, null, "", ""]);
  grand.getCell(6).value = { formula: `SUM(F${firstRow}:F${lastRow})`, result: totals.debit };
  grand.getCell(7).value = { formula: `SUM(G${firstRow}:G${lastRow})`, result: totals.credit };
  grand.font = { bold: true };
  for (let col = 1; col <= SHEET_HEADER.length; col += 1) grand.getCell(col).border = boxed;
  [6, 7].forEach((col) => { grand.getCell(col).numFmt = money; grand.getCell(col).alignment = { horizontal: "right" }; });

  const { amount, side } = balanceSide(closing);
  const total = sheet.addRow(["", "", "", "Closing Balance", "", "", "", amount, side]);
  total.font = { bold: true };
  for (let col = 1; col <= SHEET_HEADER.length; col += 1) total.getCell(col).border = boxed;
  total.getCell(8).numFmt = money;
  total.getCell(9).alignment = { horizontal: "center" };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Ledger_${name}_${moment().format("YYYYMMDD")}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
};

/* ======================================================================
   MAIN COMPONENT
====================================================================== */
const MainTable = ({
  ledger,
  closing,
  opening,
  name,
  company,
  currency,
  from,
  to,
  accountId,
  // Rendered for the headless browser that produces the PDF: the printable
  // report and nothing else - no toolbar, no on-screen table, and visible
  // rather than the hidden copy the Print button clones. See pages/ledger-print
  // and functions/pdf.renderLedgerPdf on the backend.
  printOnly = false,
  // For the PDF only: the letterhead's Company and who printed it, which the
  // bare print page gets from the server - it has no session to read them from.
  letterhead = null,
  printedBy = '',
}) => {
  const dispatch = useDispatch();
  const printRef = useRef(null);

  const [username, setUsername] = useState("");
  // The day it is printed: empty until in the browser, whose day it is -
  // see functions/usePrintStamp.
  const stamp = usePrintStamp();
  // Kept when the user switches tabs and comes back - functions/rememberedPage.
  const [currentPage, setCurrentPage] = useRememberedPage('ledger');
  const [pageSize, setPageSize] = useRememberedPage('ledger:pageSize', 20);

  useEffect(() => {
    setUsername(printedBy || Cookies.get("username") || "");
  }, [printedBy]);

  /* -----------------------------
     BUILD DATA SOURCE
  ------------------------------ */
  // The opening balance first, then the period's entries - functions/ledgerRows.
  const dataSource = ledgerDataSource({ ledger, opening, from });

  /* -----------------------------
     SHARED COLUMNS
  ------------------------------ */
  const makeColumns = (isPrint = false) => [
    {
      title: "#",
      width: 50,
      align: "center",
      // The opening row is not an entry, so it is not numbered.
      render: (_, record, index) => {
        if (record.key === OPENING_KEY) return "";
        const at = isPrint ? index : (currentPage - 1) * pageSize + index;
        return at;
      },
    },
    { title: "Voucher #", width: 140, dataIndex: "voucher", align: "center",
      render: (text, record) =>
        record.key === OPENING_KEY ? "" : (
          <span
            className="blue-txt cur"
            onClick={() => {
              if (
                record.voucherType === "Job Reciept" ||
                record.voucherType === "Job Payment"
              ) {
                dispatch(
                  incrementTab({
                    label: "Payment / Receipt",
                    key: "3-4",
                    id: record.voucherId,
                  })
                );
                Router.push(`/accounts/paymentReceipt/${record.voucherId}`);
              } else if (
                record.voucherType === "Opening Reciept" ||
                record.voucherType === "Opening Payment" ||
                record.vouchervType === "OP"
              ) {
                dispatch(
                  incrementTab({
                    label: "Opening Balance",
                    key: "3-10",
                    id: record.voucherId,
                  })
                );
                Router.push(`/accounts/openingBalance/${record.voucherId}`);
              } else {
                dispatch(
                  incrementTab({
                    label: "Voucher",
                    key: "3-5",
                    id: record.voucherId,
                  })
                );
                Router.push(`/accounts/vouchers/${record.voucherId}`);
              }
            }}
          >
            {text}
          </span>
        ),
     },
    {
      title: "Date",
      width: 90,
      dataIndex: "date",
      align: "center",
      render: (d) => moment(d).format("DD-MM-YYYY"),
    },
    { title: "Particular", dataIndex: "narration" },
    { title: "Cheque No | Date", width: 190, dataIndex: "cheque" },
    {
      title: "Debit",
      width: 120,
      align: "right",
      dataIndex: "debit",
      render: (v) => v && commas(v),
    },
    {
      title: "Credit",
      width: 120,
      align: "right",
      dataIndex: "credit",
      render: (v) => v && commas(v),
    },
    {
      title: "Balance",
      width: 150,
      align: "right",
      dataIndex: "balance",
      render: (v) =>
        v >= 0 ? `${commas(v)} Dr` : `${commas(Math.abs(v))} Cr`,
    },
  ];

  /* -----------------------------
     GRAND TOTAL
  ------------------------------ */
  // Under the last row, on every page and in print: the Debit and Credit
  // columns added up - the period's movement; the opening row has nothing in
  // either - and the closing balance beside them.
  const totals = ledgerTotals(dataSource);
  const balanceText = (v) => (v >= 0 ? `${commas(v)} Dr` : `${commas(Math.abs(v))} Cr`);
  const totalRow = (fixed) => (
    <AntTable.Summary fixed={fixed}>
      <AntTable.Summary.Row className="ledger-total">
        <AntTable.Summary.Cell index={0} colSpan={5} align="right"><b>Total</b></AntTable.Summary.Cell>
        <AntTable.Summary.Cell index={5} align="right"><b>{commas(totals.debit)}</b></AntTable.Summary.Cell>
        <AntTable.Summary.Cell index={6} align="right"><b>{commas(totals.credit)}</b></AntTable.Summary.Cell>
        <AntTable.Summary.Cell index={7} align="right"><b>{balanceText(closing)}</b></AntTable.Summary.Cell>
      </AntTable.Summary.Row>
    </AntTable.Summary>
  );

  /* -----------------------------
     SCREEN TABLE
  ------------------------------ */
  const ScreenTable = () => (
    <AntTable
      columns={makeColumns(false)}
      dataSource={dataSource}
      summary={() => totalRow(true)}
      bordered
      size="small"
      pagination={{
        current: currentPage,
        pageSize,
        showSizeChanger: true,
        pageSizeOptions: [12, 20, 50, 100],
        onChange: (p, s) => {
          setCurrentPage(p);
          setPageSize(s);
        },
      }}
      scroll={{ y: "50vh", x: "85vw" }}
    />
  );

  /* -----------------------------
     PRINT TABLE
  ------------------------------ */
  const PrintTable = () => (
    <AntTable
      columns={makeColumns(true)}
      dataSource={dataSource}
      summary={() => totalRow(false)}
      bordered
      size="small"
      pagination={false}
    />
  );

  /* THE PDF IS RENDERED BY THE SERVER, from this very screen.
   *
   * It does not rebuild the report: /accounts/getLedgerPdf loads the bare
   * ledger print page in a headless browser and prints that, so the PDF is the
   * same component, with the same opening balance and the same ex-rate
   * handling, as what is on screen here. Building a second ledger server side
   * would be a second set of numbers to keep in step.
   *
   * The response is a file, not JSON - `responseType: 'blob'`, or axios parses
   * the bytes as text and the saved PDF is corrupt. */
  const [pdfBusy, setPdfBusy] = useState(false);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await axiosClient.get(
        `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/accounts/getLedgerPdf`,
        {
          responseType: 'blob',
          headers: {
            id: `${accountId ?? ''}`,
            from: `${from ?? ''}`,
            to: `${to ?? ''}`,
            currency: `${currency ?? ''}`,
            company: `${company?.id ?? company ?? ''}`,
            // Whose letterhead heads it when the ledger is for all companies:
            // the one selected in the header, as on the printed copy.
            letterhead: `${reportLetterheadId(company?.id ?? company) ?? ''}`,
            name: `${name ?? 'ledger'}`,
          },
        },
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name || 'ledger'} ${from} to ${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Released once the download has been handed to the browser; without this
      // the blob is held for the life of the tab.
      window.URL.revokeObjectURL(url);
    } catch (e) {
      openNotification('Error', 'Could not produce the ledger PDF.', 'red');
    } finally {
      setPdfBusy(false);
    }
  };

  /* THE PAGE'S OWN BUTTONS, in the page header.
   *
   * Print, Excel and PDF used to sit in this component: a bare blue printer
   * glyph floated right, and two dark pills beside it wearing `btn-custom` -
   * three controls, three different shapes, none of them where the same verbs
   * live on any other screen. They are declared here now and drawn by the
   * shared bar. See Components/Shared/PageActions.
   *
   * PDF IS AN `extra`, not a sixth slot. The five slots are the app's fixed
   * verbs and adding one puts it on every screen; a PDF export exists only on
   * this report today, and extras are drawn after the slots so the fixed
   * positions stay fixed. If other reports grow one, it graduates to a slot.
   *
   * NOT REGISTERED IN printOnly MODE - passing null claims nothing. That mode
   * is the bare page Puppeteer renders for the PDF, which has no toolbar and
   * must not put one in the document it is about to print. */
  const printTriggerRef = useRef(null);

  usePageActions(printOnly ? null : {
    title: `Ledger${name ? ` — ${name}` : ''}`,
    subtitle: from && to ? `${from} to ${to}` : undefined,
    print: {
      // ReactToPrint needs to clone a live node, so its own trigger stays
      // mounted and hidden and the toolbar's Print clicks it.
      onClick: () => printTriggerRef.current?.click(),
    },
    excel: {
      onClick: () => exportLedgerToExcel({
        dataSource, closing, name, company, from, to,
      }),
    },
    extras: [{
      key: 'pdf',
      label: 'Export to PDF',
      Icon: FilePdfOutlined,
      busy: pdfBusy,
      disabled: pdfBusy,
      onClick: downloadPdf,
    }],
  }, [printOnly, name, from, to, pdfBusy]);

  /* The report as it is PRINTED - header, full table, footer. One definition,
     used by the hidden node the Print button clones and by the bare page the
     PDF is rendered from, so the two cannot drift apart. */
  const Printable = () => (
    <>
      {/* THE PRINTED TABLE IS LAID OUT FOR A4 PORTRAIT, which the screen's is
          not. On screen the columns carry fixed pixel widths - 50 + 140 + 90 +
          190 + 120 + 120 + 150 before Particular gets any - which is about
          860px of table before the widest column is counted. A4 portrait at
          these margins is roughly 700px, so the report ran off the side of the
          page and the columns that survived were crushed.
          
          So print gets proportional widths instead of pixel ones, in the same
          column order makeColumns declares, plus a smaller face and tighter
          cells. `table-layout: fixed` is what makes the percentages bind;
          without it the browser re-reads the content and the pixel widths win.
          
          THE HEADER REPEATS ON EVERY PAGE and rows are kept whole, because a
          ledger is usually several pages and a column of figures with no
          heading above it is unreadable. */}
      <style>{`
        .ledger-print-root .ant-table { font-size: 9px; color: #000; }
        .ledger-print-root .ant-table table { width: 100% !important; table-layout: fixed !important; }
        .ledger-print-root .ant-table-cell {
          padding: 3px 4px !important;
          white-space: normal !important;
          word-break: break-word;
        }
        /* The voucher number is a link on screen and ink on paper. */
        .ledger-print-root .blue-txt { color: #000 !important; cursor: default; }
        .ledger-print-root colgroup col:nth-child(1) { width: 4%  !important; }
        .ledger-print-root colgroup col:nth-child(2) { width: 13% !important; }
        .ledger-print-root colgroup col:nth-child(3) { width: 9%  !important; }
        .ledger-print-root colgroup col:nth-child(4) { width: 24% !important; }
        .ledger-print-root colgroup col:nth-child(5) { width: 15% !important; }
        .ledger-print-root colgroup col:nth-child(6) { width: 11% !important; }
        .ledger-print-root colgroup col:nth-child(7) { width: 11% !important; }
        .ledger-print-root colgroup col:nth-child(8) { width: 13% !important; }
        .ledger-print-root thead { display: table-header-group; }
        .ledger-print-root tr { page-break-inside: avoid; }
        .ledger-print-root .print-footer { margin-top: 8px; font-size: 9px; }
        .ledger-print-root .ledger-print-account { margin: 6px 0 6px; font-size: 12px; }
      `}</style>
      <PrintTopHeader company={company} from={from} to={to} letterhead={letterhead} />
      {/* WHOSE LEDGER. The printed copy and the PDF named the company and the
          dates but not the account - a statement sent to a party that did not
          say it was theirs (2026-11-13). */}
      <div className="ledger-print-account">
        Ledger: <b>{name}</b>
        {currency && currency !== "PKR" ? ` (${currency})` : ""}
      </div>
      <PrintTable />
      <div className="print-footer">
        Printed On: {stamp.at ? moment(stamp.at).format("DD-MM-YYYY") : ""} &nbsp; | &nbsp; Printed By:{" "}
        {username}
      </div>
    </>
  );

  /* -----------------------------
     RENDER
  ------------------------------ */
  // Puppeteer waits for `.ledger-print-root`, so the class is what tells it the
  // report has finished rendering - see renderLedgerPdf.
  if (printOnly) {
    return (
      <div className="print-root ledger-print-root">
        <Printable />
      </div>
    );
  }

  return (
    <div>
      {/* The trigger stays mounted but hidden - ReactToPrint clones a live
          node, so it cannot be removed - and the page toolbar's Print clicks
          it. Same arrangement as PaymentsReceipt/PrintTransaction. */}
      <ReactToPrint
        content={() => printRef.current}
        pageStyle="@page { size: A4 portrait; margin: 15mm; }"
        trigger={() => (
          <button type="button" ref={printTriggerRef} style={{ display: 'none' }} aria-hidden="true" />
        )}
      />


      <PrintTopHeader company={company} from={from} to={to} />

      <div className="d-flex justify-content-between mt-3">
        <b>{name}</b>
        <span>
          Opening:{" "}
          {opening >= 0
            ? `${commas(opening)} Dr`
            : `${commas(Math.abs(opening))} Cr`}
        </span>
      </div>

      <ScreenTable />

      <div className="d-flex justify-content-end mt-2">
        Closing:{" "}
        {closing >= 0
          ? `${commas(closing)} Dr`
          : `${commas(Math.abs(closing))} Cr`}
      </div>

      {/* PRINT CONTENT */}
      <div style={{ display: "none" }}>
        <div ref={printRef} className="print-root ledger-print-root">
          <Printable />
        </div>
      </div>
    </div>
  );
};

export default React.memo(MainTable);