import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import ActionTip from 'Components/Shared/ActionTip';
import { listDocuments } from 'apis/documents';
import DocumentsPanel, { isSaved } from './DocumentsPanel';

/**
 * A RECORD'S DOCUMENTS BEHIND A PAPERCLIP (the user's request, 2026-11-13):
 * the paperclip and how many are attached; pressed, a window with them, and
 * +paperclip in it to add more.
 *
 * Two ways onto a screen, the same window behind both:
 *
 *   <DocumentsButton entity='Vouchers' recordId={id} title='Voucher BPV-12/26' />
 *       a button of its own, for a screen that draws its own buttons. Takes
 *       `className` / `style` to look like the buttons beside it.
 *
 *   const docs = useDocuments({ entity: 'Aviation_Job', recordId, title });
 *   usePageActions({ ..., extras: [docs.extra] }, [..., docs.count]);
 *   return <>...{docs.modal}</>;
 *       for a screen whose actions are in the page's toolbar
 *       (Components/Shared/PageActions) - the paperclip goes there, with its
 *       number. `docs.count` in the deps, so the number keeps up.
 *
 * The number is asked for when the record opens, so it shows before the
 * window is opened. Off until the record is saved: there is nothing to attach
 * to yet.
 */

export const PaperclipCount = ({ count }) => (
  <span className='paperclip-count'>
    <PaperClipOutlined />
    {count != null && <span className='pc-n'>{count}</span>}
    <style jsx global>{`
      .paperclip-count { display: inline-flex; align-items: center; gap: 3px; }
      .paperclip-count .pc-n { font-size: 12px; font-weight: 600; line-height: 1; }
    `}</style>
  </span>
);

export function DocumentsModal({ open, onClose, entity, recordId, title, onCount }) {
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={680} destroyOnClose
      title={title || 'Documents'}>
      <DocumentsPanel entity={entity} recordId={recordId} onCount={onCount} />
    </Modal>
  );
}

export function useDocuments({ entity, recordId, title }) {
  const saved = isSaved(recordId);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(null);

  useEffect(() => {
    let alive = true;
    setCount(null);
    if (saved) {
      // Never in the way of the screen it is on: whatever goes wrong asking,
      // the paperclip just shows no number.
      Promise.resolve()
        .then(() => listDocuments(entity, recordId))
        .then((data) => { if (alive) setCount((data?.result || []).length); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [entity, recordId, saved]);

  const show = useCallback(() => setOpen(true), []);
  const label = count != null ? `Documents (${count})` : 'Documents';
  const tip = !saved ? 'Save it first - documents are attached to a saved record'
    : count ? `${count} document${count === 1 ? '' : 's'} attached` : 'Documents - none attached yet';

  return {
    count,
    saved,
    label,
    tip,
    open: show,
    extra: { key: 'documents', label, title: tip, disabled: !saved, onClick: show, glyph: <PaperclipCount count={count} /> },
    modal: (
      <DocumentsModal open={open} onClose={() => setOpen(false)} entity={entity} recordId={recordId}
        title={title} onCount={setCount} />
    ),
  };
}

export default function DocumentsButton({ entity, recordId, title, className, style }) {
  const docs = useDocuments({ entity, recordId, title });
  return (
    <>
      <ActionTip tip={docs.tip}>
        <button type='button' className={className || 'documents-btn'} style={style}
          disabled={!docs.saved} aria-label={docs.label} onClick={docs.open}>
          <PaperclipCount count={docs.count} />
        </button>
      </ActionTip>
      {docs.modal}
      <style jsx global>{`
        .documents-btn {
          display: inline-flex; align-items: center; justify-content: center;
          height: 32px; min-width: 44px; padding: 0 10px;
          border: 1px solid #d0d7de; border-radius: 6px; background: #fff;
          color: #2f6b74; font-size: 15px; cursor: pointer;
        }
        .documents-btn:hover { background: #e8f1f2; }
        .documents-btn:disabled { color: #c3cad2; background: #fff; cursor: not-allowed; }
      `}</style>
    </>
  );
}
