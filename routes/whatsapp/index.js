/* WHATSAPP DAILY UPDATE - Config > WhatsApp. All of it is Config's (System):
 * the connection, who it goes to, and trying it. functions/whatsapp has the
 * rest. */
const routes = require('express').Router();
const { requireSystem } = require('../../functions/systemAccess');
const { createHistory } = require('../../functions/history');
const { readSettings, readToken, writeSettings, SettingsError, TEMPLATE } = require('../../functions/whatsapp/settings');
const { runDailyUpdate, readLog, readState, markTodayIfPassed } = require('../../functions/whatsapp/runner');

const fail = (res, error) => {
  const status = error?.status || (error instanceof SettingsError ? 400 : 500);
  if (status === 500) console.error(error);
  return res.status(status).json({ status: 'error', result: error?.message || String(error) });
};

routes.use(requireSystem);

routes.get('/settings', async (req, res) => {
  try {
    const [settings, token, state] = await Promise.all([readSettings(), readToken(), readState()]);
    res.json({ status: 'success', result: { settings, hasToken: Boolean(token), template: TEMPLATE, state } });
  } catch (e) { fail(res, e); }
});

/** { settings, token? } - a blank token keeps the stored one. */
routes.post('/settings', async (req, res) => {
  try {
    const before = await readSettings();
    const settings = await writeSettings(req.body?.settings, req.body?.token);
    // On, or the time moved, after today's time: the first send is tomorrow's.
    if (settings.enabled && (!before.enabled || before.time !== settings.time || before.timeZone !== settings.timeZone)) {
      await markTodayIfPassed(settings);
    }
    createHistory(req.user?.id || req.body?.employeeId, 'Config', 'WhatsApp', settings.enabled ? 'On' : 'Off');
    res.json({ status: 'success', result: { settings, hasToken: Boolean(await readToken()) } });
  } catch (e) { fail(res, e); }
});

/** { mode: preview | pdf | test | send, testTo?, date? } */
routes.post('/run', async (req, res) => {
  try {
    const mode = ['preview', 'pdf', 'test', 'send'].includes(req.body?.mode) ? req.body.mode : null;
    if (!mode) return res.status(400).json({ status: 'error', result: 'Preview, PDF, test or send?' });
    const result = await runDailyUpdate({ mode, testTo: req.body?.testTo, date: req.body?.date, trigger: 'manual' });
    if (mode === 'test' || mode === 'send') createHistory(req.user?.id || req.body?.employeeId, 'WhatsApp', `Daily update (${mode})`, `${result.sent} sent`);
    res.json({ status: 'success', result });
  } catch (e) { fail(res, e); }
});

routes.get('/log', async (req, res) => {
  try { res.json({ status: 'success', result: await readLog() }); } catch (e) { fail(res, e); }
});

module.exports = routes;
