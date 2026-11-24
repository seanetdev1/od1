import React from 'react';
import axiosClient from 'apis/axiosClient';
import LedgerReport from 'Components/Layouts/Reports/Ledger/LedgerReport';
import Cookies from 'cookies';
import { handleSSRAuthError, ssrErrorProps } from 'functions/withAuthRedirect';

const paymentReceipt = ({ voucherData, from, to, name, company, currency, accountId }) => {
  return <LedgerReport voucherData={voucherData} from={from} to={to} name={name} company={company} currency={currency} accountId={accountId} />
}
export default paymentReceipt

export async function getServerSideProps({ query, req, res }) {
  const cookies = new Cookies(req, res);
  const token = cookies.get('token');

  try {
    const voucherData = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_VOUCEHR_LEDGER_BY_DATE, {
      headers: {
        id: query.id,
        from: query.from,
        to: query.to,
        currency: query.currency,
        company: query.company,
        Authorization: token,
      }
    }).then((x) => x.data);

    return {
      props: {
        voucherData: voucherData,
        from: query.from,
        to: query.to,
        name: query.name,
        company: query.company,
        currency: query.currency,
        // Which account this ledger IS. The page has always had it in the URL;
        // the report needs it too, to ask the server for a PDF of itself.
        accountId: query.id ?? null,
      }
    }
  } catch (error) {
    if (error.response?.status === 401) {
      return handleSSRAuthError(error, res, cookies);
    }
    return ssrErrorProps(error);
  }
}