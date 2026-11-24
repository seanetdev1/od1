import React from 'react';
import { Result, Button } from 'antd';
import Router from 'next/router';

/**
 * A page whose data the server refused or failed to load - shown with the
 * server's own reason in place of the page (pages/_app.js, from the props
 * functions/withAuthRedirect ssrErrorProps makes). It used to be Next's bare
 * "500 Internal Server Error", which said nothing about why - and a refusal
 * ("You do not have access to that company") is something the user can act on.
 */
const PageLoadError = ({ status, message }) => {
  const refused = status === 403;
  return (
    <Result
      status={refused ? '403' : status === 404 ? '404' : 'error'}
      title={refused ? 'Not allowed' : 'This page could not be loaded'}
      subTitle={message}
      extra={<Button type='primary' onClick={() => Router.back()}>Go back</Button>}
    />
  );
};

export default PageLoadError;
