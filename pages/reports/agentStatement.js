import React from 'react';
import AgentStatement from 'Components/Layouts/Reports/AgentStatement';

// In the page frame every report sits in - white, padded, scrolling inside
// itself.
const AgentStatementPage = () => (
  <div className='base-page-layout'>
    <AgentStatement />
  </div>
);

export default AgentStatementPage;
