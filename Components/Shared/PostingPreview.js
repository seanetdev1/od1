import React from 'react';
import { Modal } from 'antd';

/**
 * "Proceed with transaction?" - every account a voucher posts to, debit and
 * credit, before it is saved. The same table Payments & Receipts shows on
 * Make Transaction (AccountsComp/PaymentsReceipt/BillComp), for the Voucher
 * screen (the user's request, 2026-10-26).
 *
 *   rows: [{ accountType, accountName, debit, credit, type }]
 */
const commas = (a) => (a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));

const cell = { width: '2%', paddingLeft: '5px', borderLeft: '1px solid #d7d7d7', padding: '10px 10px' };
const lastCell = { ...cell, borderRight: '1px solid #d7d7d7' };

const PostingPreview = ({ open, rows = [], currency, exRate, submitting = false, onCancel, onApprove }) => (
  <Modal title='Proceed with transaction?' open={open} onCancel={onCancel} footer={false} maskClosable={false} width='80%' centered destroyOnClose>
    <span style={{ float: 'right' }}>Ex Rate: <b>{exRate}</b> Currency: <b>{currency}</b></span>
    <table style={{ width: '100%' }}>
      <thead style={{ backgroundColor: '#d7d7d7' }}>
        <tr style={{ borderBottom: '1px solid #d7d7d7', padding: '10px 0px' }}>
          <th style={cell}>Account Type</th>
          <th style={cell}>Account Name</th>
          <th style={cell}>Debit</th>
          <th style={lastCell}>Credit</th>
          <th style={lastCell}>Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #d7d7d7', padding: '10px 0px' }}>
            <td style={cell}>{x.accountType}</td>
            <td style={cell}>{x.accountName}</td>
            <td style={cell}>{commas(x.debit)}</td>
            <td style={lastCell}>{commas(x.credit)}</td>
            <td style={lastCell}>{x.type}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className='posting-approve-row'>
      <button type='button' className='posting-approve-cancel' disabled={submitting} onClick={onCancel}>Cancel</button>
      <button type='button' className={submitting ? 'btn-custom-disabled px-4' : 'btn-custom px-4'} disabled={submitting} onClick={onApprove}>
        {submitting ? 'Saving…' : 'Approve & Save'}
      </button>
    </div>
    <style jsx global>{`
      .posting-approve-row {
        display: flex; justify-content: flex-end; align-items: center; gap: 10px;
        margin-top: 18px; padding-top: 14px; border-top: 1px solid #f0f2f5;
      }
      .posting-approve-cancel {
        background: none; border: 0; color: #6b7684; font-size: 13px;
        padding: 6px 12px; cursor: pointer;
      }
      .posting-approve-cancel:hover:not(:disabled) { color: #1f2937; }
      .posting-approve-cancel:disabled { color: #c3cad2; cursor: not-allowed; }
    `}</style>
  </Modal>
);

/** A voucher's lines (as save builds them) -> the table's rows. */
export const postingRows = (heads = [], accountName) => heads.map((h) => {
  const amount = parseFloat(h.amount) || 0;
  return {
    accountType: h.accountType,
    accountName: accountName(h.ChildAccountId),
    debit: h.type === 'debit' ? amount : 0,
    credit: h.type === 'credit' ? amount : 0,
    type: h.type,
  };
});

export default PostingPreview;
