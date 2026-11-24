const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const db = require('../../models');

/* ESSANI'S OPTIONS (the user, 2026-11-14) - a customs job screen's layout and
 * labels (Configuration > Customs), and the GST invoice number's format
 * (Configuration > Invoices). Every user reads them; only an admin changes
 * them; unset, everything is as it was. */
describe('customs job form and GST number format settings', () => {
  const KEYS = ['customsJobForm', 'gstNumberFormat'];
  let admin; let employee; let kept;
  const get = (url, who) => request(app).get(url).set('Authorization', who.authHeader);
  const post = (url, body, who = admin) => request(app).post(url).set('Authorization', who.authHeader).send(body);

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    kept = await db.AppSetting.findAll({ where: { key: KEYS }, raw: true });
    await db.AppSetting.destroy({ where: { key: KEYS } });
  });

  afterAll(async () => {
    await db.AppSetting.destroy({ where: { key: KEYS } });
    for (const row of kept) await db.AppSetting.create({ key: row.key, value: row.value });
  });

  it('unset, the job screen is as it was', async () => {
    const res = await get('/settings/customsJobForm', employee);
    expect(res.body.result).toEqual({
      referenceLabel: 'S/R Page #', layout: null,
      addPorts: false, containerSizeList: false, freightForwarding: false, commodities: true,
      uniqueGdNumber: false, uniqueClientInvoice: false, uniqueJobRef: false,
      // Essani's Direct E/R File # from the S/R Page # (2026-11-17) - off.
      directJobFileFromRef: false,
    });
  });

  it('an admin saves it - the layout cleaned up on the way - and every user reads it', async () => {
    const saved = await post('/settings/customsJobForm', {
      referenceLabel: 'File Job Number',
      freightForwarding: true,
      commodities: false,
      layout: { tabs: [{ title: 'Job Details', sections: ['jobDetails', 'nonsense'] }] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.result.layout.tabs).toHaveLength(1);
    // Every section lands somewhere; the unknown one is dropped.
    expect(saved.body.result.layout.tabs[0].sections).toHaveLength(10);
    expect(saved.body.result.layout.tabs[0].sections).not.toContain('nonsense');
    const read = await get('/settings/customsJobForm', employee);
    expect(read.body.result).toMatchObject({ referenceLabel: 'File Job Number', freightForwarding: true, commodities: false });
  });

  it('refuses anyone else, and a bad value - keeping what was set', async () => {
    expect((await post('/settings/customsJobForm', { addPorts: true }, employee)).status).toBe(403);
    expect((await post('/settings/customsJobForm', { addPorts: 'yes' })).status).toBe(400);
    expect((await post('/settings/customsJobForm', { layout: { tabs: [] } })).status).toBe(400);
    expect((await get('/settings/customsJobForm', employee)).body.result.referenceLabel).toBe('File Job Number');
  });

  it('the GST number format: unset is CODE-#, an admin sets four digits, nonsense refused', async () => {
    expect((await get('/settings/gstNumberFormat', employee)).body.result).toEqual({
      format: '{CODE}-#', isDefault: true, example: 'ABC-1',
    });
    const saved = await post('/settings/gstNumberFormat', { format: String.raw`{CODE}-\d{4}` });
    expect(saved.body.result).toEqual({ format: String.raw`{CODE}-\d{4}`, isDefault: false, example: 'ABC-0001' });
    expect((await post('/settings/gstNumberFormat', { format: '{CODE}-' })).status).toBe(400);
    expect((await post('/settings/gstNumberFormat', { format: '####' }, employee)).status).toBe(403);
    // Blank goes back to the default.
    expect((await post('/settings/gstNumberFormat', { format: ' ' })).body.result.isDefault).toBe(true);
  });
});
