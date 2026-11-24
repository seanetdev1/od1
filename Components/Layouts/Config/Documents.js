import React, { useCallback, useEffect, useState } from 'react';
import {
  Spin, Input, Checkbox, Alert,
} from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined, DeleteOutlined, FolderOutlined, FolderOpenOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import openNotification from 'Components/Shared/Notification';
import {
  getDocumentSettings, browseFolders, chooseDocumentsFolder, getDocumentTypes, saveDocumentTypes,
} from 'apis/documents';
import { formatSize } from 'functions/documentFiles';
import { Section, SubHead } from './parts';

/**
 * Configuration > Attached Documents (the user's requests, 2026-11-13).
 *
 * WHERE THEY ARE KEPT. Until a folder is chosen here, nothing can be attached
 * anywhere. Odyssey runs in a container and reaches only the server's folders
 * its compose file mounts - /documents (a volume on the server's own drive)
 * and the server's /mnt, where another drive goes - so the folder is picked
 * from inside those, by browsing or by typing its path. Choosing one makes it,
 * proves Odyssey can write there, and marks it.
 *
 * MOVING THEM. A document's row holds only where its file is inside the
 * folder, so moving is: copy everything to the new folder on the server, then
 * choose it here. Odyssey first looks for every document in it, and says how
 * many are not there rather than leave them unopenable - unless told to go
 * ahead anyway.
 *
 * THE TYPES a document is attached as - the dropdown beside the paperclip.
 * Renamed here, renamed on every document that has it. "On the job's
 * invoices": a job's document of that type shows on the job's invoices too
 * (an invoice scanned onto the job). One in use is never removed - untick
 * Offered to retire it; the documents that have it keep it.
 */

const ago = (n) => `${n} document${n === 1 ? '' : 's'}`;

const Folder = () => {
  const [state, setState] = useState(null);
  const [browse, setBrowse] = useState(null);   // { path, parent, folders }
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(null);  // the server's 409

  const load = useCallback(() => getDocumentSettings()
    .then((s) => { setState(s); setTyped(s.path || ''); })
    .catch(() => openNotification('Error', 'Could not load where documents are kept.', 'red')), []);

  const go = useCallback((p) => browseFolders(p)
    .then((b) => { setBrowse(b); if (b.path) setTyped(b.path); })
    .catch((e) => openNotification('Error', e?.response?.data?.result || 'Could not open that folder.', 'red')), []);

  useEffect(() => { load(); go(''); }, [load, go]);

  const choose = async (force = false) => {
    const p = typed.trim();
    if (!p) return;
    setBusy(true);
    try {
      const res = await chooseDocumentsFolder(p, force);
      setMissing(null);
      openNotification('Success', res.missing
        ? `Documents are kept in ${res.path} now - ${ago(res.missing)} of ${res.total} are not in it yet.`
        : `Documents are kept in ${res.path} now.`, res.missing ? 'orange' : 'green');
      await load();
    } catch (e) {
      if (e?.response?.status === 409) setMissing({ path: p, ...e.response.data });
      else openNotification('Error', e?.response?.data?.result || 'Could not choose that folder.', 'red');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Spin />;
  const f = state.folder;
  const same = typed.trim() === state.path;
  const changed = typed.trim() && !same;
  /* THE CHOSEN FOLDER, SET UP AGAIN. A folder whose drive was mounted afresh
   * has no marker, and choosing is the only thing that writes one - but the
   * button only ever woke for a different folder, so it could not be done
   * (CL, 2026-11-17: E:\documents-cl mounted at /documents, where the folder
   * had been inside the container; every upload refused). */
  const redo = Boolean(state.path) && same && !(f?.exists && f?.marked);

  return (
    <>
      {!state.path
        ? <Alert type='warning' showIcon message='No folder is chosen yet - nothing can be attached until one is.' />
        : (
          <table className='docs-state'><tbody>
            <tr><th>Folder</th><td><code>{state.path}</code></td></tr>
            <tr><th>State</th><td>
              {!f?.exists ? <span className='docs-bad'>Not there - is its drive mounted?</span>
                : !f.marked ? <span className='docs-bad'>Not the folder that was set up (no .odyssey-documents) - is its drive mounted?</span>
                  : <span className='docs-good'>Ready</span>}
            </td></tr>
            {f?.total ? <tr><th>Its drive</th><td>{formatSize(f.free)} free of {formatSize(f.total)}</td></tr> : null}
            <tr><th>Documents</th><td>{state.documents}</td></tr>
          </tbody></table>
        )}

      <SubHead hint={`Odyssey can reach folders inside ${state.roots.join(' and ')} - /documents is a volume on this `
        + 'server\'s own drive; /mnt is where another drive is mounted. A folder that does not exist yet is made.'}>
        {state.path ? 'Move to another folder' : 'Choose the folder'}
      </SubHead>
      <div className='docs-browser'>
        <div className='db-where'>
          {browse?.path
            ? <button type='button' onClick={() => go(browse.parent || '')} aria-label='Up one folder'><ArrowLeftOutlined /></button>
            : null}
          <span>{browse?.path || 'Places Odyssey can reach'}</span>
        </div>
        <ul>
          {(browse?.folders || []).map((x) => (
            <li key={x.path}>
              <button type='button' onClick={() => go(x.path)}>
                {x.path === state.path ? <FolderOpenOutlined /> : <FolderOutlined />} {x.name}
              </button>
            </li>
          ))}
          {browse && !browse.folders.length && <li className='grey-txt'>No folders in here.</li>}
        </ul>
      </div>
      <div className='docs-choose'>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label='Documents folder'
          placeholder='/mnt/data/odyssey-documents' />
        <button type='button' className='btn-custom' disabled={busy || !(changed || redo)} onClick={() => choose(false)}>
          {busy ? 'Checking…' : 'Use this folder'}
        </button>
      </div>
      {missing && (
        <Alert className='mt-2' type='error' showIcon
          message={missing.result}
          description={missing.examples?.length ? <>For example: {missing.examples.map((x) => <code key={x}> {x}</code>)}</> : null}
          action={(
            <button type='button' className='btn-red' disabled={busy} onClick={() => choose(true)}>Use it anyway</button>
          )} />
      )}
    </>
  );
};

const Types = () => {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [inUse, setInUse] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDocumentTypes()
      .then((res) => { setSaved(res.result); setDraft(res.result); setInUse(res.inUse || {}); })
      .catch(() => openNotification('Error', 'Could not load the document types.', 'red'));
  }, []);

  const dirty = Boolean(draft && saved) && JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (i, patch) => setDraft((d) => d.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const move = (i, by) => setDraft((d) => {
    const next = [...d];
    const [t] = next.splice(i, 1);
    next.splice(i + by, 0, t);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveDocumentTypes(draft);
      setSaved(res.result);
      setDraft(res.result);
      setInUse(res.inUse || {});
      openNotification('Success', 'Document types saved.', 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not save the document types.', 'red');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) return <Spin />;
  return (
    <>
      <table className='docs-types'>
        <thead>
          <tr>
            <th aria-label='Order' />
            <th>Name</th>
            <th className='dt-flag'>On the job&apos;s invoices</th>
            <th className='dt-flag'>Offered</th>
            <th>Documents</th>
            <th aria-label='Remove' />
          </tr>
        </thead>
        <tbody>
          {draft.map((t, i) => {
            const used = inUse[t.id] || 0;
            return (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={t.id ?? `new-${i}`} className={t.offered === false ? 'dt-retired' : undefined}>
                <td className='dt-order'>
                  <button type='button' disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${t.name} up`}><ArrowUpOutlined /></button>
                  <button type='button' disabled={i === draft.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${t.name} down`}><ArrowDownOutlined /></button>
                </td>
                <td>
                  <Input size='small' value={t.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })}
                    aria-label={`Document type ${i + 1} name`} />
                </td>
                <td className='dt-flag'>
                  <Checkbox checked={Boolean(t.onInvoices)} onChange={(e) => set(i, { onInvoices: e.target.checked })}
                    aria-label={`${t.name}: on the job's invoices`} />
                </td>
                <td className='dt-flag'>
                  <Checkbox checked={t.offered !== false} onChange={(e) => set(i, { offered: e.target.checked })}
                    aria-label={`${t.name}: offered`} />
                </td>
                <td className='grey-txt'>{used || ''}</td>
                <td>
                  <button type='button' className='dt-remove' disabled={used > 0}
                    title={used ? `On ${ago(used)} - untick Offered to retire it` : 'Remove this type'}
                    onClick={() => setDraft((d) => d.filter((_, j) => j !== i))} aria-label={`Remove ${t.name}`}>
                    <DeleteOutlined />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type='button' className='dt-add' onClick={() => setDraft((d) => [...d, { name: '', onInvoices: false, offered: true }])}>
        + Add type
      </button>
      <div style={{ display: 'flex', gap: 8 }} className='mt-3'>
        <button type='button' className='btn-custom' onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        {dirty && <button type='button' className='btn-custom' onClick={() => setDraft(saved)} disabled={saving}>Undo changes</button>}
      </div>
    </>
  );
};

const Documents = () => (
  <div className='docs-config' style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <Section title='Where documents are kept'
      hint={'Scans and files attached to jobs, vouchers, invoices and Direct Jobs are kept as files in this folder. '
        + 'Nothing can be attached until one is chosen. To move them: copy everything from this folder to the new one '
        + 'on the server, then choose the new one here.'}>
      <Folder />
    </Section>
    <Section title='Document types'
      hint={'What a document can be attached as - the dropdown beside the paperclip. Ticked "On the job\'s invoices", '
        + 'a job\'s documents of that type show on the job\'s invoices too. A type in use cannot be removed: untick '
        + 'Offered to retire it - its documents keep it.'}>
      <Types />
    </Section>
    <style jsx global>{`
      .docs-config .docs-state { font-size: 13px; margin-bottom: 8px; }
      .docs-config .docs-state th { color: #8a97a3; font-weight: 600; padding: 3px 16px 3px 0; text-align: left; vertical-align: top; }
      .docs-config .docs-good { color: #237804; font-weight: 600; }
      .docs-config .docs-bad { color: #b02a37; font-weight: 600; }
      .docs-config .docs-browser { border: 1px solid #e9edf2; border-radius: 6px; max-width: 560px; }
      .docs-config .db-where { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #f0f2f5; font-family: monospace; font-size: 12px; }
      .docs-config .db-where button { border: 0; background: none; cursor: pointer; padding: 0 4px; }
      .docs-config .docs-browser ul { list-style: none; margin: 0; padding: 4px 0; max-height: 220px; overflow-y: auto; }
      .docs-config .docs-browser li button { border: 0; background: none; cursor: pointer; padding: 3px 12px; width: 100%; text-align: left; font-size: 13px; }
      .docs-config .docs-browser li button:hover { background: #f5f8fa; }
      .docs-config .docs-browser li.grey-txt { padding: 3px 12px; font-size: 12px; }
      .docs-config .docs-choose { display: flex; gap: 8px; margin-top: 8px; max-width: 560px; }
      .docs-config .docs-types { border-collapse: collapse; font-size: 13px; }
      .docs-config .docs-types th { font-size: 11px; font-weight: 600; color: #555; text-align: left; padding: 4px 6px; border-bottom: 1px solid #e8e8e8; }
      .docs-config .docs-types td { padding: 4px 6px; border-bottom: 1px solid #f3f3f3; }
      .docs-config .docs-types td:nth-child(2) { width: 240px; }
      .docs-config .dt-flag { text-align: center; width: 120px; }
      .docs-config .dt-order { white-space: nowrap; }
      .docs-config .dt-order button, .docs-config .dt-remove { background: none; border: 0; padding: 2px 4px; cursor: pointer; color: #555; }
      .docs-config .dt-order button:disabled, .docs-config .dt-remove:disabled { color: #ccc; cursor: default; }
      .docs-config .dt-retired td:nth-child(2) input { color: #999; text-decoration: line-through; }
      .docs-config .dt-add { margin-top: 6px; background: none; border: 1px dashed #bbb; border-radius: 6px; padding: 2px 12px; color: #555; cursor: pointer; font-size: 13px; }
    `}</style>
  </div>
);

export default Documents;
