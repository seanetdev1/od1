import React from 'react';
import { useSelector } from 'react-redux';
import CreateOrEdit from 'Components/Layouts/CustomsJobs/CreateOrEdit';

const CustomsJobPage = ({ id }) => {
  const companyId = useSelector((state) => state.company.value);
  return (
    <div className='base-page-layout'>
      <CreateOrEdit id={id} companyId={companyId} />
    </div>
  );
};

export default CustomsJobPage;

export async function getServerSideProps(context) {
  return { props: { id: context.params.id } };
}
