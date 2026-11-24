const routes = require('express').Router();
const { AppSetting } = require('../../models');
const { KEY: UNIQUE_JOB_CHARGES_KEY, readUniqueJobCharges } = require('../../functions/jobChargeRepeats');
// Every write here is Config, which on a leased install is Seanet's -
// see functions/systemAccess.js. The reads stay open: screens everywhere
// read these settings.
const { requireSystem } = require('../../functions/systemAccess');
const permissions = require('../../functions/permissions/middleware');
const separation = require('../../functions/companySeparation');
const dashboardWidgets = require('../../functions/dashboardWidgets');
const newJobAlerts = require('../../functions/newJobAlerts');
const { createHistory } = require('../../functions/history');
const { getScopeCompany } = require('../../functions/fiscalYearContext');
const {
  KEY: NUMBERING_KEY, LEGACY_FORMAT_KEY, CLASSES, CONFIGURABLE, FIXED,
  readNumbering, resetNumbering, validate: validateNumbering, example,
} = require('../../functions/documentNumber');
const {
  describeEmailConfig, writeEmailConfig, readEmailConfig, isComplete,
} = require('../../functions/emailConfig');
const { sendMail, resetTransporter } = require('../../functions/mailer');
const {
  normalizeStatuses, validateList, StatusError,
  RULES: STATUS_RULES, COLORS: STATUS_COLORS, BUILT_IN: BUILT_IN_STATUSES,
} = require('../../functions/customsStatuses');
const {
  KEY: CUSTOMS_JOB_FORM_KEY, normalizeCustomsJobForm, readCustomsJobForm, CustomsJobFormError,
} = require('../../functions/customsJobForm');
const {
  KEY: GST_FORMAT_KEY, DEFAULT_GST_FORMAT, validateGstFormat, formatGstNumber, readGstFormat, GstFormatError,
} = require('../../functions/gstNumberFormat');

// 'aviation' is an airline running its own aircraft: air operations only, so
// the frontend hides the sea side of the app entirely rather than relabelling
// it (see Odyssey-Front-end/functions/terminology.js).
const VALID_MODES = ['freight', 'customs', 'aviation'];

// Read the installation's operation mode. Any authenticated user can read it
// (the frontend needs it to pick the right terminology). Unset => default
// 'freight' and not locked.
routes.get('/operationMode', async (req, res) => {
  try {
    const row = await AppSetting.findOne({ where: { key: 'operationMode' } });
    if (row) return res.json({ status: 'success', mode: row.value, locked: true });
    return res.json({ status: 'success', mode: 'freight', locked: false });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

// Set the operation mode ONCE. Admin only. If it's already been set the row
// exists and we refuse to change it - this is the permanent, one-time lock.
routes.post('/operationMode', requireSystem, async (req, res) => {
  try {
    const mode = String(req.body?.mode || '').toLowerCase();
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({
        status: 'error',
        result: `mode must be one of: ${VALID_MODES.map((m) => `"${m}"`).join(', ')}.`,
      });
    }
    const existing = await AppSetting.findOne({ where: { key: 'operationMode' } });
    if (existing) {
      return res.status(409).json({
        status: 'error',
        result: 'Operation mode is already set for this installation and cannot be changed.',
      });
    }
    const row = await AppSetting.create({ key: 'operationMode', value: mode });
    res.json({ status: 'success', mode: row.value, locked: true });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * This installation's cost centre code.
 *
 * Every voucher carries one, and it used to be the literal string "KHI" typed
 * into routes/invoice in two places - so every install stamped Karachi on its
 * vouchers whether or not it was there.
 *
 * A CODE, not a name. The legacy systems store a label ("HEAD OFFICE") against
 * a cost-centre id; Odyssey's field is the short code the vouchers and reports
 * carry. CargoLinkers' legacy label is HEAD OFFICE and its code is KHI - the
 * office is in Karachi - which is exactly why the label cannot just be copied
 * across.
 *
 * Defaults to KHI when unset, so an install that never opens this screen keeps
 * behaving as it did before the hardcode was removed.
 */
const COST_CENTRE_KEY = 'costCenter';
const DEFAULT_COST_CENTRE = 'KHI';

/** Read it from anywhere in the app without going through HTTP. */
const readCostCenter = async () => {
  try {
    const row = await AppSetting.findOne({ where: { key: COST_CENTRE_KEY } });
    const v = row?.value ? String(row.value).trim() : '';
    return v || DEFAULT_COST_CENTRE;
  } catch (_) {
    return DEFAULT_COST_CENTRE;
  }
};

/**
 * The installation's operation mode, read from anywhere in the app without
 * going through HTTP - the same shape as readCostCenter above.
 *
 * UNSET MEANS 'freight'. The setting was added after the freight module
 * shipped, so its absence means "the original one" rather than "not
 * configured" - and it is the same default the GET route and the frontend's
 * terminology.getMode() fall back to.
 */
const readOperationMode = async () => {
  try {
    const row = await AppSetting.findOne({ where: { key: 'operationMode' } });
    const v = row?.value ? String(row.value).trim().toLowerCase() : '';
    return v || 'freight';
  } catch (_) {
    return 'freight';
  }
};

routes.get('/costCenter', async (req, res) => {
  try {
    res.json({ status: 'success', result: await readCostCenter() });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/costCenter', requireSystem, async (req, res) => {
  try {
    const value = String(req.body?.costCenter ?? '').trim().toUpperCase();
    // Short codes only. A long name here would end up printed in the cost
    // centre column of every voucher and report.
    if (!/^[A-Z0-9-]{2,10}$/.test(value)) {
      return res.status(400).json({
        status: 'error',
        result: 'Cost centre must be a short code - 2 to 10 letters, digits or hyphens (e.g. KHI).',
      });
    }
    const existing = await AppSetting.findOne({ where: { key: COST_CENTRE_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: COST_CENTRE_KEY, value });
    res.json({ status: 'success', result: value });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * Which ledger accounts an approved invoice posts to.
 *
 * The posting code used to look these up by EXACT TITLE - 'AIR FREIGHT
 * INCOME', 'LCL FREIGHT EXP' and so on - which only works on a chart of
 * accounts that happens to use those words. Installs that named theirs
 * differently, or imported a chart from elsewhere, got a null account and an
 * invoice that could not be approved.
 *
 * Stored as ONE row so the whole mapping is read in a single query and can
 * never be half-configured across keys. Shape:
 *
 *   { "AIR": { "income": 12, "expense": 34 }, "FCL": {...}, "LCL": {...} }
 *
 * Values are Child_Account ids, not titles: renaming an account in the chart
 * then leaves the mapping intact. Unlike operationMode this is editable - a
 * chart of accounts gets reorganised, and being locked out of that would be
 * worse than the drift it prevents.
 */
const LEDGER_KEY = 'ledgerAccounts';
// CUSTOMS_IMPORT / CUSTOMS_EXPORT are chosen from Customs_Job.direction, not
// from a job sub type - a clearance file has none. They are separate buckets
// rather than one because import and export clearance are reported separately.
// CUSTOMS_LCL / CUSTOMS_FCL carry an EXPENSE account only: a clearance job's
// costs differ between groupage and a container, while its income does not.
// They are consulted for the expense side and fall back to the direction
// bucket when unmapped - see functions/ledgerBuckets.expenseBucketFor.
// AVIATION is every aviation flight's own pair, separate from air freight;
// unmapped, it falls back to AIR - see functions/ledgerBuckets.
const BUCKETS = ['AIR', 'FCL', 'LCL', 'CUSTOMS_IMPORT', 'CUSTOMS_EXPORT',
  'CUSTOMS_LCL', 'CUSTOMS_FCL', 'AVIATION',
  // Clearance by transport and direction - the rows the screen offers now.
  // The four above stay valid: they are what an unset one falls back to.
  'CUSTOMS_SEA_IMPORT', 'CUSTOMS_SEA_EXPORT', 'CUSTOMS_AIR_IMPORT', 'CUSTOMS_AIR_EXPORT', 'CUSTOMS_ROAD',
  // Sales tax: one pair for every job type - the tax on a taxed line posts
  // here instead of to the job's account. See functions/invoiceTaxSplit.
  'TAX'];
// `disbursement` is the balance-sheet account that pass-through charges post
// to instead of income/expense - see models/Charges.js `reimbursable`. Only
// the customs buckets offer it on screen; it is whitelisted for every bucket
// because the validator's job is to reject malformed ids, not to encode which
// combinations the UI happens to show.
const SIDES = ['income', 'expense', 'disbursement'];

// ?companyId= / body.companyId: that company's own mapping, laid over the
// install's when it posts (functions/ledgerAccounts readLedgerAccounts).
// Without: the install's. Both read and written as stored - this is the
// screen that edits them.
const companyLayer = (base, companyId) => {
  const id = Number(companyId);
  return Number.isInteger(id) && id > 0 ? `${base}:${id}` : base;
};

routes.get('/ledgerAccounts', async (req, res) => {
  try {
    const row = await AppSetting.findOne({ where: { key: companyLayer(LEDGER_KEY, req.query.companyId) } });
    let mapping = {};
    if (row?.value) {
      // A malformed row must not take the settings screen down with it -
      // report empty and let the user set it again.
      try { mapping = JSON.parse(row.value) || {}; } catch (_) { mapping = {}; }
    }
    res.json({ status: 'success', result: mapping });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/ledgerAccounts', requireSystem, async (req, res) => {
  try {
    const incoming = req.body?.mapping || {};
    // Whitelist rather than store whatever arrives: this is read by the code
    // that posts money to the ledger.
    const clean = {};
    for (const bucket of BUCKETS) {
      for (const side of SIDES) {
        const id = incoming?.[bucket]?.[side];
        if (id === null || id === undefined || id === '') continue;
        const n = Number(id);
        if (!Number.isInteger(n) || n <= 0) {
          return res.status(400).json({
            status: 'error',
            result: `${bucket} ${side} is not a valid account.`,
          });
        }
        clean[bucket] = clean[bucket] || {};
        clean[bucket][side] = n;
      }
    }

    const value = JSON.stringify(clean);
    const key = companyLayer(LEDGER_KEY, req.body?.companyId);
    const existing = await AppSetting.findOne({ where: { key } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key, value });

    res.json({ status: 'success', result: clean });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * Where a new CUSTOMER's and a new VENDOR's ledger account is created.
 *
 * Setup > Parties offers a button per kind of party - Non-GL, Customer (AR),
 * Vendor (AP) - and the first two need to know which group account to hang the
 * new ledger under. That cannot be found by TITLE: one install calls it
 * 'ACCOUNT RECEIVABLE', another 'Accounts Receivable', another imported a
 * chart that names it something else entirely, and a button that silently
 * picked the wrong parent - or nothing at all - would be worse than no button.
 *
 * So an admin names them once, here, and the buttons use those. Child_Account
 * IDS, not titles, so renaming an account in the chart leaves this intact.
 *
 * Unset is FINE and is the state every existing install starts in: the buttons
 * fall back to opening the ordinary form with the Parent Account selector
 * empty, which is exactly what the single Create button did before.
 */
const PARTY_ACCOUNTS_KEY = 'partyAccounts';
const PARTY_SIDES = ['receivable', 'payable'];

// Per company like the ledger mapping. The Parties screen gets the EFFECTIVE
// parents for the company it is working in - that company's own, else the
// install's. Config asks for one layer as stored, with ?raw=1 (and
// ?companyId= for a company's).
const readPartyLayer = async (key) => {
  const row = await AppSetting.findOne({ where: { key } });
  // A malformed row must not take the Parties screen down with it - report
  // empty, and the buttons fall back to an unfilled selector.
  try { return (row?.value ? JSON.parse(row.value) : {}) || {}; } catch (_) { return {}; }
};

routes.get('/partyAccounts', async (req, res) => {
  try {
    let mapping;
    if (req.query.raw) {
      mapping = await readPartyLayer(companyLayer(PARTY_ACCOUNTS_KEY, req.query.companyId));
    } else {
      const companyId = getScopeCompany();
      mapping = {
        ...(await readPartyLayer(PARTY_ACCOUNTS_KEY)),
        ...(companyId ? await readPartyLayer(companyLayer(PARTY_ACCOUNTS_KEY, companyId)) : {}),
      };
    }
    res.json({ status: 'success', result: mapping });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/partyAccounts', requireSystem, async (req, res) => {
  try {
    const incoming = req.body?.mapping || {};
    const clean = {};
    for (const side of PARTY_SIDES) {
      const id = incoming?.[side];
      // Clearing one is legitimate - it puts that button back to opening an
      // empty selector - so an absent value is not an error.
      if (id === null || id === undefined || id === '') continue;
      const n = Number(id);
      if (!Number.isInteger(n) || n <= 0) {
        return res.status(400).json({
          status: 'error',
          result: `The ${side} parent is not a valid account.`,
        });
      }
      clean[side] = n;
    }

    const value = JSON.stringify(clean);
    const key = companyLayer(PARTY_ACCOUNTS_KEY, req.body?.companyId);
    const existing = await AppSetting.findOne({ where: { key } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key, value });

    res.json({ status: 'success', result: clean });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * How job, invoice and voucher numbers are laid out - Config > Document
 * Numbers. Per class (jobs, invoices, vouchers): the company prefix on or off,
 * the year before or after the sequence, and the codes the customer names
 * themselves. See functions/documentNumber, including why no change here can
 * restart a sequence or reuse a number.
 *
 * Unlike operationMode this is NOT one-time: it is house style, a customer can
 * change their mind about it, and nothing already issued is touched either way.
 * It replaces the single documentNumberFormat setting, whose value is still
 * read as the default order until this is first saved.
 */
const numberingPayload = (settings) => ({
  status: 'success',
  result: settings,
  classes: CLASSES,
  configurable: CONFIGURABLE,
  fixed: FIXED,
  examples: Object.fromEntries(CLASSES.map((k) => [k, example(settings, k)])),
});

routes.get('/documentNumbering', async (req, res) => {
  try {
    res.json(numberingPayload(await readNumbering()));
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/documentNumbering', requireSystem, async (req, res) => {
  try {
    const legacy = await AppSetting.findOne({ where: { key: LEGACY_FORMAT_KEY } });
    const { settings, error } = validateNumbering(req.body, legacy?.value);
    if (error) return res.status(400).json({ status: 'error', result: error });

    const value = JSON.stringify(settings);
    const existing = await AppSetting.findOne({ where: { key: NUMBERING_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: NUMBERING_KEY, value });
    // Cached - every document creation reads it - so the change has to be
    // published rather than waited out.
    resetNumbering();
    res.json(numberingPayload(settings));
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/* OUTGOING MAIL, set here rather than in the container's environment.
 *
 * A leased install has its own mail server, and its admin should not have to
 * send us a password and wait for a redeploy to change it. See
 * functions/emailConfig for the rule about which settings win.
 *
 * Admin only, all three: these are credentials, and the GET tells you the
 * host and the account even though it never returns the password.
 */
routes.get('/emailConfig', requireSystem, async (req, res) => {
  try {
    res.json({ status: 'success', result: await describeEmailConfig() });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/emailConfig', requireSystem, async (req, res) => {
  try {
    const body = req.body || {};
    const host = String(body.host ?? '').trim();
    const user = String(body.user ?? '').trim();
    const port = Number(body.port) || 587;
    const fromEmail = String(body.fromEmail ?? '').trim();

    const problems = [];
    if (!host) problems.push('Host is required.');
    if (!user) problems.push('Username is required.');
    if (!(port > 0 && port <= 65535)) problems.push('Port must be between 1 and 65535.');
    // A From address that is not an address produces mail nobody can reply to,
    // and some relays refuse the message outright.
    if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      problems.push('From address is not a valid email address.');
    }

    // The password is only required when there is not one stored already -
    // see writeEmailConfig, where blank means "leave it alone".
    const current = await describeEmailConfig();
    if (!String(body.pass ?? '').trim() && !current.hasPassword) {
      problems.push('Password is required the first time these settings are saved.');
    }

    if (problems.length) {
      return res.status(400).json({ status: 'error', result: problems.join(' ') });
    }

    await writeEmailConfig(body);
    // The transport is cached against the settings it was built from; drop it
    // so the very next email goes through the server just saved.
    resetTransporter();

    res.json({ status: 'success', result: await describeEmailConfig() });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/* Send one test message, so "did that work?" is answered here rather than by
 * raising a real invoice and watching it fail. */
routes.post('/emailConfig/test', requireSystem, async (req, res) => {
  try {
    const to = String(req.body?.to ?? '').trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ status: 'error', result: 'A valid recipient address is required.' });
    }

    const cfg = await readEmailConfig();
    if (!isComplete(cfg)) {
      return res.status(400).json({
        status: 'error',
        result: 'Email is not configured yet. Save the settings first.',
      });
    }

    await sendMail({
      fromName: cfg.fromName || 'Odyssey',
      fromEmail: cfg.fromEmail || cfg.user,
      to,
      subject: 'Odyssey test message',
      html: '<p>This is a test message from Odyssey.</p>'
        + `<p>Sent through <b>${cfg.host}</b> as <b>${cfg.user}</b>.</p>`
        + '<p>If you are reading this, outgoing mail is working.</p>',
    });

    res.json({ status: 'success', result: `Test message sent to ${to}.` });
  } catch (e) {
    // The SMTP error is the whole value of this endpoint - authentication
    // failed, host unreachable, certificate rejected. Passed through rather
    // than flattened into "could not send".
    res.status(502).json({
      status: 'error',
      result: `Could not send: ${e?.response || e?.message || e}`,
    });
  }
});

/**
 * The columns a report opens with - Config > Reports. Per report, the
 * column ids in the order they are shown; users then add or take off columns
 * for themselves on the report.
 *
 * The ids are the frontend's (each report's column list lives there), so they
 * are checked for shape only; an id the report no longer has is ignored there.
 * Unset, or saved empty, is the report's own built-in set.
 *
 * Only reports named here can be written, so this cannot become a free-form
 * key/value store.
 */
// customsJobList: the customs job list's columns (2026-11-20) - not a report,
// but picked the same way.
const REPORT_COLUMN_REPORTS = ['jobBalancingGrid', 'vatDetail', 'customsJobList'];
const reportColumnsKey = (report) => `reportColumns.${report}`;
const COLUMN_ID = /^[A-Za-z0-9_.]{1,60}$/;

routes.get('/reportColumns/:report', async (req, res) => {
  try {
    const { report } = req.params;
    if (!REPORT_COLUMN_REPORTS.includes(report)) {
      return res.status(404).json({ status: 'error', result: `No report "${report}".` });
    }
    const row = await AppSetting.findOne({ where: { key: reportColumnsKey(report) } });
    let columns = null;
    if (row?.value) {
      // A malformed row must not take the report down - it opens on its own set.
      try { columns = JSON.parse(row.value); } catch (_) { columns = null; }
      if (!Array.isArray(columns) || !columns.length) columns = null;
    }
    res.json({ status: 'success', result: columns });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/reportColumns/:report', requireSystem, async (req, res) => {
  try {
    const { report } = req.params;
    if (!REPORT_COLUMN_REPORTS.includes(report)) {
      return res.status(404).json({ status: 'error', result: `No report "${report}".` });
    }
    const incoming = req.body?.columns;
    if (incoming != null && !Array.isArray(incoming)) {
      return res.status(400).json({ status: 'error', result: 'Columns must be a list.' });
    }
    const columns = [...new Set((incoming || []).map((c) => String(c)))];
    if (columns.length > 100 || columns.some((c) => !COLUMN_ID.test(c))) {
      return res.status(400).json({ status: 'error', result: 'Not a valid list of columns.' });
    }

    const key = reportColumnsKey(report);
    const existing = await AppSetting.findOne({ where: { key } });
    if (!columns.length) {
      // Empty puts the report back on its built-in set.
      if (existing) await existing.destroy();
      return res.json({ status: 'success', result: null });
    }
    const value = JSON.stringify(columns);
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key, value });
    res.json({ status: 'success', result: columns });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * Round off invoices automatically - Config > Invoices. On: every invoice in
 * rupees is rounded to a whole rupee when it is approved, as if its Round Off
 * box were ticked (see functions/invoiceRoundOff). Off - and unset - only the
 * invoices whose box is ticked.
 */
const AUTO_ROUND_OFF_KEY = 'autoRoundOff';

const readAutoRoundOff = async () => {
  try {
    const row = await AppSetting.findOne({ where: { key: AUTO_ROUND_OFF_KEY } });
    return row?.value === 'true';
  } catch (_) {
    return false;
  }
};

routes.get('/invoiceRoundOff', async (req, res) => {
  try {
    res.json({ status: 'success', result: { auto: await readAutoRoundOff() } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/invoiceRoundOff', requireSystem, async (req, res) => {
  try {
    if (typeof req.body?.auto !== 'boolean') {
      return res.status(400).json({ status: 'error', result: 'auto must be true or false.' });
    }
    const value = String(req.body.auto);
    const existing = await AppSetting.findOne({ where: { key: AUTO_ROUND_OFF_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: AUTO_ROUND_OFF_KEY, value });
    res.json({ status: 'success', result: { auto: req.body.auto } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * How Printing Options start on an invoice print - Config > Invoices. Each a
 * box ticked by default, and each can still be changed for one print:
 *   hideSignLine - "Hide Sign Line": the line and the company name under it
 *                  left off the print.
 *   hideTax      - "Hide Tax Column" (customs): no Tax column, the service
 *                  charges at their value before tax, and no Total For Sales
 *                  Tax line - Sales Tax @ rate, Total Without Tax and Total
 *                  With Tax under them.
 *   hideBankDetails - "Hide Bank Details": the bank account box left off
 *                  (Essani, 2026-11-14).
 * And two that are not Printing Options, set here only (Essani, 2026-11-14):
 *   containerNosInNote - a customs invoice's Note box is "Container Nos" and
 *                  lists its job's containers, on every print of it.
 *   signDisclaimer - text printed where the sign line was, when it is hidden.
 *                  Empty, nothing is.
 * Any user can read them; an admin saves one or more.
 */
const INVOICE_PRINT_KEYS = {
  hideSignLine: 'invoiceHideSignLine', hideTax: 'invoiceHideTax',
  hideBankDetails: 'invoiceHideBankDetails', containerNosInNote: 'invoiceContainerNosInNote',
};
const INVOICE_PRINT_TEXT_KEYS = { signDisclaimer: 'invoiceSignDisclaimer' };
const MAX_DISCLAIMER = 500;

const readInvoicePrint = async () => {
  const rows = await AppSetting.findAll({
    where: { key: [...Object.values(INVOICE_PRINT_KEYS), ...Object.values(INVOICE_PRINT_TEXT_KEYS)] },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    ...Object.fromEntries(Object.entries(INVOICE_PRINT_KEYS).map(([name, key]) => [name, byKey[key] === 'true'])),
    ...Object.fromEntries(Object.entries(INVOICE_PRINT_TEXT_KEYS).map(([name, key]) => [name, byKey[key] || ''])),
  };
};

routes.get('/invoicePrint', async (req, res) => {
  try {
    res.json({ status: 'success', result: await readInvoicePrint() });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/invoicePrint', requireSystem, async (req, res) => {
  try {
    const given = Object.keys(INVOICE_PRINT_KEYS).filter((name) => req.body?.[name] !== undefined);
    const givenText = Object.keys(INVOICE_PRINT_TEXT_KEYS).filter((name) => req.body?.[name] !== undefined);
    if (!given.length && !givenText.length) {
      return res.status(400).json({ status: 'error', result: `Nothing to save: ${[...Object.keys(INVOICE_PRINT_KEYS), ...Object.keys(INVOICE_PRINT_TEXT_KEYS)].join(', ')}.` });
    }
    const wrong = given.find((name) => typeof req.body[name] !== 'boolean');
    if (wrong) {
      return res.status(400).json({ status: 'error', result: `${wrong} must be true or false.` });
    }
    const wrongText = givenText.find((name) => typeof req.body[name] !== 'string');
    if (wrongText) {
      return res.status(400).json({ status: 'error', result: `${wrongText} must be text.` });
    }
    const tooLong = givenText.find((name) => req.body[name].trim().length > MAX_DISCLAIMER);
    if (tooLong) {
      return res.status(400).json({ status: 'error', result: `The disclaimer is at most ${MAX_DISCLAIMER} characters.` });
    }
    const writes = [
      ...given.map((name) => [INVOICE_PRINT_KEYS[name], String(req.body[name])]),
      ...givenText.map((name) => [INVOICE_PRINT_TEXT_KEYS[name], req.body[name].trim()]),
    ];
    for (const [key, value] of writes) {
      const existing = await AppSetting.findOne({ where: { key } });
      if (existing) await existing.update({ value });
      else await AppSetting.create({ key, value });
    }
    res.json({ status: 'success', result: await readInvoicePrint() });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * What a NEW Direct Job E / R entry starts as - revenue or expense
 * (Configuration > Direct Job). Only the starting value of the Entry # box;
 * it can still be changed on the entry, and a saved entry keeps its own.
 *
 * EXPENSE until an admin picks revenue (the user's call, 2026-10-20): most
 * entries made through Direct Job are costs. It started as revenue before, so
 * an install that saved Revenue here keeps it; only an unset one changes.
 * Any user can read it - the entry screen needs to.
 */
const DIRECT_JOB_TYPE_KEY = 'directJobDefaultType';
const DIRECT_JOB_TYPES = ['revenue', 'expense'];
const DIRECT_JOB_DEFAULT_TYPE = 'expense';

const readDirectJobType = async () => {
  const row = await AppSetting.findOne({ where: { key: DIRECT_JOB_TYPE_KEY } });
  return DIRECT_JOB_TYPES.includes(row?.value) ? row.value : DIRECT_JOB_DEFAULT_TYPE;
};

routes.get('/directJobDefaultType', async (req, res) => {
  try {
    res.json({ status: 'success', result: { type: await readDirectJobType() } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/directJobDefaultType', requireSystem, async (req, res) => {
  try {
    const type = req.body?.type;
    if (!DIRECT_JOB_TYPES.includes(type)) {
      return res.status(400).json({ status: 'error', result: 'type must be revenue or expense.' });
    }
    const existing = await AppSetting.findOne({ where: { key: DIRECT_JOB_TYPE_KEY } });
    if (existing) await existing.update({ value: type });
    else await AppSetting.create({ key: DIRECT_JOB_TYPE_KEY, value: type });
    res.json({ status: 'success', result: { type } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * One of each charge per job (Configuration > Direct Job, asked 2026-11-17) -
 * see functions/jobChargeRepeats: a charge goes on a job once as a Direct Job
 * expense and once as a revenue, and once on each side of the job's charge
 * sheet. Off until an admin turns it on - repeats are ordinary on some
 * installs. Any user can read it - the charge sheet checks as it is filled.
 */
routes.get('/uniqueJobCharges', async (req, res) => {
  try {
    res.json({ status: 'success', result: { enabled: await readUniqueJobCharges({ AppSetting }) } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/uniqueJobCharges', requireSystem, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ status: 'error', result: 'enabled must be true or false.' });
    }
    const value = String(req.body.enabled);
    const existing = await AppSetting.findOne({ where: { key: UNIQUE_JOB_CHARGES_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: UNIQUE_JOB_CHARGES_KEY, value });
    res.json({ status: 'success', result: { enabled: req.body.enabled } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * Job planning - the customs Program Book (Configuration > Customs). On, a
 * customs install keeps planned jobs without numbers and moves the confirmed
 * ones to the jobs list; off, its menu entry is hidden and the
 * /customsJob/plans routes refuse. Turning it off deletes nothing.
 *
 * Off until an admin turns it on. Any user can read it - the sidebar needs to.
 */
const CUSTOMS_PLANNING_KEY = 'customsPlanning';

const readCustomsPlanning = async () => {
  const row = await AppSetting.findOne({ where: { key: CUSTOMS_PLANNING_KEY } });
  return row?.value === 'true';
};

routes.get('/customsPlanning', async (req, res) => {
  try {
    res.json({ status: 'success', result: { enabled: await readCustomsPlanning() } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/customsPlanning', requireSystem, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ status: 'error', result: 'enabled must be true or false.' });
    }
    const value = String(req.body.enabled);
    const existing = await AppSetting.findOne({ where: { key: CUSTOMS_PLANNING_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: CUSTOMS_PLANNING_KEY, value });
    res.json({ status: 'success', result: { enabled: req.body.enabled } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * Where a customs job's Documents card sits (Configuration > Customs): on the
 * Goods Declaration tab when on, else on Booking Info - its own tab, which
 * then has nothing else on it and goes (the user's request, 2026-10-10).
 * Layout only; nothing stored on a job changes. Off until an admin turns it
 * on. Any user can read it - the job screen needs to.
 */
const CUSTOMS_DOCUMENTS_ON_GD_KEY = 'customsDocumentsOnGd';

routes.get('/customsDocumentsOnGd', async (req, res) => {
  try {
    const row = await AppSetting.findOne({ where: { key: CUSTOMS_DOCUMENTS_ON_GD_KEY } });
    res.json({ status: 'success', result: { enabled: row?.value === 'true' } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/customsDocumentsOnGd', requireSystem, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ status: 'error', result: 'enabled must be true or false.' });
    }
    const value = String(req.body.enabled);
    const existing = await AppSetting.findOne({ where: { key: CUSTOMS_DOCUMENTS_ON_GD_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: CUSTOMS_DOCUMENTS_ON_GD_KEY, value });
    res.json({ status: 'success', result: { enabled: req.body.enabled } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * How a customs job's Charges tab lays out its three parts (Configuration >
 * Customs): on, Receivable, Payable and Summary each on a tab of their own;
 * off, the three one under another on one page, as before. One install asked
 * for tabs and CargoLinkers did not (the user, 2026-11-11), so it is a switch.
 * Layout only; nothing stored on a job changes. Off until an admin turns it
 * on. Any user can read it - the job screen needs to.
 */
const CUSTOMS_CHARGE_TABS_KEY = 'customsChargeTabs';

routes.get('/customsChargeTabs', async (req, res) => {
  try {
    const row = await AppSetting.findOne({ where: { key: CUSTOMS_CHARGE_TABS_KEY } });
    res.json({ status: 'success', result: { enabled: row?.value === 'true' } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/customsChargeTabs', requireSystem, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ status: 'error', result: 'enabled must be true or false.' });
    }
    const value = String(req.body.enabled);
    const existing = await AppSetting.findOne({ where: { key: CUSTOMS_CHARGE_TABS_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: CUSTOMS_CHARGE_TABS_KEY, value });
    res.json({ status: 'success', result: { enabled: req.body.enabled } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * How a customs job's screen is laid out and labelled (Configuration >
 * Customs) - see functions/customsJobForm: the S/R Page #'s name, the tabs and
 * which sections sit on each, adding ports from the job, the container size
 * list, Freight Forwarding as a job type, and the Commodity box. Asked for by
 * Essani as options (the user, 2026-11-14); unset, the screen is as it was.
 * Any user can read it - the job screen and the invoice print need to.
 */
routes.get('/customsJobForm', async (req, res) => {
  try {
    res.json({ status: 'success', result: await readCustomsJobForm({ AppSetting }) });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/customsJobForm', requireSystem, async (req, res) => {
  try {
    const value = normalizeCustomsJobForm(req.body);
    const existing = await AppSetting.findOne({ where: { key: CUSTOMS_JOB_FORM_KEY } });
    if (existing) await existing.update({ value: JSON.stringify(value) });
    else await AppSetting.create({ key: CUSTOMS_JOB_FORM_KEY, value: JSON.stringify(value) });
    res.json({ status: 'success', result: value });
  } catch (e) {
    if (e instanceof CustomsJobFormError) return res.status(400).json({ status: 'error', result: e.message });
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * The shape of a GST (sales tax) invoice number (Configuration > Invoices) -
 * see functions/gstNumberFormat. Unset, {CODE}-#: CL-24295, as always. Only
 * numbers issued after a change take the new shape; the sequence carries on.
 * Any user can read it; an admin changes it.
 */
const gstFormatReply = (format) => ({
  format,
  isDefault: format === DEFAULT_GST_FORMAT,
  example: formatGstNumber(format, { code: 'ABC', seq: 1 }),
});

routes.get('/gstNumberFormat', async (req, res) => {
  try {
    res.json({ status: 'success', result: gstFormatReply(await readGstFormat({ AppSetting })) });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/gstNumberFormat', requireSystem, async (req, res) => {
  try {
    const given = req.body?.format;
    if (typeof given !== 'string') {
      return res.status(400).json({ status: 'error', result: 'format must be text.' });
    }
    // Blank goes back to the default.
    const format = given.trim() ? validateGstFormat(given) : DEFAULT_GST_FORMAT;
    const existing = await AppSetting.findOne({ where: { key: GST_FORMAT_KEY } });
    if (existing) await existing.update({ value: format });
    else await AppSetting.create({ key: GST_FORMAT_KEY, value: format });
    res.json({ status: 'success', result: gstFormatReply(format) });
  } catch (e) {
    if (e instanceof GstFormatError) return res.status(400).json({ status: 'error', result: e.message });
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * The statuses customs jobs and Program Book plans can be at, and the rules
 * each follows (Configuration > Customs) - see functions/customsStatuses.
 *
 * Any user can read them: the job list, the job screen and the book label and
 * colour by them. Only an admin changes them, and a change that would remove a
 * status still on a job or plan is refused - it is retired (unticked Offered)
 * instead, so no row is left at a status nothing knows.
 */
const CUSTOMS_STATUSES_KEY = 'customsStatuses';

const readCustomsStatuses = async () => {
  const row = await AppSetting.findOne({ where: { key: CUSTOMS_STATUSES_KEY } });
  return normalizeStatuses(row?.value);
};

routes.get('/customsStatuses', async (req, res) => {
  try {
    res.json({
      status: 'success',
      result: { ...(await readCustomsStatuses()), rules: STATUS_RULES, colors: STATUS_COLORS, builtIn: BUILT_IN_STATUSES },
    });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/customsStatuses', requireSystem, async (req, res) => {
  try {
    const db = require('../../models');
    const previous = await readCustomsStatuses();
    // How many rows carry each status - a status in use is never removed.
    const tally = async (model) => {
      const rows = await model.findAll({
        attributes: ['status', [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'n']],
        group: ['status'], raw: true,
      });
      return new Map(rows.map((r) => [r.status, Number(r.n) || 0]));
    };
    const inUse = { job: await tally(db.Customs_Job), plan: await tally(db.Customs_Plan) };
    const next = {
      job: validateList('job', req.body?.job, previous.job, inUse.job),
      plan: validateList('plan', req.body?.plan, previous.plan, inUse.plan),
    };
    const value = JSON.stringify(next);
    const existing = await AppSetting.findOne({ where: { key: CUSTOMS_STATUSES_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: CUSTOMS_STATUSES_KEY, value });
    res.json({ status: 'success', result: normalizeStatuses(value) });
  } catch (e) {
    if (e instanceof StatusError) return res.status(400).json({ status: 'error', result: e.message });
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * JOB BALANCING - ADVANCE TRANSACTIONS: where the report's Show Advance
 * Transactions switch starts (Configuration > Reports). The user,
 * 2026-11-10: SNS wants the advances on the report and CL does not, and
 * switching it off on every run would be a chore. The switch still changes one
 * run; this is where it starts, and what the report does when it is sent no
 * choice (a tab opened before the switch). On until an admin turns it off -
 * the report as it was. Any user can read it - the filter page needs to.
 */
const JOB_BALANCING_ADVANCES_KEY = 'jobBalancingAdvances';

const readJobBalancingAdvances = async () => {
  const row = await AppSetting.findOne({ where: { key: JOB_BALANCING_ADVANCES_KEY } });
  return row?.value !== 'false';
};

routes.get('/jobBalancingAdvances', async (req, res) => {
  try {
    res.json({ status: 'success', result: { enabled: await readJobBalancingAdvances() } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/jobBalancingAdvances', requireSystem, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ status: 'error', result: 'enabled must be true or false.' });
    }
    const value = String(req.body.enabled);
    const existing = await AppSetting.findOne({ where: { key: JOB_BALANCING_ADVANCES_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: JOB_BALANCING_ADVANCES_KEY, value });
    createHistory(req.user.id, 'Job Balancing Advances', 'Edit', req.body.enabled ? 'on' : 'off');
    res.json({ status: 'success', result: { enabled: req.body.enabled } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * REPORT DATES - where the From and To boxes of the period reports start
 * (Configuration > Reports). The user, 2026-11-11: they opened on the start
 * of the fiscal year to today, and some clients need the start of the fiscal
 * year to the end of the year. Which end of year was not said, so both are
 * offered:
 *   from: 'fiscalStart' (as it was) | 'yearStart' (1 January)
 *   to:   'today' (as it was) | 'fiscalEnd' | 'yearEnd' (31 December)
 * Only where the boxes START - a user still picks any dates for a run. The
 * dates are worked out on the screen (functions/reportDates), from the fiscal
 * year that has today in it. Any user can read it; an admin sets it.
 */
const REPORT_DATES_KEY = 'reportDates';
const REPORT_FROM = ['fiscalStart', 'yearStart'];
const REPORT_TO = ['today', 'fiscalEnd', 'yearEnd'];

const readReportDates = async () => {
  const row = await AppSetting.findOne({ where: { key: REPORT_DATES_KEY } });
  let saved = {};
  try { saved = JSON.parse(row?.value || '{}') || {}; } catch (_) { saved = {}; }
  return {
    from: REPORT_FROM.includes(saved.from) ? saved.from : 'fiscalStart',
    to: REPORT_TO.includes(saved.to) ? saved.to : 'today',
  };
};

routes.get('/reportDates', async (req, res) => {
  try {
    res.json({ status: 'success', result: await readReportDates(), options: { from: REPORT_FROM, to: REPORT_TO } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/reportDates', requireSystem, async (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!REPORT_FROM.includes(from) || !REPORT_TO.includes(to)) {
      return res.status(400).json({
        status: 'error',
        result: `from must be one of ${REPORT_FROM.join(', ')}; to one of ${REPORT_TO.join(', ')}.`,
      });
    }
    const value = JSON.stringify({ from, to });
    const existing = await AppSetting.findOne({ where: { key: REPORT_DATES_KEY } });
    if (existing) await existing.update({ value });
    else await AppSetting.create({ key: REPORT_DATES_KEY, value });
    createHistory(req.user.id, 'Report Dates', 'Edit', `${from} to ${to}`);
    res.json({ status: 'success', result: { from, to } });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/**
 * DASHBOARD WIDGETS - which designation sees which widget on the home page
 * (Configuration > Dashboard Widgets; the user, 2026-11-23). The rule, its
 * defaults and the route guards are in functions/dashboardWidgets. Read and
 * set by Seanet's System login only - nothing else needs the grid; each user
 * asks /home/widgets for their own.
 */
routes.get('/dashboardWidgets', requireSystem, async (req, res) => {
  try {
    res.json({
      status: 'success',
      result: await dashboardWidgets.readGrid(),
      widgets: dashboardWidgets.WIDGETS,
      designations: dashboardWidgets.DESIGNATIONS,
      defaults: dashboardWidgets.DEFAULTS,
    });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/dashboardWidgets', requireSystem, async (req, res) => {
  try {
    const grid = await dashboardWidgets.writeGrid(req.body?.widgets);
    const summary = dashboardWidgets.WIDGETS
      .map((w) => `${w.label}: ${grid[w.key].join(', ') || 'nobody'}`).join('; ');
    createHistory(req.user.id, 'Dashboard Widgets', 'Edit', summary);
    res.json({ status: 'success', result: grid });
  } catch (e) {
    res.status(e.status || 500).json({ status: 'error', result: e.message });
  }
});

/**
 * BELL ALERTS - which designation sees which of the bell's alert lists
 * (Critical, Job Charges, Invoices Due, Job Status; Configuration > Bell
 * Alerts, the user 2026-11-23). The lists and the grid are functions/
 * bellAlerts'. Seanet's to set.
 */
routes.get('/bellAlertLists', requireSystem, async (req, res) => {
  try {
    const { access } = require('../../functions/bellAlerts');
    res.json({
      status: 'success',
      result: await access.readGrid(),
      widgets: access.ROWS,
      designations: dashboardWidgets.DESIGNATIONS,
      defaults: access.DEFAULTS,
    });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/bellAlertLists', requireSystem, async (req, res) => {
  try {
    const { access } = require('../../functions/bellAlerts');
    const grid = await access.writeGrid(req.body?.widgets);
    const summary = access.ROWS.map((r) => `${r.label}: ${grid[r.key].join(', ') || 'nobody'}`).join('; ');
    createHistory(req.user.id, 'Bell Alerts', 'Edit', summary);
    res.json({ status: 'success', result: grid });
  } catch (e) {
    res.status(e.status || 500).json({ status: 'error', result: e.message });
  }
});

/**
 * BELL ALERT DAYS - the days each alert list checks against (Configuration >
 * Bell Alerts; the user, 2026-11-23: "invoice due over 90 days are critical, I
 * should be able to set it at 120"). functions/bellAlerts has the defaults and
 * the checks. Seanet's to set.
 */
routes.get('/bellAlertDays', requireSystem, async (req, res) => {
  try {
    const bell = require('../../functions/bellAlerts');
    res.json({ status: 'success', result: await bell.readDays(), fields: bell.DAY_FIELDS, defaults: bell.DAYS, max: bell.MAX_DAYS });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/bellAlertDays', requireSystem, async (req, res) => {
  try {
    const bell = require('../../functions/bellAlerts');
    const saved = await bell.writeDays(req.body?.days);
    createHistory(req.user.id, 'Bell Alert Days', 'Edit', Object.entries(saved).map(([k, v]) => `${k} ${v}`).join(', '));
    res.json({ status: 'success', result: saved });
  } catch (e) {
    res.status(e.status || 500).json({ status: 'error', result: e.message });
  }
});

/**
 * NEW JOB ALERTS - which designations are told when a job is created
 * (Configuration > New Job Alerts; the user, 2026-11-23). The rules are in
 * functions/newJobAlerts. Nobody until picked. Seanet's to set.
 */
routes.get('/newJobAlerts', requireSystem, async (req, res) => {
  try {
    res.json({ status: 'success', result: await newJobAlerts.readSetting(), designations: newJobAlerts.DESIGNATIONS });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/newJobAlerts', requireSystem, async (req, res) => {
  try {
    const saved = await newJobAlerts.writeSetting(req.body);
    createHistory(req.user.id, 'New Job Alerts', 'Edit', saved.designations.join(', ') || 'nobody');
    res.json({ status: 'success', result: saved });
  } catch (e) {
    res.status(e.status || 500).json({ status: 'error', result: e.message });
  }
});

/* ---------------------------------------------------------------------------
 * PER-COMPANY MASTER DATA - which tables are separated per company
 * (functions/companySeparation.js). Read by every screen that offers a
 * record's companies; set by Seanet.
 * ------------------------------------------------------------------------ */
routes.get('/companySeparation', async (req, res) => {
  try {
    const value = await separation.readSeparation();
    const labels = Object.fromEntries(Object.entries(separation.TABLES).map(([k, t]) => [k, t.label]));
    res.json({ status: 'success', result: value, labels });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/companySeparation', requireSystem, async (req, res) => {
  try {
    const value = await separation.writeSeparation(req.body || {});
    createHistory(req.user.id, 'Company Separation', 'Edit', Object.keys(value).filter((k) => value[k]).join(', ') || 'none');
    res.json({ status: 'success', result: value });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

/* ---------------------------------------------------------------------------
 * ACCESS CONTROL - audit or enforce (functions/permissions/middleware.js).
 * Audit lets everything through and logs what would have been refused; the
 * log below is the to-do list before switching an install to enforce.
 * ------------------------------------------------------------------------ */
routes.get('/permissionsMode', async (req, res) => {
  try {
    res.json({ status: 'success', mode: await permissions.getMode(), modes: permissions.MODES });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/permissionsMode', requireSystem, async (req, res) => {
  try {
    const mode = await permissions.setMode(String(req.body?.mode || ''));
    createHistory(req.user.id, 'Access Control', 'Mode', mode);
    res.json({ status: 'success', mode });
  } catch (e) {
    res.status(400).json({ status: 'error', result: e.message });
  }
});

routes.get('/permissionDenials', requireSystem, async (req, res) => {
  try {
    const db = require('../../models');
    const rows = await db.Permission_Denial.findAll({ order: [['lastAt', 'DESC']], limit: 1000, raw: true });
    const ids = [...new Set(rows.map((r) => r.EmployeeId))];
    const people = ids.length
      ? await db.Employees.findAll({ where: { id: ids }, attributes: ['id', 'name', 'designation'], raw: true })
      : [];
    const byId = Object.fromEntries(people.map((p) => [p.id, p]));
    res.json({
      status: 'success',
      result: rows.map((r) => ({ ...r, employee: byId[r.EmployeeId]?.name || null, designation: byId[r.EmployeeId]?.designation || null })),
    });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

routes.post('/permissionDenials/clear', requireSystem, async (req, res) => {
  try {
    const db = require('../../models');
    await db.Permission_Denial.destroy({ where: {} });
    res.json({ status: 'success' });
  } catch (e) {
    res.status(500).json({ status: 'error', result: e.message });
  }
});

// The router is the default export so app.use('/settings', require(...)) keeps
// working; readCostCenter hangs off it for the code that needs the value
// without an HTTP round trip (the voucher builder, the customs migration).
module.exports = routes;
module.exports.readCostCenter = readCostCenter;
module.exports.readOperationMode = readOperationMode;
module.exports.readAutoRoundOff = readAutoRoundOff;
module.exports.readCustomsPlanning = readCustomsPlanning;
module.exports.readCustomsStatuses = readCustomsStatuses;
module.exports.readJobBalancingAdvances = readJobBalancingAdvances;
module.exports.readReportDates = readReportDates;
module.exports.DEFAULT_COST_CENTRE = DEFAULT_COST_CENTRE;
