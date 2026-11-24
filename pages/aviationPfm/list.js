import React from 'react';
import { useSelector } from 'react-redux';
import List from 'Components/Layouts/AviationPfm/List';

const AviationPfmListPage = () => {
  const companyId = useSelector((state) => state.company.value);
  return (
    <div className='base-page-layout'>
      <List companyId={companyId} />
    </div>
  );
};

export default AviationPfmListPage;
