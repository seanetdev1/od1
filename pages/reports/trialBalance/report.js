import React from 'react';
import Report from 'Components/Layouts/Reports/TrialBalance/Report';
import axiosClient from 'apis/axiosClient';
import Cookies from 'cookies';
import { handleSSRAuthError, ssrErrorProps } from 'functions/withAuthRedirect';

const report = ({ query, result }) => {
  return (
    <div className='base-page-layout'>
      <Report query={query} result={result} />
    </div>
  )
}

export default report

export async function getServerSideProps({ query, req, res }) {
  const cookies = new Cookies(req, res);
  const token = cookies.get('token');

  try {
    // The server builds the report (routes/misc/trialBalance): this sends
    // what was picked and gets back only the rows to show.
    const result = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_MISC_GET_TRIAL_BALANCE, {
      headers: {
        company: query.company,
        from: query.from,
        to: query.to,
        utcoffset: query.utcoffset ?? '',
        accountid: query.accountid,
        currency: query.currency,
        reporttype: query.reportType,
        options: query.options,
        Authorization: token,
      }
    }).then((x) => x.data);

    return {
      props: {
        result,
        query
      }
    }
  } catch (error) {
    if (error.response?.status === 401) {
      return handleSSRAuthError(error, res, cookies);
    }
    // A report the server refused - no dates, To before From - says why on
    // the page rather than as an error screen.
    if (error.response?.status === 400 && error.response.data) {
      return { props: { result: error.response.data, query } };
    }
    return ssrErrorProps(error);
  }
}
