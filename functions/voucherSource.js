/**
 * The record a voucher belongs to, when another screen made it - the server
 * says which (GET /voucher/getVoucherById's `source`, functions/voucherSource
 * there): a Direct Job entry, a payment or receipt, an invoice, an opening
 * balance, an office voucher. The Voucher screen shows such a voucher but
 * leaves changing and deleting it to that screen; this is how it opens it.
 *
 * @param open  the server's { page, id, label? }
 * @returns { tab, path } - the tab to add and where to go - or null
 */
const PAGES = {
  directJob: (id) => ({ tab: { label: 'Edit Direct Job E / R', key: '3-15', id }, path: `/accounts/directJob/${id}` }),
  paymentReceipt: (id) => ({ tab: { label: 'Payment / Receipt', key: '3-4', id }, path: `/accounts/paymentReceipt/${id}` }),
  invoice: (id) => ({ tab: { label: 'Invoice details', key: '3-17', id: `${id}` }, path: `/reports/invoice/${id}` }),
  openingBalance: (id) => ({ tab: { label: 'Opening Balance', key: '3-10', id }, path: `/accounts/openingBalance/${id}` }),
  officeVoucher: (id) => ({ tab: { label: 'Office Voucher', key: '3-8', id }, path: `/accounts/officeVouchers/${id}` }),
};

export function sourceLink(open) {
  if (!open || !PAGES[open.page] || open.id == null) return null;
  return PAGES[open.page](open.id);
}
