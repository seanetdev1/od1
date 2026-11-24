import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Row, Col, Table } from 'react-bootstrap';
import Router from 'next/router';
import { Input, Modal, Pagination, Tag } from 'antd';
import CreateOrEdit from './CreateOrEdit';
import { CheckCircleOutlined, DeleteOutlined, StopOutlined } from '@ant-design/icons';
import axiosClient from 'apis/axiosClient';
import Cookies from 'js-cookie';
import { useQuery } from '@tanstack/react-query';
import { getJobValues } from 'apis/jobs';
import RowAction from 'Components/Shared/RowAction';
import PopConfirm from 'Components/Shared/PopConfirm';
import openNotification from 'Components/Shared/Notification';
import { useMyPermissions } from 'functions/myPermissions';
import { IoMdArrowDropleft } from "react-icons/io";
import { RiShipLine } from "react-icons/ri";
import { BiCurrentLocation } from "react-icons/bi";
import { TbMap2 } from "react-icons/tb";
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
        let returnVal = { ...state, visible: false, edit: false, destinations:[] };
        state.edit?returnVal.selectedRecord={}:null
        return returnVal
      }
      // One vessel changed or gone - on the list as it is NOW, not as it was
      // when the request went out.
      case 'replaceRecord': {
        return { ...state, records: state.records.map((r) => r.id === action.payload.id ? { ...r, ...action.payload } : r) }
      }
      case 'removeRecord': {
        return { ...state, records: state.records.filter((r) => r.id !== action.payload) }
      }
      default: return state
    }
}

const vesselUrl = (path) => `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/vessel/${path}`;

const baseValues = {
  name:"",
  code:"",
  type:"",
  loading:"",
  carrier:""
}

const initialState = {
    records: [],
    load:false,
    visible:false,
    edit:false,
    values:baseValues,
    selectedRecord:{},
    destinations:[],
    destination:""
};

const PAGE_SIZE = 25;

const Vessel = () => {
  const [ state, dispatch ] = useReducer(recordsReducer, initialState);
  const { records, visible } = state;

  /* ONE PAGE AT A TIME, SEARCHED ON THE SERVER - GET /vessel/list (the
   * backend's functions/vesselSearch). The page used to load every vessel
   * (2,104 on SNS) while it was built, and page and search in the browser.
   * The box is sent once typing pauses, and only the newest answer is shown. */
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);
  const latest = useRef(0);
  // After a create, edit, delete or status change: the same page again, so
  // the count, the pages and what is on this one are all the server's.
  const reload = () => setReloads((n) => n + 1);

  useEffect(() => {
    const next = search.trim();
    if (next === query) return;
    const t = setTimeout(() => { setQuery(next); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search, query]);

  useEffect(() => {
    const mine = ++latest.current;
    setLoading(true);
    axiosClient.get(vesselUrl('list'), { params: { page, pageSize: PAGE_SIZE, search: query } })
      .then(({ data }) => {
        if (mine !== latest.current) return;
        // A page left empty by a delete: the one before it.
        if (!data.result.length && data.total && page > 1) { setPage(Math.ceil(data.total / PAGE_SIZE)); return; }
        dispatch({ type: 'toggle', fieldName: 'records', payload: data.result });
        setTotal(data.total);
        setLoading(false);
      })
      .catch((e) => {
        if (mine !== latest.current) return;
        setLoading(false);
        openNotification('Error', e?.response?.data?.result || 'Could not load the vessels.', 'red');
      });
  }, [page, query, reloads]);

  const can = useMyPermissions();
  // The job screen's lists (Vessel picker included) - reloaded after a change.
  const { refetch } = useQuery({ queryKey:['values'], queryFn:getJobValues });

  /* ACTIVE / INACTIVE. Inactive leaves the vessel off the job screen's Vessel
   * picker; the jobs that already have it keep it. */
  const setActive = async (x, active) => {
    try {
      const { data } = await axiosClient.post(vesselUrl('setActive'), { id: x.id, active, employeeId: Cookies.get('loginId') });
      dispatch({ type: 'replaceRecord', payload: data.result });
      reload();
      refetch();
      openNotification('Success', active
        ? `${x.name} is active again, and offered on the job screen.`
        : `${x.name} is inactive - no longer offered on the job screen.`, 'green');
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not change the vessel.', 'red');
    }
  };

  /* DELETE - only a vessel no job uses. The server checks and, for one in
   * use, deletes nothing and says where it is used; making it inactive is
   * then offered instead. */
  const remove = async (x) => {
    try {
      const { data } = await axiosClient.post(vesselUrl('delete'), { id: x.id, employeeId: Cookies.get('loginId') });
      dispatch({ type: 'removeRecord', payload: x.id });
      reload();
      refetch();
      openNotification('Success', data.result, 'green');
    } catch (e) {
      const body = e?.response?.data || {};
      if (body.status === 'inUse') {
        if (body.active === false) {
          openNotification('Not deleted', `${body.result} It is already inactive.`, 'orange', 6);
          return;
        }
        PopConfirm(
          'Make it inactive instead?',
          `${body.result} Inactive, it stays on those jobs but is no longer offered on the job screen.`,
          () => setActive(x, false),
          { okText: 'Make inactive' },
        );
        return;
      }
      openNotification('Error', body.result || 'Could not delete the vessel.', 'red');
    }
  };

  // The title and New on the toolbar (PageActions).
  usePageActions({
    title: 'Vessels',
    new: { onClick: () => dispatch({ type: 'create' }), label: 'New Vessel', title: 'Add a new vessel' },
  }, []);

  return (
    <div className='base-page-layout'>
      <Row>
             
        <Col md={4}>
          <button className='btn-custom'
            onClick={()=>Router.push("/setup/voyage")}
          >View Voyages
          </button>
        </Col>
        <Col md={8} className='d-flex align-items-center justify-content-end' style={{ gap: 10 }}>
          <span style={{ color: 'grey', fontSize: 12, whiteSpace: 'nowrap' }}>
            {loading ? 'Loading...' : `${total} ${query ? 'found' : (total === 1 ? 'vessel' : 'vessels')}`}
          </span>
          <Input.Search
            placeholder='Search name, carrier, code, port... or "inactive"'
            allowClear
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 360 }}
          />
        </Col>
      </Row>
      <hr className='my-2' />
      <Row>
        <Col md={12}>
        <Pagination
          current={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={(p) => setPage(p)}
          size='small'
          showSizeChanger={false}
          hideOnSinglePage
        />
        <div className='table-sm-1 mt-3' style={{maxHeight:500, overflowY:'auto'}}>
          <Table className='tableFixHead'>
          <thead>
            <tr>
              <th>Carrier</th>
              <th>Name</th>
              <th>EGM/IGM</th>
              <th>Type</th>
              <th>Port Of Loading</th>
              <th>Destinations</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
          {!loading && (records || []).length === 0 && (
            <tr><td colSpan={8} className='text-center py-4' style={{ color: 'grey' }}>
              {query ? 'No vessel matches the search.' : 'No vessels yet.'}
            </td></tr>
          )}
          {(records || []).map((x, index) => {
            const inactive = x.active === false;
            return (
            <tr key={x.id ?? index} className={`f row-hov${inactive ? ' vessel-inactive' : ''}`} onClick={()=>dispatch({type:'edit', payload:x})}>
              <td className='blue-txt'><strong>{x.carrier}</strong></td>
              <td>
                <strong>{x.name}</strong>
                {/* The code the job screen's picker shows ("name ~ code"),
                    and the search finds. */}
                {x.code != null && x.code !== '' && <div style={{ fontSize: 12, color: 'grey' }}>Code {x.code}</div>}
              </td>
              <td className='grey-txt'>{x.voyage}</td>
              <td className='blue-txt'>
                {x.type}
                {" "}
                <RiShipLine />
                <span>
                    {
                        x.type=="Export"?<IoMdArrowDropleft className="flip" />:
                        x.type=="Import"?<IoMdArrowDropleft className="" />:
                        <>
                            <IoMdArrowDropleft className="" />
                            <IoMdArrowDropleft className="flip" />
                        </>
                    }
                </span>
              </td>
              <td> <BiCurrentLocation className='mb-1 mx-1 blue-txt'/>{x.loading}</td>
              <td> <TbMap2 className='mb-1 mx-1 blue-txt' size={20} />{x.destinations}</td>
              <td>{inactive ? <Tag>Inactive</Tag> : <Tag color='green'>Active</Tag>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {can('vessels', 'edit') && (inactive
                  ? <RowAction Icon={CheckCircleOutlined} label='Make active' onClick={() => setActive(x, true)}
                      title='Offer it on the job screen again' />
                  : <RowAction Icon={StopOutlined} label='Make inactive' onClick={() => setActive(x, false)}
                      title='Stop offering it on the job screen; jobs that have it keep it' />)}
                {can('vessels', 'delete') && (
                  <RowAction Icon={DeleteOutlined} label='Delete' kind='danger' onClick={() => remove(x)}
                    confirm={{ what: 'vessel', name: x.name,
                      body: 'Its voyages go with it. A vessel that any job uses is not deleted - you will be offered to make it inactive instead.' }} />
                )}
              </td>
            </tr>
            )
          })}
          </tbody>
          </Table>
        </div>
        </Col>
      </Row>
    <Modal
      open={visible}
      onOk={()=>dispatch({ type: 'modalOff' })} onCancel={()=>dispatch({ type: 'modalOff' })}
      width={1000} footer={false} centered={false}
    >
      <CreateOrEdit state={state} dispatch={dispatch} baseValues={baseValues} onSaved={reload} />
    </Modal>
    <style jsx global>{`
      tr.vessel-inactive td { opacity: 0.55; }
      tr.vessel-inactive td:last-child { opacity: 1; }
    `}</style>
    </div>
  )
}

export default Vessel;