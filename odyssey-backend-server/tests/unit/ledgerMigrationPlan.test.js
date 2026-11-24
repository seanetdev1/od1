const {
  planVouchers,
  planSettlements,
  assignGapNumbers,
  sideAmount,
  sideType,
} = require('../../functions/ledgerMigrationPlan');

/**
 * A chart of accounts shaped like the real one: a party account under a
 * control parent, a bank account, and a general contra account.
 */
const accounts = new Map([
  ['4522', { id: 4522, title: 'ASSETS', subCategory: null, parentId: null }],
  ['5000', { id: 5000, title: 'ACCOUNT RECEIVABLE', subCategory: null, parentId: 4522 }],
  ['5001', { id: 5001, title: 'ACCOUNT PAYABLE ', subCategory: null, parentId: 4522 }],
  ['6001', { id: 6001, title: 'ACME LTD', subCategory: 'Customer', parentId: 5000 }],
  ['6002', { id: 6002, title: 'MAERSK', subCategory: 'Vendor', parentId: 5001 }],
  ['7001', { id: 7001, title: 'HBL CURRENT ACCOUNT', subCategory: 'Bank', parentId: 4522 }],
  // Sits under CAPITAL in the real chart of accounts, not under a control
  // parent - which is precisely why partyDetailLine looks past it to line 1.
  ['4523', { id: 4523, title: 'CAPITAL', subCategory: null, parentId: null }],
  ['8001', { id: 8001, title: 'CONTRA ACCOUNT OPENINIG', subCategory: 'General', parentId: 4523 }],
]);

const context = (over = {}) => ({
  existingClimaxIds: [],
  accounts,
  partyByAccount: new Map([
    ['6001', { id: 11, name: 'ACME LTD' }],
    ['6002', { id: 22, name: 'MAERSK' }],
  ]),
  companies: new Map([['2', 1], ['3', 3]]),
  currencies: new Map([['1', 'PKR'], ['2', 'USD']]),
  voucherTypes: new Map([
    ['1', { Id: 1, TypeCode: 'BPV', VoucherType: 'BANK PAYMENT VOUCHER' }],
    ['2', { Id: 2, TypeCode: 'BRV', VoucherType: 'BANK RECEIPT VOUCHER' }],
    ['7', { Id: 7, TypeCode: 'DN', VoucherType: 'DEBIT NOTE' }],
    ['9', { Id: 9, TypeCode: 'PI', VoucherType: 'PURCHASE INVOICE' }],
    ['10', { Id: 10, TypeCode: 'SI', VoucherType: 'SALES INVOICE' }],
  ]),
  details: [],
  ...over,
});

const voucher = (over = {}) => ({
  Id: 900,
  VoucherNo: 'ACS-BRV-00123/23',
  VoucherDate: '2022-07-01T00:00:00.000Z',
  VoucherTypeId: 2,
  CurrencyId: 1,
  ExchangeRate: 1,
  SubCompanyId: 3,
  Narration: 'Receipt against ACS-JI-1/23',
  AddOn: '2022-07-01T10:00:00.000Z',
  AddLog: 'ADMIN',
  ...over,
});

/** Party line first, then the bank line - the common two-line shape. */
const lines = (voucherId = 900, over = {}) => ([
  {
    Id: 5001, VoucherId: voucherId, COAAccountId: 6001,
    DebitVC: 1170, CreditVC: 0, DebitLC: 1170, CreditLC: 0,
    NarrationVD: 'ACME LTD', ChequeNumber: '10582568',
    ChequeDate: '2022-07-01T00:00:00.000Z', ...over,
  },
  {
    Id: 5002, VoucherId: voucherId, COAAccountId: 7001,
    DebitVC: 0, CreditVC: 1170, DebitLC: 0, CreditLC: 1170,
    NarrationVD: 'HBL',
  },
]);

describe('ledger migration planner - vouchers', () => {
  describe('amounts', () => {
    it('takes whichever side carries the value', () => {
      expect(sideAmount(0, 3806)).toBe(3806);
      expect(sideAmount(500, 0)).toBe(500);
    });

    it('does not read the wrong column when one is null rather than zero', () => {
      // `DebitLC === 0 ? CreditLC : DebitLC` returns null here.
      expect(sideAmount(null, 3806)).toBe(3806);
      expect(sideAmount(3806, null)).toBe(3806);
    });

    it('calls it a debit only when the debit column carries the value', () => {
      expect(sideType(1170)).toBe('debit');
      expect(sideType(0)).toBe('credit');
      expect(sideType(null)).toBe('credit');
      expect(sideType(0, 1170)).toBe('credit');
    });

    it('reads a negative debit as a credit, and a negative credit as a debit', () => {
      // Climax stores some lines signed in one column. DebitLC -500 is a
      // credit of 500; calling it a debit - and then losing the sign in the
      // model hook - misstated both the account and the voucher by 1,000.
      expect(sideType(-500, 0)).toBe('credit');
      expect(sideAmount(-500, 0)).toBe(500);
      expect(sideType(0, -300)).toBe('debit');
      expect(sideAmount(0, -300)).toBe(300);
    });

    it('nets a line that carries both columns', () => {
      expect(sideType(100, 30)).toBe('debit');
      expect(sideAmount(100, 30)).toBe(70);
      expect(sideType(30, 100)).toBe('credit');
      expect(sideAmount(100.1, 0.2)).toBe(99.9);
    });

    it('imports a voucher with a negative line balanced', () => {
      // The bank line is a negative DEBIT - really the credit side.
      const detail = [
        { Id: 1, VoucherId: 900, COAAccountId: 6001, DebitVC: 750, CreditVC: 0, DebitLC: 750, CreditLC: 0 },
        { Id: 2, VoucherId: 900, COAAccountId: 7001, DebitVC: -750, CreditVC: 0, DebitLC: -750, CreditLC: 0 },
      ];
      const [party, bank] = planVouchers([voucher()], context({ details: detail })).toCreate[0].heads;
      expect(party).toMatchObject({ type: 'debit', defaultAmount: '750', amount: '750' });
      expect(bank).toMatchObject({ type: 'credit', defaultAmount: '750', amount: '750' });
    });

    it('guarantees an amount, which the model requires and bulkCreate will not check', () => {
      const plan = planVouchers([voucher()], context({
        details: [{ Id: 1, VoucherId: 900, COAAccountId: 6001, DebitVC: null, CreditVC: null, DebitLC: null, CreditLC: null }],
      }));
      expect(plan.toCreate[0].heads[0].amount).toBe('0');
      expect(plan.toCreate[0].heads[0].defaultAmount).toBe('0');
    });
  });

  describe('the voucher itself', () => {
    it('maps a receipt onto the columns the screens read', () => {
      // Settling, as its own narration says ("Receipt against ACS-JI-1/23") -
      // which is what puts it on the payments screen at all. A receipt that
      // settles nothing is a Voucher List row and is covered separately.
      const plan = planVouchers([voucher()], context({
        details: lines(), settledDetailIds: [5001],
      }));
      const { voucher: v, heads } = plan.toCreate[0];

      expect(v.voucher_No).toBe(123);
      expect(v.voucher_Id).toBe('ACS-BRV-00123/23');
      // getTransaction builds the payments screen from exactly these.
      expect(v.type).toBe('Job Reciept');
      expect(v.vType).toBe('BRV');
      expect(v.currency).toBe('PKR');
      expect(v.CompanyId).toBe(3);
      expect(v.climaxId).toBe(900);
      expect(v.chequeNo).toBe('10582568');
      expect(heads).toHaveLength(2);
    });

    it('translates a debit note the way the app expects', () => {
      const plan = planVouchers([voucher({ VoucherTypeId: 7 })], context({ details: lines() }));
      expect(plan.toCreate[0].voucher.vType).toBe('ADJ-R');
    });

    it('leaves an invoice-raising voucher out of the payments screen', () => {
      // getTransaction selects type IN ('Job Reciept','Job Payment'). A sales
      // invoice voucher is not a payment and must not appear there.
      const plan = planVouchers([voucher({ VoucherTypeId: 10 })], context({ details: lines() }));
      expect(plan.toCreate[0].voucher.type).toBe('SALES INVOICE');
      expect(plan.toCreate[0].voucher.type).not.toBe('Job Reciept');
    });

    it('resolves the company through climaxId, not the number prefix', () => {
      const plan = planVouchers([voucher({ SubCompanyId: 2, VoucherNo: 'SNS-BRV-1/23' })],
        context({ details: lines() }));
      expect(plan.toCreate[0].voucher.CompanyId).toBe(1);
    });

    it('keeps the voucher’s own date rather than today - its entry time, read as Pakistan time', () => {
      // AddOn is Climax's wall clock (UTC+5) arriving as if it were UTC. Left
      // as it came, evening entries sat on the next day in the ledger.
      const plan = planVouchers([voucher()], context({ details: lines() }));
      expect(plan.toCreate[0].voucher.createdAt).toBe('2022-07-01T05:00:00.000Z');
    });

    it('does not shift the voucher date when there is no entry time', () => {
      // VoucherDate is a date - midnight - and already on the right day.
      const plan = planVouchers([voucher({ AddOn: null })], context({ details: lines() }));
      expect(plan.toCreate[0].voucher.createdAt).toBe('2022-07-01T00:00:00.000Z');
    });
  });

  describe('the ledger date of an invoice voucher', () => {
    // SI-01732/27 in CargoLinkers' data: raised for JI-1743/27 of 31 August,
    // keyed in at 17:46 on 1 September. Dated by the entry it showed in
    // September; Climax's ledger shows it in August.
    const si = voucher({
      VoucherTypeId: 10,
      VoucherNo: 'SI-01732/27',
      VoucherDate: '2026-08-31T00:00:00.000Z',
      AddOn: '2026-09-01T17:46:58.093Z',
      EditOn: '2026-09-01T18:34:49.000Z',
    });

    it('puts a sales invoice voucher and every line on the invoice date, not the entry time', () => {
      const { voucher: v, heads } = planVouchers([si], context({ details: lines() })).toCreate[0];
      expect(v.vType).toBe('SI');
      expect(v.createdAt).toBe('2026-08-31T00:00:00.000Z');
      expect(heads.map((h) => h.createdAt)).toEqual(['2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z']);
    });

    it('does the same for a purchase invoice voucher', () => {
      const pi = { ...si, VoucherTypeId: 9, VoucherNo: 'PI-01732/27' };
      const { voucher: v } = planVouchers([pi], context({ details: lines() })).toCreate[0];
      expect(v.vType).toBe('PI');
      expect(v.createdAt).toBe('2026-08-31T00:00:00.000Z');
    });

    it('keeps the voucher date even when the entry was made before it', () => {
      // 31 such vouchers on CargoLinkers - keyed in ahead of the invoice date.
      const early = { ...si, AddOn: '2026-08-29T11:00:00.000Z' };
      const { voucher: v } = planVouchers([early], context({ details: lines() })).toCreate[0];
      expect(v.createdAt).toBe('2026-08-31T00:00:00.000Z');
    });

    it('still records when it was last edited', () => {
      const { voucher: v } = planVouchers([si], context({ details: lines() })).toCreate[0];
      expect(v.updatedAt).toBe('2026-09-01T13:34:49.000Z');
    });

    it('falls back to the entry time for an invoice voucher with no voucher date', () => {
      const undated = { ...si, VoucherDate: null };
      const { voucher: v } = planVouchers([undated], context({ details: lines() })).toCreate[0];
      expect(v.createdAt).toBe('2026-09-01T12:46:58.093Z');
    });

    it('leaves every other voucher on its entry time', () => {
      // The ruling covers SI and PI only. A receipt keyed in the next day
      // stays where its entry puts it.
      const brv = voucher({ VoucherDate: '2026-08-31T00:00:00.000Z', AddOn: '2026-09-01T17:46:58.093Z' });
      const { voucher: v } = planVouchers([brv], context({ details: lines() })).toCreate[0];
      expect(v.vType).toBe('BRV');
      expect(v.createdAt).toBe('2026-09-01T12:46:58.093Z');
    });
  });

  describe('the party', () => {
    it('reads it from the line that carries it, not from line 0', () => {
      // ACS-OP-00089/23 in the real data: line 0 is CONTRA ACCOUNT OPENINIG
      // [General] and the customer is on line 1. Taking line 0 loses the party.
      const detail = [
        { Id: 1, VoucherId: 900, COAAccountId: 8001, DebitVC: 0, CreditVC: 500, DebitLC: 0, CreditLC: 500 },
        { Id: 2, VoucherId: 900, COAAccountId: 6001, DebitVC: 500, CreditVC: 0, DebitLC: 500, CreditLC: 0 },
      ];
      const plan = planVouchers([voucher()], context({ details: detail }));

      expect(plan.toCreate[0].voucher.partyName).toBe('ACME LTD');
      expect(plan.stats.withoutParty).toBe(0);
    });

    it('sides a vendor voucher from the party account’s parent', () => {
      const detail = [
        { Id: 1, VoucherId: 900, COAAccountId: 6002, DebitVC: 900, CreditVC: 0, DebitLC: 900, CreditLC: 0 },
        { Id: 2, VoucherId: 900, COAAccountId: 7001, DebitVC: 0, CreditVC: 900, DebitLC: 0, CreditLC: 900 },
      ];
      const plan = planVouchers([voucher()], context({ details: detail }));

      // 'ACCOUNT PAYABLE ' - with the trailing space the real chart has.
      expect(plan.toCreate[0].voucher.partyType).toBe('vendor');
      expect(plan.toCreate[0].voucher.onAccount).toBe('vendor');
      expect(plan.toCreate[0].voucher.partyName).toBe('MAERSK');
      expect(plan.stats.payable).toBe(1);
    });

    it('imports a voucher with no party rather than dropping it', () => {
      // 7,975 real vouchers have none: expense payments, transfers, journals.
      const detail = [
        { Id: 1, VoucherId: 900, COAAccountId: 8001, DebitVC: 100, CreditVC: 0, DebitLC: 100, CreditLC: 0 },
        { Id: 2, VoucherId: 900, COAAccountId: 7001, DebitVC: 0, CreditVC: 100, DebitLC: 0, CreditLC: 100 },
      ];
      const plan = planVouchers([voucher()], context({ details: detail }));

      expect(plan.toCreate).toHaveLength(1);
      expect(plan.toCreate[0].voucher.partyId).toBeNull();
      expect(plan.stats.withoutParty).toBe(1);
    });
  });

  describe('voucher heads', () => {
    it('buckets each line by what its account is', () => {
      const plan = planVouchers([voucher()], context({ details: lines() }));
      const [party, bank] = plan.toCreate[0].heads;

      expect(party.accountType).toBe('partyAccount');
      expect(bank.accountType).toBe('payAccount');
      expect(party.type).toBe('debit');
      expect(bank.type).toBe('credit');
      // Child_Account.id IS the legacy COA id - no lookup table.
      expect(party.ChildAccountId).toBe(6001);
      expect(party.climaxId).toBe(5001);
    });

    it('balances - debits equal credits', () => {
      const plan = planVouchers([voucher()], context({ details: lines() }));
      const heads = plan.toCreate[0].heads;
      const dr = heads.filter((h) => h.type === 'debit').reduce((n, h) => n + Number(h.defaultAmount), 0);
      const cr = heads.filter((h) => h.type === 'credit').reduce((n, h) => n + Number(h.defaultAmount), 0);
      expect(dr).toBe(cr);
    });
  });

  describe('what it refuses to write', () => {
    it('skips a voucher with no usable number instead of inventing one', () => {
      // voucher_No is INTEGER NOT NULL and voucher_Id NOT NULL. An invented
      // number collides with a real voucher.
      const plan = planVouchers([voucher({ VoucherNo: null })], context({ details: lines() }));

      expect(plan.toCreate).toHaveLength(0);
      expect(plan.problems.unnumbered).toEqual([900]);
    });

    it('skips a voucher with no detail lines', () => {
      const plan = planVouchers([voucher()], context({ details: [] }));

      expect(plan.toCreate).toHaveLength(0);
      expect(plan.problems.withoutLines).toEqual([900]);
    });

    it('counts a line whose account is not in the chart', () => {
      const detail = [{ Id: 1, VoucherId: 900, COAAccountId: 999999, DebitVC: 1, CreditVC: 0, DebitLC: 1, CreditLC: 0 }];
      const plan = planVouchers([voucher()], context({ details: detail }));
      expect(plan.stats.unresolvedAccounts).toBe(1);
    });
  });

  describe('re-running', () => {
    it('skips a voucher already imported', () => {
      const plan = planVouchers([voucher()], context({
        details: lines(), existingClimaxIds: ['900'],
      }));
      expect(plan.stats.alreadyImported).toBe(1);
      expect(plan.toCreate).toHaveLength(0);
    });

    it('reports the same id twice in one batch', () => {
      const plan = planVouchers([voucher(), voucher()], context({ details: lines() }));
      expect(plan.problems.duplicateClimaxIds).toEqual([900]);
      expect(plan.canApply).toBe(false);
    });
  });
});

describe('ledger migration planner - settlements', () => {
  const sContext = (over = {}) => ({
    existingClimaxIds: [],
    invoiceByKey: new Map([
      ['JobInvoice|1', { id: 77, payType: 'Recievable', total: '1170' }],
      ['JobBill|1', { id: 88, payType: 'Payble', total: '900' }],
    ]),
    voucherByHead: new Map([['5001', 900]]),
    invoiceRefs: [
      { glInvoiceId: '8836', table: 'JobInvoice', legacyId: '1' },
      { glInvoiceId: '8837', table: 'JobBill', legacyId: '1' },
    ],
    ...over,
  });

  const adj = (over = {}) => ({
    Id: 400, InvoiceId: 8836, GVDetailId: 5001, Amount: 500,
    InvAdjDate: '2022-08-01T00:00:00.000Z', AddOn: '2022-08-01T09:00:00.000Z',
    ...over,
  });

  it('resolves the invoice through the operational document, not the accounting id', () => {
    // GL_InvAdjustments.InvoiceId is a GL_Invoices id. Treating it as the
    // invoice's climaxId finds a real invoice belonging to someone else.
    const plan = planSettlements([adj()], sContext());

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].InvoiceId).toBe(77);
    expect(plan.stats.withoutInvoice).toBe(0);
  });

  it('reports a settlement whose invoice is not in Odyssey rather than guessing', () => {
    const plan = planSettlements([adj({ InvoiceId: 999999 })], sContext());

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.stats.withoutInvoice).toBe(1);
    expect(plan.problems.unknownInvoice).toEqual([400]);
  });

  it('finds its voucher through the head carrying the legacy detail id', () => {
    const plan = planSettlements([adj()], sContext());
    expect(plan.toCreate[0].VoucherId).toBe(900);
  });

  it('moves only the received side for a receivable', () => {
    // The old importer incremented paid AND recieved by the same amount, so
    // every settled invoice read as both.
    const plan = planSettlements([adj()], sContext());

    expect(plan.applyToInvoice).toEqual([{ id: 77, receivable: true, amount: 500 }]);
    expect(plan.stats.settledToReceivable).toBe(1);
    expect(plan.stats.settledToPayable).toBe(0);
  });

  it('moves only the paid side for a payable', () => {
    const plan = planSettlements([adj({ InvoiceId: 8837 })], sContext());

    expect(plan.applyToInvoice).toEqual([{ id: 88, receivable: false, amount: 500 }]);
    expect(plan.stats.settledToPayable).toBe(1);
  });

  it('adds up several settlements against one invoice into a single update', () => {
    const plan = planSettlements([adj(), adj({ Id: 401, Amount: 200 })], sContext());

    expect(plan.toCreate).toHaveLength(2);
    expect(plan.applyToInvoice).toEqual([{ id: 77, receivable: true, amount: 700 }]);
  });

  it('keeps two part-payments by the same voucher as two transactions', () => {
    // The old (invoice, voucher) duplicate guard collapsed these into one and
    // left the invoice reading as underpaid.
    const plan = planSettlements([adj(), adj({ Id: 401, Amount: 300 })], sContext());
    expect(plan.toCreate.map((x) => x.climaxId)).toEqual([400, 401]);
  });

  it('invents no exchange gain', () => {
    const plan = planSettlements([adj()], sContext());
    expect(plan.toCreate[0].gainLoss).toBe('0');
    expect(plan.toCreate[0].amount).toBe('500');
  });

  it('carries a reversal across as a negative', () => {
    const plan = planSettlements([adj({ Amount: -250 })], sContext());
    expect(plan.stats.negativeAmount).toBe(1);
    expect(plan.applyToInvoice[0].amount).toBe(-250);
  });

  it('skips a settlement already imported', () => {
    const plan = planSettlements([adj()], sContext({ existingClimaxIds: ['400'] }));
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate).toHaveLength(0);
  });
});

describe('which screen a voucher lands on', () => {
  /* Payments & Receipts lists `type IN ('Job Payment','Job Reciept')`; the
   * Voucher List lists everything else. So the type is a claim about whether
   * this voucher SETTLES A DOCUMENT, and only GL_InvAdjustments knows that -
   * which is why the legacy server sends the settled detail ids with the page.
   */
  it('sends a receipt that settles an invoice to Payments & Receipts', () => {
    const plan = planVouchers([voucher()], context({
      details: lines(),
      // 5001 is the party line of this voucher - see lines().
      settledDetailIds: [5001],
    }));
    expect(plan.toCreate[0].voucher.type).toBe('Job Reciept');
    expect(plan.stats.settlesInvoice).toBe(1);
  });

  it('leaves one that settles nothing in the Voucher List', () => {
    // The bug: on CargoLinkers 7,525 vouchers carried a payment/receipt type
    // code and only 136 settled anything.
    const plan = planVouchers([voucher()], context({
      details: lines(),
      settledDetailIds: [],
    }));
    expect(plan.toCreate[0].voucher.type).toBe('BANK RECEIPT VOUCHER');
    expect(plan.stats.settlesInvoice).toBe(0);
  });

  it('matches on ANY line of the voucher, not just the first', () => {
    // GL_InvAdjustments points at the line that moved the money, which is not
    // reliably the party line.
    const plan = planVouchers([voucher()], context({
      details: lines(),
      settledDetailIds: [5002],
    }));
    expect(plan.toCreate[0].voucher.type).toBe('Job Reciept');
  });

  it("does not credit one voucher with another voucher's settlement", () => {
    const plan = planVouchers([voucher()], context({
      details: lines(),
      settledDetailIds: [9999],
    }));
    expect(plan.toCreate[0].voucher.type).toBe('BANK RECEIPT VOUCHER');
  });

  it('reads as settling nothing when the sender omits the field', () => {
    // An older legacy server. The safe direction - the Voucher List shows
    // everything that is not a settlement, so nothing becomes unreachable.
    const plan = planVouchers([voucher()], context({ details: lines() }));
    expect(plan.toCreate[0].voucher.type).toBe('BANK RECEIPT VOUCHER');
  });
});

/* The real case: SNS's transfer voucher of 7 Mar 2024 (legacy 21640), the only
 * voucher in the freight book Climax never numbered. SNS's TVs for /24 skip
 * 31, 32 and 33 between 00030 (28 Feb) and 00034 (15 Mar). */
describe('numbering the vouchers Climax never numbered', () => {
  const TV = { Id: 11, TypeCode: 'TV', VoucherType: 'TRANSFER VOUCHER' };
  const tv = (seq, date, over = {}) => ({
    CompanyId: 1, vType: 'TV', voucher_Id: `SNS-TV-${String(seq).padStart(5, '0')}/24`,
    tranDate: `${date}T00:00:00.000Z`, ...over,
  });
  const sns = [
    tv(28, '2024-02-13'), tv(30, '2024-02-28'), tv(34, '2024-03-15'), tv(35, '2024-03-15'),
    // Another company's TVs and another type in the same year must not count.
    tv(31, '2024-03-01', { CompanyId: 3, voucher_Id: 'ACS-TV-00031/24' }),
    tv(31, '2024-03-01', { vType: 'BPV', voucher_Id: 'SNS-BPV-00031/24' }),
  ];
  const ctx = (existing = sns) => ({
    existing,
    companies: new Map([['2', 1], ['3', 3]]),
    voucherTypes: new Map([['11', TV]]),
  });
  const unnumbered = (over = {}) => ({
    Id: 21640, VoucherNo: '', VoucherDate: '2024-03-07T00:00:00.000Z', VoucherTypeId: 11, SubCompanyId: 2, ...over,
  });

  it('fills the gap it sits in, laid out like its neighbours', () => {
    const { assigned, unresolved } = assignGapNumbers([unnumbered()], ctx());
    expect(unresolved).toEqual([]);
    expect(assigned).toEqual([{ legacyId: 21640, VoucherNo: 'SNS-TV-00031/24' }]);
  });

  it('gives two vouchers in one gap two numbers, in date order', () => {
    const { assigned } = assignGapNumbers([
      unnumbered({ Id: 2, VoucherDate: '2024-03-09T00:00:00.000Z' }),
      unnumbered({ Id: 1 }),
    ], ctx());
    expect(assigned).toEqual([
      { legacyId: 1, VoucherNo: 'SNS-TV-00031/24' },
      { legacyId: 2, VoucherNo: 'SNS-TV-00032/24' },
    ]);
  });

  it('never takes a number someone holds', () => {
    const { assigned } = assignGapNumbers([unnumbered()], ctx([...sns, tv(31, '2024-03-20')]));
    expect(assigned[0].VoucherNo).toBe('SNS-TV-00032/24');
  });

  it('comes after the last of the year when there is no gap', () => {
    const { assigned } = assignGapNumbers([unnumbered({ VoucherDate: '2024-03-20T00:00:00.000Z' })], ctx());
    expect(assigned[0].VoucherNo).toBe('SNS-TV-00036/24');
  });

  it('parses the result as any other number', () => {
    const { sequenceFromNumber } = require('../../functions/ledgerMapping');
    expect(sequenceFromNumber('SNS-TV-00031/24')).toBe('31');
  });

  it('works for a book with no company in its numbers', () => {
    // CargoLinkers: BPV-00001/25.
    const existing = [tv(4, '2024-03-01', { voucher_Id: 'TV-00004/24' }), tv(6, '2024-03-10', { voucher_Id: 'TV-00006/24' })];
    const { assigned } = assignGapNumbers([unnumbered()], ctx(existing));
    expect(assigned[0].VoucherNo).toBe('TV-00005/24');
  });

  it('refuses rather than guesses when it sits between two fiscal years', () => {
    const existing = [tv(90, '2024-06-28'), tv(1, '2024-07-02', { voucher_Id: 'SNS-TV-00001/25' })];
    const { assigned, unresolved } = assignGapNumbers(
      [unnumbered({ VoucherDate: '2024-06-30T00:00:00.000Z' })], ctx(existing),
    );
    expect(assigned).toEqual([]);
    expect(unresolved[0].reason).toMatch(/between fiscal years/);
  });

  it('refuses an unknown company or type, or one with nothing to follow', () => {
    const { unresolved } = assignGapNumbers([
      unnumbered({ Id: 1, SubCompanyId: 9 }),
      unnumbered({ Id: 2, VoucherTypeId: 99 }),
      unnumbered({ Id: 3 }),
    ], ctx([]));
    expect(unresolved.map((u) => u.legacyId)).toEqual([1, 2, 3]);
  });
});
