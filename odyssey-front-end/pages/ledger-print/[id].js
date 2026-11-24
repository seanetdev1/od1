import LedgerReport from 'Components/Layouts/Reports/Ledger/LedgerReport';
import axiosClient from 'apis/axiosClient';

// Bare, session-less print view of one ledger: loaded headlessly by Puppeteer
// (see functions/pdf.renderLedgerPdf on the backend) to render the PDF the
// Ledger screen's PDF button downloads.
//
// IT RENDERS THE SAME REPORT THE SCREEN DOES, deliberately. A ledger's opening
// balance, its ex-rate handling and the accounts a foreign-currency ledger
// leaves out are all worked out in LedgerReport; rebuilding any of that here,
// or on the server, would be a second set of numbers to keep in step - and a
// customer's statement is the worst place to find they have drifted.
//
// `printOnly` drops the toolbar and the on-screen table, leaving the printable
// report visible. Puppeteer waits for `.ledger-print-root`, which that mode
// puts on the wrapper.
const LedgerPrintPage = ({ voucherData, from, to, name, company, currency, accountId, letterhead, printedBy, error, reason }) => {
  if (error) {
    /* A DISTINCT marker, deliberately not `.ledger-print-root`. Puppeteer
     * watches for both, so this fails immediately instead of waiting out the
     * selector timeout and being reported as a hang.
     *
     * IT CARRIES THE REAL REASON. This page cannot tell a rejected token from
     * any other failure - both arrive here as a thrown request - and calling
     * every one of them "invalid or expired" is how a 401 from a missing
     * PUBLIC_PATHS entry was read as a token problem and chased in the wrong
     * place. The status and message travel in `data-reason`, which the PDF
     * renderer reads back and reports. */
    return (
      <div
        className="ledger-print-error"
        data-reason={reason || 'unknown'}
        style={{ padding: 40, fontFamily: 'sans-serif' }}
      >
        This print link could not be opened.
        <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>{reason}</div>
      </div>
    );
  }

  return (
    <LedgerReport
      voucherData={voucherData}
      from={from}
      to={to}
      name={name}
      company={company}
      currency={currency}
      accountId={accountId}
      // Whose letterhead and who printed it - the server's, from the token:
      // this page has no session to find either in.
      letterhead={letterhead}
      printedBy={printedBy}
      printOnly
    />
  );
};

export default LedgerPrintPage;

export async function getServerSideProps({ params, query }) {
  try {
    // No Authorization header: this page never runs in a logged-in session. The
    // short-lived print token carries WHICH ledger to render, so the endpoint
    // takes its parameters from the token rather than from this URL - editing
    // the query string cannot reach another account's books.
    const data = await axiosClient.get(
      `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/accounts/getLedgerPrintData`,
      { headers: { printtoken: `${query.token || ''}` } },
    ).then((x) => x.data);

    return {
      props: {
        voucherData: { status: data.status, result: data.result || [] },
        // The labels the report prints in its header. These are presentation
        // only - what is actually read is fixed by the token above.
        from: query.from || '',
        to: query.to || '',
        name: query.name || '',
        company: query.company || '',
        currency: query.currency || '',
        accountId: params.id ?? null,
        letterhead: data.letterhead || null,
        printedBy: data.printedBy || '',
      },
    };
  } catch (error) {
    // Rendered as a page rather than thrown: Puppeteer would otherwise sit on a
    // Next error overlay until it timed out, and the failure would read as a
    // PDF timeout rather than as whatever actually went wrong.
    //
    // The status is what distinguishes the cases - a 401 means the request
    // never reached the token check, which is a server configuration problem
    // and not an expired link.
    const status = error?.response?.status;
    const detail = error?.response?.data?.result || error?.message || 'unknown error';
    return {
      props: {
        error: true,
        reason: status ? `HTTP ${status}: ${detail}` : String(detail),
      },
    };
  }
}
