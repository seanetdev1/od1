const routes = require('express').Router();
const { Printing_Template, Company } = require('../../models');
const { requireSystem } = require('../../functions/systemAccess');
const {
  DOC_TYPES, ALL_DOCS, TemplateProblem, ConversionUnavailable,
  inspect, fill, toPdf, toOnePdf, findTemplate,
} = require('../../functions/printingTemplate');

/* Configuration > Printing Templates - see functions/printingTemplate.
 *
 * Reading is anyone's: the invoice screen and the B/L's print tab ask which
 * template applies before they print. Saving and removing are Seanet's, like every other Config write -
 * a client's invoice is the layout we set up for them. */

const MAX_BYTES = 15 * 1024 * 1024;
// The most one bulk print makes at once.
const MAX_MANY = 500;

const tagsOf = (row) => {
  try { return row.tags ? JSON.parse(row.tags) : null; } catch (_) { return null; }
};
const summary = (row) => row && ({
  id: row.id,
  companyId: row.companyId,
  docType: row.docType,
  fileName: row.fileName,
  tags: tagsOf(row),
  updatedAt: row.updatedAt,
});

// A file name safe to put in a Content-Disposition header.
const safeName = (name, ext) => `${String(name || 'invoice').replace(/[^\w.\- ]+/g, '_').slice(0, 100)}${ext}`;

routes.get('/list', async (req, res) => {
  try {
    const rows = await Printing_Template.findAll({ attributes: { exclude: ['content'] }, order: [['id', 'ASC']] });
    res.json({ status: 'success', result: rows.map(summary), docTypes: DOC_TYPES });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

// The template an invoice of this company and type prints from, or null.
routes.get('/applies', async (req, res) => {
  try {
    const row = await findTemplate(Printing_Template, { companyId: req.query.companyId, type: req.query.type });
    res.json({ status: 'success', result: summary(row) || null });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.get('/:id/file', async (req, res) => {
  try {
    const row = await Printing_Template.findByPk(req.params.id);
    if (!row) return res.status(404).json({ status: 'error', result: 'No such template.' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', `attachment; filename="${safeName(row.fileName.replace(/\.docx$/i, ''), '.docx')}"`);
    res.send(row.content);
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/* Saves a Word file for a company (null: every company) and a document ('*':
 * every document), replacing the one there was. The file is opened first: one
 * with a mistake in its {fields} is refused, with each mistake named. */
routes.post('/save', requireSystem, async (req, res) => {
  try {
    const { fileName, content } = req.body || {};
    const docType = req.body?.docType || ALL_DOCS;
    const companyId = req.body?.companyId === null || req.body?.companyId === undefined || req.body?.companyId === ''
      ? null : parseInt(req.body.companyId, 10);

    if (docType !== ALL_DOCS && !DOC_TYPES.includes(docType)) {
      return res.status(400).json({ status: 'error', result: `No document "${docType}".` });
    }
    if (companyId !== null && (!Number.isInteger(companyId) || !(await Company.findByPk(companyId)))) {
      return res.status(400).json({ status: 'error', result: 'No such company.' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ status: 'error', result: 'No file.' });
    }
    const buffer = Buffer.from(content, 'base64');
    if (!buffer.length || buffer.length > MAX_BYTES) {
      return res.status(400).json({ status: 'error', result: 'The file is empty or larger than 15 MB.' });
    }

    const tags = inspect(buffer);
    const values = {
      fileName: String(fileName || 'template.docx').slice(0, 200),
      content: buffer,
      tags: JSON.stringify(tags),
      uploadedById: req.user?.id || null,
    };
    let row = await Printing_Template.findOne({ where: { companyId, docType } });
    if (row) await row.update(values);
    else row = await Printing_Template.create({ companyId, docType, ...values });
    res.json({ status: 'success', result: summary(row) });
  } catch (e) {
    if (e instanceof TemplateProblem) {
      return res.status(422).json({ status: 'error', result: e.message, details: e.details });
    }
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.delete('/:id', requireSystem, async (req, res) => {
  try {
    const count = await Printing_Template.destroy({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ status: 'error', result: 'No such template.' });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/* An invoice through a template: the template (by id, or the one that applies
 * to a company and type) filled with the values the screen worked out, as a
 * PDF - or as the Word file, format 'docx'. */
routes.post('/render', async (req, res) => {
  try {
    const { templateId, companyId, type, fields, format, fileName } = req.body || {};
    if (!fields || typeof fields !== 'object') {
      return res.status(400).json({ status: 'error', result: 'No invoice values.' });
    }
    const row = templateId
      ? await Printing_Template.findByPk(templateId)
      : await findTemplate(Printing_Template, { companyId, type }, { withContent: true });
    if (!row) return res.status(404).json({ status: 'error', result: 'No template for this invoice.' });

    const docx = fill(row.content, fields);
    if (format === 'docx') {
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.set('Content-Disposition', `attachment; filename="${safeName(fileName, '.docx')}"`);
      return res.send(docx);
    }
    const pdf = await toPdf(docx);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${safeName(fileName, '.pdf')}"`);
    res.send(pdf);
  } catch (e) {
    if (e instanceof TemplateProblem) {
      return res.status(422).json({ status: 'error', result: e.message, details: e.details });
    }
    if (e instanceof ConversionUnavailable) {
      return res.status(503).json({ status: 'error', result: e.message });
    }
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/* A bulk print - Invoice / Bills' print list: many invoices, each through its
 * own template ({ templateId, fields }), as ONE PDF in the list's order. */
routes.post('/renderMany', async (req, res) => {
  try {
    const { items, fileName } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ status: 'error', result: 'No invoices to print.' });
    }
    if (items.length > MAX_MANY) {
      return res.status(400).json({ status: 'error', result: `At most ${MAX_MANY} invoices at once.` });
    }
    if (items.some((item) => !item || !item.fields || typeof item.fields !== 'object')) {
      return res.status(400).json({ status: 'error', result: 'No invoice values.' });
    }
    const ids = [...new Set(items.map((item) => parseInt(item.templateId, 10)))];
    if (ids.some((id) => !Number.isInteger(id))) {
      return res.status(400).json({ status: 'error', result: 'An invoice has no template.' });
    }
    const rows = new Map((await Printing_Template.findAll({ where: { id: ids } })).map((row) => [row.id, row]));
    if (rows.size !== ids.length) return res.status(404).json({ status: 'error', result: 'A template was removed - print again.' });

    const docs = items.map((item) => {
      try {
        return fill(rows.get(parseInt(item.templateId, 10)).content, item.fields);
      } catch (e) {
        // Which invoice, so the one with the problem can be found.
        if (e instanceof TemplateProblem && item.fields.invoiceNo) e.message = `${item.fields.invoiceNo}: ${e.message}`;
        throw e;
      }
    });
    const pdf = await toOnePdf(docs);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${safeName(fileName || 'invoices', '.pdf')}"`);
    res.send(pdf);
  } catch (e) {
    if (e instanceof TemplateProblem) {
      return res.status(422).json({ status: 'error', result: e.message, details: e.details });
    }
    if (e instanceof ConversionUnavailable) {
      return res.status(503).json({ status: 'error', result: e.message });
    }
    res.status(500).json({ status: 'error', result: e.message });
  }
});

module.exports = routes;
