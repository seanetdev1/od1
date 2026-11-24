import React, { useEffect, useState, useCallback } from 'react';
import { DatePicker, Spin, Tag, Empty, Radio } from 'antd';
import { Row, Col } from 'react-bootstrap';
import { useSelector } from 'react-redux';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { companyTitle } from 'functions/companyBranding';
import { usePageActions } from 'Components/Shared/PageActions';
import FlightLink from 'Components/Shared/FlightLink';

// The monthly sector report.
//
// One block per SECTOR + AIRCRAFT, a row per flight, then two rollups. Shaped
// after the workbook the department already keeps, so the columns and the
// order match what they read today.
//
// Every figure comes from the server (functions/aviationReport) rather than
// being recomputed here - the screen and the exported workbook must not be
// able to disagree about a month's numbers.
// No offload columns. They were two typed figures on the flight - GAM Offload
// and Other Offload - that named no cargo and reconciled against nothing.
// Offload is now recorded per AWB on the flight's Consignments tab, where it
// actually happens, and this report is about what flew.
//
// GROUPING. Split (the default) is one block per sector+aircraft, the shape of
// the workbook this replaces. Merged is one block per sector with the aircraft
// as a column on each flight, for reading how a SECTOR did when several tails
// work it. The server does the grouping and the totals either way - see
// functions/aviationReport - so the screen and the workbook cannot disagree.
//
// [key, label, isNumeric, decimals]. The numeric flag drives three things at
// once: right alignment, the number format in Excel, and which columns the
// totals row fills - so a column added here needs nothing else changed.
//
// DECIMALS DEFAULT TO 2 AND ARE 0 ON THE COUNTS. A count of flights formatted
// as money printed "1.00 NIL flights" in the workbook, which reads as a weight
// and invites the question of what a fifth of a flight is.
const BASE_COLS = [
  ['date',         'Date',          false],
  ['flightNo',     'Flight',        false],
  ['nil',          'NIL-Flt',       true,  0],
  ['xxld',         'XXLD',          true,  0],
  // Not-Op sits with the other two count columns rather than beside the
  // weights: a flight that did not go is a fact about the schedule. Without a
  // column of its own, such a row reads as an ordinary flight that carried
  // nothing - which is what NIL means, and the opposite of what happened.
  ['notOp',        'Not-Op',        true,  0],
  // PLA before PFM: the row then reads as a funnel - what could be carried,
  // what was planned, what was asked for, what flew. PLA is typed per flight
  // (it is not the aircraft's Max Payload, which does not change with the
  // route), so it is blank on every flight entered before this release.
  ['pla',          'PLA',           true],
  ['pfm',          'PFM',           true],
  ['manifest',     'Manifest',      true],
  ['gamUplift',     'GAM Uplift',     true],
  ['ifaLoads',     'IFA Loads',     true],
  ['otherCarrier', 'Other Carrier', true],
  ['ttlUplift',    'TTl uplift',    true],
];

// Aircraft goes next to the flight number, where the eye already is when it is
// asking what flew. Only in merged mode: in split mode the block heading
// answers it once instead of repeating it down every row.
const colsFor = (merged) =>
  merged
    ? [...BASE_COLS.slice(0, 2), ['aircraft', 'Aircraft', false], ...BASE_COLS.slice(2)]
    : BASE_COLS;

// The totals row labels the non-numeric columns and fills the numeric ones.
// Derived rather than a hardcoded slice(2), which silently mis-aligned the
// whole row the moment a text column was inserted.
const labelSpan = (cols) => cols.filter(([, , isNum]) => !isNum).length;
const numCols = (cols) => cols.filter(([, , isNum]) => isNum);

const fmt = (n) =>
  n === null || n === undefined
    ? '—'
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const AviationMonthly = () => {
  const companyId = useSelector((state) => state.company.value);
  // Opens on the CURRENT month. It used to open on the previous one, on the
  // reasoning that a month is only worth reading once it is closed - but the
  // department reads this mid-month to see how the month is running, and
  // landing on a finished month meant every visit began by changing the
  // picker. Last month is one click back.
  const [month, setMonth] = useState(moment());
  // Aircraft split out, or merged into one block per sector. Defaults to the
  // split the department has always read; the toggle is a way to ask the other
  // question, not a replacement for it.
  const [merged, setMerged] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (m) => {
    setLoading(true);
    try {
      const { data: res } = await axiosClient.get('/aviationJob/report', {
        params: { month: m.format('YYYY-MM'), companyId, mergeAircraft: merged },
      });
      if (res.status !== 'success') {
        openNotification('Error', res.result || 'Could not build the report.', 'red');
        setData(null);
        return;
      }
      setData(res.result);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not build the report.', 'red');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, merged]);

  useEffect(() => { load(month); }, [load]); // eslint-disable-line

  /**
   * Export to xlsx, one worksheet per sector+aircraft plus the two rollups -
   * the same shape as the workbook this replaces, so it can be opened
   * alongside last month's without relearning it.
   */
  const exportXlsx = async () => {
    if (!data?.sheets?.length) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default || (await import('exceljs'));
      const wb = new ExcelJS.Workbook();
      wb.creator = companyTitle(companyId, 'Odyssey');
      wb.created = new Date();

      const money = '#,##0.00';
      const count = '#,##0';
      // A column's own decimals decide its format - see BASE_COLS.
      const fmtFor = (col) => (col[3] === 0 ? count : money);
      const headerRow = (ws, labels) => {
        const r = ws.addRow(labels);
        r.font = { bold: true };
        r.eachCell((c) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          c.border = { bottom: { style: 'thin' } };
        });
      };

      // The grouping the SERVER used, not the toggle's current position: the
      // two differ for as long as a reload is in flight, and a workbook whose
      // columns describe a different grouping from its rows is worse than one
      // that is merely a moment out of date.
      const isMerged = Boolean(data.mergeAircraft);
      const cols = colsFor(isMerged);
      const span = labelSpan(cols);

      for (const s of data.sheets) {
        // Excel refuses : \ / ? * [ ] in a sheet name and caps it at 31 chars.
        const name = isMerged ? s.sector : `${s.sector} ${s.aircraft}`;
        const safe = name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
        const ws = wb.addWorksheet(safe || 'Sector');
        headerRow(ws, [...cols.map(([, label]) => label), 'Remarks']);
        for (const r of s.rows) {
          ws.addRow([...cols.map(([key]) => r[key]), r.remarks || '']);
        }
        const t = s.totals;
        // Built off the columns rather than listed by hand, so the totals row
        // can never fall out of step with the header above it - which is
        // exactly what a hand-listed row does the first time a column moves.
        const totals = ws.addRow([
          'Total', ...Array(span - 1).fill(''), ...numCols(cols).map(([key]) => t[key]), '',
        ]);
        totals.font = { bold: true };
        totals.eachCell((c) => { c.border = { top: { style: 'thin' } }; });
        ws.columns.forEach((c, i) => {
          c.width = i === cols.length ? 34 : 13;
          if (cols[i] && cols[i][2]) c.numFmt = fmtFor(cols[i]);
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
      }

      const rollup = (title, rows, firstLabel, firstKey) => {
        const ws = wb.addWorksheet(title);
        // A merged rollup has no aircraft to name, so the column is dropped
        // rather than left empty - the sheet says only what it knows.
        const lead = isMerged ? [firstLabel] : [firstLabel, 'Aircraft'];
        headerRow(ws, [...lead, 'Flights', 'NIL-Flt', 'XXLD Flt', 'Not-Op', 'OP-FLT',
          'PLA', 'PFM', 'Manifest', 'GAM Uplift', 'IFA Loads', 'Other Carrier',
          'TTl uplift', 'TTL Avg']);
        for (const r of rows) {
          const t = r.totals;
          ws.addRow([...(isMerged ? [r[firstKey]] : [r[firstKey], r.aircraft]),
            t.flights, t.nil, t.xxld, t.notOp, t.ops,
            t.pla, t.pfm,
            t.manifest, t.gamUplift, t.ifaLoads, t.otherCarrier,
            t.ttlUplift, t.ttlAvg]);
        }
        // Money starts after the FIVE flight counts (Flights, NIL, XXLD,
        // Not-Op, OP-FLT), wherever the lead columns end. Counted from the
        // columns rather than hardcoded: the literal 6 this replaced was
        // already one out the moment a count column was added.
        const moneyFrom = lead.length + 5;
        ws.columns.forEach((c, i) => {
          c.width = i < lead.length ? 22 : 13;
          if (i >= moneyFrom) c.numFmt = money;
          // The five flight counts between the lead columns and the weights.
          else if (i >= lead.length) c.numFmt = count;
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
      };
      rollup('Summary', data.sheets.map((s) => ({ ...s, totals: s.totals })), 'Sector', 'sector');
      rollup('By Region', data.regions, 'Region', 'region');

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Aviation-${data.month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      openNotification('Error', 'Could not build the workbook.', 'red');
    } finally {
      setExporting(false);
    }
  };

  /* The export now lives in the toolbar above the tab, where every other
     page's export is - see Components/Shared/PageActions. The button that used
     to sit beside the month picker is gone rather than duplicated: two ways to
     do the same thing is how a toolbar stops being believed. */
  usePageActions({
    title: 'Aviation Monthly Report',
    subtitle: merged ? 'By sector, aircraft merged' : 'By sector and aircraft',
    excel: {
      onClick: exportXlsx,
      busy: exporting,
      disabled: !data?.sheets?.length,
      title: data?.sheets?.length
        ? 'Export this month, in the grouping shown'
        : 'Nothing to export - this month has no flights',
    },
  }, [data, exporting, merged, month]);

  const untagged = data?.grand?.untagged || 0;
  // Read the grouping off the DATA, not off the toggle: while a reload is in
  // flight the toggle has already moved and the rows have not, and a table
  // headed "Aircraft" over rows that were never grouped that way is a lie the
  // user has no way to spot.
  const showAircraftCol = Boolean(data?.mergeAircraft);
  const cols = colsFor(showAircraftCol);

  return (
    <div className='base-page-layout aviation-report'>
      <Row className='align-items-center mb-3'>
        <Col className='d-flex justify-content-end align-items-center' style={{ gap: 8 }}>
          <Radio.Group size='small' value={merged}
            onChange={(e) => setMerged(e.target.value)}>
            <Radio.Button value={false}>Split by aircraft</Radio.Button>
            <Radio.Button value={true}>Merge aircraft</Radio.Button>
          </Radio.Group>
          <DatePicker
            picker='month'
            value={month}
            allowClear={false}
            format='MMM YYYY'
            onChange={(m) => { if (m) { setMonth(m); load(m); } }}
          />
        </Col>
      </Row>

      {loading ? <div className='text-center py-5'><Spin /></div> : !data?.sheets?.length ? (
        <Empty description={`No flights with a flight date in ${month.format('MMMM YYYY')}.`} />
      ) : (
        <>
          {untagged > 0 && (
            <div className='warn'>
              <b>{fmt(untagged)} kg</b> is on AWBs with no carrier, so it counts toward no
              uplift column. Set a carrier on those consignments or the month is understated.
            </div>
          )}

          {data.sheets.map((s) => (
            <div className='sheet' key={`${s.sector}|${s.aircraft}`}>
              <div className='sheet-head'>
                <b>{s.sector}</b>
                {/* Merged, a sector worked by one tail still names it - "1
                    aircraft" would hide the answer while claiming to give it.
                    Two or more, the count is the honest summary and the
                    column below has the detail. */}
                <Tag color='blue'>
                  {!showAircraftCol
                    ? (s.aircraft || 'no aircraft')
                    : s.aircraftCount === 1
                      ? (s.rows[0]?.aircraft || 'no aircraft')
                      : `${s.aircraftCount} aircraft`}
                </Tag>
                <span className='grey-txt'>
                  {s.totals.flights} flights · {s.totals.ops} operated
                  {s.totals.nil ? ` · ${s.totals.nil} NIL` : ''}
                  {s.totals.xxld ? ` · ${s.totals.xxld} cancelled` : ''}
                  {s.totals.notOp ? ` · ${s.totals.notOp} not operated` : ''}
                </span>
                {/* TTL, not GAM. The block heading has room for one average
                    and the useful one is the whole aircraft: GAM avg answers
                    how much of its own cargo flew, TTL avg how full it went,
                    which is the question asked of a sector. */}
                <span className='avg'>
                  TTL avg <b>{fmt(s.totals.ttlAvg)}</b>
                </span>
              </div>
              <table className='rpt'>
                <thead>
                  <tr>
                    {cols.map(([key, label, isNum]) => (
                      <th key={key} className={isNum ? 'num' : ''}>{label}</th>
                    ))}
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {/* A scrubbed flight is tinted like a cancelled one - both
                      are rows of zeros, and an untinted row of zeros reads as a
                      flight that flew empty. */}
                  {s.rows.map((r) => (
                    <tr key={r.id}
                      className={r.xxld ? 'cancelled' : r.notOp ? 'notop' : r.nil ? 'nil' : ''}>
                      {cols.map(([key, , isNum]) => (
                        <td key={key} className={isNum ? 'num' : ''}>
                          {/* THE FLIGHT NUMBER OPENS THE FLIGHT. The one cell
                              on this row that is not a figure to read but a
                              record to go to - a sector block shows a month of
                              flights, and the question a bad row raises is
                              always about that flight. Special-cased here
                              rather than given a renderer in BASE_COLS,
                              because that table is shared with the workbook
                              and a link means nothing in a spreadsheet cell. */}
                          {key === 'flightNo' && r.flightNo
                            ? <FlightLink id={r.id} jobNo={r.jobNo} label={r.flightNo} />
                            : isNum ? fmt(r[key]) : r[key] || '—'}
                        </td>
                      ))}
                      <td className='remarks'>{r.remarks}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={labelSpan(cols)}>Total</td>
                    {numCols(cols).map(([key]) => (
                      <td key={key} className='num'>{fmt(s.totals[key])}</td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          <div className='sheet'>
            <div className='sheet-head'><b>By region</b></div>
            <table className='rpt'>
              <thead>
                <tr>
                  <th>Region</th>
                  {!showAircraftCol && <th>Aircraft</th>}
                  <th className='num'>Flights</th><th className='num'>NIL</th>
                  <th className='num'>XXLD</th><th className='num'>Not-Op</th>
                  <th className='num'>OP-FLT</th>
                  <th className='num'>GAM Uplift</th><th className='num'>IFA Loads</th>
                  <th className='num'>Other Carrier</th><th className='num'>TTl uplift</th>
                  <th className='num'>TTL Avg</th>
                </tr>
              </thead>
              <tbody>
                {data.regions.map((r) => (
                  <tr key={`${r.region}|${r.aircraft}`}>
                    <td>{r.region || '—'}</td>
                    {!showAircraftCol && <td>{r.aircraft || '—'}</td>}
                    <td className='num'>{r.totals.flights}</td>
                    <td className='num'>{r.totals.nil}</td>
                    <td className='num'>{r.totals.xxld}</td>
                    <td className='num'>{r.totals.notOp}</td>
                    <td className='num'>{r.totals.ops}</td>
                    <td className='num'>{fmt(r.totals.gamUplift)}</td>
                    <td className='num'>{fmt(r.totals.ifaLoads)}</td>
                    <td className='num'>{fmt(r.totals.otherCarrier)}</td>
                    <td className='num'>{fmt(r.totals.ttlUplift)}</td>
                    <td className='num'>{fmt(r.totals.ttlAvg)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={showAircraftCol ? 1 : 2}>All regions</td>
                  <td className='num'>{data.grand.flights}</td>
                  <td className='num'>{data.grand.nil}</td>
                  <td className='num'>{data.grand.xxld}</td>
                  <td className='num'>{data.grand.notOp}</td>
                  <td className='num'>{data.grand.ops}</td>
                  <td className='num'>{fmt(data.grand.gamUplift)}</td>
                  <td className='num'>{fmt(data.grand.ifaLoads)}</td>
                  <td className='num'>{fmt(data.grand.otherCarrier)}</td>
                  <td className='num'>{fmt(data.grand.ttlUplift)}</td>
                  <td className='num'>{fmt(data.grand.ttlAvg)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <style jsx global>{`
        .aviation-report .warn {
          font-size: 12px;
          color: #7a5b00;
          background: #fffbe6;
          border: 1px solid #ffe58f;
          border-radius: 6px;
          padding: 7px 10px;
          margin-bottom: 12px;
        }
        .aviation-report .sheet {
          border: 1px solid #eee;
          border-radius: 6px;
          margin-bottom: 14px;
          overflow: hidden;
        }
        .aviation-report .sheet-head {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #fafafa;
          border-bottom: 1px solid #eee;
          padding: 6px 10px;
          font-size: 13px;
        }
        .aviation-report .sheet-head .grey-txt { font-size: 11px; color: #999; }
        .aviation-report .sheet-head .avg { margin-left: auto; font-size: 12px; color: #666; }
        .aviation-report .rpt { width: 100%; font-size: 12px; }
        .aviation-report .rpt th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #999;
          padding: 3px 8px;
          border-bottom: 1px solid #eee;
          white-space: nowrap;
        }
        .aviation-report .rpt td {
          padding: 3px 8px;
          border-bottom: 1px solid #f6f6f6;
          white-space: nowrap;
        }
        .aviation-report .rpt .num { text-align: right; font-variant-numeric: tabular-nums; }
        /* Marked, not coloured: a blue column down a month of flights competes
           with the figures the report exists to show. Inherits the row colour
           so a cancelled or not-operated flight's number fades with its row. */
        .aviation-report .rpt .flight-link {
          color: inherit;
          text-decoration: none;
          border-bottom: 1px dotted #c8c8c8;
        }
        .aviation-report .rpt .flight-link:hover {
          color: #1668dc;
          border-bottom-color: #1668dc;
        }
        .aviation-report .rpt .remarks { white-space: normal; color: #777; min-width: 200px; }
        .aviation-report .rpt tbody tr:hover td { background: #fafcff; }
        .aviation-report .rpt tr.cancelled td { background: #fff1f0; color: #999; }
        .aviation-report .rpt tr.nil td { background: #fffbe6; }
        .aviation-report .rpt tr.notop td { background: #fff7e6; color: #999; }
        .aviation-report .rpt tfoot td {
          font-weight: 600;
          border-top: 1px solid #e6e6e6;
          background: #fcfcfc;
        }
      `}</style>
    </div>
  );
};

export default AviationMonthly;
