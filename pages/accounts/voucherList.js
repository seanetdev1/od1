import React from 'react';
import VoucherList from 'Components/Layouts/AccountsComp/Voucher/VoucherList';
import Cookies from 'cookies';
import axiosClient from 'apis/axiosClient';
import { handleSSRAuthError } from 'functions/withAuthRedirect';

const voucherList = ({ sessionData }) => {
  return (
    <VoucherList sessionData={sessionData} />
  )
}

export default voucherList

export async function getServerSideProps({ req, res }) {
  const cookies = new Cookies(req, res);
  const token = cookies.get('token');

  try {
    const sessionData = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_LOGIN_VERIFICATION, {
      headers: { "x-access-token": `${token}` }
    }).then((x) => x.data);

    /* NO VOUCHERS ARE FETCHED HERE any more.
     *
     * This used to pull every voucher in the company - 59,745 of them on a
     * clearing agent's book, with their heads - and serialise the lot into the
     * HTML so the wrapper could split it into three tabs in the browser. Each
     * tab now asks the server for its own page of its own category, so a
     * prefetch here could only ever be the first page of one of the three, and
     * the shape of it was what broke the list when paging went in.
     *
     * The session check stays: it is what redirects an expired login. */
    return {
      props: { sessionData }
    }
  } catch (error) {
    return handleSSRAuthError(error, res, cookies);
  }
}