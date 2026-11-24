import axiosClient from 'apis/axiosClient';
import * as yup from "yup";
import { Tabs } from "antd";
import moment from 'moment';
import Cookies from 'js-cookie';
import Router from 'next/router';
import React, { useEffect, useRef, useState } from 'react';
import { getJobValues } from 'apis/jobs';
import { useSelector, useDispatch, useStore } from 'react-redux';
import { saveDraft, clearDraft } from 'redux/partyDraft/partyDraftSlice';
import { toDraft, fromDraft, draftDiffersFrom } from 'functions/partyDraft';
import { useQuery } from '@tanstack/react-query';
import { createHistory } from './historyCreation';
import { Row, Col, Spinner } from 'react-bootstrap';
import { yupResolver } from "@hookform/resolvers/yup";
import DateComp from 'Components/Shared/Form/DateComp';
import { useForm, useFormContext, useWatch } from "react-hook-form";
import InputComp from 'Components/Shared/Form/InputComp';
import InputNumComp from 'Components/Shared/Form/InputNumComp';
import SelectComp from 'Components/Shared/Form/SelectComp';
import SelectSearchComp from 'Components/Shared/Form/SelectSearchComp';
import openNotification from 'Components/Shared/Notification';
import { toList } from 'functions/partyLists';
import CheckGroupComp from 'Components/Shared/Form/CheckGroupComp';
import { isAviationMode, AVIATION_PARTY_TYPES } from 'functions/terminology';
import { checkPartyCreateAccess } from 'functions/checkPartyCreateAccess';
import { useMyPermissions } from 'functions/myPermissions';
import { usePageActions } from 'Components/Shared/PageActions';

/* NOT VALIDATED, deliberately.
 *
 * These two fields used to reject anything that did not parse as a list of
 * addresses, which sounds harmless and was not: a party is created in the
 * middle of doing something else - raising an invoice, opening a job - and the
 * form refused to submit over a contact address, which is the least important
 * thing on it and often not an address at all. What people have to hand is
 * "accounts dept, ext 214" or two addresses separated by a slash, and being
 * unable to record the party at all was a far worse outcome than recording a
 * malformed address next to it.
 *
 * Nothing downstream depends on the format. The one place these are used to
 * SEND anything - invoice mail, routes/invoice - parses the field itself with
 * parseEmailList and simply ignores what is not an address, so a free-text
 * note here costs an empty recipient list rather than a bad send.
 */

// A blank credit limit box is "no limit set" - null, kept apart from 0, which
// is a party given no credit at all.
const blankToNull = (value, original) => (original === '' || original === null || original === undefined ? null : value);

// Built per install rather than once at module scope: an aviation party has no
// Operations to tick (see the selector below), so requiring at least one there
// would refuse every party on a screen that no longer asks the question.
const buildSchema = (aviation) => yup.object().shape({
    // code: yup.string().required('Required'),
    name: yup.string().required('Required'),
    //registerDate: yup.string().required('Required'),
    //bankAuthorizeDate: yup.string(),
    //person1: yup.string().required('Required'),
    //person2: yup.string().required('Required'),
    //mobile1:yup.string().min(11, 'Must be 11 Digits!').max(11, 'Must be 11 Digits!').required('Required'),
    //mobile2:yup.string().min(11, 'Must be 11 Digits!').max(11, 'Must be 11 Digits!').required('Required'),
    //ntn: yup.string().required('Required'),
    //strn: yup.string().required('Required'),
    //address1: yup.string().required('Required'),
    //address2: yup.string().required('Required'),
    city: yup.string().required('Required'),
    // zip: yup.string().required('Required'),
    //telephone1: yup.string().required('Required'),
    //telephone2: yup.string().required('Required'),
    types: yup.array().required('Atleast 1 Type Required!').min(1, "Atleast 1 Type Required!"),
    ...(aviation ? {} : {
        operations: yup.array().required('Atleast 1 Operation Required!').min(1, "Atleast 1 Operation Required!"),
    }),
    // Non-GL party (name only, no ledger). When unchecked the party gets a
    // ledger, so a Parent Account becomes required.
    nonGl: yup.boolean(),
    // Credit terms - optional (the user's request, 2026-10-23).
    creditLimitDays: yup.number().transform(blankToNull).nullable()
        .typeError('Whole days only').integer('Whole days only').min(0, '0 or more'),
    creditLimitAmount: yup.number().transform(blankToNull).nullable()
        .typeError('An amount only').min(0, '0 or more'),
    parentAccount: yup.mixed().when('nonGl', {
        is: (val) => val === false,
        then: yup.mixed().test(
            'parent-required',
            'Parent Account is required to create a ledger',
            (v) => v !== undefined && v !== null && v !== ''
        ),
        otherwise: yup.mixed(),
    }),
});

const CreateOrEdit = ({state, dispatch, baseValues, clientData, id}) => {

    // console.log("Client CreateOrEdit", state)

    const company = useSelector((state) => state.company.companies);
    const [register_date, setRegisterdate] = useState(moment().format('YYYY-MM-DD'));

    // Resolved here rather than in initialState because isAviationMode() reads
    // a cookie that MainLayout sets after login - at module-evaluation time it
    // may not be there yet, and the screen would silently fall back to freight.
    const aviation = isAviationMode();

    // An aviation install offers only Shipper / Consignee / Master Agent.
    const partyTypes = aviation ? AVIATION_PARTY_TYPES : state.Types;

    /* -------------------------- Operations --------------------------
     * Sea Import / Sea Export / Air Import / Air Export: which freight
     * operations a party is used on. An airline runs none of the four - it
     * has one operation, flying - so the tick boxes were four wrong answers
     * and a mandatory field standing between the user and a saved party.
     *
     * Hidden AND dropped from the schema, but the value still travels: the
     * form keeps whatever the party already had, and /createClient joins the
     * array to a string. Nothing downstream in aviation reads it.
     * -------------------------------------------------------------- */
    const SignupSchema = React.useMemo(() => buildSchema(aviation), [aviation]);

    /* ---------------------- surviving a tab switch -----------------------
     * Switching tabs is a Router.push: this page unmounts and every value in
     * it goes with it. So the form is mirrored into redux as it is typed, and
     * read back when it comes up again.
     *
     * The draft is taken ONCE, at mount, into a ref. Reading the selector
     * live would feed the store's copy back into the form on every keystroke
     * and fight whoever is typing.
     * ------------------------------------------------------------------ */
    const reduxDispatch = useDispatch();
    const draftKey = String(id ?? 'new');
    // useStore, deliberately, NOT useSelector. This form writes its own draft
    // every few hundred milliseconds while someone types; a selector would
    // subscribe to those writes and re-render the whole form on each one. The
    // draft is wanted exactly once, at mount, so it is read straight off the
    // store and kept in a ref - no subscription, no feedback loop.
    const reduxStore = useStore();
    const restored = useRef();
    if (restored.current === undefined) {
      restored.current = fromDraft(reduxStore.getState().partyDrafts?.drafts?.[draftKey]);
    }
    const hasDraft = Boolean(restored.current);
    // Shown to the user, and turned off by Discard. A restored form must not
    // silently disagree with what the database holds.
    const [draftRestored, setDraftRestored] = useState(hasDraft);

    const { register, control, handleSubmit, reset, watch, formState: { errors } } = useForm({
      resolver: yupResolver(SignupSchema),
      // A draft wins over the blank form: it is the newer of the two, and it
      // is the only copy of what was typed.
      defaultValues: restored.current || {
        ...state.values,
        nonGl: true,
      }    });
    const { oldRecord, Representatives } = state;

    // Mirror every change into the store, debounced - a dispatch per keystroke
    // would churn the devtools and re-render every subscriber for nothing.
    const draftTimer = useRef(null);
    useEffect(() => {
      const subscription = watch((values) => {
        clearTimeout(draftTimer.current);
        draftTimer.current = setTimeout(() => {
          reduxDispatch(saveDraft({ id: draftKey, values: toDraft(values) }));
        }, 400);
      });
      return () => {
        clearTimeout(draftTimer.current);
        subscription.unsubscribe();
      };
    }, [watch, draftKey, reduxDispatch]);

    // What the form would show if there were no draft - the saved party, or a
    // blank form. Kept so Discard has something to go back to.
    const savedValues = useRef(null);

    const discardDraft = () => {
      reduxDispatch(clearDraft(draftKey));
      setDraftRestored(false);
      reset(savedValues.current || { ...baseValues, nonGl: true });
    };

    // Only CEO/CFO/admin can attach a ledger, so only they can uncheck Non-GL -
    // or (2026-10-10) a user set up in the permission grid with the right to
    // edit customers or vendors. Everyone else sees it checked and locked and
    // can only make name-only parties (enforced again on the backend, which
    // also checks the side: a receivable ledger is a customer's, a payable
    // one a vendor's).
    const can = useMyPermissions();
    const canAttachLedger = checkPartyCreateAccess()
      || (can.granular && (can('customers', 'edit') || can('vendors', 'edit')));
    const nonGl = useWatch({ control, name: 'nonGl' });

    // Controlled tabs so a validation error can switch to the offending tab.
    const [activeTab, setActiveTab] = useState('1');
    const { refetch } = useQuery({
      queryKey:['values'],
      queryFn:getJobValues
    });

        // console.log("state date", state)


    useEffect(() => {
    //Edit
    if(id!="new") {
      let tempState = {...clientData};
      let tempCompanyList = [...state.editCompanyList];
      // [] rather than undefined when the column is null - see toList. The
      // edit history calls .forEach on these, and it runs BEFORE the save
      // request, so an undefined here threw the party away instead of saving it.
      tempState.operations = toList(tempState.operations);
      tempState.types = toList(tempState.types);
      tempState.registerDate = tempState.registerDate ? moment(tempState.registerDate) : "";
      tempState.bankAuthorizeDate = moment(tempState.bankAuthorizeDate);
      tempState.companies = [];
    //   clientData.Client_Associations?.forEach((x)=>{ tempState.companies.push(x.CompanyId) })
    //   tempCompanyList.forEach((x, i)=>{
        // for(let j=0; j<tempState.Client_Associations?.length; j++){
        //   if(tempState.Client_Associations[j].CompanyId==x.value){
        //     tempCompanyList[i].disabled=true;
        //     break;
        //   } else {
        //     tempCompanyList[i].disabled=false;
        //   }
        // }
    //   })
    tempState.Client_Associations?.forEach((x)=>{
        // A ledger's Child_Account may have no parent account (null) - guard
        // against reading .id off null so the edit form still opens.
        const pid = x?.Child_Account?.parent?.id;
        if (pid) tempState.parentAccount = pid;
    })
      dispatch({type:'toggle', fieldName:'editCompanyList', payload:tempCompanyList});
      // oldRecord is set whether or not a draft is restored: it is what the
      // edit history diffs against, so it must always be the SAVED party
      // rather than whatever is currently in the boxes.
      dispatch({type:'toggle', fieldName:'oldRecord', payload:tempState});
      // An existing party with a parent account already has a ledger -> not non-GL.
      const saved = {...tempState, parentAccount:tempState.parentAccount, nonGl: !tempState.parentAccount};
      savedValues.current = saved;
      // The reset is SKIPPED when a draft was restored - it would overwrite
      // the unsaved edits with the copy from the database, which is the exact
      // loss this is here to prevent. The banner offers Discard for the times
      // the saved version really is the one wanted.
      if (!hasDraft) reset(saved);
      else if (!draftDiffersFrom(toDraft(restored.current), toDraft(saved))) {
        // Opened, not actually edited. Nothing to announce.
        setDraftRestored(false);
      }
    }
    if(id=="new") {
        // Which Create button was pressed on Setup > Parties. Non-GL means a
        // name-only party; AR/AP mean a party with a ledger, so Non-GL starts
        // UNTICKED and the parent account is already filled in from Config >
        // Party Accounts. Neither is forced - both are ordinary form fields
        // from here on. No kind at all (a direct link, an older bookmark)
        // keeps the previous default of a name-only party.
        const wantsLedger = state.partyKind === 'ar' || state.partyKind === 'ap';
        const blank = {...baseValues, parentAccount:state.parentAccount, nonGl: !wantsLedger};
        savedValues.current = blank;
        if (!hasDraft) reset(blank);
        else if (!draftDiffersFrom(toDraft(restored.current), toDraft(blank))) {
          setDraftRestored(false);
        }
    }
    }, [state.parentAccount, state.partyKind])
    
    //Create
    const onSubmit = async(data) => {
        // Non-GL party: never send a parent account, so no ledger is created.
        if (data.nonGl) data.parentAccount = '';
        let Username = Cookies.get('username')
        data.createdBy = Username;
        let pAccountName = ''
        dispatch({type:'toggle', fieldName:'load', payload:true});
        state.accountList.forEach((x)=>{
            if(x.id==data.parentAccount){
                pAccountName =x.id
            }
        });
        setTimeout(async() => {
            await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_CREATE_CLIENT,{
                ...data, pAccountName, employeeId: Cookies.get('loginId')
            }).then((x)=>{
                if(x.data.status=='success'){
                    openNotification('Success', `Client ${x.data.result.name} Created!`, 'green');
                    refetch();
                    // The draft has done its job. Left behind, the next new
                    // party would open pre-filled with this one.
                    reduxDispatch(clearDraft(draftKey));
                    setDraftRestored(false);
                    Router.push(`/setup/client/${x.data.result.id}`);
                }else if(x.data.status == 'exists'){
                    openNotification('Error', `Client Already Exists`, 'orange')
                }else{
                    openNotification('Error', x.data.message || `An Error occured Please Try Again!`, 'red')
                }
                dispatch({type:'toggle', fieldName:'load', payload:false});
            })
        }, 3000);
    };
    //Edit funtion
    const onEdit = async(data) => {
        // Non-GL party: never send a parent account, so no ledger is created.
        if (data.nonGl) data.parentAccount = '';
        let history = "";
        let pAccountName = ''
        let tempAssociations = [];
        let EmployeeId = Cookies.get('loginId');
        let updateDate = moment().format('MMM Do YY, h:mm:ss a');
        history = await createHistory(Representatives, oldRecord, data, company);
        data.Client_Associations.forEach((x)=> { tempAssociations.push(x.CompanyId) })
        data.companies = [ ...getDifference(data.companies, tempAssociations), ...getDifference(tempAssociations, data.companies)];
        dispatch({type:'toggle', fieldName:'load', payload:true});
        state.accountList.forEach((x)=>{
            if(x.id==data.parentAccount){
                pAccountName =x.id
            }
        });
        setTimeout(async() => {
            await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_EDIT_CLIENT,{
                data, history, updateDate, pAccountName, employeeId: Cookies.get('loginId')
            }).then((x)=>{
                if(x.data.status=='success'){
                    openNotification('Success', `Client ${data.name} Updated!`, 'green');
                    refetch();
                    // Saved, so the draft is now the older copy of the two.
                    reduxDispatch(clearDraft(draftKey));
                    setDraftRestored(false);
                    savedValues.current = data;
                } else { openNotification('Error', x.data.message || `An Error occured Please Try Again!`, 'red') }
                dispatch({type:'toggle', fieldName:'load', payload:false});
            })
        }, 3000);
    };

    // Which tab each validated field lives on + a human label, so a validation
    // failure can name the field AND jump to its tab (the error is often on a
    // tab the user isn't looking at, e.g. Parent Account on Account Info).
    const FIELD_META = {
        name:          { label: 'Name',            tab: '1' },
        city:          { label: 'City',            tab: '1' },
        types:         { label: 'Type(s)',         tab: '1' },
        operations:    { label: 'Operation(s)',    tab: '1' },
        infoMail:      { label: 'Info Mail',       tab: '1' },
        accountsMail:  { label: 'Accounts Mail',   tab: '1' },
        parentAccount: { label: 'Parent Account',  tab: '3' },
        creditLimitDays:   { label: 'Credit Limit (Days)',   tab: '3' },
        creditLimitAmount: { label: 'Credit Limit (Amount)', tab: '3' },
    };

    const onError = (formErrors) => {
        const keys = Object.keys(formErrors || {});
        if (!keys.length) return;
        // Jump to the earliest tab that has an error so the field is visible.
        const tabs = keys.map((k) => FIELD_META[k]?.tab).filter(Boolean).sort();
        if (tabs.length) setActiveTab(tabs[0]);
        const labels = keys.map((k) => FIELD_META[k]?.label || k);
        openNotification(
            'Please complete required fields',
            `Missing or invalid: ${labels.join(', ')}`,
            'red'
        );
    };

    function getDifference(array1, array2){
        return array1.filter(object1 => {
            return !array2.some(object2 => {
                return object1 === object2;
            });
        });
    }
    
    // Submit on the toolbar (PageActions); it sat in the tab bar.
    usePageActions({
      title: id != 'new' ? 'Edit Party' : 'New Party',
      save: {
        onClick: () => handleSubmit(id != "new" ? onEdit : onSubmit, onError)(),
        busy: Boolean(state.load),
        label: 'Submit',
        title: 'Save this party',
      },
    }, [id, state.load]);

    return (
    <div className='client-styles' style={{maxHeight:720, overflowY:'auto', overflowX:'hidden'}}>
      {/* Said out loud. A form that quietly shows something other than what
          the database holds is worse than one that lost the typing - the user
          has no way to tell which version they are looking at. */}
      {draftRestored && (
        <div className='party-draft-bar'>
          <span>
            <b>Unsaved changes restored.</b>{' '}
            {id != 'new'
              ? 'This is what you had typed, not the saved party. Submit to keep it.'
              : 'This is what you had typed before you switched tabs.'}
          </span>
          <a onClick={discardDraft}>
            {id != 'new' ? 'Discard and show the saved party' : 'Discard and start again'}
          </a>
        </div>
      )}
      <form onSubmit={handleSubmit(id!="new"?onEdit:onSubmit, onError)} >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
      >
        {/* Basic info tab */}
        <Tabs.TabPane tab="Basic Info" key="1">
        <Row>
            <Col md={12} className='py-1'>
                <Row>
                    <Col md={3}>
                        <InputComp disabled  register={register} name='code' control={control} label='Code' />
                        {errors.code && <div className='error-line'>{errors.code.message}*</div>}
                    </Col>
                    <Col md={3}>
                        <SelectComp width={100} register={register} name='active' control={control} label='Status'
                            options={[
                                {name:'Active', id:true},
                                {name:'Inactive', id:false},
                            ]}
                        />
                    </Col>
                </Row>
            </Col>
            <Col md={6} className='py-1'>
                <InputComp  register={register} name='name' control={control} label='Name*' />
                {errors.name && <div className='error-line'>{errors.name.message}*</div>}
            </Col>
            <Col className='py-1'>     
                <DateComp register={register} name='registerDate' defaultValues={register_date} control={control} label='Register Date' />
                {errors.registerDate && <div className='error-line'>Required*</div>}
            </Col>
            <Col md={2} className='py-1'>
                <InputComp register={register} name='city' control={control} label='City' />
                {errors.city && <div className='error-line'>{errors.city.message}*</div>}
            </Col>
            <Col md={2} className='py-1'>
                <InputComp register={register} name='zip' control={control} label='ZIP' />
                {errors.zip && <div className='error-line'>{errors.zip.message}*</div>}
            </Col>
            <Col md={6} className='py-1'>
                <InputComp register={register} name='address1' control={control} label='Address 1' />
                {errors.address1 && <div className='error-line'>{errors.address1.message}*</div>}
            </Col>
            <Col md={6} className='py-1'>
                <InputComp register={register} name='address2' control={control} label='Address 2' />
                {errors.address2 && <div className='error-line'>{errors.address2.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='person1' control={control} label='Person 1' />
                {errors.person1 && <div className='error-line'>{errors.person1.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='mobile1' control={control} label='Mobile 1' />
                {errors.mobile1 && <div className='error-line'>{errors.mobile1.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='person2' control={control} label='Person 2' />
                {errors.person2 && <div className='error-line'>{errors.person2.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='mobile2' control={control} label='Mobile 2' />
                {errors.mobile2 && <div className='error-line'>{errors.mobile2.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='telephone1' control={control} label='Telephone 1' />
                {errors.telephone1 && <div className='error-line'>{errors.telephone1.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='telephone2' control={control} label='Telephone 2' />
                {errors.telephone2 && <div className='error-line'>{errors.telephone2.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='website' control={control} label='Website' />
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='infoMail' control={control} label='Info Mail (separate multiple with ;)' />
                {errors.infoMail && <div className='error-line'>{errors.infoMail.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='accountsMail' control={control} label='Accounts Mail (separate multiple with ;)' />
                {errors.accountsMail && <div className='error-line'>{errors.accountsMail.message}*</div>}
            </Col>
            <Col md={4} className='py-1'>
                <InputComp register={register} name='ntn' control={control} label='NTN No.' />
                {errors.ntn && <div className='error-line'>{errors.ntn.message}*</div>}
            </Col>
            <Col md={4} className='py-1'>
                <InputComp register={register} name='strn' control={control} label='STRN No.' />
                {errors.strn && <div className='error-line'>{errors.strn.message}*</div>}
            </Col>
            {/* Not asked in aviation mode - see the note by SignupSchema. */}
            {!aviation && (
            <Col md={12} className='py-1'>
                <CheckGroupComp register={register} name='operations' control={control} label='Operations'
                options={state.Operations}/>
                {errors.operations && <div className='error-line'>{errors.operations.message}*</div>}
            </Col>
            )}
            <Col md={12} className='py-1'>
                <CheckGroupComp register={register} name='types' control={control} label='Type'
                    options={partyTypes}/>
                {errors.types && <div className='error-line'>{errors.types.message}*</div>}
            </Col>
        </Row>
        </Tabs.TabPane>
        {/* Bank info tab */}
        <Tabs.TabPane tab="Bank Info" key="2">
        <Row>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='bank' control={control} label='Bank' />
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='branchName' control={control} label='Branch Name' />
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='branchCode' control={control} label='Branch Code' />
            </Col>
            <Col md={6} className='py-1'>
                <InputComp register={register} name='accountNo' control={control} label='Account No.' />
            </Col>
            <Col md={6} className='py-1'>
                <InputComp register={register} name='iban' control={control} label='IBAN' />
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='routingNo' control={control} label='Routing No.' />
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='swiftCode' control={control} label='Swift Code' />
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='ifscCode' control={control} label='IFSC Code' />
            </Col>
            <Col md={3} className='py-1'>
                <InputComp register={register} name='micrCode' control={control} label='MICR Code' />
            </Col>
            <Col md={3} className='py-1'>
                <DateComp register={register} name='bankAuthorizeDate' control={control} label='Bank Authorize Date' />
            </Col>
            <Col md={3} className='py-1'>     
                <SelectComp width={100} register={register} name='authorizedById' control={control} label='Authorized By:'
                    options={state.Representatives[0].records}
                />
            </Col>
            <div style={{height:185}}></div>
        </Row>
        </Tabs.TabPane>
        {/* Account info tab  */}
        <Tabs.TabPane tab="Account Info" key="3">
        <Row>
            <Col md={12} className='py-2'>
              <label style={{ display:'inline-flex', alignItems:'center', gap:8, cursor: canAttachLedger ? 'pointer' : 'not-allowed', userSelect:'none' }}>
                <input type="checkbox" {...register('nonGl')} disabled={!canAttachLedger} />
                <span style={{ fontWeight:600 }}>Non-GL (name only — no ledger)</span>
              </label>
              {!canAttachLedger &&
                <div style={{ fontSize:12, color:'#888', marginTop:4 }}>
                  Only CEO/CFO/Admin can attach a ledger. To give this party a ledger, it must be set up through Accounts.
                </div>}
            </Col>
            <Col md={6}>
             <SelectSearchComp clear={true} width={"100%"} register={register} name='parentAccount'
                control={control} label={`Parent Account:${nonGl ? '' : ' *'}`}
                disabled={nonGl || !canAttachLedger}
                options={state?.accountList.map((x)=>{
                    return {id:x.id, name:x.title}
                })}
            />
            {errors.parentAccount && <div className='error-line'>{errors.parentAccount.message}*</div>}
            </Col>
            <Col></Col>
            <Col md={6} className='pt-2'>
                <InputComp register={register} name='name' control={control} label='Account Name' 
                    width={"100%"} disabled={true} 
                />
            </Col>

            <hr className='mt-4' />

            <Col md={12} className='py-1'>     
                <SelectComp width={"50%"} register={register} name='accountRepresentatorId' control={control} 
                    label='Account Representative:' options={state.Representatives[0].records} 
                />
            </Col>
            <Col  md={12} className='py-1'>     
                <SelectComp width={"50%"} register={register} name='docRepresentatorId' control={control} 
                    label='Doc Representative:' options={state.Representatives[1].records} 
                />
            </Col>
            <Col md={12} className='py-1'>     
                <SelectComp width={"50%"} register={register} name='salesRepresentatorId' control={control} 
                    label='Sales Representative:' options={state.Representatives[2].records} 
                />
            </Col>
            <Col md={12} className='py-1'>     
                <SelectComp width={200} register={register} name='currency' control={control} label='Currency'
                    options={[  
                        {id:'USD', name:'USD'},
                        {id:'PKR', name:'PKR'},
                        {id:'INR', name:'INR'},
                        {id:'AED', name:'AED'},
                        {id:'AUD', name:'AUD'},
                        { id:"EUR", name:"EUR"},
                        { id:"GBP", name:"GBP"},
                        { id:"OMR", name:"OMR"},
                        { id:"BDT", name:"BDT"},             
                        { id:"CHF", name:"CHF"},
                ]}/>
            </Col>
            {/* Credit terms. Blank = none set; 0 = no credit. Not acted on
                yet - recorded for the overdue check to come. */}
            <Col md={3} className='py-1'>
                <InputNumComp register={register} name='creditLimitDays' control={control}
                    label='Credit Limit (Days)' width={'100%'} rest={{ precision: 0, step: 1 }}
                />
                {errors.creditLimitDays && <div className='error-line'>{errors.creditLimitDays.message}*</div>}
            </Col>
            <Col md={3} className='py-1'>
                <InputNumComp register={register} name='creditLimitAmount' control={control}
                    label='Credit Limit (Amount)' width={'100%'}
                    rest={{
                        precision: 2,
                        formatter: (value) => `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','),
                        parser: (value) => value?.replace(/,/g, ''),
                    }}
                />
                {errors.creditLimitAmount && <div className='error-line'>{errors.creditLimitAmount.message}*</div>}
            </Col>
            <div style={{height:130}}></div>
        </Row>
        </Tabs.TabPane>
        {/* company info tab  */}
        <Tabs.TabPane tab="Company Info" key="4">
        <Row>
            <Col md={12} className='py-1'>     
                <CheckGroupComp register={register} name='companies' control={control} label='Comapnies'
                    options={state.edit?state.editCompanyList:state.companyList} 
                />
            </Col>
            <div style={{height:383}}></div>
        </Row>
        </Tabs.TabPane>
      </Tabs>
      </form>

      <style jsx global>{`
        .client-styles .party-draft-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
          padding: 6px 10px;
          font-size: 12px;
          color: #7a5b00;
          background: #fffbe6;
          border: 1px solid #ffe58f;
          border-radius: 4px;
        }
        .client-styles .party-draft-bar a {
          margin-left: auto;
          white-space: nowrap;
          cursor: pointer;
          text-decoration: underline;
        }
      `}</style>
    </div>
    )
}

export default React.memo(CreateOrEdit)
