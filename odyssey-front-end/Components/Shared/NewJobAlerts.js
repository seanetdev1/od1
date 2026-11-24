import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { addNotification } from 'redux/notifications/notificationSlice';

// NEW JOB ALERTS - "New job created: TP-123/27 by Admin" (the user's request,
// 2026-11-23). Once a minute this asks the server for jobs made since it last
// asked; the designations that get them are picked in Configuration > New Job
// Alerts, and the server decides (functions/newJobAlerts) - it answers
// subscribed: false to everyone else, and this then just keeps asking, so a
// designation picked later starts within the minute.
//
// The first answer only sets where to start, so signing in does not replay
// the day's jobs. A hidden browser tab does not ask: its place is kept, and
// it catches up when looked at again - so three open tabs do not show every
// job three times.
//
// A simple notification: the toast, and a line on the bell's Recent tab with
// the errors and warnings (the user, 2026-11-23 - not the Alerts tab, which is
// the standing lists). Blue, so openNotification does not keep it itself;
// recorded below, one line per job even when the toasts ran them together.
// Up longer than an ordinary toast, as it arrives when nobody did anything to
// expect it.
export const POLL_MS = 60 * 1000;
const SHOWN_EACH = 4;      // more than this at once: the rest in one toast
const DURATION_S = 10;

export const alertText = (job) =>
  `New job created: ${job.jobNo}${job.createdBy ? ` by ${job.createdBy}` : ''}`;

export function showNewJobs(jobs) {
  const each = jobs.length > SHOWN_EACH ? jobs.slice(0, SHOWN_EACH - 1) : jobs;
  each.forEach((job) => openNotification(alertText(job), '', 'blue', DURATION_S));
  const rest = jobs.slice(each.length);
  if (rest.length) {
    openNotification(`${rest.length} more new jobs created`, rest.map((j) => j.jobNo).join(', '), 'blue', DURATION_S);
  }
}

const toRecent = (job) => ({
  id: `${job.kind || 'job'}-${job.id ?? job.jobNo}-${Date.now()}`,
  title: alertText(job),
  message: '',
  color: '#1890ff',
  time: new Date().toISOString(),
});

const NewJobAlerts = () => {
  const dispatch = useDispatch();
  const cursor = useRef(null); // null = not started (or not subscribed)

  useEffect(() => {
    let alive = true;
    let busy = false;
    const check = async () => {
      if (busy) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const { data } = await axiosClient.get('/notifications/newJobs', { params: cursor.current || {} });
        if (!alive || data?.status !== 'success') return;
        const r = data.result || {};
        if (!r.subscribed) { cursor.current = null; return; }
        const first = cursor.current === null;
        cursor.current = r.cursor || null;
        if (!first && Array.isArray(r.jobs) && r.jobs.length) {
          showNewJobs(r.jobs);
          // Oldest first, so the newest ends up on top of the tab.
          r.jobs.forEach((job) => dispatch(addNotification(toRecent(job))));
        }
      } catch (_) {
        // Signed out, or the server is away: try again next minute.
      } finally {
        busy = false;
      }
    };
    check();
    const id = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [dispatch]);

  return null;
};

export default NewJobAlerts;
