import { Row, Col, Table } from 'react-bootstrap';
import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { Modal, Input, notification, Pagination } from 'antd';
import CreateOrEdit from './CreateOrEdit';
import { CheckCircleOutlined, CheckOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import Cookies from 'js-cookie';
import axiosClient from 'apis/axiosClient';
import { confirmDelete } from 'Components/Shared/PopConfirm';
import RowAction from 'Components/Shared/RowAction';
import { usePageActions } from 'Components/Shared/PageActions';

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

const baseValues = {
  //Basic Info
  id:'',
  code:"",
  currency:"",
  name:"",
  short:"",
  calculationType:"",
  defaultPaybleParty:"",
  defaultRecivableParty:"",
  taxApply:"No",
  taxPerc:"",
  fixAmount:0.00,
  // Pass-through disbursement rather than revenue. Defaults to false so a new
  // charge behaves exactly as charges did before the flag existed - it has to
  // be turned on deliberately.
  reimbursable:false
}

const initialState = {
    records: [],
    load:false,
    visible:false,
    edit:false,
    search:"",
    values:baseValues,
    // Editing Records
    selectedRecord:{},
};

const PAGE_SIZE = 50;

const Charges = ({chargeData}) => {
  const [ state, dispatch ] = useReducer(recordsReducer, initialState);
  const { records, visible, viewHistory } = state;
  const [ search, setSearch] = useState("")
  const [ currentPage, setCurrentPage ] = useState(1)

  useEffect(() => dispatch({type:'toggle', fieldName:'records', payload:chargeData.result}), [])

  // The whole charge master arrives in one request from getServerSideProps, so
  // paging happens here rather than on the server - search stays instant across
  // the whole catalogue instead of costing a round trip per keystroke.
  const filteredRecords = useMemo(() => (
    records?.filter((x)=>{
        if(
          x.code==search.toLowerCase() ||
          x.name?.toLowerCase().includes(search.toLowerCase()) ||
          x.short?.toLowerCase().includes(search.toLowerCase())||
          x.currency?.toLowerCase().includes(search.toLowerCase())){
          return x
        } else if(search==""){
          return x
        }
    }) || []
  ), [records, search])

  // A narrower search leaves fewer pages than the one you are standing on.
  useEffect(() => setCurrentPage(1), [search])

  // Derived rather than stored, so deleting the last row of the last page
  // cannot strand the table on a page that no longer exists.
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE))
  const activePage = Math.min(currentPage, totalPages)
  const startIndex = (activePage - 1) * PAGE_SIZE
  const pageRecords = filteredRecords.slice(startIndex, startIndex + PAGE_SIZE)

  const openNotification = (title, message, color) => {
    notification.open({
      message: title,
      description: message,
      icon: <ExclamationCircleOutlined style={{ color }} />,
    });
  };

  const deleteCharge = async (x) => {
    try{
      console.log("Deleting Charge with ID:", x.id);
      const deleteResponse = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/charges/delete`, { id: x.id, employeeId: Cookies.get("username") })
      if(deleteResponse.data.status == 'success'){
        openNotification("Success", `${x.name} Deleted Successfully`, "green")
      }else if(deleteResponse.data.status == 'exists'){
        openNotification("Error", `${x.name} cannot be deleted as it is associated with other records`, "red")
      }else{
        openNotification("Error", `Error Deleting ${x.name}`, "red")
      }
    }catch(e){
      console.log(e)
    }
  }

  const statusChange = async (x) => {
    try{
      console.log("Changing Status of Charge with ID:", x.id);
      const statusResponse = await axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/charges/status`, { id: x.id, employeeId: Cookies.get("username") })
      if(statusResponse.data.status == 'success'){
        openNotification("Success", `${x.name} Status Changed Successfully`, "green")
      }else{
        openNotification("Error", `Error Changing Status ${x.name}`, "red")
      }
    }catch(e){
      console.log(e)
    }
  }

  // The title and New on the toolbar (PageActions).
  usePageActions({
    title: 'Charges',
    new: { onClick: () => dispatch({ type: 'create' }), label: 'New Charge', title: 'Add a new charge' },
  }, []);

  return (
    <div className='base-page-layout'>
    <Row>
        <Col></Col>
        <Col>
        <Row>
            <Col md={7}></Col>
            <Col md={5}>
                <Input value={search} placeholder="search"
                    style={{borderRadius:"5px"}}
                    className='ant-input'
                    onChange={(e)=>{
                        setSearch(e.target.value)
                    }}
                />
                </Col>
        </Row>
        </Col>
    </Row>
    <div className='table-sm-1 mt-3' style={{maxHeight:500, overflowY:'auto'}}>
        <Table className='tableFixHead'>
        <thead>
          <tr>
            <th>Code</th>
            <th>Currency</th>
            <th>Name</th>
            <th>Short Name</th>
            <th>Calculation Type</th>
            <th>Default Payble</th>
            <th>Default Receivable</th>
            <th>Status</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {/* {console.log(records)} */}
        {pageRecords.map((x, index) => {
          return (
          // Keyed by id, not index: on a paged list the same index is a
          // different charge from one page to the next, and React would reuse
          // the row rather than re-render it.
          <tr key={x.id ?? index} className='f row-hov' onClick={()=>dispatch({type:'edit', payload:x})}>
            <td>{x.code}</td>
            <td>{x.currency}</td>
            <td>{x.name}</td>
            <td>{x.short}</td>
            <td>{x.calculationType}</td>
            <td>{x.defaultPaybleParty}</td>
            <td>{x.defaultRecivableParty}</td>
            <td><button className={x.status ? 'status-btn-true' : 'status-btn-false'} onClick={(e) => {
                e.stopPropagation()
                console.log(x)
                statusChange(x)
              }}>
              {x.status === false && (
                <CloseCircleOutlined className="delete-icon" style={{ color: '#1f2937', fontSize: '30px' }} />
              )}
              {x.status === true && (
                <CheckCircleOutlined className="delete-icon" style={{ color: '#1f2937', fontSize: '30px' }} />
              )}
              </button></td>
            <td>
              {/* A charge is referenced by every line ever raised on it, so
                  this is the last click before something in the book loses the
                  name of what it was for. */}
              <RowAction
                Icon={DeleteOutlined} label='Delete' kind='danger'
                confirm={{ what: 'charge', name: x.name || x.charges_name }}
                onClick={() => deleteCharge(x)}
              />
            </td>
          </tr>
          )
        })}
        </tbody>
        </Table>
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
      <Pagination
        current={activePage}
        pageSize={PAGE_SIZE}
        total={filteredRecords.length}
        onChange={setCurrentPage}
        showSizeChanger={false}
        showTotal={(total, range) => `Showing ${range[0]}-${range[1]} of ${total}`}
      />
    </div>
    <Modal
      open={visible}
      onOk={()=>dispatch({ type: 'modalOff' })} onCancel={()=>dispatch({ type: 'modalOff' })}
      width={1000} footer={false} centered={false}
    >
      {!viewHistory && <CreateOrEdit state={state} dispatch={dispatch} baseValues={baseValues} />}
      {/* {viewHistory && <History history={state.history} load={state.load} />} */}
    </Modal>
    </div>
  )
}

export default React.memo(Charges)
