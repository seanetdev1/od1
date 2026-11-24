import React, { useEffect, useState } from "react";
import Cookies from "js-cookie";
import moment from "moment";
import Router from 'next/router';
import { useDispatch } from "react-redux";
import { incrementTab } from 'redux/tabs/tabSlice';
import Notifications from "./Notifications";
import Notes from "./Notes";
import Tasks from "./Tasks";
import { Tabs } from 'antd';
import axiosClient from 'apis/axiosClient';

  const Home = ({ sessionData }) => {

  const access = Cookies.get('access');
  const dispatch = useDispatch();

  // Whether this user gets a task list at all.
  //
  // CEO, CFO and admin do not - they manage tasks rather than being assigned
  // them, and a permanently empty tab is just noise. The decision is made by
  // the API (/tasks/dashboard returns show:false) rather than read from the
  // designation cookie: a cookie is client-side and editable, and the same
  // rule then lives in one place instead of two.
  const [showTasks, setShowTasks] = useState(false);

  // Unread count on the tab label. Without it the only sign of a new task was
  // a row inside a panel the user had to open first - which is not an
  // indication, it is a place to go looking.
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    axiosClient.get('/tasks/dashboard')
      .then(({ data }) => { if (!cancelled) setShowTasks(Boolean(data?.result?.show)); })
      .catch(() => { if (!cancelled) setShowTasks(false); });
    axiosClient.get('/notifications/unreadCount')
      .then(({ data }) => { if (!cancelled) setUnread(Number(data?.result?.count) || 0); })
      .catch(() => { if (!cancelled) setUnread(0); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if(sessionData.isLoggedIn==false){
      Router.push('/login')
    }
  }, [sessionData]);

  const onChange = (key) => {
    console.log(key);
  };

  const items = [
    // Notifications for everyone, not only users with "accounts" access.
    //
    // This tab used to swap to a Notes panel for anyone without that access
    // level, so an ordinary employee had no way to see any notification -
    // including being assigned a task, which is the whole point of telling
    // them. The feed is filtered server-side to their own notifications plus
    // broadcasts, so there is nothing here to hide by access level.
    {
      key: '1',
      label: unread > 0 ? `Notifications (${unread})` : 'Notifications',
      children: <Notifications dispatch={dispatch} incrementTab={incrementTab} Router={Router} moment={moment} />,
    },
    // Notes kept as its own tab rather than removed - it was the only thing
    // non-accounts users saw here and people were using it.
    {
      key: '3',
      label: 'Notes',
      children: <Notes dispatch={dispatch} incrementTab={incrementTab} Router={Router} moment={moment} />,
    },
    // Only added when the API says this user should see one.
    ...(showTasks ? [{
      key: '2',
      label: 'My Tasks',
      children: <Tasks/>,
    }] : []),
  ];

  return (
  <div className="base-page-layout" >
    <Tabs defaultActiveKey="1" items={items} onChange={onChange} />
  </div>
  )};

export default React.memo(Home);
