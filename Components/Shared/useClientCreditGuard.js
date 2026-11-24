import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Input } from 'antd';
import openNotification from 'Components/Shared/Notification';
import {
  loadCreditBlocks, isListedBlocked, markBlockedOptions, checkClientPick, requestUnblock, formatPkr,
} from 'functions/creditBlocks';

/**
 * A job screen's client box under credit control - see functions/creditBlocks.
 *
 *   const credit = useClientCreditGuard();
 *   options = credit.mark(options)
 *   credit.pick(clientId, { allowed: () => ..., refused: () => ... })
 *   {credit.modal}
 *
 * `pick` calls `allowed` at once - in the same tick - for any client the list
 * does not have, so the screen behaves exactly as before for every party that
 * is not blocked. A listed one is asked about on the server first: let
 * through, `allowed`; still blocked, `refused`, and the user is told why and
 * offered to ask for approval.
 */
const useClientCreditGuard = () => {
  const [state, setState] = useState(null);
  const [blocked, setBlocked] = useState(null);   // the block being explained
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    loadCreditBlocks().then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, []);

  const mark = useCallback((options, keys) => markBlockedOptions(options, state, keys), [state]);

  const pick = useCallback((clientId, { allowed = () => {}, refused = () => {} } = {}) => {
    if (!isListedBlocked(state, clientId) || state?.approver) { allowed(); return; }
    checkClientPick(clientId)
      .then((r) => {
        if (!r?.block || r.approver) {
          // Paid since last night - the server lifted it. The list catches up.
          loadCreditBlocks({ fresh: true }).then(setState);
          allowed();
          return;
        }
        refused();
        setNote('');
        setBlocked({ ...r.block, requested: r.requested });
      })
      // Could not ask: let the pick stand - the save is checked again.
      .catch(() => allowed());
  }, [state]);

  const ask = async () => {
    setAsking(true);
    try {
      const r = await requestUnblock(blocked.clientId, note.trim());
      if (r.notBlocked) openNotification('Not blocked', `${blocked.name} is no longer over its limit - pick it again.`, 'green');
      else openNotification('Approval asked', r.already
        ? `You had already asked about ${blocked.name}. Your note was added.`
        : `The approvers have been told. You will get a notification when ${blocked.name} is decided.`, 'green');
      loadCreditBlocks({ fresh: true }).then(setState);
      setBlocked(null);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not ask for approval.', 'red');
    } finally {
      setAsking(false);
    }
  };

  const modal = (
    <Modal
      open={Boolean(blocked)}
      title='Over the credit limit'
      okText={blocked?.requested ? 'Ask again' : 'Ask for approval'}
      cancelText='Close'
      confirmLoading={asking}
      onOk={ask}
      onCancel={() => setBlocked(null)}
      destroyOnClose
    >
      {blocked && (
        <>
          <p style={{ marginBottom: 8 }}>
            <b>{blocked.name}</b>{blocked.code ? ` (${blocked.code})` : ''} owes <b>PKR {formatPkr(blocked.balancePkr)}</b> against
            a credit limit of <b>PKR {formatPkr(blocked.limitPkr)}</b>, so it cannot be the client on a new job until that is approved.
          </p>
          {blocked.requested && (
            <p style={{ color: '#7a5b00', background: '#fffbe6', border: '1px solid #ffe58f', padding: '4px 8px', borderRadius: 4 }}>
              You have already asked - it is waiting for an approver.
            </p>
          )}
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>A note for the approver (optional)</div>
          <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder='e.g. the shipment that is waiting, a payment promised' />
        </>
      )}
    </Modal>
  );

  return { state, mark, pick, modal };
};

export default useClientCreditGuard;
