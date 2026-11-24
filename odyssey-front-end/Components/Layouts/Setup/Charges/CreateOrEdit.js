import React, { useEffect } from 'react';
import { useForm, useWatch } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import InputComp from 'Components/Shared/Form/InputComp';
import InputNumComp from 'Components/Shared/Form/InputNumComp';
import SelectComp from 'Components/Shared/Form/SelectComp';
import RadioComp from 'Components/Shared/Form/RadioComp';
import { Row, Col, Spinner } from 'react-bootstrap';
import axiosClient from 'apis/axiosClient';
import openNotification from 'Components/Shared/Notification';
import { getJobValues } from 'apis/jobs';
import { useQuery } from '@tanstack/react-query';
import Cookies from 'js-cookie';
import { isAviationMode, AVIATION_PARTY_TYPE_OPTIONS } from 'functions/terminology';
import CompanyVisibility from 'Components/Shared/CompanyVisibility';

// Who a charge falls to by default. The freight roles below have no meaning to
// an airline, which deals only with the three parties named on an AWB - see
// AVIATION_PARTY_TYPE_OPTIONS. Declared once and used by both the payable and
// the receivable selector, which previously carried identical inline copies.
const FREIGHT_PARTY_TYPES = [
    {id:'Client', name:'Client'},
    {id:'Local-Agent', name:'Local-Agent'},
    {id:'Overseas-Agent', name:'Overseas-Agent'},
    {id:'Transport-Agent', name:'Transport-Agent'},
    {id:'Forwarding-Agent', name:'Forwarding-Agent'},
    {id:'Custom-Agent', name:'Custom-Agent'},
    {id:'Shipping-Line', name:'Shipping-Line'},
];

const SignupSchema = yup.object().shape({
    // code: yup.string().required('Required'),
    currency: yup.string().required('Required'),
    name: yup.string().required('Required'),
    short: yup.string().required('Required'),
    calculationType: yup.string().required('Required'),
    // The two default party types are OPTIONAL - see models/Charges.js. They
    // only pre-fill a party when a charge is picked on a job, and plenty of
    // charges have no such answer; requiring one meant picking a wrong role
    // that then quietly pre-filled the wrong party every time.
});

const CreateOrEdit = ({state, dispatch, baseValues}) => {

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: yupResolver(SignupSchema),
    defaultValues:state.values
  });

  const taxApply = useWatch({control, name:"taxApply"});

  // Resolved at render, not at module load: isAviationMode() reads a cookie
  // MainLayout sets after login, so evaluating it earlier can fall back to
  // freight before the mode is known.
  const partyTypes = isAviationMode() ? AVIATION_PARTY_TYPE_OPTIONS : FREIGHT_PARTY_TYPES;
  const { refetch } = useQuery({
    queryKey:['values'],
    queryFn:getJobValues
  });

  useEffect(() => {
    if(state.edit){
        let tempState = {...state.selectedRecord};
        reset(tempState);
    }
    if(!state.edit){ reset(baseValues) }
  }, [state.selectedRecord])

  const onSubmit = async(data) => {
    dispatch({type:'toggle', fieldName:'load', payload:true});
    setTimeout(async() => {
        // console.log(data)
        await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_CREATE_CHARGE,{
            data,
            employeeId: Cookies.get("loginId")
        }).then((x)=>{
            // console.log(x)
            if(x.data.status=='success'){
                let tempRecords = [...state.records];
                tempRecords.unshift(x.data.result);
                dispatch({type:'toggle', fieldName:'records', payload:tempRecords});
                dispatch({type:'modalOff'});
                reset(baseValues);
                openNotification('Success', `Charge ${x.data.result.name} Created!`, 'green');
                refetch();
            }else if(x.data.status="exists"){
                openNotification('Error', `Charge with same code already exists Created!`, 'red')
            }else{
                openNotification('Error', `Some Error Occured, Try Again!`, 'red')
            }
            dispatch({type:'toggle', fieldName:'load', payload:false});
        })
    }, 3000);
  };

  const onEdit = async(data) => {
    dispatch({type:'toggle', fieldName:'load', payload:true});
    // console.log(data)
    setTimeout(async() => {
        await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_EDIT_CHARGE,{
            data,
            employeeId: Cookies.get("loginId")
        }).then((x)=>{
            if(x.data.status=='success'){
                let tempRecords = [...state.records];
                let i = tempRecords.findIndex((y=>data.id==y.id));
                tempRecords[i] = x.data.result;
                dispatch({type:'toggle', fieldName:'records', payload:tempRecords});
                dispatch({type:'modalOff'});
                reset(baseValues)
                openNotification('Success', `Charge ${x.data.result.name} Updated!`, 'green');
                refetch();
            }else if(x.data.status="exists"){
                openNotification('Error', `Charge with same code already exists Created!`, 'red')
            }else{
                openNotification('Error', `Some Error Occured, Try Again!`, 'red')
            }
            dispatch({type:'toggle', fieldName:'load', payload:false});
        })
    }, 3000);
  };

  const onError = (errors) => console.log(errors);

  return (
    <div className='client-styles' style={{maxHeight:620, overflowY:'auto', overflowX:'hidden'}}>
    <h6>{state.edit?'Edit':'Create'}</h6>
    <form onSubmit={handleSubmit(state.edit?onEdit:onSubmit, onError)}>
      <Row>
          <Col md={3} className='py-1'>
              <InputComp register={register} disabled name='code' control={control} label='Code' />
              {errors.code && <div className='error-line'>{errors.code.message}</div>}
          </Col>
          <Col md={3} className='py-1'>     
              <SelectComp register={register} width={100} name='currency' control={control} label='Currency'
                  options={[
                    { id:"PKR", name:"PKR"},
                    { id:"USD", name:"USD"},
                    { id:"EUR", name:"EUR"},
                    { id:"GBP", name:"GBP"},
                    { id:"AED", name:"AED"},             
                    { id:"OMR", name:"OMR"},
                    { id:"BDT", name:"BDT"},             
                    { id:"CHF", name:"CHF"},
                    
                  ]} />
                {errors.currency && <div className='error-line'>{errors.currency.message}*</div>}
          </Col>
      </Row>
      <Row>
        <Col md={6}>
            <InputComp register={register} name='name' control={control} label='Name' />
            {errors.name && <div className='error-line'>{errors.name.message}*</div>}
        </Col>
        <Col md={4}>
            <InputComp register={register} name='short' control={control} label='Short Name' />
            {errors.short && <div className='error-line'>{errors.short.message}*</div>}
        </Col>
        <Col md={12} className="my-2">
        <RadioComp register={register} name='calculationType' control={control} label='Calculation Type'
            options={[
                { label: "P/Unit", value: "Per Unit" },
                { label: "P/Shpt", value: "Per Shipment" },
            ]} />
            {errors.calculationType && <div className='error-line'>{errors.calculationType.message}*</div>}
        </Col>
        <Col md={4} className='my-2'>
            <InputNumComp register={register} name='fixAmount' control={control} label='Fixed Charge Amount' />
        </Col>
        <Col md={12} className="my-2">
        <RadioComp register={register} name='taxApply' control={control} label='Tax'
            options={[
                { label: "Yes", value: "Yes" },
                { label: "No", value: "No" },
            ]} />
            {errors.taxApply && <div className='error-line'>{errors.taxApply.message}*</div>}
        </Col>
        <Col md={2} className="my-2">
            <InputNumComp register={register} name='taxPerc' control={control} label='Tax Percentage' disabled={taxApply=="No"?true:false} />
            {errors.taxPerc && <div className='error-line'>{errors.taxPerc.message}*</div>}
        </Col>
        <Col md={12} className="my-2">
        {/*
          * Money the agent lays out for the client and recharges at cost -
          * duty, sales tax, wharfage, port and terminal charges. It is a
          * recoverable asset, not income, and on a goods declaration it dwarfs
          * the agency fee, so posting it to revenue overstates turnover and
          * misstates the sales-tax position.
          *
          * This has to be set by hand: the legacy Gen_Charges.IsReimbursment
          * column exists but is null on every row, so the migration has nothing
          * to carry across.
          */}
        <RadioComp register={register} name='reimbursable' control={control} label='Reimbursable (pass-through)'
            options={[
                { label: "No", value: false },
                { label: "Yes", value: true },
            ]} />
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              Yes = paid on the client&apos;s behalf and recharged at cost. Posts to the
              disbursements account set in Configuration &gt; Ledger Accounts instead of
              income or expense.
            </div>
        </Col>
        <Col md={8}></Col>
        {/* BOTH OPTIONAL. They pre-fill the party when this charge is picked
            on a job, and a charge that lands on a different party every time
            has no answer to give - so leaving one blank means "do not
            pre-fill", not "not filled in yet". Clearable, and the charge
            screens already treat an absent role as filling in nothing. */}
        <Col md={3} className="my-2">
            <SelectComp register={register} name='defaultPaybleParty' control={control} label='Default Payble Party Type' width={180}
                options={partyTypes}
            />
        </Col>
        <Col md={4} className="my-2">
            <SelectComp register={register} name='defaultRecivableParty' control={control} label='Default Receivable Party Type' width={180}
                options={partyTypes}
            />
        </Col>
        <Col md={12}>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              Optional. Leave either blank if this charge does not always fall to
              the same kind of party — the party is then picked on the job.
            </div>
        </Col>
      </Row>
      <div style={{height:16}}></div>
    {state.edit && <CompanyVisibility table='charges' recordId={state.selectedRecord?.id} style={{ maxWidth: 420, marginBottom: 12 }} />}
    <hr/>
    <button type="submit" disabled={state.load?true:false} className='btn-custom'>
      {state.load?<Spinner animation="border" size='sm' className='mx-3' />:'Submit'}
    </button>
    </form>
  </div>
  )
}

export default React.memo(CreateOrEdit)

