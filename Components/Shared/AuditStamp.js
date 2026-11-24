import React from 'react';
import { Tooltip } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { auditStamps, stampText } from 'functions/auditStamp';

/**
 * Who made a record and who last changed it (functions/auditStamp).
 *
 *   <AuditStamp record={job} />           one line, for a page's header
 *   <AuditStamp record={job} stacked />   a line each, for a narrow column
 *   <AuditTip record={charge} />          an icon with both in its tooltip,
 *                                         for a grid row
 *
 * Shows nothing for a record with no stamp and no fallback.
 */
export default function AuditStamp({ record, fallback, stacked = false, className = '', style }) {
  const { created, edited } = auditStamps(record, fallback);
  if (!created && !edited) return null;
  const lines = [stampText('Created', created), stampText('Edited', edited)].filter(Boolean);
  return (
    <div className={`grey-txt ${className}`} style={{ fontSize: 11, ...style }} data-testid='audit-stamp'>
      {stacked
        ? lines.map((l) => <div key={l}>{l}</div>)
        : lines.join('  ·  ')}
    </div>
  );
}

export function AuditTip({ record }) {
  const { created, edited } = auditStamps(record);
  if (!created && !edited) return null;
  const lines = [stampText('Created', created), stampText('Edited', edited)].filter(Boolean);
  return (
    <Tooltip title={<>{lines.map((l) => <div key={l}>{l}</div>)}</>}>
      <HistoryOutlined className='grey-txt' style={{ cursor: 'default' }} aria-label={lines.join('. ')} />
    </Tooltip>
  );
}
