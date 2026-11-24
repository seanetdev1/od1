import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from 'antd';
import {
  SearchOutlined, CloseOutlined, ContainerOutlined, FileTextOutlined, FileDoneOutlined,
  AccountBookOutlined, TeamOutlined,
} from '@ant-design/icons';
import { useDispatch } from 'react-redux';
import Router from 'next/router';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import { incrementTab } from 'redux/tabs/tabSlice';
import { FREIGHT } from 'functions/invoiceDetails';

// THE HEADER'S SEARCH (the user, 2026-11-23): a job, B/L or waybill, invoice
// or bill, voucher number or a party's name, and straight to it. The server
// finds them (GET /search, functions/globalSearch) - only what this user may
// see, in their companies - and a B/L or waybill number brings its job too.
//
// The results are the panel the user laid out: "N Matches & Linked Records for
// <term>", a pill per kind with its count to narrow it, then each kind's rows
// - what it is, its number, who for, its route or numbers, its date, Open.
// Alt+K puts the cursor in the box; Up/Down move through the rows, Enter opens
// the highlighted one in a tab - the way the rest of the app opens it - and
// Esc closes the panel.
const DEBOUNCE_MS = 250;
const MIN_LENGTH = 2;

const GROUPS = [
  { key: 'jobs', pill: 'Jobs', heading: 'Associated Jobs', Icon: ContainerOutlined },
  { key: 'bls', pill: 'B/L & AWB', heading: 'Bills of Lading (HBL / MBL / HAWB / MAWB)', Icon: FileTextOutlined },
  { key: 'invoices', pill: 'Invoices', heading: 'Invoices & Bills', Icon: FileDoneOutlined },
  { key: 'vouchers', pill: 'Vouchers', heading: 'Vouchers', Icon: AccountBookOutlined },
  { key: 'parties', pill: 'Parties', heading: 'Parties', Icon: TeamOutlined },
];

// A freight job's B/L screen, by operation - the keys the job screen opens them under.
const FREIGHT_BL = {
  SE: { path: '/seaJobs/export/bl', key: '4-4', label: 'SE BL' },
  SI: { path: '/seaJobs/import/bl', key: '4-7', label: 'SI BL' },
  AE: { path: '/airJobs/export/bl', key: '7-3', label: 'AE AWBL' },
  AI: { path: '/airJobs/import/bl', key: '7-6', label: 'AI AWBL' },
};

/** Open a result where the rest of the app opens it. */
export function openResult(r, dispatch) {
  const go = (tab, path) => { dispatch(incrementTab(tab)); Router.push(path); };
  switch (r.kind) {
    case 'freightJob': {
      const f = FREIGHT[String(r.operation || '').toUpperCase()];
      if (f) go({ label: f.label, key: f.key, id: `${r.id}` }, `${f.path}/${r.id}`);
      return;
    }
    case 'freightBl': {
      const b = FREIGHT_BL[String(r.operation || '').toUpperCase()];
      if (b) go({ label: b.label, key: b.key, id: `${r.id}` }, `${b.path}/${r.id}`);
      return;
    }
    case 'customsJob':
      go({ label: r.jobNo || 'Customs Job', key: '11-2', id: r.id }, `/customsJobs/${r.id}`);
      return;
    case 'invoice':
      Router.push(`/reports/invoice/${r.id}`);
      return;
    case 'voucher':
      // As the Ledger opens a voucher: Payments & Receipts' own, the opening
      // balance's, or the Voucher screen.
      if (r.type === 'Job Reciept' || r.type === 'Job Payment') {
        go({ label: 'Payment / Receipt', key: '3-4', id: r.id }, `/accounts/paymentReceipt/${r.id}`);
      } else if (r.type === 'Opening Reciept' || r.type === 'Opening Payment' || r.vType === 'OP') {
        go({ label: 'Opening Balance', key: '3-10', id: r.id }, `/accounts/openingBalance/${r.id}`);
      } else {
        go({ label: 'Voucher', key: '3-5', id: r.id }, `/accounts/vouchers/${r.id}`);
      }
      return;
    case 'party':
      go({ label: 'Party', key: '2-7', id: r.id }, `/setup/client/${r.id}`);
      return;
    default:
  }
}

const money = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const dayText = (d) => (d && moment(d).isValid() ? moment(d).format('DD-MM-YYYY') : '');

/** What a row says after its number - by kind. */
export function rowDetail(group, r) {
  const parts = [];
  if (group === 'jobs') {
    if (r.matchedOn) parts.push(r.matchedOn);
    parts.push(r.party);
    parts.push([r.load, r.route].filter(Boolean).join(' · '));
    if (r.cancelled) parts.push('Cancelled');
  } else if (group === 'bls') {
    if (r.jobNo) parts.push(`Job: ${r.jobNo}`);
    if (r.house) parts.push(`${r.houseName}: ${r.house}`);
    if (r.master && r.master !== r.no) parts.push(`${r.masterName}: ${r.master}`);
    else if (r.master && !r.house) parts.push(r.masterName);
  } else if (group === 'invoices') {
    parts.push(r.party, `${r.currency} ${money(r.amount)}`);
    if (r.unapproved) parts.push('Unapproved');
  } else if (group === 'vouchers') {
    parts.push(r.detail, r.party);
  } else {
    parts.push(r.detail);
  }
  return parts.filter(Boolean).join(' · ');
}

const EMPTY = { jobs: [], bls: [], invoices: [], vouchers: [], parties: [] };

const HeaderSearch = ({ compact = false }) => {
  const dispatch = useDispatch();
  const [text, setText] = useState('');
  const [result, setResult] = useState(EMPTY);
  const [shownFor, setShownFor] = useState('');
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  // Narrow until used, wide while in use (the user, 2026-11-23) - and the
  // placeholder says what it searches only once there is room to.
  const [focused, setFocused] = useState(false);
  const [pill, setPill] = useState('all');
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const asked = useRef(0);
  const term = text.trim();

  // Alt+K: into the box from anywhere.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        inputRef.current?.focus?.();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A click anywhere else closes the panel.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Ask once typing pauses; an answer to an older question is dropped.
  useEffect(() => {
    if (term.length < MIN_LENGTH) { setResult(EMPTY); setShownFor(''); setSearching(false); return undefined; }
    const mine = ++asked.current;
    setSearching(true);
    const t = setTimeout(() => {
      axiosClient.get('/search', { params: { q: term } })
        .then(({ data }) => {
          if (mine !== asked.current) return;
          setResult(data?.status === 'success' ? { ...EMPTY, ...data.result } : EMPTY);
          setShownFor(term);
          setActive(0);
        })
        .catch(() => { if (mine === asked.current) setResult(EMPTY); })
        .finally(() => { if (mine === asked.current) setSearching(false); });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term]);

  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.key, (result[g.key] || []).length])), [result]);
  const total = GROUPS.reduce((n, g) => n + counts[g.key], 0);
  const shownGroups = GROUPS.filter((g) => counts[g.key] && (pill === 'all' || pill === g.key));
  // The rows in the order they are drawn - what Up/Down walk through.
  const flat = shownGroups.flatMap((g) => result[g.key].map((r) => ({ group: g.key, r })));

  const close = () => { setOpen(false); inputRef.current?.blur?.(); };
  const pick = (r) => {
    openResult(r, dispatch);
    setText('');
    setResult(EMPTY);
    setPill('all');
    setOpen(false);
    inputRef.current?.blur?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % flat.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + flat.length) % flat.length); }
    if (e.key === 'Enter') { e.preventDefault(); const hit = flat[Math.min(active, flat.length - 1)]; if (hit) pick(hit.r); }
  };

  const panelOpen = open && term.length >= MIN_LENGTH;
  let rowIndex = -1;

  return (
    <div className={`hdr-search${compact ? ' compact' : ''}`} ref={boxRef}>
      <Input
        ref={inputRef}
        allowClear
        value={text}
        onChange={(e) => { setText(e.target.value); setPill('all'); setOpen(true); }}
        onFocus={() => { setOpen(true); setFocused(true); }}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        prefix={<SearchOutlined style={{ color: '#8a97a3' }} />}
        placeholder={focused && !compact ? 'Search jobs, B/L & AWB, invoices, vouchers, parties' : 'Search  ·  Alt+K'}
        aria-label='Search jobs, B/Ls and waybills, invoices, vouchers and parties'
        aria-expanded={panelOpen}
      />
      {panelOpen && (
        <div className='hs-panel' role='listbox'>
          <div className='hs-head'>
            <span className='hs-total'>{total}</span>
            <span className='hs-title'>Matches &amp; Linked Records for “{shownFor || term}”</span>
            {searching && <span className='hs-busy'>Searching…</span>}
            <button type='button' className='hs-close' aria-label='Close' onClick={close}><CloseOutlined /></button>
          </div>
          <div className='hs-pills'>
            <button type='button' className={`hs-pill${pill === 'all' ? ' on' : ''}`} onClick={() => { setPill('all'); setActive(0); }}>
              <SearchOutlined /> All <span className='hs-pill-count'>{total}</span>
            </button>
            {GROUPS.map(({ key, pill: label, Icon }) => (
              <button type='button' key={key} className={`hs-pill${pill === key ? ' on' : ''}`}
                disabled={!counts[key]} onClick={() => { setPill(key); setActive(0); }}>
                <Icon /> {label} <span className='hs-pill-count'>{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className='hs-body'>
            {!shownGroups.length && (
              <div className='hs-empty'>{searching ? 'Searching…' : `Nothing found for “${term}”.`}</div>
            )}
            {shownGroups.map(({ key, heading, Icon }) => (
              <div key={key} className='hs-section'>
                <div className='hs-section-head'><Icon /> {heading} ({counts[key]})</div>
                {result[key].map((r) => {
                  rowIndex += 1;
                  const mine = rowIndex;
                  return (
                    <div key={`${r.kind}-${r.id}-${r.no}`} role='option' aria-selected={mine === active}
                      className={`hs-row hs-g-${key}${r.kind === 'customsJob' ? ' hs-customs' : ''}${mine === active ? ' on' : ''}`}
                      onMouseEnter={() => setActive(mine)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(r)}>
                      <span className='hs-tag'>{r.tag}</span>
                      <span className='hs-no'>{r.no}</span>
                      <span className='hs-detail'>{rowDetail(key, r)}</span>
                      {r.date && <span className='hs-date'>{dayText(r.date)}</span>}
                      <span className='hs-open'>Open →</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <style jsx global>{`
        /* NARROW AT REST, WIDE IN USE (the user, 2026-11-23): it grows while
           anything in it has focus - the box, or a pill in its panel - into
           the space the spacer to its left gives up. */
        .hdr-search { position: relative; flex: none; width: 180px; transition: width 0.45s ease-in-out; }
        .hdr-search:focus-within { width: min(440px, 42vw); }
        .hdr-search.compact { width: 150px; }
        .hdr-search.compact:focus-within { width: min(320px, 38vw); }
        .hdr-search .ant-input-affix-wrapper { height: 34px; border-radius: 8px; border-color: #e3e7ec; background: #f8fafc; }
        .hdr-search .ant-input-affix-wrapper input { background: transparent; font-size: 13.5px; }
        .hdr-search .ant-input-affix-wrapper:hover,
        .hdr-search .ant-input-affix-wrapper-focused { border-color: #b9c6d6; background: #fff; }

        .hs-panel {
          /* Opens leftward from the box, which sits at the header's right. */
          position: absolute; top: 40px; right: 0; z-index: 1100;
          width: min(620px, calc(100vw - 260px)); max-height: min(560px, calc(100vh - 90px));
          display: flex; flex-direction: column;
          background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.2); overflow: hidden; white-space: normal;
        }
        .hs-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px 14px; }
        .hs-total { flex: none; min-width: 22px; height: 20px; border-radius: 10px; background: #2563eb; color: #fff; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; }
        .hs-title { flex: 1 1 auto; min-width: 0; font-size: 13.5px; font-weight: 600; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hs-busy { flex: none; font-size: 12px; color: #9ca3af; }
        .hs-close { flex: none; width: 26px; height: 26px; border: 0; border-radius: 6px; background: none; color: #6b7280; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
        .hs-close:hover { background: #f3f4f6; color: #111827; }

        .hs-pills { display: flex; gap: 6px; padding: 2px 14px 10px; overflow-x: auto; border-bottom: 1px solid #eef0f3; scrollbar-width: thin; }
        .hs-pill { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid #e2e5ea; border-radius: 14px; background: #fff; color: #374151; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
        .hs-pill:hover:not(:disabled) { border-color: #bfc7d2; background: #f8fafc; }
        .hs-pill:disabled { color: #9ca3af; cursor: default; }
        .hs-pill.on { border-color: #60a5fa; background: #eff6ff; color: #1d4ed8; font-weight: 600; }
        .hs-pill-count { min-width: 18px; text-align: center; border-radius: 9px; background: #f1f5f9; color: #475569; font-size: 11.5px; font-weight: 600; padding: 0 5px; line-height: 17px; }
        .hs-pill.on .hs-pill-count { background: #2563eb; color: #fff; }

        .hs-body { overflow-y: auto; padding-bottom: 6px; }
        .hs-empty { padding: 18px 14px; color: #6b7280; font-size: 13px; text-align: center; }
        .hs-section-head { display: flex; align-items: center; gap: 7px; padding: 10px 14px 6px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: #6b7280; background: #fafbfc; border-top: 1px solid #f1f3f5; }
        .hs-section:first-child .hs-section-head { border-top: 0; }
        .hs-section-head .anticon { color: #d97706; }
        .hs-row {
          display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto; align-items: center; column-gap: 10px;
          padding: 9px 14px; border-top: 1px solid #f3f4f6; cursor: pointer;
        }
        .hs-row.on { background: #f5f9ff; }
        .hs-tag { font-size: 11.5px; line-height: 20px; padding: 0 7px; border-radius: 4px; border: 1px solid #93c5fd; background: #eff6ff; color: #1d4ed8; white-space: nowrap; }
        .hs-g-bls .hs-tag { border-color: #fdba74; background: #fff7ed; color: #c2410c; }
        .hs-g-invoices .hs-tag { border-color: #86efac; background: #f0fdf4; color: #15803d; }
        .hs-g-vouchers .hs-tag { border-color: #c4b5fd; background: #f5f3ff; color: #6d28d9; }
        .hs-g-parties .hs-tag { border-color: #d1d5db; background: #f9fafb; color: #4b5563; }
        .hs-g-jobs.hs-customs .hs-tag { border-color: #5eead4; background: #f0fdfa; color: #0f766e; }
        .hs-no { font-weight: 700; font-size: 14px; color: #111827; white-space: nowrap; }
        .hs-g-jobs .hs-no { color: #1d4ed8; }
        .hs-detail { min-width: 0; font-size: 12.5px; color: #4b5563; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .hs-date { font-size: 12px; color: #6b7280; white-space: nowrap; }
        .hs-open { font-size: 12.5px; color: #2563eb; white-space: nowrap; }
        .hs-row.on .hs-open { text-decoration: underline; }
      `}</style>
    </div>
  );
};

export default HeaderSearch;
