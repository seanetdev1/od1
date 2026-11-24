import React, { useEffect, useReducer } from 'react';
import { Row, Col, Table, Spinner } from "react-bootstrap";
import { Modal, Input, Select, DatePicker } from 'antd';
import { CloseCircleOutlined } from '@ant-design/icons';
import { 
  recordsReducer, initialState, proiroties, categories, 
  fetchEmployees, statuses, createTask, fetchTasks,
  updateTask
} from './states';
import moment from 'moment';
import { usePageActions } from 'Components/Shared/PageActions';

const TasksList = () => {

  const [ state, dispatch ] = useReducer(recordsReducer, initialState);
  const set = (payload) => dispatch({type:'set', payload:{ ...payload }});

  const showModal = () => set({isOpen:true, edit:false, task:{}});
  const handleOk = () => set({isOpen:false});
  const handleCancel = () => set({isOpen:false});

  const handleChange = (variable, value) => {
    let temp = state.task;
    temp[variable] = value
    set({task:temp})
  };

  const handleSub = (index, value) => {
    let temp = state.task;
    temp.subTasks[index].title = value
    set({task:temp})
  };

  const append = () => {
    let temp = {...state.task};
    temp.subTasks.push({title:'', status:0});
    set({task:temp})
  };

  const remove = (data, index) => {
    let temp = {...state.task};
    let deleteList = [];
    if(data){
      deleteList = [...state.deleteList];
      deleteList.push(data.id)
    }
    temp.subTasks = temp.subTasks.filter((x, i)=>{
      return index!=i
    });
    set({
      task:temp,
      deleteList:deleteList
    })
  };

  // Files are read to base64 and posted as JSON, matching how the rest of this
  // API works (company logos are already stored as data URLs) - no multipart
  // handling exists server-side and adding it for this would be a bigger change
  // than the feature warrants. The backend caps each file at 15 MB.
  const MAX_ATTACHMENT_MB = 15;

  const onPickFiles = async (e) => {
    const picked = Array.from(e.target.files || []);
    const tooBig = picked.filter((f) => f.size > MAX_ATTACHMENT_MB * 1024 * 1024);
    if (tooBig.length) {
      openNotification(
        'File too large',
        `${tooBig.map((f)=>f.name).join(', ')} exceeds the ${MAX_ATTACHMENT_MB} MB limit.`,
        'red'
      );
    }
    const usable = picked.filter((f) => f.size <= MAX_ATTACHMENT_MB * 1024 * 1024);

    const read = await Promise.all(usable.map((f) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, size: f.size, mimeType: f.type, content: reader.result });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(f);
    })));

    handleChange('attachments', [
      ...(state.task.attachments || []),
      ...read.filter(Boolean),
    ]);
    e.target.value = '';   // let the same file be picked again after removal
  };

  const handleSubmit = async (e) => {
    set({load:true})
    e.preventDefault();
     state.edit? await updateTask(state):await createTask(state.task)
    await getTasks();
  };

  useEffect(() => {
    getEmployees();
    getTasks();
  }, []);

  const getEmployees = () => {
    fetchEmployees().then((x) => {
      set({employeeList:x})
    })
  };

  const getTasks = () => {
    fetchTasks().then((x) => {
      set({taskList:x, edit:false, isOpen:false, load:false})
    })
  };

  const editTask = (x) => {
    set({
      task:{
        ...x,
        due: x.due ? moment(x.due) : null,
        // antd DatePicker wants a moment, and moment(null) is "now" - which
        // would silently invent a deadline for a task that has none.
        softDeadline: x.softDeadline ? moment(x.softDeadline) : null,
        hardDeadline: x.hardDeadline ? moment(x.hardDeadline) : null,
        subTasks:x.Sub_Tasks,
        attachments: [],
      },
      edit:true,
      isOpen:true
    })
  };

  // The title and New on the toolbar (PageActions).
  usePageActions({
    title: 'Tasks',
    new: { onClick: showModal, label: 'New Task', title: 'Create a new task' },
  }, []);

  return (
  <>
    <Row>
    <div className='mt-3' style={{maxHeight:500, overflowY:'auto'}}>
      <Table className='tableFixHead'>
        <thead>
          <tr>
            <th>Title</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Created At</th>
            <th>Due Date</th>
          </tr>
        </thead>
        <tbody>
        {state.taskList.map((x, i)=>{
        return (
          <tr 
            key={x.id} 
            className='row-hov' 
            onClick={()=>editTask(x)}
          >
            <td>{x.title}</td>
            <td style={{color:'orange'}}>{x.priority}</td>
            <td style={{color:'silver'}}><b>{x.status}</b></td>
            <td>{moment(x.createdAt).format("YYYY-MM-DD")}</td>
            <td>{moment(x.due).format("YYYY-MM-DD")}</td>
          </tr>
        )})}
        </tbody>
      </Table>
    </div>
    </Row>
    <Modal 
      open={state.isOpen} 
      onOk={handleOk}
      onCancel={handleCancel} 
      title={state.edit?'Edit A Task':'Create A Task'}
      footer={false}
    >
      <form onSubmit={handleSubmit}>
      <div>Title</div>
      <Input 
        value={state.task.title} onChange={(e)=>handleChange('title', e.target.value)}
        placeholder='Enter Task Title' required
      />
      <div className='mt-2'>Description</div>
      <Input.TextArea
        rows={3}
        value={state.task.description}
        onChange={(e)=>handleChange('description', e.target.value)}
        placeholder='What needs doing, and what does done look like?'
      />
      <button onClick={append} className='btn-custom-small mt-2' type={'button'}>+ Sub Task</button>
      <>
        {state?.task?.subTasks?.map((x, i)=>{
          return(
          <div key={i} className='my-2' style={{display:'flex'}}>
            <Input value={x.title} onChange={(e)=>handleSub(i, e.target.value)} />
            <CloseCircleOutlined className='mx-2 red-txt cur' onClick={()=>remove(x,i)} />
          </div>
        )})}
      </>
      <Row>
        <Col md={6}>
          <div className='mt-2'>Priority</div>
          <Select
            defaultValue="Medium"
            style={{width:'100%'}}
            value={state.task.priority}
            onChange={(e)=>handleChange('priority', e)}
            options={proiroties}
          />
        </Col>
        <Col md={6}>
          <div className='mt-2'>Category</div>
          <Select
            defaultValue="Air"
            style={{width:'100%'}}
            value={state.task.category}
            onChange={(e)=>handleChange('category', e)}
            options={categories}
          />
        </Col>
        <Col md={6}>
          <div className='mt-2'>Assign To</div>
          <Select
            style={{width:'100%'}}
            value={state.task.EmployeeId}
            onChange={(e)=>handleChange('EmployeeId', e)}
            options={state.employeeList.map((x)=>{ return {label:`${x.name} (${x.designation})`, value:x.id} })}
          />
        </Col>
        <Col md={6}>
          <div className='mt-2'>Status</div>
          <Select
            defaultValue="Backlog"
            style={{width:'100%'}}
            value={state.task.status}
            onChange={(e)=>handleChange('status', e)}
            options={statuses}
          />
        </Col>
        <Col md={6}>
          {/* Soft: when it was wanted. Passing it is a nudge, not a failure. */}
          <div className='mt-2'>Soft Deadline</div>
          <DatePicker
            style={{width:'100%'}}
            value={state.task.softDeadline}
            onChange={(e)=>handleChange('softDeadline', e)}
          />
        </Col>
        <Col md={6}>
          {/* Hard: the real one. This is what the dashboard sorts and flags by. */}
          <div className='mt-2'>Hard Deadline</div>
          <DatePicker
            style={{width:'100%'}}
            value={state.task.hardDeadline}
            onChange={(e)=>handleChange('hardDeadline', e)}
          />
        </Col>
        <Col md={12}>
          <div className='mt-2'>Attachments</div>
          <input
            type='file'
            multiple
            onChange={onPickFiles}
            className='form-control'
          />
          {state.task.attachments?.length > 0 && (
            <div className='mt-1' style={{fontSize:12}}>
              {state.task.attachments.map((f, i) => (
                <div key={i}>
                  {f.name} <span className='grey-txt'>({Math.round(f.size/1024)} KB)</span>
                  <CloseCircleOutlined
                    className='mx-2 red-txt cur'
                    onClick={()=>handleChange('attachments', state.task.attachments.filter((_, j)=>j!==i))}
                  />
                </div>
              ))}
            </div>
          )}
          {/* Existing files on a task being edited - uploaded separately, so
              they are listed rather than re-sent with the form. */}
          {state.edit && state.task.Task_Attachments?.length > 0 && (
            <div className='mt-1' style={{fontSize:12}}>
              {state.task.Task_Attachments.map((a) => (
                <div key={a.id}>
                  <a href={`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL || ''}/tasks/attachments/${a.id}`}
                     target='_blank' rel='noreferrer'>{a.originalName}</a>
                  <span className='grey-txt'> ({Math.round((a.size||0)/1024)} KB)</span>
                </div>
              ))}
            </div>
          )}
        </Col>
        <Col md={12}><hr className='mt-3'/></Col>
        <Col md={4}>
          <button className='btn-custom px-5' disabled={state.load} >{!state.load?'Submit':<Spinner size='sm' />}</button>
        </Col>
      </Row>
      </form>
    </Modal>
  </>
  )
}

export default TasksList