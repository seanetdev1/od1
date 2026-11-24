import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Image, Progress, Spin, Select, Button, Tag, Input, notification,
} from 'antd';
import {
  FilePdfOutlined, FileImageOutlined, FileWordOutlined, FileExcelOutlined, FileOutlined,
  EyeOutlined, DownloadOutlined, DeleteOutlined, CloseOutlined, PlusOutlined, PaperClipOutlined,
  EditOutlined, CheckOutlined,
} from '@ant-design/icons';
import RowAction from 'Components/Shared/RowAction';
import ActionTip from 'Components/Shared/ActionTip';
import {
  listDocuments, uploadDocument, documentUrl, deleteDocument, renameDocument,
} from 'apis/documents';
import {
  DEFAULT_LIMITS, checkFile, fileKind, formatSize, reasonOf,
} from 'functions/documentFiles';
import { whenOf } from 'functions/auditStamp';

/**
 * THE DOCUMENTS ON ONE RECORD - scans on a job, a voucher, an invoice, a
 * Direct Job (the user's requests, 2026-11-13). Shown in the paperclip's
 * window (./DocumentsButton).
 *
 *   <DocumentsPanel entity='SE_Job' recordId={job.id} />
 *
 * ADDING: pick what the document is - its type, from the list Configuration
 * keeps - then +paperclip to choose the files. A NAME may be typed first: a
 * scanner calls its files scan020.pdf, and the name says what is inside -
 * "Invoice JI-123/27". Several files at once are numbered under it. A name can
 * be given or changed later too (the pencil). Each file is sent on its own,
 * with its own progress, so one refused - too big, the wrong kind, already
 * attached - is said beside its name and the others still go.
 *
 * EACH DOCUMENT has two ways to open it (the user's request): the eye, where
 * it can be seen without downloading - a PDF in a new tab, in the browser's
 * own viewer; an image here, in a viewer over the page that zooms and rotates
 * - and download, always. Word, Excel and TIFF (which browsers cannot draw)
 * have only download. Removing one is there only for whoever has the
 * record's Delete right.
 *
 * AN INVOICE also lists the documents on the job it was raised on whose type
 * is marked for invoices - an invoice scanned onto the job - saying so. They
 * are opened from here, but removed only on the job.
 */

const ICONS = {
  pdf: [FilePdfOutlined, '#c0392b'],
  image: [FileImageOutlined, '#438995'],
  word: [FileWordOutlined, '#2b579a'],
  excel: [FileExcelOutlined, '#217346'],
  file: [FileOutlined, '#6b7684'],
};

export const isSaved = (id) => /^\d+$/.test(String(id ?? ''));

export default function DocumentsPanel({ entity, recordId, onCount }) {
  const saved = isSaved(recordId);
  const [docs, setDocs] = useState([]);
  const [rights, setRights] = useState({ add: false, delete: false });
  const [types, setTypes] = useState([]);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [ready, setReady] = useState(true);
  const [typeId, setTypeId] = useState();
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(null); // { id, value, saving }
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState([]); // { key, name, type, progress, error }
  const [image, setImage] = useState(null);   // { src, name }

  // The record on screen now: an upload finishing after the screen moved to
  // another record must not land in that one's list.
  const current = useRef(`${entity}:${recordId}`);
  current.current = `${entity}:${recordId}`;
  const latest = useRef(0);
  const here = { entity, recordId };

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    if (!saved) return;
    setLoading(true);
    try {
      const data = await listDocuments(entity, recordId);
      if (ticket !== latest.current) return;
      setDocs(data.result || []);
      setRights(data.rights || { add: false, delete: false });
      setTypes(data.types || []);
      setLimits(data.limits || DEFAULT_LIMITS);
      setReady(data.ready !== false);
      setLoadError('');
      setLoaded(true);
    } catch (err) {
      if (ticket === latest.current) setLoadError(reasonOf(err, 'The documents could not be loaded.'));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [entity, recordId, saved]);

  useEffect(() => {
    setDocs([]);
    setSending([]);
    setLoadError('');
    setLoaded(false);
    load();
  }, [load]);

  // Only once the list is in: an empty list while it loads is not "none".
  useEffect(() => { if (loaded) onCount?.(docs.length); }, [docs.length, loaded, onCount]);

  const typeName = types.find((t) => t.id === typeId)?.name;

  /* A file chosen: `batch` is every file chosen with it. The name typed goes
     on it - numbered when there are several - and is cleared once the last
     has gone, so the next file is not given it by mistake. */
  const send = (file, batch = [file]) => {
    const index = Math.max(0, batch.indexOf(file));
    const named = title.trim() ? (batch.length > 1 ? `${title.trim()} (${index + 1})` : title.trim()) : undefined;
    if (index === batch.length - 1) setTitle('');
    const key = `${file.uid || file.name}-${Date.now()}`;
    const problem = checkFile(file, limits);
    if (problem) {
      setSending((s) => [...s, { key, name: file.name, error: problem }]);
      return;
    }
    const sentFor = current.current;
    const patch = (p) => setSending((s) => s.map((x) => (x.key === key ? { ...x, ...p } : x)));
    setSending((s) => [...s, { key, name: named || file.name, type: typeName, progress: 0 }]);
    uploadDocument(entity, recordId, typeId, file, (progress) => patch({ progress }), named)
      .then((doc) => {
        if (sentFor !== current.current) return;
        setSending((s) => s.filter((x) => x.key !== key));
        setDocs((d) => [doc, ...d.filter((x) => x.id !== doc.id)]);
      })
      .catch((err) => {
        if (sentFor !== current.current) return;
        patch({ progress: undefined, error: reasonOf(err, `${file.name} could not be attached. Check the connection and try again.`) });
      });
  };

  const failed = (what, err) => notification.error({
    message: what, description: reasonOf(err, 'Check the connection and try again.'), duration: 6,
  });

  const urlOf = (doc, download) => documentUrl(doc.id, { download, from: doc.from ? here : undefined });

  const download = async (doc) => {
    try {
      const url = await urlOf(doc, true);
      // The server sends it as a download, so the page stays where it is.
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      failed(`${doc.name} could not be downloaded`, err);
    }
  };

  const view = async (doc) => {
    if (doc.view === 'pdf') {
      // Opened NOW, while the click still counts as one - a tab opened after
      // waiting for the link is what pop-up blockers stop - and pointed at the
      // file once the link is in.
      const tab = window.open('', '_blank');
      try {
        if (tab) {
          tab.opener = null;
          tab.document.title = doc.name;
          tab.document.body.textContent = `Opening ${doc.name}...`;
        }
      } catch (_) { /* a tab we cannot write in still opens the file */ }
      try {
        const url = await urlOf(doc);
        if (tab) tab.location.href = url;
        else window.open(url, '_blank', 'noopener');
      } catch (err) {
        tab?.close();
        failed(`${doc.name} could not be opened`, err);
      }
      return;
    }
    try {
      setImage({ src: await urlOf(doc), name: doc.name });
    } catch (err) {
      failed(`${doc.name} could not be opened`, err);
    }
  };

  const rename = async () => {
    const { id, value } = editing;
    setEditing((e) => ({ ...e, saving: true }));
    try {
      const doc = await renameDocument(id, value);
      setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...doc } : x)));
      setEditing(null);
    } catch (err) {
      setEditing((e) => (e ? { ...e, saving: false } : e));
      failed('The name was not saved', err);
    }
  };

  const remove = async (doc) => {
    try {
      await deleteDocument(doc.id);
      setDocs((d) => d.filter((x) => x.id !== doc.id));
    } catch (err) {
      failed(`${doc.name} was not removed`, err);
    }
  };

  if (!saved) {
    return <div className='documents-panel grey-txt' data-testid='documents-unsaved'>
      Save it first - documents are attached to a saved record.
    </div>;
  }

  const canAdd = loaded && ready && rights.add;
  const mb = Math.round(limits.maxBytes / 1024 / 1024);
  const addTip = !canAdd ? 'Adding documents is not open to you here'
    : typeId ? `Add ${typeName} documents - PDF, images, Word or Excel, up to ${mb} MB each`
      : 'Pick the document type first';
  const note = !loaded ? null
    : !ready ? 'Documents are not set up on this install yet: the folder they are kept in is chosen in Configuration > Documents.'
      : !rights.add ? 'You can open these, but adding them needs the right to edit this record.'
        : !typeId ? 'Pick the document type, then + to choose the files.'
          : null;

  return (
    <div className='documents-panel'>
      <div className='documents-add'>
        <Select
          placeholder='Document type'
          aria-label='Document type'
          value={typeId}
          onChange={setTypeId}
          disabled={!canAdd}
          options={types.map((t) => ({ value: t.id, label: t.name }))}
          style={{ flex: 1, minWidth: 200 }}
          showSearch
          optionFilterProp='label'
        />
        <Input
          placeholder='Name (optional) - e.g. Invoice JI-123/27'
          aria-label='Document name'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!canAdd}
          maxLength={200}
          style={{ flex: 1.4, minWidth: 200 }}
        />
        <Upload
          multiple
          showUploadList={false}
          accept={limits.extensions.join(',')}
          disabled={!canAdd || !typeId}
          beforeUpload={(file, batch) => { send(file, batch); return false; }}
        >
          <ActionTip tip={addTip}>
            <Button type='primary' disabled={!canAdd || !typeId} aria-label='Add documents' className='documents-add-btn'>
              <PlusOutlined /><PaperClipOutlined />
            </Button>
          </ActionTip>
        </Upload>
      </div>
      {note && <div className='grey-txt documents-note'>{note}</div>}

      {sending.length > 0 && (
        <ul className='documents-sending'>
          {sending.map((s) => (
            <li key={s.key} className={s.error ? 'is-error' : ''}>
              <div className='ds-name'>{s.name}{s.type ? ` - ${s.type}` : ''}</div>
              {s.error
                ? <div className='ds-error' role='alert'>
                  <span>{s.error}</span>
                  <button type='button' aria-label={`Dismiss ${s.name}`}
                    onClick={() => setSending((x) => x.filter((y) => y.key !== s.key))}><CloseOutlined /></button>
                </div>
                : <Progress percent={Math.round((s.progress || 0) * 100)} size='small' status='active' />}
            </li>
          ))}
        </ul>
      )}

      {loadError && <div className='ds-error mt-2' role='alert'>{loadError}</div>}
      {loading && !docs.length && <div className='mt-3 text-center'><Spin size='small' /></div>}
      {loaded && !loadError && !docs.length && <div className='grey-txt mt-3'>No documents attached yet.</div>}

      {docs.length > 0 && (
        <ul className='documents-list' aria-label='Attached documents'>
          {docs.map((doc) => {
            const [Icon, color] = ICONS[fileKind(doc.fileName || doc.name)];
            const viewable = doc.view === 'pdf' || doc.view === 'image';
            const renaming = editing?.id === doc.id;
            return (
              <li key={doc.id}>
                <Icon className='dl-icon' style={{ color }} />
                <div className='dl-body'>
                  {renaming
                    ? (
                      <Input size='small' autoFocus value={editing.value} maxLength={200}
                        aria-label={`New name for ${doc.name}`} placeholder={doc.fileName}
                        disabled={editing.saving}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onPressEnter={rename}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} />
                    )
                    : <button type='button' className='dl-name' onClick={() => (viewable ? view(doc) : download(doc))}>{doc.name}</button>}
                  <div className='dl-meta grey-txt'>
                    {doc.type && <Tag className='dl-type'>{doc.type}</Tag>}
                    {[doc.title && doc.fileName, formatSize(doc.size), doc.uploadedBy, whenOf(doc.uploadedAt), doc.from && `on ${doc.from.label}`]
                      .filter(Boolean).join('  ·  ')}
                  </div>
                </div>
                <div className='dl-actions'>
                  {renaming && <>
                    <RowAction Icon={CheckOutlined} label='Save the name' kind='primary' disabled={editing.saving} onClick={rename} />
                    <RowAction Icon={CloseOutlined} label='Cancel' onClick={() => setEditing(null)} />
                  </>}
                  {!renaming && rights.add && !doc.from && (
                    <RowAction Icon={EditOutlined} label='Rename'
                      title='Give it a name that says what is inside - empty, it shows the file name'
                      onClick={() => setEditing({ id: doc.id, value: doc.title || '' })} />
                  )}
                  {viewable && (
                    <RowAction Icon={EyeOutlined} label='View' onClick={() => view(doc)}
                      title={doc.view === 'pdf' ? 'Opens in a new tab' : undefined} />
                  )}
                  <RowAction Icon={DownloadOutlined} label='Download' onClick={() => download(doc)} />
                  {rights.delete && !doc.from && (
                    <RowAction Icon={DeleteOutlined} label='Remove' kind='danger'
                      confirm={{ what: 'document', name: doc.name, okText: 'Remove' }}
                      onClick={() => remove(doc)} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Odyssey's own image viewer: zoom, rotate, Escape to close. */}
      {image && (
        <Image
          style={{ display: 'none' }}
          src={image.src}
          alt={image.name}
          preview={{ visible: true, src: image.src, onVisibleChange: (v) => { if (!v) setImage(null); } }}
        />
      )}

      <style jsx global>{`
        .documents-add { display: flex; gap: 8px; align-items: center; }
        .documents-add .ant-upload { display: inline-flex; }
        .documents-add-btn { display: inline-flex; align-items: center; gap: 2px; padding: 4px 12px; }
        .documents-note { font-size: 12px; margin-top: 6px; }
        .documents-sending, .documents-list { list-style: none; margin: 12px 0 0; padding: 0; }
        .documents-sending li { padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
        .documents-sending .ds-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ds-error { display: flex; gap: 8px; align-items: flex-start; color: #a3282a; font-size: 12px; }
        .ds-error span { flex: 1; }
        .ds-error button { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0 2px; }
        .documents-list { max-height: 55vh; overflow-y: auto; }
        .documents-list li {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 0; border-bottom: 1px solid #f0f0f0;
        }
        .documents-list .dl-icon { font-size: 22px; flex: 0 0 auto; }
        .documents-list .dl-body { flex: 1; min-width: 0; }
        .documents-list .dl-name {
          display: block; max-width: 100%; padding: 0; border: 0; background: transparent;
          color: #1f2937; text-align: left; cursor: pointer;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .documents-list .dl-name:hover { color: #2f6b74; text-decoration: underline; }
        .documents-list .dl-meta { font-size: 11px; }
        .documents-list .dl-type { font-size: 10px; line-height: 16px; padding: 0 5px; margin-right: 6px; }
        .documents-list .dl-actions { flex: 0 0 auto; display: flex; gap: 2px; }
      `}</style>
    </div>
  );
}
