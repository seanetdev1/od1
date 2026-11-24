import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, InputNumber, Select, DatePicker, Checkbox, Tag, Spin, Modal, Segmented, AutoComplete } from 'antd';
import { ExportOutlined, SyncOutlined, RightOutlined, DownOutlined } from '@ant-design/icons';
import Router from 'next/router';
import moment from 'moment';
import Cookies from 'js-cookie';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import openNotification from 'Components/Shared/Notification';
import { usePageActions } from 'Components/Shared/PageActions';
import { getCustomsValues } from 'apis/customsJobs';
import { getPlans, savePlans, deletePlans, movePlans } from 'apis/customsPlans';
import {
  MOVED, STATE_COLORS, planStates, statusOf, isMoved, moveRefusal,
} from 'functions/customsPlanStatus';
import {
  PERIODS, periodRange, fromServer, newRow, rowsToSave, stateCounts, visibleRows,
  blankContainer, containerNoOk, asContainerNo, badContainerNos,
} from 'functions/programBook';
import { EQUIPMENT_SIZES } from 'functions/equipmentSizes';
import {
  useCustomsStatuses, offeredStatuses, labelOf, colorOf, hasRule, valuesWith, startOf, entryOf,
} from 'functions/customsStatuses';

// THE PROGRAM BOOK - a customs install's planned jobs, laid out as the
// client's own sheet ("PROGRAM BOOK 2026"): one row per shipment, typed
// straight across, with no job number until it is moved.
//
// Save sends only the rows that changed (functions/programBook). Move takes
// the ticked CONFIRMED rows to the jobs list, where each becomes a numbered
// customs job - and from then on the row is read-only and shows its Job No,
// because the job is the record to keep updating.
//
// Wider than the page, as the sheet is: the grid scrolls sideways INSIDE its
// frame with the tick box, S No, Job No and Shipper held on the left, so the
// page itself never does.

const COLUMNS = [
  { id: 'shipperId', heading: 'Shipper', width: 210 },
  { id: 'invoiceNo', heading: 'Inv No', width: 110 },
  { id: 'qty', heading: 'Qty', width: 64 },
  { id: 'size', heading: 'Size', width: 76 },
  { id: 'pol', heading: 'POL', width: 170 },
  { id: 'pod', heading: 'POD', width: 170 },
  { id: 'shippingLineId', heading: 'Line', width: 180 },
  // TRANSPORT - who hauls it (the user's request, 2026-10-10). New container
  // lines start with it; the job's Transporter once moved.
  { id: 'transporterId', heading: 'Transport', width: 180 },
  { id: 'status', heading: 'Job Status', width: 120 },
  // THE CONTAINERS - a count that opens the row's section: a line each, with
  // its transporter, size, number and vehicle. It replaced the free-text
  // Container No and Veh Detail cells (the user's request, 2026-10-10).
  { id: 'containerList', heading: 'Containers', width: 130 },
  // Text, as the program states them - "12-OCT 1800", "TBA".
  { id: 'gateInTime', heading: 'Gate In Time', width: 150 },
  { id: 'vessel', heading: 'Vessel', width: 150 },
  { id: 'cutOff', heading: 'Cut Off', width: 150 },
  { id: 'bookingNo', heading: 'Booking No', width: 120 },
  { id: 'currentStatus', heading: 'Current Status', width: 140 },
  { id: 'gdNumber', heading: 'GD No', width: 150 },
  { id: 'remarks', heading: 'Remarks', width: 230 },
];
/* LIVE UPDATES - the toolbar's toggle. On, the book reloads itself every
 * minute, so a desk watching the program sees what the others confirm, move
 * and add without pressing anything. Remembered per browser.
 *
 * A reload NEVER overwrites what somebody is typing: while there are unsaved
 * changes, or a save or move is under way, it waits - and a reply that arrives
 * after typing has begun is dropped rather than applied. It is quiet: no
 * spinner, the scroll and the ticks kept (less any plan that has since been
 * moved), and a new row nobody has filled yet stays where it is. */
const LIVE_KEY = 'odyssey.programBook.live';
const LIVE_EVERY_MS = 60 * 1000;
/* THE TIME FILTER - Today, This week, This fortnight, This month, All or a
 * Custom range, by the date each row was entered (functions/programBook).
 * Remembered per browser, as the live toggle is; a custom range is not - it
 * opens on All. */
const PERIOD_KEY = 'odyssey.programBook.period';

// The columns held on the left while the rest scroll: tick, S No, Job No, Shipper.
const PINNED = [34, 44, 120];
const pinnedLeft = (i) => PINNED.slice(0, i).reduce((t, w) => t + w, 0);

const SIZE_OPTIONS = EQUIPMENT_SIZES.map((v) => ({ value: v }));

/**
 * A ROW'S CONTAINERS - the section that opens under it (the user's request,
 * 2026-10-10): a line per container, with its transporter, size, number and
 * vehicle, as many as the shipment has. A new line starts with the row's
 * Transport and Size. A number has to be four letters then seven digits
 * (MSCU1234567); a wrong one is marked here and refused on Save.
 */
const ContainerSection = ({ row, rowNo, moved, options, onChange }) => {
  const list = Array.isArray(row.containerList) ? row.containerList : [];
  const setList = (next) => onChange(row.key, 'containerList', next);
  const update = (i, field, value) => setList(list.map((c, n) => (n === i ? { ...c, [field]: value } : c)));
  const add = () => setList([...list, blankContainer(row)]);
  const remove = (i) => setList(list.filter((_, n) => n !== i));

  return (
    <div className='pb-section'>
      <table className='pb-subtable'>
        <thead>
          <tr>
            <th style={{ width: 220 }}>Transporter</th>
            <th style={{ width: 110 }}>Size</th>
            <th style={{ width: 170 }}>Container No</th>
            <th style={{ width: 240 }}>Vehicle Details</th>
            {!moved && <th style={{ width: 36 }} aria-label='Remove' />}
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr><td colSpan={moved ? 4 : 5} className='pb-sub-empty'>No containers on this plan yet.</td></tr>
          )}
          {list.map((c, i) => {
            const ok = containerNoOk(c.containerNo);
            if (moved) {
              return (
                <tr key={i}>
                  <td>{options.nameOf(c.transporterId)}</td>
                  <td>{c.size}</td>
                  <td>{c.containerNo}</td>
                  <td>{c.vehicleDetail}</td>
                </tr>
              );
            }
            return (
              <tr key={i}>
                <td>
                  <Select size='small' value={c.transporterId ?? undefined} options={options.transporter}
                    onChange={(v) => update(i, 'transporterId', v ?? null)} showSearch allowClear
                    optionFilterProp='label' style={{ width: '100%' }} dropdownMatchSelectWidth={300}
                    aria-label={`Row ${rowNo} container ${i + 1} transporter`} />
                </td>
                <td>
                  <AutoComplete size='small' value={c.size || ''} options={SIZE_OPTIONS}
                    onChange={(v) => update(i, 'size', String(v || '').toUpperCase())}
                    filterOption={(input, o) => o.value.includes(String(input).toUpperCase())}
                    style={{ width: '100%' }} aria-label={`Row ${rowNo} container ${i + 1} size`} />
                </td>
                <td>
                  <Input size='small' value={c.containerNo || ''} status={ok ? undefined : 'error'}
                    placeholder='MSCU1234567' maxLength={14}
                    onChange={(e) => update(i, 'containerNo', e.target.value.toUpperCase())}
                    onBlur={() => { if (c.containerNo) update(i, 'containerNo', asContainerNo(c.containerNo)); }}
                    title={ok ? undefined : 'Four letters, then seven digits - e.g. MSCU1234567'}
                    aria-label={`Row ${rowNo} container ${i + 1} number`} />
                </td>
                <td>
                  <Input size='small' value={c.vehicleDetail || ''}
                    onChange={(e) => update(i, 'vehicleDetail', e.target.value)}
                    placeholder='Truck no, driver…' aria-label={`Row ${rowNo} container ${i + 1} vehicle`} />
                </td>
                <td>
                  <button type='button' className='pb-sub-del' onClick={() => remove(i)}
                    aria-label={`Remove row ${rowNo} container ${i + 1}`}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!moved && (
        <button type='button' className='pb-sub-add' onClick={add}>+ Add container</button>
      )}
    </div>
  );
};

/** One plan. Memoised: typing in one row must not redraw three hundred. */
const PlanRow = React.memo(({
  row, rowNo, selected, onToggle, onChange, options, openJob, expanded, onExpand,
}) => {
  const moved = isMoved(row);
  const faded = !moved && hasRule(options.planList, statusOf(row, options.planList), 'faded');
  const set = (field) => (value) => onChange(row.key, field, value);
  const text = (field) => ({
    size: 'small', value: row[field] ?? '', onChange: (e) => set(field)(e.target.value),
  });
  const pick = (field, list, extra = {}) => ({
    size: 'small', value: row[field] ?? undefined, onChange: (v) => set(field)(v ?? null),
    options: list, showSearch: true, allowClear: true, optionFilterProp: 'label',
    style: { width: '100%' }, dropdownMatchSelectWidth: 320, ...extra,
  });
  const area = (field) => ({ ...text(field), autoSize: { minRows: 1, maxRows: 4 } });
  const containers = Array.isArray(row.containerList) ? row.containerList : [];
  const badNumbers = badContainerNos(row).length;

  // A moved row is read, not edited: the job is the record now.
  const show = (field) => {
    const v = row[field];
    if (field === 'shipperId' || field === 'shippingLineId' || field === 'transporterId') return options.nameOf(v);
    if (field === 'pol' || field === 'pod') return options.portName(v);
    return v ?? '';
  };

  // The Containers cell: a count that opens the section - on a moved row too,
  // to read what went to the job.
  const containersToggle = (
    <button type='button' className={`pb-expand${badNumbers ? ' pb-expand-bad' : ''}`}
      onClick={() => onExpand(row.key)} aria-expanded={expanded}
      title={badNumbers ? `${badNumbers} container number${badNumbers === 1 ? '' : 's'} to correct` : undefined}>
      {expanded ? <DownOutlined /> : <RightOutlined />}
      {' '}{containers.length ? `${containers.length} container${containers.length === 1 ? '' : 's'}` : (moved ? 'None' : 'Add')}
    </button>
  );

  const cell = (field) => {
    if (field === 'containerList') return containersToggle;
    if (moved) return <span className='pb-text'>{show(field)}</span>;
    switch (field) {
      case 'shipperId': {
        // The shipper already on the row stays in the list, even one the
        // Client list leaves out (tagged only as a Terminal - 2026-11-17).
        const current = row[field];
        const list = current == null || options.client.some((o) => o.value === current)
          ? options.client
          : [...options.client, { value: current, label: options.nameOf(current) || String(current) }];
        return <Select {...pick(field, list)} aria-label={`Row ${rowNo} Shipper`} />;
      }
      case 'shippingLineId': return <Select {...pick(field, options.shippingLine)} aria-label={`Row ${rowNo} Line`} />;
      case 'transporterId': return <Select {...pick(field, options.transporter)} aria-label={`Row ${rowNo} Transport`} />;
      case 'pol': return <Select {...pick(field, options.pol)} aria-label={`Row ${rowNo} POL`} />;
      case 'pod': return <Select {...pick(field, options.port)} aria-label={`Row ${rowNo} POD`} />;
      case 'status':
        return (
          <Select {...pick(field, options.statusOptions(row.status), { allowClear: false, showSearch: false })}
            aria-label={`Row ${rowNo} Job Status`} />
        );
      case 'qty':
        return (
          <InputNumber size='small' min={0} precision={0} value={row.qty ?? null} style={{ width: '100%' }}
            onChange={(v) => set('qty')(v ?? null)} aria-label={`Row ${rowNo} Qty`} />
        );
      case 'remarks':
        return <Input.TextArea {...area(field)} aria-label={`Row ${rowNo} ${field}`} />;
      default:
        return <Input {...text(field)} aria-label={`Row ${rowNo} ${field}`} />;
    }
  };

  // The date it was entered - what the time filter goes by.
  const entered = row.createdAt ? moment(row.createdAt) : null;

  return (
    <>
      <tr className={`pb-row${moved ? ' pb-moved' : ''}${faded ? ' pb-faded' : ''}`} data-row={rowNo}>
        <td className='pb-pin' style={{ left: pinnedLeft(0) }}>
          <Checkbox checked={selected} disabled={moved} onChange={() => onToggle(row.key)}
            aria-label={`Select row ${rowNo}`} />
        </td>
        <td className='pb-pin pb-no' style={{ left: pinnedLeft(1) }}
          title={entered?.isValid() ? `Entered ${entered.format('DD-MM-YY HH:mm')}` : 'Not saved yet'}>{rowNo}</td>
        <td className='pb-pin' style={{ left: pinnedLeft(2) }}>
          {moved ? (
            <button type='button' className='pb-job' onClick={() => openJob(row.Customs_Job)}
              title='Open the job'>
              {row.Customs_Job?.jobNo || 'Job'}
            </button>
          ) : <span className='pb-nojob' title='Numbered when it is moved to the jobs list'>—</span>}
        </td>
        {COLUMNS.map((c, i) => (
          <td key={c.id} className={i === 0 ? 'pb-pin pb-pin-last' : undefined}
            style={i === 0 ? { left: pinnedLeft(3) } : undefined}>
            {c.id === 'status' && moved ? options.jobStatusTag(row.Customs_Job) : cell(c.id)}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr className='pb-subrow'>
          <td colSpan={PINNED.length + COLUMNS.length}>
            <ContainerSection row={row} rowNo={rowNo} moved={moved} options={options} onChange={onChange} />
          </td>
        </tr>
      )}
    </>
  );
});
PlanRow.displayName = 'PlanRow';

const ProgramBook = ({ companyId }) => {
  const dispatchTab = useDispatch();
  const [rows, setRows] = useState([]);
  const originals = useRef(new Map());
  const seq = useRef(0);
  const [values, setValues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [noCompany, setNoCompany] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  // The rows whose container section is open.
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState('');
  // The statuses and their rules - Configuration > Customs.
  const statuses = useCustomsStatuses();
  const planList = statuses.plan;
  // The statuses the book opens on - Pending and Confirmed unless configured
  // otherwise: what is still to be confirmed or moved. The rest are a tick
  // away. Empty would mean every state. Follows the setting as it loads,
  // until somebody picks for themselves.
  const shownOnOpen = useMemo(() => valuesWith(planList, 'shown'), [planList]);
  const [states, setStates] = useState(() => new Set(shownOnOpen));
  const statesPicked = useRef(false);
  useEffect(() => {
    if (!statesPicked.current) setStates(new Set(shownOnOpen));
  }, [shownOnOpen]);
  // The time filter - see PERIOD_KEY.
  const [period, setPeriod] = useState('all');
  const [customRange, setCustomRange] = useState(null);
  useEffect(() => {
    try {
      const kept = window.localStorage.getItem(PERIOD_KEY);
      if (PERIODS.some((p) => p.id === kept && p.id !== 'custom')) setPeriod(kept);
    } catch (_) { /* no storage: All */ }
  }, []);
  const pickPeriod = (next) => {
    setPeriod(next);
    try { if (next !== 'custom') window.localStorage.setItem(PERIOD_KEY, next); } catch (_) { /* not remembered */ }
  };
  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);
  // Live updates - see LIVE_KEY. Off until the browser says otherwise.
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [liveFailed, setLiveFailed] = useState(false);
  // Read at the moment a reload would apply, not when it was scheduled.
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);

  /* `quiet` is the live reload: no spinner, no error box every minute, and it
     gives way to anything being typed or saved. */
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await getPlans({ companyId });
      if (res?.status !== 'success') throw new Error(res?.result);
      // Typing began, or a save started, while this was on its way.
      if (quiet && (dirtyRef.current || busyRef.current)) return;
      const list = (res.result || []).map(fromServer);
      originals.current = new Map(list.map((r) => [r.key, r]));
      // A new row nobody has filled is the user's, not the server's - kept.
      setRows((current) => (quiet ? [...list, ...current.filter((r) => !r.id)] : list));
      setNoCompany(Boolean(res.noCompany));
      setSelected((current) => (quiet
        ? new Set([...current].filter((k) => !k.startsWith('p-') || list.some((r) => r.key === k && !isMoved(r))))
        : new Set()));
      setUpdatedAt(new Date());
      setLiveFailed(false);
    } catch (e) {
      if (quiet) setLiveFailed(true);
      else openNotification('Error', e?.response?.data?.result || e?.message || 'Could not load the Program Book.', 'red');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    try { setLive(window.localStorage.getItem(LIVE_KEY) === 'on'); } catch (_) { /* no storage: stays off */ }
  }, []);
  useEffect(() => {
    if (!live) return undefined;
    const tick = () => {
      if (dirtyRef.current || busyRef.current) return;
      // A tab nobody is looking at need not ask; the next tick after it is
      // shown again catches up.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load({ quiet: true });
    };
    const timer = setInterval(tick, LIVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const toggleLive = useCallback(() => {
    const next = !live;
    setLive(next);
    try { window.localStorage.setItem(LIVE_KEY, next ? 'on' : 'off'); } catch (_) { /* not remembered */ }
    // Up to date from the moment it is turned on, not a minute later.
    if (next && !dirtyRef.current && !busyRef.current) load({ quiet: true });
  }, [live, load]);
  useEffect(() => {
    getCustomsValues()
      .then((res) => setValues(res?.result || {}))
      .catch(() => openNotification('Error', 'Could not load the parties and ports.', 'red'));
  }, []);

  // The pick lists, shared by every row - built once, not per row.
  const options = useMemo(() => {
    const v = values || {};
    const party = (list) => (list || []).map((x) => ({ value: x.id, label: x.name }));
    // `party` too: a row saved with a shipper the Client list no longer offers
    // (one tagged only as a Terminal, 2026-11-17) still shows its name.
    const names = new Map([...(v.party || []), ...(v.client || []), ...(v.shippingLine || []), ...(v.transporter || [])]
      .map((x) => [x.id, x.name]));
    const ports = new Map([...(v.port || []), ...(v.vocabulary?.polSea || [])].map((x) => [x.id, x.name]));
    const jobList = statuses.job;
    return {
      client: party(v.client),
      shippingLine: party(v.shippingLine),
      transporter: party(v.transporter),
      pol: party(v.vocabulary?.polSea),
      port: party(v.port),
      planList,
      // The statuses still offered - and the row's own, should it be retired.
      statusOptions: (current) => offeredStatuses(planList, current),
      /* A MOVED plan shows where its JOB has got to - its status on the jobs
         list, named and coloured as there - not just that it was moved.
         Cancel Job's flag wins, as it does on the jobs list. */
      jobStatusTag: (job) => {
        const status = job?.canceled ? 'Canceled' : (job?.status || startOf(jobList));
        return (
          <Tag color={colorOf(jobList, status)} title={`${job?.jobNo || 'Its job'} on the jobs list`}>
            {labelOf(jobList, status)}
          </Tag>
        );
      },
      nameOf: (id) => (id == null ? '' : names.get(id) || ''),
      portName: (id) => (id ? ports.get(id) || id : ''),
    };
  }, [values, statuses, planList]);

  const onChange = useCallback((key, field, value) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }, []);
  const onToggle = useCallback((key) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const onExpand = useCallback((key) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const openJob = useCallback((job) => {
    if (!job?.id) return;
    dispatchTab(incrementTab({ label: job.jobNo || 'Customs Job', key: '11-2', id: job.id }));
    Router.push(`/customsJobs/${job.id}`);
  }, [dispatchTab]);

  const changes = useMemo(() => rowsToSave(rows, originals.current), [rows]);
  const dirty = changes.length > 0;
  dirtyRef.current = dirty;
  busyRef.current = busy;
  const shown = useMemo(
    () => visibleRows(rows, { states, search, nameOf: options.nameOf, range, list: planList }),
    [rows, states, search, options, range, planList],
  );
  const counts = useMemo(() => stateCounts(rows, { list: planList, range }), [rows, planList, range]);

  const picked = rows.filter((r) => selected.has(r.key));
  const refusals = picked.map((r) => moveRefusal(r, null, planList)).filter(Boolean);
  const movableNames = valuesWith(planList, 'movable').map((v) => labelOf(planList, v)).join(' or ');
  const moveBlock = !picked.length ? `Tick the ${movableNames} plans to move`
    : dirty ? 'Save your changes first'
      : refusals.length ? `Only ${movableNames} plans can be moved - ${refusals[0]}`
        : null;

  const addRow = useCallback(() => {
    seq.current += 1;
    setRows((list) => [...list, newRow(seq.current, planList)]);
  }, [planList]);

  const save = useCallback(async () => {
    if (!changes.length) return;
    // A container number is four letters then seven digits - open the rows
    // that have one that is not, and say which.
    const bad = rows.filter((r) => !isMoved(r) && badContainerNos(r).length);
    if (bad.length) {
      setExpanded((s) => new Set([...s, ...bad.map((r) => r.key)]));
      const first = badContainerNos(bad[0])[0];
      openNotification('Error',
        `Container No "${first}" must be 4 letters then 7 digits, e.g. MSCU1234567`
        + `${bad.length > 1 ? ` (and ${bad.length - 1} more row${bad.length === 2 ? '' : 's'})` : ''}.`, 'red');
      return;
    }
    setBusy(true);
    try {
      const res = await savePlans({ companyId, rows: changes });
      if (res?.status !== 'success') throw new Error(res?.result);
      const { created = 0, updated = 0 } = res.result || {};
      openNotification('Success', `Program Book saved - ${created} added, ${updated} changed.`, 'green');
      await load();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not save.', 'red');
    } finally {
      setBusy(false);
    }
  }, [changes, rows, companyId, load]);

  const removeSelected = useCallback(async () => {
    const unsaved = picked.filter((r) => !r.id).map((r) => r.key);
    const ids = picked.filter((r) => r.id).map((r) => r.id);
    if (unsaved.length) setRows((list) => list.filter((r) => !unsaved.includes(r.key)));
    if (!ids.length) { setSelected(new Set()); return; }
    setBusy(true);
    try {
      const res = await deletePlans({ companyId, ids });
      if (res?.status !== 'success') throw new Error(res?.result);
      openNotification('Success', `${ids.length} plan${ids.length === 1 ? '' : 's'} deleted.`, 'green');
      await load();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || e?.message || 'Could not delete.', 'red');
    } finally {
      setBusy(false);
    }
  }, [picked, companyId, load]);

  const move = useCallback(() => {
    const ids = picked.map((r) => r.id);
    Modal.confirm({
      title: `Move ${ids.length} plan${ids.length === 1 ? '' : 's'} to the jobs list?`,
      content: 'Each becomes a customs job with its own job number. A moved plan cannot be '
        + 'changed here any more - its job is the record from then on.',
      okText: 'Move to Jobs',
      onOk: async () => {
        setBusy(true);
        try {
          const res = await movePlans({
            companyId, ids, fiscalYearId: Cookies.get('fiscalYearId'), employeeId: Cookies.get('loginId'),
          });
          if (res?.status !== 'success') throw new Error(res?.result);
          const jobNos = (res.result || []).map((x) => x.jobNo).join(', ');
          openNotification('Success', `Moved to the jobs list: ${jobNos}`, 'green');
          await load();
        } catch (e) {
          openNotification('Error', e?.response?.data?.result || e?.message || 'Could not move the plans.', 'red');
        } finally {
          setBusy(false);
        }
      },
    });
  }, [picked, companyId, load]);

  const deletable = picked.length > 0 && picked.every((r) => !isMoved(r));

  usePageActions({
    title: 'Program Book',
    subtitle: 'Planned jobs - numbered when they are moved to the jobs list',
    new: { onClick: addRow, label: 'Add Row', title: 'Add a row to the book', disabled: noCompany },
    save: {
      onClick: save, disabled: !dirty || busy, busy,
      title: dirty ? `Save ${changes.length} row${changes.length === 1 ? '' : 's'}` : 'Nothing to save',
    },
    delete: {
      onClick: removeSelected, disabled: !deletable || busy,
      confirm: `Delete ${picked.length} plan${picked.length === 1 ? '' : 's'}?`,
      title: deletable ? 'Delete the ticked plans' : 'Tick plans that have not been moved',
    },
    extras: [{
      key: 'move', label: 'Move to Jobs', Icon: ExportOutlined, onClick: move,
      disabled: Boolean(moveBlock) || busy, title: moveBlock || 'Give the ticked plans job numbers',
    }, {
      key: 'live', label: live ? 'Live updates on' : 'Live updates off', Icon: SyncOutlined,
      onClick: toggleLive, pressed: live, disabled: noCompany,
      title: live ? 'Live updates on - the book reloads every minute. Click to turn off.'
        : 'Turn on live updates - reload the book every minute',
    }],
  }, [addRow, save, removeSelected, move, toggleLive, live, dirty, busy, deletable, moveBlock, picked.length,
    changes.length, noCompany]);

  const toggleState = (s) => {
    statesPicked.current = true;
    setStates((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };
  // A tag per status, and Moved - a retired status only while plans are at it.
  const stateTags = planStates(planList)
    .filter((s) => s === MOVED || !entryOf(planList, s)?.hidden || counts[s])
    .map((s) => (s === MOVED
      ? { value: s, label: 'Moved', color: STATE_COLORS[MOVED] }
      : { value: s, label: labelOf(planList, s), color: colorOf(planList, s) }));
  // The header box ticks every shown plan that can be ticked, or clears them.
  const tickable = shown.filter(({ row }) => !isMoved(row)).map(({ row }) => row.key);
  const allTicked = tickable.length > 0 && tickable.every((k) => selected.has(k));
  const tickAll = () => setSelected(allTicked ? new Set() : new Set(tickable));

  if (noCompany) {
    return <div className='program-book-empty'>Pick your company at the top of the screen to see its Program Book.</div>;
  }

  return (
    <div className='program-book'>
      <div className='pb-bar'>
        <div className='pb-filter'>
          <span className='pb-label'>Show</span>
          {stateTags.map(({ value, label, color }) => {
            const on = states.has(value);
            return (
              <Tag key={value} color={on ? color : undefined} className={`pb-tag ${on ? 'on' : 'off'}`}
                onClick={() => toggleState(value)} title={on ? `Hide ${label} plans` : `Show ${label} plans`}>
                {label} <b>{counts[value] ?? 0}</b>
              </Tag>
            );
          })}
        </div>
        <div className='pb-period'>
          <span className='pb-label'>Entered</span>
          <Segmented size='small' value={period} onChange={pickPeriod}
            options={PERIODS.map((p) => ({ value: p.id, label: p.label }))} />
          {period === 'custom' && (
            <DatePicker.RangePicker size='small' format='DD-MM-YY' value={customRange}
              onChange={(v) => setCustomRange(v)} allowEmpty={[true, true]} placeholder={['From', 'To']}
              aria-label='Entered between' />
          )}
        </div>
        {live && (
          <span className={`pb-live${dirty || liveFailed ? ' pb-live-held' : ''}`} role='status'>
            <span className='pb-live-dot' aria-hidden='true' />
            {dirty ? 'Live - paused until you save'
              : liveFailed ? `Live - could not update${updatedAt ? ` since ${moment(updatedAt).format('HH:mm')}` : ''}, trying again`
                : `Live - updated ${updatedAt ? moment(updatedAt).format('HH:mm') : 'now'}`}
          </span>
        )}
        <Input.Search placeholder='Shipper, invoice, container, booking, job no…' allowClear
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 300 }} />
      </div>
      {dirty && (
        <div className='pb-dirty'>
          {changes.length} row{changes.length === 1 ? '' : 's'} not saved yet - Save before moving plans.
        </div>
      )}

      {loading ? <div className='pb-loading'><Spin /></div> : (
        <div className='pb-frame'>
          <table className='pb-table'>
            <colgroup>
              {PINNED.map((w, i) => <col key={i} style={{ width: w }} />)}
              {COLUMNS.map((c) => <col key={c.id} style={{ width: c.width }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className='pb-pin' style={{ left: pinnedLeft(0) }}>
                  <Checkbox checked={allTicked} disabled={!tickable.length} onChange={tickAll}
                    aria-label='Select every plan shown' />
                </th>
                <th className='pb-pin' style={{ left: pinnedLeft(1) }}>S No</th>
                <th className='pb-pin' style={{ left: pinnedLeft(2) }}>Job No</th>
                {COLUMNS.map((c, i) => (
                  <th key={c.id} className={i === 0 ? 'pb-pin pb-pin-last' : undefined}
                    style={i === 0 ? { left: pinnedLeft(3) } : undefined}>{c.heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr className='pb-empty'>
                  <td colSpan={PINNED.length + COLUMNS.length}>
                    {rows.length ? 'No plans match.' : 'No plans yet - Add Row starts the book.'}
                  </td>
                </tr>
              )}
              {shown.map(({ row, rowNo }) => (
                <PlanRow key={row.key} row={row} rowNo={rowNo} selected={selected.has(row.key)}
                  onToggle={onToggle} onChange={onChange} options={options} openJob={openJob}
                  expanded={expanded.has(row.key)} onExpand={onExpand} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type='button' className='pb-add' onClick={addRow}>+ Add Row</button>

      <style jsx global>{`
        .program-book { padding: 4px 0 24px; }
        .program-book .pb-bar {
          display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
          justify-content: space-between; margin-bottom: 10px;
        }
        .program-book .pb-filter { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .program-book .pb-label { color: #666; font-size: 13px; margin-right: 4px; }
        .program-book .pb-tag { cursor: pointer; user-select: none; }
        .program-book .pb-tag.off { opacity: 0.6; }
        .program-book .pb-dirty { color: #ad6800; font-size: 13px; margin-bottom: 8px; }
        .program-book .pb-live {
          display: inline-flex; align-items: center; gap: 6px; margin-left: auto;
          font-size: 12px; color: #1D6F42;
        }
        .program-book .pb-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #2fa865; }
        .program-book .pb-live-held { color: #ad6800; }
        .program-book .pb-live-held .pb-live-dot { background: #d4a017; }
        .program-book .pb-loading { padding: 40px; text-align: center; }
        /* The frame scrolls; the page does not. */
        .program-book .pb-frame {
          max-width: 100%; overflow: auto; max-height: calc(100vh - 230px);
          border: 1px solid #d9d9d9; border-radius: 6px; background: #fff;
        }
        .program-book .pb-table { table-layout: fixed; border-collapse: separate; border-spacing: 0; width: max-content; }
        .program-book .pb-table th {
          position: sticky; top: 0; z-index: 2; background: #f5f5f5; font-size: 12px; font-weight: 600;
          text-transform: uppercase; color: #333; padding: 6px; border-bottom: 1px solid #d9d9d9;
          border-right: 1px solid #ececec; white-space: nowrap; text-align: left;
        }
        .program-book .pb-table td {
          padding: 3px 4px; border-bottom: 1px solid #f0f0f0; border-right: 1px solid #f5f5f5;
          vertical-align: top; background: #fff; font-size: 13px;
        }
        .program-book .pb-table .pb-pin { position: sticky; z-index: 1; }
        .program-book .pb-table th.pb-pin { z-index: 3; }
        .program-book .pb-table .pb-pin-last { box-shadow: 4px 0 4px -2px rgba(0, 0, 0, 0.08); }
        .program-book .pb-no { color: #888; text-align: right; padding-right: 8px; padding-top: 7px; }
        .program-book .pb-nojob { color: #bbb; display: inline-block; padding-top: 4px; }
        .program-book .pb-job {
          background: none; border: 0; padding: 4px 0 0; color: #1677ff; cursor: pointer; font-weight: 600;
        }
        .program-book .pb-text { display: inline-block; padding-top: 4px; white-space: pre-wrap; }
        .program-book .pb-moved td { background: #f7faff; }
        .program-book .pb-faded td:not(.pb-pin) { opacity: 0.6; }
        .program-book .pb-period { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .program-book .pb-empty td { padding: 24px; text-align: center; color: #999; }
        .program-book .pb-add {
          margin-top: 8px; background: none; border: 1px dashed #bbb; border-radius: 6px;
          padding: 4px 14px; color: #555; cursor: pointer;
        }
        .program-book .pb-add:hover { border-color: #1677ff; color: #1677ff; }
        .program-book-empty { padding: 40px; text-align: center; color: #888; }
        .program-book .pb-expand {
          background: none; border: 0; padding: 4px 0 0; color: #1677ff; cursor: pointer; white-space: nowrap;
        }
        .program-book .pb-expand-bad { color: #cf1322; font-weight: 600; }
        /* The section sits under its row, held at the frame's left edge while the grid scrolls. */
        .program-book .pb-subrow > td { background: #fafcff; padding: 6px 8px 10px; }
        .program-book .pb-section { position: sticky; left: 8px; width: max-content; max-width: 90vw; }
        .program-book .pb-subtable { border-collapse: collapse; table-layout: fixed; }
        .program-book .pb-subtable th {
          position: static; background: #eef3fb; font-size: 11px; padding: 4px 6px; text-transform: uppercase;
        }
        .program-book .pb-subtable td { padding: 2px 4px; border-bottom: 1px solid #eef1f6; background: transparent; }
        .program-book .pb-sub-empty { color: #999; padding: 8px !important; }
        .program-book .pb-sub-del {
          background: none; border: 0; color: #999; font-size: 16px; cursor: pointer; line-height: 1;
        }
        .program-book .pb-sub-del:hover { color: #cf1322; }
        .program-book .pb-sub-add {
          margin-top: 6px; background: none; border: 1px dashed #bbb; border-radius: 6px;
          padding: 2px 12px; color: #555; cursor: pointer; font-size: 12px;
        }
        .program-book .pb-sub-add:hover { border-color: #1677ff; color: #1677ff; }
      `}</style>
    </div>
  );
};

export default ProgramBook;
