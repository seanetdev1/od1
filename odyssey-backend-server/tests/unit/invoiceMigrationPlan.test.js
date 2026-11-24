const {
  planInvoices,
  sequenceOf,
  operationOf,
  typeForAgent,
  groupLinks,
  totalOf,
  amountsContradict,
} = require('../../functions/invoiceMigrationPlan');

/** A job-linked legacy invoice, shaped like the real export. */
const invoice = (over = {}) => ({
  Id: 500,
  TranNumber: 'ACS-JI-123/24',
  TranDate: '2024-03-05T00:00:00.000Z',
  InvoiceDate: '2024-03-01T00:00:00.000Z',
  SEJobId: 90,
  PartyId: 811,
  SubCompanyId: 3,
  // 1 is live. Anything else is an invoice that was emptied - see LIVE_STATUS.
  InvoiceStatusId: 1,
  InvoiceCurrencyId: 1,
  ExchangeRate: 1,
  TotalAmount: 1000,
  NetAmount: 1000,
  TaxAmount: 170,
  NetInclTaxAmount: 1170,
  InvoiceRemarks: 'Freight',
  ...over,
});

const context = (over = {}) => ({
  existingClimaxIds: [],
  jobIdByLegacyId: new Map([['SE|90', 7]]),
  chargeHeadByKey: new Map(),
  parties: new Map([['811', { id: 42, name: 'ACME' }]]),
  companies: new Map([['3', 1]]),
  currencies: new Map([['1', 'PKR'], ['2', 'USD']]),
  links: [],
  parentKey: 'JobInvoiceId',
  ...over,
});

describe('invoice migration planner', () => {
  describe('invoice numbers', () => {
    it('reads the sequence out of the real number formats', () => {
      expect(sequenceOf('ACS-JI-123/24')).toBe('123');
      expect(sequenceOf('ACS-OJI-1/23')).toBe('1');
      expect(sequenceOf('SNS-AI-0045/19')).toBe('45');
    });

    it('does not return an empty string for an all-zero sequence', () => {
      // "".replace(/^0+/) is '', and a falsy invoice_Id reads as missing.
      expect(sequenceOf('ACS-JI-000/24')).toBe('0');
    });

    it('is null rather than wrong when there is no number to read', () => {
      expect(sequenceOf(null)).toBeNull();
      expect(sequenceOf('   ')).toBeNull();
      expect(sequenceOf('ACS-JI-/24')).toBeNull();
    });
  });

  describe('which legacy columns are read', () => {
    it('reads a job bill from the Bill* columns, not the Invoice* ones', () => {
      // GL_JobBill calls them BillCurrencyId / BillDate / BillRemarks. Reading
      // InvoiceCurrencyId off it does not fail - it returns undefined, and
      // every one of the 15,725 bills lands with a null currency and no date.
      const bill = {
        Id: 600,
        TranNumber: 'ACS-JB-9/24',
        TranDate: '2024-05-09T00:00:00.000Z',
        BillDate: '2024-05-01T00:00:00.000Z',
        BillCurrencyId: 2,
        BillStatusId: 1,
        BillRemarks: 'Trucking',
        SEJobId: 90,
        PartyId: 811,
        SubCompanyId: 3,
        ExchangeRate: 280,
        NetAmount: 500,
        NetInclTaxAmount: 500,
      };

      const plan = planInvoices([bill], 'JobBill', context({ parentKey: 'JobBillId' }));
      const [row] = plan.toCreate;

      expect(row.currency).toBe('USD');
      expect(row.note).toBe('Trucking');
      expect(row.createdAt).toBe('2024-05-01T00:00:00.000Z');
      expect(plan.stats.unresolvedCurrency).toBe(0);
    });

    it('prefers the invoice date over the posting date', () => {
      const plan = planInvoices([invoice()], 'JobInvoice', context());
      expect(plan.toCreate[0].createdAt).toBe('2024-03-01T00:00:00.000Z');
    });

    it('falls back to the posting date when the invoice date is absent', () => {
      const plan = planInvoices([invoice({ InvoiceDate: null })], 'JobInvoice', context());
      expect(plan.toCreate[0].createdAt).toBe('2024-03-05T00:00:00.000Z');
    });
  });

  describe('the amount', () => {
    it('bills what the party owes, tax included', () => {
      expect(totalOf({ NetInclTaxAmount: 1170, NetAmount: 1000, TotalAmount: 1000 })).toBe(1170);
    });

    it('falls back when there was no tax to include', () => {
      expect(totalOf({ NetInclTaxAmount: null, NetAmount: 900, TotalAmount: 1000 })).toBe(900);
      expect(totalOf({ NetInclTaxAmount: null, NetAmount: null, TotalAmount: 1000 })).toBe(1000);
      expect(totalOf({})).toBe(0);
    });
  });

  describe('opening balances', () => {
    const opening = (over = {}) => invoice({
      Id: 1, TranNumber: 'ACS-OJI-1/23', SEJobId: null, OperationTypeId: 4, ...over,
    });

    it('imports one as an opening, with no job and never as an orphan', () => {
      // 7,775 of the 40,026 are cutover balances. Nothing is missing - they
      // never had a job - so calling them orphans would send someone looking
      // for jobs that do not exist.
      const plan = planInvoices([opening(), invoice()], 'JobInvoice', context());

      expect(plan.stats.openingBalances).toBe(1);
      expect(plan.stats.orphaned).toBe(0);
      expect(plan.problems.orphaned).toEqual([]);
      expect(plan.toCreate).toHaveLength(2);

      const row = plan.toCreate.find((r) => r.climaxId === '1');
      expect(row.type).toBe('Opening Invoice');
      expect(row.payType).toBe('Recievable');
      expect(row.partyType).toBe('client');
      expect(row.SEJobId).toBeNull();
    });

    it('types a bill opening as an Opening Bill', () => {
      const plan = planInvoices(
        [opening({ TranNumber: 'ACS-OJB-1/23', BillCurrencyId: 1, BillStatusId: 1 })],
        'JobBill',
        context({ parentKey: 'JobBillId' }),
      );
      expect(plan.toCreate[0].type).toBe('Opening Bill');
      expect(plan.toCreate[0].payType).toBe('Payble');
      expect(plan.toCreate[0].partyType).toBe('vendor');
    });

    it('sides an agent opening from DebitCreditId, since it has no lines', () => {
      const plan = planInvoices(
        [opening({ TranNumber: 'SNS-OA-1/23', OverseasAgentId: 811, PartyId: null, DebitCreditId: 3 })],
        'AgentInvoice',
        context({ parentKey: 'AgentInvoiceId' }),
      );
      expect(plan.toCreate[0].type).toBe('Opening Bill');
      expect(plan.toCreate[0].payType).toBe('Payble');
      expect(plan.toCreate[0].partyType).toBe('agent');
    });

    it('reads the trade from OperationTypeId, which is all an opening has', () => {
      // Decoded from the job-linked invoices, where the id and the populated
      // job column can be compared: 1 AI, 2 AE, 3 SI, 4 SE.
      const plan = planInvoices([
        opening({ Id: 1, OperationTypeId: 4 }),
        opening({ Id: 2, OperationTypeId: 2 }),
        opening({ Id: 3, OperationTypeId: 1 }),
      ], 'JobInvoice', context());

      expect(plan.toCreate.map((r) => r.operation)).toEqual(['SE', 'AE', 'AI']);
    });

    it('leaves the trade empty rather than guessing an unknown code', () => {
      // 185 agent openings carry OperationTypeId 7, which never appears on a
      // job-linked invoice, so nothing can teach us what it means.
      const plan = planInvoices([opening({ OperationTypeId: 7 })], 'JobInvoice', context());

      expect(plan.toCreate[0].operation).toBeNull();
      expect(plan.stats.openingsWithoutOperation).toBe(1);
    });

    it('imports an opening approved, so it can be settled', () => {
      // /invoice/getAllInvoicesByPartyId builds the payment-allocation list
      // and filters on approved '1'. Unapproved, 1.3bn of carried-in balances
      // could not be paid without approving 7,775 rows by hand.
      const plan = planInvoices([opening()], 'JobInvoice', context());
      expect(plan.toCreate[0].approved).toBe('1');
    });

    it('carries a credit note across as a negative, not flipped', () => {
      const plan = planInvoices([
        opening({ NetInclTaxAmount: -5000, NetAmount: -5000, TotalAmount: -5000 }),
      ], 'JobInvoice', context());

      expect(plan.toCreate[0].total).toBe('-5000');
      expect(plan.stats.negativeAmounts).toBe(1);
    });

    it('does not report an opening as a status/content mismatch', () => {
      // An opening is live and carries no lines. That is its shape, not a
      // fault - the mismatch check is about job invoices.
      const plan = planInvoices([opening()], 'JobInvoice', context());
      expect(plan.problems.statusContentMismatch).toEqual([]);
    });

    it('still reports an invoice whose job is genuinely missing', () => {
      const plan = planInvoices([invoice({ SEJobId: 9999 })], 'JobInvoice', context());

      expect(plan.stats.orphaned).toBe(1);
      expect(plan.stats.openingBalances).toBe(0);
      expect(plan.problems.orphaned).toContain(500);
      expect(plan.toCreate).toHaveLength(0);
    });

    it('separates a clearing-job invoice from both', () => {
      const lg = invoice({ SEJobId: null, LGJobId: 3 });
      const plan = planInvoices([lg], 'JobInvoice', context());

      expect(plan.stats.onLogisticsJobs).toBe(1);
      expect(plan.stats.orphaned).toBe(0);
      expect(plan.stats.openingBalances).toBe(0);
    });

    it('imports a clearing-job invoice, with a null job', () => {
      // Invoice has SEJobId and no customs equivalent: a clearance invoice
      // reaches its declaration through its charge lines
      // (Charge_Heads.CustomsJobId), which customsInvoiceContext resolves in
      // reverse for the reports.
      //
      // So it must NOT be skipped - it used to be, which discards the whole
      // sales and purchase ledger on a clearing agent's database - and it must
      // NOT be demoted to an opening balance, because it is a real invoice
      // against a real job.
      const lg = invoice({ SEJobId: null, LGJobId: 3 });
      const plan = planInvoices([lg], 'JobInvoice', context());

      expect(plan.toCreate).toHaveLength(1);
      const row = plan.toCreate[0].invoice ?? plan.toCreate[0];
      expect(row.SEJobId).toBeNull();
      expect(row.type).toBe('Job Invoice');
      expect(row.payType).toBe('Recievable');
    });

    it('follows a clearing charge line to its invoice', () => {
      // The two LG junction columns used to fall through every case in
      // LINE_COLUMNS and be counted as dropped.
      const { groupLinks } = require('../../functions/invoiceMigrationPlan');
      const { byInvoice, logisticsLines } = groupLinks(
        [{ JobInvoiceId: 7, LGJobChargesRecvId: 42 }], 'JobInvoiceId',
      );
      expect(logisticsLines).toBe(0);
      expect(byInvoice.get('7').lines).toEqual([{ legacyId: 42, operation: 'LG', side: 'Recv' }]);
    });
  });

  describe('the operation an invoice belongs to', () => {
    it('reads it from whichever job column is populated', () => {
      expect(operationOf({ AEJobId: 12 })).toEqual({ operation: 'AE', legacyJobId: 12 });
      expect(operationOf({ SIJobId: 3 })).toEqual({ operation: 'SI', legacyJobId: 3 });
      expect(operationOf({})).toEqual({ operation: null, legacyJobId: null });
    });

    it('will not match a legacy job id from another operation', () => {
      // Legacy job ids are only unique within their own table, so job 90 exists
      // as a sea export and as an air export and they are different shipments.
      const air = invoice({ SEJobId: null, AEJobId: 90 });
      const plan = planInvoices([air], 'JobInvoice', context());

      expect(plan.stats.orphaned).toBe(1);
      expect(plan.toCreate).toHaveLength(0);
    });
  });

  describe('the type strings the UI matches on', () => {
    it('uses the misspellings, because the screens filter on them exactly', () => {
      const plan = planInvoices([invoice()], 'JobInvoice', context());
      expect(plan.toCreate[0].type).toBe('Job Invoice');
      expect(plan.toCreate[0].payType).toBe('Recievable');
      expect(plan.toCreate[0].partyType).toBe('client');
    });

    it('types a bill payable', () => {
      const plan = planInvoices(
        [invoice({ Id: 2, TranNumber: 'ACS-JB-1/24' })],
        'JobBill',
        context({ parentKey: 'JobBillId' }),
      );
      expect(plan.toCreate[0].type).toBe('Job Bill');
      expect(plan.toCreate[0].payType).toBe('Payble');
      expect(plan.toCreate[0].partyType).toBe('vendor');
    });
  });

  describe('which direction an agent invoice runs', () => {
    // GL_AgentInvoice is the source of BOTH Agent Invoices and Agent Bills;
    // there is no GL_AgentBill table.
    it('takes it from the header, which is what DebitCreditId records', () => {
      expect(typeForAgent({}, 3)).toMatchObject({
        type: 'Agent Bill', payType: 'Payble', source: 'header',
      });
      expect(typeForAgent({}, 5)).toMatchObject({
        type: 'Agent Invoice', payType: 'Recievable', source: 'header',
      });
    });

    it('decides an invoice with no lines at all', () => {
      // 76 of them in the real data, every one a bill. Deriving direction from
      // the lines defaulted all 76 the wrong way.
      const agent = invoice({
        Id: 700, TranNumber: 'SNS-AI-4/24', OverseasAgentId: 811, PartyId: null,
        DebitCreditId: 3,
      });
      const plan = planInvoices([agent], 'AgentInvoice', context({ parentKey: 'AgentInvoiceId' }));

      expect(plan.toCreate).toHaveLength(1);
      expect(plan.toCreate[0].type).toBe('Agent Bill');
      expect(plan.toCreate[0].payType).toBe('Payble');
      expect(plan.toCreate[0].party_Id).toBe('42');
      expect(plan.stats.agentDirectionUndecided).toBe(0);
    });

    it('decides an invoice carrying both sides, and still reports it', () => {
      const decided = typeForAgent({ Recv: 4, Payb: 1 }, 3);
      expect(decided).toMatchObject({ type: 'Agent Bill', mixed: true, source: 'header' });
    });

    it('reports a header that contradicts its own lines', () => {
      // Does not happen in the current data. If it starts to, the
      // DebitCreditId mapping is what needs revisiting - so it is surfaced
      // rather than resolved silently.
      const decided = typeForAgent({ Recv: 3 }, 3);
      expect(decided.conflict).toBe(true);
      expect(decided.type).toBe('Agent Bill');
    });

    it('falls back to the lines when DebitCreditId is not one it knows', () => {
      expect(typeForAgent({ Payb: 2 }, 99)).toMatchObject({
        type: 'Agent Bill', payType: 'Payble', source: 'lines',
      });
      expect(typeForAgent({ Recv: 2 }, undefined)).toMatchObject({
        type: 'Agent Invoice', source: 'lines',
      });
    });

    it('counts an agent invoice it cannot decide at all', () => {
      const agent = invoice({ Id: 700, OverseasAgentId: 811, PartyId: null, DebitCreditId: 99 });
      const plan = planInvoices([agent], 'AgentInvoice', context({ parentKey: 'AgentInvoiceId' }));

      expect(plan.stats.agentDirectionUndecided).toBe(1);
      expect(plan.toCreate[0].type).toBe('Agent Invoice');
    });

    it('reads the agent from OverseasAgentId, which is the only party column it has', () => {
      const agent = invoice({ Id: 700, OverseasAgentId: 811, PartyId: null, DebitCreditId: 5 });
      const plan = planInvoices([agent], 'AgentInvoice', context({ parentKey: 'AgentInvoiceId' }));

      expect(plan.toCreate[0].party_Name).toBe('ACME');
      expect(plan.stats.unresolvedParty).toBe(0);
    });
  });

  describe('the junction rows', () => {
    it('decodes operation and side from the column the id arrived in', () => {
      const { byInvoice } = groupLinks([
        { JobInvoiceId: 1, SEJobChargesRecvId: 10 },
        { JobInvoiceId: 1, AEJobChargesRecvId: 10 },
      ], 'JobInvoiceId');

      expect(byInvoice.get('1').lines).toEqual([
        { legacyId: 10, operation: 'SE', side: 'Recv' },
        { legacyId: 10, operation: 'AE', side: 'Recv' },
      ]);
    });

    it('counts a junction row with no charge column as a logistics line', () => {
      // 16,779 of them: they carry LGJobChargesRecvId, which this stage does
      // not request. Counted so the lgJobs stage has a number to hit.
      const { logisticsLines } = groupLinks(
        [{ JobInvoiceId: 1 }, { JobInvoiceId: 1, SEJobChargesRecvId: 10 }],
        'JobInvoiceId',
      );
      expect(logisticsLines).toBe(1);
    });

    it('attaches only the charge line that matches on operation, side and id', () => {
      // The collision that silently dropped 38,000 lines from the charge-line
      // stage: id 10 exists as a sea-export receivable AND an air-export one.
      const plan = planInvoices([invoice()], 'JobInvoice', context({
        links: [{ JobInvoiceId: 500, SEJobChargesRecvId: 10 }],
        chargeHeadByKey: new Map([
          ['SE|Recievable|10', 111],
          ['AE|Recievable|10', 222],
          ['SE|Payble|10', 333],
        ]),
      }));

      expect(plan.linkPlan[0].chargeHeadIds).toEqual([111]);
      expect(plan.stats.linesLinked).toBe(1);
      expect(plan.stats.linesUnresolved).toBe(0);
    });

    it('counts a named line that is not in Odyssey instead of silently dropping it', () => {
      const plan = planInvoices([invoice()], 'JobInvoice', context({
        links: [{ JobInvoiceId: 500, SEJobChargesRecvId: 10 }],
        chargeHeadByKey: new Map(),
      }));

      expect(plan.stats.linesUnresolved).toBe(1);
      expect(plan.stats.linesLinked).toBe(0);
      expect(plan.linkPlan[0].chargeHeadIds).toEqual([]);
    });

    it('counts lines whose invoice this batch will not create', () => {
      const plan = planInvoices([invoice({ SEJobId: 9999 })], 'JobInvoice', context({
        links: [{ JobInvoiceId: 500, SEJobChargesRecvId: 10 }],
      }));

      expect(plan.stats.linesWithoutInvoiceRow).toBe(1);
    });

    it('carries the invoice number so the job list can count invoices and bills', () => {
      // The job list counts with invoice_id LIKE '%I%' and LIKE '%B%'.
      const plan = planInvoices([invoice()], 'JobInvoice', context({
        links: [{ JobInvoiceId: 500, SEJobChargesRecvId: 10 }],
        chargeHeadByKey: new Map([['SE|Recievable|10', 111]]),
      }));

      expect(plan.linkPlan[0].invoice_No).toBe('ACS-JI-123/24');
      expect(plan.linkPlan[0].invoice_No).toMatch(/I/);
      expect(plan.linkPlan[0].invoice_No).not.toMatch(/B/);
    });
  });

  describe('cancelled invoices', () => {
    // 451 legacy invoices were emptied rather than deleted: no charge lines,
    // zero amount, but they keep their number, their remarks and their ledger
    // references. Status 1 means live and nothing else does - across 32,251
    // invoices that rule has no exception in either direction.
    it('imports one unapproved, so nothing offers it for settlement', () => {
      const dead = invoice({
        InvoiceStatusId: 2, NetInclTaxAmount: 0, NetAmount: 0, TotalAmount: 0,
      });
      const plan = planInvoices([dead], 'JobInvoice', context());

      expect(plan.stats.cancelled).toBe(1);
      expect(plan.toCreate).toHaveLength(1);
      expect(plan.toCreate[0].approved).toBe('0');
      expect(plan.toCreate[0].total).toBe('0');
      // Odyssey's status '2' means "available for settlement", which is not
      // this. The legacy status is deliberately NOT copied across.
      expect(plan.toCreate[0].status).toBe('1');
    });

    it('leaves a live invoice approved', () => {
      const plan = planInvoices([invoice({ InvoiceStatusId: 1 })], 'JobInvoice', context({
        links: [{ JobInvoiceId: 500, SEJobChargesRecvId: 10 }],
      }));

      expect(plan.stats.cancelled).toBe(0);
      expect(plan.toCreate[0].approved).toBe('1');
    });

    it('reads a bill status from BillStatusId', () => {
      const dead = {
        Id: 600, TranNumber: 'ACS-JB-9/24', BillDate: '2024-05-01T00:00:00.000Z',
        BillCurrencyId: 1, BillStatusId: 2, SEJobId: 90, PartyId: 811,
        SubCompanyId: 3, ExchangeRate: 1, NetAmount: 0,
      };
      const plan = planInvoices([dead], 'JobBill', context({ parentKey: 'JobBillId' }));

      expect(plan.stats.cancelled).toBe(1);
      expect(plan.toCreate[0].approved).toBe('0');
    });

    it('reports a live invoice that carries no lines', () => {
      // The rule holding is what makes "cancelled" safe to infer. If a live
      // invoice turns up empty, it is a total with no breakdown behind it.
      const plan = planInvoices([invoice({ InvoiceStatusId: 1 })], 'JobInvoice', context());
      expect(plan.problems.statusContentMismatch).toEqual([500]);
    });

    it('reports a cancelled invoice that still carries lines', () => {
      const plan = planInvoices([invoice({ InvoiceStatusId: 2 })], 'JobInvoice', context({
        links: [{ JobInvoiceId: 500, SEJobChargesRecvId: 10 }],
      }));
      expect(plan.problems.statusContentMismatch).toEqual([500]);
    });
  });

  describe('an invoice whose own amounts contradict each other', () => {
    // Job bill ACS-JB-143/23: the header says 829,677.12 while its single
    // charge line, its voucher, its voucher detail and its GL_Invoices row all
    // say 3,650. At rate 1 the net and the local amount are the same figure.
    it('reports it, and does not silently correct the money', () => {
      const broken = invoice({
        ExchangeRate: 1, NetAmount: 829677.12, NetInclTaxAmount: 829677.12,
        TotalAmount: 829677.12, LocalAmount: 3650,
      });
      const plan = planInvoices([broken], 'JobInvoice', context());

      expect(plan.problems.contradictoryAmounts).toEqual([{
        climaxId: 500,
        invoice_No: 'ACS-JI-123/24',
        imported: 829677.12,
        localAmount: 3650,
      }]);
      // Reported, not overridden.
      expect(plan.toCreate[0].total).toBe('829677.12');
    });

    it('says nothing when the two agree', () => {
      const ok = invoice({ ExchangeRate: 1, NetInclTaxAmount: 1170, LocalAmount: 1170 });
      expect(planInvoices([ok], 'JobInvoice', context()).problems.contradictoryAmounts)
        .toEqual([]);
    });

    it('does not flag a foreign-currency invoice', () => {
      // Each charge line carries its own ExchRateLine, so a multi-line foreign
      // invoice legitimately fails LocalAmount = net x header rate. Four agent
      // invoices in the real data do. Only rate 1 is an exact test.
      expect(amountsContradict(
        { ExchangeRate: 238.843384, LocalAmount: 566456.8595 }, 2853.5,
      )).toBe(false);
    });

    it('tolerates sub-rupee rounding', () => {
      expect(amountsContradict({ ExchangeRate: 1, LocalAmount: 1170.4 }, 1170)).toBe(false);
    });

    it('says nothing when there is no local amount to compare', () => {
      expect(amountsContradict({ ExchangeRate: 1, LocalAmount: null }, 1170)).toBe(false);
    });
  });

  describe('what it refuses to invent', () => {
    it('leaves settlement at zero rather than deriving it from the total', () => {
      const [row] = planInvoices([invoice()], 'JobInvoice', context()).toCreate;

      expect(row.paid).toBe('0');
      expect(row.recieved).toBe('0');
      expect(row.status).toBe('1');
      expect(row.total).toBe('1170');
    });
  });

  describe('re-running', () => {
    it('skips an invoice already imported', () => {
      const plan = planInvoices([invoice()], 'JobInvoice', context({
        existingClimaxIds: ['500'],
      }));

      expect(plan.stats.alreadyImported).toBe(1);
      expect(plan.toCreate).toHaveLength(0);
    });

    it('reports the same legacy id twice in one batch instead of writing it twice', () => {
      const plan = planInvoices([invoice(), invoice()], 'JobInvoice', context());

      expect(plan.problems.duplicateClimaxIds).toEqual([500]);
      expect(plan.toCreate).toHaveLength(1);
      expect(plan.canApply).toBe(false);
    });
  });

  it('rejects an unknown kind loudly', () => {
    expect(() => planInvoices([], 'Nonsense', context())).toThrow(/Unknown invoice kind/);
  });
});

/* party_Id is the party's LEDGER ACCOUNT on every invoice raised in Odyssey,
 * and approval posts the voucher's party line to it. Migrated invoices wrote
 * the Clients id instead: approving one failed on the voucher's account
 * foreign key (SNS-JI-426/27 - party 51, account 5307). */
describe('the invoice party', () => {
  it('is the party\'s ledger account, not the party', () => {
    const plan = planInvoices([invoice()], 'JobInvoice', context({
      parties: new Map([['811', { id: 51, name: 'EUR LOGISTICS', accountId: 5307 }]]),
    }));
    expect(plan.toCreate[0].party_Id).toBe('5307');
    expect(plan.toCreate[0].party_Name).toBe('EUR LOGISTICS');
  });

  it('falls back to the party when it has no single ledger account', () => {
    const plan = planInvoices([invoice()], 'JobInvoice', context({
      parties: new Map([['811', { id: 51, name: 'EUR LOGISTICS', accountId: null }]]),
    }));
    expect(plan.toCreate[0].party_Id).toBe('51');
  });
});
