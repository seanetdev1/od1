const { planChargeHeads, mapChargeHead, KINDS } = require('../../functions/chargeHeadMigrationPlan');

const recv = (Id, over = {}) => ({
  Id, SEJobId: 100, ChargesId: 5, CustomerId: 20, CurrencyId: 2,
  EquipCode: '40HC', PPCCId: 1, dDGNonDGId: 2,
  Quantity: 2, Rate: 150, Amount: 300, DiscountAmount: 0,
  TaxAmount: 51, IsTaxApply: true, NetAmount: 351,
  ExchRateClient: 280, LocalAmount: 98280,
  Description: 'Ocean freight', ApprovedBy: 'ADMIN', ApprovedOn: '2024-03-01',
  ...over,
});
const payb = (Id, over = {}) => ({
  Id, SEJobId: 100, ChargesId: 5, VendorId: 30, CurrencyId: 2,
  Quantity: 1, Rate: 100, Amount: 100, NetAmount: 100,
  ExchRateLine: 280, IsTaxApply: false, TaxAmount: 0, ...over,
});

const ctx = (over = {}) => ({
  existingClimaxIds: [],
  jobIdByLegacyId: new Map([['100', 'job-1']]),
  charges: new Map([['5', { id: 'charge-1', name: 'OCEAN FREIGHT', calculationType: 'Per Unit' }]]),
  parties: new Map([['20', { id: 'client-1', name: 'ACME LTD' }], ['30', { id: 'vendor-1', name: 'MAERSK' }]]),
  currencies: new Map([['2', 'USD']]),
  ...over,
});

describe('mapChargeHead - what the old import got wrong', () => {
  it('writes amount as the pricing multiplier, 1 - the money is in net and local', () => {
    // Climax's Amount is the line total. Stored in amount, Odyssey's
    // (amount x rate - discount) x qty priced the line as total x rate x qty:
    // ACS-JI-639/27's receivables came to 4.9 billion on Calculate.
    // An AIR line's price goes in Rate, which is what its grid edits.
    const m = mapChargeHead(recv(1, { Amount: 300 }), 'AirExportRecv', { ...ctx(), jobId: 'job-1' });
    expect(m.amount).toBe(1);
    expect(m.rate_charge).toBe(150);
    expect(m.net_amount).toBe(351);
  });

  it('puts a SEA line\'s price in Amount, which is the field its grid edits', () => {
    // The sea grid shows Amount and keeps rate_charge a hidden 1. With the
    // price in rate_charge the Amount column read 1, and anything typed into
    // it was multiplied by the hidden price.
    for (const kind of ['SeaExportRecv', 'SeaImportRecv']) {
      const m = mapChargeHead(recv(1, { Amount: 300 }), kind, { ...ctx(), jobId: 'job-1' });
      expect(m.amount).toBe(150);
      expect(m.rate_charge).toBe(1);
    }
    const p = mapChargeHead(payb(1), 'SeaExportPayb', { ...ctx(), jobId: 'job-1' });
    expect(p).toMatchObject({ amount: 100, rate_charge: 1 });
  });

  it('recalculates a sea line to exactly what Climax charged too', () => {
    // 3 x 40HC at 1,200 = 3,600, less a 300 line discount = 3,300.
    const row = recv(1, { Quantity: 3, Rate: 1200, Amount: 3600, DiscountAmount: 300, NetAmount: 3300 });
    const m = mapChargeHead(row, 'SeaExportRecv', { ...ctx(), jobId: 'job-1' });
    expect(Math.round((m.amount * m.rate_charge - m.discount) * m.qty * 100) / 100).toBe(3300);
  });

  it('recalculates to exactly what Climax charged', () => {
    // 1,230 kg at 3.4 = 4,182, less a 182 line discount = 4,000.
    const row = recv(1, { Quantity: 1230, Rate: 3.4, Amount: 4182, DiscountAmount: 182, NetAmount: 4000 });
    const m = mapChargeHead(row, 'AirExportRecv', { ...ctx(), jobId: 'job-1' });
    const recalculated = (m.amount * m.rate_charge - m.discount) * m.qty;
    expect(Math.round(recalculated * 100) / 100).toBe(4000);
  });

  it('leaves a line with no discount, or no quantity, as it is', () => {
    expect(mapChargeHead(recv(1, { DiscountAmount: 0 }), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' }).discount).toBe(0);
    expect(mapChargeHead(recv(1, { DiscountAmount: 50, Quantity: 0 }), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' }).discount).toBe(50);
  });

  it('reads the tax flag from the source instead of inferring it', () => {
    // TaxAmount > 0 makes a taxable line with zero tax read as non-taxable.
    expect(mapChargeHead(recv(1, { IsTaxApply: true, TaxAmount: 0 }), 'SeaExportRecv',
      { ...ctx(), jobId: 'job-1' }).tax_apply).toBe(true);
    expect(mapChargeHead(recv(1, { IsTaxApply: false, TaxAmount: 50 }), 'SeaExportRecv',
      { ...ctx(), jobId: 'job-1' }).tax_apply).toBe(false);
  });

  it('writes approval_date, the name the model declares', () => {
    // The old import wrote approved_date, which Sequelize dropped.
    const m = mapChargeHead(recv(1), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' });
    expect(m.approval_date).toBe('2024-03-01');
    expect(m.approved_by).toBe('ADMIN');
    expect(m.approved_date).toBeUndefined();
  });

  it('does not throw when the party is not in Odyssey', () => {
    // party.id was read unguarded, so one missing party took the whole job's
    // transaction down.
    const c = ctx({ parties: new Map() });
    expect(() => mapChargeHead(recv(1), 'SeaExportRecv', { ...c, jobId: 'job-1' })).not.toThrow();
    const m = mapChargeHead(recv(1), 'SeaExportRecv', { ...c, jobId: 'job-1' });
    expect(m.partyId).toBeNull();
    expect(m.name).toBeNull();
    expect(m.net_amount).toBe(351);    // the money still comes across
  });

  it('does not throw when the charge or currency is missing', () => {
    const c = ctx({ charges: new Map(), currencies: new Map() });
    const m = mapChargeHead(recv(1), 'SeaExportRecv', { ...c, jobId: 'job-1' });
    expect(m.charge).toBeNull();
    expect(m.particular).toBeNull();
    expect(m.basis).toBeNull();
    expect(m.currency).toBeNull();
  });
});

describe('mapChargeHead - payable vs receivable', () => {
  it('takes the party from CustomerId on receivable and VendorId on payable', () => {
    expect(mapChargeHead(recv(1), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' }).partyId)
      .toBe('client-1');
    expect(mapChargeHead(payb(1), 'SeaExportPayb', { ...ctx(), jobId: 'job-1' }).partyId)
      .toBe('vendor-1');
  });

  it('takes the exchange rate from the column each side uses', () => {
    expect(mapChargeHead(recv(1, { ExchRateClient: 280 }), 'SeaExportRecv',
      { ...ctx(), jobId: 'job-1' }).ex_rate).toBe(280);
    expect(mapChargeHead(payb(1, { ExchRateLine: 279 }), 'SeaExportPayb',
      { ...ctx(), jobId: 'job-1' }).ex_rate).toBe(279);
  });

  it('stamps the type with the exact strings every screen filters on', () => {
    // Both are misspelled in the schema, and that spelling is load-bearing:
    // the Payable tab passes type={"Payble"}, so a correctly-spelled
    // "Payable" imports the rows and shows none of them.
    expect(mapChargeHead(recv(1), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' }).type)
      .toBe('Recievable');
    expect(mapChargeHead(payb(1), 'SeaExportPayb', { ...ctx(), jobId: 'job-1' }).type)
      .toBe('Payble');
  });

  it('only ever emits the two type strings the UI knows', () => {
    for (const kind of Object.keys(KINDS)) {
      const row = kind.endsWith('Payb') ? payb(1) : recv(1);
      const m = mapChargeHead(row, kind, { ...ctx(), jobId: 'job-1' });
      expect(['Payble', 'Recievable']).toContain(m.type);
    }
  });

  it('reads the DG flag off the line, not the job', () => {
    expect(mapChargeHead(recv(1, { dDGNonDGId: 1 }), 'SeaExportRecv',
      { ...ctx(), jobId: 'job-1' }).dg_type).toBe('DG');
    expect(mapChargeHead(recv(1, { dDGNonDGId: 2 }), 'SeaExportRecv',
      { ...ctx(), jobId: 'job-1' }).dg_type).toBe('non-DG');
  });

  it('leaves only the invoice ROW link for the ledger stage', () => {
    // InvoiceId needs the Invoice rows; invoiceType does not.
    const m = mapChargeHead(recv(1), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' });
    expect(m.InvoiceId).toBeNull();
    expect(m.invoice_id).toBeNull();
  });
});

describe('invoiceType comes from the junction tables, not from invoices', () => {
  // The job P&L splits revenue from cost on invoiceType:
  //   revenue  invoiceType === 'Job Invoice' && type === 'Recievable'
  //   cost     invoiceType === 'Job Bill'    && type === 'Payble'
  // Leaving it null makes every imported line invisible to that calculation,
  // so cost reads as zero and the net is nonsense.
  it('marks a line referenced by GL_JobInvoice_Charges as a Job Invoice', () => {
    const m = mapChargeHead(recv(1), 'SeaExportRecv', {
      ...ctx(), jobId: 'job-1', jobInvoiceIds: new Set(['1']),
    });
    expect(m.invoiceType).toBe('Job Invoice');
    expect(m.partyType).toBe('client');
  });

  it('marks a line referenced by GL_JobBill_Charges as a Job Bill', () => {
    const m = mapChargeHead(payb(1), 'SeaExportPayb', {
      ...ctx(), jobId: 'job-1', jobBillIds: new Set(['1']),
    });
    expect(m.invoiceType).toBe('Job Bill');
    expect(m.partyType).toBe('vendor');
    // The exact pair the cost calculation tests for.
    expect(m.invoiceType === 'Job Bill' && m.type === 'Payble').toBe(true);
  });

  it('marks a line referenced by GL_AgentInvoice_Charges as an Agent Invoice', () => {
    const m = mapChargeHead(recv(1), 'SeaExportRecv', {
      ...ctx(), jobId: 'job-1', agentIds: new Set(['1']),
    });
    expect(m.invoiceType).toBe('Agent Invoice');
    expect(m.partyType).toBe('agent');
  });

  it('gives a line Climax never invoiced what the charge sheet would', () => {
    // As ChargesComp/PartySearch sets them when a party is chosen. Left null,
    // Auto Bill / Auto Agent Invoice skipped every payable Climax had not
    // billed, and the server had no document to put them on.
    const recvLine = mapChargeHead(recv(1), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' });
    expect(recvLine).toMatchObject({ invoiceType: 'Job Invoice', partyType: 'client' });
    const paybLine = mapChargeHead(payb(1), 'SeaExportPayb', { ...ctx(), jobId: 'job-1' });
    expect(paybLine).toMatchObject({ invoiceType: 'Job Bill', partyType: 'vendor' });
  });

  it('makes it an agent document when the party is an overseas agent', () => {
    const c = ctx({ parties: new Map([['20', { id: 'agent-1', name: 'ACME UK', types: 'Overseas Agent, Shipper' }],
      ['30', { id: 'agent-2', name: 'MAERSK UK', types: 'Overseas Agent' }]]) });
    expect(mapChargeHead(recv(1), 'AirExportRecv', { ...c, jobId: 'job-1' }))
      .toMatchObject({ invoiceType: 'Agent Invoice', partyType: 'agent' });
    expect(mapChargeHead(payb(1), 'AirExportPayb', { ...c, jobId: 'job-1' }))
      .toMatchObject({ invoiceType: 'Agent Bill', partyType: 'agent' });
  });

  it('leaves a customs line on no document - its own sheet bills it', () => {
    const m = mapChargeHead(recv(1), 'CustomsRecv', { ...ctx(), jobId: 'job-1' });
    expect(m.invoiceType).toBeNull();
    expect(m.partyType).toBeNull();
  });

  it('does not approve a never-invoiced line just because it now has a type', () => {
    expect(mapChargeHead(recv(1, { IsApproved: false }), 'SeaExportRecv', { ...ctx(), jobId: 'job-1' }).status).toBe(0);
  });

  it('does not need any invoice to exist to decide this', () => {
    // The whole point: the totals work before the ledger stage runs.
    const m = mapChargeHead(payb(1), 'SeaExportPayb', {
      ...ctx(), jobId: 'job-1', jobBillIds: new Set(['1']),
    });
    expect(m.invoiceType).toBe('Job Bill');
    expect(m.InvoiceId).toBeNull();
  });

  it('counts how many lines sit on each document', () => {
    const plan = planChargeHeads([recv(1), recv(2), recv(3)], 'SeaExportRecv', {
      ...ctx(), jobInvoiceIds: new Set(['1']), agentIds: new Set(['2']),
    });
    // Line 3 was never invoiced; it is a Job Invoice line all the same.
    expect(plan.documents['Job Invoice']).toBe(2);
    expect(plan.documents['Agent Invoice']).toBe(1);
    expect(plan.stats.withoutDocument).toBe(0);
  });
});

describe('planChargeHeads', () => {
  it('attaches every line to its job', () => {
    const plan = planChargeHeads([recv(1), recv(2)], 'SeaExportRecv', ctx());
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toCreate.every((r) => r.SEJobId === 'job-1')).toBe(true);
  });

  it('uses the right job column per kind', () => {
    // An AE line carries AEJobId; reading SEJobId would orphan every row.
    const plan = planChargeHeads(
      [{ Id: 1, AEJobId: 100, ChargesId: 5, CustomerId: 20 }], 'AirExportRecv', ctx(),
    );
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.problems.orphaned).toEqual([]);
  });

  it('skips a line whose job is not in Odyssey', () => {
    const plan = planChargeHeads([recv(1), recv(2, { SEJobId: 999 })], 'SeaExportRecv', ctx());
    expect(plan.problems.orphaned).toEqual([999]);
    expect(plan.toCreate).toHaveLength(1);
  });

  it('skips lines already imported', () => {
    const plan = planChargeHeads([recv(1), recv(2)], 'SeaExportRecv', ctx({ existingClimaxIds: [1] }));
    expect(plan.stats.alreadyImported).toBe(1);
    expect(plan.toCreate.map((r) => r.climaxId)).toEqual([2]);
  });

  it('counts unresolved links per relationship', () => {
    const plan = planChargeHeads([recv(1), recv(2)], 'SeaExportRecv',
      ctx({ charges: new Map(), parties: new Map() }));
    expect(plan.stats.unresolvedCharge).toBe(2);
    expect(plan.stats.unresolvedParty).toBe(2);
    expect(plan.canApply).toBe(true);
  });

  it('totals the net amount so the run can be reconciled', () => {
    // A row count cannot tell you the money came across intact.
    const plan = planChargeHeads(
      [recv(1, { NetAmount: 100 }), recv(2, { NetAmount: 250.5 })], 'SeaExportRecv', ctx(),
    );
    expect(plan.stats.netAmount).toBe(350.5);
  });

  it('counts rows with no id, no job reference, and duplicates', () => {
    const plan = planChargeHeads(
      [null, { Id: 5 }, recv(2), recv(2)], 'SeaExportRecv', ctx(),
    );
    expect(plan.problems.missingId).toBe(1);
    expect(plan.problems.missingJobRef).toBe(1);
    expect(plan.problems.duplicateClimaxIds).toEqual([2]);
  });

  it('refuses an unknown kind', () => {
    expect(() => planChargeHeads([], 'Nonsense', ctx())).toThrow(/Unknown charge-line kind/);
  });

  it('covers all ten legacy tables - eight freight, two customs', () => {
    expect(Object.keys(KINDS)).toHaveLength(10);
    for (const kind of Object.keys(KINDS)) {
      expect(() => planChargeHeads([], kind, ctx())).not.toThrow();
    }
  });

  it('attaches each kind to the right parent column', () => {
    // Charge_Heads has three possible parents and a line must carry exactly
    // one. A customs line with an SEJobId would show up on a freight job, and
    // a freight line with a CustomsJobId on a declaration.
    const line = (kind, jobKey) => planChargeHeads(
      [{ Id: 1, [jobKey]: 10, ChargesId: 1, Amount: 5, NetAmount: 5 }],
      kind,
      ctx({ jobIdByLegacyId: new Map([['10', 77]]) }),
    ).toCreate[0];

    const freight = line('SeaExportRecv', 'SEJobId');
    expect(freight.SEJobId).toBe(77);
    expect(freight.CustomsJobId).toBeUndefined();

    const customs = line('CustomsRecv', 'LogJobId');
    expect(customs.CustomsJobId).toBe(77);
    expect(customs.SEJobId).toBeUndefined();
  });

  it('reads the customs party and exchange-rate columns', () => {
    // Log_Job_ChargesRecv carries CustomerId + ExchRateClient; _ChargesPayb
    // carries VendorId + ExchRateLine. Same split as the freight tables, which
    // is why they share a receiver.
    const recvLine = planChargeHeads(
      [{ Id: 1, LogJobId: 10, CustomerId: 5, ExchRateClient: 280, NetAmount: 1 }],
      'CustomsRecv',
      ctx({ jobIdByLegacyId: new Map([['10', 77]]), parties: new Map([['5', { id: 55, name: 'ACME' }]]) }),
    ).toCreate[0];
    expect(recvLine.partyId).toBe(55);
    expect(recvLine.ex_rate).toBe(280);
    expect(recvLine.type).toBe('Recievable');

    const paybLine = planChargeHeads(
      [{ Id: 1, LogJobId: 10, VendorId: 5, ExchRateLine: 279, NetAmount: 1 }],
      'CustomsPayb',
      ctx({ jobIdByLegacyId: new Map([['10', 77]]), parties: new Map([['5', { id: 55, name: 'ACME' }]]) }),
    ).toCreate[0];
    expect(paybLine.partyId).toBe(55);
    expect(paybLine.ex_rate).toBe(279);
    expect(paybLine.type).toBe('Payble');
  });

  it('emits rows of a uniform shape', () => {
    const plan = planChargeHeads([recv(1), recv(2, { Description: null })], 'SeaExportRecv', ctx());
    const keys = plan.toCreate.map((r) => Object.keys(r).sort().join(','));
    expect(new Set(keys).size).toBe(1);
  });

  it('does not throw on an empty source', () => {
    expect(planChargeHeads([], 'SeaExportRecv', ctx()).stats.source).toBe(0);
    expect(planChargeHeads(undefined, 'SeaExportRecv', ctx()).canApply).toBe(true);
  });
});

/* A line's approval is Climax's, not "approved" across the board. Every line
 * used to arrive approved while its job kept Climax's approval, so each job
 * Climax had not approved came in unapproved over approved charges - and the
 * job screen had no button left to fix it with. */
describe('mapChargeHead - approval', () => {
  const at = (row, extra = {}) => mapChargeHead(row, 'SeaExportRecv', { ...ctx(), jobId: 'job-1', ...extra });

  it('keeps an approved line approved, and an unapproved one unapproved', () => {
    expect(at(recv(1, { IsApproved: true })).status).toBe(1);
    expect(at(recv(1, { IsApproved: false })).status).toBe(0);
  });

  it('approves a line that is on an invoice, whatever the flag says', () => {
    const m = at(recv(1, { IsApproved: false }), { jobInvoiceIds: new Set(['1']) });
    expect(m.invoiceType).toBe('Job Invoice');
    expect(m.status).toBe(1);
  });

  it('keeps the old behaviour for a bridge that does not send the flag', () => {
    expect(at(recv(1)).status).toBe(1);
  });
});
