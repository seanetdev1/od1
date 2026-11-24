import openNotification from "Components/Shared/Notification";
import { useForm, useWatch } from "react-hook-form";
import React,{useEffect, useState} from "react";
import LoadingForm from "./LoadingForm";
import {initialState} from "./states";
import moment from "moment";
import axios from "axios";
import axiosClient from 'apis/axiosClient';
// Never imported: Save and the load both threw "Cookies is not defined", so a
// Loading Program could neither be saved nor shown.
import Cookies from 'js-cookie';

// A saved date as the picker takes it; blank (or never saved) stays blank.
const asMoment = (v) => (v ? moment(v) : "");

const LoadingProgram = ({ state, jobData }) => {

  const [load, setLoad] = useState(false);
  const { register, control, handleSubmit, reset } = useForm({
    defaultValues: initialState.values,
  });
  
  const allValues = useWatch({ control });

  const onSubmit = async (data) => {
    setLoad(true);
    const SEJobId = jobData.id;
    data.id == "" ? delete data.id : data.id;
    // console.log(data)
    await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_UPSERT_LOADING_PROGRAM, {
        ...data,
        SEJobId, employeeId: Cookies.get("loginId"),
    }).then((x) => {
      if(x.data.status=="success"){
        if(!data.id){
          reset({...allValues, id:x.data.result[0].id});
        }
        openNotification("Success", "Loading Program Saved!", "Green")
      }else{
        openNotification("Error", "Something Went Wrong, please try again", "red")
      }
    })
    setLoad(false)
  };

  useEffect(() => {
    getValues();
  }, []);

  const getValues = async() => {
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_LOADING_PROGRAM, {
      headers: { id: jobData.id, employeeId: Cookies.get("loginId"), }, 
    })  .then((res) => {
      if (res.data.result !== null) {
        let loadingProgram = res.data.result;
        reset({
          ...loadingProgram,
          loadingDate: asMoment(loadingProgram.loadingDate),
          croIssueDate: asMoment(loadingProgram.croIssueDate),
          expiryDate: asMoment(loadingProgram.expiryDate),
          loadingTime: asMoment(loadingProgram.loadingTime),
          arrivalDate: asMoment(loadingProgram.arrivalDate),
          // Both were read from fields that do not exist (sobDateDate,
          // getGatePassDate), so they came back as today, not as saved.
          sobDate: asMoment(loadingProgram.sobDate),
          etd: asMoment(loadingProgram.etd),
          gatePassDate: asMoment(loadingProgram.gatePassDate),
          validityDate: asMoment(loadingProgram.validityDate)
          // dischargeTerminal: loadingProgram.dischargeTerminal,
          // localCustom:loadingProgram.localCustom==""?"":loadingProgram.localCustom,
          // loadingTerminal: loadingProgram.loadingTerminal,
          // letter: loadingProgram.letter,
          // book: loadingProgram.book,
          // egm: loadingProgram.egm,
          // gatePass: loadingProgram.gatePass,
          // letter: loadingProgram.letter,
          // cro: loadingProgram.cro,
          // berth: loadingProgram.berth,
          // viaPort: loadingProgram.viaPort,
          // containerInfo: loadingProgram.containerInfo,
          // portOfReciept: loadingProgram.portOfReciept,
          // instruction: loadingProgram.instruction,
          // loadingFlag: loadingProgram.loadingFlag,
          // status: loadingProgram.status,
          // allocAvailable: loadingProgram.allocAvailable,
          // contAvailable: loadingProgram.contAvailable,
          // containerSplit: loadingProgram.containerSplit,
          // blRequired: loadingProgram.blRequired,
          // containerWt: loadingProgram.containerWt,
          // containerTemp: loadingProgram.containerTemp,
          // vent: loadingProgram.vent,
          // loadingTerms: loadingProgram.loadingTerms,
          // cargoStauts: loadingProgram.cargoStauts,
          // instruction: loadingProgram.instruction,
          // loadingTerms: loadingProgram.loadingTerms
        })
      }
    })
  }

  return (
    <LoadingForm onSubmit={onSubmit} register={register} control={control} handleSubmit={handleSubmit}
      load={load} allValues={allValues} state={state}
    />
  );
};

export default React.memo(LoadingProgram)
