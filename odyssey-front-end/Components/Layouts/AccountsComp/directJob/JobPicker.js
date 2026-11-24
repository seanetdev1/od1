import React from 'react';
import { Modal, Input, InputNumber, Pagination, Empty, Checkbox, Button } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { MAX_LINES_PER_JOB, MAX_LINES_AT_ONCE, linesPerJob } from 'functions/directJobLines';

const PAGE_SIZE = 10;
// "Tick every job that matches" fetches them all in one go - up to this many.
const MAX_TICK_ALL = 200;

const JOBS_URL = () => `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/getDirectJobNumbers`;

// The freight headings, so the table has a shape before the first answer
// lands. The server sends the install's own - see the backend's
// functions/directJobJobSource.
const FIRST_COLUMNS = [
  { key: 'jobNo', label: 'Job #' },
  { key: 'ref1', label: 'HBL' },
  { key: 'ref2', label: 'MBL' },
  { key: 'party1', label: 'Client' },
  { key: 'party2', label: 'Consignee' },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The job list a Direct Job line's job is chosen from - opened by Enter or the
 * magnifier in the line's Job # box (JobNumberInput), searching for what was
 * typed there.
 *
 * KEYBOARD FIRST, as the customs charge list is (CustomsJobs/ChargePicker):
 *
 *   type       searches the server - job number, and the mode's other columns
 *   up/down    move the highlight
 *   enter      take the highlighted job - or, with jobs ticked, add them
 *   esc        leave, changing nothing
 *
 * Enter pressed before the answer to what was just typed has come back takes
 * the first job of that answer when it lands - not whatever the list showed
 * for the previous search.
 *
 * SEVERAL JOBS AT ONCE (`multiple`, a multiple-job entry - asked 2026-11-17).
 * Each row has a tick, the heading's tick takes the whole page, and a link
 * beside it every job the search matches. Ticks survive paging and searching,
 * so jobs can be gathered from several searches. "Lines per job" says how many
 * lines each ticked job gets; Add (or Enter) hands them all to
 * onPickMany(jobs, perJob) in the order ticked. While anything is ticked a
 * click on a row ticks it too, rather than taking that one job alone.
 */
const JobPicker = ({ open, initialQuery = '', onPick, onCancel, multiple = false, onPickMany }) => {
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState([]);
  // The search and page the rows answer, so Enter knows whether they are current.
  const [answered, setAnswered] = React.useState(null);
  const [total, setTotal] = React.useState(0);
  const [columns, setColumns] = React.useState(FIRST_COLUMNS);
  const [cursor, setCursor] = React.useState(0);
  // The ticked jobs, id -> the job list's row, in the order ticked.
  const [ticked, setTicked] = React.useState(() => new Map());
  const [perJob, setPerJob] = React.useState(1);
  const [tickingAll, setTickingAll] = React.useState(false);
  const takeFirst = React.useRef(false);
  const searchRef = React.useRef(null);
  const listRef = React.useRef(null);

  // Each opening starts on what was typed in the job box, page one, nothing ticked.
  React.useEffect(() => {
    if (!open) return;
    takeFirst.current = false;
    setQuery(initialQuery || '');
    setPage(1);
    setCursor(0);
    setTicked(new Map());
    setPerJob(1);
  }, [open, initialQuery]);

  /* One page from the server. Waits for typing to pause, and drops an answer
   * that arrives after a newer search was sent - a slow answer to "12" landing
   * after the answer to "123" would replace it. */
  React.useEffect(() => {
    if (!open) return undefined;
    let stale = false;
    const key = `${page}|${query}`;
    const timer = setTimeout(async () => {
      try {
        const res = await axiosClient.get(JOBS_URL(), {
          params: { page, limit: PAGE_SIZE, search: query },
        });
        if (stale) return;
        const data = res?.data?.data || [];
        if (Array.isArray(res?.data?.columns) && res.data.columns.length) setColumns(res.data.columns);
        if (takeFirst.current) {
          takeFirst.current = false;
          if (data.length) { onPick(data[0]); return; }
        }
        setRows(data);
        setTotal(res?.data?.pagination?.totalRecords || 0);
        setAnswered(key);
        setCursor(0);
      } catch (e) {
        if (stale) return;
        takeFirst.current = false;
        setRows([]);
        setTotal(0);
        setAnswered(key);
      }
    }, query ? 300 : 0);
    return () => { stale = true; clearTimeout(timer); };
  // onPick is the screen's, new each render; the search is what decides.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page, query]);

  // Keep the highlight in view when it is moved by the keyboard.
  React.useEffect(() => {
    const el = listRef.current?.querySelector('.jp-row.is-on');
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [cursor, rows]);

  const current = answered === `${page}|${query}`;

  /* ---- ticking ---- */
  const toggle = (job) => setTicked((prev) => {
    const next = new Map(prev);
    if (next.has(job.id)) next.delete(job.id); else next.set(job.id, job);
    return next;
  });
  const pageTicked = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  const pagePartly = !pageTicked && rows.some((r) => ticked.has(r.id));
  const togglePage = () => setTicked((prev) => {
    const next = new Map(prev);
    if (pageTicked) rows.forEach((r) => next.delete(r.id));
    else rows.forEach((r) => { if (!next.has(r.id)) next.set(r.id, r); });
    return next;
  });

  /* EVERY JOB THE SEARCH MATCHES, not only this page's - one request for all
   * of them, so only offered up to MAX_TICK_ALL. */
  const tickAllMatching = async () => {
    setTickingAll(true);
    try {
      const res = await axiosClient.get(JOBS_URL(), { params: { page: 1, limit: total, search: query } });
      const data = res?.data?.data || [];
      setTicked((prev) => {
        const next = new Map(prev);
        data.forEach((r) => { if (!next.has(r.id)) next.set(r.id, r); });
        return next;
      });
    } catch (e) {
      openNotification('Error', 'Could not fetch every matching job - tick them page by page.', 'red');
    } finally {
      setTickingAll(false);
    }
  };

  const count = linesPerJob(perJob);
  const linesToAdd = ticked.size * count;
  const tooMany = linesToAdd > MAX_LINES_AT_ONCE;
  const addTicked = () => {
    if (!ticked.size || tooMany || !onPickMany) return;
    onPickMany([...ticked.values()], count);
  };
  const ticking = multiple && ticked.size > 0;

  const onKeyDown = (e) => {
    // The lines-per-job box steps with the arrows and adds with Enter.
    const inCounter = Boolean(e.target?.closest?.('.jp-per'));
    if (e.key === 'ArrowDown' && !inCounter) {
      e.preventDefault();
      setCursor((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === 'ArrowUp' && !inCounter) {
      e.preventDefault();
      setCursor((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (ticking) { addTicked(); return; }
      if (inCounter) return;
      if (!current) { takeFirst.current = true; return; }
      if (rows[cursor]) onPick(rows[cursor]);
    }
  };

  const rowClick = (record) => {
    if (ticking) toggle(record); else onPick(record);
  };

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title='Job Selection'
      footer={null}
      width={1000}
      destroyOnClose
      // The search box, not the modal, so typing works the instant it opens.
      afterOpenChange={(o) => { if (o) searchRef.current?.focus({ cursor: 'end' }); }}
    >
      <div className='job-picker' onKeyDown={onKeyDown}>
        <Input
          ref={searchRef}
          autoFocus
          allowClear
          aria-label='Search jobs'
          placeholder={`Search ${columns.map((c) => c.label).join(' / ')}`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
        />
        <div className='jp-bar'>
          <Pagination
            size='small'
            current={page}
            pageSize={PAGE_SIZE}
            total={total}
            onChange={(p) => setPage(p)}
            showSizeChanger={false}
          />
          {multiple && pageTicked && total > rows.length && (
            total <= MAX_TICK_ALL ? (
              <button type='button' className='jp-link' disabled={tickingAll} onClick={tickAllMatching}>
                {tickingAll ? 'Ticking…' : `Tick all ${total} matching jobs`}
              </button>
            ) : (
              <span className='jp-hint-left'>{total} jobs match - search narrower to tick them all</span>
            )
          )}
          <span className='jp-hint'>
            {ticking
              ? 'Click a row to tick it · Enter to add the ticked jobs · Esc to close'
              : <>&uarr;&darr; to move · Enter to choose · Esc to close</>}
          </span>
        </div>
        <table className='jp-table'>
          <thead>
            <tr>
              {multiple && (
                <th className='jp-tick'>
                  <Checkbox
                    aria-label='Tick every job on this page'
                    checked={pageTicked}
                    indeterminate={pagePartly}
                    disabled={!rows.length}
                    onChange={togglePage}
                  />
                </th>
              )}
              <th style={{ width: '5%' }}>#</th>
              {columns.map((col, i) => (
                <th key={col.key} style={{ width: i === 0 ? '15%' : '20%' }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody ref={listRef}>
            {rows.map((record, index) => (
              <tr
                key={record.id}
                className={`jp-row${index === cursor ? ' is-on' : ''}${ticked.has(record.id) ? ' is-ticked' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => rowClick(record)}
              >
                {multiple && (
                  <td className='jp-tick' onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Tick ${record.jobNo}`}
                      checked={ticked.has(record.id)}
                      onChange={() => toggle(record)}
                    />
                  </td>
                )}
                <td>{(page - 1) * PAGE_SIZE + index + 1}</td>
                {columns.map((col) => <td key={col.key}>{record[col.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {current && rows.length === 0 && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? `No job matches “${query}”.` : 'No jobs yet.'} />
        )}

        {multiple && (
          <div className='jp-multi'>
            <span className='jp-ticked'>
              {ticked.size
                ? <b>{plural(ticked.size, 'job', 'jobs')} ticked</b>
                : 'Tick jobs to add lines for several at once'}
            </span>
            {ticked.size > 0 && (
              <button type='button' className='jp-link' onClick={() => setTicked(new Map())}>Clear</button>
            )}
            <label className='jp-per'>
              <span>Lines per job</span>
              <InputNumber
                aria-label='Lines per job'
                min={1}
                max={MAX_LINES_PER_JOB}
                precision={0}
                value={perJob}
                onChange={(v) => setPerJob(v)}
              />
            </label>
            <Button
              type='primary'
              disabled={!ticked.size || tooMany}
              title={tooMany ? `At most ${MAX_LINES_AT_ONCE} lines at once - tick fewer jobs or give each fewer lines` : undefined}
              onClick={addTicked}
            >
              {ticked.size ? `Add ${plural(linesToAdd, 'line', 'lines')}` : 'Add lines'}
            </Button>
          </div>
        )}
      </div>

      <style jsx global>{`
        .job-picker .jp-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 10px 0 6px;
        }
        .job-picker .jp-hint { margin-left: auto; font-size: 11px; color: #999; }
        .job-picker .jp-hint-left { font-size: 11px; color: #999; }
        .job-picker .jp-table { width: 100%; border-collapse: collapse; }
        .job-picker .jp-table thead { background: #d6dbeb; }
        .job-picker .jp-table th { padding: 8px 10px; text-align: left; }
        .job-picker .jp-table td { padding: 8px 10px; border-bottom: 1px solid #d7d7d7; }
        .job-picker .jp-table .jp-tick { width: 36px; padding-right: 0; }
        .job-picker .jp-row { cursor: pointer; }
        .job-picker .jp-row.is-ticked { background: #f0f7ff; }
        .job-picker .jp-row.is-on { background: #e6f4ff; }
        .job-picker .jp-link {
          border: none;
          background: none;
          padding: 0;
          color: #1677ff;
          font-size: 12px;
          cursor: pointer;
        }
        .job-picker .jp-link:disabled { color: #999; cursor: default; }
        .job-picker .jp-multi {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid #eceff2;
        }
        .job-picker .jp-ticked { font-size: 12px; color: #555; }
        .job-picker .jp-per {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 0 0 0 auto;
          font-size: 12px;
          color: #555;
        }
        .job-picker .jp-per .ant-input-number { width: 72px; }
      `}</style>
    </Modal>
  );
};

export default JobPicker;
