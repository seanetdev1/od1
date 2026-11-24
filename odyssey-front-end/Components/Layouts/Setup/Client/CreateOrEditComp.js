import React, { useEffect, useReducer } from 'react';
import { useRouter } from 'next/router';
import CreateOrEdit from './CreateOrEdit';
import { useSelector } from 'react-redux';
import axiosClient from 'apis/axiosClient';
import CompanyVisibility from 'Components/Shared/CompanyVisibility';

function recordsReducer(state, action){
  switch (action.type) {
    case 'set': { 
      return { ...state, ...action.payload } 
    }
    case 'toggle': { 
      return { ...state, [action.fieldName]: action.payload } 
    }
    case 'history': {
      return {
        ...state,
        edit: false,
        viewHistory:true,
        visible: true,
      }
    }
    default: return state 
  }
}

const baseValues = {
  //Basic Info
  id:'',
  name:"",
  registerDate:"",
  person1:"",
  active:true,
  mobile1:"",
  person2:"",
  mobile2:"",
  telephone1:"",
  telephone2:"",
  address1:"",
  address2:"",
  city:"",
  zip:"",
  ntn:"",
  strn:"",
  website:"",
  infoMail:"",
  accountsMail:"",
  operations:[],
  types: [],
  companies:[],
  //Bank Info
  bank:"",
  branchName:"",
  branchCode:"",
  accountNo:"",
  iban:"",
  swiftCode:"",
  routingNo:"",
  ifscCode:"",
  micrCode:"",
  bankAuthorizeDate:"",
  authorizedById : "",
  //Account Info
  accountRepresentatorId : "",
  salesRepresentatorId : "",
  docRepresentatorId : "",
  currency:"",
  // null, not "": blank means no limit set (functions/partyCredit, backend).
  creditLimitDays: null,
  creditLimitAmount: null,
  code:"",

  parentAccount:'',
  childAccount:'',
}

const initialState = {
  load:false,
  values:baseValues,
  Representatives:[
    {name:'Accounts', records:[]},
    {name:'Sales', records:[]},
    {name:'Doc', records:[]}
  ],
  Operations:[
    { label: "Sea Import", value: "Sea Import" },
    { label: "Sea Export", value: "Sea Export" },
    { label: "Air Import", value: "Air Import" },
    { label: "Air Export", value: "Air Export" }
  ],
  // The full party-type list, for freight and customs installations.
  //
  // An AVIATION installation uses AVIATION_TYPES below instead: an airline
  // deals with a shipper, a consignee and a master agent per AWB, and the
  // other two dozen types here (shipping lines, depots, stevedores, drayage)
  // are freight-forwarding roles it has no use for. Picking the list at render
  // time rather than filtering here keeps both modes readable in one place.
  Types:[
    { label: "Shipper", value: "Shipper" },
    { label: "Consignee", value: "Consignee" },
    { label: "Notify", value: "Notify" },
    { label: "Potential Customer", value: "Potential Customer" },
    { label: "Invoice Party", value: "Invoice Party" },
    { label: "Non operational Party", value: "Non operational Party" },
    { label: "Forwarder/Coloader", value: "Forwarder/Coloader" },
    { label: "Local Vendor", value: "Local Vendor" },
    { label: "Overseas Agent", value: "Overseas Agent" },
    { label: "Commission Agent", value: "Commission Agent" },
    { label: "Indentor", value: "Indentor" },
    { label: "Transporter", value: "Transporter" },
    { label: "CHA/CHB", value: "CHA/CHB" },
    { label: "Shipping Line", value: "Shipping Line" },
    { label: "Delivery Agent", value: "Delivery Agent" },
    { label: "Warehouse", value: "Warehouse" },
    { label: "Buying House", value: "Buying House" },
    { label: "Air Line", value: "Air Line" },
    { label: "Trucking", value: "Trucking" },
    { label: "Drayman", value: "Drayman" },
    { label: "Cartage", value: "Cartage" },
    { label: "Stevedore", value: "Stevedore" },
    { label: "Principal", value: "Principal" },
    { label: "Depot", value: "Depot" },
    { label: "Terminal", value: "Terminal" },
    { label: "Buyer", value: "Buyer" },
    { label: "Slot Operator", value: "Slot Operator" },
  ],
  accountList:[],
  // Pre-set from the Create button that was pressed - see the effect below.
  parentAccount:'',
  partyKind:'',
  companyList:[
    {id:1, name:''}
  ],
  editCompanyList:[
    {id:1, name:''}
  ],
  history:[],
  // Editing Records
  oldRecord:{},
};

const CreateOrEditComp = ({id, representativeData, clientData}) => {

  const companiesList = useSelector((state) => state.company.companies);
  const [ state, dispatch ] = useReducer(recordsReducer, initialState);

  /* ------------------------ which kind of party ------------------------
   * Setup > Parties has a button per kind - Non-GL, Customer (AR), Vendor
   * (AP) - and passes which one was pressed as ?kind=. It decides exactly two
   * things: whether Non-GL starts ticked, and which parent account the ledger
   * is created under. Everything else on the form is unchanged, and the user
   * can still change both.
   *
   * The parent comes from Config > Party Accounts rather than being matched on
   * a title. This screen used to look for an account literally called
   * 'ACCOUNT RECEIVABLE' - which is one install's spelling of it - and then
   * did not even use what it found. An install whose chart says 'Accounts
   * Receivable', or which imported its accounts from elsewhere, matched
   * nothing and got no default at all.
   *
   * UNCONFIGURED IS FINE: the button still opens the form, with the Parent
   * Account selector empty for the user to pick, exactly as the single Create
   * button behaved.
   * ------------------------------------------------------------------ */
  const router = useRouter();
  const kind = String(router.query?.kind || '');

  useEffect(() => {
    Promise.all([
      axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ACCOUNTS_FOR_PARTY_SETUP,{
        headers:{"id": `1`}
      }),
      // Never fatal: an install that has not configured these still gets the
      // form, just without a pre-picked parent.
      axiosClient.get('/settings/partyAccounts').catch(()=>({data:{result:{}}})),
    ]).then(([accounts, cfg])=>{
      const configured = cfg?.data?.result || {};
      const parentFor = kind === 'ar' ? configured.receivable
        : kind === 'ap' ? configured.payable
        : '';
      dispatch({type:'set', payload:{
        // Only ever pre-fills a NEW party. An existing one already has its
        // ledger, and overwriting the parent it was created under would move
        // the account.
        parentAccount: (id === 'new' && parentFor) ? parentFor : '',
        partyKind: kind,
        accountList:accounts.data.result,
        companyList:createCompanyList(companiesList),
        editCompanyList:createCompanyList(companiesList)
      }});
    });
    setRecords();
  }, [kind])

  const createCompanyList = (list) => {
    let tempState = [];
    list.forEach((x, index)=>{
      tempState.push({value:x.id, label:x.title, disabled:false})
    })
    return tempState
  }

  const setRecords = () => {
    let tempState = [
      {name:'Accounts', records:[]},
      {name:'Sales', records:[]},
      {name:'Doc', records:[]}
    ];
    representativeData.result.Ar.forEach((x)=>{tempState[0].records.push(x)});
    representativeData.result.Dr.forEach((x)=>{tempState[1].records.push(x)});
    representativeData.result.Sr.forEach((x)=>{tempState[2].records.push(x)});
    dispatch({type:'toggle', fieldName:'Representatives', payload:tempState});
  }

  return (
  <div className='base-page-layout'>
    <CreateOrEdit state={state} dispatch={dispatch} baseValues={baseValues} clientData={clientData} id={id} />
    {/* Only where Seanet keeps parties per company - see the component. */}
    <CompanyVisibility table='parties' recordId={id && id !== 'new' ? id : null} style={{ maxWidth: 420, marginTop: 12 }} />
  </div>
  )
}

export default React.memo(CreateOrEditComp)