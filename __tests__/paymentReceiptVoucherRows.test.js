/** Payments & Receipts' voucher rows - functions/paymentReceiptVoucherRows. */
import { voucherRows } from '../functions/paymentReceiptVoucherRows';

test('each invoice carries what this voucher knocked off it', () => {
  const [row] = voucherRows([{
    id: 1, voucher_Id: 'V-1', partyName: 'P', partyType: 'client', vType: 'BRV', createdAt: '2026-10-01', currency: 'PKR', partyId: '9',
    invoice: [{ id: 5 }, { id: 6 }],
    Invoice_Transactions: [{ InvoiceId: 5, amount: '100' }, { InvoiceId: 5, amount: '50' }, { InvoiceId: 6, amount: '20' }],
    Voucher_Heads: [{ accountType: 'partyAccount', ChildAccountId: 3, amount: '170' }, { accountType: 'Bank', ChildAccountId: 4, amount: '170' }],
    clientAssociation: { ChildAccountId: 3 },
  }]);
  expect(row).toMatchObject({ id: 1, voucherNo: 'V-1', name: 'P', type: 'BRV', amount: 170, partyId: '9' });
  expect(row.x.invoice.map((i) => [i.receiving, i.constReceiving])).toEqual([[150, 150], [20, 20]]);
});

test('nothing in, nothing out', () => {
  expect(voucherRows(undefined)).toEqual([]);
});
