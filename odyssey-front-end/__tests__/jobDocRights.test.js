/**
 * What a user may do with a job's charges and its invoices - functions/
 * jobDocRights - by the same alternatives the server's route rules accept.
 * Separate since 2026-10-20 (the user's request).
 */
import { jobDocRights } from 'functions/jobDocRights';
import { canNow, resetMyPermissions } from 'functions/myPermissions';

const rightsOf = (...perms) => jobDocRights((m, a) => perms.includes(`${m}:${a}`));

test('raising is not editing, and neither is approving', () => {
  const r = rightsOf('jobCharges:edit', 'jobInvoices:raise');
  expect(r).toMatchObject({ editCharges: true, raiseInvoices: true, editInvoices: false, approveInvoices: false, approveCharges: false });
});

test('approving charges is not approving invoices', () => {
  expect(rightsOf('jobCharges:approve')).toMatchObject({ approveCharges: true, approveInvoices: false });
  expect(rightsOf('jobInvoices:approve')).toMatchObject({ approveCharges: false, approveInvoices: true });
});

test('the Accounts invoices module still covers a job\'s invoices, as the server lets it', () => {
  expect(rightsOf('invoices:edit')).toMatchObject({ editCharges: true, raiseInvoices: true, editInvoices: true });
  expect(rightsOf('invoices:approve')).toMatchObject({ approveCharges: true, approveInvoices: true });
  expect(rightsOf('invoices:delete').deleteInvoices).toBe(true);
});

test('outside a component, before the grants are read, everything is offered - the server decides', () => {
  resetMyPermissions();
  expect(jobDocRights(canNow).approveInvoices).toBe(true);
});

test('Approve does not take an approval back - Unapprove is its own right (2026-10-24)', () => {
  expect(rightsOf('jobInvoices:approve')).toMatchObject({ approveInvoices: true, unapproveInvoices: false });
  expect(rightsOf('jobInvoices:unapprove')).toMatchObject({ approveInvoices: false, unapproveInvoices: true });
  expect(rightsOf('invoices:unapprove')).toMatchObject({ unapproveInvoices: true });
});
