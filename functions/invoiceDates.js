import moment from 'moment';

/**
 * An invoice's date in Payments & Receipts, and the order they are listed in.
 *
 * Invoice has no invoice-date column of its own: createdAt IS its date (the
 * Climax migration writes the legacy invoice date there - see
 * functions/invoiceMigrationPlan on the backend).
 */
export const invoiceDate = (invoice) =>
  (invoice?.createdAt && moment(invoice.createdAt).isValid() ? moment(invoice.createdAt).format('DD-MM-YYYY') : '');

/** Oldest first - the order a party's invoices are settled in. Ties by id. */
export const byInvoiceDate = (list) =>
  [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const d = new Date(a?.createdAt || 0) - new Date(b?.createdAt || 0);
    return d !== 0 ? d : (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
