/**
 * Charge groups - routes/customsChargeGroups/index.js.
 *
 * A group is a named set of default charges for a kind of client: the parties
 * it applies to, and the receivable and payable lines the job's charge sheet
 * imports in a click.
 *
 * What a pure function cannot be asked, and so what these tests are about:
 *
 *   - a group saved whole REPLACES its children, because the screen edits it
 *     whole; a line or a party removed there must actually be gone
 *   - a party may be in several groups, and /forParty must return all of them,
 *     because that is what makes the import ask which one instead of guessing
 *   - an inactive group is not offered for import, while the jobs it was
 *     already imported onto keep their charges
 *   - deleting a group takes its parties and lines with it
 */
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { Op } = require('sequelize');
const {
  Customs_Charge_Group, Customs_Charge_Group_Party, Customs_Charge_Group_Line,
} = require('../../models');

describe('Customs charge groups', () => {
  let authHeader;
  const groupIds = [];

  const auth = (req) => req.set('Authorization', authHeader);

  const save = (data) => auth(request(app).post('/customsChargeGroups/save')).send({ data });

  const saveGroup = async (data) => {
    const res = await save(data);
    if (res.body?.result?.id) groupIds.push(res.body.result.id);
    return res;
  };

  /* The app's own spellings - Charge_Head.type holds 'Recievable' and
     'Payble', misspelled and load-bearing. A test written against tidied ones
     would pass while the feature imported onto a side the charge sheet does
     not recognise. */
  const { CH_RECEIVABLE, CH_PAYABLE } = require('../../functions/customsCharge');

  const line = (x = {}) => ({
    type: CH_RECEIVABLE, charge: '1', particular: 'CLEARANCE',
    basis: 'Per Shipment', qty: 1, rate_charge: 5000, currency: 'PKR', ...x,
  });

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
  });

  afterAll(async () => {
    if (groupIds.length) {
      await Customs_Charge_Group.destroy({ where: { id: { [Op.in]: groupIds } } });
    }
    await Customs_Charge_Group.destroy({ where: { name: { [Op.like]: `${TEST_PREFIX}%` } } });
  });

  describe('saving a group', () => {
    test('stores it with its parties and its lines', async () => {
      const res = await saveGroup({
        name: TEST_PREFIX + 'Standard Importers',
        description: 'Container importers on standard terms',
        parties: [{ partyId: '101', partyName: 'AL-BASIT' }, { partyId: '102', partyName: 'ZEESHAN' }],
        lines: [line(), line({ type: CH_PAYABLE, charge: '2', rate_charge: 3000 })],
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.result.Customs_Charge_Group_Parties).toHaveLength(2);
      expect(res.body.result.Customs_Charge_Group_Lines).toHaveLength(2);
    });

    test('refuses a group with no name', async () => {
      const res = await save({ name: '   ', lines: [] });
      expect(res.status).toBe(400);
      expect(res.body.result).toMatch(/name/i);
    });

    test('drops a line that names no charge', async () => {
      // An empty row somebody tabbed through, not a charge.
      const res = await saveGroup({
        name: TEST_PREFIX + 'Half filled',
        lines: [line(), { type: CH_RECEIVABLE, charge: '' }, { type: CH_PAYABLE }],
      });
      expect(res.body.result.Customs_Charge_Group_Lines).toHaveLength(1);
    });

    test('keeps a rate nobody typed as NULL, not zero', async () => {
      // A group may be no more than "these heads always apply", with the rates
      // typed per job. A 0 would read as free.
      const res = await saveGroup({
        name: TEST_PREFIX + 'Heads only',
        lines: [{ type: CH_RECEIVABLE, charge: '7' }],
      });
      const [only] = res.body.result.Customs_Charge_Group_Lines;
      expect(only.rate_charge).toBeNull();
      expect(only.qty).toBeNull();
    });

    test('the same party twice in one group is stored once', async () => {
      const res = await saveGroup({
        name: TEST_PREFIX + 'Duplicated party',
        parties: [{ partyId: '900' }, { partyId: '900', partyName: 'Again' }],
        lines: [line()],
      });
      expect(res.body.result.Customs_Charge_Group_Parties).toHaveLength(1);
    });

    test('lines come back in the order they were written', async () => {
      const res = await saveGroup({
        name: TEST_PREFIX + 'Ordered',
        lines: [
          line({ particular: 'FIRST' }),
          line({ particular: 'SECOND' }),
          line({ particular: 'THIRD' }),
        ],
      });
      expect(res.body.result.Customs_Charge_Group_Lines.map((l) => l.particular))
        .toEqual(['FIRST', 'SECOND', 'THIRD']);
    });
  });

  describe('editing a group', () => {
    test('REPLACES its children rather than merging them', async () => {
      // The screen edits the whole group and sends it whole, so anything
      // absent was deleted there. Merging would make a removal impossible.
      const created = await saveGroup({
        name: TEST_PREFIX + 'Replace me',
        parties: [{ partyId: '201' }, { partyId: '202' }],
        lines: [line({ particular: 'OLD A' }), line({ particular: 'OLD B' })],
      });
      const id = created.body.result.id;

      const edited = await save({
        id,
        name: TEST_PREFIX + 'Replace me',
        parties: [{ partyId: '201' }],
        lines: [line({ particular: 'NEW ONLY' })],
      });

      expect(edited.body.result.Customs_Charge_Group_Parties).toHaveLength(1);
      expect(edited.body.result.Customs_Charge_Group_Lines.map((l) => l.particular))
        .toEqual(['NEW ONLY']);

      // And gone from the database, not merely absent from the response.
      expect(await Customs_Charge_Group_Line.count({ where: { CustomsChargeGroupId: id } })).toBe(1);
      expect(await Customs_Charge_Group_Party.count({ where: { CustomsChargeGroupId: id } })).toBe(1);
    });

    test('leaves children alone when the screen sends none', async () => {
      // Renaming a group must not empty it. An ABSENT array means "the screen
      // did not send these"; an empty one means "it has none".
      const created = await saveGroup({
        name: TEST_PREFIX + 'Rename me',
        parties: [{ partyId: '301' }],
        lines: [line()],
      });
      const id = created.body.result.id;

      const renamed = await save({ id, name: TEST_PREFIX + 'Renamed' });
      expect(renamed.body.result.name).toBe(TEST_PREFIX + 'Renamed');
      expect(renamed.body.result.Customs_Charge_Group_Lines).toHaveLength(1);
      expect(renamed.body.result.Customs_Charge_Group_Parties).toHaveLength(1);
    });
  });

  describe('the groups a party is in', () => {
    const PARTY = '777';

    beforeAll(async () => {
      await saveGroup({
        name: TEST_PREFIX + 'Party A group',
        parties: [{ partyId: PARTY, partyName: 'Shared client' }],
        lines: [line()],
      });
      await saveGroup({
        name: TEST_PREFIX + 'Party B group',
        parties: [{ partyId: PARTY, partyName: 'Shared client' }],
        lines: [line({ type: CH_PAYABLE })],
      });
      await saveGroup({
        name: TEST_PREFIX + 'Archived group',
        parties: [{ partyId: PARTY }],
        lines: [line()],
        active: false,
      });
    });

    test('returns every ACTIVE group it belongs to', async () => {
      // Which is what lets the import ask rather than guess: the same client
      // genuinely buys two different services.
      const res = await auth(request(app).get('/customsChargeGroups/forParty'))
        .set('partyid', PARTY);

      expect(res.status).toBe(200);
      const names = res.body.result.map((g) => g.name);
      expect(names).toContain(TEST_PREFIX + 'Party A group');
      expect(names).toContain(TEST_PREFIX + 'Party B group');
    });

    test('an archived group is not offered', async () => {
      const res = await auth(request(app).get('/customsChargeGroups/forParty'))
        .set('partyid', PARTY);
      expect(res.body.result.map((g) => g.name)).not.toContain(TEST_PREFIX + 'Archived group');
    });

    test('a party in no group gets an empty list, not an error', async () => {
      // The button simply does not appear; nothing has gone wrong.
      const res = await auth(request(app).get('/customsChargeGroups/forParty'))
        .set('partyid', 'no-such-party');
      expect(res.status).toBe(200);
      expect(res.body.result).toEqual([]);
    });

    test('no party id is refused', async () => {
      const res = await auth(request(app).get('/customsChargeGroups/forParty'));
      expect(res.status).toBe(400);
    });

    test('the lines come with it, so the import needs no second call', async () => {
      const res = await auth(request(app).get('/customsChargeGroups/forParty'))
        .set('partyid', PARTY);
      const group = res.body.result.find((g) => g.name === TEST_PREFIX + 'Party A group');
      expect(group.Customs_Charge_Group_Lines.length).toBeGreaterThan(0);
      expect(group.Customs_Charge_Group_Lines[0]).toHaveProperty('rate_charge');
    });
  });

  describe('deleting a group', () => {
    test('takes its parties and lines with it', async () => {
      const created = await saveGroup({
        name: TEST_PREFIX + 'Delete me',
        parties: [{ partyId: '401' }],
        lines: [line(), line({ type: CH_PAYABLE })],
      });
      const id = created.body.result.id;

      const res = await auth(request(app).post('/customsChargeGroups/delete')).send({ id });
      expect(res.status).toBe(200);

      expect(await Customs_Charge_Group.count({ where: { id } })).toBe(0);
      expect(await Customs_Charge_Group_Line.count({ where: { CustomsChargeGroupId: id } })).toBe(0);
      expect(await Customs_Charge_Group_Party.count({ where: { CustomsChargeGroupId: id } })).toBe(0);
    });

    test('a group that is not there is a 404, not a crash', async () => {
      const res = await auth(request(app).post('/customsChargeGroups/delete')).send({ id: 99999999 });
      expect(res.status).toBe(404);
    });
  });
});
