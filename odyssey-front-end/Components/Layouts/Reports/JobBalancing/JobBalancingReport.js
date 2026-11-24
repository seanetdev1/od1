import { Spinner, Table } from "react-bootstrap";
import { useRememberedPage } from 'functions/rememberedPage';
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import PrintTopHeader from 'Components/Shared/PrintTopHeader';
import { AiFillPrinter } from "react-icons/ai";
import ReactToPrint from 'react-to-print';
import Cookies from "js-cookie";
import moment from 'moment';
import { AgGridReact } from 'ag-grid-react';
import { CSVLink } from "react-csv";
import { incrementTab } from 'redux/tabs/tabSlice';
import { useDispatch } from 'react-redux';
import Router from 'next/router';
import Pagination from "Components/Shared/Pagination";
import exportExcelFile from "functions/exportExcelFile";
import ExcelJS from "exceljs";
import { companyLogoBlob, companyTitle, reportCompanyTitle, reportAddress } from 'functions/companyBranding';
/* The job columns, for whichever kind of job the invoice is against - a
 * freight job, a flight, or a goods declaration. ONE mapping, used by the
 * table, the compact print layout, the CSV and the Excel export below, so the
 * four cannot disagree. See the module. */
import { jobColumns, jobLink, docLink, docHeadings, usesColumn } from 'functions/invoiceJobColumns';
import { getMode } from 'functions/terminology';
import JobBalancingPrint from './JobBalancingPrint';
import { Popover, Checkbox } from 'antd';
import axiosClient from 'apis/axiosClient';
import {
  JOB_BALANCING_GRID, jobBalancingColumns, defaultColumnIds, pickerOrder, shownColumnIds, cellValue,
} from 'functions/jobBalancingColumns';
import { hasBalance, isOwed } from 'functions/invoiceOwed';
import { usePageActions } from 'Components/Shared/PageActions';

// This browser session's column picks on the grid.
const PICKS_KEY = 'odyssey.jobBalancingGrid.columns';
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

/* An empty cell for a date that is not there.
 *
 * moment(undefined).format() is the string "Invalid date", which is what this
 * report printed in the date columns of every aviation and customs row - worse
 * than a blank, because it reads as data that is wrong rather than absent. */
const fmtDate = (v) => (v ? moment(v).format('DD-MMM-YYYY') : '');

/* Does this row still have money on it? "Exclude 0 Balance" keeps only those.
 * The balance the screen worked out (round off included) when there is one,
 * else the invoice's own figures - see functions/invoiceOwed. It was "total
 * less paid/received is not exactly 0", which kept invoices paid in full at
 * 0.00: a hair of floating point left by a knock-off, or the round off. */
const rowHasBalance = (x) => (x?.balance !== undefined ? hasBalance(x.balance) : isOwed(x));

const JobBalancingReport = ({ result, query }) => {
  // An install runs ONE operation mode, so the two document columns can be
  // headed with the document that mode actually puts in them.
  const docs = docHeadings(getMode());
  /* A column a mode never fills is not rendered at all, rather than left
   * blank down the whole report. `show` gates the <th> and its <td>
   * together - they have to stay in step, or every column after the
   * mistake shifts by one. */
  const mode = getMode();
  const show = (key) => usesColumn(mode, key);
  /* Every column that is not money or Age - which is what the totals row has
   * to account for around its figures. Ten are always there (#, Inv No,
   * Job No, Job Date, Date, the two document columns, Name, J/Tp, Currency);
   * the rest come and go with the mode, so the span is COUNTED rather than
   * typed - a typed one would put the totals under the wrong heading the
   * moment a mode dropped a column. Four of the ten (#, Inv No, Job No,
   * Currency) sit before the money; the totals row spans those with its
   * label and the other leadColumns - 4 with one blank cell after Age. */
  const OPTIONAL_BEFORE_TOTALS = ['sailDate', 'arrivalDate', 'clientCode', 'shipper',
    'consignee', 'salesRep', 'shippingLine', 'vessel', 'finalDestination',
    'freightType', 'weight', 'volume', 'gdDate', 'clientInvoiceNo', 'vendorTaxInvoiceNo'];
  const leadColumns = 10 + OPTIONAL_BEFORE_TOTALS.filter(show).length;

  // The grid's columns - see functions/jobBalancingColumns.
  const available = useMemo(() => jobBalancingColumns(mode), [mode]);
  // Config > Reports: undefined until asked, null = none. The grid waits
  // for it - it keeps the order it opened in (maintainColumnOrder), so opened on
  // the built-in order it never took the configured one.
  const [configured, setConfigured] = useState(undefined);
  const [picks, setPicks] = useState(null);             // this session's, null = the defaults
  const [reorder, setReorder] = useState(0);            // Default and All put the order back
  useEffect(() => {
    if (query.report == 'viewer') return undefined;
    setPicks(readPicks());
    let alive = true;
    axiosClient.get(`/settings/reportColumns/${JOB_BALANCING_GRID}`)
      .then(({ data }) => { if (alive) setConfigured(data?.result || null); })
      // Not reachable: the grid opens on every column, as it always did.
      .catch(() => { if (alive) setConfigured(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const defaults = defaultColumnIds(available, configured);
  const shownIds = shownColumnIds(available, defaults, picks ?? defaults);
  const pick = (ids) => { setPicks(ids); writePicks(ids); };
  const reset = (ids) => { pick(ids); setReorder((n) => n + 1); };
  const toggleColumn = (id, on) => {
    const next = on ? [...shownIds, id] : shownIds.filter((x) => x !== id);
    if (next.length) pick(next);
  };
  // The columns as the grid shows them now - in the order they are on screen.
  const exportColumns = () => {
    const grid = gridRef.current;
    const onScreen = (grid?.api?.getAllDisplayedColumns?.() || grid?.columnApi?.getAllDisplayedColumns?.() || [])
      .map((col) => col.getColId());
    return (onScreen.length ? onScreen : shownIds)
      .map((id) => available.find((c) => c.id === id)).filter(Boolean);
  };

  let inputRef = useRef(null);
  const [load, setLoad] = useState(true);
  const [records, setRecords] = useState([]);
  const [username, setUserName] = useState("");
  const [aging, setAging] = useState(true)
  const dispatch = useDispatch();
  const commas = (a) => a ? parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : '0.0';
  const getTotal = (type, list) => {
    let values = 0.00;
    list.filter((x) => {
        if (query.options == 'exclude0') {
          return rowHasBalance(x);
        }
        return true; // Keep all items if `query.options` is not 'exclude0'
      }).forEach((x) => {
      if (type.trim() == x.payType.trim()) {
        values = values + parseFloat(x.total)
      }
    })
    return commas(values);
  }

  const paidReceivedTotal = (list) => {
    let paid = 0.00, Received = 0.00, total = 0.00;
    list.filter((x) => {
        if (query.options == 'exclude0') {
          return rowHasBalance(x);
        }
        return true; // Keep all items if `query.options` is not 'exclude0'
      }).forEach((x) => {
        if (x.payType == "Payble") {
            paid = paid + parseFloat(x.paid)
        } else {
            Received = Received + parseFloat(x.recieved)
        }
    })
    total = Received - paid
    return total >= 0 ? commas(total) : (`${commas(total * -1)}`);
  }

  const ImageToBlob = (imageUrl) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Enable CORS if required
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(resolve);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  };

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Invoice Report');
  
    // Column definitions
    worksheet.columns = [
      { header: '#', key: 'index', width: 2 },
      { header: 'Inv/Bill#', key: 'invoiceNo', width: 12  },
      { header: 'Job. No', key: 'jobNo', width: 12  },
      { header: 'Inv/Bill Date', key: 'invoiceDate', width: 12  },
      { header: 'DO Date', key: 'doDate', width: 12  },
      { header: docs.primary, key: 'hbl', width: 10  },
      { header: 'GD Date', key: 'gdDate', width: 12  },
      { header: 'Client Invoice #', key: 'clientInvoiceNo', width: 14  },
      { header: 'Vendor Tax Inv #', key: 'vendorTaxInvoiceNo', width: 14  },
      { header: 'Client', key: 'party', width: 15 },
      { header: 'FD', key: 'finalDestination', width: 10  },
      { header: 'J/Type', key: 'jType', width: 7  },
      { header: 'F/Type', key: 'fType', width: 7  },
      { header: 'Cntrs', key: 'containers', width: 10  },
      { header: 'WT', key: 'weight', width: 5  },
      { header: 'Vol', key: 'volume', width: 5  },
      { header: 'Curr', key: 'currency', width: 5  },
      { header: 'Receivable', key: 'recievable', width: 12  },
      { header: 'Adjust', key: 'adjust', width: 12  },
      { header: 'Received', key: 'recieved', width: 12  },
      { header: 'Balance', key: 'balance', width: 12  },
      { header: 'Age', key: 'agingDays', width: 5  },
    /* Same rule as the table and the grid - a column this mode never
     * fills is not written to the sheet at all. */
    ].filter((c) => {
      const optional = {
        finalDestination: 'finalDestination',
        gdDate: 'gdDate',
        clientInvoiceNo: 'clientInvoiceNo',
        vendorTaxInvoiceNo: 'vendorTaxInvoiceNo',
        fType: 'freightType',
        containers: 'containers',
        weight: 'weight',
        volume: 'volume',
      }[c.key];
      return !optional || show(optional);
    });

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'D3D3D3' } 
      };
      cell.border = {
        right: { style: 'thin', color: { argb: '000000' } },
        left: { style: 'thin', color: { argb: '000000' } },
        top: { style: 'thin', color: { argb: '000000' } },
        bottom: { style: 'thin', color: { argb: '000000' } },
      }
      cell.font = {
        bold: true,
      };
    
      cell.alignment = {
        wrapText: true,
        horizontal: 'center',
        vertical: 'middle'
      };
    });
    const data = result.result
    .filter((x) => {
      if (query.options === 'exclude0') {
        return rowHasBalance(x);
      }
      return true; // Keep all items if `query.options` is not 'exclude0'
    }).map((x, i) => {
      const cols = jobColumns(x);
      return ({
        index: i + 1,
        // The same mapping the table uses - an export that disagrees with
        // what is on screen is the kind of thing nobody notices until a
        // customer sends the spreadsheet back.
        jobNo: cols.jobNo,
        invoiceNo: x.invoice_No,
        invoiceDate: moment(x.createdAt).format('DD-MM-YYYY'),
        doDate: "",
        hbl: cols.docPrimary,
        gdDate: cols.gdDate ? moment(cols.gdDate).format('DD-MM-YYYY') : '',
        clientInvoiceNo: cols.clientInvoiceNo,
        vendorTaxInvoiceNo: cols.vendorTaxInvoiceNo,
        party: x.party_Name,
        finalDestination: cols.finalDestination,
        jType: cols.jobType,
        fType: x.Charge_Heads.length>0?x.Charge_Heads[0].pp_cc:"-",
        containers: cols.containers || "-",
        weight: cols.weight,
        volume: cols.volume,
        currency: x.currency,
        recievable: commas(x.total),
        adjust: "0.00",
        payable: x.payType != "Recievable" ?commas(x.total):'-',
        recieved: x.payType == "Recievable" ?commas(x.recieved):commas(x.paid),
        paid: x.paid,
        balance: x.payType != "Recievable" ?commas(x.total-x.paid):commas(x.total-x.recieved),
        agingDays: getAge(x.createdAt)+1,
      });
    });

      worksheet.addRows(data);
      worksheet.addRow({
        balance: balanceTotal(result.result),
        recieved: paidReceivedTotal(result.result),
        adjust: "0.00",
        recievable: getTotal("Recievable", result.result),
        volume: "Total"
      })

      worksheet.columns.forEach((column) => {
        let maxWidth = 10; // Set a minimum width for each column
        column.eachCell({ includeEmpty: true }, (cell) => {
          if (cell.value) {
            const cellValueLength = cell.value.toString().length;
            if (cellValueLength > maxWidth) {
              maxWidth = cellValueLength + 2; // Add padding for better spacing
            }
          }
        });
        column.width = maxWidth;
      });

      worksheet.eachRow((row, rowIndex) => {
        row.eachCell((cell, colIndex) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
          };
        });
      });

      worksheet.insertRow(1, ['', '', '', '', '','Job Balancing Report', '', '', '', '', '', '', '', '', 'Date: From: ' + moment(query.from).format('DD-MM-YYYY') + ' To: ' + moment(query.to).format('DD-MM-YYYY'),]);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['', '', '', '', '', reportAddress(query.company)]);
      // The report's company - the header's for "All companies" - by its own
      // record. It named companies 1 and 2 as Seanet and Air Cargo Services,
      // which is only true on one install. See reportLetterheadId.
      worksheet.insertRow(1, ['', '', '', '', '', reportCompanyTitle(query.company)]);

      let cell = worksheet.getCell('F1');
      cell.font = {
        size: 18,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };    
      cell = worksheet.getCell('F2');
      cell.font = {
        size: 13,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      }; 
      cell = worksheet.getCell('O7');
      cell.font = {
        size: 13,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'right',
        vertical: 'middle'
      }; 
      cell = worksheet.getCell('F7');
      cell.font = {
        size: 16,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };   

      worksheet.mergeCells('F1:K1')
      worksheet.mergeCells('F2:K2')
      worksheet.mergeCells('O7:S7')
      worksheet.mergeCells('F7:K7')

      
      const lastRowIndex = worksheet.rowCount;

      // Merge cells in columns L and M for the last row
      const lastRow = worksheet.getRow(lastRowIndex);
      worksheet.mergeCells(lastRowIndex, 12, lastRowIndex, 13)
      lastRow.font={
        bold: true
      }

      if(aging){worksheet.addRow({
        invoiceNo: "Aging",
        jobNo: "0-30 Days",
        invoiceDate: "31-60 Days",
        doDate: "61-90 Days",
        hbl: "91-120 Days",
        party: "120-Above Days",
      })

      let lastlastRowIndex = worksheet.rowCount;
      let lastlastRow = worksheet.getRow(lastlastRowIndex);
      lastlastRow.font={
        bold: true
      }
      lastlastRow.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      }; 
      lastlastRow.eachCell((cell) => {
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } },
        };
    });

      let balance1 = 0.0;
      let balance2 = 0.0;
      let balance3 = 0.0;
      let balance4 = 0.0;
      let balance5 = 0.0;
      result.result
        .filter((x) => {
          if (query.options === "exclude0") {
            return rowHasBalance(x);
          }
          return true;
        })
        .forEach((x) => {
        if((getAge(x.createdAt)+1)>=0 && (getAge(x.createdAt)+1) <=30){
          x.payType == "Recievable"?
          balance1 += x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved):
          balance1 -= x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved)
        }
        if((getAge(x.createdAt)+1)>=31 && (getAge(x.createdAt)+1) <=60){
          x.payType == "Recievable"?
          balance2 += x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved):
          balance2 -= x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved)
        }
        if((getAge(x.createdAt)+1)>=61 && (getAge(x.createdAt)+1) <=90){
          x.payType == "Recievable"?
          balance3 += x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved):
          balance3 -= x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved)
        }
        if((getAge(x.createdAt)+1)>=91 && (getAge(x.createdAt)+1) <=120){
          x.payType == "Recievable"?
          balance4 += x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved):
          balance4 -= x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved)
        }
        if((getAge(x.createdAt)+1)>=120){
          x.payType == "Recievable"?
          balance5 += x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved):
          balance5 -= x.payType != "Recievable" ?parseFloat(x.total-x.paid):parseFloat(x.total-x.recieved)
        }
      })

      worksheet.insertRow(lastlastRowIndex+1, {
        jobNo: commas(balance1),
        invoiceDate: commas(balance2),
        doDate: commas(balance3),
        hbl: commas(balance4),
        party: commas(balance5),
      })
      lastlastRow = worksheet.getRow(lastlastRowIndex+1);
      worksheet.mergeCells(lastlastRowIndex, 2, lastlastRowIndex+1, 2)
      lastlastRow.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      }; 
      lastlastRow.eachCell((cell) => {
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } },
        };
    });}

      // Optionally, set other page setup options
      worksheet.pageSetup = {
        // Portrait, like every other printable this app produces. Safe to turn
        // even on a wide sheet because fitToWidth below scales the columns onto
        // one page across; only the rows spill, which they already did.
        //
        // The line that used to sit above this object set `orientation` and was
        // then overwritten by this very assignment - it never did anything.
        orientation: 'portrait',
        paperSize: 9, // A4 size
        fitToPage: true, // Enable fitting to a single page
        fitToWidth: 1, // Fit columns to one page
        fitToHeight: 0, // Allow rows to spill onto multiple pages
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.25,
          bottom: 0.25,
          header: 0,
          footer: 0,
        },
      };

      // Logo now comes from the Company record (functions/companyBranding.js).
      // null when that company has no logo uploaded - the sheet then gets no
      // image rather than another tenant's artwork.
      const imageBlob = await companyLogoBlob(query.company);
      if (imageBlob) {
        const imageId = workbook.addImage({
          buffer: await imageBlob.arrayBuffer(), // Convert Blob to ArrayBuffer
          extension: 'png', // Image extension
        });

        worksheet.addImage(imageId, {
          tl: { col: 0, row: 0 }, // Top-left position (column, row)
          ext: { width: 150, height: 100 }, // Image width and height
        });
      }

      try{
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'JobBalancing.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      }catch(e){
        console.error(e)
      }
  
    
    };

    const exportToExcelGrid = async () => {
      const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Invoice Report');

    /* The grid as it stands: its columns in the order they are on screen (a
       user may have dragged them), and its rows as filtered and sorted. The
       rows were keyed by hand here, and # and Paid/Rcvd never matched their
       columns - both always exported blank. */
    const columns = exportColumns();
    worksheet.columns = columns.map((col) => ({ header: col.heading, key: col.id }));

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'D3D3D3' } 
      };
      cell.border = {
        right: { style: 'thin', color: { argb: '000000' } },
        left: { style: 'thin', color: { argb: '000000' } },
        top: { style: 'thin', color: { argb: '000000' } },
        bottom: { style: 'thin', color: { argb: '000000' } },
      }
      cell.font = {
        bold: true,
      };
    
      cell.alignment = {
        wrapText: true,
        horizontal: 'center',
        vertical: 'middle'
      };
    });

      const shown = [];
      gridRef.current?.api?.forEachNodeAfterFilterAndSort?.((node) => shown.push(node.data));
      (gridRef.current?.api ? shown : records).forEach((x) => {
        worksheet.addRow(columns.map((c) => cellValue(c, x)));
      });
      // Money as numbers, so the sheet can add them up.
      columns.forEach((c, i) => { if (c.kind === 'money') worksheet.getColumn(i + 1).numFmt = '#,##0.00'; });
      const totalColumns = columns.length;

      worksheet.eachRow((row, rowIndex) => {
        // Iterate through cells only up to the total number of columns
        for (let colIndex = 1; colIndex <= totalColumns; colIndex++) {
          const cell = row.getCell(colIndex);
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
          };
        }
      });

      worksheet.columns.forEach((column) => {
        let maxWidth = 10; // Set a minimum width for each column
        column.eachCell({ includeEmpty: true }, (cell) => {
          if (cell.value) {
            const cellValueLength = cell.value.toString().length;
            if (cellValueLength > maxWidth) {
              maxWidth = cellValueLength + 2; // Add padding for better spacing
            }
          }
        });
        column.width = maxWidth;
      });

      worksheet.insertRow(1, ['', '', '', '', '','Job Balancing Grid']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['', '', '', '', '','Date: From: ' + query.from + ' To: ' + query.to,]);
      worksheet.insertRow(1, ['', '', '', '', '', reportAddress(query.company)]);
      // The report's company - the header's for "All companies" - by its own
      // record. It named companies 1 and 2 as Seanet and Air Cargo Services,
      // which is only true on one install. See reportLetterheadId.
      worksheet.insertRow(1, ['', '', '', '', '', reportCompanyTitle(query.company)]);

      let cell = worksheet.getCell('F1');
      cell.font = {
        size: 18,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };    
      cell = worksheet.getCell('F2');
      cell.font = {
        size: 13,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      }; 
      cell = worksheet.getCell('F3');
      cell.font = {
        size: 13,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      }; 
      cell = worksheet.getCell('F7');
      cell.font = {
        size: 16,  // Increase font size
        bold: true  // Make the text bold
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      }; 

      worksheet.mergeCells("F1:J1")
      worksheet.mergeCells("F2:J2")
      worksheet.mergeCells("F3:J3")
      worksheet.mergeCells("F7:J7")

      // Optionally, set other page setup options
      worksheet.pageSetup = {
        // Portrait, like every other printable this app produces. Safe to turn
        // even on a wide sheet because fitToWidth below scales the columns onto
        // one page across; only the rows spill, which they already did.
        //
        // The line that used to sit above this object set `orientation` and was
        // then overwritten by this very assignment - it never did anything.
        orientation: 'portrait',
        paperSize: 9, // A4 size
        fitToPage: true, // Enable fitting to a single page
        fitToWidth: 1, // Fit columns to one page
        fitToHeight: 0, // Allow rows to spill onto multiple pages
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.25,
          bottom: 0.25,
          header: 0,
          footer: 0,
        },
      };

      // Logo now comes from the Company record (functions/companyBranding.js).
      // null when that company has no logo uploaded - the sheet then gets no
      // image rather than another tenant's artwork.
      const imageBlob = await companyLogoBlob(query.company);
      if (imageBlob) {
        const imageId = workbook.addImage({
          buffer: await imageBlob.arrayBuffer(), // Convert Blob to ArrayBuffer
          extension: 'png', // Image extension
        });

        worksheet.addImage(imageId, {
          tl: { col: 0, row: 0 }, // Top-left position (column, row)
          ext: { width: 150, height: 100 }, // Image width and height
        });
      }

      try{
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'JobBalancingGrid.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      }catch(e){
        //console.log(e)
        console.error(e)
      }
    }

  const balanceTotal = (list) => {
    let balance = 0.00;
    list.filter((x) => {
        if (query.options == 'exclude0') {
          return rowHasBalance(x);
        }
        return true; // Keep all items if `query.options` is not 'exclude0'
      }).forEach((x) => {
      if (x.payType == "Payble") {
        balance = balance - parseFloat(x.total-x.paid)
      } else {
        balance = balance + parseFloat(x.total-x.recieved)
      }
    })
    return balance != 0 ? commas(balance) : (`(${commas(balance * -1)})`);
  }

  const getAge = (date) => {
    let date1 = new Date(date);
    let date2 = new Date();
    let difference = date2.getTime() - date1.getTime();
    return parseInt(difference / 86400000)
  }

  useEffect(() => {
    getValues(result);
    getUserName();
    async function getUserName() {
      let name = await Cookies.get("username");
      setUserName(name)
    }
    setLoad(false)

  }, [])

  async function getValues(value) {
    if (value.status == "success") {
    /* By date and time, oldest first; invoices stamped the same instant (a
       freight job's sailing day, a migrated invoice's date) in the order they
       were raised. Before the dates are turned into text below. */
    value.result.sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || ((a.id || 0) - (b.id || 0)));
    let newArray = [...value.result];
    await newArray.forEach((y, i) => {
      y.no = i + 1;
      /* WITH ITS ROUND OFF: the rounded total is what the ledger has the party
       * owing. The round off was added to the received / paid figures too, so
       * a balance never included it; and Credit added it twice. */
      const roundOff = parseFloat(y.roundOff) || 0
      y.balance = y.total!="0"?y.payType=="Recievable" ?
        (parseFloat(y.total) + roundOff - parseFloat(y.recieved)) :
        (parseFloat(y.total) + roundOff - parseFloat(y.paid)):(y.recieved*-1)
      y.total = parseFloat(y.total) + roundOff
      y.total1 = y.total
      y.paid = parseFloat(y.paid) || 0
      y.recieved = parseFloat(y.recieved) || 0
      y.age = getAge(y.createdAt);
      /* Derived ONCE, here, because this array feeds the table, the compact
       * print layout AND the CSV. See functions/invoiceJobColumns. */
      y.jobCols = jobColumns(y);
      /* Only a freight job has a freight type. The old expression
       * compared undefined against "Prepaid" and fell through to
       * "CC", so every aviation and customs row claimed Collect -
       * which is a value, not a blank. */
      y.freightType = y.jobCols.kind === 'freight'
        ? (y?.SE_Job?.freightType == "Prepaid" ? "PP" : "CC")
        : ''
      y.fd = y.jobCols.finalDestination;
      y.createdAt = moment(y.createdAt).format("DD-MMM-YY")
      y.hbl = y.jobCols.docPrimary
      y.ppcc = y.Charge_Heads.length>0?y.Charge_Heads[0].pp_cc?y.Charge_Heads[0].pp_cc:"-":"-"
      y.Receivable = y.payType == "Recievable" ? commas(y.total) : "-";
      y.payble = y.payType != "Recievable" ? commas(y.total) : "-";
      y.balanced = y.payType == "Recievable" ? commas(y.recieved) : y.paid;
      y.finalBalance = y.payType != "Recievable" ? (`${commas(y.balance)}`) : commas(y.balance)
      y.containers = y.jobCols.containers
      // Configuration > Companies, not names fixed to ids '1' and '3'.
      y.company = companyTitle(y.companyId, "-")
      y.customerRef = y.jobCols.customerRef
    })
    // Show All and Pending (jobs with no invoice - nothing owed) keep every row.
    if(query.options!="showall" && query.options!="pending"){
      newArray = await newArray.filter((x)=>{
        return hasBalance(x.balance)
      })

    }
    setRecords(newArray);
    } else {}
  }

  // Pagination Variables
  // Kept when the user switches tabs and comes back - functions/rememberedPage.
  const [currentPage, setCurrentPage] = useRememberedPage('jobBalancing');
  const [recordsPerPage] = useState(20);
  let indexOfLast = currentPage * recordsPerPage ;
  let indexOfFirst = indexOfLast - recordsPerPage;
  let currentRecords = records ? records.slice(indexOfFirst,indexOfLast) : [];

  useEffect(() => {
    indexOfFirst = currentPage * recordsPerPage;
    indexOfLast = indexOfFirst + recordsPerPage;
    console.log(result.result)
    currentRecords = records ? records.slice(indexOfFirst,indexOfLast) : [];
    console.log(currentRecords)
  },[currentPage])
  const noOfPages = records ? Math.ceil(records.length / recordsPerPage) : 0 ;
  // Pagination Variables
  
  const TableComponent = ({overflow}) => {
    return (
    <>
    {!load &&
      <>
      {result.result?.length > 0 &&
        <>
          <PrintTopHeader company={query.company} from={moment(query.from).format("DD-MM-YYYY")} to={moment(query.to).format("DD-MM-YYYY")}/>
          <hr className='mb-2' />
          <div className='table-sm-1' style={{ maxHeight: overflow ? 530 : "50%", overflowY: 'auto' }}>
          <Table className='tableFixHead' bordered style={{ fontSize: 11 }}>
            <thead>
              <tr>
                <th className='text-center'>#</th>
                <th className='text-center' style={{ minWidth: 110 }}>Inv. No</th>
                <th className='text-center' style={{ minWidth: 110 }}>Job. No</th>
                {/* THE MONEY FIRST, after the two numbers a row is found by. It
                    was the last six columns, behind up to twenty of job detail,
                    so the figures this report exists for were off the right
                    edge of the screen and every row needed a sideways scroll. */}
                <th className='text-center'>Currency</th>
                <th className='text-center' style={{ minWidth: 100 }}>Receivable</th>
                <th className='text-center'style={{ minWidth: 100 }}>Payable</th>
                <th className='text-center'style={{ minWidth: 100 }}>Paid/Recieved</th>
                {/* <th className='text-center'style={{ minWidth: 100 }}>Paid</th> */}
                <th className='text-center'style={{ minWidth: 100 }}>Balance</th>
                <th className='text-center'>Age</th>
                <th className='text-center' style={{ minWidth: 90 }}>Job. Date</th>
                <th className='text-center' style={{ minWidth: 90 }}>Date</th>
                <th className='text-center' style={{ minWidth: 100 }}>{docs.primary}</th>
                <th className='text-center' style={{ minWidth: 100 }}>{docs.secondary}</th>
                {show('gdDate') && <th className='text-center' style={{ minWidth: 90 }}>GD Date</th>}
                {show('clientInvoiceNo') && <th className='text-center' style={{ minWidth: 100 }}>Client Invoice #</th>}
                {show('vendorTaxInvoiceNo') && <th className='text-center' style={{ minWidth: 100 }}>Vendor Tax Inv #</th>}

                {show('sailDate') && <th className='text-center' style={{ minWidth: 100 }}>Sailing Date</th>}
                {show('arrivalDate') && <th className='text-center'style={{ minWidth: 100 }}>Arrival Date</th>}
                <th className='text-center'style={{ minWidth: 200 }}>Name</th>
                {show('clientCode') && <th className='text-center'style={{ minWidth: 100 }}>Client Code</th>}
                {show('shipper') && <th className='text-center'style={{ minWidth: 100 }}>Shipper</th>}
                {show('consignee') && <th className='text-center' style={{ minWidth: 100 }}>Consignee</th>}
                {show('salesRep') && <th className='text-center'style={{ minWidth: 100 }}>Sales Representator</th>}
                {show('shippingLine') && <th className='text-center'style={{ minWidth: 100 }}>Shipping Line</th>}
                {show('vessel') && <th className='text-center' style={{ minWidth: 100 }}>Vessel</th>}
                {show('finalDestination') && <th className='text-center'style={{ minWidth: 100 }}>F. Dest</th>}
                <th className='text-center'>J/Tp</th>
                {show('freightType') && <th className='text-center'>F/Tp</th>}
                {show('weight') && <th className='text-center'>Weight</th>}
                {show('volume') && <th className='text-center'>Volume</th>}
              </tr>
            </thead>
            <tbody>
              {/* without print  */}
              {console.log("Length: ", currentRecords.length)}
              {overflow ? currentRecords.map((x,i)=>{
              return (
                <tr key={i}>
                  <td style={{ maxWidth: 10 }}>{i + 1}</td>
                  <td 
                    className="blue-txt"
                    style={{ width: 90, cursor:"pointer"}}
                    onClick={async ()=>{
                      // The invoice - or, on an advance row, its voucher (docLink).
                      const link = docLink(x);
                      if (!link) return;
                      await Router.push(link.href)
                      dispatch(incrementTab(link.tab))
                    }}
                  >{x.invoice_No}</td>
                  <td 
                    style={{ width: 90, cursor:"pointer"}} 
                    className="blue-txt"
                    onClick={()=>{
                      // A freight job, a flight or a goods declaration -
                      // one rule, shared with anything else offering the same
                      // click. See functions/invoiceJobColumns.jobLink.
                      const link = jobLink(x);
                      if (!link) return;
                      dispatch(incrementTab(link.tab));
                      Router.push(link.href);
                    }
                  }>
                    {x.jobCols?.jobNo}
                  </td>
                  <td style={{width:20}}>{x.currency}</td>
                  <td style={{ textAlign: 'right' }} >{x.payType == "Recievable" ?commas(x.total):'-'}</td>
                  <td style={{ textAlign: 'right' }} >{x.payType != "Recievable" ?commas(x.total):'-'}</td>
                  <td style={{ textAlign: 'right' }} >{x.payType == "Recievable" ?commas(x.recieved):commas(x.paid)}</td>
                  <td style={{ textAlign: 'right' }} >{commas(x.balance)}</td>
                  <td style={{ width: 1 }}>{getAge(x.createdAt)+1}</td>
                  <td style={{width:150}}>{fmtDate(x.jobCols?.jobDate)}</td>
                  <td style={{}}>{moment(x.createdAt).format('DD-MMM-YYYY')}</td>
                  <td style={{width:50}}>{x.jobCols?.docPrimary}</td>
                  <td style={{width:50}}>{x.jobCols?.docSecondary}</td>
                  {show('gdDate') && <td style={{width:90}}>{fmtDate(x.jobCols?.gdDate)}</td>}
                  {show('clientInvoiceNo') && <td style={{width:100}}>{x.jobCols?.clientInvoiceNo}</td>}
                  {show('vendorTaxInvoiceNo') && <td style={{width:100}}>{x.jobCols?.vendorTaxInvoiceNo}</td>}
                  {show('sailDate') && <td style={{width:50}}>{fmtDate(x.jobCols?.sailDate)}</td>}
                  {show('arrivalDate') && <td style={{width:50}}>{fmtDate(x.jobCols?.arrivalDate)}</td>}
                  <td style={{width:150}}><b>{x.party_Name}</b></td>
                  {show('clientCode') && <td style={{width:150}}><b>{x.jobCols?.clientCode}</b></td>}
                  {show('shipper') && <td style={{width:150}}><b>{x.jobCols?.shipper}</b></td>}
                  {show('consignee') && <td style={{width:150}}><b>{x.jobCols?.consignee}</b></td>}
                  {show('salesRep') && <td style={{width:150}}><b>{x.jobCols?.salesRep}</b></td>}
                  {show('shippingLine') && <td style={{ maxWidth: 70 }}>{x.jobCols?.shippingLine}</td>}
                  {show('vessel') && <td style={{ maxWidth: 70 }}>{x.jobCols?.vessel}</td>}
                  {show('finalDestination') && <td style={{ maxWidth: 70 }}>{x.jobCols?.finalDestination}</td>}
                  <td style={{width:20}}>{x.jobCols?.jobType}</td>
                  {show('freightType') && <td style={{width:20}}>{x.freightType}</td>}
                  {show('weight') && <td style={{width:20}}>{x.jobCols?.weight}</td>}
                  {show('volume') && <td style={{width:20}}>{x.jobCols?.volume}</td>}
                </tr>
              )}) : 
              // print mode 
              currentRecords.map((x, i) => {
                  return (
                  <tr key={i}>
                    <td style={{ maxWidth: 30 }}>{i + 1}</td>
                    <td style={{ maxWidth: 90, paddingLeft: 3, paddingRight: 3, cursor:"pointer"}} className="blue-txt"
                      onClick={async ()=>{
                        const link = docLink(x);
                        if (!link) return;
                        await Router.push(link.href)
                        dispatch(incrementTab(link.tab))
                      }}
                    >{x.invoice_No}</td>
                    <td style={{}}>{x.createdAt}</td>
                    <td style={{}}>{x.hbl}</td>
                    <td style={{}}>{x.party_Name}</td>
                    <td style={{ maxWidth: 90 }}>{x.fd}</td>
                    <td style={{}}>{x.freightType}</td>
                    <td style={{}}>{x.currency}</td>
                    <td style={{ textAlign: 'right' }} >{x.payType == "Recievable" ? x.total : "-"}</td>
                    <td style={{ textAlign: 'right' }} >{x.payType != "Recievable" ? x.total : "-"}</td>
                    <td style={{ textAlign: 'right' }} >{x.payType == "Recievable" ? x.recieved : x.paid}</td>
                    <td style={{ textAlign: 'right' }} >{x.payType != "Recievable" ? (`${x.balance}`) : x.balance}</td>
                    <td style={{ textAlign: 'center' }}>{x.age}</td>
                  </tr>
                  )
              })}
              {/* in print */}
              {!overflow && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'right' }}><b>Total</b></td>
                  <td style={{ textAlign: 'right' }}>{getTotal("Recievable", result.result)}</td>
                  <td style={{ textAlign: 'right' }}>{getTotal("Payble", result.result)}</td>
                  <td style={{ textAlign: 'right' }}>{paidReceivedTotal(result.result)}</td>
                  <td style={{ textAlign: 'right' }}>{balanceTotal(result.result)}</td>
                  <td style={{ textAlign: 'center' }}>-</td>
                </tr>
              )}
              {/* showing total in the last page  */}
              {/* {//console.log(overflow, currentPage, noOfPages)} */}
              {overflow && currentPage === noOfPages && (
                <tr>
                  {/* One span up to the money, counted from the columns
                      this mode actually shows - see leadColumns. */}
                  {/* The money now follows #, Inv. No, Job. No and Currency, so
                      the label spans those four and the job detail after the
                      money is one blank cell - see leadColumns. */}
                  <td colSpan={4} style={{ textAlign: 'right' }}><b>Grand Total</b></td>
                  <td style={{ textAlign: 'right' }}>{getTotal("Recievable", result.result)}</td>
                  <td style={{ textAlign: 'right' }}>{getTotal("Payble", result.result)}</td>
                  <td style={{ textAlign: 'right' }}>{paidReceivedTotal(result.result)}</td>
                  <td style={{ textAlign: 'right' }}>{balanceTotal(result.result)}</td>
                  <td style={{ textAlign: 'center' }}>-</td>
                  <td colSpan={leadColumns - 4}></td>
                </tr>
              )}
            </tbody>
          </Table>
          </div>
          {overflow && <div className="d-flex justify-content-end mt-4">
            <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={setCurrentPage}/>
          </div>
          }
        </>
      }
      {result.result.length == 0 && <>No Similar Record</>}
      </>
    }
    {load && <div className='text-center py-5 my-5'> <Spinner /> </div>}
    </>
  )}

  function dateCellFormatter(params) {
    const date = moment(params.value);
    return date.isValid() ? date.format('DD-MMM-YYYY') : null;
}

  const gridRef = useRef();
  /* THE GRID'S COLUMNS - see functions/jobBalancingColumns. It opens on the
     columns Config > Reports names (all of them, if none), and the
     user ticks columns on and off for themselves; their picks last the
     browser session. */
  const columnDefs = useMemo(() => shownIds.map((id) => {
    const c = available.find((x) => x.id === id);
    const def = { headerName: c.heading, field: c.id };
    if (c.id !== 'no') def.filter = true;
    if (c.kind === 'invoice') {
      def.cellRenderer = (params) => (
        <span style={{cursor:"pointer"}} onClick={ async()=>{
          const link = docLink(params.data);
          if (!link) return;
          await Router.push(link.href)
          dispatch(incrementTab(link.tab))
        }}>{params.data.invoice_No}</span>
      );
    }
    if (c.kind === 'date') def.cellRenderer = dateCellFormatter;
    if (c.kind === 'money') def.cellRenderer = (params) => <>{commas(cellValue(c, params.data))}</>;
    return def;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shownIds.join(','), available]);

  /* The grid keeps its columns where they are when it is handed new ones, so
     a column dragged aside stays put when another is ticked on - and Default
     and All would bring the right columns back in the wrong order. They put
     the order back too. The grid takes the new columns in its own effect,
     which runs before this one. */
  useEffect(() => {
    if (!reorder) return;
    gridRef.current?.columnApi?.applyColumnState({ state: shownIds.map((colId) => ({ colId })), applyOrder: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reorder]);

  const defaultColDef = useMemo(() => ({ 
    sortable: true,
    resizable: true,
    filter: "agTextColumnFilter",
    floatingFilter: true,
  }));
  const getRowHeight = 38;

  /* THE TITLE, PRINT AND EXCEL on the toolbar (PageActions). Print presses
   * the viewer's ReactToPrint through a hidden trigger (the grid view never
   * printed); Excel is the viewer's export or the grid's. Show Aging and the
   * Columns picker stay on the page - they shape the report. */
  const printTriggerRef = useRef(null);
  const viewer = query.report == "viewer";
  usePageActions({
    title: 'Job Balancing',
    subtitle: query.from ? `${moment(query.from).format("DD-MM-YYYY")} to ${moment(query.to).format("DD-MM-YYYY")}` : undefined,
    print: {
      onClick: () => printTriggerRef.current?.click(),
      disabled: !viewer,
      title: viewer ? 'Print the report' : 'Print from the report view',
    },
    excel: {
      onClick: () => (viewer ? exportToExcel() : exportToExcelGrid()),
      title: viewer ? 'Export the report to Excel' : 'Export the grid to Excel',
    },
  }, [viewer, query.from, query.to]);

  return (
  <div className='base-page-layout'>
    {query.report == "viewer" && (
      <>
        <ReactToPrint content={() => inputRef} trigger={() => <button type='button' ref={printTriggerRef} style={{ display: 'none' }} aria-hidden='true' />} />
        <div className="d-flex justify-content-end " >
          <label style={{display:"flex", alignItems:"center"}}>
            <span style={{marginRight:5}}>Show Aging</span>
            <input type="checkbox" checked={aging} onChange={(e) => setAging(e.target.checked)}></input>
          </label>
        </div>
      </>
    )}
    {query.report != "viewer" && (
      <>
        {/* <ReactToPrint content={() => inputRef} trigger={() => <AiFillPrinter className="blue-txt cur fl-r" size={30} />} /> */}
        {/* <---- Excel Download button ----> */}
        <div className="d-flex justify-content-end " style={{paddingBottom: 10}}>
          <Popover trigger="click" placement="bottomRight" title="Columns" content={
            <div style={{ minWidth: 220 }}>
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {pickerOrder(available, defaults).map((id) => (
                  <div key={id}>
                    <Checkbox checked={shownIds.includes(id)} onChange={(e) => toggleColumn(id, e.target.checked)}>
                      {available.find((c) => c.id === id).heading}
                    </Checkbox>
                  </div>
                ))}
              </div>
              <div className="d-flex justify-content-between mt-2 pt-2" style={{ borderTop: '1px solid #f0f0f0' }}>
                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => reset(null)}
                  title="The columns set in Configuration > Reports">Default</button>
                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => reset(available.map((c) => c.id))}>All</button>
              </div>
            </div>
          }>
            <button type="button" className="btn-custom px-3 mx-2">Columns ({shownIds.length})</button>
          </Popover>
        </div>
      </>
    )}
    {/* <---- Reports View only ----> */}
    {query.report == "viewer" && <TableComponent overflow={true}/>}
    {/* <---- list View only with filteration ----> */}
    {query.report != "viewer" && configured === undefined &&
      <div className='text-center py-5 my-5'> <Spinner /> </div>}
    {query.report != "viewer" && configured !== undefined &&
    <div className="ag-theme-alpine" style={{ width: "100%", height: '72vh' }}>
      {/* {//console.log(records)} */}
      <AgGridReact
        ref={gridRef} // Ref for accessing Grid's API
        rowData={records} // Row Data for Rows
        columnDefs={columnDefs} // Column Defs for Columns
        maintainColumnOrder={true} // a dragged column stays put when another is ticked on
        defaultColDef={defaultColDef} // Default Column Properties
        animateRows={true} // Optional - set to 'true' to have rows animate when sorted
        rowSelection='multiple' // Options - allows click selection of rows
        getRowHeight={getRowHeight}
        pagination={true}
        paginationPageSize={50}
      />
    </div>
    }
    {/* THE PRINT - its own layout (JobBalancingPrint): every row, A4
        landscape, headings that match the cells. It was the screen table -
        one page of it, clipped in a scroll box, under the wrong headings. */}
    <div style={{ display: 'none' }}>
      <div ref={(response) => (inputRef = response)}>
        {/* Totals are worked out in the print from the rows it prints, one
            line per currency, so the Total line always adds up to the page
            above it - the screen's single total adds every currency together. */}
        <JobBalancingPrint
          records={records}
          company={query.company}
          from={moment(query.from).format("DD-MMM-YYYY")}
          to={moment(query.to).format("DD-MMM-YYYY")}
          docLabel={docs.primary}
          mode={mode}
          showAge={aging}
          printedBy={username}
        />
      </div>
    </div>
  </div>
  )
};

export default React.memo(JobBalancingReport)
