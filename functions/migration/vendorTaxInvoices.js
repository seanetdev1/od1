/**
 * Vendor tax invoice numbers - legacy GL_JobBill.VendorTaxInvoiceNo onto the
 * migrated vendor bills (Invoice.vendorTaxInvoiceNo), on a customs install.
 *
 * The number on the tax invoice each vendor sent - QICT, KICT, WEBOC - which
 * Job Balancing shows as Vendor Tax Inv #. A small path of its own (the user's
 * request, 2026-10-14), so an install whose bills are already in can be given
 * the numbers without importing anything else. Runs after Clearing Invoices,
 * whose bills it attaches to; a number already on a bill is never replaced.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

const PAGE = 5000;
const LABEL = 'Vendor tax invoice numbers';

async function fetchPage(offset) {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getVendorTaxInvoiceNumbers`, {
      params: { offset, limit: PAGE },
    });
    if (!data || !Array.isArray(data.rows)) {
      throw new Error(`${LEGACY_API}/jobs/getVendorTaxInvoiceNumbers returned no rows array.`);
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getVendorTaxInvoiceNumbers does not exist on this legacy server. It was added `
        + 'for this stage - update and restart the customs legacy server (Climax-backup-server-CC).'
      );
    }
    if (!err?.response) {
      throw new Error(`Could not reach the legacy server at ${LEGACY_API}.`);
    }
    throw err;
  }
}

export async function migrateVendorTaxInvoices(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;
  const first = await fetchPage(0);
  const total = first.total || 0;
  if (!total) {
    report(`${LABEL}: the legacy system has none.`);
    return { planned: null, applied: null, verification: null, noop: true, reason: 'No vendor tax invoice numbers in the source.' };
  }
  report(`${LABEL}: ${total.toLocaleString()} bills to ${apply ? 'update' : 'check'}.`);

  const LISTS = ['billNotFound', 'ambiguous', 'wrongBill', 'different'];
  const acc = { updated: 0, alreadySet: 0, samples: {} };
  for (const k of LISTS) acc[k] = 0;
  let done = 0;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = offset === 0 ? first : await fetchPage(offset);
    if (!page.rows.length) break;
    const { data: res } = await axiosClient.post(
      apply ? '/vendorTaxInvoiceMigration/apply' : '/vendorTaxInvoiceMigration/plan', { rows: page.rows },
    );
    const r = res.result;
    acc.updated += apply ? (r.updated || 0) : (r.toUpdate || 0);
    acc.alreadySet += r.problems?.alreadySet || 0;
    for (const k of LISTS) {
      acc[k] += r.problems?.[k]?.count || 0;
      acc.samples[k] = [...(acc.samples[k] || []), ...(r.problems?.[k]?.sample || [])].slice(0, 10);
    }
    done += page.rows.length;
    onProgress?.({ done, total, percent: Math.round((Math.min(done, total) / total) * 100) });
  }

  report(`${LABEL}: ${apply ? 'put on' : 'would put on'} ${acc.updated.toLocaleString()} bills, ${acc.alreadySet.toLocaleString()} already had theirs.`);
  const say = (k, text) => {
    if (acc[k]) report(`${LABEL}: ${acc[k].toLocaleString()} ${text} e.g. ${acc.samples[k].join(', ')}`);
  };
  say('billNotFound', 'name a bill Odyssey does not have - run Clearing Invoices first.');
  say('ambiguous', 'match more than one bill - the same legacy bill imported twice. Not set.');
  say('wrongBill', 'found a bill with another number than the legacy one. Not set.');
  say('different', 'bills already carry a different number, typed in Odyssey - kept.');

  const summary = `${acc.updated.toLocaleString()} bills given their number, ${acc.alreadySet.toLocaleString()} already had it`;
  // Nothing placed and most of the legacy bills not found, or found under
  // another bill number: almost always this database is not the one those
  // legacy bills were imported into (an SNS database against the CL legacy
  // server, say). Said on screen, not left as a quiet zero.
  const unmatched = acc.billNotFound + acc.wrongBill;
  const warning = acc.updated === 0 && unmatched > total / 2
    ? `None matched: ${unmatched.toLocaleString()} of ${total.toLocaleString()} legacy bills are not in this database `
      + `(${acc.billNotFound.toLocaleString()} missing, ${acc.wrongBill.toLocaleString()} under another bill number). `
      + 'Is this the install those bills were migrated into?'
    : null;

  if (!apply) {
    return { planned: acc, applied: null, verification: null, noop: true, reason: 'Dry run.', summary, warning };
  }
  const { data: verifyRes } = await axiosClient.get('/vendorTaxInvoiceMigration/verify');
  const v = verifyRes.result;
  report(`${LABEL}: ${v.withNumber.toLocaleString()} of ${v.bills.toLocaleString()} bills now carry one.`);
  return {
    planned: acc, applied: acc, verification: v,
    noop: acc.updated === 0,
    reason: acc.updated !== 0 ? null
      : warning ? 'No legacy bill matched a bill in this database.'
      : 'Every vendor tax invoice number was already on its bill.',
    summary: `${summary}; ${v.withNumber.toLocaleString()} of ${v.bills.toLocaleString()} bills now carry one`,
    warning,
  };
}
