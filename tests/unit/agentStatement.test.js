/**
 * The Agent Receivable & Payable Statement - functions/agentStatement.js.
 *
 * Built to the accounts team's "International Report Recd & Pay" workbook and
 * checked against its 28-09-26 sheet on a copy of the SNS books. These pin the
 * arithmetic: every foreign currency's balance added as it stands - USD 1,000
 * and GBP 200 make 1,200, as their PIVOT adds Climax's - the signs and order
 * the workbook uses, and settled agents left out.
 */
const { buildAgentStatement } = require('../../functions/agentStatement');

const row = (acct, name, currency, fc) => ({ acct, name, currency, fc });

describe("an agent's figure", () => {
  test('its postings, as they stand', () => {
    const { payables } = buildAgentStatement([row(1, 'GREEN', 'USD', '-52783')]);
    expect(payables).toEqual([{ accountId: 1, agent: 'GREEN', amount: -52783 }]);
  });

  test('another currency is not converted: GBP 21,500.75 owed is -21,500.75', () => {
    const { payables } = buildAgentStatement([row(2, 'Denholm Good Logistics', 'GBP', '-21500.75')]);
    expect(payables[0]).toEqual({ accountId: 2, agent: 'Denholm Good Logistics', amount: -21500.75 });
  });

  test('its currencies added together as they stand: USD 1,000 + GBP 200 = 1,200', () => {
    const { receivables } = buildAgentStatement([
      row(3, 'SCAN', 'USD', '1000'),
      row(3, 'SCAN', 'gbp ', '200'),
    ]);
    expect(receivables).toEqual([{ accountId: 3, agent: 'SCAN', amount: 1200 }]);
  });

  test('missing or unreadable figures are nought', () => {
    const { receivables } = buildAgentStatement([row(5, 'Y', 'USD', null), row(5, 'Y', 'USD', 'abc'), row(5, 'Y', 'USD', '12.5')]);
    expect(receivables[0].amount).toBe(12.5);
  });
});

describe('the statement', () => {
  const rows = [
    row(1, 'GREEN', 'USD', '-52783'),
    row(2, 'SKYWAYS', 'USD', '-40630'),
    row(3, 'MILESTONE', 'USD', '156762'),
    row(4, 'ABC', 'USD', '1200'),
    row(5, 'AAA', 'USD', '1200'),
    row(6, 'SETTLED', 'USD', '0.004'),
    row(7, 'EVEN', 'USD', '-0.001'),
  ];

  test('what we owe negative, most owed first; what is owed to us positive, largest first - ties by name', () => {
    const s = buildAgentStatement(rows);
    expect(s.payables.map((a) => [a.agent, a.amount])).toEqual([['GREEN', -52783], ['SKYWAYS', -40630]]);
    expect(s.receivables.map((a) => [a.agent, a.amount])).toEqual([['MILESTONE', 156762], ['AAA', 1200], ['ABC', 1200]]);
  });

  test('an agent whose balance shows as 0.00 is on neither list', () => {
    const s = buildAgentStatement(rows);
    const names = [...s.payables, ...s.receivables].map((a) => a.agent);
    expect(names).not.toContain('SETTLED');
    expect(names).not.toContain('EVEN');
  });

  test('each list totalled, to the cent', () => {
    expect(buildAgentStatement(rows).totals).toEqual({ payable: -93413, receivable: 159162 });
  });

  test('no postings at all: two empty lists', () => {
    expect(buildAgentStatement([])).toEqual({ payables: [], receivables: [], totals: { payable: 0, receivable: 0 } });
  });
});
