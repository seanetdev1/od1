import React, { useEffect, useState, useCallback } from 'react';
import { Table, Input, Tag, Spin } from 'antd';
import { Row, Col } from 'react-bootstrap';
import Router from 'next/router';
import moment from 'moment';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { getPfms } from 'apis/aviationPfm';
import openNotification from 'Components/Shared/Notification';
import { usePageActions } from 'Components/Shared/PageActions';
import {
  PFM_STATUSES, CONFIRMED, statusOf, statusColor, flownAs, selectableReason,
} from 'functions/aviationPfmStatus';

// The PFM list - the register of plans.
//
// Built like the flight list beside it, because the two are read by the same
// people minutes apart: a search box, status tags that double as a filter and
// a count, and a row that opens the document.
//
// THE COLUMN THAT MATTERS IS "AVAILABLE". A plan exists to be flown, and the
// question anyone brings to this screen is which of them still can be - so it
// is a column rather than something to work out from three others. It is
// computed by the SAME rule the flight's dropdown and the server's refusal
// use (selectableReason), so a plan this list calls available is one the
// flight screen will actually offer, and a plan it does not is one that can
// say why.
const D_STORE = 'YYYY-MM-DD';

const List = ({ companyId }) => {
  const dispatchTab = useDispatch();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async (flightFilter) => {
    setLoading(true);
    try {
      const res = await getPfms({ companyId, flight: flightFilter });
      setRows(Array.isArray(res?.result) ? res.result : []);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not load PFMs.', 'red');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(''); }, [load]);

  // Opening a PFM registers a tab the way every other document does. `id` is
  // required, not decorative: MainLayout's setKey() builds key 10-4's URL from
  // tab.id, so a tab registered without one navigates to /aviationPfm/undefined
  // and every save then posts the string "undefined".
  const open = (record) => {
    dispatchTab(incrementTab({ label: record.pfmNo || 'PFM', key: '10-4', id: record.id }));
    Router.push(`/aviationPfm/${record.id}`);
  };

  // Which statuses are being shown. EMPTY MEANS ALL - so the list opens
  // unfiltered and a user who deselects everything gets everything back rather
  // than an empty table with no way to explain it. Same contract as the flight
  // list's status filter.
  const [statusFilter, setStatusFilter] = useState(() => new Set());

  const toggleStatus = (status) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  // Counts come from the UNFILTERED rows, so each tag keeps saying how many
  // plans it would show rather than collapsing to 0 once another tag is on.
  const counts = React.useMemo(() => {
    const c = Object.fromEntries(PFM_STATUSES.map((s) => [s, 0]));
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

  // Read once per render rather than per row, so one table cannot straddle
  // midnight and call two identical plans different things.
  const today = moment().format(D_STORE);

  const sum = (list, field) =>
    (list || []).reduce((t, x) => t + (parseFloat(x[field]) || 0), 0);

  const columns = [
    { title: 'PFM No.', dataIndex: 'pfmNo', key: 'pfmNo' },
    { title: 'Flight No.', dataIndex: 'flightNo', key: 'flightNo', render: (v) => v || '-' },
    { title: 'Flight Date', dataIndex: 'flightDate', key: 'flightDate', render: (v) => v || '-' },
    { title: 'Airline', key: 'airline',
      render: (_, r) => r.operatingCarrier?.name || '-' },
    { title: 'Aircraft', key: 'aircraft',
      render: (_, r) => r.Aviation_Aircraft?.name || '-' },
    { title: 'Origin', dataIndex: 'origin', key: 'origin', render: (v) => v || '-' },
    { title: 'AWBs', key: 'awbs',
      render: (_, r) => (r.Aviation_Pfm_Lines || []).length },
    { title: 'Planned Chg. WT', key: 'chargeableWeight',
      align: 'right',
      render: (_, r) => sum(r.Aviation_Pfm_Lines, 'chargeableWeight').toFixed(2) },
    { title: 'Status', key: 'status',
      render: (_, r) => <Tag color={statusColor(statusOf(r))}>{statusOf(r)}</Tag> },
    {
      title: 'Available',
      key: 'available',
      // THE ANSWER, AND THE REASON, in one cell. A bare "no" would send the
      // reader to the PFM to work out which of the three rules bit; the
      // sentence that the dropdown cannot show is exactly what belongs here.
      render: (_, r) => {
        const job = flownAs(r);
        const why = selectableReason(r, today, job);
        if (!why) return <Tag color='green'>Ready to fly</Tag>;
        return <span className='not-available' title={why}>{why}</span>;
      },
    },
  ];

  const newPfm = useCallback(() => {
    dispatchTab(incrementTab({ label: 'New PFM', key: '10-4', id: 'new' }));
    Router.push('/aviationPfm/new');
  }, [dispatchTab]);

  /* New goes to the toolbar, in the slot it has on every other list. The
     search box stays on the page: it narrows what is shown rather than doing
     anything to the plans, and the toolbar is for what a page can DO. */
  usePageActions({
    title: 'PFM',
    subtitle: 'Pre-flight manifests',
    new: { onClick: newPfm, label: 'New PFM', title: 'Start a new PFM' },
  }, []);

  const ready = rows.filter((r) => !selectableReason(r, today, flownAs(r))).length;

  return (
    <div className='client-styles aviation-pfm-list'>
      <Row className='align-items-center mb-3'>
        <Col className='d-flex justify-content-end'>
          <Input.Search
            placeholder='Flight No. or PFM No.'
            style={{ width: 240 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => load(v)}
            allowClear
          />
        </Col>
      </Row>

      {!loading && (
        <div className='status-filter'>
          <span className='label'>Status</span>
          {PFM_STATUSES.map((s) => {
            const on = statusFilter.has(s);
            return (
              <Tag
                key={s}
                color={on ? statusColor(s) : undefined}
                className={`filter-tag ${on ? 'on' : 'off'}`}
                onClick={() => toggleStatus(s)}
                title={on ? `Stop showing ${s} PFMs` : `Show only ${s} PFMs`}
              >
                {s} <b>{counts[s] ?? 0}</b>
              </Tag>
            );
          })}
          {statusFilter.size > 0 && (
            <a className='clear' onClick={() => setStatusFilter(new Set())}>Clear</a>
          )}
          {/* What the flight screen would actually offer right now. The number
              somebody came here to find, in the place they will look. */}
          <span className='ready-count' title='Confirmed, not yet flown, and still dated ahead'>
            {ready} ready to fly
          </span>
          <span className='showing'>
            {visible.length === rows.length
              ? `${rows.length} PFM${rows.length === 1 ? '' : 's'}`
              : `${visible.length} of ${rows.length}`}
          </span>
        </div>
      )}

      {loading ? <div className='text-center py-5'><Spin /></div> : (
        <Table
          rowKey='id'
          size='small'
          dataSource={visible}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{
            emptyText: statusFilter.size
              ? `No ${[...statusFilter].join(' or ')} PFMs.`
              : 'No PFMs yet. A flight is built from one, so this is where a flight starts.',
          }}
          onRow={(record) => ({
            onClick: () => open(record),
            style: { cursor: 'pointer' },
          })}
        />
      )}

      <style jsx global>{`
        .aviation-pfm-list .status-filter {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 10px;
          font-size: 12px;
        }
        .aviation-pfm-list .status-filter .label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #999;
          margin-right: 2px;
        }
        .aviation-pfm-list .status-filter .filter-tag { cursor: pointer; margin-right: 0; user-select: none; }
        /* Unselected tags keep the same shape but drop the colour, so the bar
           reads as a set of switches rather than as status labels. */
        .aviation-pfm-list .status-filter .filter-tag.off {
          background: #fafafa;
          border-color: #e0e0e0;
          color: #999;
        }
        .aviation-pfm-list .status-filter .filter-tag.off:hover { border-color: #bbb; color: #666; }
        .aviation-pfm-list .status-filter .clear { color: #1890ff; cursor: pointer; margin-left: 2px; }
        .aviation-pfm-list .status-filter .ready-count {
          margin-left: auto;
          color: #237804;
          font-weight: 600;
        }
        .aviation-pfm-list .status-filter .showing {
          margin-left: 10px;
          color: #999;
          font-variant-numeric: tabular-nums;
        }
        /* The reason, not a red badge: it is an explanation rather than a
           fault, and most rows on a healthy install carry one. */
        .aviation-pfm-list .not-available {
          font-size: 11px;
          color: #8a97a3;
          line-height: 1.35;
          display: inline-block;
          max-width: 260px;
        }
      `}</style>
    </div>
  );
};

export default List;
