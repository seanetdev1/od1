/**
 * What the signed-in user may do with a job's CHARGES and the INVOICES raised
 * from them - one answer per button, by the same alternatives the server's
 * route rules accept (functions/permissions/routeRules.js on the backend):
 * the job module's right, or the Accounts invoices module's, which has always
 * covered a job's invoices too.
 *
 * Separate since 2026-10-20 (the user's request): someone may enter charges
 * and raise invoices without approving or editing them. And since 2026-10-24
 * approving is apart from UNapproving: an operator may raise invoices approved
 * - into the ledger - and not take them back out of it.
 *
 *   const can = useMyPermissions();
 *   const rights = jobDocRights(can);
 *   rights.raiseInvoices
 */
export const jobDocRights = (can) => ({
  viewCharges: can('jobCharges', 'view') || can('invoices', 'view'),
  editCharges: can('jobCharges', 'edit') || can('invoices', 'edit'),
  approveCharges: can('jobCharges', 'approve') || can('invoices', 'approve'),
  viewInvoices: can('jobInvoices', 'view') || can('invoices', 'view'),
  raiseInvoices: can('jobInvoices', 'raise') || can('invoices', 'edit'),
  editInvoices: can('jobInvoices', 'edit') || can('invoices', 'edit'),
  deleteInvoices: can('jobInvoices', 'delete') || can('invoices', 'delete'),
  approveInvoices: can('jobInvoices', 'approve') || can('invoices', 'approve'),
  unapproveInvoices: can('jobInvoices', 'unapprove') || can('invoices', 'unapprove'),
});

export default jobDocRights;
