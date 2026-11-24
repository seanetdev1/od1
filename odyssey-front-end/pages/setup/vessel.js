import React from 'react';
import Vessel from 'Components/Layouts/Setup/Vessel';
import axiosClient from 'apis/axiosClient';
import Cookies from 'cookies';
import { handleSSRAuthError, ssrErrorProps } from 'functions/withAuthRedirect';

// The vessels come a page at a time from GET /vessel/list (the screen asks).
// Every vessel used to be loaded here, with the page, before it could show.
const vessel = ({ sessionData }) => {
  return (
    <Vessel sessionData={sessionData} />
  )
}
export default vessel

export async function getServerSideProps({ req, res }) {
  const cookies = new Cookies(req, res);
  const token = cookies.get('token');

  try {
    const sessionRequest = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_LOGIN_VERIFICATION, {
      headers: { "x-access-token": `${token}` }
    }).then((x) => x.data);

    return {
      props: { sessionData: sessionRequest }
    }
  } catch (error) {
    if (error.response?.status === 401) {
      return handleSSRAuthError(error, res, cookies);
    }
    return ssrErrorProps(error);
  }
}