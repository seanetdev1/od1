import React, { useEffect, useState } from 'react';
import { Modal, Input, Spin, Tag } from 'antd';
import openNotification from 'Components/Shared/Notification';
import { voidAwbs } from 'apis/awbStock';

// Mark air waybill numbers unusable.
//
// WHY THIS IS A MODAL AND NOT A CONFIRM BOX. Every other destructive action on
// this screen answers a yes/no question, and a PopConfirm is the right shape
// for those. Voiding asks a second thing that is the whole point of doing it:
// WHY. The register keeps a voided number precisely so it can answer the
// airline six months later, and "voided" on its own answers nothing - so the
// reason is required, and a box that can require it is a modal.
//
// The reason is a free text, with the four that cover almost every real case
// offered as one-click chips. They fill the box rather than replace it, so a
// misprint that needs explaining can still be explained.
const REASONS = ['Torn / damaged', 'Misprinted', 'Lost in transit', 'Returned to airline'];

const VoidModal = ({ open, onClose, onSaved, rows, employeeId }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const list = rows || [];

  // Cleared on every open. A reason left over from the last void would be
  // attached to a different set of numbers, and it would look deliberate.
  useEffect(() => {
    if (open) { setReason(''); }
  }, [open]);

  const close = () => {
    if (saving) return;
    onClose();
  };

  const submit = async () => {
    if (!list.length) return openNotification('Error', 'No numbers selected.', 'red');
    if (!reason.trim()) {
      return openNotification('Error', 'Say why these are being voided - that note is the record.', 'red');
    }

    setSaving(true);
    try {
      const res = await voidAwbs({ ids: list.map((r) => r.id), reason: reason.trim(), employeeId });
      if (res.status !== 'success') {
        openNotification('Not voided', res.result || 'Could not void these.', 'red');
        return;
      }
      const { voided, alreadyVoided, from, to } = res.result;
      openNotification(
        voided ? 'Voided' : 'Nothing to do',
        (voided
          ? voided === 1
            ? `${from} is voided and can no longer be used.`
            : `${voided} numbers voided, ${from} to ${to}.`
          : 'Those numbers were already voided.') +
          (alreadyVoided && voided ? ` ${alreadyVoided} were already voided.` : ''),
        'green'
      );
      onSaved();
      onClose();
    } catch (e) {
      openNotification('Not voided', e?.response?.data?.result || 'Could not void these.', 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onCancel={close} maskClosable={false} width={560}
      title={list.length === 1 ? `Void ${list[0].formatted}` : `Void ${list.length} AWB numbers`}
      okText={saving ? 'Voiding…' : 'Void'}
      okButtonProps={{ danger: true, disabled: saving || !list.length }}
      cancelButtonProps={{ disabled: saving }}
      onOk={submit}
    >
      <Spin spinning={saving}>
        <div className='awb-void-list'>
          {/* Named, not counted. Voiding is the one action here that cannot be
              worked around by re-registering the number, so the operator gets
              to read the numbers back before agreeing to it. */}
          {list.slice(0, 24).map((r) => (
            <Tag key={r.id} className='mono'>{r.formatted}</Tag>
          ))}
          {list.length > 24 && <span className='grey-txt'>and {list.length - 24} more</span>}
        </div>

        <div className='mb-1'>Why? *</div>
        <Input.TextArea rows={2} value={reason} maxLength={200}
          placeholder='Torn on arrival, misprinted by the airline, lost…'
          onChange={(e) => setReason(e.target.value)} />
        <div className='mt-2'>
          {REASONS.map((r) => (
            <Tag key={r} className='awb-reason-chip' onClick={() => setReason(r)}>{r}</Tag>
          ))}
        </div>

        <div className='awb-void-note mt-3'>
          A voided number <b>stays on the register</b> — the airline issued that serial and
          will ask what became of it. It simply stops being usable: it disappears from the
          flight screen’s AWB list, and it can no longer be assigned, taken back or removed.
          It stays with the master agent it is with now. Restore it from the list if the
          document turns out to be fine after all.
        </div>
      </Spin>

      <style jsx global>{`
        .awb-void-list { margin-bottom: 14px; }
        .awb-void-list .mono { font-variant-numeric: tabular-nums; }
        .awb-reason-chip { cursor: pointer; }
        .awb-void-note {
          font-size: 12px;
          line-height: 1.5;
          padding: 8px 10px;
          background: #fff7f6;
          border: 1px solid #ffd7d0;
          border-radius: 4px;
        }
      `}</style>
    </Modal>
  );
};

export default VoidModal;
