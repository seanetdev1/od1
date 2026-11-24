const { ensureCarrierParty } = require('../../functions/carrierParty');

/**
 * The party behind a carrier.
 *
 * ensureCarrierParty takes its models as an argument rather than requiring
 * them, so the whole thing can be driven off fakes - which matters here more
 * than most places, because this is the code that CREATES LEDGER ACCOUNTS.
 * Getting it wrong means a duplicate account for an airline that already has
 * one, or a party silently renamed on every invoice it has ever appeared on.
 *
 * The fakes below are faithful in the one respect the code depends on:
 * findPartyByName builds `Sequelize.where(fn('lower', col('name')), value)`,
 * and a Where object carries that value on `.logic` - so the fake can do a
 * real case-insensitive lookup instead of returning a canned answer.
 */
const makeModels = ({ clients = [], associations = [], accounts = [] } = {}) => {
  const state = {
    clients: clients.map((c) => ({ createdAt: 0, ...c })),
    associations: associations.map((a) => ({ ...a })),
    accounts: accounts.map((a) => ({ ...a })),
    nextClientId: 100,
    nextAccountId: 500,
  };

  const Clients = {
    findByPk: async (id) => state.clients.find((c) => c.id === id) || null,
    findOne: async (opts) => {
      const where = opts?.where;
      // findPartyByName: a Where object, its value on .logic.
      if (where && where.logic !== undefined) {
        const wanted = String(where.logic);
        return state.clients.find((c) => String(c.name).toLowerCase() === wanted) || null;
      }
      // nextPartyCode: the most recently created party.
      return [...state.clients].sort((a, b) => b.createdAt - a.createdAt)[0] || null;
    },
    create: async (values) => {
      const row = { id: state.nextClientId++, createdAt: Date.now(), ...values };
      state.clients.push(row);
      return row;
    },
    update: async (values, opts) => {
      const row = state.clients.find((c) => c.id === opts.where.id);
      if (row) Object.assign(row, values);
      return [row ? 1 : 0];
    },
  };

  const Child_Account = {
    findOne: async (opts) => state.accounts.find((a) => a.id === opts.where.id) || null,
    findAll: async (opts) =>
      state.accounts.filter((a) => a.ChildAccountId === opts.where.ChildAccountId),
    create: async (values) => {
      const row = { id: state.nextAccountId++, ...values };
      state.accounts.push(row);
      return row;
    },
  };

  const Client_Associations = {
    findOne: async (opts) =>
      state.associations.find((a) => a.ClientId === opts.where.ClientId) || null,
    create: async (values) => {
      const row = { id: state.associations.length + 1, ...values };
      state.associations.push(row);
      return row;
    },
  };

  return { models: { Clients, Client_Associations, Child_Account }, state };
};

// A parent account to hang ledger accounts off, with one sibling already under
// it so the code allocation has something to step past.
const PARENT = { id: 7, code: '1000', ChildAccountId: null };

describe('naming the party', () => {
  test('a new party takes the carrier name when none is given', async () => {
    const { models, state } = makeModels({ accounts: [PARENT] });
    const out = await ensureCarrierParty({ models, name: 'PIA' });

    expect(out.action).toBe('created');
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0].name).toBe('PIA');
  });

  // The point of the feature: the carrier is known by its short name, the
  // books want the legal one.
  test('a new party takes the custom name when one is given', async () => {
    const { models, state } = makeModels({ accounts: [PARENT] });
    const out = await ensureCarrierParty({
      models, name: 'PIA', partyName: 'Pakistan International Airlines',
    });

    expect(out.action).toBe('created');
    expect(state.clients[0].name).toBe('Pakistan International Airlines');
  });

  // The custom name governs the SEARCH too. Searching on the carrier's short
  // name instead would link to a party called "PIA" and quietly ignore the
  // name that was actually typed.
  test('the custom name is what is searched for, not the carrier name', async () => {
    const { models, state } = makeModels({
      accounts: [PARENT],
      clients: [
        { id: 1, name: 'PIA', code: '900' },
        { id: 2, name: 'Pakistan International Airlines', code: '901' },
      ],
    });
    const out = await ensureCarrierParty({
      models, name: 'PIA', partyName: 'Pakistan International Airlines',
    });

    expect(out.action).toBe('linked');
    expect(out.partyId).toBe(2);
    expect(state.clients).toHaveLength(2); // nothing new created
  });

  test('a blank or whitespace custom name falls back to the carrier name', async () => {
    for (const partyName of ['', '   ', null, undefined]) {
      const { models, state } = makeModels({ accounts: [PARENT] });
      await ensureCarrierParty({ models, name: 'PIA', partyName });
      expect(state.clients[0].name).toBe('PIA');
    }
  });

  test('names are trimmed', async () => {
    const { models, state } = makeModels({ accounts: [PARENT] });
    await ensureCarrierParty({ models, name: 'PIA', partyName: '  Emirates  ' });
    expect(state.clients[0].name).toBe('Emirates');
  });

  test('refuses when there is no name at all', async () => {
    const { models } = makeModels();
    await expect(ensureCarrierParty({ models, name: '   ' }))
      .rejects.toThrow('A party needs a name.');
  });
});

describe('link before create', () => {
  // Creating a second "PIA" would split its ledger history across two
  // accounts, which is the one outcome worth going out of the way to avoid.
  test('links an existing party of the same name rather than duplicating it', async () => {
    const { models, state } = makeModels({
      accounts: [PARENT],
      clients: [{ id: 1, name: 'PIA', code: '900' }],
    });
    const out = await ensureCarrierParty({ models, name: 'PIA' });

    expect(out.action).toBe('linked');
    expect(out.partyId).toBe(1);
    expect(state.clients).toHaveLength(1);
  });

  test('matching is case-insensitive', async () => {
    const { models } = makeModels({
      accounts: [PARENT],
      clients: [{ id: 1, name: 'pia', code: '900' }],
    });
    const out = await ensureCarrierParty({ models, name: 'PIA' });
    expect(out).toMatchObject({ action: 'linked', partyId: 1 });
  });

  test('an explicit partyId wins over any name match', async () => {
    const { models } = makeModels({
      accounts: [PARENT],
      clients: [
        { id: 1, name: 'PIA', code: '900' },
        { id: 2, name: 'Pakistan International Airlines', code: '901' },
      ],
    });
    const out = await ensureCarrierParty({ models, name: 'PIA', partyId: 2 });
    expect(out).toMatchObject({ action: 'linked', partyId: 2 });
  });

  // THE GUARANTEE THAT MATTERS MOST. An existing party's name is on every
  // invoice already raised against it. Setup > Carriers is not where that
  // decision belongs, so a custom name must not leak into a linked party.
  test('never renames a party linked by id, even when a custom name is given', async () => {
    const { models, state } = makeModels({
      accounts: [PARENT],
      clients: [{ id: 2, name: 'Pakistan Intl Airlines', code: '901' }],
    });
    await ensureCarrierParty({
      models, name: 'PIA', partyId: 2, partyName: 'Something Else Entirely',
    });

    expect(state.clients.find((c) => c.id === 2).name).toBe('Pakistan Intl Airlines');
  });

  test('never renames a party matched by name either', async () => {
    const { models, state } = makeModels({
      accounts: [PARENT],
      clients: [{ id: 1, name: 'PIA', code: '900' }],
    });
    await ensureCarrierParty({ models, name: 'PIA' });
    expect(state.clients.find((c) => c.id === 1).name).toBe('PIA');
  });

  test('refuses a partyId that no longer exists', async () => {
    const { models } = makeModels({ accounts: [PARENT] });
    await expect(ensureCarrierParty({ models, name: 'PIA', partyId: 999 }))
      .rejects.toThrow('That party no longer exists.');
  });
});

describe('the ledger account', () => {
  test('is created under the given parent, with a code inside its block', async () => {
    const { models, state } = makeModels({ accounts: [PARENT] });
    const out = await ensureCarrierParty({
      models, name: 'PIA', parentAccountId: 7,
    });

    expect(out.ledgerCreated).toBe(true);
    const account = state.accounts.find((a) => a.title === 'PIA');
    // parentCode * 10000 + 1 - the hierarchical numbering the rest of the
    // chart of accounts uses.
    expect(account).toMatchObject({
      title: 'PIA',
      subCategory: 'Customer',
      editable: false,
      ChildAccountId: 7,
      code: '10000001',
    });
    expect(state.associations).toHaveLength(1);
    expect(state.associations[0]).toMatchObject({ ClientId: out.partyId, ChildAccountId: account.id });
  });

  test('the account is titled with the PARTY name, not the carrier name', async () => {
    const { models, state } = makeModels({ accounts: [PARENT] });
    await ensureCarrierParty({
      models, name: 'PIA', partyName: 'Pakistan International Airlines', parentAccountId: 7,
    });
    expect(state.accounts.some((a) => a.title === 'Pakistan International Airlines')).toBe(true);
    expect(state.accounts.some((a) => a.title === 'PIA')).toBe(false);
  });

  test('none is created when no parent account is given', async () => {
    const { models, state } = makeModels();
    const out = await ensureCarrierParty({ models, name: 'PIA' });

    expect(out.ledgerCreated).toBe(false);
    expect(state.associations).toHaveLength(0);
    // nongl '1' is the app's marker for a party with no ledger.
    expect(state.clients[0].nongl).toBe('1');
  });

  test('attaching a ledger flips the party out of non-GL', async () => {
    const { models, state } = makeModels({ accounts: [PARENT] });
    await ensureCarrierParty({ models, name: 'PIA', parentAccountId: 7 });
    expect(state.clients[0].nongl).toBe('0');
  });

  // Re-saving a carrier must not keep stacking accounts under the same party.
  test('a party that already has one keeps it', async () => {
    const { models, state } = makeModels({
      accounts: [PARENT],
      clients: [{ id: 1, name: 'PIA', code: '900' }],
      associations: [{ ClientId: 1, ChildAccountId: 42 }],
    });
    const out = await ensureCarrierParty({ models, name: 'PIA', parentAccountId: 7 });

    expect(out.ledgerCreated).toBe(false);
    expect(state.associations).toHaveLength(1);
    expect(state.accounts).toHaveLength(1); // only PARENT
  });

  // Linking an existing, fully set-up party must not touch its account either -
  // it is that party's own, and registering it as a carrier is not a reason to
  // interfere with it.
  test('a linked party’s existing ledger is left alone', async () => {
    const { models, state } = makeModels({
      accounts: [PARENT, { id: 42, code: '5000', ChildAccountId: 7 }],
      clients: [{ id: 2, name: 'Emirates', code: '901', nongl: '0' }],
      associations: [{ ClientId: 2, ChildAccountId: 42 }],
    });
    const out = await ensureCarrierParty({ models, name: 'Emirates', parentAccountId: 7 });

    expect(out).toMatchObject({ action: 'linked', partyId: 2, ledgerCreated: false });
    expect(state.accounts).toHaveLength(2);
  });

  test('a party created earlier without a ledger can be given one later', async () => {
    const { models, state } = makeModels({
      accounts: [PARENT],
      clients: [{ id: 1, name: 'PIA', code: '900', nongl: '1' }],
    });
    const out = await ensureCarrierParty({ models, name: 'PIA', parentAccountId: 7 });

    expect(out).toMatchObject({ action: 'linked', partyId: 1, ledgerCreated: true });
    expect(state.clients[0].nongl).toBe('0');
  });
});
