const {
  parseBankDefaults, setBankDefault, flagAccounts, withBankDefaults,
} = require('../../functions/bankAccountDefaults');

const accounts = [{ id: 7, label: 'Soneri' }, { id: 9, label: 'Habib' }];

describe('bank account defaults', () => {
  test('a missing or malformed setting reads as nothing set', () => {
    expect(parseBankDefaults(null)).toEqual({});
    expect(parseBankDefaults('not json')).toEqual({});
    expect(parseBankDefaults('[1,2]')).toEqual({});
    expect(parseBankDefaults('{"3":{"client":7}}')).toEqual({ 3: { client: 7 } });
  });

  test('setting one kind keeps the other, and leaves other companies alone', () => {
    let m = setBankDefault({ 4: { client: 1 } }, 3, 'client', 7);
    m = setBankDefault(m, 3, 'agent', '9');
    expect(m).toEqual({ 3: { client: 7, agent: 9 }, 4: { client: 1 } });
  });

  test('flags exactly the accounts named for that company', () => {
    const flagged = flagAccounts(accounts, { 3: { client: 7, agent: 7 } }, '3');
    expect(flagged.map((a) => [a.id, a.clientDefault, a.agentDefault])).toEqual([[7, true, true], [9, false, false]]);
  });

  test('another company\'s defaults never flag these accounts', () => {
    const flagged = flagAccounts(accounts, { 4: { client: 7 } }, 3);
    expect(flagged.every((a) => !a.clientDefault && !a.agentDefault)).toBe(true);
  });

  test('a company without accounts passes through untouched', () => {
    expect(withBankDefaults(null, {})).toBeNull();
    expect(withBankDefaults({ id: 3 }, {})).toEqual({ id: 3 });
    expect(withBankDefaults({ id: 3, BankAccounts: accounts }, { 3: { agent: 9 } }).BankAccounts[1].agentDefault).toBe(true);
  });
});
