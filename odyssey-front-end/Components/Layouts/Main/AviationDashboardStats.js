"use client";
import React, { useEffect, useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Tag } from 'antd';
import Router from 'next/router';
import moment from 'moment';
import { useDispatch, useSelector } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import SecondaryLoader from 'Components/Shared/SecondaryLoader';
import { getAviationDashboard } from 'apis/aviationJobs';

// The aviation dashboard.
//
// Replaces DashboardStats, which counts FCL and LCL against two hardcoded
// freight companies - container load types an airline does not have, under
// names that are not its own.
//
// The counters are the airline's equivalent. PENDING LOADS below them is the
// part that earns its place: cargo that was offloaded and never flew.
const fmt = (n, dp = 0) =>
  (parseFloat(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });

const AviationDashboardStats = () => {
  const dispatch = useDispatch();
  const companyId = useSelector((state) => state.company.value);
  const [load, setLoad] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoad(true);
    getAviationDashboard({ companyId })
      .then((res) => {
        if (cancelled) return;
        setData(res?.status === 'success' ? res.result : null);
      })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoad(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  // Opening a flight registers a tab the way the rest of the app does -
  // MainLayout builds key 10-2's URL from tab.id, so a tab without one
  // navigates to /aviationJobs/undefined.
  const openFlight = (flight) => {
    if (!flight?.id) return;
    dispatch(incrementTab({ label: flight.jobNo || 'Aviation Job', key: '10-2', id: flight.id }));
    Router.push(`/aviationJobs/${flight.id}`);
  };

  if (load) return <div className="text-center py-4"><SecondaryLoader /></div>;
  if (!data) return null;

  const pending = data.pending || { rows: [], count: 0, totalPending: 0, shown: 0 };

  /* These are CALENDAR periods - the fortnight, month and quarter you are
   * currently in, not the last N days. "This fortnight" has no universal
   * boundary (the server splits on the 16th), and a figure whose period the
   * reader has to guess at is a figure they cannot check, so each tile shows
   * the dates it covers. */
  const period = (key) => data.periods?.[key];
  const span = (key) => {
    const p = period(key);
    if (!p) return '';
    const from = moment(p.from, 'YYYY-MM-DD');
    const to = moment(p.to, 'YYYY-MM-DD');
    if (!from.isValid() || !to.isValid()) return '';
    // Same month reads "1–15 Aug"; a quarter reads "1 Jul – 30 Sep".
    return from.isSame(to, 'month')
      ? `${from.format('D')}–${to.format('D MMM')}`
      : `${from.format('D MMM')} – ${to.format('D MMM')}`;
  };
  const covers = (key) => {
    const p = period(key);
    return p ? `Covers ${p.from} to ${p.to} inclusive` : undefined;
  };

  return (
    <div className="aviation-dashboard">
      <Row className="timeline-container text-center">
        <Col>
          <div className="time-heading" title={covers('fortnight')}>Flights This Fortnight</div>
          <div className="time-value">{data.flights?.fortnight ?? 0}</div>
          <div className="time-period">{span('fortnight')}</div>
        </Col>
        <Col>
          <div className="time-heading" title={covers('month')}>Flights This Month</div>
          <div className="time-value">{data.flights?.month ?? 0}</div>
          <div className="time-period">{span('month')}</div>
        </Col>
        <Col>
          <div className="time-heading" title={covers('quarter')}>Flights This Quarter</div>
          <div className="time-value">{data.flights?.quarter ?? 0}</div>
          <div className="time-period">{span('quarter')}</div>
        </Col>
        <Col>
          <div className="time-heading" title={covers('fortnight')}>Uplift This Fortnight (kg)</div>
          <div className="time-value" style={{ fontSize: 28 }}>{fmt(data.uplift)}</div>
          <div className="time-period">{span('fortnight')}</div>
        </Col>
        <Col>
          <div className="time-heading" title={covers('fortnight')}>AWBs This Fortnight</div>
          <div className="time-value">{data.awbCount ?? 0}</div>
          <div className="time-period">{span('fortnight')}</div>
        </Col>
      </Row>

      {/* PENDING LOADS. Nothing else in the system surfaces these: the flight
          reads as complete and the AWB as shipped, while the cargo is still
          on the ground. */}
      <Row className="mt-3">
        <Col md={12}>
          <div className="wh-bg-round">
            <h6 className="fw-7 top-section-heading">
              Pending Loads
              <span className="grey-txt fs-11"> (offloaded and not yet flown)</span>
              {pending.count > 0 && (
                <Tag color="volcano" className="mx-2">
                  {pending.count} AWB{pending.count === 1 ? '' : 's'} · {fmt(pending.totalPending, 2)} kg
                </Tag>
              )}
            </h6>
            <div className="line" />

            {pending.count === 0 ? (
              <div className="grey-txt fs-12 py-3">
                Nothing outstanding — every offloaded AWB has been carried on a later flight.
              </div>
            ) : (
              <>
                <div className="pending-scroll">
                  <table className="pending-table mt-2">
                    <thead>
                      <tr>
                        <th>AWB #</th>
                        <th>Carrier</th>
                        <th>Master Agent</th>
                        <th>To</th>
                        <th className="num">Carried</th>
                        <th className="num">Pending</th>
                        <th className="num">Legs</th>
                        <th>Last flight</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pending.rows.map((r) => (
                        <tr key={r.awb}>
                          <td className="mono fw-7">{r.awb}</td>
                          <td>{r.carrier || '—'}</td>
                          <td>{r.masterAgent || r.shipper || '—'}</td>
                          <td>{r.destination || '—'}</td>
                          <td className="num">{fmt(r.carried, 2)}</td>
                          <td className="num pending-kg">{fmt(r.pending, 2)}</td>
                          <td className="num">{r.legs}</td>
                          <td>
                            <a onClick={() => openFlight(r.lastFlight)}>
                              {r.lastFlight?.jobNo || r.lastFlight?.flightNo || '—'}
                            </a>
                            {r.lastFlight?.flightDate && (
                              <span className="grey-txt fs-11"> · {r.lastFlight.flightDate}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* The count above is of the whole set, so say plainly when
                    the table is only part of it. */}
                {pending.count > pending.shown && (
                  <div className="grey-txt fs-11 mt-2">
                    Showing the {pending.shown} largest of {pending.count}.
                  </div>
                )}
              </>
            )}
          </div>
        </Col>
      </Row>

      <style jsx global>{`
        /* The dates a tile covers, under its figure - small, because it is a
           caption rather than a second number. */
        .aviation-dashboard .time-period {
          font-size: 10px;
          color: #8a97a3;
          margin-top: 2px;
        }
        .aviation-dashboard .pending-scroll { max-height: 320px; overflow-y: auto; }
        .aviation-dashboard .pending-table { width: 100%; font-size: 13px; }
        .aviation-dashboard .pending-table th {
          position: sticky;
          top: 0;
          background: #fff;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          border-bottom: 1px solid #eee;
          padding: 4px 8px;
        }
        .aviation-dashboard .pending-table td {
          padding: 6px 8px;
          border-bottom: 1px solid #f5f5f5;
          vertical-align: middle;
        }
        .aviation-dashboard .pending-table .num { text-align: right; font-variant-numeric: tabular-nums; }
        .aviation-dashboard .pending-table .mono { font-variant-numeric: tabular-nums; }
        /* The number the section exists for. */
        .aviation-dashboard .pending-table .pending-kg { color: #cf1322; font-weight: 600; }
        .aviation-dashboard .pending-table a { cursor: pointer; }
      `}</style>
    </div>
  );
};

export default AviationDashboardStats;
