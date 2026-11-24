import React from 'react';
import InvoiceAndBills from 'Components/Layouts/AccountsComp/InvoiceAndBills';
import axiosClient from 'apis/axiosClient';
import Cookies from 'cookies';
import { handleSSRAuthError } from 'functions/withAuthRedirect';

const invoiceAndBills = ({invoiceData}) => {
  return (
    <InvoiceAndBills invoiceData={invoiceData} />
  )
}
export default invoiceAndBills

export async function getServerSideProps({req,res}){
  const cookies = new Cookies(req, res)
  const token = cookies.get('token');
  try{
    // The FIRST PAGE only. This used to fetch every Job Invoice in the book so
    // the screen could filter and slice it in the browser; both are the
    // server's job now. `limit` matches PAGE_SIZE in the component, so the page
    // rendered here is the same size as every page fetched after it - and the
    // `count` that comes back is what the pager is built from.
    const invoiceData = await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_FILTERED_INVOICES,{
      headers:{ Authorization: token, "type": "Job Invoice", companyid: `${cookies.get('companyId')}` },
      params:{ page: 1, limit: 20 }
    }).then((x)=>x.data);
  
    return{
        props: { invoiceData:invoiceData }
    }
  }catch(error){
    return handleSSRAuthError(error, res, cookies);
  }
}