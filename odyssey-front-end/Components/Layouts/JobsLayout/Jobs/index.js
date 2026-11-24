import React, { useEffect, useReducer } from 'react';
import { recordsReducer, initialState } from './states';
import { getJobValues, getJobById } from 'apis/jobs';
import { useQuery } from '@tanstack/react-query';
import CreateOrEdit from './CreateOrEdit';
import { useSelector } from 'react-redux';
import Cookies from "js-cookie";

// A job's saved exchange rate, or the screen's default when it has none.
export const jobExRate = (job, fallback) => {
  const n = parseFloat(job?.exRate);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const SeJob = ({id, type}) => {

  const { data, isSuccess:dataSuccess, isLoading:dataLoading } = useQuery({queryKey: ['values'], queryFn: getJobValues});
  const { data:newdata, isSuccess, isError, error, refetch, isLoading } = useQuery({
    queryKey:["jobData", {id, type}], queryFn: () => getJobById({id, type}),
  });

  const companyId = useSelector((state) => state.company.value);
  const [ state, dispatch ] = useReducer(recordsReducer, initialState);
  useEffect(() => {
    getData();
  }, [dataSuccess, isSuccess])
  
  const getData = async() => {
    if(dataSuccess && newdata) {
      // console.log("index: ",data.result)
      // console.log("index: ",newdata)
      // data?.result?.res?.forEach((x)=>{
      //   data.result.vendor.sLine.push(x)
      // })
      let temp
      if(dataSuccess){
        temp = {
          ...newdata.result,
        }
      }
      // console.log("Temp", temp)
      dispatch({type:'set',
        payload:{
          fields:data.result,
          selectedRecord:dataSuccess?temp:{},
          equipments:dataSuccess?temp.SE_Equipments?.length>0?temp.SE_Equipments:state.equipments:[],
          // The Ex.Rate beside the invoicing buttons on Charges - the job's own.
          // Never loaded before, so it showed 1 on every visit, and the next
          // charges save wrote that 1 over the rate the job had.
          exRate: jobExRate(temp, state.exRate),
          // Its buying rate; none set yet, the selling one.
          exRateBuying: jobExRate({ exRate: temp?.exRateBuying }, jobExRate(temp, state.exRate)),
          fetched:true,
          edit:id=="new"?false:true,
          // permissions:tempPerms
        }
      })
    }
  }

  if(isLoading || dataLoading) return <div className='base-page-layout'><p>Loading...</p></div>;
  if(isError) return <div className='base-page-layout'><p>Error loading job: {error?.message}</p></div>;
  if(!dataSuccess) return <div className='base-page-layout'><p>Loading setup data...</p></div>;

  return (
  <div className='base-page-layout'>
    {state.fetched && 
      <CreateOrEdit
        jobData={isSuccess?{...newdata.result}:{}}
        companyId={companyId}
        dispatch={dispatch}
        refetch={refetch}
        state={state}
        type={type}
        id={id}
      />
    }
    {!state.fetched && isSuccess && <p>Ready to display job details...</p>}
  </div>
  )
}

export default React.memo(SeJob);
