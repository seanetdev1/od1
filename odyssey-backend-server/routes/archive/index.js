// THE ARCHIVE - read-only screens over CargoLinkers' old Climax books.
//
// Every route names its book (`:book`, a database listed in ARCHIVE_BOOKS -
// functions/archive/books.js) and only reads. Job, voucher and invoice
// numbers repeat from one book to the next, so nothing here looks a record
// up without its book.
//
// Rights: 'archive:view' (Reports > Archive in the rights grid) for
// everything but the book list, which the sidebar reads for everyone to know
// whether to offer the screen at all.

const routes = require('express').Router();
const { books, isConfigured, bookFor } = require('../../functions/archive/books');
const { ArchiveError } = require('../../functions/archive/db');
const { id: asId, tranNumber } = require('../../functions/archive/inputs');
const { searchJobs, jobDetail } = require('../../functions/archive/jobs');
const { searchInvoices, searchBills, invoiceDetail, billDetail } = require('../../functions/archive/invoices');
const { searchVouchers, voucherDetail } = require('../../functions/archive/vouchers');
const { searchAccounts, bookSummary, ledger, trialBalance } = require('../../functions/archive/accounts');

/** Wraps a handler: unknown book -> 404, archive errors -> their status. */
const handle = (fn) => async (req, res) => {
  try {
    if (req.params.book !== undefined && !bookFor(req.params.book)) {
      return res.status(404).json({ status: 'error', result: 'There is no such archive book on this install.' });
    }
    const result = await fn(req, bookFor(req.params.book)?.key);
    if (result === null || result === undefined) {
      return res.status(404).json({ status: 'error', result: 'Not found in this book.' });
    }
    if (result && typeof result === 'object' && typeof result.error === 'string') {
      return res.status(400).json({ status: 'error', result: result.error });
    }
    return res.json({ status: 'success', result });
  } catch (err) {
    if (err instanceof ArchiveError) {
      return res.status(err.status).json({ status: 'error', result: err.message });
    }
    console.error('[archive]', req.method, req.originalUrl, err);
    return res.status(500).json({ status: 'error', result: 'The archive could not read that. The error is in the server log.' });
  }
};

routes.get('/books', handle(async () => ({ enabled: isConfigured(), books: books() })));

routes.get('/:book/summary', handle((req, book) => bookSummary(book)));

routes.get('/:book/jobs', handle((req, book) => searchJobs(book, req.query)));
routes.get('/:book/jobs/:id', handle((req, book) => {
  const id = asId(req.params.id);
  return id ? jobDetail(book, id) : null;
}));

routes.get('/:book/invoices', handle((req, book) => searchInvoices(book, req.query)));
routes.get('/:book/invoices/:id', handle((req, book) => {
  const id = asId(req.params.id);
  return id ? invoiceDetail(book, id) : null;
}));

routes.get('/:book/bills', handle((req, book) => searchBills(book, req.query)));
routes.get('/:book/bills/:id', handle((req, book) => {
  const id = asId(req.params.id);
  return id ? billDetail(book, id) : null;
}));

routes.get('/:book/vouchers', handle((req, book) => searchVouchers(book, req.query)));
routes.get('/:book/vouchers/:tranNo', handle((req, book) => {
  const tranNo = tranNumber(req.params.tranNo);
  return tranNo ? voucherDetail(book, tranNo) : null;
}));

routes.get('/:book/accounts', handle((req, book) => searchAccounts(book, req.query)));
routes.get('/:book/ledger', handle((req, book) => ledger(book, req.query)));
routes.get('/:book/trialBalance', handle((req, book) => trialBalance(book, req.query)));

module.exports = routes;
