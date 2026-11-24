import React from 'react';
import PaymentsReceipt from 'Components/Layouts/AccountsComp/PaymentsReceipt';
import axiosClient from 'apis/axiosClient';
import Cookies from 'cookies';
import { handleSSRAuthError } from 'functions/withAuthRedirect';


const paymentReceipt = ({ id, voucherData, query }) => {
  return <PaymentsReceipt id={id} voucherData={voucherData} q={query} />
}
export default paymentReceipt;

export async function getServerSideProps(context) {
  const { params, query, req, res } = context;
  const cookies = new Cookies(req, res);
  const token = cookies.get('token');

  let voucherData = {};

  // No cache. It was one object for the whole server - every user's request -
  // kept until a restart, so an edited voucher went on loading as it was.
  if (params.id !== "new" && params.id !== "undefined") {
    try {
      const response = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_VOUCHER_BY_ID_ADVANCED, {
        headers: {
          id: `${params.id}`,
          Authorization: token,
        }
      });
      voucherData = response.data.result;

      if (!voucherData?.id) {
        return { notFound: true };
      }

    } catch (error) {
      if (error.response?.status === 401) {
        return handleSSRAuthError(error, res, cookies);
      }
      console.error('Error fetching data:', error);
      return { notFound: true };
    }
  }

  return {
    props: {
      voucherData,
      id: params.id,
      query: query
    }
  };
}