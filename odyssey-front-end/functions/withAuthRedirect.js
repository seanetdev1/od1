// functions/withAuthRedirect.js
export function handleSSRAuthError(error, res, cookies) {
  if (error.response?.status === 401) {
    cookies.set('token');
    cookies.set('username');
    cookies.set('companyId');
    cookies.set('designation');
    cookies.set('loginId');

    return {
      redirect: {
        destination: '/login',
        permanent: false,
      },
    };
  }
  throw error;
}

/**
 * A backend refusal or failure while a page loads its data on the server -
 * as props, so the page shows WHY (Components/Shared/PageLoadError, from
 * _app) rather than Next's bare "500 Internal Server Error".
 *
 * The user's report, 2026-10-24: Job Balancing's Go crashed the page with a
 * 500 - the backend had answered 403, "You can only see the companies you work
 * in". Every page that loads on the server used to rethrow anything but a 401.
 */
export function ssrErrorProps(error) {
  const status = error?.response?.status || null;
  const data = error?.response?.data;
  const message = (typeof data?.result === 'string' && data.result)
    || (typeof data?.message === 'string' && data.message)
    || (status ? `The server answered ${status}.` : 'The server could not be reached - is it running?');
  return { props: { ssrError: { status, message } } };
}
