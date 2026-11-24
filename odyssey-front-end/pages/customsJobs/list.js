import React from 'react';
import { useSelector } from 'react-redux';
import List from 'Components/Layouts/CustomsJobs/List';

const CustomsJobListPage = () => {
  const companyId = useSelector((state) => state.company.value);
  return (
    <div className='base-page-layout'>
      <List companyId={companyId} />
    </div>
  );
};

export default CustomsJobListPage;
