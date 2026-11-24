/**
 * Editing a chart-of-accounts entry - POST /accounts/editChildAccount.
 *
 * Three rules, and each of them exists because the alternative is silently
 * wrong rather than loudly broken:
 *
 *   A SEEDED ACCOUNT IS ADMIN-ONLY. `editable` = '1' marks the structure the
 *   rest of the system reasons about. The screen hides the pencil, which is
 *   not a rule - it is a decoration on one. This is the rule.
 *
 *   ONLY A LEAF MOVES. Codes are hierarchical by multiplication, so moving an
 *   account means reissuing its number; for a node that is every code beneath
 *   it, to any depth, and some are printed on statements already filed.
 *
 *   A MOVE REISSUES THE CODE. An account that moved and kept its number would
 *   sort under its old parent on every report that orders by code, which is
 *   most of them.
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Op } = require('sequelize');
const { Child_Account } = require('../../models');

describe('Editing a chart-of-accounts entry', () => {
  let adminAuth;
  let staffAuth;
  // A real employee id, so createHistory writes its row instead of logging a
  // validation failure into every run's output.
  let adminId;
  const created = [];

  const add = async (title, ChildAccountId, extra = {}) => {
    const res = await request(app)
      .post('/accounts/createChildAccount')
      .set('Authorization', adminAuth)
      .send({ title: TEST_PREFIX + title, ChildAccountId, subCategory: 'General', ...extra });
    if (res.body?.result?.id) created.push(res.body.result.id);
    return res.body.result;
  };

  const edit = (auth, body) => request(app)
    .post('/accounts/editChildAccount')
    .set('Authorization', auth)
    .send(body);

  beforeAll(async () => {
    const admin = await loginAs('admin');
    adminAuth = admin.authHeader;
    adminId = admin.employee.id;
    ({ authHeader: staffAuth } = await loginAs('employee'));
  });

  afterAll(async () => {
    if (created.length) {
      await Child_Account.destroy({ where: { ChildAccountId: created } });
      await Child_Account.destroy({ where: { id: created } });
    }
    await Child_Account.destroy({ where: { title: { [Op.like]: TEST_PREFIX + '%' } } });
  });

  describe('who may edit what', () => {
    test('anyone may rename an ordinary account', async () => {
      const acc = await add('EDIT-ORDINARY', null);
      const res = await edit(staffAuth, {
        id: acc.id, title: TEST_PREFIX + 'EDIT-ORDINARY-RENAMED', employeeId: adminId,
      });
      expect(res.body.status).toBe('success');
      const after = await Child_Account.findByPk(acc.id);
      expect(after.title).toBe(TEST_PREFIX + 'EDIT-ORDINARY-RENAMED');
    });

    test('an ordinary employee may NOT edit a seeded account', async () => {
      const acc = await add('EDIT-LOCKED', null, { editable: 1 });
      const res = await edit(staffAuth, {
        id: acc.id, title: TEST_PREFIX + 'EDIT-LOCKED-RENAMED', employeeId: adminId,
      });
      expect(res.status).toBe(403);
      // The message names the account and says who may - a refusal that does
      // not say what to do next is a support call.
      expect(res.body.result).toMatch(/standard chart of accounts/i);

      const after = await Child_Account.findByPk(acc.id);
      expect(after.title).toBe(TEST_PREFIX + 'EDIT-LOCKED');
    });

    test('an admin may edit a seeded account', async () => {
      const acc = await add('EDIT-LOCKED-ADMIN', null, { editable: 1 });
      const res = await edit(adminAuth, {
        id: acc.id, title: TEST_PREFIX + 'EDIT-LOCKED-ADMIN-OK', employeeId: adminId,
      });
      expect(res.body.status).toBe('success');
      const after = await Child_Account.findByPk(acc.id);
      expect(after.title).toBe(TEST_PREFIX + 'EDIT-LOCKED-ADMIN-OK');
    });
  });

  describe('only a leaf may be moved', () => {
    test('a node with sub-accounts is refused, and told how many', async () => {
      const parentA = await add('MOVE-A', null);
      const parentB = await add('MOVE-B', null);
      await add('MOVE-A-CHILD', parentA.id);

      const res = await edit(adminAuth, {
        id: parentA.id, title: parentA.title, parentId: parentB.id, employeeId: adminId,
      });
      expect(res.status).toBe(409);
      expect(res.body.result).toMatch(/sub-account/i);

      const after = await Child_Account.findByPk(parentA.id);
      expect(after.ChildAccountId).toBeNull();   // it did not move
    });

    test('an account cannot be placed inside itself', async () => {
      const acc = await add('MOVE-SELF', null);
      const res = await edit(adminAuth, {
        id: acc.id, title: acc.title, parentId: acc.id, employeeId: adminId,
      });
      expect(res.status).toBe(409);
      expect(res.body.result).toMatch(/inside itself/i);
    });
  });

  describe('moving a leaf reissues its code', () => {
    test('the code is renumbered under the new parent', async () => {
      const home = await add('CODE-HOME', null);
      const away = await add('CODE-AWAY', null);
      const leaf = await add('CODE-LEAF', home.id);

      // It starts inside home's block: parent code x 10000 + 1.
      expect(Number(leaf.code)).toBe(Number(home.code) * 10000 + 1);

      const res = await edit(adminAuth, {
        id: leaf.id, title: leaf.title, parentId: away.id, employeeId: adminId,
      });
      expect(res.body.status).toBe('success');

      const after = await Child_Account.findByPk(leaf.id);
      expect(after.ChildAccountId).toBe(away.id);
      // ...and now inside away's, numbered exactly as a new child there.
      expect(Number(after.code)).toBe(Number(away.code) * 10000 + 1);
    });

    test('moving to the top level renumbers it as a top-level account', async () => {
      const home = await add('TOP-HOME', null);
      const leaf = await add('TOP-LEAF', home.id);

      const res = await edit(adminAuth, {
        id: leaf.id, title: leaf.title, parentId: null, employeeId: adminId,
      });
      expect(res.body.status).toBe('success');

      const after = await Child_Account.findByPk(leaf.id);
      expect(after.ChildAccountId).toBeNull();
      // A top-level code has no parent block, so it is a small number - not
      // the nine-digit one it carried underneath its old parent.
      expect(Number(after.code)).toBeLessThan(10000);
    });
  });

  describe('a placement the caller did not send is left alone', () => {
    /* THE DISTINCTION THIS DEFENDS: undefined is "not touching it", null is
     * "the top level". A rename that omitted the field would otherwise tear
     * the account out of the tree - and the old form sent parseInt('') for an
     * account with no parent, which is NaN. */
    test('renaming a child without sending parentId keeps its parent', async () => {
      const home = await add('KEEP-HOME', null);
      const leaf = await add('KEEP-LEAF', home.id);
      const codeBefore = leaf.code;

      const res = await edit(adminAuth, {
        id: leaf.id, title: TEST_PREFIX + 'KEEP-LEAF-RENAMED', employeeId: adminId,
      });
      expect(res.body.status).toBe('success');

      const after = await Child_Account.findByPk(leaf.id);
      expect(after.ChildAccountId).toBe(home.id);
      expect(after.code).toBe(codeBefore);       // and it was not renumbered
    });

    test('re-sending the SAME parent is not treated as a move', async () => {
      const home = await add('SAME-HOME', null);
      const leaf = await add('SAME-LEAF', home.id);
      const codeBefore = leaf.code;

      const res = await edit(adminAuth, {
        id: leaf.id, title: leaf.title, parentId: home.id, employeeId: adminId,
      });
      expect(res.body.status).toBe('success');

      const after = await Child_Account.findByPk(leaf.id);
      // Renumbering here would hand it a NEW code among its own siblings
      // every time somebody corrected a typo in the title.
      expect(after.code).toBe(codeBefore);
    });
  });
});
