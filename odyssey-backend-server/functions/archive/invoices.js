// Archive invoices and bills.
//
//   invoices  LSJobsInvoicesMaster - JI- job invoices (InvoiceType 1) and a
//             handful of CN- credit notes (2). Each line points at the job's
//             receivable charge it bills (JobChargesRowId -> LSJobsReceivable
//             .RowId), which is where the charge, quantity and rate are.
//             TotalAmount is the lines before tax and NetAmount the lines
//             plus their sales tax - true of 99,309 of the 2016 book's 99,314.
//   bills     LSJobsExpensesMaster - JE- job expenses, DE- and SR-. Each line
//             carries its own charge, quantity and rate.

const { query, param } = require('./db');
const { likeContains, day, paging } = require('./inputs');
const { wallDate, wallTime, money } = require('./values');
const { jobHeader } = require('./jobs');

const invoiceKind = (type) => (Number(type) === 2 ? 'Credit Note' : 'Invoice');

// The bill series, by the prefix of its number - Climax's ExpenseType says the
// same thing as a bare number (1, 5, 4).
const BILL_KINDS = { JE: 'Job Expense', DE: 'Direct Expense', SR: 'Service Bill' };
const billKind = (no) => BILL_KINDS[String(no || '').slice(0, 2).toUpperCase()] || 'Bill';

const searchParams = (q, offset, pageSize) => ({
  q: param.str(likeContains(q.q)),
  from: param.date(day(q.from)),
  to: param.date(day(q.to)),
  offset: param.int(offset),
  size: param.int(pageSize),
});

async function searchInvoices(book, q = {}) {
  const { page, pageSize, offset } = paging(q);
  const params = searchParams(q, offset, pageSize);
  const fromWhere = `
    FROM LSJobsInvoicesMaster i
    LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = i.CustomerId
    LEFT JOIN LSJobsMaster j ON j.JobMasterPKId = i.JobMasterPKId
    WHERE (@q IS NULL OR i.InvoiceNo LIKE @q OR pt.Name LIKE @q OR j.JobRefNo LIKE @q
           OR i.GStInvNo LIKE @q OR i.MInvoiceNo LIKE @q)
      AND (@from IS NULL OR i.InvoiceDate >= @from)
      AND (@to IS NULL OR i.InvoiceDate < DATEADD(day, 1, @to))`;
  // Counted apart from the page - see searchJobs.
  const [count, rows] = await Promise.all([
    query(book, `SELECT COUNT(*) total ${fromWhere}`, params),
    query(book, `
      SELECT i.InvoicePKId id, i.InvoiceNo invoiceNo, i.InvoiceDate invoiceDate, i.InvoiceType invoiceType,
             pt.Name party, j.JobRefNo jobNo, i.JobMasterPKId jobId, i.NetAmount net, i.SaleTaxAmnt tax,
             i.GStInvNo gstNo, i.IsVoid isVoid, i.VoucherTranId tranNo
      ${fromWhere}
      ORDER BY i.InvoiceDate DESC, i.InvoicePKId DESC
      OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`, params),
  ]);
  return {
    page,
    pageSize,
    total: count[0]?.total || 0,
    rows: rows.map((r) => ({
      id: r.id,
      number: r.invoiceNo,
      date: wallDate(r.invoiceDate),
      kind: invoiceKind(r.invoiceType),
      party: r.party || '',
      jobNo: r.jobNo || '',
      jobId: r.jobId || null,
      tax: money(r.tax),
      amount: money(r.net),
      gstNo: r.gstNo || '',
      isVoid: Boolean(r.isVoid),
      tranNo: r.tranNo || null,
    })),
  };
}

// A bill's party: its vendor, or - for the direct expenses, which name none
// (229k of the 2016 book's 272k DE- bills) - the account it was charged to,
// "ADVANCE QICT" and the like.
const BILL_PARTY = `ISNULL(pt.Name, ac.acctname)`;

async function searchBills(book, q = {}) {
  const { page, pageSize, offset } = paging(q);
  const params = searchParams(q, offset, pageSize);
  const fromWhere = `
    FROM LSJobsExpensesMaster e
    LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = e.VendorId
    LEFT JOIN acctfile ac ON ac.autonumb = e.AccountId
    LEFT JOIN LSJobsMaster j ON j.JobMasterPKId = e.JobMasterPKId
    WHERE (@q IS NULL OR e.ExpenseNo LIKE @q OR pt.Name LIKE @q OR ac.acctname LIKE @q OR j.JobRefNo LIKE @q
           OR e.VendorBillNo LIKE @q OR e.PayTo LIKE @q)
      AND (@from IS NULL OR e.ExpenseDate >= @from)
      AND (@to IS NULL OR e.ExpenseDate < DATEADD(day, 1, @to))`;
  const [count, rows] = await Promise.all([
    query(book, `SELECT COUNT(*) total ${fromWhere}`, params),
    query(book, `
      SELECT e.ExpensePKId id, e.ExpenseNo billNo, e.ExpenseDate billDate, ${BILL_PARTY} party, j.JobRefNo jobNo,
             e.JobMasterPKId jobId, e.NetAmount net, e.VendorBillNo vendorBillNo, e.IsVoid isVoid,
             e.VoucherTranId tranNo
      ${fromWhere}
      ORDER BY e.ExpenseDate DESC, e.ExpensePKId DESC
      OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`, params),
  ]);
  return {
    page,
    pageSize,
    total: count[0]?.total || 0,
    rows: rows.map((r) => ({
      id: r.id,
      number: r.billNo,
      date: wallDate(r.billDate),
      kind: billKind(r.billNo),
      party: r.party || '',
      jobNo: r.jobNo || '',
      jobId: r.jobId || null,
      amount: money(r.net),
      vendorBillNo: r.vendorBillNo || '',
      isVoid: Boolean(r.isVoid),
      tranNo: r.tranNo || null,
    })),
  };
}

async function invoiceDetail(book, id) {
  const heads = await query(book, `
    SELECT i.InvoicePKId id, i.InvoiceNo invoiceNo, i.InvoiceDate invoiceDate, i.InvoiceType invoiceType,
           i.JobMasterPKId jobId, i.Remarks remarks, i.TotalAmount total, i.DiscountAmount discount,
           i.NetAmount net, i.SaleTaxAmnt tax, i.GStInvNo gstNo, i.MInvoiceNo masterInvoiceNo,
           i.InvDueDate dueDate, i.InvCreditDays creditDays, i.IsVoid isVoid, i.VoucherTranId tranNo,
           i.SettelVoucherId settleTranNo, i.CreateLog createdBy, i.CreateTim createdOn,
           i.EditRLog editedBy, i.EditRTim editedOn,
           pt.Name party, pt.Address1 partyAddress, pt.NTN partyNtn, pt.SalesTaxNo partyStrn,
           m.voucnumb voucherNo, s.voucnumb settleVoucherNo
    FROM LSJobsInvoicesMaster i
    LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = i.CustomerId
    LEFT JOIN tranfile m ON m.trannumb = i.VoucherTranId
    LEFT JOIN tranfile s ON s.trannumb = i.SettelVoucherId
    WHERE i.InvoicePKId = @id`, { id: param.int(id) });
  if (!heads.length) return null;
  const h = heads[0];

  const [lines, job] = await Promise.all([
    query(book, `
      SELECT d.RowID rowId, r.SNo sno, ch.ChargesName charge, r.Remarks remarks, r.Qty qty, r.Rate rate,
             d.TotalAmount amount, d.SaleTaxPer taxPerc, d.SaleTaxAmnt tax, ISNULL(d.VehicleNo, r.VehicleNo) vehicle
      FROM LSJobsInvoicesDetail d
      LEFT JOIN LSJobsReceivable r ON r.RowId = d.JobChargesRowId
      LEFT JOIN LSCharges ch ON ch.ChargesPKId = r.ChargesId
      WHERE d.InvoicePKId = @id
      ORDER BY r.SNo, d.RowID`, { id: param.int(id) }),
    h.jobId ? jobHeader(book, h.jobId) : Promise.resolve(null),
  ]);

  return {
    side: 'invoice',
    id: h.id,
    number: h.invoiceNo,
    date: wallDate(h.invoiceDate),
    kind: invoiceKind(h.invoiceType),
    party: { name: h.party || '', address: h.partyAddress || '', ntn: h.partyNtn || '', strn: h.partyStrn || '' },
    remarks: h.remarks || '',
    total: money(h.total),
    discount: money(h.discount),
    tax: money(h.tax),
    net: money(h.net),
    gstNo: h.gstNo || '',
    masterInvoiceNo: h.masterInvoiceNo || '',
    dueDate: wallDate(h.dueDate),
    creditDays: h.creditDays == null ? null : Number(h.creditDays),
    isVoid: Boolean(h.isVoid),
    voucher: h.tranNo ? { tranNo: h.tranNo, voucherNo: h.voucherNo || '' } : null,
    settlement: h.settleTranNo ? { tranNo: h.settleTranNo, voucherNo: h.settleVoucherNo || '' } : null,
    created: { by: h.createdBy || '', on: wallTime(h.createdOn) },
    edited: { by: h.editedBy || '', on: wallTime(h.editedOn) },
    job,
    lines: lines.map((l) => ({
      rowId: l.rowId,
      charge: l.charge || '',
      remarks: l.remarks || '',
      vehicle: l.vehicle || '',
      qty: money(l.qty),
      rate: money(l.rate),
      amount: money(l.amount),
      taxPerc: money(l.taxPerc),
      tax: money(l.tax),
    })),
  };
}

async function billDetail(book, id) {
  const heads = await query(book, `
    SELECT e.ExpensePKId id, e.ExpenseNo billNo, e.ExpenseDate billDate, e.JobMasterPKId jobId,
           e.Remarks remarks, e.TotalAmount total, e.DiscountAmount discount, e.NetAmount net,
           e.STaxAmount tax, e.VendorBillNo vendorBillNo, e.PayTo payTo, e.ChequeNo chequeNo,
           e.ChequeDate chequeDate, e.ExpDueDate dueDate, e.IsVoid isVoid, e.VoucherTranId tranNo,
           e.SettelVoucherId settleTranNo, e.CreateLog createdBy, e.CreateTim createdOn,
           e.EditRLog editedBy, e.EditRTim editedOn,
           ${BILL_PARTY} party, pt.Address1 partyAddress, pt.NTN partyNtn, pt.SalesTaxNo partyStrn,
           m.voucnumb voucherNo, s.voucnumb settleVoucherNo
    FROM LSJobsExpensesMaster e
    LEFT JOIN LSCommonCodingsSetup pt ON pt.CommonCPkId = e.VendorId
    LEFT JOIN acctfile ac ON ac.autonumb = e.AccountId
    LEFT JOIN tranfile m ON m.trannumb = e.VoucherTranId
    LEFT JOIN tranfile s ON s.trannumb = e.SettelVoucherId
    WHERE e.ExpensePKId = @id`, { id: param.int(id) });
  if (!heads.length) return null;
  const h = heads[0];

  const [lines, job] = await Promise.all([
    query(book, `
      SELECT d.RowID rowId, ch.ChargesName charge, d.Remarks remarks, d.Qty qty, d.Rate rate,
             d.TotalAmount amount, d.VehicleNo vehicle
      FROM LSJobsExpensesDetail d
      LEFT JOIN LSCharges ch ON ch.ChargesPKId = d.ChargesId
      WHERE d.ExpensePKId = @id
      ORDER BY d.RowID`, { id: param.int(id) }),
    h.jobId ? jobHeader(book, h.jobId) : Promise.resolve(null),
  ]);

  return {
    side: 'bill',
    id: h.id,
    number: h.billNo,
    date: wallDate(h.billDate),
    kind: billKind(h.billNo),
    party: { name: h.party || '', address: h.partyAddress || '', ntn: h.partyNtn || '', strn: h.partyStrn || '' },
    remarks: h.remarks || '',
    total: money(h.total),
    discount: money(h.discount),
    tax: money(h.tax),
    net: money(h.net),
    vendorBillNo: h.vendorBillNo || '',
    payTo: h.payTo || '',
    chequeNo: h.chequeNo || '',
    chequeDate: wallDate(h.chequeDate),
    dueDate: wallDate(h.dueDate),
    isVoid: Boolean(h.isVoid),
    voucher: h.tranNo ? { tranNo: h.tranNo, voucherNo: h.voucherNo || '' } : null,
    settlement: h.settleTranNo ? { tranNo: h.settleTranNo, voucherNo: h.settleVoucherNo || '' } : null,
    created: { by: h.createdBy || '', on: wallTime(h.createdOn) },
    edited: { by: h.editedBy || '', on: wallTime(h.editedOn) },
    job,
    lines: lines.map((l) => ({
      rowId: l.rowId,
      charge: l.charge || '',
      remarks: l.remarks || '',
      vehicle: l.vehicle || '',
      qty: money(l.qty),
      rate: money(l.rate),
      amount: money(l.amount),
      taxPerc: 0,
      tax: 0,
    })),
  };
}

module.exports = { searchInvoices, searchBills, invoiceDetail, billDetail, billKind, invoiceKind };
