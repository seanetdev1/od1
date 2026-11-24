import React from 'react';
import VatDetail from 'Components/Layouts/Reports/VatDetail';

// In the page frame every report sits in - white, padded, scrolling inside
// itself. Without it the report ran edge to edge and past it.
const VatDetailPage = () => (
  <div className='base-page-layout'>
    <VatDetail />
  </div>
);

export default VatDetailPage;
