import React, { useEffect, useState, useCallback } from 'react';
import { Table, Input, Tag, Spin } from 'antd';
import { Row, Col } from 'react-bootstrap';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { getAviationJobs } from 'apis/aviationJobs';
import openNotification from 'Components/Shared/Notification';
// One definition of a flight's status, its colour, and the fact that flights
// entered before 1.2.2 spell Operated as 'Active'. See the module.
import { STATUSES, statusOf, statusColor as colorOf } from 'functions/aviationStatus';
import { usePageActions } from 'Components/Shared/PageActions';
import { useSelectedCompany } from 'functions/selectedCompany';
import NoCompanySelected from 'Components/Shared/NoCompanySelected';

// The flight list. One row per aviation job, with its consignment count and
// totals rolled up so the list answers "what is on this flight" without
// opening it.

const List = ({ companyId: storeCompanyId }) => {
  const dispatchTab = useDispatch();
  // STRICT: no company picked, no flights - see functions/selectedCompany.
  const { ready, companyId } = useSelectedCompany(storeCompanyId);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flight, setFlight] = useState('');

  const load = useCallback(async (flightFilter) => {
    if (!companyId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getAviationJobs({ companyId, flight: flightFilter });
      setRows(Array.isArray(res?.result) ? res.result : []);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not load flights.', 'red');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { if (ready) load(''); }, [ready, load]);

  // Opening a flight registers a tab the same way the freight screens do, so
  // it behaves like the rest of the app rather than a dead-end page.
  // `id` is required, not decorative: MainLayout's setKey() builds the URL for
  // key 10-2 from tab.id, so a tab registered without one navigates to
  // /aviationJobs/undefined and every save then posts the string "undefined".
  const open = (record) => {
    dispatchTab(incrementTab({ label: record.jobNo || 'Aviation Job', key: '10-2', id: record.id }));
    Router.push(`/aviationJobs/${record.id}`);
  };

  const sum = (list, field) =>
    (list || []).reduce((t, x) => t + (parseFloat(x[field]) || 0), 0);

  // Which statuses are being shown. EMPTY MEANS ALL - so the list opens
  // unfiltered and a user who deselects everything gets everything back
  // rather than an empty table with no way to explain it.
  const [statusFilter, setStatusFilter] = useState(() => new Set());

  const toggleStatus = (status) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  // Counts come from the UNFILTERED rows, so each tag keeps saying how many
  // flights it would show rather than collapsing to 0 once another tag is on.
  const counts = React.useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of rows) {
      const s = statusOf(r);
      c[s] = (c[s] || 0) + 1;
    }
    return c;
  }, [rows]);

  const visible = React.useMemo(
    () => (statusFilter.size ? rows.filter((r) => statusFilter.has(statusOf(r))) : rows),
    [rows, statusFilter]
  );

  const columns = [
    { title: 'Job No.', dataIndex: 'jobNo', key: 'jobNo' },
    { title: 'Flight No.', dataIndex: 'flightNo', key: 'flightNo' },
    { title: 'Route', key: 'route',
      render: (_, r) => [r.origin, r.destination].filter(Boolean).join(' → ') || '-' },
    { title: 'Flight Date', dataIndex: 'flightDate', key: 'flightDate', render: (v) => v || '-' },
    { title: 'AWBs', key: 'awbs',
      render: (_, r) => (r.Aviation_Consignments || []).length },
    { title: 'Pieces', key: 'pieces',
      render: (_, r) => sum(r.Aviation_Consignments, 'pieces') },
    { title: 'Gross WT', key: 'grossWeight',
      render: (_, r) => sum(r.Aviation_Consignments, 'grossWeight').toFixed(2) },
    { title: 'Chargeable WT', key: 'chargeableWeight',
      render: (_, r) => sum(r.Aviation_Consignments, 'chargeableWeight').toFixed(2) },
    { title: 'Status', key: 'status',
      render: (_, r) => <Tag color={colorOf(statusOf(r))}>{statusOf(r)}</Tag> },
  ];

  const newFlight = useCallback(() => {
    dispatchTab(incrementTab({ label: 'New Aviation Job', key: '10-2', id: 'new' }));
    Router.push('/aviationJobs/new');
  }, [dispatchTab]);

  /* New goes to the toolbar, in the slot it has on every other list. The
     search box stays on the page: it narrows what is shown rather than doing
     anything to the flights, and the toolbar is for what a page can DO. */
  usePageActions({
    title: 'Aviation Jobs',
    new: { onClick: newFlight, label: 'New Flight', title: 'Start a new flight' },
  }, []);

  const filterBar = (
    <div className='status-filter'>
      <span className='label'>Status</span>
      {STATUSES.map((s) => {
        const on = statusFilter.has(s);
        return (
          <Tag
            key={s}
            color={on ? colorOf(s) : undefined}
            className={`filter-tag ${on ? 'on' : 'off'}`}
            onClick={() => toggleStatus(s)}
            title={on ? `Stop showing ${s} flights` : `Show only ${s} flights`}
          >
            {s} <b>{counts[s] ?? 0}</b>
          </Tag>
        );
      })}
      {statusFilter.size > 0 && (
        <a className='clear' onClick={() => setStatusFilter(new Set())}>
          Clear
        </a>
      )}
      <span className='showing'>
        {visible.length === rows.length
          ? `${rows.length} flight${rows.length === 1 ? '' : 's'}`
          : `${visible.length} of ${rows.length}`}
      </span>
    </div>
  );

  if (ready && !companyId) return <NoCompanySelected what='flights' />;

  return (
    <div className='client-styles'>
      <Row className='align-items-center mb-3'>
        <Col className='d-flex justify-content-end'>
          <Input.Search
            placeholder='Flight No.'
            style={{ width: 200 }}
            value={flight}
            onChange={(e) => setFlight(e.target.value)}
            onSearch={(v) => load(v)}
            allowClear
          />
        </Col>
      </Row>

      {!loading && filterBar}

      {loading ? <div className='text-center py-5'><Spin /></div> : (
        <Table
          rowKey='id'
          size='small'
          dataSource={visible}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{
            emptyText: statusFilter.size
              ? `No ${[...statusFilter].join(' or ')} flights.`
              : 'No flights yet.',
          }}
          onRow={(record) => ({
            onClick: () => open(record),
            style: { cursor: 'pointer' },
          })}
        />
      )}

      <style jsx global>{`
        .status-filter {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
          font-size: 12px;
        }
        .status-filter .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          margin-right: 2px;
        }
        .status-filter .filter-tag {
          cursor: pointer;
          margin-right: 0;
          user-select: none;
        }
        /* Unselected tags keep the same shape but drop the colour, so the bar
           reads as a set of switches rather than as status labels. */
        .status-filter .filter-tag.off {
          background: #fafafa;
          border-color: #e0e0e0;
          color: #999;
        }
        .status-filter .filter-tag.off:hover { border-color: #bbb; color: #666; }
        .status-filter .clear {
          color: #1890ff;
          cursor: pointer;
          margin-left: 2px;
        }
        .status-filter .showing {
          margin-left: auto;
          color: #999;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
};

export default List;
