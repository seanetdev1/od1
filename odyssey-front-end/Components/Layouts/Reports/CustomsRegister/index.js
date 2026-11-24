import React, { useState, useCallback } from 'react';
import { Table, DatePicker, Select, Spin, Tag } from 'antd';
import { Row, Col } from 'react-bootstrap';
import Router from 'next/router';
import { useDispatch, useSelector } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import moment from 'moment';
import { getCustomsRegister } from 'apis/customsJobs';
import openNotification from 'Components/Shared/Notification';
import { money } from 'functions/customsDuty';
import { usePageActions } from 'Components/Shared/PageActions';

// The duty register: every GD filed in a month, its duty, and what the agent
// is owed back.
//
// This is the return a clearing agent reconciles against its own bank. Duty
// the agent paid leaves the account on the day the PSID is paid and comes back
// on an invoice; the gap between the two figures is the money currently out
// with clients, which is why Total Duty and Reimbursable are shown side by
// side rather than as one number.
//
// The month is the GD DATE, not when the row was typed - a declaration entered
// a week late still belongs to the month it was filed in, and any other answer
// makes this disagree with the customs portal it is checked against.

const M_STORE = 'YYYY-MM';
const CHANNEL_COLORS = { Green: 'green', Yellow: 'gold', Red: 'red', Blue: 'blue' };

const CustomsRegister = () => {
  const dispatchTab = useDispatch();
  // Read here rather than taken as a prop, matching AviationMonthly: the
  // report is opened from the sidebar, which passes nothing.
  const companyId = useSelector((state) => state.company.value);
  const [month, setMonth] = useState(() => moment());
  const [direction, setDirection] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!month?.isValid()) return;
    setLoading(true);
    try {
      const res = await getCustomsRegister({
        month: month.format(M_STORE),
        companyId,
        direction: direction || undefined,
      });
      if (res?.status !== 'success') {
        openNotification('Error', res?.result || 'Could not build the register.', 'red');
        setData(null);
        return;
      }
      setData(res.result);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not build the register.', 'red');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month, direction, companyId]);

  // Opening a GD from the register registers a tab the same way the list does,
  // so the row is a way into the file rather than a dead end.
  const open = (record) => {
    dispatchTab(incrementTab({ label: record.jobNo || 'Customs Job', key: '11-2', id: record.id }));
    Router.push(`/customsJobs/${record.id}`);
  };

  const columns = [
    { title: 'GD No.', dataIndex: 'gdNumber', key: 'gdNumber', render: (v) => v || '-' },
    { title: 'GD Date', dataIndex: 'gdDate', key: 'gdDate' },
    { title: 'Job No.', dataIndex: 'jobNo', key: 'jobNo' },
    { title: 'Client', dataIndex: 'client', key: 'client', render: (v) => v || '-' },
    { title: 'Type', key: 'type',
      render: (_, r) => [r.direction, r.gdType].filter(Boolean).join(' · ') || '-' },
    { title: 'Channel', key: 'channel',
      render: (_, r) => (r.channel
        ? <Tag color={CHANNEL_COLORS[r.channel]}>{r.channel}</Tag>
        : <span className='grey-txt'>-</span>) },
    { title: 'Assessed Value', dataIndex: 'assessedValue', key: 'assessedValue',
      align: 'right', render: (v) => money(v) },
    { title: 'Total Duty', dataIndex: 'totalDuty', key: 'totalDuty',
      align: 'right', render: (v) => money(v) },
    { title: 'Paid By', dataIndex: 'dutyPaidBy', key: 'dutyPaidBy', render: (v) => v || '-' },
    { title: 'Reimbursable', dataIndex: 'reimbursable', key: 'reimbursable',
      align: 'right',
      // Blank rather than 0.00 where the client paid customs direct: a column
      // of zeros buries the rows that are actually money owed back.
      render: (v) => (v ? <b>{money(v)}</b> : <span className='grey-txt'>-</span>) },
    { title: 'PSID', dataIndex: 'psid', key: 'psid', render: (v) => v || '-' },
  ];

  // The title on the toolbar (PageActions); Go stays on the page.
  usePageActions({ title: 'Customs Register' }, []);

  return (
    <div className='client-styles customs-register'>
      <Row className='align-items-center mb-3'>
        <Col className='d-flex justify-content-end' style={{ gap: '0.5rem' }}>
          <Select
            style={{ width: 130 }}
            value={direction || undefined}
            placeholder='All'
            allowClear
            onChange={(v) => setDirection(v || '')}
            options={[{ value: 'Import', label: 'Import' }, { value: 'Export', label: 'Export' }]}
          />
          <DatePicker picker='month' value={month} onChange={(m) => setMonth(m)} format='MMM YYYY' />
          <button type='button' className='btn-custom' onClick={run} disabled={loading || !month}>
            {loading ? 'Building…' : 'Show'}
          </button>
        </Col>
      </Row>

      {loading && <div className='text-center py-5'><Spin /></div>}

      {!loading && data && (
        <>
          <div className='register-summary'>
            <div className='fig'>
              <span>GDs filed</span>
              <b>{data.rows.length}</b>
            </div>
            <div className='fig'>
              <span>Assessed value</span>
              <b>{money(data.totals.assessedValue)}</b>
            </div>
            <div className='fig'>
              <span>Total duty</span>
              <b>{money(data.totals.totalDuty)}</b>
            </div>
            <div className='fig accent'>
              {/* The figure this report exists for: money the agent has out
                  with clients right now. */}
              <span>Reimbursable</span>
              <b>{money(data.totals.reimbursable)}</b>
            </div>
            <div className='channels'>
              {Object.entries(data.byChannel).map(([channel, count]) => (
                <Tag key={channel} color={CHANNEL_COLORS[channel]}>{channel} <b>{count}</b></Tag>
              ))}
            </div>
          </div>

          <Table
            rowKey='id'
            size='small'
            dataSource={data.rows}
            columns={columns}
            pagination={false}
            locale={{ emptyText: `No GDs filed in ${month.format('MMMM YYYY')}.` }}
            onRow={(record) => ({
              onClick: () => open(record),
              style: { cursor: 'pointer' },
            })}
          />
        </>
      )}

      {!loading && !data && (
        <p className='grey-txt'>Pick a month and press Show.</p>
      )}

      <style jsx global>{`
        .customs-register .register-summary {
          display: flex;
          align-items: center;
          gap: 26px;
          flex-wrap: wrap;
          padding: 12px 16px;
          margin-bottom: 12px;
          border: 1px solid #eee;
          border-radius: 8px;
          background: #fcfcfc;
        }
        .customs-register .register-summary .fig {
          display: flex;
          flex-direction: column;
          font-variant-numeric: tabular-nums;
        }
        .customs-register .register-summary .fig span {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
        }
        .customs-register .register-summary .fig b { font-size: 17px; }
        .customs-register .register-summary .fig.accent b { color: #1890ff; }
        .customs-register .register-summary .channels { margin-left: auto; }
      `}</style>
    </div>
  );
};

export default CustomsRegister;
