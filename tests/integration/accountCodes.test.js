/**
 * Chart of accounts numbering - POST /accounts/createChildAccount.
 *
 * `Child_Account.code` is a STRING column, and the sibling lookup used to be a
 * range over it:
 *
 *     code >= '0'  AND  code < '10000'      ORDER BY code DESC
 *
 * Postgres compares those lexicographically, so '2' < '10000' is FALSE - '2'
 * beats '1' on the first character. Once a top-level account had code '2' it
 * fell outside its own range, the query could only ever find '1', and every
 * account after the second was numbered 1 + 1 = 2.
 *
 * Creating five top-level accounts produced 1, 2, 2, 2, 2. That is what the
 * first test here checks, because a single account or even two would have
 * passed throughout.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Op } = require('sequelize');
const { Child_Account } = require('../../models');

describe('Chart of accounts numbering', () => {
  let authHeader;
  const created = [];

  const add = async (title, ChildAccountId) => {
    const res = await request(app)
      .post('/accounts/createChildAccount')
      .set('Authorization', authHeader)
      .send({ title: TEST_PREFIX + title, ChildAccountId, subCategory: 'General' });
    if (res.body?.result?.id) created.push(res.body.result.id);
    return res;
  };

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
  });

  afterAll(async () => {
    // Children first: the table references itself.
    if (created.length) {
      await Child_Account.destroy({ where: { ChildAccountId: created } });
      await Child_Account.destroy({ where: { id: created } });
    }
    await Child_Account.destroy({ where: { title: { [Op.like]: TEST_PREFIX + '%' } } });
  });

  describe('top-level accounts', () => {
    let codes;

    beforeAll(async () => {
      // The real five, in the order they were entered.
      const names = ['ASSETS', 'CAPITAL', 'LIABILITIES', 'REVENUE', 'EXPENSE'];
      codes = [];
      for (const n of names) {
        const res = await add(n, null);
        expect(res.status).toBe(200);
        codes.push(Number(res.body.result.code));
      }
    });

    it('numbers them 1..5 rather than 1, 2, 2, 2, 2', () => {
      expect(codes).toEqual([1, 2, 3, 4, 5]);
    });

    it('gives every account a distinct code', () => {
      // The bug's signature: three accounts sharing code 2.
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('keeps counting past 9, where string ordering diverges most', async () => {
      // '10' sorts BELOW '9' lexicographically, so a string comparison starts
      // handing out duplicates again exactly here.
      for (let i = 6; i <= 12; i++) {
        const res = await add(`TOP ${i}`, null);
        expect(Number(res.body.result.code)).toBe(i);
      }
    });
  });

  describe('child accounts', () => {
    let parentId; let parentCode;

    beforeAll(async () => {
      const res = await add('PARENT', null);
      parentId = res.body.result.id;
      parentCode = Number(res.body.result.code);
    });

    it('start a block of their own under the parent', async () => {
      const res = await add('CHILD A', parentId);
      expect(Number(res.body.result.code)).toBe(parentCode * 10000 + 1);
    });

    it('increment within that block', async () => {
      const b = await add('CHILD B', parentId);
      const c = await add('CHILD C', parentId);
      expect(Number(b.body.result.code)).toBe(parentCode * 10000 + 2);
      expect(Number(c.body.result.code)).toBe(parentCode * 10000 + 3);
    });

    it('do not disturb the top-level sequence', async () => {
      // Children live in a different block; adding them must not consume a
      // top-level number.
      const before = await Child_Account.count({ where: { ChildAccountId: null } });
      await add('CHILD D', parentId);
      const after = await Child_Account.count({ where: { ChildAccountId: null } });
      expect(after).toBe(before);
    });
  });

  describe('duplicate titles', () => {
    it('are refused within the same parent', async () => {
      await add('DUPLICATE', null);
      const res = await add('DUPLICATE', null);
      expect(res.body.status).toBe('exists');
    });
  });

  describe('a database already holding bad codes', () => {
    it('does not renumber below the block when a sibling has a stale code', async () => {
      // Simulates what the old logic left behind: several siblings sharing a
      // code. The next account must still come out above all of them rather
      // than colliding again.
      const a = await add('STALE A', null);
      await Child_Account.update(
        { code: '2' }, { where: { id: a.body.result.id } }
      );
      const next = await add('STALE B', null);
      const codes = await Child_Account.findAll({
        where: { ChildAccountId: null }, attributes: ['code'], raw: true,
      });
      const highest = Math.max(...codes.map((c) => Number(c.code)).filter(Number.isFinite));
      expect(Number(next.body.result.code)).toBe(highest);
    });
  });
});
