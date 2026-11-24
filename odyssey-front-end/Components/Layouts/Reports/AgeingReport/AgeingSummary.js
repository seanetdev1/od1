import React, { useEffect, useMemo, useCallback, useState, useRef } from "react";
import { useRememberedPage } from 'functions/rememberedPage';
import moment from "moment";
import PrintTopHeader from "Components/Shared/PrintTopHeader";
import { Table, Row, Col } from "react-bootstrap";
import Pagination from "Components/Shared/Pagination";
import ExcelJS from "exceljs";
import Cookies from "js-cookie";
import { useRouter } from "next/router";
import { FileExcelOutlined } from '@ant-design/icons';
import { setAgeingField } from '../../../../redux/ageing/ageingSlice';
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { companyLogoBlob, reportCompanyTitle, reportAddress } from 'functions/companyBranding';
import { ageingFigures, currencyTotals, currencyLabel } from 'functions/ageingCurrency';
import { ageingDays, sortAgeingRows } from 'functions/ageingRows';

// The ageing buckets, in column order - summed per currency for the total lines.
const BUCKETS = ['Current', 'oneThirty', 'tOneSixty', 'sOneNinety', 'nOneTwenty', 'overTwenty'];


const Summary = ({ query, result }) => {
  const router = useRouter();
  const hasExported = useRef(false);
  const [ records, setRecords ] = useState([]);
  // A total line for each currency, over every row (not just this page).
  const totals = useMemo(() => currencyTotals(records, BUCKETS), [records]);


  useEffect(() => {
    if (
      router.isReady &&
      router.query.autoExport === "true" &&
      records.length > 0 &&
      !hasExported.current
    ) {
      hasExported.current = true;
      exportToExcel();
    }
  }, [router.isReady, router.query, records]);

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
      { header: 'A/C Code', key: 'AccountCode', width: 15 },
      { header: 'A/C Title', key: 'AccountTitle', width: 30  },
      { header: 'Sales Rep', key: 'SalesRep', width: 22 },
      { header: 'Curr', key: 'Currency', width: 10  },
      { header: 'Settlement', key: 0, width: 20  },
      { header: 'Current Invoice', key: 'Current', width: 20 },
      { header: '1 - 30 Days', key: 'oneThirty', width: 20  },
      { header: '31 - 60 Days', key: 'tOneSixty', width: 20 },
      { header: '61 - 90 Days', key: 'sOneNinety', width: 20  },
      { header: '91 - 120 Days', key: 'nOneTwenty', width: 20  },
      { header: 'Above 120 Days', key: 'overTwenty', width: 20  },
      { header: 'Total', key: 'total', width: 20 },
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
        size: 14,
        bold: true,
      };
    
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle'
      };
    });
    // console.log(records)
    const data = records.map((x, i) => ({
      
      AccountCode: x.AccountCode,
      AccountTitle: x.AccountTitle,
      SalesRep: x.SalesRep,
      Currency: x.Currency,
      Settlement: 0,           
      oneThirty: x.oneThirty,
      Current: x.Current,
      tOneSixty: x.tOneSixty,
      sOneNinety: x.sOneNinety,
      nOneTwenty: x.nOneTwenty,
      overTwenty: x.overTwenty,
      total: x.total,
    }));
    

  
      worksheet.addRows(data);
      // A total line for each currency - never USD added to PKR.
      for (const t of totals) worksheet.addRow({ AccountTitle: 'Total', ...t }).font = { bold: true };

      records.forEach((x, i) => {
        if (x.type === "parent") {
          const row = worksheet.getRow(i + 2); // Account for header row (index starts from 1)
          row.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'd7d7d7' } 
            }; // Set font to bold
          });
        }
      });

      worksheet.insertRow(1, ['', '', '', '', '', '', '', '']);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['', '', '', 'Date: From: ' + query.from + ' To: ' + query.to,]);
      worksheet.insertRow(1, ['', '', '', reportAddress(query.company)]);
      // The picked company's name, or all of them - see reportCompanyTitle.
      worksheet.insertRow(1, ['', '', '', reportCompanyTitle(query.company)]);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);

    worksheet.getCell('D3').font = {
      size: 16,  
      bold: true  
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
      link.download = 'AgeingReport.xlsx';
      link.click();
      window.URL.revokeObjectURL(url);
    }catch(e){
      // console.log(e)
      console.error(e)
    }
  };
      
  const commas = (a) =>  { return parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
  console.log("summary query:", query)
// console.log("summary result:", result)

useEffect(() => {
  if (!result || !Array.isArray(result.temp)) {
    setRecords([]);
    return;
  }


  // Days from the invoice's date to today - see
  // functions/ageingRows (it was updatedAt). The To date only
  // picks the invoices (the user, 2026-11-02).

  // Grouping map: key = `${AccountCode}||${Currency}`
  // Each value accumulates the buckets + identity fields
  const map = new Map();


  // result.temp is: [{ partyName, invoices: [...] }]
  for (const party of result.temp) {
    const partyName = party.partyName ?? "";
    // You might also have partyCode in your enriched payload:
    // If not there, you can derive from invoices if consistent.
    for (const inv of (party.invoices || [])) {
      // In its own currency, or converted - see functions/ageingCurrency.
      const { currency, balance } = ageingFigures(inv, query.ageing_currency);
      const accountCode = inv.partyCode || "";
      const accountTitle = inv.partyName || partyName || "(Unknown)";

      const key = `${accountCode}||${currency}`;
      if (!map.has(key)) {
        map.set(key, {
          AccountCode: accountCode,
          AccountTitle: accountTitle,
            SalesRep: party.salesRep || "",
          Currency: currency,
          Current: 0,
          oneThirty: 0,   // 1–30
          tOneSixty: 0,   // 31–60
          sOneNinety: 0,  // 61–90
          nOneTwenty: 0,  // 91–120
          overTwenty: 0,  // 121+
          // Optionally keep a raw list of invoices in this group
          // invoices: [],
        });
      }
      

      const grp = map.get(key);
      const bal = balance;
      const d = ageingDays(inv);

      if (d === 0) {
        grp.Current += bal;
      } else if (d >= 1 && d <= 30) {
        grp.oneThirty += bal;
      } else if (d >= 31 && d <= 60) {
        grp.tOneSixty += bal;
      } else if (d >= 61 && d <= 90) {
        grp.sOneNinety += bal;
      } else if (d >= 91 && d <= 120) {
        grp.nOneTwenty += bal;
      } else {
        grp.overTwenty += bal;
      }

      // If you want to keep the invoices per (account, currency), uncomment:
      // grp.invoices.push(inv);
    }
  }

  // Final array + computed total
  const temp = Array.from(map.values()).map((row) => ({
    ...row,
    total:
      row.Current +
      row.oneThirty +
      row.tOneSixty +
      row.sOneNinety +
      row.nOneTwenty +
      row.overTwenty,
  }));

  // Largest first, within each currency - see functions/ageingRows.
  setRecords(sortAgeingRows(temp));
}, [result, query.ageing_currency, query.to]);

  // Kept when the user switches tabs and comes back - functions/rememberedPage.
  const [currentPage, setCurrentPage] = useRememberedPage('ageingSummary');
  const [recordsPerPage] = useState(30);
  const indexOfLast = currentPage * recordsPerPage ;
  const indexOfFirst = indexOfLast - recordsPerPage;
  const currentRecords = records ? records.slice(indexOfFirst,indexOfLast) : [];
  const noOfPages = records ? Math.ceil(records.length / recordsPerPage) : 0 ;
  const groupedRecords = currentRecords.reduce((acc, item) => {
  const group = item.groupName || "OTHERS";

  if (!acc[group]) acc[group] = [];
  acc[group].push(item);

  return acc;
}, {});

  
  return (                          
    <>  
    <PrintTopHeader company={query.company} query={query} from={moment(query.from).format('DD-MM-YYYY')} to={moment(query.to).format('DD-MM-YYYY')} /> 
        
    <div className="report-header" style={{ marginTop: '20px', marginBottom: '20px', position: 'relative' }}>
      <div style={{ position: 'relative', marginBottom: '25px' }}>
    <div style={{
        borderTop: '3px solid #000'
    }} />
    
      <span style={{
        position: 'absolute',
        top: '-12px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#fff',
        padding: '0 14px',
        fontWeight: 'bold',
        fontSize: '14px'
      }}>
        Ageing Summary
      </span>
    </div>
      </div>
      
                <Row style={{  marginTop: '15px', justifyContent: 'right' }}>
                
                  <Col md={4}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <span style={{ fontWeight: 'bold' }}>Sales Rep :</span>
                      <span style={{ borderBottom: '1px solid #000', minWidth: '120px', marginLeft: '10px', textAlign: 'center' }}>{query.ageing_salesRep && query.ageing_salesRep !== 'All' ? (records[0]?.SalesRep || '-') : 'All'}</span>
                    </div>
                  </Col>
                  <Col md={4}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <span style={{ fontWeight: 'bold' }}>Currency :</span>
                      <span style={{ borderBottom: '1px solid #000', minWidth: '120px', marginLeft: '10px', textAlign: 'center' }}>{currencyLabel(query.ageing_currency)}</span>
                    </div>
                  </Col>
                  <Col md={4}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{ fontWeight: 'bold' }}>As On :</span>
                    <span style={{ borderBottom: '1px solid #3f0202', minWidth: '150px', marginLeft: '10px', textAlign: 'center' }}>{moment(query.to).format('DD-MM-YYYY')}</span>
                </div>
                </Col>
                </Row> 
      <div className="table-box">
          <div className="table-scroll">
            <table className="summary">
              <thead className="sticky-header">
                <tr>
                  <th rowSpan={2}>A/C Code</th>
                  <th rowSpan={2} style={{ textAlign: "left" }}>A/C Title</th>
                  <th rowSpan={2} style={{ textAlign: "left" }}>Sales Rep</th>
                  <th rowSpan={2}>Curr</th>
                  <th colSpan={7} style={{ textAlign: "center" }}>Ageing</th>
                  <th rowSpan={2}>Total</th>
                </tr>

                <tr>
                  <th>Settlement</th>
                  <th>Current Inv</th>
                  <th>1-30 Days</th>
                  <th>31-60 Days</th>
                  <th>61-90 Days</th>
                  <th>91-120 Days</th>
                  <th>Above 120</th>
                </tr>
              </thead>

            <tbody>
              {Object.entries(groupedRecords).map(([groupName, groupRows]) => (
                <React.Fragment key={groupName}>
                  
                  {/* GROUP HEADER ROW */}
                  <tr className="group-row">
                    <td colSpan={15} className="group-title">
                      
                    </td>
                  </tr>
                  {groupRows.map((r) => (
                    <tr key={`${r.AccountCode}-${r.Currency}`}>
                      <td className="cell-code">{r.AccountCode}</td>
                      <td className="cell-title indent">
                        {r.AccountTitle}
                      </td>
                      <td className="cell-title">{r.SalesRep}</td>
                      <td className="cell-center">{r.Currency}</td>
                      <td className="cell-num">{0.0}</td>
                      <td className="cell-num">{commas(r.Current)}</td>
                      <td className="cell-num">{commas(r.oneThirty)}</td>
                      <td className="cell-num">{commas(r.tOneSixty)}</td>
                      <td className="cell-num">{commas(r.sOneNinety)}</td>
                      <td className="cell-num">{commas(r.nOneTwenty)}</td>
                      <td className="cell-num">{commas(r.overTwenty)}</td>
                      <td className="cell-num cell-total">{commas(r.total)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              {totals.map((t) => (
                <tr key={`total-${t.Currency}`} style={{ fontWeight: 'bold', borderTop: '2px solid #000' }}>
                  <td className="cell-code"></td>
                  <td className="cell-title">Total</td>
                  <td className="cell-title"></td>
                  <td className="cell-center">{t.Currency}</td>
                  <td className="cell-num">{commas(0)}</td>
                  <td className="cell-num">{commas(t.Current)}</td>
                  <td className="cell-num">{commas(t.oneThirty)}</td>
                  <td className="cell-num">{commas(t.tOneSixty)}</td>
                  <td className="cell-num">{commas(t.sOneNinety)}</td>
                  <td className="cell-num">{commas(t.nOneTwenty)}</td>
                  <td className="cell-num">{commas(t.overTwenty)}</td>
                  <td className="cell-num cell-total">{commas(t.total)}</td>
                </tr>
              ))}
            </tfoot>
      </table>
      </div>
           
      </div>
      <div className="d-flex justify-content-end mt-4">
        <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={setCurrentPage}/>
      </div>
   </>
     );
   };
   
   export default React.memo(Summary);