import { Row, Col, Table } from 'react-bootstrap';
import React, { useEffect, useReducer, useState } from 'react';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { Input, Select } from 'antd';
import openNotification from 'Components/Shared/Notification';
import { DeleteOutlined } from '@ant-design/icons';
import axiosClient from 'apis/axiosClient';
import RowAction from 'Components/Shared/RowAction';
import { usePageActions } from 'Components/Shared/PageActions';

function recordsReducer(state, action){
  switch (action.type) {
    case 'toggle': { 
      return { ...state, [action.fieldName]: action.payload } 
    }
    case 'set': { 
      return { ...state, ...action.payload } 
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
  history:[],
  allVendors: [],
  searchedVendor : '',
  // Editing Records
  selectedRecord:{},
  oldRecord:{},
};

const Vendor = ({sessionData, vendorData}) => {

  useEffect(()=>{ if(sessionData.isLoggedIn==false) Router.push('/login') }, [sessionData]);
  const dispatchNew = useDispatch();

  const [ state, dispatch ] = useReducer(recordsReducer, initialState);
  const { records , allVendors } = state;
  const [searchBy , setSearchBy] = useState("name")

  useEffect(() => {
    setRecords();
  }, [])

  const setRecords = () => {
    dispatch({type:'set',  payload:{
      allVendors:vendorData.result,
      records:vendorData.result
    }});
  }

    const onSearch = (event) => {
    const searchValue = event.target.value.toLowerCase();
    const data = allVendors.filter((x) => 
   
      x.name.toLowerCase().includes(searchValue) || 
      x?.code?.toLowerCase().includes(searchValue)
    );
  
    dispatch({type:'toggle', fieldName:'records', payload:data});
  };

  const deleteVendor = async (id, active) => {
      const result = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/vendor/deleteVendor`, {id: id})
      console.log(result)
      if(result.data.status == 'success'){
        openNotification('Success', `Vendor Deleted!`, 'green');
        Router.push('/setup/vendorList')
      } else if (result.data.status == 'deleted') {
        openNotification('Error', `Vendor Already Deleted!`, 'Red');
      } else if(result.data.status == 'transaction') {
        openNotification('Action Denied', `Transaction exists on vendor!`, 'Orange');
      }
    }

  // The title and New on the toolbar (PageActions); Search stays here.
  usePageActions({
    title: 'Vendors',
    new: {
      onClick: () => {
        dispatchNew(incrementTab({"label":"Vendor","key":"2-8","id":"new"}));
        Router.push(`/setup/vendor/new`);
      },
      label: 'New Vendor',
      title: 'Create a new vendor',
    },
  }, []);

  return (
  <div className='base-page-layout'>
    <Row>
      <Col md={12} style={{display:"inline-block"}}><span>Search By :</span>
        <Select placeholder="Search" onChange={(e) => setSearchBy(e)} style={{width:"150px", marginLeft:"5px"}}
          defaultValue={'name'}
          options={[{value : "code", label:"Code"},{value : "name", label:"Name"}]}
        />
        <Input style={{width:"290px", marginLeft:"5px",borderRadius:"5px"}} placeholder={searchBy == 'name' ? "Type Name" : "Type Code"}
          onChange={(e) => onSearch(e)}
        />
        <button className='btn-custom mx-2' onClick={()=> searchVendor() }>Search</button>
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
            <th>Type</th>
            <th>Contact Persons</th>
            <th>Telephones</th>
            <th>Status</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
        {records.map((x, index) => {
          return (
          <tr key={index} className='f row-hov'>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Vendor", "key":"2-8", "id":x.id}));
              Router.push(`/setup/vendor/${x.id}`);
            }} className='blue-txt'>{x.code}</td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Vendor", "key":"2-8", "id":x.id}));
              Router.push(`/setup/vendor/${x.id}`);
            }} className='blue-txt fw-6'>{x.name}</td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Vendor", "key":"2-8", "id":x.id}));
              Router.push(`/setup/vendor/${x.id}`);
            }}>
              {x.types?.split(", ").map((z, i)=>{
              return(<div key={i} className="party-types">{z}</div>)
              })}
            </td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Vendor", "key":"2-8", "id":x.id}));
              Router.push(`/setup/vendor/${x.id}`);
            }}>{x.person1} {x.mobile1}<br/>{x.person2} {x.mobile2}</td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Vendor", "key":"2-8", "id":x.id}));
              Router.push(`/setup/vendor/${x.id}`);
            }}>{x.telephone1}<br/>{x.telephone2}</td>
            <td onClick={()=>{
              dispatchNew(incrementTab({"label":"Vendor", "key":"2-8", "id":x.id}));
              Router.push(`/setup/vendor/${x.id}`);
            }}>
              <td>{x.active?<b className='green-txt'>Active</b>:<b className='red-txt'>Disabled</b>}</td>
            </td>
            <td style={{ textAlign: 'center', verticalAlign: 'middle', height: '40px' }}>
              {/* Disabled RATHER THAN greyed-and-still-clickable, which is what
                  the icon here used to be: an active vendor cannot be deleted, and
                  the tooltip says so instead of a toast appearing after the
                  click. A vendor carries the whole ledger history filed against
                  it. */}
              <RowAction
                Icon={DeleteOutlined} label='Delete' kind='danger'
                disabled={x.active}
                title={x.active ? 'Disable this vendor first' : 'Delete this vendor'}
                confirm={{ what: 'vendor', name: x.name }}
                onClick={()=>deleteVendor(x.id, x.active)}
              />
            </td>
          </tr>
          )
        })}
        </tbody>
        </Table>
      </div>
    </Col>
    </Row>
  </div>
  )
}

export default React.memo(Vendor)
