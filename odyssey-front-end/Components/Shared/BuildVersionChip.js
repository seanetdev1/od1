import React, { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { getInstallInfo } from 'functions/installInfo';
import { versionChip } from 'functions/appVersion';

// Shows which release this installation is running.
//
// Point of it: when a customer reports a bug, INSTALL_ID tells you WHICH
// install, but nothing told you which CODE was on it. This reads /health, which
// is public (answerable before login) and carries the server's release, the
// install id, and whether the schema sync is doing anything at boot.
//
// The release, not package.json's 1.0.0 - which every install showed, whatever
// was deployed, until 2026-11-15. And the screens' own release beside it
// (functions/appVersion): amber when the two differ, because then one of the
// two images was not updated.
const BuildVersionChip = () => {
  const [info, setInfo] = useState(null);

  // The SAME request the browser tab's name comes from - see
  // functions/installInfo. Two components wanting the same fact off one public
  // endpoint should not be two requests on every page load.
  useEffect(() => {
    let cancelled = false;
    getInstallInfo().then((x) => { if (!cancelled) setInfo(x); });
    return () => { cancelled = true; };
  }, []);

  const chip = info ? versionChip(info.version) : null;
  if (!chip) return null;

  const tip = [
    ...chip.lines,
    info.installId ? `Install ${info.installId}` : null,
    `Database ${info.database}`,
    info.schemaError ? `Schema: ${info.schemaError}` : null,
  ].filter(Boolean).join('\n');

  const tone = chip.mismatch ? ' is-mismatch' : info.schemaError ? ' is-error' : '';
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>}>
      <span className={`hdr-version-chip${tone}`} data-testid='version-chip'>
        {chip.mismatch && <WarningOutlined />}
        {chip.text}
      </span>
    </Tooltip>
  );
};

export default BuildVersionChip;
