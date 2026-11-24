/**
 * WHICH SCREEN A VOUCHER BELONGS TO.
 *
 * Most vouchers are posted by another record - a Direct Job entry, a payment
 * or receipt, an invoice, an opening balance, an office voucher - and that
 * record keeps its own lines beside the voucher's: a Direct Job's
 * Direct_Job_Association rows, a receipt's knock-offs (Invoice_Transactions),
 * an invoice's charges. Changed or deleted on the Voucher screen, the voucher
 * stops saying what its record says - ADJ-P-113/27 is a Direct Job
 * adjustment's voucher (asked about 2026-11-13), and the Voucher List could
 * delete it outright, leaving the entry's 21 lines pointing at nothing.
 *
 * So the Voucher screen shows such a voucher, names the record it belongs to
 * with a way to open it, and leaves changing and deleting to that record's
 * own screen; the server refuses the Voucher screen's edit and delete for it
 * (routes/voucher /updateVoucher, /deleteBaseVoucher). A voucher with no
 * record behind it - one made on the Voucher screen, or migrated as one - is
 * the Voucher screen's own.
 *
 * @returns null, or { screen, label, open } - `open` is what the screen needs
 *          to open the record: { page, id }, or null when it cannot.
 */
const PAYMENT_TYPES = ['Job Payment', 'Job Reciept'];
const INVOICE_TYPES = ['SI', 'PI'];
const OPENING_TYPES = ['OP', 'OB', 'OI'];

async function voucherSource(voucher, db) {
  if (!voucher) return null;
  const v = voucher.get ? voucher.get({ plain: true }) : voucher;

  if (v.returnOfId) {
    return { screen: 'Payments & Receipts', label: 'a cheque return', open: { page: 'paymentReceipt', id: v.returnOfId } };
  }
  if (PAYMENT_TYPES.includes(v.type)) {
    return { screen: 'Payments & Receipts', label: `Payment / Receipt ${v.voucher_Id}`, open: { page: 'paymentReceipt', id: v.id } };
  }

  const line = await db.Direct_Job_Association.findOne({
    where: { Voucher_Id: v.id }, attributes: ['Direct_Job_Id'], raw: true,
  });
  if (line) {
    const entry = line.Direct_Job_Id
      ? await db.Direct_Job.findByPk(line.Direct_Job_Id, { attributes: ['id', 'Entry_No'], raw: true })
      : null;
    return {
      screen: 'Direct Job',
      label: entry ? `Direct Job ${entry.Entry_No}` : 'a Direct Job entry',
      open: entry ? { page: 'directJob', id: entry.id } : null,
    };
  }

  if (INVOICE_TYPES.includes(v.vType) || String(v.invoice_Voucher) === '1') {
    const invoice = /^\d+$/.test(String(v.invoice_Id || ''))
      ? await db.Invoice.findByPk(v.invoice_Id, { attributes: ['id', 'invoice_No'], raw: true })
      : null;
    return {
      screen: 'Invoices',
      label: invoice ? `Invoice ${invoice.invoice_No}` : 'an invoice',
      open: invoice ? { page: 'invoice', id: invoice.id, label: invoice.invoice_No } : null,
    };
  }

  if (OPENING_TYPES.includes(v.vType)) {
    return { screen: 'Opening Balances', label: 'an opening balance', open: { page: 'openingBalance', id: v.id }, opening: true };
  }

  const office = await db.Office_Vouchers.findOne({ where: { VoucherId: v.id }, attributes: ['id'], raw: true });
  if (office) return { screen: 'Office Vouchers', label: 'an office voucher', open: { page: 'officeVoucher', id: office.id } };

  return null;
}

/** Why the Voucher screen may not change or delete it, or null when it may. */
const refusalFor = (voucher, source, verb) => (source
  ? `${voucher.voucher_Id} was made by ${source.label} (${source.screen}). ${verb} it there - here, the voucher `
    + 'would stop matching the record it came from.'
  : null);

module.exports = { voucherSource, refusalFor };
