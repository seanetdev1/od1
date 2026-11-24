/**
 * The freight charge sheet refuses a document whose ticked lines include one
 * already on an invoice - functions/alreadyInvoiced. Invoicing it again used to
 * move it off its invoice onto the new one.
 */
import { alreadyInvoiced, alreadyInvoicedMessage } from 'functions/alreadyInvoiced';

describe('ticked charges already on an invoice', () => {
  const ticked = [
    { id: 1, invoice_id: 'SNS-JI-10/27', InvoiceId: 10 },
    { id: 2, invoice_id: null, InvoiceId: null },
    { id: 3, invoice_id: 'SNS-JI-10/27', InvoiceId: 10 },
    { id: 4, invoice_id: 'SNS-JB-4/27', InvoiceId: 4 },
  ];

  test('counts them and names each invoice once', () => {
    expect(alreadyInvoiced(ticked)).toEqual({ count: 3, numbers: ['SNS-JI-10/27', 'SNS-JB-4/27'] });
  });

  test('a line linked by id alone still counts', () => {
    expect(alreadyInvoiced([{ id: 9, InvoiceId: 77 }]).count).toBe(1);
  });

  test('says so, or says nothing when there is nothing to refuse', () => {
    expect(alreadyInvoicedMessage(ticked)).toBe(
      '3 of the ticked charges are already invoiced (SNS-JI-10/27, SNS-JB-4/27). Untick them, or take them off that invoice first.'
    );
    expect(alreadyInvoicedMessage([ticked[0]])).toMatch(/^1 of the ticked charges is already invoiced/);
    expect(alreadyInvoicedMessage([ticked[1]])).toBeNull();
    expect(alreadyInvoicedMessage(undefined)).toBeNull();
  });
});
