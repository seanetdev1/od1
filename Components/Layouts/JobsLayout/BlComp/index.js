import React, { useEffect, useReducer, useState } from "react";
import { Tabs } from "antd";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { usePageActions } from 'Components/Shared/PageActions';
import openNotification from "../../../Shared/Notification";
import BlInfo from "./BlInfo";
import ContainerInfo from "./ContainerInfo";
import BlDetail from "./BlDetail";
import Stamps from "./Stamps";
import Router from "next/router";
import { useDispatch, useSelector } from "react-redux";
import { incrementTab } from "redux/tabs/tabSlice";
import { stamps as stamp } from "./groupData";
import { validationSchema } from "./validion";
import { yupResolver } from "@hookform/resolvers/yup";
import { setAndFetchBlData, recordsReducer, initialState, baseValues, calculateContainerInfos, calculateItemInfos, calculateContainerInfosCopy } from "./states";
import axiosClient from 'apis/axiosClient';
import ItemDetail from "./ItemDetail";
import ChargesDetail from "./ChargesDetail";
import { getJobValues, getJobById } from 'apis/jobs';
import { assignAwbl } from 'apis/awbl';
import { describeSaveError } from 'functions/saveErrorMessage';
import { useQuery } from '@tanstack/react-query';
import Cookies from 'js-cookie';
import { rowMissingSize, CONTAINER_FIELDS } from 'functions/requiredSize';

const BlComp = ({id, blData, partiesData, type}) => {

  const currentJobValue = useSelector((state) => state.blCreationValues.value);
  const [state, dispatch] = useReducer(recordsReducer, initialState);
  const set = (a, b) => dispatch({ type: "toggle", fieldName: a, payload: b });
  const [deleteArr, setDeleteArr] = useState([]);
  const dispatchNew = useDispatch();
  const { data, isSuccess, refetch } = useQuery({
    queryKey:["jobData", {id:id=="new"?currentJobValue:blData.SEJobId, type:type}], 
    queryFn: () => getJobById({
      id:id=="new"?currentJobValue:blData.SEJobId, 
      type:type
    }),
  })
  console.log("job data: ", data)
  const { register, control, handleSubmit, reset, setValue, formState: { errors }, } = useForm({
    defaultValues: state.values,
  });
  // The job this BL belongs to - carries the airline whose AWB stock the
  // MAWB dropdown draws from, and the job id the number gets claimed for.
  const jobInfo = data?.result;

  // Air jobs only: the MAWB is chosen from registered stock, so once the BL
  // has saved we claim that number for this job and release whatever the job
  // held before. Sea jobs never set awblId and drop straight out.
  //
  // Deliberately run after the BL save rather than inside it: the BL routes
  // are large and shared with sea jobs, and a stock bookkeeping error should
  // never be able to fail an otherwise good BL save.
  const syncAwbl = async (data) => {
    if (type !== "AE" && type !== "AI") return;
    const jobId = jobInfo?.id;
    if (!jobId) return;

    // Absence is not an instruction to release. awblId is undefined until
    // either the stock list resolves and preselects the number this job holds,
    // or the user picks/clears one ('' means an explicit clear). Treating
    // undefined as "release" meant a BL saved before that fetch returned - or
    // after it failed - would hand a correctly assigned AWB back to the pool,
    // where a second job could then take the number this BL is still printing.
    if (data.awblId === undefined) return;
    try {
      const res = await assignAwbl({ awblId: data.awblId || null, jobId });
      if (res.status !== "success") {
        openNotification(
          "AWB Not Reserved",
          res.result || "The BL saved, but the AWB number could not be reserved.",
          "red", 10
        );
      }
    } catch (err) {
      openNotification(
        "AWB Not Reserved",
        describeSaveError(err, "The BL saved, but the AWB number could not be reserved."),
        "red", 10
      );
    }
  };
  const allValues = useWatch({ control });
  const { fields, append, remove } = useFieldArray({
    name: "stamps",
    control,
  });
  
  useEffect(() => {
    set("partiesData", partiesData);
    if (id != "new") {
      setAndFetchBlData(reset, state, allValues, set, dispatch, blData);
    } else {
      // -------->>>>>>!!!!!    Important Note    !!!!!<<<<<<---------
      // ----->>>>>> New Jab Values are set in Booking Info <<<<<-----
      reset(baseValues);
    }
  }, [id]);

  const getStamps = async () => {
  if (id === "new") return; // nothing to fetch yet — BL doesn't exist in DB

  const req = await axiosClient.get(
    process.env.NEXT_PUBLIC_CLIMAX_GET_STAMPS_BY_ID,
    { headers: { id: id } }
  );
  const result = req.data.result;
  reset({ ...allValues, stamps: result });
};

  const onDelete = (id) => {
    setDeleteArr((prev) => [...prev, id]);
  };

  const onSubmit = async (data) => {
    // A container size on every container row with anything on it - see
    // functions/requiredSize (the user's request, 2026-10-13).
    const noSize = rowMissingSize(state.Container_Infos, CONTAINER_FIELDS);
    if (noSize) {
      openNotification('Error', `Container Info row ${noSize}: pick a container size.`, 'red');
      return;
    }
    set("load", true);
    let tempData = {
      ...data,
      mblDate: data.mblDate,
      issueDate: data.issueDate,
      hblDate: data.hblDate,
      shipperContent: state.shipperContent,
      consigneeContent: state.consigneeContent,
      notifyOneContent: state.notifyOneContent,
      notifyTwoContent: state.notifyTwoContent,
      deliveryContent: state.deliveryContent,
      marksContent: state.marksContent,
      marksContentTwo: state.marksContentTwo,
      noOfPckgs: state.noOfPckgs,
      descOfGoodsContent: state.descOfGoodsContent,
      descOfGoodsContentTwo: state.descOfGoodsContentTwo,
      grossWeightContent: state.grossWeightContent,
      measurementContent: state.measurementContent,
      Container_Infos: state.Container_Infos,
      deletingContinersList: state.deletingContinersList,
      Item_Details:state.Item_Details,
      Dimensions:state.Dimensions,
      applyToCWT:data.applyToCWT[0]==1?'1':'0',
    };
    await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_BL, {...tempData, employeeId: Cookies.get("loginId")}).then(async(x) => {
      
      if (x.data.status == "success") {
        openNotification("Success", "BL Created Successfully", "green");
        await syncAwbl(data);
        dispatchNew(
          incrementTab({
            label: `${data.operation} BL`,
            key: data.operation=="SE"?"4-4":data.operation=="SI"?"4-7":data.operation=="AE"?"7-3":"7-6",
            id: x.data.result,
          })
        );
        Router.push(type=="SE"?`/seaJobs/export/bl/${x.data.result}`:type=="SI"?`/seaJobs/import/bl/${x.data.result}`:type=="AE"?`/airJobs/export/bl/${x.data.result}`:`/airJobs/import/bl/${x.data.result}`);
      } else if(x.data.status == 'warning') {
        openNotification("Warning",x.data.result,"orange");
      } else {
        openNotification("Error","something went wrong, try again with correct values","red");
      }
      set("load", false);
    });
    await refetch();
  };

  const onEdit = async (data) => {
    // A container size on every container row with anything on it - see
    // functions/requiredSize (the user's request, 2026-10-13).
    const noSize = rowMissingSize(state.Container_Infos, CONTAINER_FIELDS);
    if (noSize) {
      openNotification('Error', `Container Info row ${noSize}: pick a container size.`, 'red');
      return;
    }
    set("load", true);
    const stamps = data.stamps?.map((x) => ({
      ...x,
      stamps: stamp[Number(x.code) - 1]?.label,
    }));
    const values = await calculateContainerInfosCopy(state, set, reset, allValues)
    // await delay(2000);
    console.log("DATA:", data)
    console.log("Values:", values)
    let tempData = {
      ...data,
      id: id,
      stamps: stamps,
      mblDate: data.mblDate,
      issueDate: data.issueDate,
      hblDate: data.hblDate,
      deleteArr: deleteArr,
      shipperContent: state.shipperContent,
      consigneeContent: state.consigneeContent,
      notifyOneContent: state.notifyOneContent,
      notifyTwoContent: state.notifyTwoContent,
      deliveryContent: state.deliveryContent,
      marksContent: state.marksContent,
      marksContentTwo: state.marksContentTwo,
      noOfPckgs: state.noOfPckgs,
      descOfGoodsContent: state.descOfGoodsContent,
      descOfGoodsContentTwo: state.descOfGoodsContentTwo,
      grossWeightContent: state.grossWeightContent,
      measurementContent: state.measurementContent,
      Container_Infos: state.Container_Infos,
      deletingContinersList: state.deletingContinersList,
      Item_Details:state.Item_Details,
      deletingItemList:state.deletingItemList,
      Dimensions:state.Dimensions,
      deletingDimensionsList:state.deletingDimensionsList,
      applyToCWT:data.applyToCWT[0]==1?'1':'0',
      gross: values.gross,
      net: values.net,
      tare: values.tare,
      wtUnit: values.wtUnit,
      pkgs: values.pkgs,
      unit: values.unit,
      cbm: values.cbm,
    };
    let emp = stamps?.find(
      (x) => x.code == undefined && x.stamp_group == undefined
    );
    console.log("TEMP DATA:", tempData)
    emp?openNotification("Error", "Fields Can't Be Empty", "red")
      :await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_EDIT_BL, {...tempData, employeeId: Cookies.get("loginId")})
      .then(async(x) => {
        if (x.data.status == "error") {
          openNotification("Error", "Something went wrong", "red");
          set("load", false);
        } else if (x.data.status == "warning") {
          openNotification("Warning", x.data.result, "orange");
          set("load", false);
        } else {
          openNotification("Success", "Bl Edited Successfully", "green");
          // The containers as saved, new ones with their ids now - kept
          // without them, the next save inserted them again (duplicate rows).
          if (Array.isArray(x.data.containers)) {
            dispatch({ type: "set", payload: { Container_Infos: x.data.containers, deletingContinersList: [] } });
          }
          await syncAwbl(data);
          set("load", false);
        }
      })
      getStamps();
      await refetch();
  };

  useEffect(() => {
    if (state.tabState != "5") {
      dispatch({ type: "toggle", fieldName: "selectedInvoice", payload: "" });
    }
    if (state.tabState == 4) {
      getStamps();
    }
  }, [state.tabState]);

  useEffect(() => {
    calculateContainerInfos(state, set, reset, allValues)
  }, [state.Container_Infos]);

  useEffect(() => {
    calculateItemInfos(state, set, reset, allValues)
  }, [state.Item_Details]);

  const onError = (errors) => console.log(errors);

  /* THE TOOLBAR (PageActions) - Save BL / Save AWBL, which this screen drew
   * in its tab bar. Only once a job is chosen: a B/L hangs off a job. */
  const sea = type == "SE" || type == "SI";
  const what = sea ? 'BL' : 'AWBL';
  usePageActions({
    title: `${id == "new" ? 'New ' : ''}${sea ? 'Bill of Lading' : 'Air Waybill'}`,
    subtitle: allValues.jobNo ? `Job ${allValues.jobNo}` : undefined,
    save: {
      onClick: () => handleSubmit(id != "new" ? onEdit : onSubmit, onError)(),
      busy: Boolean(state.load),
      disabled: !allValues.jobNo,
      label: `Save ${what}`,
      title: allValues.jobNo ? `Save this ${what}` : `Choose the job first`,
    },
  }, [id, sea, allValues.jobNo, state.load]);

  return (
    <div className="base-page-layout">
      <div className="client-styles" style={{ overflowY: "auto", overflowX: "hidden" }}>
        <form onSubmit={handleSubmit(id != "new" ? onEdit : onSubmit, onError)}>
          <Tabs
          defaultActiveKey={state.tabState}
          activeKey={state.tabState}
          onChange={(e)=>dispatch({ type:"toggle", fieldName:"tabState", payload:e })}
          >
            <Tabs.TabPane tab={(type=="SE"||type=="SI")?"BL Info.":"AWB Info"} key="1">
              <BlInfo control={control} id={id} register={register} state={state} useWatch={useWatch} dispatch={dispatch} reset={reset} type={type} currentJobValue={currentJobValue} setValue={setValue} jobInfo={jobInfo} />
            </Tabs.TabPane>
            <Tabs.TabPane tab={(type=="SE"||type=="SI")?"Container Info":"Item Detail"} key="2">
              {(type=="SE"|| type=="SI") && <ContainerInfo control={control} id={id} register={register} 
                state={state} useWatch={useWatch} dispatch={dispatch} reset={reset} 
              />}
              {(type=="AE"|| type=="AI") && <ItemDetail control={control} id={id} register={register} 
                state={state} useWatch={useWatch} dispatch={dispatch} reset={reset} 
              />}
            </Tabs.TabPane>
            {(type=="AE"||type=="AI") && <Tabs.TabPane tab={"Charges Detail"} key="5">
              <ChargesDetail control={control} id={id} register={register} state={state} useWatch={useWatch} dispatch={dispatch} reset={reset} />
            </Tabs.TabPane>}
            <Tabs.TabPane tab={(type=="SE"||type=="SI")?"BL Detail":"Basic Information"} key="3">
              <BlDetail control={control} id={id} register={register} state={state} useWatch={useWatch} dispatch={dispatch} reset={reset} type={type} />
            </Tabs.TabPane>
            {id != "new" &&<Tabs.TabPane tab="Ref No's / Stamps" key="4">
              {allValues.jobNo && <Stamps state={state} id={id} control={control} register={register} useWatch={useWatch} handleSubmit={handleSubmit} 
                fields={fields} append={append} remove={remove} onDelete={onDelete} errors={errors} data={data} type={type}
              />}
            </Tabs.TabPane>}
          </Tabs>

        </form>
      </div>
    </div>
  );
};

export default React.memo(BlComp);
