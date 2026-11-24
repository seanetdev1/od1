import React, { useCallback, useEffect, useState } from 'react';
import { Row, Col, Table } from 'react-bootstrap';
import { Select, DatePicker, Input, Radio, Spin, Tag, Modal, Checkbox, Button } from 'antd';
import moment from 'moment';
import { useSelector } from 'react-redux';
import openNotification from 'Components/Shared/Notification';
import { getFlightSummary, getCarriers, getAircraft, getAviationValues } from 'apis/aviationJobs';
import {
  columnsFor, visibleColumns, hiddenCount, groupSpans, readHidden, writeHidden,
  sheetMatrix, numFormatFor,
} from 'functions/flightSummaryColumns';
import { companyTitle } from 'functions/companyBranding';
import { usePageActions } from 'Components/Shared/PageActions';
import FlightLink from 'Components/Shared/FlightLink';

// Reports > Flight Summary. Aviation only.
//
// TWO VIEWS OF ONE PERIOD, chosen by the View switch:
//
//   Per Flight     one row per flight, uplift and offload split three ways.
//                  What happened on each flight.
//   Flight Counts  one row per aircraft: PLA, how the flights divided
//                  (operated / cancelled / not-operated) and what flew.
//                  How the fleet was used.
//
// EITHER VIEW CAN HAVE COLUMNS PUT AWAY, through the Columns button - the
// list and the rules live in functions/flightSummaryColumns. Hiding a column
// changes nothing about the figures: the server sends the whole period either
// way, and the totals row keeps totalling what is on screen.
//
// BOTH COME FROM ONE REQUEST. The server returns `rows` and `byAircraft` from
// the same build, so switching view cannot change the number of cancellations
// the period had - which is exactly what two endpoints with two filter
// implementations would eventually do.
//
// ONE ROW PER FLIGHT, with uplift AND offload split three ways. Beside the
// monthly sector report rather than replacing it: that one is shaped after the
// department's workbook - a sheet per sector and aircraft - and answers how a
// route performed. This answers what happened on each flight, and what did not
// fly.
//
// THE PERIOD PRESETS ARE COMPUTED HERE and sent as plain dates. The server
// takes a from/to and nothing else, so there is one date rule rather than two
// that can disagree, and the free range beside the presets is the same code
// path as the presets themselves.
const D = 'YYYY-MM-DD';

/* The periods an aviation office actually works in.
 *
 * A FORTNIGHT here is the calendar half-month - the 1st to the 15th, or the
 * 16th to the end - which is the boundary the rates close on (see
 * functions/aviationFortnight). Not "the last 14 days", which would put the
 * same flight in two different fortnights depending on when you asked. */
const PRESETS = {
  fortnight: () => {
    const now = moment();
    return now.date() <= 15
      ? [now.clone().startOf('month'), now.clone().date(15)]
      : [now.clone().date(16), now.clone().endOf('month')];
  },
  month:   () => [moment().startOf('month'),   moment().endOf('month')],
  quarter: () => [moment().startOf('quarter'), moment().endOf('quarter')],
  year:    () => [moment().startOf('year'),    moment().endOf('year')],
};

const fmt = (n, dp = 2) =>
  n === null || n === undefined
    ? '—'
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/* A ZERO IS RENDERED FAINT, not as '0.00' in the same ink as a real figure.
 *
 * Most cells on this report are zero - a flight rarely carries all three tags,
 * and offload is the exception rather than the rule. Printed at full weight
 * they outnumber the figures that matter and the eye has to read every cell to
 * find the ones that are not nought. Kept as the number rather than blanked:
 * "nothing flew under this tag" and "this column does not apply" are different
 * statements, and a blank cell makes them look the same. */
const Num = ({ value, dp = 2 }) => {
  const n = Number(value) || 0;
  return <span className={n === 0 ? 'zero' : undefined}>{fmt(n, dp)}</span>;
};

const FlightSummary = () => {
  const companyId = useSelector((state) => state.company.value);

  // 'flights' | 'counts' - see the header note. Per Flight is the default:
  // it is the view this report was built as, and the one people arrive
  // expecting.
  const [mode, setMode] = useState('flights');
  const [period, setPeriod] = useState('month');
  const [range, setRange] = useState(PRESETS.month());
  const [carriers, setCarriers] = useState([]);
  const [aircraft, setAircraft] = useState([]);
  const [agents, setAgents] = useState([]);
  const [airports, setAirports] = useState([]);

  const [operatingCarrierId, setOperatingCarrierId] = useState(undefined);
  const [aircraftId, setAircraftId] = useState(undefined);
  const [masterAgentId, setMasterAgentId] = useState(undefined);
  const [origin, setOrigin] = useState(undefined);
  const [destination, setDestination] = useState(undefined);
  const [flightNo, setFlightNo] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Columns the user has put away, by key. Read from localStorage in an
  // effect rather than in useState's initialiser: this page is server-rendered
  // first, and reading the browser's storage during that render is a
  // hydration mismatch - the server has no localStorage and would produce a
  // different table from the one the browser then draws.
  const [hidden, setHidden] = useState([]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { setHidden(readHidden()); }, []);

  const applyHidden = (next) => {
    setHidden(next);
    writeHidden(next);
  };

  const toggleColumn = (key, show) =>
    applyHidden(show ? hidden.filter((k) => k !== key) : [...new Set([...hidden, key])]);

  useEffect(() => {
    (async () => {
      try {
        const [c, a, v] = await Promise.all([getCarriers(), getAircraft(), getAviationValues()]);
        setCarriers(Array.isArray(c?.result) ? c.result : []);
        setAircraft(Array.isArray(a?.result) ? a.result : []);
        setAgents(v?.result?.masterAgent || []);
        setAirports(v?.result?.airport || []);
      } catch (e) {
        openNotification('Error', 'Could not load the filter lists.', 'red');
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!range?.[0] || !range?.[1]) return;
    setLoading(true);
    try {
      const res = await getFlightSummary({
        from: range[0].format(D),
        to: range[1].format(D),
        companyId,
        operatingCarrierId,
        aircraftId,
        masterAgentId,
        origin,
        destination,
        flightNo: flightNo.trim() || undefined,
      });
      if (res?.status !== 'success') {
        openNotification('Error', res?.result || 'Could not build the report.', 'red');
        return;
      }
      setData(res.result);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not build the report.', 'red');
    } finally {
      setLoading(false);
    }
  }, [range, companyId, operatingCarrierId, aircraftId, masterAgentId, origin, destination, flightNo]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (key) => {
    setPeriod(key);
    if (PRESETS[key]) setRange(PRESETS[key]());
  };

  // The six narrowing filters. The period is NOT one of them: a report always
  // covers some range, so there is nothing to clear it to.
  const activeCount = [operatingCarrierId, aircraftId, masterAgentId, origin, destination,
    flightNo.trim() || undefined].filter((x) => x !== undefined && x !== null && x !== '').length;

  const clearFilters = () => {
    setOperatingCarrierId(undefined);
    setAircraftId(undefined);
    setMasterAgentId(undefined);
    setOrigin(undefined);
    setDestination(undefined);
    setFlightNo('');
  };

  const labels = data?.labels || { gam: 'GAM', ifa: 'IFA', other: 'Other' };
  const rows = data?.rows || [];
  const byAircraft = data?.byAircraft || [];
  const totals = data?.totals;
  const counts = mode === 'counts';
  // Nothing to export while a build is in flight, or when the view is empty -
  // an empty workbook is a support call, not a file.
  const canExport = !exporting && (counts ? byAircraft.length > 0 : rows.length > 0);

  const view = counts ? 'counts' : 'flights';
  const cols = visibleColumns(view, hidden);
  const away = hiddenCount(view, hidden);
  const { lead, spans } = groupSpans(cols);

  // The GAM group is headed with the airline's own name when the flights name
  // exactly one GAM carrier - see the server's gamLabelFor. Falls back to the
  // tag rather than picking one of two.
  /* A heading takes the alignment and the tag tint of the column under it,
   * and nothing else - it is derived from the column rather than copied from
   * the cell's class, which carries things a heading must not have (the `off`
   * tint that greys an offload figure would grey the word "Offload"). */
  const TAG_CLASS = { gam: 'tag-gam', ifa: 'tag-ifa', other: 'tag-other', total: 'total' };
  const headClass = (c) =>
    [c.num ? 'num' : '', TAG_CLASS[c.group] || ''].filter(Boolean).join(' ');

  const groupLabel = {
    plan: 'Planned & Manifested',
    gam: labels.gam,
    ifa: labels.ifa,
    other: labels.other,
    total: 'Total',
  };

  /* Decimal places come from the column definition, not from the cell - the
   * same `dp` sets the figure on screen and the number format in the workbook,
   * so an export cannot print a figure to a different precision from the page
   * it was taken off. */
  const dpFrom = (list) => Object.fromEntries(list.map((c) => [c.key, c.dp ?? 2]));
  const DP = dpFrom(columnsFor('flights'));
  const CDP = dpFrom(columnsFor('counts'));

  /* WHAT EACH COLUMN PUTS IN A CELL.
   *
   * Keyed by the same column key the header and the modal use, so a column
   * cannot appear in one of the three and not the others - which is how a
   * header ends up sitting over the wrong figures. `td` is the cell's class,
   * `body` the flight row, `foot` the totals row. A column with no `foot`
   * prints an empty cell there rather than a nought, because a total of the
   * flight numbers is not a thing. */
  const CELLS = {
    date:     { body: (r) => r.date },
    flightNo: {
      td: 'fw-7',
      /* THE FLIGHT NUMBER IS THE WAY INTO THE FLIGHT. A report that shows a
         flight did not go, or carried a third of its plan, is read by someone
         who then wants the flight itself - and the alternative was reading the
         number off here and searching for it on the flight list. Only the
         number is the link; the tags beside it are not, so clicking "XXLD"
         does not navigate. A row with no flight number typed keeps its plain
         dash rather than becoming a linked em-dash. */
      body: (r) => (
        <>
          {r.flightNo
            ? <FlightLink id={r.id} jobNo={r.jobNo} label={r.flightNo} />
            : '—'}
          {/* A flight that did not go keeps its row - it is part of the
              schedule - but carried nothing, so every figure is 0. The tag is
              why the row is empty; without it a scrubbed flight and a flight
              that flew nothing look identical. */}
          {r.xxld ? <Tag color='red' className='mx-1'>XXLD</Tag> : null}
          {r.notOp ? <Tag color='orange' className='mx-1'>NOT-OP</Tag> : null}
        </>
      ),
    },
    aircraft: { body: (r) => r.aircraft || <span className='zero'>—</span> },
    // An arrow rather than a hyphen, and the missing half shown as a gap: a
    // sector reading just "KHI" looks like a typo until you know the
    // destination was never filled in.
    sector: {
      td: 'sector',
      body: (r) => (
        <>
          {r.origin || <span className='zero'>—</span>}
          <span className='arrow'>→</span>
          {r.destination || <span className='zero'>—</span>}
        </>
      ),
    },
    pfm:          { td: 'num', body: (r) => <Num value={r.pfm} dp={DP.pfm} />, foot: (t) => fmt(t.pfm, DP.pfm) },
    manifest:     { td: 'num', body: (r) => <Num value={r.manifest} />, foot: (t) => fmt(t.manifest) },
    gamUplift:    { td: 'num tag-gam', body: (r) => <Num value={r.uplift.GAM} />, foot: (t) => fmt(t.uplift.GAM) },
    gamOffload:   { td: 'num tag-gam off', body: (r) => <Num value={r.offload.GAM} />, foot: (t) => fmt(t.offload.GAM) },
    ifaUplift:    { td: 'num tag-ifa', body: (r) => <Num value={r.uplift.IFA} />, foot: (t) => fmt(t.uplift.IFA) },
    ifaOffload:   { td: 'num tag-ifa off', body: (r) => <Num value={r.offload.IFA} />, foot: (t) => fmt(t.offload.IFA) },
    otherUplift:  { td: 'num tag-other', body: (r) => <Num value={r.uplift.Other} />, foot: (t) => fmt(t.uplift.Other) },
    otherOffload: { td: 'num tag-other off', body: (r) => <Num value={r.offload.Other} />, foot: (t) => fmt(t.offload.Other) },
    totalUplift:  { td: 'num total', body: (r) => <Num value={r.totalUplift} />, foot: (t) => fmt(t.totalUplift) },
    totalOffload: { td: 'num total off', body: (r) => <Num value={r.totalOffload} />, foot: (t) => fmt(t.totalOffload) },
  };

  /* The same, for Flight Counts. Separate because it is a different row - one
   * aircraft, not one flight - and a single map keyed by column name would
   * have to know which it had been handed. */
  const COUNT_CELLS = {
    aircraft: { td: 'fw-7', body: (r) => r.aircraft, foot: () => 'All aircraft', footClass: 'text-end' },
    pla: {
      td: 'num',
      // An average when the flights disagree, and it says so on hover rather
      // than presenting a mean as if it were the figure. A dash where nobody
      // has typed a PLA: "not recorded" is not "no payload".
      body: (r) => (r.pla === null
        ? <span className='zero'>—</span>
        : (
          <span title={r.plaVaries
            ? `Average of ${r.plaFrom} flight(s) - they do not all carry the same PLA`
            : undefined}>
            {fmt(r.pla, CDP.pla)}{r.plaVaries ? ' *' : ''}
          </span>
        )),
      // No PLA total. Available payloads are capacities of different aircraft
      // on different days; adding them up describes no flight.
      foot: () => <span className='zero'>—</span>,
    },
    ttlFlt: { td: 'num', body: (r) => r.ttlFlt, foot: (t) => t.flights },
    opFlt:  { td: 'num', body: (r) => r.opFlt, foot: (t) => t.flights - t.xxld - t.notOp },
    xxld: {
      td: 'num',
      body: (r) => (r.xxld ? <span className='xxld-count'>{r.xxld}</span> : <span className='zero'>0</span>),
      foot: (t) => t.xxld,
    },
    notOp: {
      td: 'num',
      body: (r) => (r.notOp ? <span className='notop-count'>{r.notOp}</span> : <span className='zero'>0</span>),
      foot: (t) => t.notOp,
    },
    ttlWgt: { td: 'num total', body: (r) => <Num value={r.totalUplift} dp={CDP.ttlWgt} />, foot: (t) => fmt(t.totalUplift, CDP.ttlWgt) },
  };

  /**
   * Export to xlsx - WHAT IS ON SCREEN, not everything the server sent.
   *
   * The current view, and the columns that survived the Columns picker. A
   * report someone has narrowed to five columns and then exports has been
   * narrowed on purpose; handing them back the other nine would undo the only
   * thing the picker is for. The button says so, so nobody has to guess.
   *
   * A second sheet records the period and the filters. A workbook lands in an
   * inbox with no idea what produced it, and "flight summary.xlsx" with no
   * dates on it is a table nobody can check.
   */
  const exportXlsx = async () => {
    const source = counts ? byAircraft : rows;
    if (!source.length) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default || (await import('exceljs'));
      const wb = new ExcelJS.Workbook();
      wb.creator = companyTitle(companyId, 'Odyssey');
      wb.created = new Date();

      const { header, body, foot } = sheetMatrix(view, cols, source, totals, groupLabel);
      const ws = wb.addWorksheet(counts ? 'Flight Counts' : 'Per Flight');

      const head = ws.addRow(header);
      head.font = { bold: true };
      head.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
        c.border = { bottom: { style: 'thin' } };
      });

      for (const line of body) ws.addRow(line);

      if (foot) {
        const totalRow = ws.addRow(foot);
        totalRow.font = { bold: true };
        totalRow.eachCell((c) => { c.border = { top: { style: 'thin' } }; });
      }

      cols.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = c.num ? 13 : 16;
        const fmtStr = numFormatFor(c);
        if (fmtStr) col.numFmt = fmtStr;
      });
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      // An averaged PLA carries a star on screen and an explanation on hover;
      // a spreadsheet has neither, so the ones that were averaged are named.
      if (counts) {
        const varied = source.filter((r) => r.plaVaries).map((r) => r.aircraft);
        if (varied.length) {
          ws.addRow([]);
          ws.addRow([`PLA is an average where a fleet's flights differ: ${varied.join(', ')}`]);
        }
      }

      const meta = wb.addWorksheet('Filters');
      meta.columns = [{ width: 20 }, { width: 40 }];
      const nameOf = (list, id) => list.find((x) => x.id === id)?.name || '';
      for (const line of [
        ['Report', counts ? 'Flight Summary - Flight Counts' : 'Flight Summary - Per Flight'],
        ['Period', period],
        ['From', range?.[0]?.format(D) || ''],
        ['To', range?.[1]?.format(D) || ''],
        ['Airline', nameOf(carriers, operatingCarrierId)],
        ['Aircraft', nameOf(aircraft, aircraftId)],
        ['Master Agent', nameOf(agents, masterAgentId)],
        ['Origin', nameOf(airports, origin)],
        ['Destination', nameOf(airports, destination)],
        ['Flight No.', flightNo.trim()],
        ['Columns hidden', away > 0
          ? columnsFor(view).filter((c) => !cols.includes(c)).map((c) => c.label).join(', ')
          : 'none'],
        ['Generated', moment().format('YYYY-MM-DD HH:mm')],
      ]) {
        const r = meta.addRow(line);
        r.getCell(1).font = { bold: true };
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Flight-Summary${counts ? '-Counts' : ''}`
        + `-${range?.[0]?.format(D) || ''}_${range?.[1]?.format(D) || ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      openNotification('Error', 'Could not build the workbook.', 'red');
    } finally {
      setExporting(false);
    }
  };

  /* Export in the toolbar, with every other page's. Columns rides along as an
     EXTRA - it belongs to this report alone, so it is drawn after the five
     standard slots rather than taking one of their positions. */
  usePageActions({
    title: 'Flight Summary',
    subtitle: counts ? 'Flight counts by aircraft' : 'One row per flight',
    excel: {
      onClick: exportXlsx,
      busy: exporting,
      disabled: !canExport,
      title: canExport
        ? 'Exports the view and the columns currently on screen'
        : 'Nothing to export - no flights in this period',
    },
    extras: [{
      key: 'columns',
      label: away > 0 ? `Columns · ${away} hidden` : 'Columns',
      onClick: () => setColumnsOpen(true),
      title: 'Choose which columns this report shows',
    }],
  }, [canExport, exporting, away, view]);

  return (
    <div className='base-page-layout flight-summary'>
      {/* ONE PANEL, TWO ROWS, AND A CONSISTENT RHYTHM.
          Period and the dates belong together on top - the presets are just
          shortcuts to the range beside them. Period takes only the width its
          buttons need rather than a third of the row, which is what left the
          gap; everything below is a six-up grid of equal fields, so the
          columns line up instead of the two rows reading as separate bars. */}
      <div className='filter-bar'>
        <Row className='align-items-end g-3'>
          <Col xs='auto'>
            {/* Beside Period rather than up by the title: both change what the
                table below says, and a control that reshapes a report should
                sit with the ones that filter it. */}
            <div className='lbl'>View</div>
            <Radio.Group size='small' value={mode} onChange={(e) => setMode(e.target.value)}>
              <Radio.Button value='flights'>Per Flight</Radio.Button>
              <Radio.Button value='counts'>Flight Counts</Radio.Button>
            </Radio.Group>
          </Col>
          <Col xs='auto'>
            <div className='lbl'>Period</div>
            <Radio.Group size='small' value={period}
              onChange={(e) => applyPreset(e.target.value)}>
              <Radio.Button value='fortnight'>Fortnight</Radio.Button>
              <Radio.Button value='month'>Month</Radio.Button>
              <Radio.Button value='quarter'>Quarter</Radio.Button>
              <Radio.Button value='year'>Year</Radio.Button>
              <Radio.Button value='custom'>Custom</Radio.Button>
            </Radio.Group>
          </Col>
          <Col xs='auto' className='range-col'>
            {/* Always shown, not only under Custom: a preset is a shortcut to
                a range, and seeing which dates it chose is how you check it. */}
            <div className='lbl'>From / To</div>
            <DatePicker.RangePicker format={D} value={range} allowClear={false}
              onChange={(v) => { setRange(v); setPeriod('custom'); }} />
          </Col>
          <Col className='text-end'>
            {/* One row, one rhythm. The three sit in a flex line of their own
                rather than being pushed apart with margins, so they stay
                aligned whether or not the Clear link is there. */}
            <div className='report-actions'>
              {/* Clear filters STAYS on the page. It acts on the controls
                  beside it, not on the report as a document - the toolbar is
                  for what a page can do, not for undoing what was typed into
                  it. */}
              {activeCount > 0 && (
                <a className='clear-filters' onClick={clearFilters}>
                  Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
                </a>
              )}
            </div>
          </Col>
        </Row>

        <Row className='align-items-end g-3 mt-0'>
          <Col md={2} sm={4} xs={6}>
            <div className='lbl'>Airline</div>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder='All'
              value={operatingCarrierId} onChange={setOperatingCarrierId} optionFilterProp='label'
              options={carriers.map((c) => ({ value: c.id, label: c.name }))} />
          </Col>
          <Col md={2} sm={4} xs={6}>
            <div className='lbl'>Aircraft</div>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder='All'
              value={aircraftId} onChange={setAircraftId} optionFilterProp='label'
              options={aircraft.map((a) => ({ value: a.id, label: a.name }))} />
          </Col>
          <Col md={2} sm={4} xs={6}>
            <div className='lbl'>Master Agent</div>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder='All'
              value={masterAgentId} onChange={setMasterAgentId} optionFilterProp='label'
              title='Selects which flights appear. The figures stay whole-flight.'
              options={agents.map((a) => ({ value: a.id, label: a.name }))} />
          </Col>
          <Col md={2} sm={4} xs={6}>
            <div className='lbl'>Origin</div>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder='All'
              value={origin} onChange={setOrigin} optionFilterProp='label'
              options={airports.map((a) => ({ value: a.id, label: a.name }))} />
          </Col>
          <Col md={2} sm={4} xs={6}>
            <div className='lbl'>Destination</div>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder='All'
              value={destination} onChange={setDestination} optionFilterProp='label'
              options={airports.map((a) => ({ value: a.id, label: a.name }))} />
          </Col>
          <Col md={2} sm={4} xs={6}>
            <div className='lbl'>Flight No.</div>
            <Input allowClear placeholder='e.g. PK-301' value={flightNo}
              onChange={(e) => setFlightNo(e.target.value)} />
          </Col>
        </Row>
      </div>

      {/* Out of the grid, not in a spare column - a note that only sometimes
          appears should not leave a hole in the filter row the rest of the
          time. */}
      {masterAgentId && (
        <div className='agent-note mt-2'>
          Selecting an agent picks the <b>flights</b> they had cargo on. The figures
          remain whole-flight — PFM is a plan for the aircraft and cannot be split
          between agents.
        </div>
      )}

      <Spin spinning={loading}>
        {/* THE TOP LINE, before the detail. A fourteen-column table answers
            "what happened on each flight" but makes you add up to answer "how
            did the period go". These four are the answer, and the offload rate
            is the one figure here that is not in the table at all - the share
            of what was booked that never left. */}
        {totals && rows.length > 0 && (
          <Row className='headline g-2 mt-3'>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>Flights</div>
                <div className='stat-value'>
                  {totals.flights}
                  {(totals.xxld > 0 || totals.notOp > 0) && (
                    <span className='stat-sub'>
                      {[
                        totals.xxld > 0 ? `${totals.xxld} cancelled` : null,
                        totals.notOp > 0 ? `${totals.notOp} not operated` : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            </Col>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>Manifested (kg)</div>
                <div className='stat-value'>{fmt(totals.manifest, 0)}</div>
              </div>
            </Col>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>Total Uplift (kg)</div>
                <div className='stat-value up'>{fmt(totals.totalUplift, 0)}</div>
              </div>
            </Col>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>Total Offload (kg)</div>
                <div className='stat-value down'>
                  {fmt(totals.totalOffload, 0)}
                  {totals.manifest > 0 && (
                    <span className='stat-sub'>
                      {((totals.totalOffload / totals.manifest) * 100).toFixed(1)}% of manifest
                    </span>
                  )}
                </div>
              </div>
            </Col>
          </Row>
        )}

        {/* FLIGHT COUNTS. One row per aircraft, and the three count columns
            always add back to TTL Flt - a NIL flight is OPERATED, since it
            went and simply carried nothing. TTL Wgt is what actually flew,
            so a cancelled or not-operated flight contributes nothing to it
            however much was booked on it. */}
        {counts && (
          <div className='mt-3 table-wrap'>
            <Table className='summary-table counts-table' style={{ fontSize: 12 }}>
              <thead>
                <tr className='head-row'>
                  {cols.map((c) => (
                    <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byAircraft.map((r) => (
                  <tr key={r.aircraft}>
                    {cols.map((c) => (
                      <td key={c.key} className={COUNT_CELLS[c.key].td}>
                        {COUNT_CELLS[c.key].body(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!byAircraft.length && !loading && (
                  <tr>
                    <td colSpan={cols.length} className='text-center grey-txt py-5'>
                      No flights in this period{masterAgentId ? ' for that master agent' : ''}.
                    </td>
                  </tr>
                )}
              </tbody>
              {totals && byAircraft.length > 0 && (
                <tfoot>
                  <tr className='fw-7'>
                    {cols.map((c) => (
                      <td key={c.key}
                        className={COUNT_CELLS[c.key].footClass || COUNT_CELLS[c.key].td}>
                        {COUNT_CELLS[c.key].foot(totals)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </Table>
          </div>
        )}

        {!counts && (
        <div className='mt-3 table-wrap'>
          <Table className='summary-table' style={{ fontSize: 12 }}>
            {/* TWO TIERS. Six of the columns are three Uplift/Offload PAIRS,
                and flat headings made the reader count across to work out
                which offload belonged to which tag. The group name is said
                once, above the pair it owns - and a group whose columns have
                both been put away is gone from this row entirely rather than
                spanning nothing. */}
            <thead>
              {spans.length > 0 && (
                <tr className='group-row'>
                  {lead > 0 && <th colSpan={lead} />}
                  {spans.map((g) => (
                    <th key={g.key} colSpan={g.span} className={g.cls}>{groupLabel[g.key]}</th>
                  ))}
                </tr>
              )}
              <tr className='head-row'>
                {cols.map((c) => (
                  <th key={c.key} className={headClass(c)}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.xxld ? 'xxld' : r.notOp ? 'notop' : ''}>
                  {cols.map((c) => (
                    <td key={c.key} className={CELLS[c.key].td}>{CELLS[c.key].body(r)}</td>
                  ))}
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={cols.length} className='text-center grey-txt py-5'>
                    No flights in this period{masterAgentId ? ' for that master agent' : ''}.
                  </td>
                </tr>
              )}
            </tbody>
            {totals && rows.length > 0 && (
              <tfoot>
                <tr className='fw-7'>
                  {/* The flight count sits under the lead columns, spanning
                      however many are left - and moves into the first figure
                      column's row when they have all been put away. */}
                  {lead > 0 && (
                    <td colSpan={lead} className='text-end'>
                      {totals.flights} flight{totals.flights === 1 ? '' : 's'}
                      {totals.xxld > 0 && <span className='grey-txt'> · {totals.xxld} XXLD</span>}
                      {totals.notOp > 0 && <span className='grey-txt'> · {totals.notOp} NOT-OP</span>}
                    </td>
                  )}
                  {cols.filter((c) => c.group).map((c) => (
                    <td key={c.key} className={CELLS[c.key].td}>{CELLS[c.key].foot(totals)}</td>
                  ))}
                </tr>
              </tfoot>
            )}
          </Table>
        </div>
        )}

        {/* Cargo on AWBs that carry no tag AND whose carrier has none counts
            toward no column, so it is stated rather than quietly missing from
            the three. A fixable mistake, not a number to read. */}
        {totals && (totals.uplift.untagged > 0 || totals.offload.untagged > 0) && (
          <div className='untagged-note mt-2'>
            <b>{fmt(totals.uplift.untagged)} kg</b> uplift and <b>{fmt(totals.offload.untagged)} kg</b> offload
            sit on AWBs with no reporting tag, so they are in Total but in none of the three
            columns. Set the carrier, or the AWB&apos;s own Report Tag, on the flight.
          </div>
        )}
      </Spin>

      {/* COLUMNS. Ticked is shown; the identity column of each view is ticked
          and disabled, because a table whose rows cannot be told apart is not
          a shorter report. Applies as you tick rather than on an OK button -
          the table is behind the modal and the point is to see the effect. */}
      <Modal
        title={`Columns — ${counts ? 'Flight Counts' : 'Per Flight'}`}
        open={columnsOpen}
        onCancel={() => setColumnsOpen(false)}
        footer={[
          <Button key='all' onClick={() => applyHidden([])} disabled={away === 0}>
            Show all
          </Button>,
          // No type='primary' here either, for the same reason. footer is a
          // plain array, so this is a JS comment and not a JSX one.
          <Button key='done' onClick={() => setColumnsOpen(false)}>Done</Button>,
        ]}
        width={420}
      >
        <p className='grey-txt fs-12'>
          Hiding a column changes nothing about the figures — the totals row keeps
          totalling what is on screen. The choice is remembered on this computer.
        </p>
        <div>
          {columnsFor(view).map((c) => (
            <div className='fs-col-picker-row' key={c.key}>
              <Checkbox
                checked={cols.some((v) => v.key === c.key)}
                disabled={c.locked}
                onChange={(e) => toggleColumn(c.key, e.target.checked)}
              >
                {/* The group name disambiguates the three pairs: five columns
                    are called Uplift or Offload, and a list of them alone
                    would be unusable. */}
                {c.group && groupLabel[c.group] ? `${groupLabel[c.group]} — ${c.label}` : c.label}
              </Checkbox>
              {c.locked && <span className='grey-txt fs-12'>always shown</span>}
            </div>
          ))}
        </div>
      </Modal>

      <style jsx global>{`
        /* Not scoped under .flight-summary: antd renders a Modal in a portal
           on document.body, outside this report's own element. */
        .fs-col-picker-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 4px 0; border-bottom: 1px solid #f4f6f8;
        }
        .fs-col-picker-row:last-child { border-bottom: 0; }

        .flight-summary .lbl {
          font-size: 11px; color: #8a97a3; margin-bottom: 3px;
          text-transform: uppercase; letter-spacing: 0.03em;
        }

        /* FILTERS ----------------------------------------------------- */
        /* A panel with an edge, matching the table below it, so the two read
           as parts of one report rather than controls floating on the page. */
        .flight-summary .filter-bar {
          background: #fbfcfd;
          border: 1px solid #e9edf2;
          border-radius: 6px;
          padding: 12px 14px 14px;
        }
        /* Wide enough for two dates and the arrow, and no wider - the range
           picker sized to a grid column was most of the empty space. */
        .flight-summary .range-col .ant-picker { width: 260px; }
        .flight-summary .clear-filters { font-size: 12px; cursor: pointer; }
        .flight-summary .report-actions {
          display: flex; align-items: center; justify-content: flex-end; gap: 8px;
        }

        /* HEADLINE ---------------------------------------------------- */
        .flight-summary .stat {
          background: #fff;
          border: 1px solid #e9edf2;
          border-radius: 6px;
          padding: 10px 14px;
          height: 100%;
        }
        .flight-summary .stat-label {
          font-size: 11px; color: #8a97a3; text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .flight-summary .stat-value {
          font-size: 24px; font-weight: 700; line-height: 1.25;
          font-variant-numeric: tabular-nums; color: #1f2933;
        }
        .flight-summary .stat-value.up   { color: #237804; }
        .flight-summary .stat-value.down { color: #cf1322; }
        .flight-summary .stat-sub {
          display: block; font-size: 11px; font-weight: 500; color: #8a97a3;
        }

        /* TABLE ------------------------------------------------------- */
        /* The table scrolls inside its own box rather than the page, so the
           filters above stay put on a long period. */
        .flight-summary .xxld-count { color: #cf1322; font-weight: 600; }
        .flight-summary .notop-count { color: #d46b08; font-weight: 600; }
        .flight-summary .counts-table td { padding-top: 6px; padding-bottom: 6px; }

        .flight-summary .table-wrap {
          overflow: auto;
          max-height: 62vh;
          min-height: 320px;
          border: 1px solid #e9edf2;
          border-radius: 6px;
          background: #fff;
        }
        .flight-summary .summary-table { margin-bottom: 0; }
        .flight-summary .summary-table th,
        .flight-summary .summary-table td {
          white-space: nowrap; vertical-align: middle;
          padding: 7px 12px; border-top: none;
          border-bottom: 1px solid #f0f3f7;
        }
        .flight-summary .num { text-align: right; font-variant-numeric: tabular-nums; }

        /* Both header rows stick, so the tag a column belongs to stays
           visible while scrolling a long period. */
        .flight-summary .summary-table thead th {
          position: sticky; z-index: 2; background: #fff;
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
          color: #5b6b7c; font-weight: 600;
          border-bottom: 1px solid #e3e8ee;
        }
        .flight-summary .summary-table thead tr.group-row th { top: 0; height: 26px; }
        .flight-summary .summary-table thead tr.head-row th   { top: 26px; }
        /* EXCEPT IN FLIGHT COUNTS, which has no group row above it.
           
           That view renders a single header row, so offsetting it by the
           height of a row that is not there leaves a 26px dead band at the top
           of the scroll box: the first aircraft slides up into it and is
           covered by the header, which is a row of figures silently missing
           from a report whose totals still count it. The offset belongs to the
           two-tier header, so it is scoped to it. */
        .flight-summary .counts-table thead tr.head-row th { top: 0; }

        /* The group name sits on the pair it owns, in that pair's tint, and
           is centred over the two rather than right-aligned like a figure. */
        .flight-summary .grp {
          text-align: center; font-weight: 700; color: #2c3a47;
          border-left: 2px solid #fff; border-right: 2px solid #fff;
        }
        .flight-summary .grp-plan  { text-align: center; color: #8a97a3; }
        .flight-summary .grp-gam   { background: #e8f1ff; }
        .flight-summary .grp-ifa   { background: #e7f7ea; }
        .flight-summary .grp-other { background: #fbf1e2; }
        .flight-summary .grp-total { background: #eceef2; }

        /* The three tag pairs are tinted so a wide row can be read across
           without counting columns. */
        .flight-summary .tag-gam   { background: #f5f9ff; }
        .flight-summary .tag-ifa   { background: #f4fbf5; }
        .flight-summary .tag-other { background: #fdfaf4; }
        .flight-summary .total     { background: #f5f6f8; font-weight: 600; }
        /* An offload is the exception on any flight, so the right-hand half of
           each pair is marked rather than left to be counted to. */
        .flight-summary .off { border-right: 1px solid #e3e8ee; }

        .flight-summary .summary-table tbody tr:hover td { background: #eef4fb; }
        .flight-summary .summary-table tbody tr:hover td.total { background: #e7ebf1; }

        /* A zero is present but recedes - see the Num component. */
        .flight-summary .zero { color: #c2cbd4; }
        .flight-summary tr.xxld td { color: #98a2ad; background: #fcfcfd; }
        .flight-summary tr.notop td { color: #98a2ad; background: #fffaf3; }

        .flight-summary .sector .arrow { color: #b6c0cb; margin: 0 6px; }

        /* The flight number reads as itself until it is pointed at - an
           underlined blue column down a table of figures is loud, and this
           report is read far more often than it is clicked through. Inherits
           the row's colour, so a cancelled flight's number greys with its row
           instead of staying bright on a faded line. */
        .flight-summary .flight-link {
          color: inherit;
          text-decoration: none;
          border-bottom: 1px dotted #b6c0cb;
        }
        .flight-summary .flight-link:hover {
          color: #1668dc;
          border-bottom-color: #1668dc;
        }

        /* The totals are a conclusion, not another row: ruled off, and stuck
           to the bottom so they stay readable while the rows scroll. */
        .flight-summary .summary-table tfoot td {
          position: sticky; bottom: 0; z-index: 2;
          background: #f5f6f8;
          border-top: 2px solid #cfd6de;
          border-bottom: none;
          font-weight: 700;
        }

        .flight-summary .agent-note,
        .flight-summary .untagged-note {
          font-size: 11px;
          line-height: 1.5;
          padding: 6px 10px;
          background: #fff9f0;
          border: 1px solid #ffe2bd;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default FlightSummary;
