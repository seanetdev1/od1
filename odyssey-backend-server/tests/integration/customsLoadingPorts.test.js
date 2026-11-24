const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const db = require('../../models');
const { KEY } = require('../../functions/customsLoadingPorts');

/* THE CUSTOMS PORTS OF LOADING - an option on the port in Setup > Ports (the
 * user's request, 2026-10-12). Ticked ports are the Port Of Loading list on a
 * customs job and in the Program Book; with none ticked, the built-in list an
 * install always had (CargoLinkers' three MCC desks). */
describe('customs ports of loading, from Setup > Ports', () => {
  const stamp = Date.now() % 100000;
  const code = `${TEST_PREFIX}QFS${stamp}`;
  let authHeader; let kept; let portPk;

  const polSea = async () => {
    const res = await request(app).get('/customsJob/getValues').set('Authorization', authHeader);
    expect(res.status).toBe(200);
    return res.body.result.vocabulary.polSea;
  };

  beforeAll(async () => {
    ({ authHeader } = await loginAs('admin'));
    // Whatever another suite left ticked is put back afterwards.
    kept = await db.AppSetting.findOne({ where: { key: KEY }, raw: true });
    await db.AppSetting.destroy({ where: { key: KEY } });
  });

  afterAll(async () => {
    await db.Ports.destroy({ where: { portId: code } });
    await db.AppSetting.destroy({ where: { key: KEY } });
    if (kept) await db.AppSetting.create({ key: KEY, value: kept.value });
  });

  it('none ticked: the built-in list, as before', async () => {
    expect((await polSea()).map((p) => p.id)).toEqual(['MEK', 'MPQ-EPZ', 'PQE']);
  });

  it('a port created with the option ticked is the list - by its name, keeping its code', async () => {
    const res = await request(app).post('/ports/createPort').set('Authorization', authHeader)
      .send({ portId: code, portName: 'QFS', portCountry: 'Pakistan', customsLoading: true });
    expect(res.body.status).toBe('success');
    expect(res.body.result.customsLoading).toBe(true);
    portPk = res.body.result.id;
    // Stored "QFS (code)", listed as the desk is called.
    expect(await polSea()).toEqual([{ id: code, name: 'QFS' }]);
  });

  it('the Ports list says which are ticked', async () => {
    const res = await request(app).get('/ports/get').set('Authorization', authHeader).query({ search: code });
    expect(res.body.result.find((p) => p.id === portPk).customsLoading).toBe(true);
  });

  // The user's report, 2026-10-13: the desks were offered as Port Of Discharge.
  it('a ticked desk is not a Port Of Discharge, nor in the freight port search - looked up by code, still found', async () => {
    const values = await request(app).get('/customsJob/getValues').set('Authorization', authHeader);
    expect(values.body.result.port.some((p) => p.id === code)).toBe(false);

    const search = await request(app).get('/ports/search').set('Authorization', authHeader).query({ search: code });
    expect(search.body.result.some((p) => p.portId === code)).toBe(false);
    const byCode = await request(app).get('/ports/search').set('Authorization', authHeader).query({ id: code });
    expect(byCode.body.result.map((p) => p.portId)).toEqual([code]);
  });

  it('an edit that does not mention it leaves it; unticked, the built-in list is back', async () => {
    await request(app).post('/ports/updatePort').set('Authorization', authHeader)
      .send({ data: { id: portPk, portId: code, portName: 'QFS', portCountry: 'Pakistan' } });
    expect((await polSea()).map((p) => p.id)).toEqual([code]);

    await request(app).post('/ports/updatePort').set('Authorization', authHeader)
      .send({ data: { id: portPk, portId: code, portName: 'QFS', portCountry: 'Pakistan', customsLoading: false } });
    expect((await polSea()).map((p) => p.id)).toEqual(['MEK', 'MPQ-EPZ', 'PQE']);
    // Unticked, it is an ordinary port again.
    const values = await request(app).get('/customsJob/getValues').set('Authorization', authHeader);
    expect(values.body.result.port.some((p) => p.id === code)).toBe(true);
  });

  it('a ticked port deleted is no longer listed', async () => {
    await request(app).post('/ports/updatePort').set('Authorization', authHeader)
      .send({ data: { id: portPk, portId: code, portName: 'QFS', portCountry: 'Pakistan', customsLoading: true } });
    await request(app).post('/ports/deletePort').set('Authorization', authHeader).send({ id: portPk });
    expect((await polSea()).map((p) => p.id)).toEqual(['MEK', 'MPQ-EPZ', 'PQE']);
  });
});
