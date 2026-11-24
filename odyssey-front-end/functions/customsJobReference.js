/**
 * Whether a customs job has something to be found by - what it needs to save.
 *
 * Any ONE of the three references the clerks look a file up by: the S/R Page #
 * (jobRef), the Client Invoice # (clientRef) or the GD #. It used to be the S/R
 * Page # alone, which refused a file whose register page was not known yet
 * though its GD or the client's invoice was.
 */
const present = (v) => String(v ?? '').trim() !== '';

/**
 * THE Client Invoice # - one number, shown on Job Details and on Booking Info.
 *
 * Two columns hold it, because the file always had both: clientRef, from
 * Climax's ClientRefNo (cut at 20 characters there), and invoiceNo, from
 * CInvNumber (whole). The form writes both alike; where an old job's two
 * differ, the whole number is the one shown.
 */
export const clientInvoiceNo = (job = {}) =>
  (present(job.invoiceNo) ? job.invoiceNo : present(job.clientRef) ? job.clientRef : '');

/* A FREIGHT FORWARDING job (Configuration > Customs; Essani, 2026-11-14) has
   an HBL # where the others have a Client Invoice #, so its HBL # is the one
   that counts - functions/customsJobForm. */
export const hasJobReference = (job = {}) =>
  present(job.jobRef) || present(job.gdNumber)
  || (job.jobType === 'Freight Forwarding' ? present(job.blNo) : present(clientInvoiceNo(job)));

/**
 * A customs job's container numbers, as one line - for the invoice's Note box
 * when Configuration > Invoices puts them there (Essani, 2026-11-14): its
 * container rows', else the job's own typed list. Empty when it has neither.
 */
export const containerNumbers = (job) => {
  const rows = (job?.Customs_Containers || []).map((c) => String(c?.containerNo || '').trim()).filter(Boolean);
  if (rows.length) return [...new Set(rows)].join(', ');
  return String(job?.containers || '').trim();
};

export default hasJobReference;
