/**
 * Which of a company's bank accounts an invoice prints by default - Config >
 * Bank Accounts, "Make client default" and "Make agent default".
 *
 *   client default   job invoices and bills (JI / JB), and everything else
 *                    raised on a client or vendor
 *   agent default    agent invoices and bills (AI / AB)
 *
 * A company keeps one of each; they may be the same account. With none set
 * the invoice falls back to the company's first account, as it always did.
 *
 * KEPT IN AppSettings, NOT ON BankAccounts. That table is created once and
 * never altered on boot (models/index.js), so a new column on it needs SQL run
 * by hand on every install BEFORE the new code starts - and the day it is
 * missed, every query that includes BankAccount fails, which takes the
 * header's company list down with it. A settings row needs nothing run.
 * The flags are put onto the accounts on the way out (withBankDefaults), so
 * the screens read them as if they were columns.
 *
 * Shape: { "<companyId>": { "client": <accountId>, "agent": <accountId> } }
 *
 * No model imports - unit tested without a database.
 */

const BANK_DEFAULTS_KEY = 'bankAccountDefaults';
const BANK_DEFAULT_KINDS = ['client', 'agent'];

/** The stored mapping. A missing or malformed row reads as "nothing set". */
function parseBankDefaults(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function readBankDefaults(AppSetting, transaction) {
  const row = await AppSetting.findOne({ where: { key: BANK_DEFAULTS_KEY }, transaction });
  return parseBankDefaults(row && row.value);
}

/** The mapping with this company's `kind` default moved to `accountId`. */
function setBankDefault(mapping, companyId, kind, accountId) {
  const key = String(companyId);
  return {
    ...mapping,
    [key]: { ...((mapping && mapping[key]) || {}), [kind]: Number(accountId) },
  };
}

/** Plain account rows, each with clientDefault / agentDefault set. */
function flagAccounts(accounts, mapping, companyId) {
  const own = (mapping && mapping[String(companyId)]) || {};
  return (accounts || []).map((a) => ({
    ...a,
    clientDefault: own.client != null && String(own.client) === String(a.id),
    agentDefault: own.agent != null && String(own.agent) === String(a.id),
  }));
}

/** A plain company with its BankAccounts flagged. Leaves anything else alone. */
function withBankDefaults(company, mapping) {
  if (!company || !Array.isArray(company.BankAccounts)) return company;
  return { ...company, BankAccounts: flagAccounts(company.BankAccounts, mapping, company.id) };
}

module.exports = {
  BANK_DEFAULTS_KEY,
  BANK_DEFAULT_KINDS,
  parseBankDefaults,
  readBankDefaults,
  setBankDefault,
  flagAccounts,
  withBankDefaults,
};
