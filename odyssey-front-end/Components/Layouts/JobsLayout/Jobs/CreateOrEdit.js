import React, { useEffect, useState } from 'react';
import axiosClient from 'apis/axiosClient';
import dynamic from 'next/dynamic'
import moment from 'moment';
import { Tabs } from "antd";
import Routing from './Routing';
import Cookies from 'js-cookie';
import Router from "next/router";
import { checkEmployeeAccess} from 'functions/checkEmployeeAccess';

const Invoice = dynamic(() => import('./Invoice'), {loading: () => <p>Loading...</p>,})
const BookingInfo = dynamic(() => import('./BookingInfo'), {loading: () => <p>Loading...</p>,})
const ChargesComp = dynamic(() => import('./ChargesComp'), {loading: () => <p>Loading...</p>,})
const EquipmentInfo = dynamic(() => import('./EquipmentInfo'), {loading: () => <p>Loading...</p>,})
const DelieveryOrder = dynamic(() => import('./Delievery Order'), {loading: () => <p>Loading...</p>,})
const LoadingProgram = dynamic(() => import('./Loading Program'), {loading: () => <p>Loading...</p>,})

import { useDispatch, useSelector } from 'react-redux';
import { useForm, useWatch } from "react-hook-form";
import { incrementTab, removeTab } from 'redux/tabs/tabSlice';
import { SignupSchema, getInvoices, baseValues } from './states';
import { isCompanySelected, NO_COMPANY_TO_SAVE } from 'functions/selectedCompany';
import { yupResolver } from "@hookform/resolvers/yup";
import { createNotification } from 'functions/notifications';
import openNotification from 'Components/Shared/Notification';
import { describeSaveError } from 'functions/saveErrorMessage';
import FullScreenLoader from 'Components/Shared/FullScreenLoader';
import { useMyPermissions } from 'functions/myPermissions';
import { useQueryClient } from '@tanstack/react-query';
import { rowMissingSize, EQUIPMENT_FIELDS } from 'functions/requiredSize';
import { blContainerGross } from 'functions/blWeights';
import { useDocuments } from 'Components/Shared/Documents';
import { usePageActions } from 'Components/Shared/PageActions';

const JOB_KIND = { SE: 'Sea Export', SI: 'Sea Import', AE: 'Air Export', AI: 'Air Import' };
const JOB_TAB = { SE: '4-3', SI: '4-6', AE: '7-2', AI: '7-5' };
const JOB_LIST = { SE: '/seaJobs/seJobList', SI: '/seaJobs/siJobList', AE: '/airJobs/aeJobList', AI: '/airJobs/aiJobList' };

const CreateOrEdit = ({state, dispatch, companyId, jobData, id, type, refetch}) => {
  const can = useMyPermissions();
  const queryClient = useQueryClient();
  const fiscalYearId = useSelector((state) => state.fiscalYear.value);
  const {register, control, handleSubmit, reset, formState:{errors}, watch, getValues, setValue } = useForm({
    resolver:yupResolver(SignupSchema), defaultValues:state.values,
  });
  const approved = useWatch({control, name:"approved"});
  const subType = useWatch({control, name:"subType"});
  const allValues = useWatch({control});
  const dispatchNew = useDispatch();
  const tabs = useSelector((state)=>state.tabs.tabs)
  const [ deleteAccess, setDeleteAccess ] = useState(false);

  useEffect(() => {
  if (!state.selectedRecord) return; // ✅ don't run unnecessarily

  // console.log("This is running");

  // Build base tempState
  let tempState = { ...baseValues, ...jobData };

  // A sea job's Weight is its B/L's containers' gross, so saving the job
  // cannot write back an older number - see functions/blWeights.
  const containerGross = (type == 'SE' || type == 'SI') ? blContainerGross(jobData) : null;
  if (containerGross !== null) tempState.weight = containerGross;

  // ✅ Voyage List — only update when it's actually empty and Voyage exists
  if (state.voyageList.length === 0 && tempState.Voyage) {
    dispatch({
      type: "set",
      payload: {
        voyageList: [tempState.Voyage],
      },
    });
  }

  // ✅ Helper function to convert to moment or empty string
  const toMoment = (value) => (value === "" ? "" : moment(value));

  tempState = {
    ...tempState,
    eta: toMoment(tempState.eta),
    etd: toMoment(tempState.etd),
    approved:
      tempState.approved === "true" || tempState.approved?.[0] === "1"
        ? ["1"]
        : [],
    arrivalDate: toMoment(tempState.arrivalDate),
    arrivalTime: toMoment(tempState.arrivalTime),
    departureDate: toMoment(tempState.departureDate),
    departureTime: toMoment(tempState.departureTime),
    polDate: toMoment(tempState.polDate),
    podDate: toMoment(tempState.podDate),
    aesDate: toMoment(tempState.aesDate),
    aesTime: toMoment(tempState.aesTime),
    eRcDate: toMoment(tempState.eRcDate),
    eRcTime: toMoment(tempState.eRcTime),
    eRlDate: toMoment(tempState.eRlDate),
    eRlTime: toMoment(tempState.eRlTime),
    jobDate: toMoment(tempState.jobDate),
    shipDate: toMoment(tempState.shipDate),
    doorMove: toMoment(tempState.doorMove),
    cutOffDate: toMoment(tempState.cutOffDate),
    cutOffTime: toMoment(tempState.cutOffTime),
    siCutOffDate: toMoment(tempState.siCutOffDate),
    siCutOffTime: toMoment(tempState.siCutOffTime),
    vgmCutOffDate: toMoment(tempState.vgmCutOffDate),
    vgmCutOffTime: toMoment(tempState.vgmCutOffTime),
  };

  /* The job's equipment and Ex.Rate are loaded into state by the page (index.js).
   * This used to set them with dispatch(prev => ...) - but `dispatch` is a
   * reducer's, which takes an action, not an updater, so it did nothing, and
   * the Ex.Rate was not loaded anywhere at all. */

  // ✅ Only reset form if values are different
  const currentFormValues = getValues(); // from react-hook-form
  if (JSON.stringify(currentFormValues) !== JSON.stringify(tempState)) {
    reset({ ...tempState });
  }

  getInvoices(tempState.id, dispatch);

  if (allValues.approved != 1) {
    setDeleteAccess(true);
  }
}, []);


  const onSubmit = async(data) => {
    // No company picked: refused here, and by the server - see functions/selectedCompany.
    if (!isCompanySelected(companyId)) {
      openNotification('Error', NO_COMPANY_TO_SAVE, 'red');
      return;
    }
    if(type == 'AE' || type == 'AI'){
      if(!data.departureDate){
        openNotification('Error', `Departure Date is required for Air Jobs!`, 'red')
        return;
      }
    }
    // A container size on every equipment row with anything on it - see
    // functions/requiredSize (the user's request, 2026-10-13).
    const noSize = rowMissingSize(state.equipments, EQUIPMENT_FIELDS);
    if (noSize) {
      openNotification('Error', `Equipment Info row ${noSize}: pick a container size.`, 'red');
      return;
    }
    data.equipments = state.equipments
    // The Charges tab's Ex.Rate, not the one the job opened with - saving
    // Booking Info put that back over a rate saved on Charges since.
    data.exRate = state.exRate
    data.exRateBuying = state.exRateBuying
    data.customAgentId = data.customCheck.length>0?data.customAgentId:null;
    data.transporterId = data.transportCheck.length>0?data.transporterId:null;
    data.VoyageId = data.VoyageId!=""?data.VoyageId:null;
    data.ClientId = data.ClientId!=""?data.ClientId:null;
    data.shippingLineId = data.shippingLineId!=""?data.shippingLineId:null;
    data.shipperId = data.shipperId!=""?data.shipperId:null;
    data.consigneeId = data.consigneeId!=""?data.consigneeId:null;
    data.overseasAgentId = data.overseasAgentId!=""?data.overseasAgentId:null;
    data.salesRepresentatorId = data.salesRepresentatorId!=""?data.salesRepresentatorId:null;
    data.forwarderId = data.forwarderId!=""?data.forwarderId:null;
    data.localVendorId = data.localVendorId!=""?data.localVendorId:null;
    data.commodityId = data.commodityId!=""?data.commodityId:null;
    data.shippingLineId = data.shippingLineId!=""?data.shippingLineId:null;
    // vesselId is an integer FK like every id above it - an unset dropdown
    // leaves "" here, which Postgres rejects outright ("invalid input
    // syntax for type integer") and the user only sees the generic "An
    // Error occured" below, so a job simply couldn't be saved before a
    // vessel was picked.
    data.vesselId = data.vesselId!=""?data.vesselId:null;
    data.approved = data.approved[0]=="1"?true:false;
    data.companyId = companyId;
    data.fiscalYearId = fiscalYearId;
    data.operation = type
    let loginId = Cookies.get('loginId');
    data.createdById = loginId;
    dispatch({type:'toggle', fieldName:'load', payload:true});
    setTimeout(async() => {
      await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_SEAJOB,{
        data,
        employeeId: Cookies.get("loginId")
      }).then((x)=>{
        if(x.data.status=='success'){
            refetch()
            openNotification('Success', `Job Created!`, 'green');
            dispatchNew(incrementTab({
              "label": type=="SE"?"SE JOB":type=="SI"?"SI JOB":type=="AE"?"AE JOB":"AI JOB",
              "key": type=="SE"?"4-3":type=="SI"?"4-6":type=="AE"?"7-2":"7-5",
              "id":x.data.result.id
            }))
            Router.push(
              type=="SE"?`/seaJobs/export/${x.data.result.id}`:
              type=="SI"?`/seaJobs/import/${x.data.result.id}`:
              type=="AE"?`/airJobs/export/${x.data.result.id}`:
              `/airJobs/import/${x.data.result.id}`
              )
        }else{
            openNotification(
              'Job Not Created',
              describeSaveError(x.data.result, 'The job could not be created. Please try again.'),
              'red',
              10
            )
        }
      },
      // Second argument rather than a trailing .catch() on purpose: this must
      // only handle the request itself failing (offline, 5xx, 423 read-only).
      // A .catch() here would also swallow anything thrown by the success
      // branch above - a routing or tab-dispatch error would then be reported
      // to the user as "job not created" after the job was in fact created.
      (err)=>{
        openNotification(
          'Job Not Created',
          describeSaveError(err, 'The job could not be created. Please try again.'),
          'red',
          10
        )
      })
      // Runs on every outcome, so the Save button can never be left spinning
      // with no message - previously a rejected request skipped the .then()
      // entirely and the form stayed locked until the page was reloaded.
      .finally(()=>{
        dispatch({type:'toggle', fieldName:'load', payload:false});
      })
    }, 3000);
  };

  const onEdit = async(data) => {
    // No company picked: refused here, and by the server - see functions/selectedCompany.
    if (!isCompanySelected(companyId)) {
      openNotification('Error', NO_COMPANY_TO_SAVE, 'red');
      return;
    }

    if(type == 'AE' || type == 'AI'){
      if(!data.departureDate){
        openNotification('Error', `Departure Date is required for Air Jobs!`, 'red')
        return;
      }
    }
    // A container size on every equipment row with anything on it - see
    // functions/requiredSize (the user's request, 2026-10-13).
    const noSize = rowMissingSize(state.equipments, EQUIPMENT_FIELDS);
    if (noSize) {
      openNotification('Error', `Equipment Info row ${noSize}: pick a container size.`, 'red');
      return;
    }
    data.equipments = state.equipments
    // The Charges tab's Ex.Rate, not the one the job opened with - saving
    // Booking Info put that back over a rate saved on Charges since.
    data.exRate = state.exRate
    data.exRateBuying = state.exRateBuying
    data.customAgentId = data.customCheck.length>0?data.customAgentId:null;
    data.transporterId = data.transportCheck.length>0?data.transporterId:null;
    data.VoyageId = data.VoyageId!=""?data.VoyageId:null;

    data.ClientId = data.ClientId !== undefined && data.ClientId!=""?data.ClientId:null;
    data.shippingLineId = data.shippingLineId !== undefined &&  data.shippingLineId!=""?data.shippingLineId:null;
    data.shipperId = data.shipperId !== undefined && data.shipperId!=""?data.shipperId:null;
    data.consigneeId = data.consigneeId !== undefined && data.consigneeId !== "" ? data.consigneeId : null;

    data.overseasAgentId = data.overseasAgentId !== undefined && data.overseasAgentId!=""?data.overseasAgentId:null;
    data.salesRepresentatorId = data.salesRepresentatorId !== undefined &&data.salesRepresentatorId!=""?data.salesRepresentatorId:null;
    data.forwarderId = data.forwarderId !== undefined &&data.forwarderId!=""?data.forwarderId:null;
    data.localVendorId = data.localVendorId !== undefined &&data.localVendorId!=""?data.localVendorId:null;
    data.commodityId = data.commodityId !== undefined &&data.commodityId!=""?data.commodityId:null;
    data.shippingLineId = data.shippingLineId !== undefined &&data.shippingLineId!=""?data.shippingLineId:null;
    // See the matching note in onSubmit - same "" -> integer FK problem on edit.
    data.vesselId = data.vesselId !== undefined && data.vesselId!=""?data.vesselId:null;
    data.approved = data.approved[0]=="1"?true:false;
    data.companyId = companyId;
    // Saving after Unlock: the server checks who is asking and records the
    // save as "Edit (unlocked)" - see /seaJob/unlock.
    if (state.unlocked) data.unlocked = true;

    dispatch({type:'toggle', fieldName:'load', payload:true});

    const notification = {
      creatorId: state.selectedRecord.createdById ,
      type: `${type} JOB`, 
      subType : data.jobNo, 
      opened: 0,
      companyId, 
      recordId: data.id, 
      createdById: Cookies.get("loginId"),
      notification: approved[0] == '1' ?  `Job No ${data.jobNo} Approved`: `Job No ${data.jobNo} Dispproved`
    }
    setTimeout(async() => {
      // Title reflects what the user was actually trying to do, so a failed
      // approval doesn't just say "not saved" when they pressed Approve.
      const failureTitle = approved[0] == '1' ? 'Job Not Approved' : 'Job Not Saved';
      const failureFallback = approved[0] == '1'
        ? 'The job could not be approved. Please try again.'
        : 'The job could not be saved. Please try again.';

      await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_EDIT_SEAJOB,{data, employeeId: Cookies.get("loginId"),}).then((x)=>{
        if(x.data.status=='success'){
          openNotification('Success', `Job Updated!`, 'green')
          createNotification(notification)
          // An unlock covers one save; the next change is a new, recorded unlock.
          if (state.unlocked) dispatch({ type: 'set', payload: { unlocked: false } });
          refetch();
        }else if (x.data.status == 'approved') {
          openNotification('Error', `Job Already Approved!`, 'orange')
        } else {
          // The backend's own message is written for users - the fiscal-year
          // guard names the year and says how to switch to it. describeSaveError
          // passes those through and only rewrites raw database errors.
          openNotification(failureTitle, describeSaveError(x.data.result, failureFallback), 'red', 10)
        }
      },
      // See the matching note in onSubmit: second argument, not .catch(), so
      // this only fires when the request itself failed and never masks an
      // error thrown by the success branch above.
      (err)=>{
        openNotification(failureTitle, describeSaveError(err, failureFallback), 'red', 10)
      })
      .finally(()=>{
        dispatch({type:'toggle', fieldName:'load', payload:false});
      })
    }, 3000);
  };

  // A required field left empty - Client, Shipper, Commodity - was only
  // logged to the console, so Save did nothing and said nothing. Said now.
  // Delete Job - the toolbar asks first (PageActions), then this.
  const deleteJob = () => {
    axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_DELETE_JOBS, {
      id: allValues.id, employeeId: Cookies.get("loginId")
    }).then((x) => {
      if (x.data.status !== 'success') {
        openNotification('Error', x.data.result || 'Something went wrong', 'red')
        return
      }
      dispatchNew(removeTab(tabs.filter((t) => t.key != (JOB_TAB[type] || '7-5')))); // the job's tab first
      Router.push(JOB_LIST[type] || JOB_LIST.AI)
    }).catch((e) => {
      openNotification('Error', e?.response?.data?.result || 'The job could not be deleted.', 'red')
    })
  };

  const onError = (errors) => {
    const first = Object.values(errors || {})[0];
    openNotification('Error', first?.message || 'Fill in the required fields first.', 'red');
  };

  useEffect(() => {
    let obj = {...allValues, SE_Equipments:state.equipments};
    queryClient.setQueryData(
      ['jobData', {id, type}],
      (x) => x?{...x,result:obj}:x
    )
    if(allValues.approved!=1){
      setDeleteAccess(true)
    }else{
      setDeleteAccess(false)
    }
  }, [allValues, state.equipments])
  // The job's documents - the paperclip on the toolbar (2026-11-13).
  const docs = useDocuments({
    entity: 'SE_Job',
    recordId: state.edit ? id : null,
    title: `Documents - Job ${allValues?.jobNo || ''}`,
  });

  /* THE TOOLBAR (PageActions) - Save Job and Delete Job, which this screen
   * drew in its tab bar. Saved from the job's own pages: Booking Info,
   * Equipment and Routing. Charges and invoices save on their own tabs, so
   * there it says where the job is saved rather than saving it from under
   * them - the tab bar showed no Save there either. */
  const jobPage = state.tabState == "1" || state.tabState == "2" || state.tabState == "3";
  const jobNo = allValues?.jobNo || '';
  usePageActions({
    title: `${state.edit ? '' : 'New '}${JOB_KIND[type] || ''} Job${state.edit && jobNo ? ` ${jobNo}` : ''}`,
    save: {
      onClick: () => handleSubmit(state.edit ? onEdit : onSubmit, onError)(),
      busy: Boolean(state.load),
      disabled: !jobPage,
      label: 'Save Job',
      title: jobPage ? 'Save this job' : 'The job is saved from Booking Info, Equipment or Routing',
    },
    delete: state.edit ? {
      onClick: deleteJob,
      disabled: !deleteAccess,
      label: 'Delete Job',
      title: deleteAccess ? 'Delete this job' : 'An approved job cannot be deleted',
      confirm: { what: 'job', name: jobNo, body: 'Its B/L goes with it. This cannot be undone.' },
    } : undefined,
    extras: [docs.extra],
  }, [type, state.edit, jobNo, jobPage, state.load, deleteAccess, docs.count, docs.saved]);

  return(
  <div className='client-styles' style={{overflowY:'auto', overflowX:'hidden'}}>
    {docs.modal}
    <form onSubmit={handleSubmit(state.edit?onEdit:onSubmit, onError)}>
      {/* <Tabs defaultActiveKey={state.tabState} activeKey={state.tabState}
        onChange={(e)=> dispatch({type:'toggle', fieldName:'tabState', payload:e}) }> */}
        <Tabs defaultActiveKey={state.tabState} activeKey={state.tabState}
        onChange={(e)=> dispatch({type:'toggle', fieldName:'tabState', payload:e}) }
        >
      <Tabs.TabPane tab="Booking Info" key="1"> 
        <BookingInfo handleSubmit={handleSubmit} setValue={setValue} onEdit={onEdit} companyId={companyId} control={control} register={register} 
          errors={errors} state={state} useWatch={useWatch} dispatch={dispatch} reset={reset} id={id} type={type}
        />
      </Tabs.TabPane>
      {(subType=="FCL" && (type=="SE" || type=="SI")) &&
        <Tabs.TabPane tab="Equipment" key="2">
          <EquipmentInfo control={control} register={register} errors={errors} state={state} dispatch={dispatch} useWatch={useWatch}/>
        </Tabs.TabPane>
      }
        <Tabs.TabPane tab="Routing" key="3">
          <Routing control={control} register={register} errors={errors} state={state} useWatch={useWatch} type={type} />
        </Tabs.TabPane>
      {/* A job's charges are their own permission (the user's request,
          2026-10-10): without it the tab is not there. */}
      {state.edit && can('jobCharges', 'view') &&
        <Tabs.TabPane tab="Charges" key="4">
          <ChargesComp state={state} dispatch={dispatch} type={type} allValues={allValues} />
        </Tabs.TabPane>
      }
      {(state.selectedInvoice!='') && can('jobCharges', 'view') &&
        <Tabs.TabPane tab="Invoice / Bills" key="5">
          <Invoice state={state} dispatch={dispatch} companyId={companyId} />
        </Tabs.TabPane>
      }
      {(state.loadingProgram!='') &&
        <Tabs.TabPane tab={`Loading Program`} key="6">
          <LoadingProgram state={state} dispatch={dispatch} companyId={companyId} jobData={jobData} />
        </Tabs.TabPane>
      }
      {(state.do!='') &&
        <Tabs.TabPane tab={"Delivery Order"} key="7">
          <DelieveryOrder state={state} dispatch={dispatch} companyId={companyId} jobData={jobData} clearingAgents={state.fields.vendor.chaChb} />
        </Tabs.TabPane>
      }
      </Tabs>

    </form>
    {state.load && <FullScreenLoader/>}
  </div>
  )
}

export default React.memo(CreateOrEdit)
