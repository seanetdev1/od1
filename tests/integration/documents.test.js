/**
 * Documents attached to records (routes/documents) - the user's requests,
 * 2026-11-13: scans on jobs (every mode), vouchers, invoices and Direct Jobs;
 * a type on each from a list Configuration edits, and a job's documents of a
 * type marked for invoices shown on the job's invoices; PDFs opened in the
 * browser, images in Odyssey, Word and Excel downloaded; 10 MB each; kept in
 * a folder chosen in Configuration - none chosen, nothing attached - which
 * can move, the rows holding only where a file is inside it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const app = require('../../index');
const { loginAs, TEST_PREFIX } = require('../helpers/auth');
const { anyCompany } = require('../helpers/company');
const db = require('../../models');
const permissions = require('../../functions/permissions/middleware');
const grants = require('../../functions/permissions/grants');
const store = require('../../functions/documents/store');
const settings = require('../../functions/documents/settings');
const { signPrintToken } = require('../../functions/printToken');

const {
  Document, SE_Job, Customs_Job, Aviation_Job, Aviation_Consignment, Invoice, Charge_Head,
  Company, Employee_Company, History, AppSetting,
} = db;

// The default types (functions/documents/settings.js).
const INVOICE = 1;
const BILL_OF_LADING = 2;

describe('documents attached to records', () => {
  const stamp = Date.now();
  let base; let folder;
  let admin; let viewer; let editor; let remover; let otherOperation; let otherCompany; let invoiceReader;
  let company; let elsewhere; let job; let n = 0;
  const made = { jobs: [], customs: [], aviation: [], awbs: [], invoices: [], lines: [] };

  // A PDF no other test has sent: the same file twice on a record is refused.
  const pdf = () => Buffer.from(`%PDF-1.4\n% ${stamp}-${(n += 1)}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
  const upload = (who, bytes, name, { entity = 'SE_Job', recordId = job.id, typeId = INVOICE, title } = {}) => request(app)
    .post('/documents/upload')
    .query({ entity, recordId, name, ...(typeId ? { typeId } : {}), ...(title ? { title } : {}) })
    .set('Authorization', who.authHeader)
    .set('Content-Type', 'application/octet-stream')
    .send(bytes);
  const list = (who, recordId = job.id, entity = 'SE_Job') => request(app).get('/documents')
    .query({ entity, recordId }).set('Authorization', who.authHeader);
  const link = (who, id, from) => request(app).get(`/documents/${id}/link`).query(from || {}).set('Authorization', who.authHeader);
  const remove = (who, id) => request(app).post(`/documents/${id}/delete`).set('Authorization', who.authHeader);
  const choose = (who, p, force) => request(app).post('/documents/settings/path').set('Authorization', who.authHeader)
    .send({ path: p, ...(force ? { force: true } : {}) });
  // The URL a link hands back, fetched as a browser tab would: no login.
  const open = (url) => request(app).get(url).buffer(true).parse((res, done) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });
  const grant = async (who, names) => {
    for (const name of [...names, 'perm:catalog:4']) await db.Access_Levels.create({ EmployeeId: who.employee.id, access_name: name });
    grants.invalidate(who.employee.id);
  };
  const reset = async () => {
    await AppSetting.destroy({ where: { key: [settings.PATH_KEY, settings.TYPES_KEY] } });
    settings.forget();
  };

  beforeAll(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'odyssey-documents-'));
    folder = path.join(base, 'docs');
    process.env.ODYSSEY_DOCUMENTS_ROOTS = base;
    process.env.ODYSSEY_DOCUMENTS_MIN_FREE_MB = '0';
    // A throwaway test database: start with no documents and no settings.
    await Document.destroy({ where: {}, force: true });
    await reset();
    permissions._setModeForTest('enforce');

    company = await anyCompany();
    elsewhere = await Company.create({ title: `${TEST_PREFIX}Docs Elsewhere ${stamp}`, short: 'TDE' });
    job = await SE_Job.create({ jobNo: `${TEST_PREFIX}DOC-${stamp}`, operation: 'SE', companyId: String(company.id) }, { fiscalYearCheck: false });
    made.jobs.push(job);

    admin = await loginAs('admin');
    viewer = await loginAs('employee');
    editor = await loginAs('employee');
    remover = await loginAs('employee');
    otherOperation = await loginAs('employee');
    otherCompany = await loginAs('employee');
    invoiceReader = await loginAs('employee');
    await grant(viewer, ['perm:seaExport:view']);
    await grant(editor, ['perm:seaExport:view', 'perm:seaExport:edit']);
    await grant(remover, ['perm:seaExport:view', 'perm:seaExport:delete']);
    await grant(otherOperation, ['perm:seaImport:view', 'perm:seaImport:edit', 'perm:seaImport:delete']);
    await grant(otherCompany, ['perm:seaExport:view', 'perm:seaExport:edit']);
    await grant(invoiceReader, ['perm:invoices:view']);
    await Employee_Company.create({ EmployeeId: otherCompany.employee.id, CompanyId: elsewhere.id });
    grants.invalidate(otherCompany.employee.id);
  });

  afterAll(async () => {
    permissions._setModeForTest(null);
    await Document.destroy({ where: {}, force: true });
    await reset();
    await Charge_Head.destroy({ where: { id: made.lines } });
    await Invoice.destroy({ where: { id: made.invoices }, force: true });
    await Aviation_Consignment.destroy({ where: { id: made.awbs } });
    await Aviation_Job.destroy({ where: { id: made.aviation }, force: true });
    await Customs_Job.destroy({ where: { id: made.customs }, force: true });
    await SE_Job.destroy({ where: { id: made.jobs.map((j) => j.id) }, force: true });
    await Employee_Company.destroy({ where: { CompanyId: elsewhere.id } });
    await elsewhere.destroy();
    delete process.env.ODYSSEY_DOCUMENTS_ROOTS;
    delete process.env.ODYSSEY_DOCUMENTS_MIN_FREE_MB;
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('before Configuration chooses a folder', () => {
    test('nothing can be attached, and the screen is told so', async () => {
      const res = await upload(admin, pdf(), 'early.pdf');
      expect(res.status).toBe(503);
      expect(res.body.result).toMatch(/Configuration > Documents/);
      const listed = await list(admin);
      expect(listed.status).toBe(200);
      expect(listed.body.ready).toBe(false);
    });
  });

  describe('choosing the folder (Seanet, Configuration > Documents)', () => {
    test('only Seanet chooses it', async () => {
      expect((await choose(editor, folder)).status).toBe(403);
      expect((await request(app).get('/documents/settings').set('Authorization', editor.authHeader)).status).toBe(403);
    });

    test('only a full path, inside the folders the server makes available', async () => {
      expect((await choose(admin, 'docs')).status).toBe(400);
      const outside = await choose(admin, path.join(os.tmpdir(), `elsewhere-${stamp}`));
      expect(outside.status).toBe(400);
      expect(outside.body.result).toMatch(/can only reach folders inside/);
    });

    test('its folders can be browsed to pick one', async () => {
      fs.mkdirSync(path.join(base, 'drive-b', 'odyssey'), { recursive: true });
      const top = await request(app).get('/documents/settings/browse').set('Authorization', admin.authHeader);
      expect(top.body.result.folders.map((f) => f.path)).toEqual([path.resolve(base)]);
      const inside = await request(app).get('/documents/settings/browse').query({ path: base }).set('Authorization', admin.authHeader);
      expect(inside.body.result.folders.map((f) => f.name)).toEqual(['drive-b']);
      expect(inside.body.result.parent).toBeNull();
      const deeper = await request(app).get('/documents/settings/browse').query({ path: path.join(base, 'drive-b') }).set('Authorization', admin.authHeader);
      expect(deeper.body.result.parent).toBe(path.resolve(base));
      expect((await request(app).get('/documents/settings/browse').query({ path: os.homedir() }).set('Authorization', admin.authHeader)).status).toBe(400);
    });

    test('chosen, it is made and marked, and documents can be attached', async () => {
      const res = await choose(admin, folder);
      expect(res.status).toBe(200);
      expect(fs.existsSync(path.join(folder, store.MARKER))).toBe(true);
      const state = (await request(app).get('/documents/settings').set('Authorization', admin.authHeader)).body.result;
      expect(state).toMatchObject({ path: path.resolve(folder), folder: { exists: true, marked: true } });
      expect((await list(admin)).body.ready).toBe(true);
    });
  });

  describe('attaching, listing and opening', () => {
    test('a PDF attached to a job as an Invoice is listed with its type and who attached it', async () => {
      const bytes = pdf();
      const res = await upload(admin, bytes, 'GD scan.pdf');
      expect(res.status).toBe(201);
      expect(res.body.result).toMatchObject({ name: 'GD scan.pdf', size: bytes.length, view: 'pdf', typeId: INVOICE, type: 'Invoice', from: null });
      expect(res.body.result.uploadedBy).toBe(admin.employee.name);

      const listed = await list(admin);
      expect(listed.body.result.map((d) => d.name)).toContain('GD scan.pdf');
      expect(listed.body.rights).toEqual({ add: true, delete: true });
      expect(listed.body.types.map((t) => t.name)).toContain('Bill of Lading');
      expect(listed.body.limits.maxBytes).toBe(10 * 1024 * 1024);

      // On disk under its place inside the folder - all the row holds.
      const row = await Document.findByPk(res.body.result.id);
      expect(row.storedName).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
      expect(fs.readFileSync(path.join(folder, row.storedName))).toEqual(bytes);
      const logged = await History.findOne({ where: { EmployeeId: admin.employee.id, formName: 'Documents', type: 'Attached' } });
      expect(logged.docNo).toBe(`Job ${job.jobNo}: GD scan.pdf (Invoice)`);
    });

    test('its type must be one of the list, and offered', async () => {
      const none = await upload(admin, pdf(), 'untyped.pdf', { typeId: null });
      expect(none.status).toBe(400);
      expect(none.body.result).toMatch(/Pick what the document is/);
      expect((await upload(admin, pdf(), 'odd.pdf', { typeId: 999 })).status).toBe(400);
    });

    test('its link opens it in the browser - no login, just the link', async () => {
      const bytes = pdf();
      const { body } = await upload(admin, bytes, 'BL copy.pdf', { typeId: BILL_OF_LADING });
      const res = await link(admin, body.result.id);
      expect(res.body.result).toMatchObject({ view: 'pdf', name: 'BL copy.pdf' });
      const file = await open(res.body.result.url);
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(file.headers['content-disposition']).toMatch(/^inline; /);
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(file.body).toEqual(bytes);
      expect((await open(`${res.body.result.url}&download=1`)).headers['content-disposition']).toMatch(/^attachment; /);
    });

    test('a picture is shown, a Word file is downloaded - under its own name', async () => {
      const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`photo ${stamp}`)]);
      const picture = (await upload(admin, jpg, 'Cheque 0042.jpg', { typeId: 6 })).body.result;
      expect(picture.view).toBe('image');
      const shown = await open((await link(admin, picture.id)).body.result.url);
      expect(shown.headers['content-type']).toBe('image/jpeg');
      expect(shown.headers['content-disposition']).toMatch(/^inline; /);

      const word = (await upload(admin, Buffer.from(`PK\x03\x04 letter ${stamp}`, 'latin1'), 'Délivery letter.docx', { typeId: 7 })).body.result;
      expect(word.view).toBe('download');
      const got = await open((await link(admin, word.id)).body.result.url);
      expect(got.headers['content-disposition'])
        .toBe(`attachment; filename="D_livery letter.docx"; filename*=UTF-8''D%C3%A9livery%20letter.docx`);
    });

    test('a link that is not one - forged, or another print\'s - opens nothing', async () => {
      const { body } = await upload(admin, pdf(), 'secret.pdf');
      expect((await open('/documents/file?t=nonsense')).status).toBe(403);
      expect((await open(`/documents/file?t=${signPrintToken(body.result.id)}`)).status).toBe(403);
      expect((await open('/documents/file')).status).toBe(403);
    });
  });

  describe('what is refused', () => {
    test('without signing in', async () => {
      const res = await request(app).post('/documents/upload').query({ entity: 'SE_Job', recordId: job.id, name: 'a.pdf', typeId: 1 }).send(pdf());
      expect(res.status).toBe(401);
    });

    test('a page dressed as a picture, a program, more than 10 MB, the same file twice', async () => {
      expect((await upload(admin, Buffer.from('<html><script>alert(1)</script>'), 'scan.jpg')).status).toBe(415);
      expect((await upload(admin, Buffer.from('MZ'), 'tool.exe')).status).toBe(415);

      const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024, 0x20)]);
      const tooBig = await upload(admin, big, 'huge.pdf');
      expect(tooBig.status).toBe(413);
      expect(tooBig.body.result).toMatch(/limit is 10\.0 MB/);

      const bytes = pdf();
      expect((await upload(admin, bytes, 'first.pdf')).status).toBe(201);
      const again = await upload(admin, bytes, 'second.pdf', { typeId: 7 });
      expect(again.status).toBe(409);
      expect(again.body.result).toMatch(/already attached here, as "first\.pdf"/);
      // None of them left a file behind.
      const kept = (await Document.findAll({ paranoid: false })).map((d) => d.storedName);
      const onDisk = fs.readdirSync(folder, { recursive: true }).filter((f) => /\.(pdf|jpg|docx|exe)$/.test(f)).map((f) => f.split(path.sep).join('/'));
      expect(onDisk.sort()).toEqual(kept.sort());
    });

    test('every kind of record that may have documents can be looked up', async () => {
      // A missing one of each: the lookup runs, and a wrong column would be a 500.
      const { KINDS } = require('../../functions/documents/kinds');
      expect(Object.keys(KINDS).sort()).toEqual(['Aviation_Job', 'Customs_Job', 'Direct_Job', 'Invoice', 'SE_Job', 'Vouchers']);
      for (const entity of Object.keys(KINDS)) {
        const res = await request(app).get('/documents').query({ entity, recordId: 999999999 }).set('Authorization', admin.authHeader);
        expect([entity, res.status]).toEqual([entity, 404]);
      }
    });

    test('a kind of record that has no documents, a record that is not there, a new one not yet saved', async () => {
      expect((await upload(admin, pdf(), 'a.pdf', { entity: 'Employees' })).status).toBe(400);
      expect((await upload(admin, pdf(), 'a.pdf', { entity: 'constructor' })).status).toBe(400);
      expect((await upload(admin, pdf(), 'a.pdf', { recordId: 999999999 })).status).toBe(404);
      expect((await upload(admin, pdf(), 'a.pdf', { recordId: 'new' })).status).toBe(400);
    });

    test('a folder that is not the right one - an unmounted drive - takes nothing', async () => {
      const marker = path.join(folder, store.MARKER);
      const kept = fs.readFileSync(marker);
      fs.rmSync(marker);
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await upload(admin, pdf(), 'a.pdf');
        expect(res.status).toBe(503);
        expect(res.body.result).toMatch(/drive may not be mounted/);
      } finally {
        error.mockRestore();
        fs.writeFileSync(marker, kept);
      }
    });
  });

  describe('who may - the record\'s own rights, in enforce mode', () => {
    let doc;
    beforeAll(async () => {
      doc = (await upload(admin, pdf(), 'rights.pdf')).body.result;
    });

    test('viewing the job: sees and opens its documents, attaches and removes nothing', async () => {
      const listed = await list(viewer);
      expect(listed.status).toBe(200);
      expect(listed.body.rights).toEqual({ add: false, delete: false });
      expect((await link(viewer, doc.id)).status).toBe(200);
      expect((await upload(viewer, pdf(), 'no.pdf')).status).toBe(403);
      expect((await remove(viewer, doc.id)).status).toBe(403);
    });

    test('editing the job: attaches - Create & edit; removing takes Delete', async () => {
      expect((await list(editor)).body.rights).toEqual({ add: true, delete: false });
      expect((await upload(editor, pdf(), 'yes.pdf')).status).toBe(201);
      expect((await remove(editor, doc.id)).status).toBe(403);
      expect((await list(remover)).body.rights).toEqual({ add: false, delete: true });
    });

    test('rights on another kind of job are not rights on this one', async () => {
      expect((await list(otherOperation)).status).toBe(403);
      expect((await link(otherOperation, doc.id)).status).toBe(403);
      expect((await upload(otherOperation, pdf(), 'no.pdf')).status).toBe(403);
    });

    test('another company\'s job is not theirs to see', async () => {
      const res = await list(otherCompany);
      expect(res.status).toBe(403);
      expect(res.body.result).toMatch(/company/);
      expect((await link(otherCompany, doc.id)).status).toBe(403);
    });
  });

  describe('a job\'s invoice scans, on the job\'s invoices', () => {
    let invoiceDoc; let blDoc; let freightInvoice;
    const invoice = async (extra) => {
      const inv = await Invoice.create({
        invoice_No: `${TEST_PREFIX}JI-DOC-${stamp}-${made.invoices.length}`, type: 'Job Invoice', operation: 'SE',
        companyId: String(company.id), ...extra,
      }, { fiscalYearCheck: false });
      made.invoices.push(inv.id);
      return inv;
    };
    const line = async (values) => {
      const l = await Charge_Head.create({ charge: `${TEST_PREFIX}DOC`, type: 'Recievable', amount: '1', net_amount: '1', local_amount: '1', ...values });
      made.lines.push(l.id);
    };

    beforeAll(async () => {
      freightInvoice = await invoice({ SEJobId: job.id });
      invoiceDoc = (await upload(admin, pdf(), 'Commercial invoice.pdf', { typeId: INVOICE })).body.result;
      blDoc = (await upload(admin, pdf(), 'Original BL.pdf', { typeId: BILL_OF_LADING })).body.result;
    });

    test('the invoice shows the job\'s Invoice documents, saying they are the job\'s - not its other ones', async () => {
      const res = await list(admin, freightInvoice.id, 'Invoice');
      expect(res.status).toBe(200);
      const shown = res.body.result.find((d) => d.id === invoiceDoc.id);
      expect(shown).toMatchObject({ type: 'Invoice', from: { entity: 'SE_Job', recordId: String(job.id), label: `Job ${job.jobNo}` } });
      expect(res.body.result.map((d) => d.id)).not.toContain(blDoc.id);
      expect(res.body.result.every((d) => d.type === 'Invoice')).toBe(true);
    });

    test('whoever may see the invoice may open them from it - and only them', async () => {
      const from = { entity: 'Invoice', recordId: freightInvoice.id };
      expect((await list(invoiceReader, freightInvoice.id, 'Invoice')).status).toBe(200);
      const res = await link(invoiceReader, invoiceDoc.id, from);
      expect(res.status).toBe(200);
      expect((await open(res.body.result.url)).status).toBe(200);
      // Not from the job itself, which they cannot see, nor the job's B/L.
      expect((await link(invoiceReader, invoiceDoc.id)).status).toBe(403);
      expect((await link(invoiceReader, blDoc.id, from)).status).toBe(403);
      // Removing it is the job's business.
      expect((await remove(invoiceReader, invoiceDoc.id)).status).toBe(403);
    });

    test('a customs or aviation invoice finds its job through its charge lines', async () => {
      const customsJob = await Customs_Job.create({
        jobNo: `${TEST_PREFIX}CCJ-DOC-${stamp}`, companyId: String(company.id), direction: 'Import', transportMode: 'Sea',
      }, { fiscalYearCheck: false });
      made.customs.push(customsJob.id);
      const customsInvoice = await invoice({});
      await line({ InvoiceId: customsInvoice.id, CustomsJobId: customsJob.id });
      const onCustoms = (await upload(admin, pdf(), 'GD invoice.pdf', { entity: 'Customs_Job', recordId: customsJob.id })).body.result;
      const res = await list(admin, customsInvoice.id, 'Invoice');
      expect(res.body.result.map((d) => [d.id, d.from?.label])).toEqual([[onCustoms.id, `Job ${customsJob.jobNo}`]]);

      const flight = await Aviation_Job.create({ jobNo: `${TEST_PREFIX}AVJ-DOC-${stamp}`, companyId: String(company.id) }, { fiscalYearCheck: false });
      made.aviation.push(flight.id);
      const awb = await Aviation_Consignment.create({ AviationJobId: flight.id, awb: `${TEST_PREFIX}AWB`, sortOrder: 0 });
      made.awbs.push(awb.id);
      const aviationInvoice = await invoice({});
      await line({ InvoiceId: aviationInvoice.id, AviationConsignmentId: awb.id });
      const onFlight = (await upload(admin, pdf(), 'Flight invoice.pdf', { entity: 'Aviation_Job', recordId: flight.id })).body.result;
      const flown = await list(admin, aviationInvoice.id, 'Invoice');
      expect(flown.body.result.map((d) => d.id)).toEqual([onFlight.id]);
    });

    test('ticking another type for invoices shows those too', async () => {
      const { types } = await settings.getTypes();
      const res = await request(app).post('/documents/types').set('Authorization', admin.authHeader)
        .send({ types: types.map((t) => (t.id === BILL_OF_LADING ? { ...t, onInvoices: true } : t)) });
      expect(res.status).toBe(200);
      expect((await list(admin, freightInvoice.id, 'Invoice')).body.result.map((d) => d.id)).toContain(blDoc.id);
    });
  });

  describe('the types (Configuration > Documents)', () => {
    test('any user reads them - with how many documents have each', async () => {
      const res = await request(app).get('/documents/types').set('Authorization', viewer.authHeader);
      expect(res.status).toBe(200);
      expect(res.body.result[0]).toMatchObject({ id: INVOICE });
      expect(res.body.inUse[INVOICE]).toBeGreaterThan(0);
    });

    test('only Seanet changes them; a rename is a rename on every document', async () => {
      const { types } = await settings.getTypes();
      const renamed = types.map((t) => (t.id === INVOICE ? { ...t, name: 'Commercial Invoice' } : t));
      expect((await request(app).post('/documents/types').set('Authorization', editor.authHeader).send({ types: renamed })).status).toBe(403);
      expect((await request(app).post('/documents/types').set('Authorization', admin.authHeader).send({ types: renamed })).status).toBe(200);
      expect((await list(admin)).body.result.filter((d) => d.typeId === INVOICE).every((d) => d.type === 'Commercial Invoice')).toBe(true);
    });

    test('one in use is retired, not removed - and a retired one is not offered', async () => {
      const { types } = await settings.getTypes();
      const gone = await request(app).post('/documents/types').set('Authorization', admin.authHeader)
        .send({ types: types.filter((t) => t.id !== BILL_OF_LADING) });
      expect(gone.status).toBe(400);
      expect(gone.body.result).toMatch(/cannot be removed - untick Offered/);
      const retired = await request(app).post('/documents/types').set('Authorization', admin.authHeader)
        .send({ types: types.map((t) => (t.id === BILL_OF_LADING ? { ...t, offered: false } : t)) });
      expect(retired.status).toBe(200);
      expect((await list(admin)).body.types.map((t) => t.id)).not.toContain(BILL_OF_LADING);
      expect((await upload(admin, pdf(), 'late BL.pdf', { typeId: BILL_OF_LADING })).status).toBe(400);
      // Still on the documents that have it.
      expect((await list(admin)).body.result.some((d) => d.type === 'Bill of Lading')).toBe(true);
    });
  });

  describe('moving the folder', () => {
    test('a folder the documents are not in yet is refused, saying how many - until they are copied over', async () => {
      const moved = path.join(base, 'drive-b', 'odyssey');
      const refused = await choose(admin, moved);
      expect(refused.status).toBe(409);
      const total = await Document.count({ paranoid: false });
      expect(refused.body).toMatchObject({ status: 'missing', missing: total, total });

      fs.cpSync(folder, moved, { recursive: true });
      const res = await choose(admin, moved);
      expect(res.status).toBe(200);
      expect(res.body.result).toMatchObject({ missing: 0, total });

      // Every document opens from the new folder - the rows never changed.
      const some = (await list(admin)).body.result[0];
      const file = await open((await link(admin, some.id)).body.result.url);
      expect(file.status).toBe(200);
      fs.rmSync(folder, { recursive: true, force: true });
      expect((await upload(admin, pdf(), 'after the move.pdf')).status).toBe(201);
      folder = moved;
    });

    test('chosen anyway, the missing ones read as missing until they are there', async () => {
      const empty = path.join(base, 'empty-drive');
      const res = await choose(admin, empty, true);
      expect(res.status).toBe(200);
      expect(res.body.result.missing).toBeGreaterThan(0);
      const some = (await list(admin)).body.result[0];
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect((await open((await link(admin, some.id)).body.result.url)).status).toBe(404);
      } finally {
        error.mockRestore();
      }
      expect((await choose(admin, folder)).status).toBe(200);
    });
  });

  describe('naming one - scan020.pdf is "Invoice JI-123/27"', () => {
    const rename = (who, id, title) => request(app).post(`/documents/${id}/rename`).set('Authorization', who.authHeader).send({ title });

    test("named as it is attached: shown by that name, the file's under it, and downloaded as it", async () => {
      const res = await upload(admin, pdf(), 'scan020.pdf', { title: '  Invoice  JI-123/27 ' });
      expect(res.status).toBe(201);
      expect(res.body.result).toMatchObject({ name: 'Invoice JI-123/27', title: 'Invoice JI-123/27', fileName: 'scan020.pdf', view: 'pdf' });
      const got = await open((await link(admin, res.body.result.id)).body.result.url);
      expect(got.headers['content-disposition']).toBe(`inline; filename="Invoice JI-123-27.pdf"; filename*=UTF-8''Invoice%20JI-123-27.pdf`);
      const logged = await History.findOne({ where: { EmployeeId: admin.employee.id, formName: 'Documents', type: 'Attached' }, order: [['id', 'DESC']] });
      // The Invoice type by whatever it is called now - the types test renames it.
      const { types } = await settings.getTypes();
      expect(logged.docNo).toBe(`Job ${job.jobNo}: Invoice JI-123/27 (${types.find((t) => t.id === INVOICE).name})`);
    });

    test("renamed later - by whoever may attach - and back to the file's name when the name is cleared", async () => {
      const doc = (await upload(admin, pdf(), 'scan021.pdf')).body.result;
      expect(doc).toMatchObject({ name: 'scan021.pdf', title: null });

      expect((await rename(viewer, doc.id, 'Not mine to name')).status).toBe(403);
      const named = await rename(editor, doc.id, 'Packing list - 40 cartons');
      expect(named.status).toBe(200);
      expect(named.body.result).toMatchObject({ name: 'Packing list - 40 cartons', fileName: 'scan021.pdf' });
      expect((await list(admin)).body.result.find((d) => d.id === doc.id).name).toBe('Packing list - 40 cartons');
      const logged = await History.findOne({ where: { EmployeeId: editor.employee.id, formName: 'Documents', type: 'Renamed' } });
      expect(logged.docNo).toBe(`Job ${job.jobNo}: scan021.pdf -> Packing list - 40 cartons`);

      const cleared = await rename(editor, doc.id, '   ');
      expect(cleared.body.result).toMatchObject({ name: 'scan021.pdf', title: null });
    });

    test("a job's invoice scan is named on the job, not from its invoices", async () => {
      const inv = await Invoice.create({ invoice_No: `${TEST_PREFIX}JI-NAME-${stamp}`, type: 'Job Invoice', operation: 'SE', companyId: String(company.id), SEJobId: job.id }, { fiscalYearCheck: false });
      made.invoices.push(inv.id);
      const doc = (await upload(admin, pdf(), 'scan022.pdf', { title: 'Invoice JI-124/27' })).body.result;
      expect((await list(invoiceReader, inv.id, 'Invoice')).body.result.find((d) => d.id === doc.id).name).toBe('Invoice JI-124/27');
      expect((await rename(invoiceReader, doc.id, 'Mine now')).status).toBe(403);
    });
  });

  describe('removing one', () => {
    test('marks it removed and keeps its file; its link no longer opens it', async () => {
      const { body } = await upload(admin, pdf(), 'mistake.pdf');
      const url = (await link(admin, body.result.id)).body.result.url;

      const res = await remove(remover, body.result.id);
      expect(res.status).toBe(200);
      expect((await list(admin)).body.result.map((d) => d.id)).not.toContain(body.result.id);

      const row = await Document.findByPk(body.result.id, { paranoid: false });
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(remover.employee.name);
      expect(fs.existsSync(path.join(folder, row.storedName))).toBe(true);
      expect((await open(url)).status).toBe(404);
      expect((await remove(admin, body.result.id)).status).toBe(404);

      const logged = await History.findOne({ where: { EmployeeId: remover.employee.id, formName: 'Documents', type: 'Removed' } });
      expect(logged.docNo).toBe(`Job ${job.jobNo}: mistake.pdf`);
    });
  });
});
