import { Row, Col, Table } from 'react-bootstrap';
import React, { useEffect, useReducer, useState } from 'react';
import Router from 'next/router';
import { DeleteOutlined, HistoryOutlined, SwapOutlined } from '@ant-design/icons';
import ReplacePartyModal from './ReplacePartyModal';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import axiosClient from 'apis/axiosClient';
import { Input, Select, Pagination } from 'antd'
import openNotification from 'Components/Shared/Notification';
import { checkPartyCreateAccess } from 'functions/checkPartyCreateAccess';
import { useMyPermissions } from 'functions/myPermissions';
import RowAction from 'Components/Shared/RowAction';
import { usePageActions } from 'Components/Shared/PageActions';

/* --------------------------- kinds of party ---------------------------
 * What the three Create buttons mean. `kind` is passed to the form as a
 * query parameter and decides two things there and nothing else: whether
 * Non-GL starts ticked, and which parent account the ledger is created
 * under (from Config > Party Accounts - the chart of accounts names those
 * differently on every install, so they cannot be found by title).
 *
 * Non-GL is FIRST because it is the one every user can always create: a
 * name-only party needs no ledger and no designation.
 * -------------------------------------------------------------------- */
const PARTY_KINDS = [
  {
    kind: 'nonGl',
    module: 'nonGlParties',
    glyph: '+NGL',
    label: 'Non-GL',
    tab: 'Non-GL Party',
    hint: 'A name-only party with no ledger account',
  },
  {
    kind: 'ar',
    module: 'customers',
    glyph: '+AR',
    label: 'Customer (AR)',
    tab: 'Customer',
    hint: 'A party you invoice — its ledger is created under accounts receivable',
  },
  {
    kind: 'ap',
    module: 'vendors',
    glyph: '+AP',
    label: 'Vendor (AP)',
    tab: 'Vendor',
    hint: 'A party you are billed by — its ledger is created under accounts payable',
  },
];

function recordsReducer(state, action){
  switch (action.type) {
    case 'toggle': { 
      return { ...state, [action.fieldName]: action.payload } 
    }
    case 'create': {
      return {
          ...state,
          edit: false,
          visible: true,
      }
    }
    case 'history': {
      return {
        ...state,
        edit: false,
        viewHistory:true,
        visible: true,
      }
    }
    case 'edit': {
      return {
        ...state,
        selectedRecord:{},
        edit: true,
        visible: true,
        selectedRecord:action.payload
      }
    }
    case 'modalOff': {
      let returnVal = { ...state, visible: false, edit: false, viewHistory:false };
      state.edit?returnVal.selectedRecord={}:null
      return returnVal
    }
    default: return state 
  }
}

const initialState = {
  records: [],
  searchClient : '',
  allClients : []
};

const Client = ({sessionData, clientData}) => {

  const dispatchNew = useDispatch();
  const [ state, dispatch ] = useReducer(recordsReducer, initialState);
  const can = useMyPermissions();
  const { records, allClients } = state;
  // The party being replaced. Opening the modal is what triggers the impact
  // check, so nothing is fetched until someone actually asks.
  const [replaceParty, setReplaceParty] = useState(null);
  const [searchBy , setSearchBy] = useState("name", "types");

  const pageSize = 30; // rows per page
  const [currentPage, setCurrentPage] = useState(1);
  
  const paginatedRecords = records.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )


  useEffect(()=>{ 
    if(sessionData.isLoggedIn==false){
      Router.push('/login');
    } 
    setRecords(); 
  }, [sessionData]);

  const getHistory = async(recordid,type) => {
    dispatch({type:'toggle', fieldName:'load', payload:true});
    dispatch({ type: 'history'})
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_HISTORY,{
      headers:{ recordid:recordid, type:type }
    }).then((x)=>{
      setTimeout(async() => {
        dispatch({type:'toggle', fieldName:'load', payload:false});
        dispatch({type:'toggle', fieldName:'history', payload:x.data.result});
    }, 2000);
    })
  }

  const setRecords = () => {
    dispatch({type:'toggle', fieldName:'records', payload:clientData.result});
    dispatch({type:'toggle', fieldName:'allClients', payload:clientData.result});
  }

  const deleteClient = async (id, active) => {
    const result = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/clientRoutes/deleteClient`, {id: id})
    console.log(result)
    if(result.data.status == 'success'){
      openNotification('Success', `Client Deleted!`, 'green');
      Router.push('/setup/clientList')
    } else if (result.data.status == 'deleted') {
      openNotification('Error', `Client Already Deleted!`, 'Red');
    } else if(result.data.status == 'transaction') {
      openNotification('Action Denied', `Transaction exists on client!`, 'Orange');
    }
  }


  const onSearch = (event) => {
    const searchValue = event.target.value.toLowerCase();
    const data = allClients.filter((x) => 
   
      x.name.toLowerCase().includes(searchValue) || 
      x?.code?.toLowerCase().includes(searchValue) || 
      x?.types?.toLowerCase().includes(searchValue)
    );
  
    dispatch({ type: 'toggle', fieldName: 'records', payload: data });
  };

  /* THE TITLE AND THE THREE NEWS on the toolbar (PageActions) - one per
   * kind of party, as the buttons here were (see PARTY_KINDS). Extras, each
   * with its kind's code, rather than the one New slot: which kind is the
   * whole point of having three. */
  const newParty = (k) => {
    dispatchNew(incrementTab({"label":k.tab,"key":"2-7","id":"new"}));
    Router.push(`/setup/client/new?kind=${k.kind}`);
  };
  const kindsAllowed = PARTY_KINDS.filter((k) => can(k.module, 'edit'));
  usePageActions({
    title: 'Parties',
    extras: kindsAllowed.map((k) => ({
      key: `new-${k.kind}`,
      glyph: k.glyph,
      label: `New ${k.label}`,
      title: `New ${k.label} - ${k.hint}`,
      onClick: () => newParty(k),
    })),
  }, [kindsAllowed.map((k) => k.kind).join(',')]);

  return (
  <div className='base-page-layout'>
    <Row>
    <Col md={12} style={{display:"inline-block"}}><span>Search By :</span>
      <Select placeholder="Search" onChange={(e) => setSearchBy(e)} style={{width:"150px", marginLeft:"5px",borderRadius:"8px"}}
        options={
          [
            {value : "name", label:"Name"},
            {value : "code", label:"Code"},
            {value : "types", label:"Type"},
          ]
        
        } defaultValue={"name"}

      />
      <Input style={{width:"290px", marginLeft:"5px", borderRadius:"5px"}} placeholder={searchBy == 'name' ? "Type Name" : searchBy == 'code' ? "Type Code" : "Type"}
        onChange={(e) => onSearch(e)}
      />
    </Col>
    </Row>
    <hr className='my-2' />
    <Row style={{maxHeight:'69vh',overflowY:'auto', overflowX:'hidden'}}>
    <Col md={12}>
      <div className='table-sm-1 mt-3' style={{maxHeight:500, overflowY:'auto'}}>
      <Table className='tableFixHead'>
        <thead>
          <tr>
          <th>Code</th>
            <th>Name</th>
            {/* <th>Contact Persons</th> */}
            <th>Telephones</th>
            <th>Types</th>
            <th>Address</th>
            <th>Status</th>
            <th>Replace</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
        {paginatedRecords?.map((x, index) => {
          return (
          <tr key={index} className='f row-hov'>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Party","key":"2-7","id":x.id}));
              Router.push(`/setup/client/${x.id}`);
            }}><span className=''>{x.code}</span></td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Party","key":"2-7","id":x.id}));
              Router.push(`/setup/client/${x.id}`);
            }}><span className='blue-txt fw-7'>{x.name}</span></td>
            {/* <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Party","key":"2-7","id":x.id}));
              Router.push(`/setup/client/${x.id}`);
            }}>{x.person1} {x.mobile1}<br/> {x.person2} {x.mobile2}<br/> </td> */}
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Party","key":"2-7","id":x.id}));
              Router.push(`/setup/client/${x.id}`);
            }}>{x.telephone1}<br/>{x.telephone2}</td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Party","key":"2-7","id":x.id}));
              Router.push(`/setup/client/${x.id}`);
            }}>{x.types}</td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Party","key":"2-7","id":x.id}));
              Router.push(`/setup/client/${x.id}`);
            }}>{x.address1?.slice(0,30)}<br/> {x.address2?.slice(0,30)}<br/></td>
            <td  style={{ textAlign: 'center', verticalAlign: 'middle', height: '40px', borderRight: '1px solid lightgrey' }} onClick={()=>{
              dispatchNew(incrementTab({"label":"Party","key":"2-7","id":x.id}));
              Router.push(`/setup/client/${x.id}`);
            }}>{x.active?<b className='green-txt'>Active</b>:<b className='red-txt'>Disabled</b>}</td>
            <td style={{ textAlign: 'center', verticalAlign: 'middle', height: '40px' }}>
              {/* Available whatever the party's status: a party that should
                  never have existed still has jobs pointing at it, and the
                  modal itself refuses when accounting records are involved. */}
              <RowAction
                Icon={SwapOutlined} label='Replace'
                title={`Replace ${x.name} with another party`}
                onClick={()=>setReplaceParty(x)}
              />
            </td>
            <td style={{ textAlign: 'center', verticalAlign: 'middle', height: '40px' }}>
              {/* Disabled RATHER THAN greyed-and-still-clickable, which is what
                  the icon here used to be: an active client cannot be deleted, and
                  the tooltip says so instead of a toast appearing after the
                  click. A client carries the whole ledger history filed against
                  it. */}
              <RowAction
                Icon={DeleteOutlined} label='Delete' kind='danger'
                disabled={x.active}
                title={x.active ? 'Disable this client first' : 'Delete this client'}
                confirm={{ what: 'client', name: x.name }}
                onClick={()=>deleteClient(x.id, x.active)}
              />
            </td>
          </tr>
        )})}
        </tbody>
      </Table>
      </div>
    </Col>
    </Row>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Pagination
          current={currentPage}
          pageSize={pageSize}
          total={records.length}
          onChange={(page) => setCurrentPage(page)}
          showSizeChanger={false}
        />
      </div>

      <ReplacePartyModal
        open={!!replaceParty}
        party={replaceParty}
        parties={allClients}
        onClose={() => setReplaceParty(null)}
        // A replaced party is gone from the list, so the simplest correct
        // refresh is to re-request the page's server-side props.
        onDone={() => Router.replace('/setup/clientList')}
      />
  </div>
  )
}

export default React.memo(Client)
