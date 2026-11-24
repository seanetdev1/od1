/**
 * The accounts a Direct Job E/R or a payment / receipt settles through -
 * GET /accounts/getAccountsForTransaction (header `type`: Bank, Cash, Adjust...).
 *
 * Leaf accounts only (the user, 2026-11-17): under Adjust every 'General'
 * group account - one with accounts under it - was offered, and a voucher
 * cannot post to a group.
 */
const request = require('supertest');
const { Op } = require('sequelize');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');

describe('accounts for a transaction', () => {
  let authHeader; let top; let group; let leaf;

  const cleanup = () => db.Child_Account.destroy({ where: { title: { [Op.like]: `${TEST_PREFIX}AFT %` } } });

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    await cleanup();
    top = await db.Child_Account.create({ title: `${TEST_PREFIX}AFT TOP`, subCategory: 'General' });
    group = await db.Child_Account.create({ title: `${TEST_PREFIX}AFT GROUP`, subCategory: 'General', ChildAccountId: top.id });
    leaf = await db.Child_Account.create({ title: `${TEST_PREFIX}AFT LEAF`, subCategory: 'General', ChildAccountId: group.id });
  });

  afterAll(async () => {
    // Leaf first: each points at the one above it.
    if (leaf) await db.Child_Account.destroy({ where: { id: leaf.id } });
    if (group) await db.Child_Account.destroy({ where: { id: group.id } });
    if (top) await db.Child_Account.destroy({ where: { id: top.id } });
  });

  const accountsFor = (type) => request(app).get('/accounts/getAccountsForTransaction')
    .set('Authorization', authHeader).set('type', type);

  it('under Adjust offers the leaf account and not the group above it', async () => {
    const res = await accountsFor('Adjust');
    expect(res.status).toBe(200);
    const ids = res.body.result.map((a) => a.id);
    expect(ids).toContain(leaf.id);
    expect(ids).not.toContain(group.id);
  });

  it('still answers for Bank and Cash', async () => {
    expect((await accountsFor('Bank')).status).toBe(200);
    expect((await accountsFor('Cash')).status).toBe(200);
  });
});
