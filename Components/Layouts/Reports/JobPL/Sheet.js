import React, { useEffect } from 'react';
import { Spinner, Table } from 'react-bootstrap';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { useRouter } from 'next/router';
import moment from 'moment';

const Sheet = ({state, overflow, fontSize, currentPage, noOfPages}) => {

    const router = useRouter();
    const dispatch = useDispatch();

    /* A COMMA, not a comma and a space.
     *
     * This inserted ", " as the thousands separator, so every figure on the
     * report read "43, 729.00" - which is not how money is written anywhere,
     * and which breaks the column's alignment as well. Every other formatter
     * in the app uses ",". */
    const setCommas = (val) => {
        const n = Number(val);
        if (!Number.isFinite(n) || n === 0) return '0.00';
        return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    const recordState = state?.records;
  return (
    <div>
    {/* THE ONE SCROLLER. Height in vh rather than a fixed 600px, so the sheet
        fills a tall screen and does not overflow a short one; the printed
        copy (overflow=false) is unbounded and pages itself. */}
    <div className='jobpl-scroll' style={{maxHeight: overflow ? '62vh' : '100%'}}>
        <Table className='tableFixHead vertical jobpl-sheet' bordered>
        <thead>
            <tr className='fs-10 text-center'>
                <th>#</th>
                <th style={{ minWidth: 100 }}>Job No</th> 
                <th className='nowrap' style={{ minWidth: 92 }}>Date</th>
                <th style={{ minWidth:200 }}>Client</th>
                <th>SubType</th>
                <th > HBL/HAWB</th>
                <th className='num'>Weight</th>
                <th className='num' style={{ minWidth:120 }}>Revenue</th>
                <th className='num' style={{ minWidth:120 }}>Cost</th>
                <th className='num' style={{ minWidth:120 }}>P/L</th>
                <th className='num' style={{ minWidth:120 }}>Gain/Loss</th>
                <th className='num' style={{ minWidth:120 }}>After Gain/Loss</th>
                <th style={{ minWidth:150 }}>F. Dest</th>
                <th style={{ minWidth:150 }}>Shipper</th>
                <th style={{ minWidth:150 }}>Sales Representative</th>
                <th style={{ minWidth:100 }}>Local Agent</th>
                <th>Type</th>

            </tr>
        </thead>
        <tbody>
        {recordState.length>0 && recordState?.map((x,index)=>{
        return (
        <tr key={index} className='f fs-10 text-center'>
            <td>{index + 1}</td>
            <td className='row-hov blue-txt'
                    onClick={()=>{
                    let type = x.operation;
                    // 'AV' is an aviation flight, which lives in its own module
                    // rather than under Air Jobs. Without this it fell through
                    // to the final else and opened /airJobs/import with a
                    // flight id - a blank Air Import job, not the flight.
                    if(type=="AV"){
                        dispatch(incrementTab({ "label":"AVIATION JOB", "key":"10-2", "id":x.id }));
                        router.push(`/aviationJobs/${x.id}`);
                        return;
                    }
                    // 'CC' is a goods declaration, its own module too. Same
                    // trap: without this it falls through to the final else
                    // and opens /airJobs/import with a customs job id.
                    if(type=="CC"){
                        dispatch(incrementTab({ "label":"CUSTOMS JOB", "key":"11-2", "id":x.id }));
                        router.push(`/customsJobs/${x.id}`);
                        return;
                    }
                    dispatch(incrementTab({
                        "label":type=="SE"?"SE JOB":type=="SI"?"SI JOB":type=="AE"?"AE JOB":"AI JOB",
                        "key":type=="SE"?"4-3":type=="SI"?"4-6":type=="AE"?"7-2":"7-5",
                        "id":x.id
                    }));
                    router.push(type=="SE"?`/seaJobs/export/${x.id}`:type=="SI"?`/seaJobs/import/${x.id}`:
                        type=="AE"?`/airJobs/export/${x.id}`:`/airJobs/import/${x.id}`
                    )
                }}
            >{x.jobNo}</td>
            <td className='nowrap'>{moment(x.createdAt).format("DD-MM-YY")}</td>
            <td>{x.Client.name}</td>
            <td>{x.subType}</td>
            <td>{x.Bl?.hbl}</td>
            <td className='num'>{x.weight}</td>
            <td className='num'>{setCommas(x.revenue)}</td>
            <td className='num'>{setCommas(x.cost)}</td>
            <td className='num'>{setCommas(x.actual)}</td>
            <td className='num' style={{color:x.gainLoss<0?'crimson':'green'}}>
                {setCommas(x.gainLoss<0?x.gainLoss:x.gainLoss)}
            </td>
            <td className='num'>{setCommas(x.after)}</td>

            <td >{x.fd}</td>
            <td>{x.shipper?.name}</td>
            <td>{x.sales_representator?.name}</td>
            <td >{x.local_vendor?.name}</td>
            <td >{x.jobType}</td>
        
  
            
        </tr>
        )})}
        {currentPage == noOfPages &&
        <tr className='f fs-11 text-center'>
            <td colSpan={6}></td>
            <td className='nowrap fw-7'>Total</td>
            {/* Every total is the WHOLE REPORT's, from states.js. Cost and P/L
                used to be summed here from state.records - which on screen is
                only the page being shown (Report.js hands the sheet a slice),
                while Revenue, Gain/Loss and After Gain/Loss were whole-report.
                So the row mixed two scopes, and P/L could read far below
                After Gain/Loss with no gain or loss at all between them. */}
            <td className='num' style={{ minWidth:120 }}>{setCommas(state.totalRevenue)}</td>
            <td className='num' style={{ minWidth:120 }}>{setCommas(state.totalCost)}</td>
            <td className='num'>{setCommas(state.totalPnl)}</td>
            <td className='num'>{setCommas(state.totalgainLoss)}</td>
            <td className='num'>{setCommas(state.totalAfter)}</td>
            {/* The five trailing columns, so the totals row is as wide as the
                table. Left off, the row ended early and the border stopped
                mid-sheet. */}
            <td colSpan={5}></td>
        </tr>
        }
        </tbody>
        </Table>
        </div>
    <style jsx global>{`
      /* THE SHEET IS WIDE - seventeen columns - so it scrolls sideways inside
         its own box rather than widening the page. Only this container
         scrolls; the page's own scrollbar is left alone. */
      .jobpl-scroll { overflow: auto; }

      /* A floor, not a fixed width: below this the columns start stealing
         each other's characters and a date breaks over three lines, which is
         what it was doing. Above it the table fills whatever space there is. */
      .jobpl-sheet { min-width: 1500px; }

      .jobpl-sheet th, .jobpl-sheet td {
        padding: 5px 8px;
        vertical-align: middle;
      }
      /* Money right, everything else as it was. A column of figures that is
         centred cannot be scanned down for magnitude - the decimal point
         moves with every row. */
      .jobpl-sheet .num { text-align: right; font-variant-numeric: tabular-nums; }
      .jobpl-sheet th.num { text-align: right; }
      .jobpl-sheet .nowrap { white-space: nowrap; }

      .jobpl-sheet tbody tr:nth-child(even) td { background: #fbfcfd; }
      .jobpl-sheet tbody tr:hover td { background: #f1f6fa; }

      /* The header stays put while the body scrolls - tableFixHead does the
         sticking; this keeps it above the striping. */
      .jobpl-sheet thead th { z-index: 2; }

      @media (max-width: 900px) {
        /* On a narrow screen the sideways scroll is the whole interaction, so
           give it more of the viewport rather than less. */
        .jobpl-scroll { max-height: 70vh !important; }
      }
    `}</style>
    </div>
  )
}

// Memoised for the print copy in Report.js: it holds every job, and its props
// do not change once the report has loaded, so a page click no longer re-renders
// a table of thousands of rows nobody can see.
export default React.memo(Sheet)
