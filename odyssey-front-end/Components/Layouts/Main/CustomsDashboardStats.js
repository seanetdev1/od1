"use client";
import React, { useEffect, useState } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Tag } from 'antd';
import moment from 'moment';
import { useSelector } from 'react-redux';
import SecondaryLoader from 'Components/Shared/SecondaryLoader';
import { getCustomsDashboard } from 'apis/customsJobs';

// The customs dashboard.
//
// Replaces DashboardStats, which counts FCL and LCL off SE_Job against two
// HARDCODED company ids labelled "Sea Net Shipping" and "Air Cargo Service".
// A clearing agent has no sea export jobs and owns neither of those companies,
// so on a customs install every one of those counters read zero and never
// moved. It was not showing the wrong numbers - it was showing nobody's.
//
// What replaces them is what a clearing agent actually watches: how many
// declarations were filed, which way they went, which channel they landed in,
// and how much duty is out with clients waiting to be recovered.
const fmt = (n, dp = 0) =>
  (parseFloat(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });

// Green / Yellow / Red are the customs channels and carry their own meaning -
// Red is examination, which is delay. Coloured to match rather than to
// decorate. 'Unassigned' is a GD not yet assessed, which is a real state.
const CHANNEL_COLOR = {
  Green: 'green', Yellow: 'gold', Red: 'red', Blue: 'blue', Unassigned: 'default',
};

const CustomsDashboardStats = () => {
  const companyId = useSelector((state) => state.company.value);
  const [load, setLoad] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoad(true);
    getCustomsDashboard({ companyId })
      .then((res) => {
        if (cancelled) return;
        setData(res?.status === 'success' ? res.result : null);
      })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoad(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  if (load) return <div className="text-center py-4"><SecondaryLoader /></div>;
  if (!data) return null;

  /* CALENDAR periods, not the last N days - and each tile says which dates it
   * covers, because a figure whose period the reader has to guess at is a
   * figure they cannot check. Same reasoning as the aviation dashboard. */
  const span = (key) => {
    const p = data.periods?.[key];
    if (!p) return '';
    const from = moment(p.from, 'YYYY-MM-DD');
    const to = moment(p.to, 'YYYY-MM-DD');
    if (!from.isValid() || !to.isValid()) return '';
    if (from.isSame(to, 'day')) return from.format('D MMM');
    return from.isSame(to, 'month')
      ? `${from.format('D')}–${to.format('D MMM')}`
      : `${from.format('D MMM')} – ${to.format('D MMM')}`;
  };
  const covers = (key) => {
    const p = data.periods?.[key];
    if (!p) return undefined;
    return p.from === p.to ? `GDs dated ${p.from}` : `Covers ${p.from} to ${p.to} inclusive, by GD date`;
  };

  const month = data.month || {};
  const byChannel = month.byChannel || {};
  const channels = Object.entries(byChannel).sort((a, b) => b[1] - a[1]);

  return (
    <div className="customs-dashboard">
      {/* Today in place of the year (the user, 2026-11-23). */}
      <Row className="timeline-container text-center">
        <Col>
          <div className="time-heading" title={covers('today')}>GDs Today</div>
          <div className="time-value">{data.filed?.today ?? 0}</div>
          <div className="time-period">{span('today')}</div>
        </Col>
        <Col>
          <div className="time-heading" title={covers('week')}>GDs This Week</div>
          <div className="time-value">{data.filed?.week ?? 0}</div>
          <div className="time-period">{span('week')}</div>
        </Col>
        <Col>
          <div className="time-heading" title={covers('month')}>GDs This Month</div>
          <div className="time-value">{data.filed?.month ?? 0}</div>
          <div className="time-period">{span('month')}</div>
        </Col>
        <Col>
          <div className="time-heading" title={covers('month')}>Duty This Month</div>
          <div className="time-value" style={{ fontSize: 26 }}>{fmt(month.totalDuty)}</div>
          <div className="time-period">{span('month')}</div>
        </Col>
        <Col>
          {/* The figure a clearing agent's cash position turns on: duty paid
              out on clients' behalf and not yet recovered. */}
          <div className="time-heading" title="Duty paid on clients' behalf, awaiting recovery">
            Recoverable This Month
          </div>
          <div className="time-value" style={{ fontSize: 26 }}>{fmt(month.reimbursable)}</div>
          <div className="time-period">{span('month')}</div>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col md={6} className="mb-3">
          <div className="wh-bg-round" style={{ height: '100%' }}>
            <h6 className="fw-7 top-section-heading">
              This Month <span className="grey-txt fs-11">(by GD date)</span>
            </h6>
            <Row className="mt-2">
              <Col xs={6}>
                <span className="line-heading-blue">Import</span>
                <div className="fs-20 fw-7">{month.byDirection?.Import ?? 0}</div>
              </Col>
              <Col xs={6}>
                <span className="line-heading-blue">Export</span>
                <div className="fs-20 fw-7">{month.byDirection?.Export ?? 0}</div>
              </Col>
            </Row>
            <div className="mt-3">
              <span className="grey-txt fs-11">Assessed value</span>
              <div className="fw-7">{fmt(month.assessedValue, 2)}</div>
            </div>
          </div>
        </Col>

        <Col md={6} className="mb-3">
          <div className="wh-bg-round" style={{ height: '100%' }}>
            <h6 className="fw-7 top-section-heading">
              Channel <span className="grey-txt fs-11">(this month)</span>
            </h6>
            {/* Counts always add up to the month's filings - an unassessed GD
                is 'Unassigned' rather than being dropped. */}
            <div className="mt-2">
              {channels.length ? channels.map(([name, count]) => (
                <Tag key={name} color={CHANNEL_COLOR[name] || 'default'} className="mb-2">
                  {name}: <b>{count}</b>
                </Tag>
              )) : <span className="grey-txt fs-12">No declarations filed this month.</span>}
            </div>
            <div className="mt-3">
              <span className="grey-txt fs-11">Filed and still in process</span>
              <div className="fs-20 fw-7">
                {data.incomplete ?? 0}
                {data.incomplete > 0 && (
                  <Tag color="volcano" className="mx-2">open</Tag>
                )}
              </div>
            </div>
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default CustomsDashboardStats;
