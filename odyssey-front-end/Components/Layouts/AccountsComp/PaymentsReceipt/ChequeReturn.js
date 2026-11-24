import React, { useEffect, useState } from 'react';
import { Modal, DatePicker, Spin } from 'antd';
import moment from 'moment';
import Cookies from 'js-cookie';
import { useSelector } from 'react-redux';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { returnPreview } from 'functions/chequeReturn';

const commas = (a) => parseFloat(a || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* CHEQUE RETURN - the toolbar's Cheque Return on an open bank payment or
 * receipt (the user's request, 2026-10-13). Shows the CR it will post - the
 * voucher's lines, each on the other side - and the day the cheque came back.
 * Approve & Save posts it: routes/voucher /chequeReturn, which also reopens the
 * invoices the voucher settled. */
const ChequeReturn = ({ open, voucherId, onClose, onDone }) => {
  const fiscalYearId = useSelector((s) => s.fiscalYear.value);
  const [voucher, setVoucher] = useState(null);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(moment());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !voucherId) return;
    setDate(moment());
    setVoucher(null);
    setLoading(true);
    axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/getVoucherById`, { headers: { id: voucherId } })
      .then((res) => setVoucher(res.data.result))
      .catch(() => openNotification('Error', 'Could not load this voucher.', 'red'))
      .finally(() => setLoading(false));
  }, [open, voucherId]);

  const lines = returnPreview(voucher?.Voucher_Heads);
  const total = lines.reduce((sum, l) => sum + l.debit, 0);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/chequeReturn`, {
        voucherId, date: date.toISOString(), fiscalYearId, employeeId: Cookies.get('loginId'),
      });
      openNotification('Success', `Cheque returned - ${res.data.result?.voucher_Id}`, 'green');
      onDone?.();
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not return this cheque.', 'red');
    } finally {
      setSaving(false);
    }
  };

  const cell = { padding: '8px 10px', border: '1px solid #e5e7eb' };
  return (
    <Modal title='Cheque Return' open={open} onCancel={onClose} footer={false} maskClosable={false} width={'70%'} centered>
      {loading || !voucher ? <div className='text-center p-4'><Spin /></div> : (
        <>
          <div className='d-flex flex-wrap' style={{ gap: 24, marginBottom: 12, fontSize: 13 }}>
            <span>Voucher: <b>{voucher.voucher_Id}</b></span>
            <span>Party: <b>{voucher.partyName}</b></span>
            <span>Cheque: <b>{voucher.chequeNo || '-'}</b>{voucher.chequeDate ? ` of ${moment(voucher.chequeDate).format('DD-MM-YYYY')}` : ''}</span>
            <span>Currency: <b>{voucher.currency}</b> @ <b>{voucher.exRate}</b></span>
          </div>
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <span style={{ marginRight: 8 }}>Returned on</span>
            <DatePicker allowClear={false} value={date} onChange={(d) => d && setDate(d)} format='DD-MM-YYYY' />
          </div>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead style={{ backgroundColor: '#f0f2f5' }}>
              <tr>
                <th style={cell}>Account</th>
                <th style={cell}>Account Type</th>
                <th style={{ ...cell, textAlign: 'right' }}>Debit</th>
                <th style={{ ...cell, textAlign: 'right' }}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={cell}>{l.account}</td>
                  <td style={cell}>{l.accountType}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{l.debit ? commas(l.debit) : ''}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{l.credit ? commas(l.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#6b7684', marginTop: 10, marginBottom: 0 }}>
            Posts a cheque return (CR) of {commas(total)} {voucher.currency} reversing {voucher.voucher_Id}, and reopens
            the invoices it settled. {voucher.voucher_Id} can no longer be edited or deleted afterwards.
          </p>
          <div className='d-flex justify-content-end align-items-center' style={{ gap: 10, marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f2f5' }}>
            <button type='button' disabled={saving} onClick={onClose}
              style={{ background: 'none', border: 0, color: '#6b7684', fontSize: 13, padding: '6px 12px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type='button' className={saving ? 'btn-custom-disabled px-4' : 'btn-custom px-4'} disabled={saving || !lines.length} onClick={save}>
              {saving ? 'Saving…' : 'Approve & Save'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
};

export default React.memo(ChequeReturn);
