import React from 'react';
import { Empty } from 'antd';

/* Shown in place of a job list when no company is picked in the header - see
   functions/selectedCompany. An empty list on its own looks like a company
   with no jobs; this says what is actually wrong. */
const NoCompanySelected = ({ what = 'jobs' }) => (
  <div className='base-page-layout' data-testid='no-company-selected'>
    <Empty
      style={{ padding: '48px 0' }}
      description={(
        <span>
          <b>No company selected.</b><br />
          Pick your company at the top of the screen to see its {what}.
        </span>
      )}
    />
  </div>
);

export default NoCompanySelected;
