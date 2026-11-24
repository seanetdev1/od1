const { partsIn, localDate, daysBetween, addDays } = require('../../functions/creditControl/clock');
const rules = require('../../functions/creditControl/rules');
const { dailyEmail, weeklyEmail, csv } = require('../../functions/creditControl/mail');
const { validate, withDefaults, DEFAULTS, isApproverDesignation } = require('../../functions/creditControl/settings');

const TZ = 'Asia/Karachi';

describe('the install clock', () => {
  it("is the office's, not the container's UTC", () => {
    // 04:30 UTC is 09:30 in Karachi, on a Monday.
    expect(partsIn(new Date('2026-10-26T04:30:00Z'), TZ)).toEqual({ date: '2026-10-26', time: '09:30', weekday: 1 });
    // 20:00 UTC on the 25th is already the 26th there.
    expect(localDate('2026-10-25T20:00:00Z', TZ)).toBe('2026-10-26');
  });

  it('counts whole days, never negative', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(0);
    expect(addDays('2026-12-30', 7)).toBe('2027-01-06');
  });
});

describe('an invoice, as credit control reads it', () => {
  const today = '2026-10-23';
  const inv = (over) => ({ id: 1, invoice_No: 'SNS-JI-1/27', createdAt: '2026-09-10T19:30:00Z', currency: 'PKR', ex_rate: '282.4', total: '10000', roundOff: '0', paid: '0', recieved: '0', ...over });

  it('is open while more than the tolerance is owed, with its round off', () => {
    expect(rules.openInvoice(inv({ recieved: '9999.5' }), { today, timeZone: TZ })).toBeNull();
    expect(rules.openInvoice(inv({ total: '10000.4', roundOff: '-0.4', recieved: '5000' }), { today, timeZone: TZ }).balance).toBe(5000);
  });

  it('is aged from its date in the office zone', () => {
    // 19:30 UTC on the 10th is the 11th in Karachi: 42 days to the 23rd.
    expect(rules.openInvoice(inv(), { today, timeZone: TZ })).toMatchObject({ date: '2026-09-11', ageDays: 42 });
  });

  it('converts to rupees: a PKR invoice at 1 whatever its rate says, a foreign one at its own', () => {
    expect(rules.openInvoice(inv(), { today, timeZone: TZ }).balancePkr).toBe(10000);
    expect(rules.openInvoice(inv({ currency: 'USD', total: '100' }), { today, timeZone: TZ })).toMatchObject({ currency: 'USD', balance: 100, balancePkr: 28240 });
    expect(rules.openInvoice(inv({ currency: 'USD', total: '100', ex_rate: '' }), { today, timeZone: TZ }).balancePkr).toBe(100);
  });
});

describe('the ignore limit', () => {
  it('leaves out invoices older than it - beyond, not at - and nothing when it is 0', () => {
    expect(rules.withinAge({ ageDays: 365 }, 365)).toBe(true);
    expect(rules.withinAge({ ageDays: 366 }, 365)).toBe(false);
    expect(rules.withinAge({ ageDays: 9000 }, 0)).toBe(true);
  });

  it('is said in the emails', () => {
    const client = { id: 1, name: 'ACME', code: '1' };
    const inv = { id: 1, invoiceNo: 'INV-1', ageDays: 100, daysOver: 40, balance: 1, balancePkr: 1, currency: 'PKR', amount: 1, date: '2026-07-15' };
    const daily = dailyEmail({ kind: 'noRep', entries: [{ client, overdue: [inv], over: false }] }, { today: '2026-10-23', timeZone: TZ, ignoreOlderThanDays: 365 });
    expect(daily.html).toContain('Invoices and bills older than 365 days are not included.');
    expect(weeklyEmail({ kind: 'noRep', entries: [{ client, invoices: [inv] }] }, { today: '2026-10-23', ageDays: 90 }).html).not.toContain('not included');
  });
});

/* Too little left on it to chase (the user's request, 2026-10-26). */
describe('the ignore amount', () => {
  it('leaves out a balance below it - in rupees, at its own rate - keeps one at it, and nothing when it is 0', () => {
    expect(rules.aboveIgnoreAmount({ balancePkr: 499.99 }, 500)).toBe(false);
    expect(rules.aboveIgnoreAmount({ balancePkr: 500 }, 500)).toBe(true);
    expect(rules.aboveIgnoreAmount({ balancePkr: 0.5 }, 0)).toBe(true);
    // USD 2 at 280 is PKR 560: kept against 500, though 2 is below it.
    const usd = rules.openInvoice({ id: 1, invoice_No: 'X', createdAt: '2026-10-01T05:00:00Z', currency: 'USD', ex_rate: '280', total: '2', roundOff: '0', paid: '0', recieved: '0' }, { today: '2026-10-23', timeZone: TZ });
    expect(rules.aboveIgnoreAmount(usd, 500)).toBe(true);
  });

  it('is said in the email and the report', () => {
    const client = { id: 1, name: 'ACME', code: '1' };
    const inv = { id: 1, invoiceNo: 'INV-1', ageDays: 100, daysOver: 40, balance: 900, balancePkr: 900, currency: 'PKR', amount: 900, date: '2026-07-15' };
    const daily = dailyEmail({ kind: 'noRep', entries: [{ client, overdue: [inv], over: false }] }, { today: '2026-10-23', timeZone: TZ, ignoreBelowAmount: 500 });
    expect(daily.html).toContain('Invoices and bills with less than PKR 500.00 left on them are not included.');
    expect(daily.reportHtml).toContain('Invoices and bills with less than PKR 500.00 left on them are not included.');
    const weekly = weeklyEmail({ kind: 'noRep', entries: [{ client, invoices: [inv] }] }, { today: '2026-10-23', ageDays: 90, ignoreBelowAmount: 500 });
    expect(weekly.html).toContain('less than PKR 500.00');
    expect(weeklyEmail({ kind: 'noRep', entries: [{ client, invoices: [inv] }] }, { today: '2026-10-23', ageDays: 90 }).html).not.toContain('less than');
  });
});

describe('whose invoice it is', () => {
  const accountClient = new Map([['7137', 10]]);
  const clientsById = new Map([[7137, { id: 7137, name: 'S & D CHEMICALS' }], [10, { id: 10, name: 'VELOCITY TEXTILES' }]]);

  it("the party behind the ledger account the invoice names", () => {
    expect(rules.partyOf({ party_Id: '7137', party_Name: 'VELOCITY TEXTILES' }, accountClient, clientsById)).toBe(10);
  });
  it("a migrated customs invoice's own party id - only when the name agrees", () => {
    const none = new Map();
    expect(rules.partyOf({ party_Id: '7137', party_Name: 'S & D CHEMICALS' }, none, clientsById)).toBe(7137);
    expect(rules.partyOf({ party_Id: '7137', party_Name: 'SOMEONE ELSE' }, none, clientsById)).toBeNull();
  });
});

describe('the daily check', () => {
  const inv = (id, ageDays, balancePkr, currency = 'PKR') => ({ id, invoiceNo: `INV-${id}`, ageDays, balance: balancePkr, balancePkr, currency, amount: balancePkr, date: '2026-09-01' });
  const run = (client, invoices) => rules.evaluateDaily({ clients: [client], invoicesByClient: new Map([[client.id, invoices]]) });

  it('flags invoices OLDER than the credit days - exceeded, not reached', () => {
    const [e] = run({ id: 1, creditLimitDays: 30, creditLimitAmount: null }, [inv(1, 30, 100), inv(2, 31, 100), inv(3, 90, 100)]);
    expect(e.overdue.map((i) => [i.id, i.daysOver])).toEqual([[3, 60], [2, 1]]);
    expect(e.over).toBe(false);
  });

  it("adds every open invoice in rupees against the amount limit", () => {
    const [e] = run({ id: 1, creditLimitDays: null, creditLimitAmount: 250000 }, [inv(1, 5, 200000), inv(2, 2, 60000)]);
    expect(e).toMatchObject({ balancePkr: 260000, limitPkr: 250000, over: true, overdue: [] });
  });

  it('0 is a limit: no credit at all', () => {
    const [e] = run({ id: 1, creditLimitDays: 0, creditLimitAmount: 0 }, [inv(1, 1, 50)]);
    expect(e.overdue).toHaveLength(1);
    expect(e.over).toBe(true);
  });

  it('leaves out a party with no limit, and one with nothing to report', () => {
    expect(run({ id: 1, creditLimitDays: null, creditLimitAmount: null }, [inv(1, 400, 1e6)])).toEqual([]);
    expect(run({ id: 1, creditLimitDays: 30, creditLimitAmount: 1e6 }, [inv(1, 10, 100)])).toEqual([]);
  });
});

/* Bills we owe a party count against its invoices; the limit is on the NET
 * (the user's request and choices, 2026-10-26). */
describe('the daily check, with the bills we owe a party', () => {
  const inv = (id, ageDays, balancePkr) => ({ id, invoiceNo: `INV-${id}`, ageDays, balance: balancePkr, balancePkr, currency: 'PKR', amount: balancePkr, date: '2026-09-01' });
  const bill = (id, ageDays, balancePkr) => ({ ...inv(id, ageDays, balancePkr), invoiceNo: `BILL-${id}` });
  const run = (client, invoices, bills) => rules.evaluateDaily({
    clients: [client], invoicesByClient: new Map([[client.id, invoices]]), billsByClient: new Map([[client.id, bills]]),
  });

  it('checks the limit against invoices less bills', () => {
    const [e] = run({ id: 1, creditLimitDays: null, creditLimitAmount: 250000 }, [inv(1, 5, 300000)], [bill(2, 3, 20000)]);
    expect(e).toMatchObject({ receivablePkr: 300000, payablePkr: 20000, balancePkr: 280000, over: true });
    expect(e.bills.map((b) => b.id)).toEqual([2]);
    // Bills enough to bring it under: not over, and nothing to report.
    expect(run({ id: 1, creditLimitDays: null, creditLimitAmount: 250000 }, [inv(1, 5, 300000)], [bill(2, 3, 60000)])).toEqual([]);
  });

  it('still lists overdue invoices when the bills cover them - with the bills, and a net in their favour', () => {
    const [e] = run({ id: 1, creditLimitDays: 30, creditLimitAmount: 1000 }, [inv(1, 60, 5000)], [bill(3, 10, 2000), bill(2, 90, 8000)]);
    expect(e.overdue.map((i) => i.id)).toEqual([1]);
    expect(e).toMatchObject({ balancePkr: -5000, over: false });
    expect(e.bills.map((b) => b.id)).toEqual([2, 3]); // oldest first
  });

  it('with no bills it is as it was', () => {
    const [e] = rules.evaluateDaily({ clients: [{ id: 1, creditLimitAmount: 100 }], invoicesByClient: new Map([[1, [inv(1, 5, 150)]]]) });
    expect(e).toMatchObject({ receivablePkr: 150, payablePkr: 0, balancePkr: 150, over: true, bills: [] });
  });

  it('the weekly: invoices over the age, every bill whatever its age, and the net of ALL open invoices', () => {
    const [w] = rules.evaluateWeekly({
      clients: [{ id: 1 }], ageDays: 90,
      invoicesByClient: new Map([[1, [inv(1, 120, 1000), inv(2, 10, 500)]]]),
      billsByClient: new Map([[1, [bill(3, 5, 300)]]]),
    });
    expect(w.invoices.map((i) => i.id)).toEqual([1]);
    expect(w.bills.map((b) => b.id)).toEqual([3]);
    expect(w).toMatchObject({ receivablePkr: 1500, payablePkr: 300, balancePkr: 1200 });
    // No invoice over the age: not in the weekly, bills or not.
    expect(rules.evaluateWeekly({ clients: [{ id: 1 }], ageDays: 90, invoicesByClient: new Map([[1, [inv(2, 10, 500)]]]), billsByClient: new Map([[1, [bill(3, 200, 300)]]]) })).toEqual([]);
  });
});

describe('who the emails go to', () => {
  const sara = { id: 'r1', name: 'SARA', email: 'sara@x.pk', active: '1' };
  const ali = { id: 'r2', name: 'ALI', email: '', active: '1' };
  const entry = (id, rep) => ({ client: { id, name: `P${id}`, salesRepresentatorId: rep } });
  const reps = new Map([['r1', sara], ['r2', ali]]);

  it('one email per rep, CC management', () => {
    const groups = rules.recipientsFor([entry(1, 'r1'), entry(2, 'r1')], { reps, management: ['ceo@x.pk', 'cfo@x.pk', 'sara@x.pk'], admins: ['admin@x.pk'] });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'rep', to: ['sara@x.pk'], cc: ['ceo@x.pk', 'cfo@x.pk'], problem: null });
    expect(groups[0].entries).toHaveLength(2);
  });

  it('a rep with no email: to management, saying so', () => {
    const [g] = rules.recipientsFor([entry(1, 'r2')], { reps, management: ['ceo@x.pk'], admins: [] });
    expect(g.to).toEqual(['ceo@x.pk']);
    expect(g.problem).toMatch('ALI has no email address');
  });

  it('a party with no rep: to the admin to set one, CC management', () => {
    const [g] = rules.recipientsFor([entry(1, null)], { reps, management: ['ceo@x.pk'], admins: ['admin@x.pk'] });
    expect(g).toMatchObject({ kind: 'noRep', to: ['admin@x.pk'], cc: ['ceo@x.pk'] });
  });

  it('nobody to send to is said, not skipped silently', () => {
    const [g] = rules.recipientsFor([entry(1, null)], { reps, management: [], admins: [] });
    expect(g.to).toEqual([]);
  });
});

describe('the emails', () => {
  const client = { id: 1, name: 'ACME <TEXTILES>', code: '101', person1: 'Imran', mobile1: '0300', creditLimitDays: 30, creditLimitAmount: 250000 };
  const invoices = Array.from({ length: 5 }, (_, n) => ({ id: n, invoiceNo: `INV-${n}`, jobNo: `SE-${n}`, ageDays: 60 - n, daysOver: 30 - n, balance: 1000, balancePkr: 1000, currency: n % 2 ? 'USD' : 'PKR', amount: 1000, date: '2026-08-24' }));
  const group = { kind: 'rep', rep: { name: 'SARA' }, entries: [{ client, overdue: invoices, balancePkr: 260000, limitPkr: 250000, over: true }] };

  /* The body a short summary; the content in the report, as a PDF (the
   * user's request, 2026-10-26). */
  it('the daily one: a short body - the numbers, and that the report is attached', () => {
    const m = dailyEmail(group, { today: '2026-10-23', timeZone: TZ, blocks: new Map([[1, { active: true }]]) });
    expect(m.subject).toBe('Credit control 23-10-2026 - SARA: 1 over the credit limit, 5 overdue invoices');
    expect(m.html).toContain('Dear SARA');
    expect(m.html).toContain('1 party</b> over the credit limit - owing PKR 260,000.00 against limits of PKR 250,000.00');
    expect(m.html).toContain('5 overdue invoices</b> across 1 party - PKR 5,000.00 outstanding');
    expect(m.html).toContain('attached as a PDF');
    // No party details or invoice rows in the body.
    expect(m.html).not.toContain('INV-');
    expect(m.html).not.toContain('Contact: Imran');
  });

  it('the daily report: the over-limit party, every overdue invoice in its currency, the party details', () => {
    const m = dailyEmail(group, { today: '2026-10-23', timeZone: TZ, blocks: new Map([[1, { active: true }]]), title: 'SEANET' });
    expect(m.reportName).toBe('credit-control-2026-10-23.pdf');
    expect(m.reportHtml).toMatch(/^<!doctype html>/);
    expect(m.reportHtml).toContain('Credit control - 23-10-2026');
    expect(m.reportHtml).toContain('For SARA &middot; SEANET');
    expect(m.reportHtml).toContain('ACME &lt;TEXTILES&gt;'); // escaped
    expect(m.reportHtml).toContain('Blocked from new jobs');
    expect(m.reportHtml).toContain('Contact: Imran (0300)');
    expect(m.reportHtml).toContain('>USD<');
    expect((m.reportHtml.match(/INV-/g) || [])).toHaveLength(5); // every one - no cap
    expect(m.attachments[0].filename).toBe('credit-control-2026-10-23.csv');
    expect(m.attachments[0].content.trim().split(/\r?\n/)).toHaveLength(6);
  });

  it("leaves out what is switched off", () => {
    const m = dailyEmail(group, { today: '2026-10-23', timeZone: TZ, showOverdue: false });
    expect(m.html).not.toContain('overdue invoice');
    expect(m.html).not.toContain('(CSV)'); // no invoices, no spreadsheet
    expect(m.reportHtml).not.toContain('Overdue invoices');
    expect(m.attachments).toEqual([]);
    expect(m.subject).toMatch(/1 over the credit limit$/);
  });

  it('the weekly one: the numbers in the body; per party, by currency, in the report', () => {
    const m = weeklyEmail({ kind: 'noRep', rep: null, entries: [{ client, invoices }] }, { today: '2026-10-26', ageDays: 90 });
    expect(m.subject).toBe('Ageing over 90 days 26-10-2026 - Parties with no sales rep: 1 party, 5 invoices');
    expect(m.html).toContain('no sales rep');
    expect(m.html).toContain('5 invoices</b> for 1 party, PKR 5,000.00 outstanding');
    expect(m.html).not.toContain('INV-');
    expect(m.reportName).toBe('ageing-over-90-days-2026-10-26.pdf');
    expect(m.reportHtml).toContain('PKR 3,000.00; USD 2,000.00');
    expect((m.reportHtml.match(/INV-/g) || [])).toHaveLength(5);
  });

  it('a CSV Excel reads as UTF-8, quoting what needs it', () => {
    expect(csv(['A', 'B'], [['x,y', 'say "hi"']])).toBe('﻿A,B\r\n"x,y","say ""hi"""\r\n');
  });
});

describe('the settings', () => {
  it('are off until switched on, with the times the user asked for', () => {
    const s = withDefaults(null);
    expect(s).toMatchObject({ enabled: false, timeZone: TZ, daily: { time: '09:00' }, weekly: { day: 1, time: '09:00', ageDays: 90 } });
    expect(s.recipients).toMatchObject({ management: ['ceo', 'cfo'], admin: ['admin'] });
    expect(s.approvers).toEqual(['ceo', 'cfo']);
  });

  it('a setting added later reads as its default on an older save', () => {
    expect(withDefaults({ enabled: true, daily: { time: '08:30' } })).toMatchObject({ enabled: true, daily: { time: '08:30', overdue: true }, block: DEFAULTS.block });
  });

  it('refuses what would break a run', () => {
    expect(() => validate({ daily: { time: '9am' } })).toThrow('time like 09:00');
    expect(() => validate({ weekly: { day: 7 } })).toThrow('from 0 to 6');
    expect(() => validate({ approvers: [] })).toThrow('at least one');
    expect(() => validate({ recipients: { extraCc: ['not-an-address'] } })).toThrow('not an email address');
    expect(() => validate({ recipients: { management: ['boss'] } })).toThrow('not a designation');
    expect(() => validate({ timeZone: 'Mars/Olympus' })).toThrow('time zone');
  });

  it('an ignore limit at or under the weekly age would empty the weekly report - refused while it is on', () => {
    expect(validate({ ignoreOlderThanDays: 365 }).ignoreOlderThanDays).toBe(365);
    expect(() => validate({ ignoreOlderThanDays: 90 })).toThrow('would always be empty');
    expect(validate({ ignoreOlderThanDays: 60, weekly: { enabled: false } }).ignoreOlderThanDays).toBe(60);
    expect(withDefaults(null).ignoreOlderThanDays).toBe(0);
  });

  it('the ignore amount: 0 by default, an amount from 0 up, to the paisa', () => {
    expect(withDefaults(null).ignoreBelowAmount).toBe(0);
    expect(validate({ ignoreBelowAmount: 500 }).ignoreBelowAmount).toBe(500);
    expect(validate({ ignoreBelowAmount: '99.999' }).ignoreBelowAmount).toBe(100);
    expect(() => validate({ ignoreBelowAmount: -1 })).toThrow('Ignore balances below must be an amount');
    expect(() => validate({ ignoreBelowAmount: 'lots' })).toThrow('Ignore balances below must be an amount');
    expect(() => validate({ ignoreBelowAmount: null })).toThrow('Ignore balances below must be an amount');
  });

  it('tidies lists - case, duplicates, separators', () => {
    const s = validate({ approvers: ['CEO', 'ceo', 'CFO'], recipients: { extraCc: 'a@x.pk; b@x.pk,a@x.pk' } });
    expect(s.approvers).toEqual(['ceo', 'cfo']);
    expect(s.recipients.extraCc).toEqual(['a@x.pk', 'b@x.pk']);
  });

  it('approvers by designation, any case', () => {
    expect(isApproverDesignation(withDefaults(null), 'CFO')).toBe(true);
    expect(isApproverDesignation(withDefaults(null), 'manager')).toBe(false);
  });
});

describe('the emails, with the bills we owe a party', () => {
  const client = { id: 1, name: 'ACME', code: '101', creditLimitDays: 30, creditLimitAmount: 1000 };
  const doc = (no, ageDays, pkr) => ({ id: no, invoiceNo: no, jobNo: 'SE-1', ageDays, daysOver: ageDays - 30, balance: pkr, balancePkr: pkr, currency: 'PKR', amount: pkr, date: '2026-08-01' });
  const entry = { client, overdue: [doc('INV-1', 60, 5000)], bills: [doc('BILL-1', 20, 1500)], receivablePkr: 5000, payablePkr: 1500, balancePkr: 3500, limitPkr: 1000, over: true };

  it('daily: the body says what we owe them and the net; the report lists the bills', () => {
    const m = dailyEmail({ kind: 'rep', rep: { name: 'SARA' }, entries: [entry] }, { today: '2026-10-26', timeZone: TZ });
    expect(m.html).toContain('owing PKR 3,500.00 net of our bills against limits of PKR 1,000.00');
    expect(m.html).toContain('We owe one of these parties <b>PKR 1,500.00</b> in open bills - net, they owe PKR 3,500.00.');
    expect(m.html).toContain('with the same invoices and bills as a spreadsheet (CSV)');
    expect(m.reportHtml).toContain('Our bills (PKR)');
    expect(m.reportHtml).toContain('Open invoices PKR 5,000.00 &minus; our bills PKR 1,500.00 = <b>net PKR 3,500.00</b>');
    expect(m.reportHtml).toContain('Our open bills to them (1)');
    expect(m.reportHtml).toContain('BILL-1');
    const lines = m.attachments[0].content.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Kind,Number');
    expect(lines.slice(1).map((l) => l.split(',')[3])).toEqual(['Invoice', 'Bill']);
  });

  it('a net in their favour reads so', () => {
    const covered = { ...entry, bills: [doc('BILL-1', 20, 8000)], payablePkr: 8000, balancePkr: -3000, over: false };
    const m = dailyEmail({ kind: 'rep', rep: { name: 'SARA' }, entries: [covered] }, { today: '2026-10-26', timeZone: TZ });
    expect(m.html).toContain('net, PKR 3,000.00 in their favour');
    expect(m.reportHtml).toContain('<b>net PKR 3,000.00 in their favour</b>');
    expect(m.subject).toMatch(/1 overdue invoice$/);
  });

  it('no bills: nothing about them', () => {
    const plain = { ...entry, bills: [], payablePkr: 0, balancePkr: 5000 };
    const m = dailyEmail({ kind: 'rep', rep: { name: 'SARA' }, entries: [plain] }, { today: '2026-10-26', timeZone: TZ });
    expect(m.html).not.toContain('open bills');
    expect(m.html).not.toContain('net of our bills');
    expect(m.reportHtml).not.toContain('Our open bills');
  });

  it('weekly: the bills and the net, in the body, the summary and the CSV', () => {
    const w = { client, invoices: [doc('INV-1', 120, 5000)], bills: [doc('BILL-1', 20, 1500)], receivablePkr: 6000, payablePkr: 1500, balancePkr: 4500 };
    const m = weeklyEmail({ kind: 'rep', rep: { name: 'SARA' }, entries: [w] }, { today: '2026-10-26', ageDays: 90 });
    expect(m.html).toContain('We owe one of these parties <b>PKR 1,500.00</b> in open bills - net, they owe PKR 4,500.00.');
    expect(m.reportHtml).toContain('Net (PKR)');
    expect(m.reportHtml).toContain('4,500.00');
    expect(m.reportHtml).toContain('Our open bills to them (1)');
    expect(m.attachments[0].content).toContain(',Bill,BILL-1,');
  });
});
