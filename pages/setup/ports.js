import React from 'react'
import axiosClient from 'apis/axiosClient';
import PortOfDischarge from 'Components/Layouts/Setup/portOfDischarge';
import Cookies from 'cookies';
import { handleSSRAuthError, ssrErrorProps } from 'functions/withAuthRedirect';

const ports = ({ portsData, initialPage, initialSearch }) => {
  return (
    <div className='base-page-layout'>
      <PortOfDischarge portsData={portsData} initialPage={initialPage} initialSearch={initialSearch} />
    </div>
  )
}

export default ports

export async function getServerSideProps({ query, req, res }) {
  const cookies = new Cookies(req, res);
  const token = cookies.get('token');
  const pageSize = 50;
  const requestedPage = Number(query.page);
  const initialPage = Number.isNaN(requestedPage) || requestedPage < 1 ? 1 : requestedPage;
  const initialSearch = typeof query.search === 'string' ? query.search.trim() : '';

  try {
    const response = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_PORTS, {
      headers: { Authorization: token },
      params: {
        search: initialSearch || undefined,
        page: initialPage,
        limit: pageSize,
      }
    });
    const data = response.data;

    return {
      props: {
        portsData: data,
        initialPage,
        initialSearch,
      }
    }
  } catch (error) {
    if (error.response?.status === 401) {
      return handleSSRAuthError(error, res, cookies);
    }
    return ssrErrorProps(error);
  }
}
