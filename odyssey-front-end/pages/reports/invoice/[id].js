import InvoiceCharges from 'Components/Shared/InvoiceCharges';
import Router from 'next/router';
import { useSelector, useDispatch } from 'react-redux';
import { removeTabNew } from 'redux/tabs/tabSlice';
import axiosClient from 'apis/axiosClient';
import Cookies from 'cookies';
import { handleSSRAuthError, ssrErrorProps } from 'functions/withAuthRedirect';

const InvoiceDetails = ({ invoiceData }) => {
  const companyId = useSelector((state) => state.company.value);
  const dispatch = useDispatch();

  /* This page IS the invoice - once it is deleted the tab is showing a record
   * that no longer exists, and leaving it open means the next click on it
   * fetches a 404. So the tab closes itself, and MainLayout moves the user to
   * the neighbouring one exactly as if they had closed it by its own X. */
  const closeMyTab = () => dispatch(removeTabNew('3-17'));

  /* The invoice again, after "+ Charge" adds a line: this page's data comes
   * from the server (getServerSideProps), so it is asked for again - without
   * it, the line was saved and the page crashed ("reload is not a function")
   * instead of showing it. InvoiceCharges takes in the fresh data. */
  const reload = () => Router.replace(Router.asPath, undefined, { scroll: false });

  return (
    <div className='base-page-layout'>
      {/* ownsPage: this route IS the invoice, so its actions belong in the
          app's toolbar. The same component inside a job's Invoice tab, or in
          the modal on the Invoice/Bills list, claims nothing. */}
      <InvoiceCharges data={invoiceData} companyId={companyId} onDeleted={closeMyTab} reload={reload} ownsPage />
    </div>
  );
};

export default InvoiceDetails;

export async function getServerSideProps({ params, req, res }) {
  const cookies = new Cookies(req, res);
  const token = cookies.get('token');

  try {
    const invoiceData = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_INVOICE_BY_ID, {
      headers: {
        invoiceid: `${params.id}`,
        Authorization: token,
      }
    }).then((x) => x.data.result);

    return {
      props: {
        invoiceData: invoiceData
      }
    }
  } catch (error) {
    if (error.response?.status === 401) {
      return handleSSRAuthError(error, res, cookies);
    }
    return ssrErrorProps(error);
  }
}