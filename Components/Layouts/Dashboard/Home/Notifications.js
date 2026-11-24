import axiosClient from 'apis/axiosClient';
import React, { useEffect, useState } from 'react'
import { Spinner } from 'react-bootstrap';

/**
 * The signed-in user's notifications.
 *
 * Three things were wrong here and all of them hid task assignments:
 *
 *  - the panel was only rendered for users with "accounts" access; everyone
 *    else got the Notes panel instead, so an ordinary employee could not see
 *    any notification at all, including being assigned work;
 *
 *  - clicking one always navigated to /seJob/<recordId>, whatever the
 *    notification was about. A task notification carries a task id, so it
 *    opened a sea job that does not exist;
 *
 *  - marking read sent { subType }, and the server updated every row with that
 *    subType - so opening one assignment marked every assignment read.
 *
 * The feed itself is filtered server-side to this user's own notifications plus
 * broadcasts, so there is nothing here that needs hiding by access level.
 */
const Notifications = ({dispatch, incrementTab, Router, moment}) => {

  const [notifications, setNotifications] = useState([]);
  const [load, setLoad] = useState(true);

  const fetch = async () => {
    try {
      const { data } = await axiosClient.get('/notifications/getAllNotifications');
      setNotifications(data.result || []);
    } catch (e) {
      // A failed fetch should show an empty panel, not a spinner forever.
      setNotifications([]);
    } finally {
      setLoad(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  /** Where a notification points, by what it is about. */
  const open = async (x) => {
    try {
      // By id: marking one read must not mark the rest read too.
      await axiosClient.post('/notifications/markRead', { id: x.id });
    } catch (_) { /* navigation matters more than the read flag */ }

    setNotifications((list) => list.map((n) => (n.id === x.id ? { ...n, opened: '1' } : n)));

    if (x.type === 'Task') {
      dispatch(incrementTab({ label: 'Task List', key: '6-3' }));
      Router.push('/tasks/list');
      return;
    }

    dispatch(incrementTab({ label: 'SE JOB', key: '4-3', id: x.recordId }));
    Router.push(`/seJob/${x.recordId}`);
  };

  const unread = notifications.filter((x) => String(x.opened) !== '1').length;

  return (
  <div className="notificationSide">
    <h5>Notifications {unread > 0 && <span className="badge bg-danger">{unread}</span>}</h5>
    {load && <div style={{display:'flex', flex:1, justifyContent:'center', alignContent:'center', alignItems:'center', height:'70%'}}><Spinner/></div>}
    {!load && notifications.length === 0 &&
      <div className="fs-13 grey-txt p-3">Nothing new.</div>}
    {!load &&
    <>
      {notifications.map((x, i) => {
        return (
          <div key={x.id || i} className="notifications"
            style={String(x.opened) !== '1'
              ? {backgroundColor:'rgb(181, 227, 169)'}
              : {backgroundColor:'rgba(255, 255, 255, 0.1)'}}
            onClick={()=>open(x)}
          >
            <div className="fs-15 fw-6">
              {x.notification}
              {/* Notifications raised by the deadline sweep have no author -
                  printing "by " with nothing after it reads like a bug. */}
              {x.createdBy?.name ? ` by ${x.createdBy.name}` : ''}
            </div>
            <div className="fs-13">{(moment(x.createdAt).fromNow())}; {moment(x.createdAt).format("YYYY-MMM-DD")}</div>
          </div>
        )})
      }
    </>
    }
  </div>
)}

export default Notifications
