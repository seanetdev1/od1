import InvoicePrint from 'Components/Shared/InvoicePrint';
import { calculateTotal } from 'Components/Shared/invoicePrintDefaults';
import { formatBankAccount, defaultBankAccount } from 'functions/companyBranding';
import axiosClient from 'apis/axiosClient';
import { hasNote } from 'functions/invoiceNote';
import { invoiceTemplateFields } from 'functions/invoiceTemplateFields';

// Bare, unauthenticated print view for a single invoice: loaded headlessly by
// Puppeteer (see functions/pdf.js on the backend) to render the emailed PDF,
// gated by a short-lived, single-invoice print token instead of a login
// session (this page never runs inside a real user's browser session).
//
// ?fields=1 - for an invoice with a Word template (Configuration > Printing
// Templates): the values the template prints, as JSON, worked out by the same
// functions as the screen's Print. The server fills the template with them.
const InvoicePrintPage = ({ invoice, records, company, error, fieldsMode }) => {
  if (error || !invoice) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>This print link is invalid or has expired.</div>;
  }

  if (fieldsMode) {
    const fields = invoiceTemplateFields({
      invoice,
      records,
      company,
      bankAccount: defaultBankAccount(company?.BankAccounts, invoice),
      // As the built-in emailed copy below: the note only when there is one.
      options: { hideNote: !hasNote(invoice) },
    });
    return (
      <script id='invoice-template-fields' type='application/json'
        dangerouslySetInnerHTML={{ __html: JSON.stringify(fields).replace(/</g, '\\u003c') }} />
    );
  }

  // The invoice's own company - used only if the server sent none. It was
  // "1" or else "2", which on a migrated install is not even the same company.
  const compLogo = invoice.companyId != null ? String(invoice.companyId) : null;

  return (
    <InvoicePrint
      logo={false}
      compLogo={compLogo}
      company={company}
      records={records}
      // The company's client or agent default for this kind of document, as
      // the invoice screen picks it - it took whichever account came first.
      bankAccount={defaultBankAccount(company?.BankAccounts, invoice)}
      invoice={invoice}
      note={!hasNote(invoice)}
      reference={false}
      calculateTotal={calculateTotal}
      systemGenerated={true}
    />
  );
};

export default InvoicePrintPage;

export async function getServerSideProps({ params, query }) {
  try {
    const result = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/invoice/getPrintData`, {
      headers: {
        invoiceid: `${params.id}`,
        printtoken: `${query.token || ''}`,
      }
    }).then((x) => x.data.result);

    return {
      props: {
        invoice: result.resultOne,
        records: result.resultOne?.Charge_Heads || [],
        // Letterhead + bank accounts must come from the server here: this page
        // is rendered headlessly with no login and no redux store, so it can't
        // read them the way the interactive invoice screen does.
        // JSON.parse(JSON.stringify(...)) because Next refuses to serialize
        // Sequelize instances / Date objects into props.
        company: result.company ? JSON.parse(JSON.stringify(result.company)) : null,
        fieldsMode: query.fields === '1',
      }
    };
  } catch (error) {
    return { props: { error: true } };
  }
}
