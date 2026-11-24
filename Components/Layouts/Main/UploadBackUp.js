import React from 'react';
import Router from 'next/router';
import { Result, Button } from 'antd';

// The migration used to live here: one button that ran everything at once, with
// every individual step commented out in source so the only way to run one was
// to edit the file.
//
// It now lives in Config > Migration, where each stage can be run on its own and
// verified against the target table's row count before the next one starts. The
// step functions themselves moved to functions/migration/steps.js so both the
// full run and a single stage share exactly one implementation.
//
// This component is kept only so the old route/import does not break.
const UploadBackUp = () => (
  <Result
    status="info"
    title="The migration moved"
    subTitle="Config > Migration. Stages can be run individually and verified as they go."
    extra={
      <Button type="primary" onClick={() => Router.push('/config?tab=migration')}>
        Open Config &gt; Migration
      </Button>
    }
  />
);

export default UploadBackUp;
