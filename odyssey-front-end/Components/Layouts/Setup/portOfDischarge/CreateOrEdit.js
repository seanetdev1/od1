import { useForm } from "react-hook-form";
import openNotification from 'Components/Shared/Notification';
import InputComp from 'Components/Shared/Form/InputComp';
import { yupResolver } from "@hookform/resolvers/yup";
import { Row, Col, Spinner } from 'react-bootstrap';
import React, { useEffect } from 'react';
import * as yup from "yup";
import { createPort, updatePort } from 'apis/pickLists';
import { isCustomsMode } from 'functions/terminology';

const CreateOrEdit = ({ state, dispatch, baseValues }) => {

    const SignupSchema = yup.object().shape({
        portId: yup.string().required('Required'),
        portName: yup.string().required('Required'),
        portCountry: yup.string().required('Required'),
    });

    const { register, control, handleSubmit, reset, formState: { errors } } = useForm({
        resolver: yupResolver(SignupSchema),
        defaultValues: state.values
    });

    useEffect(() => {
        // A new port starts unticked - unless it is being added as a Port Of
        // Loading from a customs job (AddPortModal), which ticks it.
        reset(state.edit ? { ...state.selectedRecord, customsLoading: Boolean(state.selectedRecord?.customsLoading) } : { ...baseValues, customsLoading: Boolean(baseValues?.customsLoading) });
    }, [state.selectedRecord])

    const onError = (errors) => console.log(errors);

    const onSubmit = async (data) => {
        dispatch({ type: 'toggle', fieldName: 'load', payload: true });
        try {
            const result = await createPort(data);
            if (result.status !== 'success') {
                openNotification('Error', 'Error Occured Try Again!', 'red')
            } else {
                openNotification('Success', 'Port Created!', 'green');
                let tempRecord = [...state.records];
                tempRecord.unshift(result.result);
                dispatch({ type: 'toggle', fieldName: 'records', payload: tempRecord });
                dispatch({ type: 'modalOff' })
            }
        } finally {
            dispatch({ type: 'toggle', fieldName: 'load', payload: false });
        }
    };

    const onEdit = async (data) => {
        dispatch({ type: 'toggle', fieldName: 'load', payload: true });
        try {
            const result = await updatePort({ ...data, id: state.selectedRecord.id });
            if (result.status !== 'success') {
                openNotification('Error', 'Error Occured Try Again!', 'red')
            } else {
                openNotification('Success', 'Port Updated!', 'green');
                let tempRecords = [...state.records];
                let i = tempRecords.findIndex((y) => state.selectedRecord.id == y.id);
                tempRecords[i] = result.result;
                dispatch({ type: 'toggle', fieldName: 'records', payload: tempRecords });
                dispatch({ type: 'modalOff' })
            }
        } finally {
            dispatch({ type: 'toggle', fieldName: 'load', payload: false });
        }
    };

    return (
        <div className='client-styles' style={{ maxHeight: 720, overflowY: 'auto', overflowX: 'hidden' }}>
            <h6>{state.edit ? 'Edit' : 'Create'} Port</h6>
            <form onSubmit={handleSubmit(state.edit ? onEdit : onSubmit, onError)}>
                <Row>
                    <Col md={4} className='py-1'>
                        <InputComp register={register} name='portId' control={control} label='Code' />
                        {errors.portId && <div className='error-line'>{errors.portId.message}*</div>}
                    </Col>
                    <Col md={4} className='py-1'>
                        <InputComp register={register} name='portName' control={control} label='Port Name' />
                        {errors.portName && <div className='error-line'>{errors.portName.message}*</div>}
                    </Col>
                    <Col md={4} className='py-1'>
                        <InputComp register={register} name='portCountry' control={control} label='Country' />
                        {errors.portCountry && <div className='error-line'>{errors.portCountry.message}*</div>}
                    </Col>
                </Row>
                {/* CUSTOMS PORT OF LOADING - the ports a clearing agent files
                    exports from, the Port Of Loading list on a customs job and
                    in the Program Book. None ticked: the built-in list stays.
                    (The user's request, 2026-10-12.) */}
                {isCustomsMode() && (
                    <label className='mt-3' style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                        <input type='checkbox' {...register('customsLoading')} style={{ marginTop: 3 }} />
                        <span>
                            <b>Customs port of loading</b>
                            <div className='grey-txt' style={{ fontSize: 12 }}>
                                Offer this port as a Port Of Loading on customs jobs and in the Program Book.
                                Once any port is ticked, the ticked ports are the list.
                            </div>
                        </span>
                    </label>
                )}
                <button type="submit" disabled={state.load ? true : false} className='btn-custom mt-4'>
                    {state.load ? <Spinner animation="border" size='sm' className='mx-3' /> : 'Submit'}
                </button>
            </form>
        </div>
    )
}

export default CreateOrEdit
