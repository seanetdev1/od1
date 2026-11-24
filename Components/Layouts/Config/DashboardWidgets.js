import React from 'react';
import DesignationGrid from './DesignationGrid';

// Which designation sees which widget on the home page (the user's request,
// 2026-11-23). Per designation only; access levels play no part. Until an
// install saves this, CEO, CFO and admin see all five and nobody else sees
// any. The rule, and the routes that refuse an unticked designation, are the
// backend's functions/dashboardWidgets - this screen only ticks.
const DashboardWidgets = () => (
  <DesignationGrid
    endpoint='/settings/dashboardWidgets'
    title='Dashboard Widgets'
    hint={'Which designation sees which widget on the home page. A user sees what their designation is ticked '
      + 'for, whatever their access levels; a user with no designation sees none. Seanet\'s System login sees all.'}
    rowHeader='Widget'
    what='dashboard widgets'
    defaultTip='CEO, CFO and Admin see every widget, nobody else any. Save to keep it.'
  />
);

export default DashboardWidgets;
