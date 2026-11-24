/**
 * A FOREIGN CHARGE'S RATE - a USD (or any non-rupee) charge needs an exchange
 * rate above 1 (the user's request, 2026-10-13). A USD line at 1 puts its
 * dollars into the books as that many rupees; a new line used to start at the
 * job's rate, which itself started at 1.
 *
 * Only lines still open to change are checked - not an approved one, nor one
 * on an approved invoice: those are posted as they stand, and refusing the
 * whole sheet over a line nobody can edit would lock the job.
 *
 * Mirrored on the charges screen (frontend functions/chargeExRate) - test both
 * on the same cases.
 */
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const isOpen = (line) => String(line?.status) !== '1' && String(line?.Invoice?.approved) !== '1';
const isForeign = (line) => {
  const c = String(line?.currency || '').trim().toUpperCase();
  return c !== '' && c !== 'PKR';
};

/** The first open foreign line whose rate is 1 or less - as a refusal - or null. */
function foreignRateProblem(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const i = list.findIndex((l) => isOpen(l) && isForeign(l) && num(l.ex_rate) <= 1);
  if (i === -1) return null;
  const l = list[i];
  const what = [l.particular || l.description, String(l.currency).toUpperCase()].filter(Boolean).join(', ');
  return `Charge line ${i + 1} (${what}) needs an exchange rate above 1.`;
}

module.exports = { foreignRateProblem, isOpen, isForeign };
