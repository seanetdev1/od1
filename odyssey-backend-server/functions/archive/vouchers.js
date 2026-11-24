// Archive vouchers - Climax's tranfile (one row a voucher) and tranfil1 (its
// lines).
//
// A voucher is keyed by trannumb, Climax's internal number - the year code and
// a sequence, "161700009619". Its printed number is voucnumb ("CPV-000807"),
// which restarts every year, so two vouchers in one book can share it; the
// screens always open one by trannumb. trannumb itself is reused ACROSS books
// (20,972 of the 2016 book's are also in the 2012 one, as different vouchers),
// which is why every request names its book.
//
// A void voucher keeps its header and its lines at zero - 30,221 in the 2016
// book hold ₨126,270 between them - so it is listed, marked, and adds nothing.

const { query, param } = require('./db');
const { likeContains, day, paging, id: asId } = require('./inputs');
const { wallDate, wallTime, money } = require('./values');

const TYPES = {
  CRV: 'Cash Receipt Voucher',
  CPV: 'Cash Payment Voucher',
  BRV: 'Bank Receipt Voucher',
  BPV: 'Bank Payment Voucher',
  JV: 'Journal Voucher',
  SI: 'Sales Invoice',
  PI: 'Purchase Invoice',
  TV: 'Transfer Voucher',
  DN: 'Debit Note',
  CN: 'Credit Note',
  CR: 'Cheque Return',
};

async function searchVouchers(book, q = {}) {
  const { page, pageSize, offset } = paging(q);
  const type = Object.prototype.hasOwnProperty.call(TYPES, String(q.type || '').toUpperCase())
    ? String(q.type).toUpperCase() : null;
  const params = {
    q: param.str(likeContains(q.q)),
    // The narration is ntext, read in full for every voucher - seconds on the
    // 2016 book - so it is searched only when asked to.
    narration: param.int(String(q.narration) === '1' ? 1 : 0),
    type: param.str(type),
    account: param.int(asId(q.account)),
    from: param.date(day(q.from)),
    to: param.date(day(q.to)),
    offset: param.int(offset),
    size: param.int(pageSize),
  };
  const where = `
      WHERE (@q IS NULL OR m.voucnumb LIKE @q OR m.cheknumb LIKE @q OR m.PayTo LIKE @q OR m.RefNumb LIKE @q
             OR m.recvpers LIKE @q OR (@narration = 1 AND m.naration LIKE @q))
        AND (@type IS NULL OR m.trantype = @type)
        AND (@account IS NULL OR EXISTS (SELECT 1 FROM tranfil1 l WHERE l.trannumb = m.trannumb AND l.acctcode = @account))
        AND (@from IS NULL OR m.trandate >= @from)
        AND (@to IS NULL OR m.trandate < DATEADD(day, 1, @to))`;
  // Counted apart from the page (see searchJobs), and the page is cut before
  // its totals are summed, so a search over the whole book sums fifty
  // vouchers' lines and not half a million.
  const [count, rows] = await Promise.all([
    query(book, `SELECT COUNT(*) total FROM tranfile m ${where}`, params),
    query(book, `
      WITH hits AS (
        SELECT m.trannumb tranNo, m.voucnumb voucherNo, m.trandate tranDate, m.trantype vType,
               m.cheknumb chequeNo, m.PayTo payTo, m.IsVoid isVoid, m.acctcode headAccount,
               CAST(m.naration AS nvarchar(300)) narration
        FROM tranfile m
        ${where}
        ORDER BY m.trandate DESC, m.trannumb DESC
        OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY
      )
      SELECT h.*, a.acctname headAccountName, t.dr amount
      FROM hits h
      LEFT JOIN acctfile a ON a.autonumb = h.headAccount
      OUTER APPLY (SELECT SUM(ISNULL(l.debtamnt, 0)) dr FROM tranfil1 l WHERE l.trannumb = h.tranNo) t
      ORDER BY h.tranDate DESC, h.tranNo DESC`, params),
  ]);
  return {
    page,
    pageSize,
    total: count[0]?.total || 0,
    rows: rows.map((r) => ({
      tranNo: r.tranNo,
      voucherNo: r.voucherNo || '',
      date: wallDate(r.tranDate),
      type: r.vType || '',
      typeName: TYPES[r.vType] || r.vType || '',
      account: r.headAccountName || '',
      chequeNo: r.chequeNo || '',
      payTo: r.payTo || '',
      narration: r.narration || '',
      amount: money(r.amount),
      isVoid: Boolean(r.isVoid),
    })),
  };
}

async function voucherDetail(book, tranNo) {
  const p = { t: param.str(tranNo) };
  const heads = await query(book, `
    SELECT m.trannumb tranNo, m.voucnumb voucherNo, m.trandate tranDate, m.currdate entryDate, m.trantype vType,
           m.acctcode headAccount, a.acctname headAccountName, m.partcode partyAccount, pa.acctname partyAccountName,
           m.cheknumb chequeNo, m.chekdate chequeDate, CAST(m.naration AS nvarchar(max)) narration,
           m.PayTo payTo, m.recvpers receivedBy, m.RefNumb refNo, m.IsVoid isVoid, m.formname form,
           m.authstat authStatus, m.authlogn authBy, m.authdate authOn,
           m.createlog createdBy, m.createtim createdOn, m.editrlog editedBy, m.editrtim editedOn
    FROM tranfile m
    LEFT JOIN acctfile a ON a.autonumb = m.acctcode
    LEFT JOIN acctfile pa ON pa.autonumb = m.partcode
    WHERE m.trannumb = @t`, p);
  if (!heads.length) return null;
  const h = heads[0];

  const [lines, invoices, bills] = await Promise.all([
    query(book, `
      SELECT l.serlnumb sno, l.acctcode accountId, a.acctcode accountCode, a.acctname accountName,
             l.debtamnt debit, l.crdtamnt credit, l.remarks1 narration,
             ISNULL(NULLIF(l.JobNumbr, ''), l.jobnumber) jobNo, l.currcode currency, l.exchrate exRate,
             cf.costname costCentre
      FROM tranfil1 l
      LEFT JOIN acctfile a ON a.autonumb = l.acctcode
      LEFT JOIN costfile cf ON cf.costnumb = l.costcode
      WHERE l.trannumb = @t
      ORDER BY l.serlnumb`, p),
    query(book, `
      SELECT i.InvoicePKId id, i.InvoiceNo number, i.VoucherTranId tranNo, i.SettelVoucherId settleTranNo
      FROM LSJobsInvoicesMaster i
      WHERE i.VoucherTranId = @t OR i.SettelVoucherId = @t`, p),
    query(book, `
      SELECT e.ExpensePKId id, e.ExpenseNo number, e.VoucherTranId tranNo, e.SettelVoucherId settleTranNo
      FROM LSJobsExpensesMaster e
      WHERE e.VoucherTranId = @t OR e.SettelVoucherId = @t`, p),
  ]);

  const mapped = lines.map((l) => ({
    sno: l.sno,
    accountId: l.accountId == null ? null : Number(l.accountId),
    accountCode: l.accountCode || '',
    accountName: l.accountName || '',
    debit: money(l.debit),
    credit: money(l.credit),
    narration: l.narration || '',
    jobNo: (l.jobNo || '').trim(),
    currency: l.currency || '',
    exRate: money(l.exRate),
    costCentre: l.costCentre || '',
  }));
  const link = (r, side) => ({
    side,
    id: r.id,
    number: r.number,
    role: String(r.tranNo) === String(tranNo) ? 'posted' : 'settled',
  });

  return {
    tranNo: h.tranNo,
    voucherNo: h.voucherNo || '',
    date: wallDate(h.tranDate),
    entryDate: wallDate(h.entryDate),
    type: h.vType || '',
    typeName: TYPES[h.vType] || h.vType || '',
    headAccount: h.headAccount == null ? null : { id: Number(h.headAccount), name: h.headAccountName || '' },
    partyAccount: h.partyAccount == null ? null : { id: Number(h.partyAccount), name: h.partyAccountName || '' },
    chequeNo: h.chequeNo || '',
    chequeDate: wallDate(h.chequeDate),
    narration: h.narration || '',
    payTo: h.payTo || '',
    receivedBy: h.receivedBy || '',
    refNo: h.refNo || '',
    isVoid: Boolean(h.isVoid),
    approved: { status: h.authStatus, by: h.authBy || '', on: wallTime(h.authOn) },
    created: { by: h.createdBy || '', on: wallTime(h.createdOn) },
    edited: { by: h.editedBy || '', on: wallTime(h.editedOn) },
    totals: {
      debit: money(mapped.reduce((t, l) => t + l.debit, 0)),
      credit: money(mapped.reduce((t, l) => t + l.credit, 0)),
    },
    lines: mapped,
    links: [...invoices.map((r) => link(r, 'invoice')), ...bills.map((r) => link(r, 'bill'))],
  };
}

module.exports = { searchVouchers, voucherDetail, VOUCHER_TYPES: TYPES };
