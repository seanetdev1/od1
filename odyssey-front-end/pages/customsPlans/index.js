import React from 'react';
import { useSelector } from 'react-redux';
import ProgramBook from 'Components/Layouts/CustomsPlans/ProgramBook';

const ProgramBookPage = () => {
  const companyId = useSelector((state) => state.company.value);
  return (
    <div className='base-page-layout'>
      <ProgramBook companyId={companyId} />
    </div>
  );
};

export default ProgramBookPage;
