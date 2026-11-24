import moment from 'moment';
import { useRememberedPage } from 'functions/rememberedPage';
import ReactToPrint from 'react-to-print';
import { Spinner, Table } from "react-bootstrap";
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import PrintTopHeader from 'Components/Shared/PrintTopHeader';
import AgentBalancingPrint from './AgentBalancingPrint';
import Cookies from "js-cookie";
import { AiFillPrinter } from "react-icons/ai";
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import Router from 'next/router';
import { AgGridReact } from 'ag-grid-react';
import { CSVLink } from "react-csv";
import Pagination from "Components/Shared/Pagination";
import ExcelJS from "exceljs";
import { FileExcelOutlined } from '@ant-design/icons';
import { companyLogoBlob, companyTitle, reportCompanyTitle, reportAddress } from 'functions/companyBranding';
import { agentBalancingFigures, agentBalancingTotals, withCnSign } from 'functions/agentBalancing';
import { Switch } from 'antd';
import { hasBalance } from 'functions/invoiceOwed';
import { usePageActions } from 'Components/Shared/PageActions';


// The grid's Date column holds "DD-MMM-YYYY" text; compare the dates it names.
const byShownDate = (a, b) => moment(a, 'DD-MMM-YYYY').valueOf() - moment(b, 'DD-MMM-YYYY').valueOf();

const InvoiceBalancingReport = ({ result, query }) => {
  let inputRef = useRef(null);
  const dispatch = useDispatch();
  const [load, setLoad] = useState(true);
  const [records, setRecords] = useState([]);
  const [username, setUserName] = useState("");
  /* A CN'S FIGURES ARE BELOW ZERO - its Credit, Paid/Rcvd and Balance - in
     every view, print and export (functions/agentBalancing withCnSign; the
     user, 2026-11-16). The rows shown, printed and exported come from
     `shown`; the totals stay on `records`, which already net CN against DN.
     ONE AMOUNT COLUMN is the switch that is left: Debit and Credit as one
     signed Amount. It was "CN as negative", and the sign came only with it. */
  const [oneAmount, setOneAmount] = useState(false);
  const shown = useMemo(() => records.map((x) => withCnSign(x)), [records]);
  // The merged Amount's total: every DN less every CN.
  const amountTotal = (t) => signed(Math.round((t.debit - t.credit) * 100) / 100);
  // The Credit total, as the Credit column shows its rows: below zero.
  const creditTotal = (t) => signed(-t.credit);
  const commas = (a) => a ? parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : '0.0';

  console.log("Result:", result)

  /* The Total lines - one, or one per currency under All. See
     functions/agentBalancing: these replace three totals worked out here, the
     Paid / Rcvd one converting already-converted PKR figures a second time. */
  const totalLines = agentBalancingTotals(records, query.currency);
  const totalLabel = (t) => (totalLines.length > 1 ? `Total ${t.currency}` : 'Total');
  const signed = (n) => (n >= 0 ? commas(n) : `(${commas(-n)})`);

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
  }, [])

  async function getValues(value) {
    // console.log(value.result)
    if (value.status == "success") {
      /* Oldest first, by the actual date - the report, its print and both
         Excel exports read in this order. The server sends them so now; this
         keeps it so whatever an older one sends (it used to send them in
         storage order, 2026 invoices before 2022). */
      let newArray = [...value.result].sort((a, b) =>
        (new Date(a.createdAt) - new Date(b.createdAt)) || ((a.id || 0) - (b.id || 0)));
      /* The figures for both views come from functions/agentBalancing - as
         numbers, every one converted at the same rate. The PKR view made its
         balance from formatted text and printed NaN. */
      newArray.forEach((x, i) => {
        Object.assign(x, agentBalancingFigures(x, query.currency));
        x.index = i + 1
        x.createdAt = moment(x.createdAt).format("DD-MMM-YYYY")
        x.age = getAge(x.createdAt);
        x.blHbl = x.SE_Job?.Bl?.hbl
        x.blMbl = x.SE_Job?.Bl?.mbl?x.SE_Job?.Bl?.mbl:"-"
        x.fd = x.SE_Job?.fd
        x.ppcc = x.Charge_Heads?.length>0?x.Charge_Heads[0]?.pp_cc:null
        x.subType = x.SE_Job?.subType
        x.shipper = x.SE_Job?.shipper?.name
        x.salesRep = x.SE_Job?.sales_representator?.name
        x.wt = x.SE_Job?.weight
        x.vol = x.SE_Job?.vol
        x.dnCn = x.payType == "Recievable"? "DN" : "CN"
        x.op = x.SE_Job?.operation
        x.company = companyTitle(x.companyId, "-")
        x.fileNo = x.SE_Job?.fileNo
        x.customerRef = x.SE_Job?.customerRef
        x.containers = x.SE_Job?.SE_Equipments?x.SE_Job.SE_Equipments.map((x) => x.size).join(","):"-"
        x.jobClient = x.SE_Job?.Client?.name?x.SE_Job?.Client?.name:"-"
        x.clientRecievable = x.SE_Job?.client?.name?x.SE_Job?.client?.name:"-"
        x.clientRecieved = x.SE_Job?.client?.name?x.SE_Job?.client?.name:"-"
        x.clientOutstanding = x.SE_Job?.client?.name?x.SE_Job?.client?.name:"-"
        x.arrivalDate = x.SE_Job?.arrivalDate?x.SE_Job?.arrivalDate:"-"
        x.sailingDate = x.SE_Job?.shipDate?x.SE_Job?.shipDate:"-"
        x.vessel = x.SE_Job?.vessel?.name?x.SE_Job?.vessel?.name:"-"
        x.voyage = x.SE_Job?.Voyage?.voyage?x.SE_Job?.Voyage?.voyage:"-"
      })
      console.log(query.balance)
      if(query.balance=="exclude0"){
        newArray = newArray.filter((x) => hasBalance(x.balance))
      }
      setRecords(newArray);
    }
    setLoad(false)
  };

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

    worksheet.columns = [
      { header: '#', key: 'index', width: 3 },
      { header: 'Inv. No', key: 'invoice_No', width: 15  },
      // { header: 'Job. No', key: 'jobNo', width: 15  },
      { header: 'Date', key: 'date', width: 12  },
      { header: 'HBL', key: 'hbl', width: 10  },
      { header: 'Agent', key: 'party_Name', width: 30  },
      { header: 'F. Dest', key: 'fd', width: 12  },
      { header: 'J/Tp', key: 'jt', width: 7 },
      { header: 'F/Tp', key: 'ft', width: 7 },
      { header: 'Cntrs', key: 'container', width: 15  },
      { header: 'WT', key: 'weight', width: 6 },
      { header: 'Vol', key: 'vol', width: 6 },
      { header: 'Curr', key: 'currency', width: 6 },
      ...(oneAmount
        ? [{ header: 'Amount', key: 'amount', width: 10 }]
        : [{ header: 'Debit', key: 'debit', width: 10  }, { header: 'Credit', key: 'credit', width: 10  }]),
      { header: 'Paid/Rcvd', key: 'paidRec', width: 10  },
      { header: 'Balance', key: 'balance', width: 10  },
      { header: 'Age', key: 'age', width: 5  },
    ];

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
    const data = shown
      // The same rule as the screen. Math.floor dropped every invoice owing
      // less than 1 (a real 0.50 vanished) and kept a -0.001 hair.
      .filter((x) => (query.balance === 'exclude0' ? hasBalance(x.balance) : x))
      .map((x, i) => ({
        index: i + 1,
        invoice_No: x.invoice_No,
        jobNo: x.SE_Job?.jobNo,
        date: x.createdAt,
        hbl: x?.SE_Job?.Bl?.hbl,
        party_Name: x.party_Name,
        fd: x.SE_Job?.fd,
        jt: x.SE_Job?.subType,
        ft: x.Charge_Heads.length>0?x.Charge_Heads[0].pp_cc:null,
        container: x.containers,
        weight: x.SE_Job?.weight,
        vol: x.SE_Job?.vol,
        currency: x.currency,
        debit: x.debit,
        credit: x.credit,
        amount: x.amount,
        paidRec: x.paidRec,
        balance: x.balance,
        age: x.age,
      }));

      worksheet.addRows(data);
      totalLines.forEach((t) => worksheet.addRow({
        balance: signed(t.balance),
        adjust: "0.00",
        ...(oneAmount ? { amount: amountTotal(t) } : { credit: creditTotal(t), debit: commas(t.debit) }),
        paidRec: signed(t.paidRec),
        vol: totalLabel(t)
      }))

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

      worksheet.insertRow(1, ['', '', '', '', '','Agent Invoice Balancing Report', '', '', '', '', '', 'Date: From: ' + moment(query.from).format('DD-MM-YYYY') + ' To: ' + moment(query.to).format('DD-MM-YYYY'),]);
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
      cell = worksheet.getCell('L7');
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
      worksheet.mergeCells('L7:P7')
      worksheet.mergeCells('F7:K7')

      
      const lastRowIndex = worksheet.rowCount;

      // Merge cells in columns L and M for the last row
      const lastRow = worksheet.getRow(lastRowIndex);
      worksheet.mergeCells(lastRowIndex, 11, lastRowIndex, 12)
      lastRow.font={
        bold: true
      }

      worksheet.addRow(['']);


      worksheet.addRow({
        invoice_No: "Aging",
        date: "0-30 Days",
        party_Name: "31-60 Days",
        fd: "61-90 Days",
        ft: "91-120 Days",
        weight: "120-Above Days",
      })

      let lastlastRowIndex = worksheet.rowCount;
      // lastlastRowIndex++
      let lastlastRow = worksheet.getRow(lastlastRowIndex);
      worksheet.mergeCells(lastlastRowIndex, 3, lastlastRowIndex, 4)
      worksheet.mergeCells(lastlastRowIndex, 6, lastlastRowIndex, 7)
      worksheet.mergeCells(lastlastRowIndex, 8, lastlastRowIndex, 9)
      worksheet.mergeCells(lastlastRowIndex, 10, lastlastRowIndex, 12)
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

      /* THE AGEING LINE - receivables less payables, by age. The balance is a
         number (functions/agentBalancing); this read it as the old formatted
         text, "(1,234.00)".slice(1, -1), which throws on a number - so the
         export failed on the first row with a balance. 120 days was also in
         two buckets at once. From the figures as they are, whatever the CN
         sign option shows. */
      const buckets = [0, 0, 0, 0, 0];
      records.filter((x) => (query.balance === 'exclude0' ? hasBalance(x.balance) : x)).forEach((x) => {
        const amount = (x.payType === 'Payble' ? -1 : 1) * (Number(x.balance) || 0);
        const i = x.age <= 30 ? 0 : x.age <= 60 ? 1 : x.age <= 90 ? 2 : x.age <= 120 ? 3 : 4;
        buckets[i] += amount;
      });
      const [balance1, balance2, balance3, balance4, balance5] = buckets.map((b) => Math.round(b * 100) / 100);

      worksheet.insertRow(lastlastRowIndex+1, {
        // invoice_No: "Aging",
        date: balance1,
        party_Name: balance2,
        fd: balance3,
        ft: balance4,
        weight: balance5,
      })
      // lastlastRowIndex = worksheet.rowCount;
      // lastlastRowIndex++
      lastlastRow = worksheet.getRow(lastlastRowIndex+1);
      worksheet.mergeCells(lastlastRowIndex, 2, lastlastRowIndex+1, 2)
      worksheet.mergeCells(lastlastRowIndex+1, 3, lastlastRowIndex+1, 4)
      worksheet.mergeCells(lastlastRowIndex+1, 6, lastlastRowIndex+1, 7)
      worksheet.mergeCells(lastlastRowIndex+1, 8, lastlastRowIndex+1, 9)
      worksheet.mergeCells(lastlastRowIndex+1, 10, lastlastRowIndex+1, 12)
      // lastlastRow.font={
      //   bold: true
      // }
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
        link.download = 'AgentInvoiceBalancingReport.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      }catch(e){
        console.log(e)
        console.error(e)
      }
  
    
    };
    const exportToExcelGrid = async () => {
      const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Invoice Report');
      // console.log(columnDefs)

    worksheet.columns = columnDefs.map((col) => ({
      header: col.headerName,
      key: col.field,
      width: col.width
    }))

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
    const data = [...shown]

      worksheet.addRows(data);
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

      worksheet.insertRow(1, ['', '', '', '', '','Agent Invoice Balancing Grid']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['', '', '', '', '','Date: From: ' + moment(query.from).format('DD-MM-YYYY') + ' To: ' + moment(query.to).format('DD-MM-YYYY'),]);
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

      worksheet.mergeCells("F1:H1")
      worksheet.mergeCells("F2:H2")
      worksheet.mergeCells("F3:H3")
      worksheet.mergeCells("F7:H7")

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
        link.download = 'AgentInvoiceBalancingGrid.xlsx';
        link.click();
        window.URL.revokeObjectURL(url);
      }catch(e){
        console.log(e)
        console.error(e)
      }
    }
  
  // Pagination Variables
  // Kept when the user switches tabs and comes back - functions/rememberedPage.
  const [currentPage, setCurrentPage] = useRememberedPage('invoiceBalancing');
  const [recordsPerPage] = useState(20);
  const indexOfLast = currentPage * recordsPerPage ;
  const indexOfFirst = indexOfLast - recordsPerPage;
  const currentRecords = shown ? shown.slice(indexOfFirst,indexOfLast) : [];
  const noOfPages = records ? Math.ceil(records.length / recordsPerPage) : 0 ;
  // Pagination Variables
  const TableComponent = ({overflow}) => {
    return (
    <>
      {!load &&
        <>
          {records.length > 0 &&
            <>
              <PrintTopHeader company={query.company} from={moment(query.from).format('DD-MM-YYYY')} to={moment(query.to).format('DD-MM-YYYY')} />
              <hr className='mb-1' />
              <div className='table-sm-1' style={{ maxHeight: overflow ? 600 : "100%", overflowY: 'auto' }}>
                <Table className='tableFixHead' bordered style={{ fontSize: 12 }} ref={inputRef}>
                  <thead>
                    <tr>
                      <th className='text-center'>#</th>
                      <th className='text-center'style={{ minWidth: 100 }}>Inv. No</th>
                      <th className='text-center'style={{ minWidth: 100 }}>Job. No</th>
                      <th className='text-center' style={{ minWidth: 100 }}>Date</th>
                      <th className='text-center' >HBL/HAWB</th>
                      <th className='text-center'style={{ minWidth: 200 }}>Name</th>
                      <th className='text-center' style={{ minWidth: 100 }}>F. Dest</th>
                      <th className='text-center'>J/Tp</th>
                      <th className='text-center'>F/Tp</th>
                      <th className='text-center'>Container</th>
                      <th className='text-center'>Weight</th>
                      <th className='text-center'>Volume</th>
                      <th className='text-center'>Curr</th>
                      {oneAmount
                        ? <th className='text-center' style={{ minWidth: 100 }}>Amount</th>
                        : <>
                          <th className='text-center'style={{ minWidth: 100 }}>Debit</th>
                          <th className='text-center'style={{ minWidth: 100 }}>Credit</th>
                        </>}
                      <th className='text-center'style={{ minWidth: 100 }}>Paid/Rcvd</th>
                      <th className='text-center'style={{ minWidth: 100 }}>Balance</th>
                      <th className='text-center'>Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRecords.map((x, i) => {
                      // console.log(x)
                    return (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td
                          className="blue-txt"
                          style={{ width: 90, cursor:"pointer"}} 
                          onClick={async ()=>{
                            
                            await Router.push(`/reports/invoice/${x.id}`)
                            dispatch(incrementTab({ "label": "Invoice Details", "key": "3-17", "id":`${x.id}`}))
                          }}
                        >{x.invoice_No}</td>
                        <td
                          className="blue-txt"
                          style={{ width: 90, cursor:"pointer"}} 
                          onClick={()=>{
                            let type = x?.SE_Job?.operation;
                            if(x?.SE_Job?.jobNo){
                              dispatch(incrementTab({
                              "label":type=="SE"?"SE JOB":type=="SI"?"SI JOB":type=="AE"?"AE JOB":"AI JOB",
                              "key":type=="SE"?"4-3":type=="SI"?"4-6":type=="AE"?"7-2":"7-5",
                              "id":x.SE_Job.id
                              }))
                              Router.push(type=="SE"?`/seaJobs/export/${x.SE_Job.id}`:type=="SI"?`/seaJobs/import/${x.SE_Job.id}`:
                                type=="AE"?`/airJobs/export/${x.SE_Job.id}`:`/airJobs/import/${x.SE_Job.id}`
                              )
                            } else if(x?.aviation?.jobId){
                              // An aviation invoice has no SE_Job - its charges hang off an
                              // AWB, and the backend attaches the flight as `aviation`.
                              dispatch(incrementTab({
                                "label": x.aviation.jobNo || "Aviation Job",
                                "key": "10-2",
                                "id": `${x.aviation.jobId}`
                              }))
                              Router.push(`/aviationJobs/${x.aviation.jobId}`)
                            } else if(x?.customs?.jobId){
                              // A customs invoice has no SE_Job either - its charges hang
                              // off a goods declaration, attached as `customs`.
                              dispatch(incrementTab({
                                "label": x.customs.jobNo || "Customs Job",
                                "key": "11-2",
                                "id": `${x.customs.jobId}`
                              }))
                              Router.push(`/customsJobs/${x.customs.jobId}`)
                            }
                          }
                        }
                        >{x.SE_Job?.jobNo || x.aviation?.jobNo || x.customs?.jobNo}</td>
                        <td>{x.createdAt}</td>
                        <td>{x?.SE_Job?.Bl?.hbl}</td>
                        <td>{x.party_Name}</td>
                        <td>{x.SE_Job?.fd}</td>
                        <td>{x.SE_Job?.subType}</td>
                        <td>{x.Charge_Heads.length>0&&x.Charge_Heads[0].pp_cc}</td>
                        <td>{x.SE_Job?.container}</td>
                        <td>{x.SE_Job?.weight}</td>
                        <td>{x.SE_Job?.vol}</td>
                        <td>{x.currency}</td>
                        {oneAmount
                          ? <td>{commas(x.amount)}</td>
                          : <><td>{commas(x.debit)}</td><td>{commas(x.credit)}</td></>}
                        <td>{commas(x.paidRec)}</td>
                        <td>{commas(x.balance)}</td>
                        <td>{x.age}</td>
                      </tr>
                    )})}
                    {totalLines.map((t) => (
                    <tr key={t.currency}>
                      <td colSpan={13} style={{ textAlign: 'right' }}><b>{totalLabel(t)}</b></td>
                      {oneAmount
                        ? <td style={{ textAlign: 'right' }}>{amountTotal(t)}</td>
                        : <>
                          <td style={{ textAlign: 'right' }}>{commas(t.debit)}</td>
                          <td style={{ textAlign: 'right' }}>{creditTotal(t)}</td>
                        </>}
                      <td style={{ textAlign: 'right' }}>{signed(t.paidRec)}</td>
                      <td style={{ textAlign: 'right' }}>{signed(t.balance)}</td>
                      <td style={{ textAlign: 'center' }}>-</td>
                    </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              {overflow && 
                <div className="d-flex justify-content-end mt-3">
                  <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={setCurrentPage}/>
                </div>
              }
            </>
          }
          {records.length == 0 && <>No Similar Record</>}
        </>
      }
      {load && <div className='text-center py-5 my-5'> <Spinner /> </div>}
    </>
    )
  };
  const gridRef = useRef();
  const [columnDefs, setColumnDefs] = useState([
    { headerName: '#', field: 'index', filter: true },
    { headerName: 'Inv. No', field: 'invoice_No', filter: true },
    // Sorted as a date, not as the text "05-Mar-2022" - which put every
    // 01-... of any year ahead of every 02-...
    { headerName: 'Date', field: 'createdAt', filter: true, comparator: byShownDate },
    { headerName: 'HBL/HAWB', field: 'blHbl', filter: true },
    { headerName: 'MBL/MAWB', field: 'blMbl', filter: true },
    { headerName: 'Agent', field: 'party_Name',filter: true },
    { headerName: 'Shipper', field: 'shipper', filter: true },
    { headerName: 'SalesPerson', field: 'salesRep', filter: true },
    { headerName: 'F. Dest', field: 'fd', filter: true },
    { headerName: 'J/Tp', field: 'subType', filter: true },
    { headerName: 'F/Tp', field: 'ppcc', filter: true },
    { headerName: 'WT', field: 'wt', filter: true },
    { headerName: 'Vol', field: 'vol', filter: true },
    { headerName: 'DN/CN', field: 'dnCn', filter: true },
    { headerName: 'Curr', field: 'currency', filter: true },
    { headerName: 'Invoice Amount', field: 'total', filter: true },
    // { headerName: 'Credit', field: 'credit', filter: true },
    { headerName: 'Paid/Rcvd', field: 'paidRec', filter: true },
    { headerName: 'Balance', field: 'balance', filter: true },
    { headerName: 'Operation Type', field: 'op', filter: true },
    { headerName: 'Company Name', field: 'company', filter: true },
    { headerName: 'Age', field: 'age', filter: true },
    { headerName: 'Containers', field: 'containers', filter: true },
    { headerName: 'Job Client', field: 'jobClient', filter: true },
    // { headerName: 'ClientRecievable', field: 'clientRecievable', filter: true },
    // { headerName: 'ClientRecieved', field: 'clientRecieved', filter: true },
    // { headerName: 'ClientOutstanding', field: 'clientOutstanding', filter: true },
    { headerName: 'Arrival Date', field: 'arrivalDate', filter: true },
    { headerName: 'Sailing Date', field: 'sailingDate', filter: true },
    { headerName: 'File No', field: 'fileNo', filter: true },
    { headerName: 'Vessel', field: 'vessel', filter: true },
    { headerName: 'Voyage #', field: 'voyage', filter: true },
    { headerName: 'Custsomer Ref #', field: 'customerRef', filter: true },
  ]);

  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
  }));

  const getRowHeight = useCallback(() => {
    return 38;
  }, []);

  const cnSwitch = (
    <label className="d-flex align-items-center me-3 mb-0" style={{ gap: 8, fontSize: 13, cursor: 'pointer' }}
      title="Debit and Credit as one signed Amount column - a CN's below zero">
      <Switch size="small" checked={oneAmount} onChange={setOneAmount} />
      One Amount column
    </label>
  );

  /* THE TITLE, PRINT AND EXCEL on the toolbar (PageActions). Print presses
   * the page's ReactToPrint through a hidden trigger; Excel is the viewer's
   * export or the grid's, whichever view this is. The column switch stays on
   * the page - it is how the report reads, not something done to it. */
  const printTriggerRef = useRef(null);
  const view = query.report == "viewer" ? 'viewer' : query.report == "grid" ? 'grid' : '';
  usePageActions({
    title: 'Invoice Balancing',
    subtitle: query.from ? `${moment(query.from).format("DD-MM-YYYY")} to ${moment(query.to).format("DD-MM-YYYY")}` : undefined,
    print: { onClick: () => printTriggerRef.current?.click(), disabled: !view, title: 'Print the report' },
    excel: {
      onClick: () => (view === 'grid' ? exportToExcelGrid() : exportToExcel()),
      disabled: !view,
      title: view === 'grid' ? 'Export the grid to Excel' : 'Export the report to Excel',
    },
  }, [view, query.from, query.to]);

  return (
  <div className='base-page-layout'>
    {query.report == "viewer" && (
      <>
        <ReactToPrint content={() => inputRef} trigger={() => <button type='button' ref={printTriggerRef} style={{ display: 'none' }} aria-hidden='true' />} />
        <div className="d-flex justify-content-end items-end" >
          {cnSwitch}
        </div>
      </>
    )}
    {query.report == "grid" && (
      <>
        {/* The grid prints too - the same print as the viewer (AgentBalancingPrint). */}
        <ReactToPrint content={() => inputRef} trigger={() => <button type='button' ref={printTriggerRef} style={{ display: 'none' }} aria-hidden='true' />} />
        <div className="d-flex justify-content-end items-end" style={{paddingBottom: 10}}>
          {cnSwitch}
        </div>
      </>
    )}
    {/* <---- Reports View only  ----> */}
    {query.report == "viewer" && <TableComponent overflow={true}/>}
    {/* <---- list View only with filteration ----> */}
    {query.report != "viewer" &&
    
      <div className="ag-theme-alpine" style={{ width: "100%", height: '72vh' }}>
        {/* {console.log(records)}/ */}
        <AgGridReact
          ref={gridRef} // Ref for accessing Grid's API
          rowData={shown} // Row Data for Rows
          columnDefs={columnDefs} // Column Defs for Columns
          defaultColDef={defaultColDef} // Default Column Properties
          animateRows={true} // Optional - set to 'true' to have rows animate when sorted
          rowSelection='multiple' // Options - allows click selection of rows
          getRowHeight={getRowHeight}
          pagination={true}
          paginationPageSize={50}
        />
      </div>
    }
    {/* THE PRINT - its own layout (AgentBalancingPrint): every row, A4
        landscape, headings repeated on each page, the footer on every page.
        It was the screen table - the 20 rows of the page on screen, on
        portrait A4 with the money columns off the paper (2026-10-15). */}
    <div style={{ display: 'none' }}>
      <div ref={(response) => (inputRef = response)}>
        <AgentBalancingPrint
          rows={shown}
          totals={totalLines}
          oneAmount={oneAmount}
          company={query.company}
          from={moment(query.from).format("DD-MMM-YYYY")}
          to={moment(query.to).format("DD-MMM-YYYY")}
          printedBy={username}
        />
      </div>
    </div>
  </div>
  )
}

export default React.memo(InvoiceBalancingReport)
