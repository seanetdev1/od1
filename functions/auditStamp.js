import moment from 'moment';

/**
 * Who made a record and who last changed it, as shown on a job, voucher,
 * invoice or charge line - createdBy / createdOn / editedBy / editedOn, which
 * the server stamps on every save (functions/auditStamps there). Climax's
 * AddBy / AddOn / EditBy / EditOn.
 *
 * A record saved before those columns has none. The screens that already
 * knew a creator another way pass it as the fallback - a freight job's
 * created_by, the first History entry for an invoice or customs job - so
 * nothing they showed before goes missing.
 */

/** A person as a record names them. A voucher migrated from Climax carries
 *  Climax's add log - "abbas # SERVER # Administrator # 192.168.50.136" - of
 *  which the person is the first part. */
export const personOf = (v) => String(v ?? '').split('#')[0].trim();

export const AUDIT_FORMAT = 'DD-MM-YYYY HH:mm';
export const whenOf = (v) => (v && moment(v).isValid() ? moment(v).format(AUDIT_FORMAT) : '');

/**
 * @param record    the job / voucher / invoice / charge line
 * @param fallback  { createdBy, createdOn } for a record saved before the stamps
 * @returns { created: { by, on } | null, edited: { by, on } | null }
 */
export function auditStamps(record, fallback = {}) {
  const stamp = (by, on) => ((by || on) ? { by, on } : null);
  return {
    created: stamp(
      personOf(record?.createdBy) || personOf(fallback.createdBy),
      whenOf(record?.createdOn) || whenOf(fallback.createdOn),
    ),
    edited: stamp(personOf(record?.editedBy), whenOf(record?.editedOn)),
  };
}

/** "Created by Bilal on 09-10-2026 14:05" - either half may be missing. */
export function stampText(label, s) {
  if (!s) return '';
  return [label, s.by && `by ${s.by}`, s.on && `on ${s.on}`].filter(Boolean).join(' ');
}
