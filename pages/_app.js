import React,{ useEffect, useState } from 'react';
import '../styles/main.scss';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'antd/dist/antd.css';
import 'ag-grid-community/styles/ag-grid.css'; // Core grid CSS, always needed
import 'ag-grid-community/styles/ag-theme-alpine.css'; // Optional theme CSS
import MainLayout from 'Components/Shared/MainLayout';
import Loader from 'Components/Shared/Loader';
import PageTitle from 'Components/Shared/PageTitle';
import PageLoadError from 'Components/Shared/PageLoadError';
import Router, { useRouter  } from 'next/router';
import { store } from 'redux/store';
import { Provider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
// The one app-wide client, in its own module so non-component code (the job
// screen's charge refresh) can reach the same instance - see apis/queryClient.
import queryClient from 'apis/queryClient';
import '../styles/globals.css';
import '../styles/ageingReport.css';
// Date boxes take 15/11/2026, 15-11-26... as well as their display format.
import 'functions/datePickerTyping';

function MyApp({ Component, pageProps:{ session, ssrError, ...pageProps }, }) {
  // The server refused or failed this page's data - its reason, in place of
  // the page (functions/withAuthRedirect ssrErrorProps).
  const page = ssrError ? <PageLoadError {...ssrError} /> : <Component {...pageProps} />;

  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handleRouteChangeStart = () => setLoading(true);
    const handleRouteChangeEnd = () => setLoading(false);

    Router.events.on('routeChangeStart', handleRouteChangeStart);
    Router.events.on('routeChangeComplete', handleRouteChangeEnd);
    Router.events.on('routeChangeError', handleRouteChangeEnd);

    return () => {
      Router.events.off('routeChangeStart', handleRouteChangeStart);
      Router.events.off('routeChangeComplete', handleRouteChangeEnd);
      Router.events.off('routeChangeError', handleRouteChangeEnd);
    };
  }, []);

  // Bare pages render with no sidebar/session chrome: /login (pre-auth) and
  // the two print views loaded headlessly by Puppeteer with no session - the
  // invoice and the ledger. The ledger's was missing: its PDF came out inside
  // the whole app (sidebar, header, Logout) with every request the layout
  // makes refused for want of a login (2026-11-13).
  const PRINT_PAGES = ['/invoice-print/[id]', '/ledger-print/[id]'];
  const BARE_PAGES = ['/login', ...PRINT_PAGES];
  const isBarePage = BARE_PAGES.includes(router.pathname);

  // Everywhere EXCEPT the print page. That one is loaded by a headless browser
  // to render a PDF (functions/pdf.js), where the document title is not a tab
  // name but something Chromium can print into the page header - so it is left
  // alone rather than stamping an install id across every emailed invoice.
  // /login keeps it: /health is public, and naming the tab before someone signs
  // in is when it is most useful.
  const showTitle = !PRINT_PAGES.includes(router.pathname);

  return (
    <>
      {showTitle && <PageTitle />}
      {
      !isBarePage &&
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <MainLayout>
              { loading && <Loader/> }
              { !loading && page }
            </MainLayout>
          </QueryClientProvider>
        </Provider>
      }
      {/* The store and query client without the layout: the ledger report
          reads redux (useDispatch) even when it is only being printed. */}
      {isBarePage &&
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            {page}
          </QueryClientProvider>
        </Provider>
      }
    </>
  )
}

export default MyApp;
