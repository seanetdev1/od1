import React, { useState, useEffect } from 'react';
import { Row, Col, Spinner, Alert, Modal, Button } from 'react-bootstrap';
import axiosClient from 'apis/axiosClient';
import Router from 'next/router'
import Cookies from 'js-cookie';
import jwt_decode from 'jwt-decode'
// The install id, from the one memoised /health call the browser tab's name
// also comes from - see functions/installInfo.
import { getInstallInfo } from 'functions/installInfo'
import { resetMyPermissions } from 'functions/myPermissions'

const Login = ({sessionData}) => {

    useEffect(() => {
        if(sessionData.isLoggedIn==true){
          Router.push('/')
        }
      }, [sessionData]);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [reveal, setReveal] = useState(false);
    const [load, setLoad] = useState(false);
    const [error, setError] = useState(false);
    const [errorMessage, setErrorMessage] = useState('Wrong username or password');
    const [showForceLoginModal, setShowForceLoginModal] = useState(false);
    const [forceLoginCreds, setForceLoginCreds] = useState({ username: '', password: '' });
    // Seanet support signs in with a credential from the licence server instead
    // of a password - the only way to Config and user management on a leased
    // install (backend functions/systemAccess.js).
    const [supportMode, setSupportMode] = useState(false);
    const [credential, setCredential] = useState('');

    // Which installation is this? Several instances of Odyssey run on the same
    // network - one per customer, sometimes in different operation modes - and
    // their login screens are otherwise pixel-identical, so it is easy to type
    // credentials into the wrong one.
    //
    // /health is the source because this screen is PRE-AUTH: operationMode,
    // companyId and username are cookies set after a successful login, so
    // there is nothing local to read yet. /health is in the backend's
    // PUBLIC_PATHS and already returns installId - the deploy's own
    // INSTALL_ID, e.g. 'odyssey-IFA' - so no backend change was needed.
    //
    // Read through getInstallInfo rather than fetching it here, so this badge
    // and the browser tab's name are the same request and can never disagree
    // about which install this is.
    //
    // The install id rather than a company name on purpose: an installation
    // can hold several companies and none is selected at this point, so a
    // company name would be either ambiguous or a list. The id is one short
    // string that identifies the box.
    const [installId, setInstallId] = useState('');

    useEffect(() => {
      // Silent on failure, deliberately. This is an identifier, not a feature:
      // a backend that is down, or an older build whose /health predates
      // installId, should leave the login screen exactly as it was rather than
      // report an error on the one page a user has no way to act on it.
      // getInstallInfo never rejects, which is what makes that silence safe.
      getInstallInfo().then((info)=>{ setInstallId(info?.installId || ''); })
    }, []);

    const handleForceLogin = () => {
        setLoad(true);
        setError(false);
        axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_EMPLOYEE_LOGIN,{
          username: forceLoginCreds.username,
          password: forceLoginCreds.password,
          contact: '',
          force: true
        }).then((x)=>{
          if(x.data.message=='Success'){
            let token = jwt_decode(x.data.token);
            Cookies.set('token', x.data.token, { expires: 1 });
            resetMyPermissions();
            Cookies.set('designation', token.designation, { expires: 1 });
            Cookies.set('username', token.username, { expires: 1 });
            Cookies.set('loginId', token.id, { expires: 1 });
            if(token.defaultCompanyId){
              Cookies.set('companyId', token.defaultCompanyId, { expires: 1000000000 });
            }
            setShowForceLoginModal(false);
            Router.push('/');
          }else{
            setLoad(false);
            setShowForceLoginModal(false);
            setErrorMessage('Login failed. Please try again.');
            setError(true);
          }
        }).catch((error)=>{
          setLoad(false);
          setShowForceLoginModal(false);
          setErrorMessage(error.response?.data?.message || 'An error occurred. Please try again.');
          setError(true);
        })
    }

    const handleSupportSubmit = (e) => {
        e.preventDefault();
        setLoad(true);
        setError(false);
        axiosClient.post(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/authRoutes/systemLogin`, {
          credential: credential.trim(),
        }).then((x)=>{
          const token = jwt_decode(x.data.token);
          Cookies.set('token', x.data.token, { expires: 1 });
            resetMyPermissions();
          Cookies.set('designation', token.designation, { expires: 1 });
          Cookies.set('username', token.username, { expires: 1 });
          Cookies.set('loginId', token.id, { expires: 1 });
          Router.push('/');
        }).catch((error)=>{
          setLoad(false);
          setErrorMessage(error.response?.data?.message || 'An error occurred. Please try again.');
          setError(true);
        })
    }

    const handleSubmit = (e) =>{
        e.preventDefault(e);
        setLoad(true);
        setError(false);
        axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_EMPLOYEE_LOGIN,{
          username:username,
          password:password,
          contact:''
        }).then((x)=>{
          if(x.data.message=='Success'){
            let token = jwt_decode(x.data.token);
            Cookies.set('token', x.data.token, { expires: 1 });
            resetMyPermissions();
            Cookies.set('designation', token.designation, { expires: 1 });
            Cookies.set('username', token.username, { expires: 1 });
            Cookies.set('loginId', token.id, { expires: 1 });
            if(token.defaultCompanyId){
              Cookies.set('companyId', token.defaultCompanyId, { expires: 1000000000 });
            }
            // Cookies.set('access', JSON.stringify(token.access), { expires: 1 });
            Router.push('/');
          }else if(x.data.message=='Invalid'){
            setLoad(false);
            setErrorMessage('Wrong username or password');
            setError(true);
          }else{
            setLoad(false);
            setErrorMessage('Wrong username or password');
            setError(true);
          }
        }).catch((error)=>{
          setLoad(false);
          if(error.response?.status === 409){
            setForceLoginCreds({ username, password });
            setShowForceLoginModal(true);
          }else if(error.response?.status === 401 || error.response?.status === 400){
            setErrorMessage('Wrong username or password');
            setError(true);
          }else{
            setErrorMessage(error.response?.data?.message || 'An error occurred. Please try again.');
            setError(true);
          }
        })
    }

  return (
    <div className='bg-signin'>
      <Row className='my-5 py-5'>
        <Col md={6} className='p-5'>
        <img src={'/logistic vector.png'} />
        <p style={{color:'grey', fontSize:30, marginLeft:150}}>Logistics ERP System</p>
        </Col>
        <Col md={6} className='p-5'>
        <form onSubmit={supportMode ? handleSupportSubmit : handleSubmit}>
        <div style={{ textAlign:'center'}}>
          {/* Above the heading, and only when known - so a failed /health
              leaves the original layout untouched rather than a gap. */}
          {installId&&<div style={{
            fontSize:11, fontWeight:700, letterSpacing:'0.18em',
            textTransform:'uppercase', color:'rgba(31, 41, 55, 0.65)',
            marginBottom:10, wordBreak:'break-word',
          }}>{installId}</div>}
          <div className='fs-65 fw-8' style={{marginBottom:'25px'}}>LOGIN</div>
          {error&&<Alert style={{marginLeft:'20%', marginRight:'20%'}} key={'danger'} variant={'danger'}>
            {errorMessage}
          </Alert>}
          {!supportMode && <>
          <div className='mb-4'>
            <input className='login-inp' required placeholder='Enter your username...' value={username} onChange={(e)=>setUsername(e.target.value)} />
            <img src={'/username.png'} className='username-img' height={55} />
          </div>
          <div className='mt-4'>
            <input className='login-inp' placeholder='Enter your password...' required type={reveal?'text':'password'} value={password} onChange={(e)=>setPassword(e.target.value)} />
            <img src={reveal?'/pass.png':'/locked.png'} className='username-img' style={{cursor:'pointer'}} height={55} onClick={()=>setReveal(!reveal)} />
          </div>
          </>}
          {supportMode && <div className='mb-4'>
            <textarea className='login-inp' required rows={4} style={{height:'auto', resize:'none', fontFamily:'monospace', fontSize:12}}
              placeholder='Paste the support credential (ods1....)' value={credential} onChange={(e)=>setCredential(e.target.value)} />
          </div>}
          <div className='my-5'>
            <button type='submit' className='login-btn'>{load?<Spinner animation="border" className='mx-3' size='sm' variant="light" />:(supportMode ? 'SIGN IN' : 'LOGIN')}</button>
          </div>
          <div>
            <a href='#' style={{fontSize:12, color:'rgba(31, 41, 55, 0.55)'}}
              onClick={(e)=>{ e.preventDefault(); setSupportMode(!supportMode); setError(false); }}>
              {supportMode ? 'Back to login' : 'Seanet support sign-in'}
            </a>
          </div>
        </div>
        </form>
        </Col>
      </Row>

      <Modal show={showForceLoginModal} onHide={() => setShowForceLoginModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>User Already Logged In</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>This account is currently logged in from another session. Do you want to force login and disconnect the other session?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowForceLoginModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleForceLogin} disabled={load}>
            {load ? <Spinner animation="border" size='sm' className='me-2' /> : ''}
            Force Login
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}

export default Login