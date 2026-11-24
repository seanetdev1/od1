import React, { useCallback, useEffect, useState } from 'react';
import { Row, Col, Table } from 'react-bootstrap';
import { Select, DatePicker, Input, Radio, Spin } from 'antd';
import moment from 'moment';
import { useSelector } from 'react-redux';
import openNotification from 'Components/Shared/Notification';
import { getSalesReport, getCarriers, getAviationValues } from 'apis/aviationJobs';
import { usePageActions } from 'Components/Shared/PageActions';

// Reports > Sales Report. Aviation only.
//
// ONE ROW PER AWB, buying against selling - shaped after the sales
// department's workbook. The flight summary answers what flew; this answers
// what was made on it, and the row people check is the AWB rather than the
// flight, because one flight carries many agents' cargo bought and sold at
// different rates.
//
// THE PERIOD PRESETS ARE COMPUTED HERE and sent as plain dates, the same as
// the flight summary: the server takes a from/to and nothing else, so there is
// one date rule rather than two that can disagree.
const D = 'YYYY-MM-DD';

/* The periods an aviation office actually works in.
 *
 * A FORTNIGHT here is the calendar half-month - the 1st to the 15th, or the
 * 16th to the end - which is the boundary the rates close on (see the server's
 * functions/aviationFortnight). Not "the last 14 days", which would put the
 * same AWB in two different fortnights depending on when you asked. */
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
 * Most AWBs carry no breakout charge and most rows have only one of the two
 * rate columns filled, so zeros outnumber the figures that matter. Kept as the
 * number rather than blanked: "nothing was charged here" and "this does not
 * apply" are different statements. */
const Num = ({ value, dp = 2 }) => {
  const n = Number(value) || 0;
  return <span className={n === 0 ? 'zero' : undefined}>{fmt(n, dp)}</span>;
};

/* A FIGURE THAT HAS NO ANSWER YET IS AN EM DASH, not a nought.
 *
 * The three settlement columns are null until the carrier's bill is actually
 * paid. Printing 0.00 there would read as "paid, and no exchange difference",
 * which is a different and much more comfortable statement than "we have not
 * remitted this yet". */
const Pending = ({ value, dp = 2 }) =>
  value === null || value === undefined
    ? <span className='pending'>—</span>
    : <span>{fmt(value, dp)}</span>;

/* Profit carries its sign in colour as well as in the minus.
 * A loss on an AWB is the thing the report exists to surface. */
const Profit = ({ value }) => {
  const n = Number(value) || 0;
  const cls = n < 0 ? 'loss' : n > 0 ? 'gain' : 'zero';
  return <span className={cls}>{fmt(n)}</span>;
};

const SalesReport = () => {
  const companyId = useSelector((state) => state.company.value);

  const [period, setPeriod] = useState('month');
  const [range, setRange] = useState(PRESETS.month());
  const [carriers, setCarriers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [airports, setAirports] = useState([]);

  const [operatingCarrierId, setOperatingCarrierId] = useState(undefined);
  const [masterAgentId, setMasterAgentId] = useState(undefined);
  const [origin, setOrigin] = useState(undefined);
  const [destination, setDestination] = useState(undefined);
  const [flightNo, setFlightNo] = useState('');
  const [awb, setAwb] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, v] = await Promise.all([getCarriers(), getAviationValues()]);
        setCarriers(Array.isArray(c?.result) ? c.result : []);
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
      const res = await getSalesReport({
        from: range[0].format(D),
        to: range[1].format(D),
        companyId,
        operatingCarrierId,
        masterAgentId,
        origin,
        destination,
        flightNo: flightNo.trim() || undefined,
        awb: awb.trim() || undefined,
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
  }, [range, companyId, operatingCarrierId, masterAgentId, origin, destination, flightNo, awb]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (key) => {
    setPeriod(key);
    if (PRESETS[key]) setRange(PRESETS[key]());
  };

  // The six narrowing filters. The period is NOT one of them: a report always
  // covers some range, so there is nothing to clear it to.
  const activeCount = [operatingCarrierId, masterAgentId, origin, destination,
    flightNo.trim() || undefined, awb.trim() || undefined]
    .filter((x) => x !== undefined && x !== null && x !== '').length;

  const clearFilters = () => {
    setOperatingCarrierId(undefined);
    setMasterAgentId(undefined);
    setOrigin(undefined);
    setDestination(undefined);
    setFlightNo('');
    setAwb('');
  };

  const rows = data?.rows || [];
  const totals = data?.totals;
  // The buying column is headed with the airline's own name when every AWB
  // flew the same one, and the foreign column with the currency they were
  // bought in - both decided by the server so an export cannot disagree with
  // the screen. See the server's carrierLabelFor / currencyLabelFor.
  const labels = data?.labels || { currency: 'FCY', carrier: 'Carrier' };

  // How many rows the settlement columns actually speak for. Surfaced rather
  // than left to be inferred from a column of dashes - see the note below.
  const unsettled = totals ? totals.awbs - totals.settled : 0;

  // The title on the toolbar (PageActions).
  usePageActions({ title: 'Sales Report' }, []);

  return (
    <div className='base-page-layout sales-report'>

      {/* The same filter panel as the flight summary: period and dates on top
          at their intrinsic widths, then an even six-up grid, so the two
          reports are worked the same way. */}
      <div className='filter-bar'>
        <Row className='align-items-end g-3'>
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
            {activeCount > 0 && (
              <a className='clear-filters' onClick={clearFilters}>
                Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
              </a>
            )}
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
            <div className='lbl'>Master Agent</div>
            <Select allowClear showSearch style={{ width: '100%' }} placeholder='All'
              value={masterAgentId} onChange={setMasterAgentId} optionFilterProp='label'
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
          <Col md={2} sm={4} xs={6}>
            <div className='lbl'>AWB</div>
            <Input allowClear placeholder='e.g. 230-6828' value={awb}
              onChange={(e) => setAwb(e.target.value)} />
          </Col>
        </Row>
      </div>

      <Spin spinning={loading}>
        {/* THE TOP LINE, before the detail. A twenty-column table answers "what
            happened on each AWB" but makes you add up to answer "how did the
            period go". The margin is the one figure here that is in none of
            the columns - and it is struck on the totals, not averaged across
            the rows, so a 30 kg AWB does not weigh the same as a 7,000 kg one. */}
        {totals && rows.length > 0 && (
          <Row className='headline g-2 mt-3'>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>AWBs</div>
                <div className='stat-value'>
                  {totals.awbs}
                  <span className='stat-sub'>{fmt(totals.chargeableWeight, 0)} kg chargeable</span>
                </div>
              </div>
            </Col>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>Receivable</div>
                <div className='stat-value rev'>{fmt(totals.receivable, 0)}</div>
              </div>
            </Col>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>Payable</div>
                <div className='stat-value cost'>
                  {fmt(totals.payable, 0)}
                  <span className='stat-sub'>
                    {labels.currency} {fmt(totals.dollarPayable, 0)}
                  </span>
                </div>
              </div>
            </Col>
            <Col md={3} xs={6}>
              <div className='stat'>
                <div className='stat-label'>Profit</div>
                <div className={`stat-value ${totals.profit < 0 ? 'loss' : 'gain'}`}>
                  {fmt(totals.profit, 0)}
                  <span className='stat-sub'>{fmt(totals.marginPerc, 2)}% margin</span>
                </div>
              </div>
            </Col>
          </Row>
        )}

        <div className='mt-3 table-wrap'>
          <Table className='sales-table' style={{ fontSize: 12 }}>
            {/* TWO TIERS. Twenty flat headings would make the reader count
                across to work out which side of the deal a figure is on. The
                group is said once, above the columns it owns - and the tint
                carries the same message down the body, so a row can be read
                across without counting. */}
            <thead>
              <tr className='group-row'>
                <th colSpan={4} />
                <th colSpan={2} className='num grp grp-wt'>Weight (kg)</th>
                <th colSpan={5} className='num grp grp-rate'>Rates &amp; Cost Build-up</th>
                <th />
                <th colSpan={4} className='num grp grp-local'>Local Amount</th>
                <th colSpan={4} className='num grp grp-settle'>Settlement</th>
              </tr>
              <tr className='head-row'>
                <th>Date</th>
                <th>AWB #</th>
                <th>Orig</th>
                <th>Dest</th>
                <th className='num wt'>Gross</th>
                <th className='num wt'>Chargeable</th>
                {/* Named after the airline when the run is one airline's - the
                    sheet's "Payable to UX". */}
                <th className='num cost' title={`Buying rate, ${labels.currency} per kg`}>
                  Payable to {labels.carrier}
                </th>
                <th className='num cost' title='Non-freight payable charges, by charge code'>GTC+SCAN</th>
                <th className='num cost' title='Non-freight payable charges, by charge code'>ER</th>
                <th className='num cost'>Ex-Rate</th>
                <th className='num rev' title={`Selling rate, ${labels.currency} per kg`}>CharShipper</th>
                <th>Agent</th>
                <th className='num cost'>Payable</th>
                <th className='num cost'>ER Payable</th>
                <th className='num rev'>Receivable</th>
                <th className='num prof'>Profit</th>
                <th className='num settle'>{labels.currency} Payable</th>
                <th className='num settle'>Remt Ex.Rate</th>
                <th className='num settle'>Remit Amount</th>
                <th className='num settle'>Ex Gain / Loss</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className='nowrap'>{r.date || <span className='zero'>—</span>}</td>
                  <td className='fw-7 awb'>{r.awb || <span className='zero'>—</span>}</td>
                  <td>{r.origin || <span className='zero'>—</span>}</td>
                  <td>{r.destination || <span className='zero'>—</span>}</td>
                  <td className='num wt'><Num value={r.grossWeight} /></td>
                  <td className='num wt'><Num value={r.chargeableWeight} /></td>
                  {/* A rate that was never typed is a dash, not 0.00 - an AWB
                      priced at nothing and one not yet priced are different. */}
                  <td className='num cost'><Pending value={r.buyingRate} /></td>
                  <td className='num cost'><Num value={r.gtcScan} /></td>
                  <td className='num cost'><Num value={r.er} /></td>
                  <td className='num cost'><Pending value={r.exRate} /></td>
                  <td className='num rev'><Pending value={r.sellingRate} /></td>
                  <td className='agent' title={r.agent}>{r.agent || <span className='zero'>—</span>}</td>
                  <td className='num cost'><Num value={r.payable} /></td>
                  <td className='num cost'><Num value={r.erPayable} /></td>
                  <td className='num rev'><Num value={r.receivable} /></td>
                  <td className='num prof'><Profit value={r.profit} /></td>
                  <td className='num settle'><Num value={r.dollarPayable} /></td>
                  <td className='num settle'><Pending value={r.remitExRate} /></td>
                  <td className='num settle'><Pending value={r.remitAmount} /></td>
                  <td className='num settle'><Pending value={r.exGainLoss} /></td>
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={20} className='text-center grey-txt py-5'>
                    No approved AWBs in this period.
                  </td>
                </tr>
              )}
            </tbody>
            {totals && rows.length > 0 && (
              <tfoot>
                <tr className='fw-7'>
                  <td colSpan={4} className='text-end'>
                    {totals.awbs} AWB{totals.awbs === 1 ? '' : 's'}
                  </td>
                  <td className='num wt'>{fmt(totals.grossWeight)}</td>
                  <td className='num wt'>{fmt(totals.chargeableWeight)}</td>
                  {/* The rate columns carry no total: a sum of rates per kilo
                      is not a figure, and the sheet leaves them blank too. */}
                  <td className='num cost' />
                  <td className='num cost'>{fmt(totals.gtcScan)}</td>
                  <td className='num cost'>{fmt(totals.er)}</td>
                  <td className='num cost' />
                  <td className='num rev' />
                  <td />
                  <td className='num cost'>{fmt(totals.payable)}</td>
                  <td className='num cost'>{fmt(totals.erPayable)}</td>
                  <td className='num rev'>{fmt(totals.receivable)}</td>
                  <td className='num prof'><Profit value={totals.profit} /></td>
                  <td className='num settle'>{fmt(totals.dollarPayable)}</td>
                  <td className='num settle' />
                  <td className='num settle'>{fmt(totals.remitAmount)}</td>
                  <td className='num settle'>{fmt(totals.exGainLoss)}</td>
                </tr>
              </tfoot>
            )}
          </Table>
        </div>

        {/* THE SETTLEMENT TOTAL DOES NOT COVER EVERY ROW, and saying so is the
            difference between a low remittance figure being read as "we have
            paid little" and "most of it is not paid yet". Stated rather than
            left to be counted out of a column of dashes. */}
        {totals && unsettled > 0 && rows.length > 0 && (
          <div className='settle-note mt-2'>
            <b>{unsettled}</b> of {totals.awbs} AWB{totals.awbs === 1 ? '' : 's'} have no
            settlement recorded against the carrier&apos;s bill, so the four Settlement
            columns are blank on them and the totals under Remit Amount and Ex Gain / Loss
            cover the other {totals.settled}.
          </div>
        )}
      </Spin>

      <style jsx global>{`
        .sales-report .lbl {
          font-size: 11px; color: #8a97a3; margin-bottom: 3px;
          text-transform: uppercase; letter-spacing: 0.03em;
        }

        /* FILTERS ----------------------------------------------------- */
        .sales-report .filter-bar {
          background: #fbfcfd;
          border: 1px solid #e9edf2;
          border-radius: 6px;
          padding: 12px 14px 14px;
        }
        .sales-report .range-col .ant-picker { width: 260px; }
        .sales-report .clear-filters { font-size: 12px; cursor: pointer; }

        /* HEADLINE ---------------------------------------------------- */
        .sales-report .stat {
          background: #fff;
          border: 1px solid #e9edf2;
          border-radius: 6px;
          padding: 10px 14px;
          height: 100%;
        }
        .sales-report .stat-label {
          font-size: 11px; color: #8a97a3; text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .sales-report .stat-value {
          font-size: 24px; font-weight: 700; line-height: 1.25;
          font-variant-numeric: tabular-nums; color: #1f2933;
        }
        .sales-report .stat-value.rev  { color: #096dd9; }
        .sales-report .stat-value.cost { color: #ad6800; }
        .sales-report .stat-value.gain { color: #237804; }
        .sales-report .stat-value.loss { color: #cf1322; }
        .sales-report .stat-sub {
          display: block; font-size: 11px; font-weight: 500; color: #8a97a3;
        }

        /* TABLE ------------------------------------------------------- */
        /* Twenty columns scroll inside their own box rather than the page, so
           the filters above stay put on a long period. */
        .sales-report .table-wrap {
          overflow: auto;
          max-height: 62vh;
          min-height: 320px;
          border: 1px solid #e9edf2;
          border-radius: 6px;
          background: #fff;
        }
        .sales-report .sales-table { margin-bottom: 0; }
        .sales-report .sales-table th,
        .sales-report .sales-table td {
          white-space: nowrap; vertical-align: middle;
          padding: 7px 10px; border-top: none;
          border-bottom: 1px solid #f0f3f7;
        }
        .sales-report .num { text-align: right; font-variant-numeric: tabular-nums; }
        .sales-report .awb { letter-spacing: 0.01em; }
        /* An agent name is long and is not the figure anyone came for; it is
           truncated with the whole name on hover rather than setting the width
           of the table. */
        .sales-report .agent {
          max-width: 150px; overflow: hidden; text-overflow: ellipsis;
        }

        /* Both header rows stick, so the group a column belongs to stays
           visible while scrolling a long period. */
        .sales-report .sales-table thead th {
          position: sticky; z-index: 2; background: #fff;
          font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
          color: #5b6b7c; font-weight: 600;
          border-bottom: 1px solid #e3e8ee;
        }
        .sales-report .sales-table thead tr.group-row th { top: 0; height: 26px; }
        .sales-report .sales-table thead tr.head-row th   { top: 26px; }
        .sales-report .grp {
          text-align: center; font-weight: 700; color: #2c3a47;
          border-left: 2px solid #fff; border-right: 2px solid #fff;
        }
        .sales-report .grp-wt     { background: #eef1f4; }
        .sales-report .grp-rate   { background: #f3eee6; }
        .sales-report .grp-local  { background: #e9f0f8; }
        .sales-report .grp-settle { background: #eceef2; }

        /* THE TINT IS THE SIDE OF THE DEAL. Warm is what we owe the carrier,
           cool is what we bill the agent, and the two never share a shade -
           that is what lets a twenty-column row be read across without
           counting back up to the heading. */
        .sales-report .wt     { background: #fafbfc; }
        .sales-report .cost   { background: #fdfaf4; }
        .sales-report .rev    { background: #f4f8fd; }
        .sales-report .prof   { background: #f1f4f8; font-weight: 600; }
        .sales-report .settle { background: #fafafb; }

        .sales-report .sales-table tbody tr:hover td { background: #eef4fb; }
        .sales-report .sales-table tbody tr:hover td.prof { background: #e7ebf1; }

        /* A zero is present but recedes; a figure with no answer yet recedes
           further still - see the Num and Pending components. */
        .sales-report .zero    { color: #c2cbd4; }
        .sales-report .pending { color: #d0d7de; }
        .sales-report .gain    { color: #237804; }
        .sales-report .loss    { color: #cf1322; }

        /* The totals are a conclusion, not another row: ruled off, and stuck
           to the bottom so they stay readable while the rows scroll. */
        .sales-report .sales-table tfoot td {
          position: sticky; bottom: 0; z-index: 2;
          background: #f5f6f8;
          border-top: 2px solid #cfd6de;
          border-bottom: none;
          font-weight: 700;
        }

        .sales-report .settle-note {
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

export default SalesReport;
