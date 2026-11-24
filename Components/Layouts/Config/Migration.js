import React, { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Button, Select, Alert, Popconfirm, Spin, Progress } from 'antd';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { Section, SubHead, Hint } from './parts';
import { MODES, stagesForMode, pendingStagesForMode, allStagesForMode, runStage, runAll, fetchCounts, fetchLinkage, fetchReconciliation } from 'functions/migration/engine';

// Admin: run the legacy Climax migration, either end to end or one stage at a
// time, and see what each stage actually landed.
//
// The migration used to be a single button in a hidden dev component that ran
// everything at once, with the individual steps commented out in source. There
// was no way to run one piece, and no way to check a piece had worked before
// the next one built on top of it.
const Migration = () => {
  const [mode, setMode] = useState('freight');
  const [modeLocked, setModeLocked] = useState(false);
  const [counts, setCounts] = useState({});
  const [linkage, setLinkage] = useState({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);   // stage id, or '__all__'
  const [progress, setProgress] = useState({});
  const [results, setResults] = useState({});
  const [recon, setRecon] = useState(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [stagesDone, setStagesDone] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([fetchCounts(), fetchLinkage()]);
      setCounts(c);
      setLinkage(l);
    } catch (err) {
      openNotification('Error', 'Could not read migration counts. Admin only.', 'red');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Default the migration type to the installation's operation mode - a
    // customs-clearance install migrates the legacy LOG job structure, not the
    // sea/air one.
    //
    // Only for modes the engine actually has a path for. An aviation install
    // has no legacy Climax system behind it, so there is no 'aviation' entry
    // in MODES; selecting it would leave the dropdown showing a raw mode key
    // and every stage list empty. Leave the selector on its default instead.
    axiosClient.get('/settings/operationMode')
      .then(({ data }) => {
        if (data?.mode && MODES[data.mode]) { setMode(data.mode); setModeLocked(Boolean(data.locked)); }
      })
      .catch(() => {});
    refresh();
  }, [refresh]);

  // { text, done, total }. done/total are present only where a step can count
  // its work - a sender knows how many records it has, a fetch does not - so
  // the bar shows real progress when it is knowable and an indeterminate
  // animation when it is not, rather than an invented percentage.
  const onProgress = (stageId, text, meta) =>
    setProgress((p) => ({ ...p, [stageId]: { text, ...(meta || {}) } }));

  const finish = async (result) => {
    setResults((r) => ({ ...r, [result.stageId]: result }));
    await refresh();
  };


  // Reconciliation is a separate, explicit action: it calls the legacy server,
  // which may be slow and is not always running.
  const doReconcile = async () => {
    setReconLoading(true);
    try {
      const r = await fetchReconciliation();
      setRecon(r);
      openNotification(
        r?.complete ? 'Reconciled' : 'Differences found',
        r?.complete
          ? 'Every table matches the legacy row count.'
          : 'Some tables do not match the source. See the table below.',
        r?.complete ? 'green' : 'orange'
      );
    } catch (err) {
      openNotification(
        'Could not reconcile',
        err?.response?.data?.result || 'The legacy server could not be reached.',
        'red'
      );
    } finally {
      setReconLoading(false);
    }
  };

  const doStage = async (stage) => {
    setRunning(stage.id);
    try {
      const result = await runStage(stage, { onProgress });
      await finish(result);
      if (result.error) {
        openNotification('Stage failed', `${stage.label}: ${result.error}`, 'red');
      } else if (result.warning) {
        openNotification('Completed with warnings', `${stage.label}: ${result.warning}`, 'orange');
      } else {
        openNotification('Stage complete', `${stage.label}: ${result.summary || `+${result.delta ?? 0} rows`}`, 'green');
      }
    } finally {
      setRunning(null);
      setProgress({});
    }
  };

  const doAll = async () => {
    setRunning('__all__');
    setResults({});
    setStagesDone(0);
    try {
      const all = await runAll(mode, {
        onProgress,
        onStageDone: async (result) => {
          setStagesDone((n) => n + 1);
          await finish(result);
        },
      });
      const failed = all.find((r) => r.error);
      openNotification(
        failed ? 'Migration stopped' : 'Migration finished',
        failed
          ? `Stopped at "${failed.stageId}": ${failed.error}. Nothing after it was run.`
          : `${all.length} stage(s) completed.`,
        failed ? 'red' : 'green'
      );
    } finally {
      setRunning(null);
      setProgress({});
    }
  };

  const stages = stagesForMode(mode);
  // Still on the old import path. Listed so the screen says what is coming
  // rather than looking like the migration lost most of its steps.
  const pending = pendingStagesForMode(mode);

  // Overall position through a full run. Stage count, not row count: the stages
  // are wildly different sizes, so a row-weighted bar would sit at 4% through
  // the ledger and then jump - this at least moves predictably.
  const overallPercent = stages.length ? Math.floor((stagesDone / stages.length) * 100) : 0;
  const doneIds = new Set(Object.entries(results).filter(([, r]) => r.ok).map(([id]) => id));

  const columns = [
    {
      title: '#', width: 44, render: (_t, _r, i) => i + 1,
    },
    {
      title: 'Stage',
      dataIndex: 'label',
      render: (label, stage) => (
        <div>
          <div><b>{label}</b>{stage.detail && <Hint text={stage.detail} />}</div>
          {stage.dependsOn.length > 0 && (
            <div style={{ fontSize: 11, color: '#aaa' }}>after: {stage.dependsOn.join(', ')}</div>
          )}
        </div>
      ),
    },
    {
      title: 'Rows in target',
      width: 150,
      render: (_t, stage) => {
        if (!stage.verifies) return <span style={{ color: '#bbb' }}>n/a</span>;

        // A stage can write more than one table - B/L children fills
        // containers, stamps, dimensions and rate lines in a single run. Show
        // the total AND the per-table split, because a total alone hides one
        // table being empty while the others carry the number.
        const keys = Array.isArray(stage.verifies) ? stage.verifies : [stage.verifies];
        const parts = keys.map((k) => [k, counts[k]]);
        const known = parts.filter(([, c]) => c && typeof c.rows === 'number');
        if (!known.length) return '-';

        const total = known.reduce((n, [, c]) => n + c.rows, 0);
        const migrated = known.reduce(
          (n, [, c]) => (typeof c.withClimaxId === 'number' ? n + c.withClimaxId : n), 0,
        );

        return (
          <div style={{ fontSize: 12 }}>
            <div>{total} rows</div>
            {migrated > 0 && <div style={{ color: '#888' }}>{migrated} migrated</div>}
            {keys.length > 1 && (
              <div style={{ color: '#888', marginTop: 2, lineHeight: 1.4 }}>
                {parts.map(([k, c]) => (
                  <div key={k}>
                    {k}: {c && typeof c.rows === 'number' ? c.rows : '-'}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Last run',
      width: 240,
      render: (_t, stage) => {
        if (running === stage.id || (running === '__all__' && progress[stage.id])) {
          const p = progress[stage.id] || {};
          const known = typeof p.total === 'number' && p.total > 0;
          const percent = known ? Math.floor((p.done / p.total) * 100) : 0;
          return (
            <div style={{ fontSize: 11 }}>
              <Progress
                percent={percent}
                status={known ? 'active' : 'active'}
                showInfo={known}
                size="small"
                strokeColor={known ? undefined : '#91d5ff'}
              />
              <div style={{ color: '#888', marginTop: 2 }}>
                {!known && <Spin size="small" style={{ marginRight: 6 }} />}
                {p.text || 'running...'}
              </div>
            </div>
          );
        }
        const r = results[stage.id];
        if (!r) return <span style={{ color: '#bbb' }}>-</span>;
        if (r.error) return <Tag color="red">failed: {String(r.error).slice(0, 90)}</Tag>;
        // A stage can add rows and still be wrong: batches that failed after
        // their retries, or foreign keys that did not resolve. Both used to be
        // visible only in the browser console, so a partial run read as green.
        if (r.warning) {
          return (
            <Tag color="orange" title={r.warning} style={{ whiteSpace: 'normal' }}>
              {r.summary || `+${r.delta ?? 0} rows`} &mdash; {String(r.warning).slice(0, 160)}
            </Tag>
          );
        }
        return <Tag color="green" style={{ whiteSpace: 'normal' }}>{r.summary || `+${r.delta ?? 0} rows`} in {r.seconds}s</Tag>;
      },
    },
    {
      title: '',
      width: 90,
      render: (_t, stage) => {
        // A dependency counts as met if it ran this session, or if the table
        // it fills already holds rows. Resolve that through the depended-on
        // stage's `verifies` rather than assuming its id is a counts key -
        // blChildren and jobEquipment are not, so assuming it would report
        // them permanently unmet.
        const rowsFor = (stageId) => {
          // allStagesForMode, not the filtered list: a dependency can be a
          // stage that has not been rewritten yet and so is not shown.
          const dep = allStagesForMode(mode).find((s) => s.id === stageId);
          const keys = dep?.verifies
            ? (Array.isArray(dep.verifies) ? dep.verifies : [dep.verifies])
            : [stageId];
          return keys.reduce((n, k) => n + (counts[k]?.rows || 0), 0);
        };
        // A dependency that is not part of THIS migration type is not a
        // dependency. The ledger stage runs in both modes and declares
        // `invoices`, which is freight-only - so on a customs install that
        // dependency can never be satisfied and the warning fired on every
        // run, naming a stage the operator cannot see or run.
        //
        // Note this only silences the warning. A customs install genuinely has
        // no migrated invoices for the ledger's settlement half to apply to,
        // because no stage imports them yet - that is a real gap, and not one
        // a dependency notice on another stage should be standing in for.
        const inThisMode = new Set(allStagesForMode(mode).map((s) => s.id));
        const unmet = stage.dependsOn.filter(
          (d) => inThisMode.has(d) && !doneIds.has(d) && !(rowsFor(d) > 0)
        );
        return (
          <Popconfirm
            title={
              unmet.length
                ? `"${unmet.join(', ')}" may not have run yet. Run this stage anyway?`
                : `Run "${stage.label}"?`
            }
            onConfirm={() => doStage(stage)}
            okText="Run"
          >
            <Button size="small" disabled={Boolean(running)}>Run</Button>
          </Popconfirm>
        );
      },
    },
  ];

  const orphanRows = Object.entries(linkage)
    .filter(([k, v]) => k !== 'note' && typeof v === 'number' && v > 0);

  return (
    <Section title='Migration'>
      {/* The warning stays on the page - this writes to the books. Only the how is behind the hint. */}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={<>One-time legacy migration, from a restored copy of the Climax database
          <Hint text={'Runs against a restored copy of the legacy Climax database, into this installation. '
            + 'Every stage is re-runnable: already-imported rows are matched on their legacy id and skipped, '
            + 'and each job commits atomically with its B/Ls and charge lines, so a stage that fails can '
            + 'simply be run again. Use Reconcile against legacy when you are done - that is the check that '
            + 'proves nothing was missed. See MIGRATION-RUNBOOK.md.'} /></>}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <span>Migration type:</span>
        <Select
          value={mode}
          style={{ width: 260 }}
          disabled={Boolean(running)}
          onChange={setMode}
          options={Object.entries(MODES).map(([value, m]) => ({ value, label: m.label }))}
        />
        {MODES[mode]?.hint && <Hint text={MODES[mode].hint} />}
        {modeLocked && (
          <Tag color="blue">installation mode: {MODES[mode]?.label}</Tag>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button onClick={refresh} disabled={Boolean(running)}>Refresh counts</Button>
          <Button onClick={doReconcile} loading={reconLoading} disabled={Boolean(running)}>
            Reconcile against legacy
          </Button>
          <Popconfirm
            title={`Run all ${stages.length} rewritten stage(s)?`}
            // Says what it will actually do. While the sequence is being
            // rebuilt this is not a full migration, and calling it one would
            // leave someone believing the install was migrated.
            description={
              pending.length
                ? `Runs the rewritten stages in order, stopping at the first failure. `
                  + `${pending.length} stage(s) are not included and still need doing another way.`
                : 'Stages run in order and stop at the first failure.'
            }
            okText="Run"
            onConfirm={doAll}
          >
            <Button
              type="primary"
              danger
              loading={running === '__all__'}
              disabled={Boolean(running) || stages.length === 0}
            >
              {pending.length ? `Run rewritten stages (${stages.length})` : 'Run full migration'}
            </Button>
          </Popconfirm>
        </div>
      </div>

      {running === '__all__' && (
        <div style={{ margin: '12px 0' }}>
          <Progress
            percent={overallPercent}
            status="active"
            format={() => `${stagesDone}/${stages.length} stages`}
          />
        </div>
      )}

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        pagination={false}
        dataSource={stages}
        columns={columns}
      />

      {pending.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SubHead hint={'These are deliberately not runnable here. The original importers still exist and '
            + 'still work, but they write before they check, cannot be safely re-run, and report success '
            + 'whether or not the data landed - which is what produced the migration being rebuilt. Each one '
            + 'reappears above once it plans before it writes, applies atomically, and verifies afterwards.'}>
            Not yet rewritten - {pending.length} stage(s)
          </SubHead>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pending.map((p) => (
              <span
                key={p.id}
                title={p.detail || ''}
                style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: '#f2f2f2', color: '#777',
                }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {recon && (
        <div style={{ marginTop: 24 }}>
          <SubHead hint={'A table only counts as complete when migrated equals legacy. "short" means rows were '
            + 'lost or skipped; "excess" means duplicates.'}>
            Reconciliation - legacy vs migrated
          </SubHead>
          {recon.complete && (
            <div style={{ fontSize: 12, color: '#237804', marginBottom: 8 }}>Every table matches its legacy row count.</div>
          )}
          <Table
            rowKey="table"
            size="small"
            pagination={false}
            dataSource={recon.rows}
            columns={[
              { title: 'Table', dataIndex: 'table' },
              { title: 'Legacy', dataIndex: 'legacy', width: 100 },
              { title: 'Migrated', dataIndex: 'migrated', width: 100 },
              {
                title: 'Diff', dataIndex: 'difference', width: 90,
                render: (d) => (d === 0 || d === null
                  ? <span style={{ color: '#bbb' }}>{d ?? '-'}</span>
                  : <span style={{ color: d < 0 ? '#c0392b' : '#d68910' }}>{d > 0 ? `+${d}` : d}</span>),
              },
              {
                title: 'Status', dataIndex: 'status', width: 110,
                render: (st) => {
                  const colour = { match: 'green', short: 'red', missing: 'red', excess: 'orange' }[st] || 'default';
                  return <Tag color={colour}>{st}</Tag>;
                },
              },
            ]}
          />
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <SubHead hint={'Counts can be perfect while the foreign keys are not. This is how the '
          + 'charge-to-invoice link was being lost silently.'}>
          Linkage check
        </SubHead>
        {orphanRows.length === 0
          ? <Tag color="green">no unresolved links</Tag>
          : orphanRows.map(([k, v]) => (
              <Tag color="orange" key={k} style={{ marginBottom: 4 }}>{k}: {v}</Tag>
            ))}
      </div>
    </Section>
  );
};

export default Migration;
