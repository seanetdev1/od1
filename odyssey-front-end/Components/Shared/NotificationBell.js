import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Popover, Badge } from 'antd';
import {
  CloseOutlined, ExclamationCircleOutlined, FileAddOutlined, DollarCircleOutlined,
  ClockCircleOutlined, WarningOutlined, DownOutlined,
} from '@ant-design/icons';
import { FaRegBell } from 'react-icons/fa';
import { useSelector, useDispatch } from 'react-redux';
import Router from 'next/router';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import { incrementTab } from 'redux/tabs/tabSlice';
import { FREIGHT } from 'functions/invoiceDetails';

// Header bell (the user's requests, 2026-11-23), laid out as the "Critical
// Business Alerts" panel the user sent: a dark header with the critical count,
// the lists as a 2x2 of cards, each alert a card saying how overdue it is,
// paged ten at a time.
//
//   Alerts  four standing lists the server works out (functions/bellAlerts):
//             Critical      invoices not settled for more than 90 days; customs
//                           jobs with no charges 7 days after going On Vessel
//             Job Charges   jobs with no charges 7 days after being created
//             Invoices Due  invoices still due after 45 days
//             Job Status    customs jobs 7 days or more old, not yet On Vessel
//                           (or another finished status)
//           Opens here, on Critical, every time. A card opens what it is about.
//   Recent  the last 10 errors and warnings surfaced via openNotification()
//           (successes are not kept - keptInBell), and the new job notices
//           (Components/Shared/NewJobAlerts). Session only, from redux.
//
// Which lists a user sees is per designation (Configuration > Bell Alerts);
// the server sends only those, and `lists` names them. None: the Alerts tab
// is not shown and the popup opens on Recent.
//
// The lists are fetched on sign-in and then once an hour (the user,
// 2026-11-23), not on every open; the footer says when they were worked out.
//
// Critical has its own red button with its count before the bell (2026-11-23
// layout); the bell's badge is Recent's unread.
const MAX_RECENT = 10;
const PAGE = 10;
const ALERTS_REFRESH_MS = 60 * 60 * 1000;
const DAY_MS = 86400000;

export const ALERT_KINDS = [
  { key: 'critical', label: 'Critical', empty: 'Nothing critical.', Icon: ExclamationCircleOutlined },
  { key: 'jobCharges', label: 'Job Charges', empty: 'Every job has charges.', Icon: FileAddOutlined },
  { key: 'invoicesDue', label: 'Invoices Due', empty: 'No invoices due.', Icon: DollarCircleOutlined },
  { key: 'jobStatus', label: 'Job Status', empty: 'No jobs held up.', Icon: ClockCircleOutlined },
];

const money = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1101d 19h - as the panel the user sent writes a span. */
export const span = (ms) => {
  const m = Math.max(0, ms);
  const d = Math.floor(m / DAY_MS);
  const h = Math.floor((m % DAY_MS) / 3600000);
  return `${d}d ${h}h`;
};

/** An alert as a card: its number, the chip beside it, who, and how late. */
export function alertCard(a, now = Date.now()) {
  const started = a.since ? new Date(a.since).getTime() : now;
  const elapsed = now - started;
  const overdue = elapsed - (Number(a.dueDays) || 0) * DAY_MS;
  const invoice = a.kind === 'invoice';
  return {
    no: invoice ? a.invoiceNo : a.jobNo,
    chip: invoice ? (a.payType === 'Payble' ? 'Payable' : 'Receivable') : (a.status || a.reason || ''),
    party: a.party || '',
    amount: invoice ? `${a.currency} ${money(a.owed)}` : '',
    overdue: span(overdue),
    elapsed: span(elapsed),
    date: a.since ? moment(a.since).format('DD MMM YYYY') : '',
  };
}

/** Where a card goes when clicked - the same addresses the rest of the app opens them at. */
function openAlert(a, dispatch) {
  if (a.kind === 'invoice') {
    Router.push(`/reports/invoice/${a.id}`);
    return;
  }
  if (a.kind === 'customsJob') {
    dispatch(incrementTab({ label: a.jobNo || 'Customs Job', key: '11-2', id: a.id }));
    Router.push(`/customsJobs/${a.id}`);
    return;
  }
  const f = FREIGHT[String(a.operation || '').toUpperCase()];
  if (!f) return;
  Router.push(`${f.path}/${a.id}`).then(() => dispatch(incrementTab({ label: f.label, key: f.key, id: `${a.id}` })));
}

// Items above the last-seen one are new; if it is not found, all are.
const unreadOf = (list, lastSeenId) => {
  if (!list.length) return 0;
  if (!lastSeenId) return list.length;
  const idx = list.findIndex((x) => x.id === lastSeenId);
  return idx === -1 ? list.length : idx;
};

const NONE = { count: 0, items: [] };
const EMPTY_ALERTS = { lists: [] };

const AlertCard = ({ a, kind, onOpen }) => {
  const c = alertCard(a);
  return (
    <div className={`bp-card bp-k-${kind}`} role='button' tabIndex={0}
      onClick={() => onOpen(a)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(a); }}>
      <div className='bp-ic'><WarningOutlined /></div>
      <div className='bp-main'>
        <div className='bp-row1'>
          <span className='bp-no'>{c.no}</span>
          {c.chip && <span className='bp-chip'>{c.chip}</span>}
          <span className='bp-pill'>Overdue</span>
        </div>
        {(c.party || c.amount) && (
          <div className='bp-party'>
            {c.party}{c.party && c.amount ? ' · ' : ''}{c.amount && <span className='bp-amount'>{c.amount}</span>}
          </div>
        )}
        <div className='bp-row3'>
          <span className='bp-over'>Overdue by {c.overdue}</span>
          <span className='bp-el'> · {c.elapsed} elapsed</span>
        </div>
        <div className='bp-row4'>
          <span className='bp-date'>{c.date}</span>
          <span className='bp-open'>Open →</span>
        </div>
      </div>
    </div>
  );
};

const NotificationBell = () => {
  const dispatch = useDispatch();
  const recent = useSelector((state) => state.notifications?.list || []);
  const [open, setOpen] = useState(false);
  // Opens on Alerts, on Critical, every time (the user, 2026-11-23).
  const [tab, setTab] = useState('alerts');
  const [kind, setKind] = useState('critical');
  const [page, setPage] = useState(1);
  const [recentSeen, setRecentSeen] = useState(null);
  const [alerts, setAlerts] = useState(EMPTY_ALERTS);
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadAlerts = useCallback(() => {
    axiosClient.get('/notifications/alerts')
      .then(({ data }) => {
        if (data?.status !== 'success' || !data.result) return;
        setAlerts({ ...EMPTY_ALERTS, ...data.result });
        setUpdatedAt(new Date());
      })
      .catch(() => { /* signed out or away: keep what was shown */ });
  }, []);

  // On sign-in, then once an hour (the user, 2026-11-23).
  useEffect(() => {
    loadAlerts();
    const id = setInterval(loadAlerts, ALERTS_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadAlerts]);

  const unreadRecent = useMemo(() => unreadOf(recent, recentSeen), [recent, recentSeen]);

  // The lists this user is shown, in the bell's order.
  const kinds = ALERT_KINDS.filter((k) => (alerts.lists || []).includes(k.key));
  const hasAlerts = kinds.length > 0;

  const onOpenChange = (next) => {
    setOpen(next);
    if (!next) return;
    setTab(hasAlerts ? 'alerts' : 'recent');
    if (!hasAlerts && recent.length) setRecentSeen(recent[0].id);
    setKind(kinds[0]?.key || 'critical');
    setPage(1);
  };
  const showTab = (key) => {
    setTab(key);
    if (key === 'recent' && recent.length) setRecentSeen(recent[0].id);
  };
  const pickKind = (key) => { setKind(key); setPage(1); };

  // What is tracked, for the header: distinct jobs and invoices across the
  // lists, in full - the server counts them (each list sends at most 200).
  const tracked = alerts.totals || { jobs: 0, invoices: 0 };

  const critical = alerts.critical?.count || 0;
  const kindNow = kinds.find((k) => k.key === kind) || kinds[0] || ALERT_KINDS[0];
  const listNow = alerts[kindNow.key] || NONE;
  const loaded = listNow.items.length;
  const pages = Math.max(1, Math.ceil(loaded / PAGE));
  const pageNow = Math.min(page, pages);
  const shown = listNow.items.slice((pageNow - 1) * PAGE, pageNow * PAGE);
  const from = loaded ? (pageNow - 1) * PAGE + 1 : 0;
  const to = Math.min(pageNow * PAGE, loaded);

  const content = (
    <div className='bp'>
      <div className='bp-head'>
        <div>
          <div className='bp-title'>
            Business Alerts
            {critical > 0 && <span className='bp-badge'>{critical}</span>}
          </div>
          {hasAlerts && (
            <div className='bp-sub'>
              {tracked.jobs} job{tracked.jobs === 1 ? '' : 's'} · {tracked.invoices} invoice{tracked.invoices === 1 ? '' : 's'} tracked
            </div>
          )}
        </div>
        <button type='button' className='bp-close' aria-label='Close' onClick={() => setOpen(false)}>
          <CloseOutlined />
        </button>
      </div>

      <div className='bp-tabs' role='tablist'>
        {hasAlerts && (
          <button type='button' role='tab' aria-selected={tab === 'alerts'}
            className={tab === 'alerts' ? 'on' : ''} onClick={() => showTab('alerts')}>Alerts</button>
        )}
        <button type='button' role='tab' aria-selected={tab === 'recent'}
          className={tab === 'recent' ? 'on' : ''} onClick={() => showTab('recent')}>
          {unreadRecent > 0 ? `Recent (${unreadRecent})` : 'Recent'}
        </button>
      </div>

      {tab === 'alerts' && hasAlerts ? (
        <>
          <div className='bp-kinds'>
            {kinds.map(({ key, label, Icon }) => (
              <button type='button' key={key} className={`bp-kind bp-k-${key}${kindNow.key === key ? ' on' : ''}`}
                aria-pressed={kindNow.key === key} onClick={() => pickKind(key)}>
                <Icon className='bp-kind-ic' />
                <span className='bp-kind-label'>{label}</span>
                <span className='bp-count'>{alerts[key]?.count || 0}</span>
              </button>
            ))}
          </div>
          <div className='bp-list'>
            {shown.length === 0
              ? <div className='bp-empty'>{kindNow.empty}</div>
              : shown.map((a) => (
                <AlertCard key={`${a.kind}-${a.id}`} a={a} kind={kindNow.key}
                  onOpen={(x) => { setOpen(false); openAlert(x, dispatch); }} />
              ))}
          </div>
          <div className='bp-foot'>
            <div className='bp-pager'>
              <span>
                Showing {from}–{to} of {listNow.count}
                {listNow.count > loaded ? ` (first ${loaded} listed)` : ''}
              </span>
              <span className='bp-pages'>
                <button type='button' disabled={pageNow <= 1} onClick={() => setPage(pageNow - 1)}>Prev</button>
                <span>{pageNow} / {pages}</span>
                <button type='button' disabled={pageNow >= pages} onClick={() => setPage(pageNow + 1)}>Next</button>
              </span>
            </div>
            <div className='bp-note'>
              Only records made in Odyssey are counted; migrated ones are left out.
              {updatedAt && ` Updated ${moment(updatedAt).format('h:mm a')}; refreshed every hour.`}
            </div>
          </div>
        </>
      ) : (
        <div className='bp-list'>
          {recent.length === 0
            ? <div className='bp-empty'>Nothing recent.</div>
            : recent.slice(0, MAX_RECENT).map((x, i) => (
              <div key={x.id ?? i} className='bp-recent'>
                <span className='bp-dot' style={{ background: x.color || '#1890ff' }} />
                <div className='bp-main'>
                  <div className='bp-no'>{x.title}</div>
                  {x.message && <div className='bp-party'>{x.message}</div>}
                  {x.time && <div className='bp-date'>{moment(x.time).fromNow()}</div>}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );

  return (
    <>
    <Popover
      content={content}
      open={open}
      trigger="hover"
      placement="bottomRight"
      onOpenChange={onOpenChange}
      // Under the bell, always: when it did not fit, antd slid it up over the
      // header and the bell itself. The list is sized to the window instead.
      autoAdjustOverflow={false}
      overlayClassName='bell-pop'
      overlayStyle={{ zIndex: 1100 }}
    >
      <span className='bell-anchor'>
        {/* CRITICAL, in red with its count, before the bell (the user's
            layout, 2026-11-23): what needs dealing with, without opening
            anything. It opens the same popup, on Critical. Only for a user
            who is shown that list, and only while it has something on it. */}
        {critical > 0 && (
          <button type='button' className='bell-critical'
            onClick={() => { setOpen(true); setTab('alerts'); setKind('critical'); setPage(1); }}
            title={`${critical} critical alert${critical === 1 ? '' : 's'} - invoices long unsettled, jobs On Vessel with no charges`}>
            <ExclamationCircleOutlined />
            <span className='bell-critical-label'>Critical Alerts</span>
            <span className='bell-critical-count'>{critical}</span>
            <DownOutlined className='bell-critical-caret' />
          </button>
        )}
        <span className='cur bell-icon' title='Notifications'>
          {/* Recent's unread only - Critical has its own count beside it. */}
          <Badge count={unreadRecent} size="small" offset={[2, -2]}>
            <FaRegBell size={20} style={{ color: '#1f2937' }} />
          </Badge>
        </span>
      </span>
    </Popover>
    {/* Global: the popup is drawn outside this component, in antd's portal. */}
    <style jsx global>{`
      .bell-anchor { display: inline-flex; align-items: center; gap: 12px; }
      .bell-icon { display: inline-flex; align-items: center; padding: 0 4px; }
      .bell-critical {
        display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 6px 0 11px;
        border: 0; border-radius: 7px; background: #c81e1e; color: #fff; font-size: 13px; font-weight: 600;
        cursor: pointer; box-shadow: 0 1px 2px rgba(200, 30, 30, 0.3);
      }
      .bell-critical:hover { background: #b01a1a; }
      .bell-critical-count {
        display: inline-flex; align-items: center; height: 34px; margin-left: 4px; padding: 0 2px 0 10px;
        border-left: 1px solid rgba(255, 255, 255, 0.3); font-weight: 700;
      }
      .bell-critical-caret { font-size: 10px; margin-right: 4px; }
      @media (max-width: 1280px) { .bell-critical-label { display: none; } }
      .bell-pop .ant-popover-inner { border-radius: 12px; overflow: hidden; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22); }
      .bell-pop .ant-popover-inner-content { padding: 0; }
      .bell-pop .ant-popover-arrow-content::before { background: #1e293b; }
      .bp { width: 440px; font-size: 13px; color: #1f2937; background: #fff; }

      .bp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; background: #1e293b; color: #fff; padding: 14px 16px; }
      .bp-title { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
      .bp-badge { background: #ef4444; color: #fff; border-radius: 9px; padding: 0 7px; font-size: 12px; line-height: 18px; font-weight: 700; }
      .bp-sub { color: #cbd5e1; font-size: 12px; margin-top: 2px; }
      .bp-close { flex: none; width: 30px; height: 30px; border: none; border-radius: 6px; background: rgba(255,255,255,0.12); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
      .bp-close:hover { background: rgba(255,255,255,0.22); }

      .bp-tabs { display: flex; border-bottom: 1px solid #e5e7eb; }
      .bp-tabs button { flex: 1 1 0; border: none; background: #fff; padding: 9px 0; font-size: 13px; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; }
      .bp-tabs button.on { color: #111827; font-weight: 600; border-bottom-color: #1e293b; }

      .bp-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #eef0f3; }
      .bp-kind { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid #e2e5ea; border-radius: 8px; background: #f8f9fb; color: #374151; cursor: pointer; font-size: 13px; text-align: left; }
      .bp-kind:hover { background: #f1f3f6; }
      .bp-kind-ic { font-size: 15px; color: #6b7280; }
      .bp-kind-label { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bp-count { flex: none; min-width: 24px; text-align: center; border-radius: 10px; background: #e5e7eb; color: #374151; font-size: 12px; font-weight: 600; padding: 0 7px; line-height: 20px; }
      .bp-kind.on { font-weight: 600; }
      .bp-kind.on.bp-k-critical { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }
      .bp-kind.on.bp-k-critical .bp-kind-ic { color: #dc2626; }
      .bp-kind.on.bp-k-critical .bp-count { background: #fee2e2; color: #b91c1c; }
      .bp-kind.on.bp-k-jobCharges { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
      .bp-kind.on.bp-k-jobCharges .bp-kind-ic { color: #d97706; }
      .bp-kind.on.bp-k-jobCharges .bp-count { background: #fef3c7; color: #92400e; }
      .bp-kind.on.bp-k-invoicesDue { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
      .bp-kind.on.bp-k-invoicesDue .bp-kind-ic { color: #2563eb; }
      .bp-kind.on.bp-k-invoicesDue .bp-count { background: #dbeafe; color: #1d4ed8; }
      .bp-kind.on.bp-k-jobStatus { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9; }
      .bp-kind.on.bp-k-jobStatus .bp-kind-ic { color: #7c3aed; }
      .bp-kind.on.bp-k-jobStatus .bp-count { background: #ede9fe; color: #6d28d9; }

      /* Sized so the whole popup fits below the bell: the window less the
         header bar and the popup's own head, tabs, list cards and footer. */
      .bp-list { max-height: min(360px, calc(100vh - 430px)); min-height: 110px; overflow-y: auto; padding: 10px 14px; background: #f8f9fb; }
      .bp-empty { padding: 18px 4px; color: #6b7280; text-align: center; }
      .bp-card { --c: #dc2626; --soft: #fef2f2; --line: #fecaca; display: flex; gap: 10px; background: #fff; border: 1px solid #e5e7eb; border-left: 3px solid var(--c); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; outline: none; }
      .bp-card:hover, .bp-card:focus { box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08); }
      .bp-card.bp-k-jobCharges { --c: #d97706; --soft: #fffbeb; --line: #fde68a; }
      .bp-card.bp-k-invoicesDue { --c: #2563eb; --soft: #eff6ff; --line: #bfdbfe; }
      .bp-card.bp-k-jobStatus { --c: #7c3aed; --soft: #f5f3ff; --line: #ddd6fe; }
      .bp-ic { flex: none; width: 30px; height: 30px; border-radius: 6px; background: var(--soft); color: var(--c); display: inline-flex; align-items: center; justify-content: center; font-size: 15px; }
      .bp-main { flex: 1 1 auto; min-width: 0; }
      .bp-row1 { display: flex; align-items: center; gap: 6px; }
      .bp-no { font-weight: 700; font-size: 14px; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bp-chip { flex: none; background: #f1f5f9; color: #475569; border-radius: 4px; padding: 0 6px; font-size: 11.5px; line-height: 19px; white-space: nowrap; }
      .bp-pill { flex: none; margin-left: auto; border: 1px solid var(--line); background: var(--soft); color: var(--c); border-radius: 10px; padding: 0 8px; font-size: 11px; font-weight: 700; line-height: 19px; text-transform: uppercase; letter-spacing: 0.02em; }
      .bp-party { color: #374151; font-size: 12.5px; margin-top: 2px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bp-amount { text-transform: none; color: #6b7280; }
      .bp-row3 { margin-top: 4px; font-size: 12px; }
      .bp-over { color: var(--c); font-weight: 700; }
      .bp-el { color: #6b7280; }
      .bp-row4 { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
      .bp-date { color: #9ca3af; font-size: 11.5px; }
      .bp-open { color: #2563eb; font-size: 12px; }
      .bp-card:hover .bp-open { text-decoration: underline; }

      .bp-foot { border-top: 1px solid #eef0f3; padding: 10px 14px 12px; background: #fff; }
      .bp-pager { display: flex; align-items: center; justify-content: space-between; color: #4b5563; font-size: 12.5px; }
      .bp-pages { display: inline-flex; align-items: center; gap: 8px; }
      .bp-pages button { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 2px 10px; font-size: 12px; color: #374151; cursor: pointer; }
      .bp-pages button:disabled { color: #c0c4cc; background: #f9fafb; cursor: default; }
      .bp-note { color: #9ca3af; font-size: 11.5px; margin-top: 8px; }

      .bp-recent { display: flex; gap: 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 9px 12px; margin-bottom: 8px; }
      .bp-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; }
      .bp-recent .bp-no { font-size: 13px; white-space: normal; }
      .bp-recent .bp-party { text-transform: none; white-space: normal; }
    `}</style>
    </>
  );
};

export default NotificationBell;
