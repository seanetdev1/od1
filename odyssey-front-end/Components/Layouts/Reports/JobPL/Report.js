import { recordsReducer, initialState, companies, fetchData, plainOptions, excelDataFormatter } from './states';
import { useRememberedPage } from 'functions/rememberedPage';
import React, { useReducer, useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Sheet from './Sheet';
import PrintTopHeader from '../../../Shared/PrintTopHeader';
import Cookies from "js-cookie";
import ReactToPrint from 'react-to-print';
import { AiFillPrinter } from "react-icons/ai";
import moment from 'moment';
import { Spinner } from "react-bootstrap";
import { AgGridReact } from 'ag-grid-react';
import { CSVLink } from "react-csv";
import ExcelJS from "exceljs";
import Pagination from "Components/Shared/Pagination";
import { FileExcelOutlined } from '@ant-design/icons';
import { current } from '@reduxjs/toolkit';
import { companyLogoBlob, reportCompanyTitle, reportAddress } from 'functions/companyBranding';
import { usePageActions } from 'Components/Shared/PageActions';
import usePrintStamp from 'functions/usePrintStamp';


const Report = ({ query }) => {
  // const [ records, setRecords ] = useState([]);
  let inputRef = useRef(null);
  const [username, setUserName] = useState("");
  // The day it is printed: empty until in the browser, whose day it is -
  // see functions/usePrintStamp.
  const stamp = usePrintStamp();

  /* The print copy holds EVERY job - 23,000 rows on a full customs book, some
     460,000 table cells - and it was built on every load, hidden, whether or
     not anyone printed. It is now built only when Print is pressed:
     onBeforeGetContent turns it on and waits for React to commit it, and
     onAfterPrint takes it away again. */
  const [printing, setPrinting] = useState(false);
  const printReady = useRef(null);
  useEffect(() => {
    if (printing && printReady.current) {
      printReady.current();
      printReady.current = null;
    }
  }, [printing]);

  const setCommas = (val) => val? val.toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ", "):'0'
  
  const set = (obj) => dispatch({ type: 'set', payload: obj });
  const [state, dispatch] = useReducer(recordsReducer, initialState);

  useEffect(() => {
    getValues();
  }, []);

  console.log(state)

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
      { header: '#', key: 'index', width: 5 },
      { header: 'Job. #', key: 'jobNo', width: 20  },
      { header: 'Job Date', key: 'jobDate', width: 15  },
      { header: 'HBL.No/HAWB', key: 'hbl', width: 20  },
      { header: 'Client', key: 'client', width: 35 },
      { header: 'Shipper', key: 'shipper', width: 35  },
      { header: 'Local Agent', key: 'localAgent', width: 35  },
      { header: 'Final Dest.', key: 'finalDestination', width: 20  },
      { header: 'Type', key: 'type', width: 10  },
      { header: 'Cnts', key: 'containers', width: 25  },
      { header: 'WT', key: 'weight', width: 10  },
      { header: 'Vol', key: 'volume', width: 10  },
      { header: 'Revenue', key: 'revenue', width: 15  },
      { header: 'Cost', key: 'cost', width: 15  },
      { header: 'Profit / Loss', key: 'profitLoss', width: 15  },
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
        horizontal: 'center',
        vertical: 'middle'
      };
    });
    const data = state?.records
      .map((x, i) => ({
        index: i + 1,
        jobNo: x.jobNo,
        jobDate: moment(x.createdAt).format("MM/DD/YY"),
        hbl: x.Bl?.hbl,
        client: x.Client.name,
        shipper: x.shipper.name,
        localAgent: x.local_vendor.name,
        finalDestination: x.fd,
        type: x.jobType,
        containers: x?.SE_Job?.operation,
        weight: x.weight,
        volume: x.vol,
        revenue: x.revenue,
        cost: x.cost,
        profitLoss: x.pnl
      }));

  
      worksheet.addRows(data);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['', '', '', 'Date: From: ' + moment(query.from).format('DD-MM-YYYY') + ' To: ' + moment(query.to).format('DD-MM-YYYY'),]);
      worksheet.insertRow(1, ['', '', '', reportAddress(query.company)]);
      // The picked company's name, or all of them - see reportCompanyTitle.
      worksheet.insertRow(1, ['', '', '', reportCompanyTitle(query.company)]);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);

    worksheet.getCell('D3').font = {
      size: 16,  // Increase font size
      bold: true  // Make the text bold
    };
    worksheet.getCell('D4').font = {
      size: 16,  // Increase font size
      bold: true  // Make the text bold
    };
    worksheet.getCell('D5').font = {
      size: 14,  // Increase font size
      bold: true  // Make the text bold
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
        tl: { col: 1, row: 1 }, // Top-left position (column, row)
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
      link.download = 'JobP&L.xlsx';
      link.click();
      window.URL.revokeObjectURL(url);
    }catch(e){
      console.log(e)
      console.error(e)
    }
  
    
  };

  async function getValues() {
    await set({
      from:query.from,
      to:query.to
    });
    let name = await Cookies.get("username");
    setUserName(name);
    await fetchData(set, query)
  }
  

  const gridRef = useRef();
  const [columnDefs, setColumnDefs] = useState([
    { headerName: 'Job No', field: 'jobNo', width: 120, filter: true },
    {
      headerName: 'Date', field: 'createdAt', width: 120, filter: true,
      cellRenderer: params => {
        return <>
          {moment(params.value).format("DD/MM/YY")}
        </>;
      }
    },
    {
      headerName: 'HBL / HAWB', field: 'Bl.hbl', width: 120, filter: true,
   
    },
    {
      headerName: 'Client', field: 'hbl',width: 70, filter: true,
      cellRenderer: params => {
        return <>
          {params.data.Client.name}
        </>;
      }
    },
    {
      headerName: 'SubType', field: 'subType', width: 120, filter: true,
   
    },
    { headerName: 'F. Dest', field: 'fd', width: 100, filter: true },
    { headerName: 'Shipper', field: 'shipper.name', width: 100, filter: true },

    { headerName: 'Local Agent', field: 'local_vendor.name', width: 100, filter: true },
    { headerName: 'Type', field: 'jobType', width: 100, filter: true },
    { headerName: 'Weight', field: 'weight', width: 100, filter: true },

    {
      headerName: 'Revenue', field: 'revenue',width: 70, filter: true,
      cellRenderer: params => {
        return <>
          {setCommas(params.value)}
        </>;
      }
    },
    {
      headerName: 'Cost', field: 'cost', width: 70,filter: true,
      cellRenderer: params => {
        return <>
          {setCommas(params.value)}
        </>;
      }
    },
    {
      headerName: 'P/L', field: 'actual', fiwidth: 70,lter: true,
      cellRenderer: params => {
        return <span>
          {setCommas(params.value)}
        </span>;
      }
    },
    {
      headerName: 'Gain/Loss', field: 'gainLoss',width: 70, filter: true,
      cellRenderer: params => {
        return <span style={{ color: params.data.gainLoss < 0 ? 'crimson' : 'green' }}>
          {setCommas(params.value < 0 ? params.value * -1 : params.value)}
        </span>;
      }
    },
    {
      headerName: 'After Gain/Loss', field: 'after', width: 70,filter: true,
      cellRenderer: params => {
        return <span>
          {setCommas(params.value)}
        </span>;
      }
    }

  ]);



      const defaultColDef = useMemo(() => ({
        sortable: true,
        resizable: true,
      }));

    const getRowHeight = useCallback(() => {
      return 38;
    }, []);
   // Kept when the user switches tabs and comes back - functions/rememberedPage.
  const [currentPage, setCurrentPage] = useRememberedPage('jobPL');
     const [recordsPerPage] = useState(30);
     const indexOfLast = currentPage * recordsPerPage ;
     const indexOfFirst = indexOfLast - recordsPerPage;
     const records = state.records || [];
    const currentRecords = records.slice(indexOfFirst, indexOfLast);
    const noOfPages = Math.ceil(records.length / recordsPerPage);
     
   
    
  /* THE TITLE, PRINT AND EXCEL on the toolbar (PageActions). The print is
   * still ReactToPrint's - it waits for the print copy to render - pressed
   * through a hidden trigger, as VAT Detail's is. In the report view only:
   * the grid view never had either. */
  const printTriggerRef = useRef(null);
  const viewer = query.report == "viewer";
  usePageActions({
    title: 'Job Profit & Loss',
    subtitle: query.from ? `${moment(query.from).format("DD-MM-YYYY")} to ${moment(query.to).format("DD-MM-YYYY")}` : undefined,
    print: {
      onClick: () => printTriggerRef.current?.click(),
      disabled: !viewer || state.load,
      busy: printing,
      title: viewer ? 'Print the report' : 'Print from the report view',
    },
    excel: {
      onClick: () => exportToExcel(),
      disabled: !viewer || state.load,
      title: viewer ? 'Export the report to Excel' : 'Export from the report view',
    },
  }, [viewer, state.load, printing, query.from, query.to]);

  return (
    <div className='base-page-layout' >
      {/* <---- Reports View only , setting overflow to true ----> */}
      {query.report == "viewer" && <>
        <ReactToPrint
          content={() => inputRef}
          onBeforeGetContent={() => new Promise((resolve) => {
            printReady.current = resolve;
            setPrinting(true);
          })}
          onAfterPrint={() => setPrinting(false)}
          onPrintError={() => setPrinting(false)}
          trigger={() => <button type='button' ref={printTriggerRef} style={{ display: 'none' }} aria-hidden='true' />}
        />
        {!state.load &&
          <>
            <PrintTopHeader company={query.company} from={moment(query.from).format("DD-MM-YYYY")} to={moment(query.to).format("DD-MM-YYYY")} />
            <hr className='mb-2' />
          <Sheet state={{...state, records: currentRecords}} overflow={true} currentPage={currentPage} noOfPages={noOfPages} />
          </>
        }
        {state.load && <Spinner />}
      </>
      }
      {/* <---- list View only with filteration ----> */}
      {query.report != "viewer" &&
        <div className="ag-theme-alpine" style={{ width: "100%", height: '72vh' }}>
          <AgGridReact
            ref={gridRef} // Ref for accessing Grid's API
            rowData={state.records} // Row Data for Rows
            columnDefs={columnDefs} // Column Defs for Columns
            defaultColDef={defaultColDef} // Default Column Properties
            animateRows={true} // Optional - set to 'true' to have rows animate when sorted
            rowSelection='multiple' // Options - allows click selection of rows
            getRowHeight={getRowHeight}
          />
        </div>
      }
      {/* <---- Component that will be displaying in print mode  ----> */}
      <div style={{ display: 'none' }}>
        {printing &&
        <div className="pt-5 px-3" ref={(response) => (inputRef = response)}>
          {/* The print copy: every job, not one page. Written inline, not as
              a component declared inside Report - that was a NEW component
              type on every render, so React threw the whole hidden table away
              and rebuilt it each time anything changed, a page click included.

              No currentPage/noOfPages: Sheet prints its Total row only when
              the two match, and passing the screen's paging meant a report
              printed from any page but the last came out with no totals. */}
          <PrintTopHeader company={query.company} />
          <hr className='mb-2' />
          <Sheet state={state} overflow={false} fontSize={10} />
          {/* <---- footer ----> */}
          <div style={{ position: 'absolute', bottom: 10 }}>Printed On: {stamp.at ? moment(stamp.at).format("YYYY-MM-DD") : ""}</div>
          <div style={{ position: 'absolute', bottom: 10, right: 10 }}>Printed By: {username}</div>
        </div>
        }
      </div>
      <div className="d-flex justify-content-end mt-4">
        <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={setCurrentPage}/>
      </div>
    </div>
  )
}

export default React.memo(Report)