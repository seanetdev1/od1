"use client";
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Row, Col } from 'react-bootstrap';
import AuditLog from './AuditLog';
import DashboardStats from './DashboardStats';
import AviationDashboardStats from './AviationDashboardStats';
import CustomsDashboardStats from './CustomsDashboardStats';
import { isAviationMode, isCustomsMode } from 'functions/terminology';
import ChartComp from './ChartComp';
import PendingInvoices from 'Components/Layouts/Dashboard/Home/Accounts';
import UploadBackUp from './UploadBackUp';
import Cookies from 'js-cookie';
import OllamaChat from './ollama';
import axiosClient from 'apis/axiosClient';

const Main = ({ sessionData }) => {
  const router = useRouter(); // get the router
  const username = Cookies.get('username');

  useEffect(() => {
    if (sessionData?.isLoggedIn == false) {
      router.push("/login"); // navigate using new router
    }
  }, [sessionData, router]);

  const ollama = async () => {
    const reply = await ollama();
    console.log(reply)
  } 

  const [ allow, setAllow ] = React.useState(false);

  useEffect(() => {
    if(username == 'isaadalam'){
      setAllow(true);
    }
  }, [username])

  /* WHICH WIDGETS - by the user's designation (Configuration > Dashboard
     Widgets; the user, 2026-11-23). This used to be every widget for anyone
     with the 'admin' access level and none for anyone else, read off the
     token here. The server decides now (/home/widgets), and the widgets'
     own routes refuse a designation that is not ticked, so this list only
     lays the page out. null = still asking: nothing is drawn, rather than
     widgets that then vanish. */
  const [ widgets, setWidgets ] = useState(null);
  useEffect(() => {
    let alive = true;
    axiosClient.get('/home/widgets')
      .then(({ data }) => { if (alive) setWidgets(Array.isArray(data?.result?.widgets) ? data.result.widgets : []); })
      .catch(() => { if (alive) setWidgets([]); });
    return () => { alive = false; };
  }, []);
  const shows = (key) => Boolean(widgets?.includes(key));
  const charts = ['incomeExpense', 'cashFlow'].filter(shows);
  const lists = ['pendingInvoices', 'auditLog'].filter(shows);

  return (
    <div className="base-page-layout home-styles dashboard-home-styles">
      {/* {username == 'Saad' && <VannaChat /> } */}
      {/* <OllamaChat/> */}
      {/* {username == 'Saad' && <UploadBackUp /> } */}
      {/* <UploadBackUp /> */}
      {widgets && widgets.length === 0 && (
        <div className="grey-txt" style={{ padding: '24px 4px' }}>
          Nothing is set to show on the dashboard for your designation.
        </div>
      )}
      {widgets && widgets.length > 0 && <>
        {/* An airline has no FCL/LCL and is not called Sea Net Shipping, so
            aviation gets its own counters - flights and uplift - plus the
            pending-load list. A CLEARING AGENT has neither: no sea export
            jobs at all, so every FCL/LCL/Jobs counter read a permanent zero
            against two company ids belonging to somebody else. It gets its
            own too - declarations, channel and recoverable duty.
            Everything below is accounting and applies to any install, so it
            is shared rather than duplicated.

            Resolved at render, not module load: isAviationMode() reads a
            cookie MainLayout sets after login, and at import time it may not
            be there yet. */}
        {shows('jobCounters') && (isAviationMode()
          ? <AviationDashboardStats />
          : isCustomsMode()
            ? <CustomsDashboardStats />
            : <DashboardStats />)}
        {/* A widget left out gives its width to the one beside it. */}
        {charts.length > 0 && (
          <Row className="mt-2">
            {shows('incomeExpense') && (
              <Col md={charts.length > 1 ? 6 : 12} className="mb-3">
                <div className="wh-bg-round">
                  <ChartComp type="One" />
                </div>
              </Col>
            )}
            {shows('cashFlow') && (
              <Col md={charts.length > 1 ? 6 : 12} className="mb-3">
                <div className="wh-bg-round">
                  <ChartComp type="Two" />
                </div>
              </Col>
            )}
          </Row>
        )}
        {lists.length > 0 && (
          <Row className="mt-2">
            {shows('pendingInvoices') && (
              <Col md={lists.length > 1 ? 7 : 12} className="mb-3">
                <div className="wh-bg-round" style={{ height: '100%' }}>
                  <PendingInvoices />
                </div>
              </Col>
            )}
            {shows('auditLog') && (
              <Col md={lists.length > 1 ? 5 : 12} className="mb-3">
                <AuditLog />
              </Col>
            )}
          </Row>
        )}
      </> }
    </div>
  );
};

export default Main;
