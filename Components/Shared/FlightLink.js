import React from 'react';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';

/**
 * A flight number that opens its flight.
 *
 * WHY IT IS SHARED. Opening an aviation job is three facts - the URL, the tab
 * key '10-2', and the fact that the tab's label is the JOB number while the
 * thing clicked is the FLIGHT number - and every report that wants a way into
 * a flight has to know all three. Stated once here rather than copied into
 * each report, where the copies drift: a report that registers a tab without
 * an id sends MainLayout's setKey() to /aviationJobs/undefined, and one that
 * skips the tab altogether leaves the user on a page the tab strip does not
 * know is open.
 *
 * A REAL <a href>, not a div with an onClick. Ctrl/middle-click opens the
 * flight in a browser tab, the status bar shows where the link goes, and the
 * row still reads as text to anything that copies it. The ordinary click is
 * intercepted so it routes in-app and registers the tab; a modified click is
 * left to the browser, which is the whole point of having the href.
 *
 * NO id, NO LINK. Rows are built server-side and one without an id would
 * otherwise render a link to /aviationJobs/undefined; plain text is the honest
 * fallback, and nothing else about the cell changes.
 */
const FlightLink = ({ id, jobNo, label, className, children }) => {
  const dispatchTab = useDispatch();
  const text = children ?? label;

  if (!id) return <>{text}</>;

  const open = (e) => {
    // Let the browser have the clicks that mean "somewhere else": a new tab,
    // a new window, a download. Only the plain left click is ours.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    dispatchTab(incrementTab({ label: jobNo || label || 'Aviation Job', key: '10-2', id }));
    Router.push(`/aviationJobs/${id}`);
  };

  return (
    <a href={`/aviationJobs/${id}`}
      className={['flight-link', className].filter(Boolean).join(' ')}
      title={jobNo ? `Open flight ${jobNo}` : 'Open this flight'}
      onClick={open}>
      {text}
    </a>
  );
};

export default FlightLink;
