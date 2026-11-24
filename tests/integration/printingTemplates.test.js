const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const request = require('supertest');
const app = require('../../index');
const { loginAs } = require('../helpers/auth');
const db = require('../../models');

/* Configuration > Printing Templates - routes/printingTemplates. Seanet saves
 * them, anyone reads them (the invoice screen asks which applies before it
 * prints), and a file with a mistake in its {fields} is refused. */
describe('printing templates', () => {
  const HO = fs.readFileSync(path.join(__dirname, '../fixtures/ho-enterprises-invoice.docx'));
  const b64 = (buf) => buf.toString('base64');
  let admin; let employee; let company; let madeCompany = false; let before;
  // "No LibreOffice" below means no Docker route to it either, even where this
  // PC's .env names SOFFICE_DOCKER_IMAGE.
  const dockerImage = process.env.SOFFICE_DOCKER_IMAGE;
  beforeAll(() => { delete process.env.SOFFICE_DOCKER_IMAGE; });
  afterAll(() => { if (dockerImage !== undefined) process.env.SOFFICE_DOCKER_IMAGE = dockerImage; });

  const save = (body, who = admin) => request(app).post('/printingTemplates/save').set('Authorization', who.authHeader).send(body);
  const applies = (companyId, type) => request(app).get('/printingTemplates/applies')
    .query({ companyId, type }).set('Authorization', employee.authHeader);

  beforeAll(async () => {
    admin = await loginAs('admin');
    employee = await loginAs('employee');
    before = await db.Printing_Template.findAll();
    await db.Printing_Template.destroy({ where: {} });
    company = await db.Company.findOne();
    if (!company) {
      company = await db.Company.create({ title: '__test__ Templates Co', short: 'TT' });
      madeCompany = true;
    }
  });

  afterAll(async () => {
    await db.Printing_Template.destroy({ where: {} });
    for (const row of before) await db.Printing_Template.create(row.get({ plain: true }));
    if (madeCompany) await company.destroy();
  });

  it('saves a Word file for a company and a document, with the names it uses', async () => {
    const res = await save({ companyId: company.id, docType: 'Job Invoice', fileName: 'ho.docx', content: b64(HO) });
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ companyId: company.id, docType: 'Job Invoice', fileName: 'ho.docx' });
    expect(Object.keys(res.body.result.tags)).toEqual(expect.arrayContaining(['invoiceNo', 'expenses', 'hasServiceCharges']));
  });

  it('saving again for the same company and document replaces it', async () => {
    await save({ companyId: company.id, docType: 'Job Invoice', fileName: 'ho-v2.docx', content: b64(HO) });
    const rows = await db.Printing_Template.findAll({ where: { companyId: company.id, docType: 'Job Invoice' } });
    expect(rows.map((r) => r.fileName)).toEqual(['ho-v2.docx']);
  });

  it('the invoice screen is told which applies - the most specific - and anyone may ask', async () => {
    await save({ companyId: null, docType: '*', fileName: 'default.docx', content: b64(HO) });
    expect((await applies(company.id, 'Job Invoice')).body.result.fileName).toBe('ho-v2.docx');
    expect((await applies(company.id, 'Job Bill')).body.result.fileName).toBe('default.docx');
    expect((await applies(999999, 'Old Job Invoice')).body.result.fileName).toBe('default.docx');
  });

  it('lists them, without the files', async () => {
    const res = await request(app).get('/printingTemplates/list').set('Authorization', employee.authHeader);
    expect(res.body.result.map((r) => r.fileName).sort()).toEqual(['default.docx', 'ho-v2.docx']);
    expect(res.body.result[0].content).toBeUndefined();
    expect(res.body.docTypes).toEqual(['Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill', 'Sales Tax Invoice', 'Bill of Lading', 'Air Waybill']);
  });

  it('gives the Word file back as it was saved', async () => {
    const row = await db.Printing_Template.findOne({ where: { fileName: 'default.docx' } });
    const res = await request(app).get(`/printingTemplates/${row.id}/file`).set('Authorization', employee.authHeader)
      .buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, HO)).toBe(0);
  });

  it('refuses a file with a mistake in its {fields}, naming it', async () => {
    const zip = new PizZip(HO);
    zip.file('word/document.xml', zip.file('word/document.xml').asText().replace('{/expenses}', ''));
    const res = await save({ companyId: null, docType: 'Job Bill', fileName: 'broken.docx', content: b64(zip.generate({ type: 'nodebuffer' })) });
    expect(res.status).toBe(422);
    expect(res.body.details.join(' ')).toMatch(/expenses/);
    expect(await db.Printing_Template.count({ where: { fileName: 'broken.docx' } })).toBe(0);
  });

  it('refuses what is not a Word file, an unknown document, an unknown company', async () => {
    expect((await save({ docType: '*', fileName: 'x.pdf', content: b64(Buffer.from('%PDF-1.4')) })).status).toBe(422);
    expect((await save({ docType: 'Receipt', fileName: 'x.docx', content: b64(HO) })).status).toBe(400);
    expect((await save({ companyId: 99999999, docType: '*', fileName: 'x.docx', content: b64(HO) })).status).toBe(400);
  });

  it('is Seanet\'s to save and remove', async () => {
    expect((await save({ docType: '*', fileName: 'x.docx', content: b64(HO) }, employee)).status).toBe(403);
    const row = await db.Printing_Template.findOne({ where: { fileName: 'default.docx' } });
    expect((await request(app).delete(`/printingTemplates/${row.id}`).set('Authorization', employee.authHeader)).status).toBe(403);
  });

  it('fills a template with the values the screen sends - here as the Word file', async () => {
    const res = await request(app).post('/printingTemplates/render').set('Authorization', admin.authHeader)
      .send({ companyId: company.id, type: 'Job Invoice', format: 'docx', fileName: 'HO-9695/26', fields: { invoiceNo: 'HO-9695/26', expenses: [] } })
      .buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('HO-9695_26.docx');
    expect(new PizZip(res.body).file('word/document.xml').asText()).toContain('HO-9695/26');
  });

  it('as a PDF, says plainly when the server has no LibreOffice', async () => {
    const was = process.env.SOFFICE_PATH;
    process.env.SOFFICE_PATH = path.join(__dirname, 'no-such-soffice');
    try {
      const res = await request(app).post('/printingTemplates/render').set('Authorization', admin.authHeader)
        .send({ companyId: company.id, type: 'Job Invoice', fields: { invoiceNo: 'X' } });
      expect(res.status).toBe(503);
      expect(res.body.result).toMatch(/LibreOffice/);
    } finally {
      if (was === undefined) delete process.env.SOFFICE_PATH; else process.env.SOFFICE_PATH = was;
    }
  });

  it('the Sales Tax Invoice prints only from a template saved for it', async () => {
    // Only the every-document one so far: that is an invoice layout, not this.
    expect((await applies(company.id, 'Sales Tax Invoice')).body.result).toBeNull();
    const saved = await save({ companyId: company.id, docType: 'Sales Tax Invoice', fileName: 'sti.docx', content: b64(HO) });
    expect(saved.status).toBe(200);
    expect((await applies(company.id, 'Sales Tax Invoice')).body.result.fileName).toBe('sti.docx');
    expect((await applies(company.id, 'Job Bill')).body.result.fileName).toBe('default.docx');
    await db.Printing_Template.destroy({ where: { fileName: 'sti.docx' } });
  });

  describe('a bulk print, many invoices as one PDF', () => {
    const many = (body) => request(app).post('/printingTemplates/renderMany').set('Authorization', admin.authHeader).send(body);

    it('refuses nothing to print, an invoice without values, a template that is gone', async () => {
      expect((await many({ items: [] })).status).toBe(400);
      const row = await db.Printing_Template.findOne({ where: { fileName: 'default.docx' } });
      expect((await many({ items: [{ templateId: row.id }] })).status).toBe(400);
      expect((await many({ items: [{ templateId: 99999999, fields: {} }] })).status).toBe(404);
    });

    it('says plainly when the server has no LibreOffice', async () => {
      const row = await db.Printing_Template.findOne({ where: { fileName: 'default.docx' } });
      const was = process.env.SOFFICE_PATH;
      process.env.SOFFICE_PATH = path.join(__dirname, 'no-such-soffice');
      try {
        const res = await many({ items: [{ templateId: row.id, fields: { invoiceNo: 'A' } }, { templateId: row.id, fields: { invoiceNo: 'B' } }] });
        expect(res.status).toBe(503);
        expect(res.body.result).toMatch(/LibreOffice/);
      } finally {
        if (was === undefined) delete process.env.SOFFICE_PATH; else process.env.SOFFICE_PATH = was;
      }
    });
  });

  it('removes one; then the next most specific applies', async () => {
    const row = await db.Printing_Template.findOne({ where: { fileName: 'ho-v2.docx' } });
    expect((await request(app).delete(`/printingTemplates/${row.id}`).set('Authorization', admin.authHeader)).status).toBe(200);
    expect((await applies(company.id, 'Job Invoice')).body.result.fileName).toBe('default.docx');
  });
});
