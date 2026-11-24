import ports from 'jsonData/ports';
import { formatPortForPrint } from 'Components/Layouts/JobsLayout/BlComp/states';

/* WHAT A B/L PRINTS, AS TEXT - shared by the built-in print
 * (Components/Layouts/JobsLayout/BlComp/BlPrintImage) and a B/L or Air
 * Waybill printed from a Word template (functions/blTemplateFields), so the
 * two cannot print one B/L two ways. */

/* A party box (or marks, packages, description) as the B/L editors keep it -
 * HTML paragraphs - in plain lines. A paragraph of "null", "TEL" or "TEL null"
 * is what an empty party field leaves behind, and prints nothing. */
export function pTagsToString(html) {
  const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
  return Array.from(doc.querySelectorAll('p'))
    .map((p) => p.textContent.trim())
    .filter((text) => {
      if (!text) return false;
      const lower = text.toLowerCase();
      return lower !== 'null' && lower !== 'tel' && !lower.includes('tel null');
    })
    .join('\n');
}

/** The same, as a list of lines - none for an empty box. */
export const htmlLines = (html) => {
  const text = pTagsToString(html ?? '');
  return text ? text.split('\n') : [];
};

/** A sea port as the B/L prints it: "KARACHI, PAKISTAN"; a code not in the list as it is. */
export const blPortName = (id) => {
  const port = ports.ports.find((x) => x.id == id);
  return port ? formatPortForPrint(port).toUpperCase() : (id?.toUpperCase?.() ?? '');
};

/** "PREPAID" / "COLLECT" - the job's freight type, '2' and '1' as the old screens stored them. */
export const freightTerms = (freightType) => {
  if (freightType == '2') return 'PREPAID';
  if (freightType == '1') return 'COLLECT';
  return String(freightType ?? '').toUpperCase();
};

/** Freight Payable At: here for prepaid, the destination for anything else. */
export const freightPayableAt = (freightType) => (freightTerms(freightType) === 'PREPAID' ? 'KARACHI, PAKISTAN' : 'DESTINATION');

/** The stamps of one group (1 to 8, the Stamps tab's Stamp Group), by name - as saved ("1"). */
export const stampsOfGroup = (blStamps, group, stampList) => (Array.isArray(blStamps) ? blStamps : [])
  .filter((x) => x?.stamp_group === String(group))
  .map((x) => stampList[Number(x.code) - 1]?.label)
  .filter(Boolean);
