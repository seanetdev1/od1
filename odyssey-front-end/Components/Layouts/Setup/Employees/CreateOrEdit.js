import { Form, Input, DatePicker, Select, Checkbox } from "formik-antd";
import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Spinner } from 'react-bootstrap';
import { UnlockOutlined } from '@ant-design/icons';
import { Formik, useFormikContext } from 'formik';
import * as Yup from 'yup';
import axiosClient from 'apis/axiosClient';
import Cookies from 'js-cookie'
import Vouchers from "./Vouchers";
import PermissionGrid from './PermissionGrid';
import { getJobValues } from 'apis/jobs';
import { useQuery } from '@tanstack/react-query';
// import { useFormikContext } from 'formik';
import moment from 'moment';

const SignupSchema = Yup.object().shape({
  empName: Yup.string().min(3, 'Too Short!').max(45, 'Too Long!').required('Required'),
  selectDesignation: Yup.string().required('Required'),
  selectDepart: Yup.string().min(1, 'Too Short!').max(30, 'Too Long!').required('Required'),
  //selectCompany: Yup.string().min(1, 'Required!').max(30, 'Too Long!').required('Required'),
  cnic: Yup.string().min(10, 'Too Short!').max(30, 'Too Long!'),
  userName: Yup.string().min(3, 'Too Short!').max(30, 'Too Long!').required('Required'),
  // Required for a new user only. The backend no longer sends anyone's
  // password hash to the browser, so on an edit there is nothing to pre-fill:
  // blank keeps the current password, anything typed replaces it.
  pass: Yup.string().when('id', {
    is: (id) => Boolean(id),
    then: Yup.string().min(8, 'At least 8 characters').max(64, 'Too Long!'),
    otherwise: Yup.string().min(8, 'At least 8 characters').max(64, 'Too Long!').required('Required'),
  }),
  phone: Yup.string().min(11, 'Must be 11 Digits!').max(11, 'Must be 11 Digits!'),
  email: Yup.string().email('Invalid email address').max(100, 'Too Long!'),
  code: Yup.string().min(1, 'Must be 11 Digits!').max(20, 'Must be 11 Digits!').required('Required'),
});

const MyField = () => {
  const [req, setReq] = useState(false);
  const [managers, setManagers] = useState([]);
  const { values: { selectDesignation }, touched, setFieldValue } = useFormikContext();

  // console.log("selectDesignation",selectDesignation)
  useEffect(() => { getManagers() 
  },[])
  const getManagers = async() => {
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_MANAGERS, {
      // employeeId: Cookies.get("loginId") 
    }).then((x)=>{
      if(x.data.status=='success'){ setManagers(x.data.result) }
    })
  }

  useEffect(() => {
    // String(...) rather than selectDesignation.trim(): this effect runs on
    // the first render, before the edit effect below has populated anything,
    // so the value can legitimately be null or undefined here.
    const designation = String(selectDesignation ?? '').trim();
    if((designation !== '' && touched.selectDesignation) &&(designation=="manager"||designation=="cfo"||designation=="ceo"||designation=="admin")){
      setReq(true) } else { setReq(false); }
  }, [selectDesignation, touched.selectDesignation]);

  return (
    <Select name="selectManager" style={{ width: "100%" }} placeholder="Select Manager" showSearch disabled={req}>
      <Select.OptGroup label="Managers">
        {managers.map((x, index)=>{
          return(<Select.Option value={x.name} key={index}>{x.name}</Select.Option>)
        })}
      </Select.OptGroup>
    </Select>
  );
};

const CreateOrEdit = ({appendClient, edit, setVisible, setEdit, selectedEmployee, updateUser, company}) => {

  // console.log("selectedEmployee",selectedEmployee.Access_Levels[0].access_name)
  const formikRef = useRef(null);
  const { refetch } = useQuery({
    queryKey:['values'],
    queryFn:getJobValues
  });

  const [values, setValues] = useState({
    selectDesignation:'', selectManager: '', defaultCompanyId:'',
    accessLevels:[], selectDepart:'', fatherName: '',
    accountNo: '', userName: '', address: '',
    empName: '', phone: '',  email: '',
    pass: '', cnic: '', bank: '',
    code: '', date:moment().format('YYYY-MM-DD'), id:'', represent:[""],
    companyIds: [],
  });

  const [load, setLoad] = useState(false);
  const [vouchers, setVouchers] = useState(false);
  const [voucherList, setVoucherList] = useState([]);

  useEffect(() => {
    if(edit){
      let tempState = {...values};
      let arr  = [];
      // Access_Levels is only present when the employee was loaded with its
      // include; a row without one is not a reason to crash the form.
      (selectedEmployee.Access_Levels || []).forEach(x => {
        arr.push(x.access_name)
      });

      // Every column here is nullable, and the form's initial values are all
      // ''. Passing null straight through turns a controlled input into an
      // uncontrolled one and - for designation - reaches .trim() on null,
      // which is what broke the form for every employee whose designation had
      // not been set. Migrated users arrive that way deliberately: designations
      // are not inferred from legacy data.
      const orBlank = (v) => (v === null || v === undefined ? '' : v);

      tempState={
        selectDesignation: orBlank(selectedEmployee.designation),
        selectManager: orBlank(selectedEmployee.manager),
        defaultCompanyId: orBlank(selectedEmployee.defaultCompanyId),
        selectDepart: orBlank(selectedEmployee.department),
        fatherName: orBlank(selectedEmployee.fatherName),
        accountNo: orBlank(selectedEmployee.account_no),
        userName: orBlank(selectedEmployee.username),
        address: orBlank(selectedEmployee.address),
        accessLevels:arr,
        empName: orBlank(selectedEmployee.name),
        phone: orBlank(selectedEmployee.contact),
        email: orBlank(selectedEmployee.email),
        pass: '',
        cnic: orBlank(selectedEmployee.cnic),
        bank: orBlank(selectedEmployee.bank),
        code: orBlank(selectedEmployee.code),
        date: orBlank(selectedEmployee.date),
        id: selectedEmployee.id,
        companyIds: (selectedEmployee.companyIds || []).map(String),
      }
      if(typeof selectedEmployee.represent=='string'){
        tempState.represent=selectedEmployee.represent.split(",")
      } else {
        tempState.represent=selectedEmployee.represent
      }
      setValues(tempState);
    }
    return () => { }
  }, [edit, selectedEmployee])

  const loadVouchers = async() => {
    setLoad(true);
    await axiosClient.get(process.env.NEXT_PUBLIC_CLIMAX_GET_VOUCHERS_BY_EPMLOYEE,{
      headers:{'id':`${selectedEmployee.id}`}
    })
    .then((x) => {
      setVoucherList(x.data.result)
      setVouchers(true);
      setLoad(false);
    })
  }

return(
  <div className='employee-styles'>
  <Formik innerRef={formikRef} validateOnChange={false} initialValues={values} validationSchema={SignupSchema} enableReinitialize
    onSubmit={(values, { setSubmitting, resetForm }) => {
      setLoad(true);
      setTimeout(() => {
        setSubmitting(false);
        let tempValues = values
        // represent is optional (only set for sales/doc/agent reps) and is null
        // on employees like the seeded admin - guard against null.toString().
        tempValues.represent = tempValues.represent != null ? tempValues.represent.toString() : '';
        let Username = Cookies.get('username')
        if(edit){
          axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_EDIT_EMPLOYEE,{ values:{ ...tempValues, permissions: tempValues.accessLevels || [] }, updatedBy:Username, employeeId: Cookies.get("loginId") }).then((x)=>{
            // let arr  = [];
            // console.log("x.data.resultTwo",x.data.resultTwo)
            // x.data.resultTwo.forEach(y => {
            //   arr.push({access_name:y.access_name})
            // });
            let arr = (x.data.resultTwo || []).map(y => ({
              access_name: y.access_name
            }));
            let obj = {
                id: values.id,
                name: values.empName,
                fatherName:values.fatherName,
                email: values.email,
                Access_Levels:arr,
                username: values.userName,
                contact: values.phone,
                address: values.address,
                cnic: values.cnic,
                designation: values.selectDesignation,
                department: values.selectDepart,
                manager: values.selectManager,
                defaultCompanyId: values.defaultCompanyId,
                companyIds: values.companyIds,
                represent:values.represent,
                date: values.date,
                bank: values.bank,
                account_no: values.accountNo,
                code: values.code,
                active: 1,
                status: 1
            }
            updateUser(obj);
            setEdit(false);
            setVisible(false);
            setLoad(false);
            refetch();
          })
        } else {
          axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_CREATE_EMPLOYEE,{
            values:{ ...values, permissions: values.accessLevels || [] }, createdBy:Username, employeeId: Cookies.get("loginId")
          }).then((x)=>{
            if(x.data.status=='exists'){
              alert("User Code or Username Already Exists!");
            }else if(x.data.status=='success'){
              appendClient(x.data.result, x.data.resultTwo);
              setVisible(false);
              refetch();
            }
            setLoad(false);
          })
        }
        //resetForm()
      }, 3000);
  }}>
  {({ errors, touched, isSubmitting }) => ( 
    <Form>
      <h6>Employee Form</h6>
      <hr/>
      <Row>
        <Col>
        <Form.Item name="empName" hasFeedback={true} showValidateSuccess={true}>
          <span>Name</span><Input name="empName" placeholder="Employee Name" />
        </Form.Item>
        <Form.Item name="fatherName" hasFeedback={true} showValidateSuccess={true}>
          <span>Father Name</span><Input name="fatherName" placeholder="Father Name" />
        </Form.Item>
        <Form.Item name="selectDepart" hasFeedback={true} showValidateSuccess={true} style={{width:200}}>
          <div>Department</div>
          <Select name="selectDepart" style={{ width: "100%" }} placeholder="Select Department" showSearch>
            <Select.OptGroup label="Departments">
              <Select.Option value='accounts'>Accounts</Select.Option>
              <Select.Option value='operations'>Operations</Select.Option>
              <Select.Option value='export'>Export</Select.Option>
              <Select.Option value='import'>Import</Select.Option>
              <Select.Option value='outdoor'>Outdoor</Select.Option>
              <Select.Option value='port'>Port</Select.Option>
              <Select.Option value='peon'>Peon</Select.Option>
            </Select.OptGroup>
          </Select>
        </Form.Item>
        <Form.Item name="selectDesignation" hasFeedback={true} showValidateSuccess={true} style={{width:200}}>
        <div>Designation</div>
        <Select name="selectDesignation" style={{ width: "100%" }} placeholder="Select Designation" showSearch>
          <Select.OptGroup label="Designations">
            <Select.Option value='manager'>Manager</Select.Option>
            <Select.Option value='gd operator'>GD Operator</Select.Option>
            <Select.Option value='date operator'>Date Operator</Select.Option>
            <Select.Option value='accountant'>Accountant</Select.Option>
            <Select.Option value='ceo'>CEO</Select.Option>
            <Select.Option value='cfo'>CFO</Select.Option>
            <Select.Option value='admin'>Admin</Select.Option>
            <Select.Option value='rider'>Rider</Select.Option>
            <Select.Option value='hr'>HR</Select.Option>
          </Select.OptGroup>
        </Select>
        </Form.Item>
        <Form.Item name="selectManager" hasFeedback={true} showValidateSuccess={true} style={{width:200}}>
          <div>Manager</div><MyField name="selectManager" selectedEmployee={selectedEmployee}  />
        </Form.Item>

        <Form.Item name="defaultCompanyId" hasFeedback={true} showValidateSuccess={true} style={{width:200}}>
          <div>Default Company</div>
          <Select name="defaultCompanyId" style={{ width: "100%" }} placeholder="Select Default Company" showSearch allowClear
            filterOption={(input, option) => (option?.children ?? '').toLowerCase().includes(input.toLowerCase())}>
            <Select.OptGroup label="Companies">
              {company?.map((x, index)=>(
                <Select.Option value={`${x.id}`} key={index}>{x.title}</Select.Option>
              ))}
            </Select.OptGroup>
          </Select>
        </Form.Item>

        {/* None picked = every company, as before. The server refuses
            any other company to someone restricted, and their company
            picker offers only these. */}
        <Form.Item name="companyIds" style={{width:200}}>
          <div>Works In</div>
          <Select name="companyIds" mode="multiple" allowClear style={{ width: "100%" }} placeholder="All companies"
            filterOption={(input, option) => (option?.children ?? '').toLowerCase().includes(input.toLowerCase())}>
            {company?.map((x)=>(
              <Select.Option value={`${x.id}`} key={x.id}>{x.title}</Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="date" >
          <div>Date</div><DatePicker name="date" placeholder="Select Date" />
        </Form.Item>
        </Col>
        <Col>

        <Form.Item name="cnic" hasFeedback={true} showValidateSuccess={true}>
          <div>CNIC</div><Input name="cnic" placeholder="CNIC" style={{width:200}} />
        </Form.Item>

        <Form.Item name="phone" hasFeedback={true} showValidateSuccess={true}>
          <div>Phone No.</div><Input  name="phone" placeholder="Phone Number" style={{width:200}} />
        </Form.Item>

        <Form.Item name="email" hasFeedback={true} showValidateSuccess={true}>
          <div>Email</div><Input name="email" placeholder="Email Address" style={{width:200}} />
        </Form.Item>

        <Form.Item name="address" hasFeedback={true} showValidateSuccess={true}>
          <span>Address</span><Input name="address" placeholder="Address" />
        </Form.Item>

        <Form.Item name="userName" hasFeedback={true} showValidateSuccess={true}>
          <div>User Name</div><Input name="userName" placeholder="Username" style={{width:200}} />
        </Form.Item>

        <Form.Item name="pass" hasFeedback={true} showValidateSuccess={true} style={{width:200}}>
          <span>Password</span><Input.Password name="pass" placeholder={values.id ? 'Leave blank to keep' : 'Password'} autoComplete="new-password" />
        </Form.Item>
        </Col>
        <Col>
        <Form.Item name="code" hasFeedback={true} showValidateSuccess={true} style={{width:200}}>
          <span>Employee Code</span><Input name="code" placeholder="Employee Code" />
        </Form.Item>

        <Form.Item name="bank" hasFeedback={true} showValidateSuccess={true} style={{width:200}}>
          <span>Bank</span><Input name="bank" placeholder="Bank" />
        </Form.Item>
        
        <Form.Item name="accountNo" hasFeedback={true} showValidateSuccess={true}>
          <span>Account No.</span><Input name="accountNo" placeholder="Account No." />
        </Form.Item>

        </Col>
        <div className='my-2' style={{backgroundColor:'silver', height:1}}></div>
        <Col md={4}>
        <Form.Item name="represent" hasFeedback={true} showValidateSuccess={true}>
          <Checkbox.Group
            name="represent"
            options={[
              { label: "Sales Representative", value: "sr" },
              { label: "Doc Representative", value: "dr" },
              { label: "Acc Representative", value: "ar" },
            ]}
          />
        </Form.Item>
        </Col>
        <Col md={12}>
          <h5 className="mt-2">Access <UnlockOutlined style={{position:'relative', bottom:5}} /></h5>
          <PermissionGrid name="accessLevels" />
        </Col>
      </Row>
      <div className="d-flex justify-content-between my-3">
      <button className="btn-custom" style={{ border: 'none' }} type="submit" disabled={isSubmitting}>
    {load ? <Spinner animation="border" role="status" size="sm" className="mx-3" /> : 'Submit'}
  </button>
  <button className="btn-custom" style={{ border: 'none' }} type="button" onClick={loadVouchers}>
    {load ? <Spinner animation="border" role="status" size="sm" className="mx-3" /> : 'Show Vouchers'}
  </button>

</div>
    </Form> 
  )} 
  </Formik>
    {vouchers && <Vouchers vouchers={vouchers} setVouchers={setVouchers} voucherList={voucherList} />}
  </div> 
)}

export default CreateOrEdit
