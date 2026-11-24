import React from 'react';
import DesignationGrid from './DesignationGrid';
import BellAlertDays from './BellAlertDays';

// The bell's alert lists - Critical, Job Charges, Invoices Due, Job Status:
// the days each one checks against, and which designation sees which (the
// user's requests, 2026-11-23). Until an install saves them: 90 / 7 / 7 / 45 /
// 7 days, and CEO, CFO and admin see all four lists and nobody else any. The
// lists and both settings are the backend's functions/bellAlerts; a list not
// ticked for a designation is not even worked out for it.
const BellAlerts = () => (
  <>
    <BellAlertDays />
    <div style={{ marginTop: 16 }}>
      <DesignationGrid
        endpoint='/settings/bellAlertLists'
        title='Who Sees Which List'
        hint={'Which designation sees which list on the bell\'s Alerts tab. A user sees the lists their designation is '
          + 'ticked for, and only records they have the right to see, in their own companies. A designation with no list '
          + 'ticked sees only the Recent tab. Seanet\'s System login sees all.'}
        rowHeader='Alert list'
        what='bell alerts'
        defaultTip='CEO, CFO and Admin see every list, nobody else any. Save to keep it.'
      />
    </div>
  </>
);

export default BellAlerts;
