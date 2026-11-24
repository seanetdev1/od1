/**
 * GST invoice numbers - legacy GL_JobInvoice_TaxInvoice into Sales_Tax_Invoice,
 * on a customs install.
 *
 * Every client invoice that carried sales tax was issued a GST number
 * (CL-1 ... CL-24295 on CargoLinkers), which the Sale Tax Invoice prints and
 * the tax authority knows it by. This gives each migrated invoice its number,
 * and puts the next one Odyssey issues straight after the last legacy one.
 * Runs after Clearing Invoices, whose invoices it attaches to.
 */

import axiosClient from 'apis/axiosClient';

const LEGACY_API =
  process.env.NEXT_PUBLIC_CLIMAX_LEGACY_URL || 'http://localhost:8081';

const PAGE = 5000;

async function fetchPage(offset) {
  try {
    const { data } = await axiosClient.get(`${LEGACY_API}/jobs/getTaxInvoiceNumbers`, {
      params: { offset, limit: PAGE },
    });
    if (!data || !Array.isArray(data.rows)) {
      throw new Error(`${LEGACY_API}/jobs/getTaxInvoiceNumbers returned no rows array.`);
    }
    return data;
  } catch (err) {
    if (err?.response?.status === 404) {
      throw new Error(
        `${LEGACY_API}/jobs/getTaxInvoiceNumbers does not exist on this legacy server. It was added `
        + 'for this stage - restart the customs legacy server (Climax-backup-server-CC) to pick it up.'
      );
    }
    if (!err?.response) {
      throw new Error(`Could not reach the legacy server at ${LEGACY_API}.`);
    }
    throw err;
  }
}

export async function migrateTaxInvoices(report = () => {}, options = {}) {
  const { apply = true, onProgress } = options;
  const first = await fetchPage(0);
  const total = first.total || 0;
  if (!total) {
    report('GST invoice numbers: the legacy system has none.');
    return { planned: null, applied: null, verification: null, noop: true, reason: 'No GST numbers in the source.' };
  }
  report(`GST invoice numbers: ${total.toLocaleString()} to ${apply ? 'import' : 'check'}.`);

  const acc = { created: 0, alreadyNumbered: 0, invoiceNotFound: 0, ambiguous: 0, badNumber: 0, samples: {} };
  let done = 0;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = offset === 0 ? first : await fetchPage(offset);
    const { data: res } = await axiosClient.post(
      apply ? '/taxInvoiceMigration/apply' : '/taxInvoiceMigration/plan', { rows: page.rows },
    );
    const r = res.result;
    acc.created += r.created || 0;
    acc.alreadyNumbered += r.problems?.alreadyNumbered || 0;
    for (const k of ['invoiceNotFound', 'ambiguous', 'badNumber']) {
      acc[k] += r.problems?.[k]?.count || 0;
      acc.samples[k] = [...(acc.samples[k] || []), ...(r.problems?.[k]?.sample || [])].slice(0, 10);
    }
    done += page.rows.length;
    const pct = Math.round((Math.min(done, total) / total) * 100);
    onProgress?.({ done, total, percent: pct });
    if (!page.rows.length) break;
  }

  report(
    `GST invoice numbers: ${apply ? 'attached' : 'would attach'} ${acc.created.toLocaleString()}, `
    + `${acc.alreadyNumbered.toLocaleString()} already had theirs.`
  );
  if (acc.invoiceNotFound) {
    report(`GST invoice numbers: ${acc.invoiceNotFound.toLocaleString()} name an invoice Odyssey does not have - run Clearing Invoices first. e.g. ${acc.samples.invoiceNotFound.join(', ')}`);
  }
  if (acc.ambiguous) {
    report(`GST invoice numbers: ${acc.ambiguous.toLocaleString()} match more than one invoice - the same legacy invoice imported twice. Not attached. e.g. ${acc.samples.ambiguous.join(', ')}`);
  }
  if (acc.badNumber) {
    report(`GST invoice numbers: ${acc.badNumber.toLocaleString()} have no number that can be read. e.g. ${acc.samples.badNumber.join(', ')}`);
  }

  if (!apply) {
    return { planned: acc, applied: null, verification: null, noop: true, reason: 'Dry run.' };
  }
  const { data: verifyRes } = await axiosClient.get('/taxInvoiceMigration/verify');
  const v = verifyRes.result;
  report(`GST invoice numbers: ${v.numbers.toLocaleString()} in the system; the next one issued follows ${v.highestSeq ?? 'nothing yet'}.`);
  return {
    planned: acc, applied: acc, verification: v,
    noop: acc.created === 0,
    reason: acc.created === 0 ? 'Every GST number was already attached.' : null,
  };
}
