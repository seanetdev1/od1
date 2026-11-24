const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const db = require('../../models');

/**
 * The rewritten chart-of-accounts stage: plan, refuse, apply, verify.
 */
describe('Chart of accounts migration', () => {
  let admin, user;
  const BASE = 900000;   // well clear of anything the suite seeds

  const acc = (n, name, parent = null) => ({
    Id: BASE + n, AccountName: name, AccountCode: `T${n}`,
    ParentAccountId: parent === null ? null : BASE + parent,
    IsVoucherEntryAllowed: true,
    SubCategory: { SubCategory: 'General' },
  });

  beforeAll(async () => {
    admin = await loginAs('admin');
    user = await loginAs('employee');
  });

  afterEach(async () => {
    await db.Child_Account.destroy({ where: { id: { [db.Sequelize.Op.gte]: BASE } } });
  });

  it('is admin only', async () => {
    const res = await request(app).post('/accounts/migration/coa/plan')
      .set('Authorization', user.authHeader).send({ accounts: [] });
    expect(res.status).toBe(403);
  });

  it('plans without writing anything', async () => {
    const accounts = [acc(2, 'CHILD', 1), acc(1, 'ROOT')];
    const res = await request(app).post('/accounts/migration/coa/plan')
      .set('Authorization', admin.authHeader).send({ accounts });

    expect(res.status).toBe(200);
    expect(res.body.result.canApply).toBe(true);
    expect(res.body.result.stats.toCreate).toBe(2);

    const written = await db.Child_Account.count({ where: { id: { [db.Sequelize.Op.gte]: BASE } } });
    expect(written).toBe(0);
  });

  it('applies in dependency order so no parent link dangles', async () => {
    // Children first in the payload - the old importer wrote them in this
    // order and left ChildAccountId pointing at rows that did not exist.
    const accounts = [acc(3, 'GRANDCHILD', 2), acc(2, 'CHILD', 1), acc(1, 'ROOT')];
    const res = await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader).send({ accounts });

    expect(res.status).toBe(200);
    expect(res.body.result.created).toBe(3);

    const child = await db.Child_Account.findByPk(BASE + 3);
    expect(child.ChildAccountId).toBe(BASE + 2);
    const root = await db.Child_Account.findByPk(BASE + 1);
    expect(root.ChildAccountId).toBeNull();
  });

  it('is safe to run twice', async () => {
    const accounts = [acc(1, 'ROOT'), acc(2, 'CHILD', 1)];
    await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader).send({ accounts });
    const second = await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader).send({ accounts });

    expect(second.status).toBe(200);
    expect(second.body.result.created ?? 0).toBe(0);
    expect(await db.Child_Account.count({ where: { id: [BASE + 1, BASE + 2] } })).toBe(2);
  });

  it('refuses when an id already belongs to an account it did not import', async () => {
    // The seeded chart of accounts on a fresh install: same id, different name.
    await db.Child_Account.create({ id: BASE + 1, title: 'SEEDED ACCOUNT', subCategory: 'General' });

    const res = await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader).send({ accounts: [acc(1, 'LEGACY ROOT')] });

    expect(res.status).toBe(409);
    expect(res.body.result.problems.collisions).toContain(BASE + 1);
    // And it did not overwrite it.
    const row = await db.Child_Account.findByPk(BASE + 1);
    expect(row.title).toBe('SEEDED ACCOUNT');
  });

  it('writes nothing at all when the chart contains a loop', async () => {
    const accounts = [acc(1, 'A', 2), acc(2, 'B', 1), acc(3, 'FINE')];
    const res = await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader).send({ accounts });

    expect(res.status).toBe(409);
    // Not even the healthy account - a partial chart is the failure this
    // rewrite exists to prevent.
    expect(await db.Child_Account.count({ where: { id: { [db.Sequelize.Op.gte]: BASE } } })).toBe(0);
  });

  it('detaches an orphan rather than writing a broken link', async () => {
    const accounts = [acc(1, 'ROOT'), { ...acc(2, 'STRAY'), ParentAccountId: 987654 }];
    const res = await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader).send({ accounts });

    expect(res.status).toBe(200);
    expect(res.body.result.problems.orphans).toHaveLength(1);
    const stray = await db.Child_Account.findByPk(BASE + 2);
    expect(stray.ChildAccountId).toBeNull();
  });

  it('verify reports a tree that holds together', async () => {
    await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader)
      .send({ accounts: [acc(1, 'ROOT'), acc(2, 'CHILD', 1)] });

    const res = await request(app).get('/accounts/migration/coa/verify')
      .set('Authorization', admin.authHeader);

    expect(res.status).toBe(200);
    expect(res.body.result.danglingParents).toBe(0);
    expect(res.body.result.inLoops).toBe(0);
  });

  it('cannot create a dangling parent in the first place', async () => {
    // ChildAccountId has a real foreign key
    // (Child_Accounts_ChildAccountId_fkey), so a broken link is rejected by
    // Postgres rather than stored. This is WHY the import has to order its
    // inserts and detach orphans: without either, the insert simply fails.
    await expect(
      db.Child_Account.create({
        id: BASE + 9, title: 'DANGLING', subCategory: 'General', ChildAccountId: 987654,
      })
    ).rejects.toThrow();
  });

  it('verify reports the tree shape and sub-category gaps', async () => {
    // What the constraint does NOT cover: an account with no sub-category
    // still imports fine, and then ledgerMapping classifies its voucher lines
    // into the wrong bucket with no error anywhere.
    await request(app).post('/accounts/migration/coa/apply')
      .set('Authorization', admin.authHeader)
      .send({ accounts: [acc(1, 'ROOT'), acc(2, 'CHILD', 1)] });
    await db.Child_Account.update({ subCategory: null }, { where: { id: BASE + 2 } });

    const res = await request(app).get('/accounts/migration/coa/verify')
      .set('Authorization', admin.authHeader);

    expect(res.body.result.accountsWithoutSubCategory).toBeGreaterThan(0);
    expect(res.body.result.healthy).toBe(false);
    expect(res.body.result.deepestBranch).toBeGreaterThanOrEqual(1);
  });
});
