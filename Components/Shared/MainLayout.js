import { CloseOutlined, HomeOutlined, DownOutlined } from '@ant-design/icons';
import { AiOutlineLeft, AiOutlineRight } from "react-icons/ai";
import { companySelect, addCompanies, setCompaniesRestricted } from 'redux/company/companySlice';
import { companyToSelect } from 'functions/defaultCompany';
import { fiscalYearSelect, addFiscalYears } from 'redux/fiscalYear/fiscalYearSlice';
import { useSelector, useDispatch } from 'react-redux';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Menu, Select, Dropdown, notification } from 'antd';
import Router, { useRouter } from 'next/router';
import Cookies, { set } from 'js-cookie';
import axiosClient from 'apis/axiosClient';
import LicenseBanner from 'Components/Shared/LicenseBanner';
import LicenseStatusChip from 'Components/Shared/LicenseStatusChip';
import ChangePassword from 'Components/Shared/ChangePassword';
import { PageActionsProvider, PageActionBar } from 'Components/Shared/PageActions';
import BuildVersionChip from 'Components/Shared/BuildVersionChip';
import NotificationBell from 'Components/Shared/NotificationBell';
import NewJobAlerts from 'Components/Shared/NewJobAlerts';
import useMediaQuery from 'functions/useMediaQuery';
import { sectionIcon } from 'functions/sectionIcons';
import HeaderSearch from 'Components/Shared/HeaderSearch';
import openNotification from 'Components/Shared/Notification';
// The one control whose job is to say the keyboard shortcuts exist. Every
// shortcut is already named on the thing it operates; nothing until now said
// that any of them were there. See the component.
import ShortcutsHint from 'Components/Shared/ShortcutsHint';
import { setAccesLevels } from 'functions/setAccesLevels';
import { menuKeyFor, sectionOf, findPage, searchOptions, matchesSearch, accordion } from 'functions/sidebarNav';
import { installTabSelect } from 'functions/tabSelect';
import { RiSearchLine, RiCalendarLine } from 'react-icons/ri';
import logout from 'functions/logout';
import { setTab, HOME_TAB, isPinnedTab } from 'redux/tabs/tabSlice';
// Alt + a number jumps straight to that tab. The rule - which digit means
// which position, when to do nothing, and why Ctrl must be absent - lives in
// the module, where it is tested.
import { isTabJump, isTypingTarget, tabIndexForDigit, SHORTCUT_DIGITS } from 'functions/tabShortcuts';
// Who may change the working fiscal year from this bar. Shared with the
// Fiscal Years page so the header and the page agree about the same user.
import { isAdminDesignation } from 'functions/adminDesignation';
import { SlLogout } from "react-icons/sl";
import { FaRegBell } from "react-icons/fa";
import { incrementTab } from 'redux/tabs/tabSlice';
import Condition from 'yup/lib/Condition';
import { resetState } from 'redux/paymentReciept/paymentRecieptSlice';
import { ledgerReset } from '../../redux/ledger/ledgerSlice';
import { resetOpeningInvoice } from '../../redux/openingInvoices/openingInvoicesSlice';
import { resetVouchers } from '../../redux/vouchers/voucherSlice';
import { resetDirectJob } from '../../redux/directJob/directJobSlice';
import { clearDraft } from 'redux/partyDraft/partyDraftSlice';
import { clearCustomsJobDraft } from 'redux/customsJobDraft/customsJobDraftSlice';
import { ageingResetState } from '../../redux/ageing/ageingSlice';
import { lgResetState } from '../../redux/lgVat/lgSlice';
import { companyLogo } from 'functions/companyBranding';
import { logoBox, isSquarish } from 'functions/logoBox';
import { setTabIcon } from 'functions/tabIcon';
import { rememberPlanning } from 'functions/customsPlanning';
import { rememberReportDates } from 'functions/reportDates';
import { rememberArchive } from 'functions/archive';

const { Header, Content, Sider } = Layout;

/* A company's badge when it has no logo: its short name if that is short,
   else the first letters of its name - CL, SNS. */
function companyMark(c) {
  const short = String(c.short || '').trim();
  if (short && short.length <= 3) return short.toUpperCase();
  const words = String(c.label || short || '?').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

/* A fiscal year's row in the sidebar's picker: its suffix as a badge, then
   the year; a locked one says so. */
function fiscalYearRow(y, locked) {
  return (
    <span className='pick-row'>
      <span className='pick-badge'>{y.suffix || '—'}</span>
      <span className='pick-name'>{y.label}</span>
      {locked && <span className='pick-note'>locked</span>}
    </span>
  );
}

const MainLayout = ({children}) => {

  const searchSelectRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const newRouter = useRouter();
  const dispatch = useDispatch();
  const [username, setUsername] = useState("");
  const [load, setLoad] = useState(true);
  const [company, setCompany] = useState('');
  const [companies, setCompanies] = useState([]);
  const [fiscalYear, setFiscalYear] = useState('');
  const [fiscalYearLabel, setFiscalYearLabel] = useState('');
  /* The years this bar may switch between. Only the UNLOCKED ones: a locked
   * year is frozen and the Fiscal Years page does not offer it either, so a
   * picker that listed it would be offering something the rest of the app
   * refuses. The one exception is handled where the options are built. */
  const [fiscalYearOptions, setFiscalYearOptions] = useState([]);
  /* Read ONCE into state rather than on every render: it comes from a cookie,
   * and a value that could change between two renders of the same bar would
   * make the control appear and disappear. `useState` with an initialiser
   * would run during the server render, where there is no cookie - so it is
   * set in the effect below, and the bar simply shows the read-only chip until
   * it is known. That is the right way round: the chip is what everybody gets,
   * and the picker is the addition. */
  const [canEditFiscalYear, setCanEditFiscalYear] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  /* THE SIDEBAR'S OPEN SECTION - one at a time (functions/sidebarNav
     accordion), and the one the open tab belongs to unless you close it.
     While the menu is collapsed to icons, a section opens as a list beside
     it instead: that is popupKeys, kept apart so collapsing never leaves a
     list hanging open and expanding comes back to the section you had. */
  const [openKeys, setOpenKeys] = useState([]);
  const [popupKeys, setPopupKeys] = useState([]);
  /* Collapsed or not is remembered in this browser - it is how somebody
     likes their screen, not something to choose again every morning. Read
     after mount: there is no browser storage in the server render. */
  useEffect(() => {
    try { if (window.localStorage.getItem('odyssey.sidebarCollapsed') === '1') setCollapsed(true); } catch (e) { /* no storage */ }
  }, []);
  const toggleSidebar = (next) => {
    setCollapsed(next);
    setPopupKeys([]);
    try { window.localStorage.setItem('odyssey.sidebarCollapsed', next ? '1' : '0'); } catch (e) { /* no storage */ }
  };
  /* Clicking a sidebar entry must both MAKE its tab and OPEN it - see
   * getItem in functions/setAccesLevels. Opening is toggleTab, which is
   * declared several hundred lines below this, so it is reached through a ref:
   * calling it directly here would read it before its `const` is initialised
   * and throw on the first render. The ref is written on every render, just
   * under toggleTab itself. */
  const toggleTabRef = useRef(null);
  const items = setAccesLevels(dispatch, collapsed, (tab) => toggleTabRef.current?.(tab));
  const allCompanies = useSelector((state) => state.company.companies);
  const tabs = useSelector((state) => state.tabs.value);
  const tabItems = useSelector((state) => state.tabs.tabs);

  // The selected company's screen logo (Company screen), shown in the sidebar
  // and used as the browser tab's icon - so a tab says which company it is in.
  const screenLogo =
    (Array.isArray(allCompanies) && allCompanies.find(c => String(c.id) === String(company))?.logo)
    || companyLogo(company);
  useEffect(() => { setTabIcon(screenLogo); }, [screenLogo]);
  /* ITS SHAPE (width / height), read once it loads: the sidebar sizes a logo
     by shape, so a square one is not shrunk to a 48px stamp - see
     functions/logoBox. Read off-screen, so the collapsed rail knows it too. */
  const [logoRatio, setLogoRatio] = useState(null);
  useEffect(() => {
    setLogoRatio(null);
    if (!screenLogo || typeof Image === 'undefined') return undefined;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive && img.naturalWidth && img.naturalHeight) setLogoRatio(img.naturalWidth / img.naturalHeight);
    };
    img.src = screenLogo;
    return () => { alive = false; };
  }, [screenLogo]);
  // Back to the shipped icon when the app shell goes (logout, login page).
  useEffect(() => () => setTabIcon(null), []);

  // Tab in a dropdown picks what was typed for, everywhere - functions/tabSelect.
  useEffect(() => installTabSelect(document), []);

  // Focus the Sider search Select on Alt + L
  useEffect(() => {
    const onKeyDown = (e) => {
      // Require Alt + L (case-insensitive)
      const isAltL = e.altKey && (e.key || '').toLowerCase() === 'l';
      if (!isAltL) return;

      // Don't trigger while typing in inputs/textareas/contenteditable
      const t = e.target;
      const isFormField =
        t &&
        (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable);
      if (isFormField) return;

      e.preventDefault();
      e.stopPropagation();

      // If Sider is collapsed, expand first, then focus
      if (collapsed) {
        toggleSidebar(false);
        // Wait for layout to expand
        setTimeout(() => {
          searchSelectRef.current?.focus?.();
          setSearchOpen(true);
        }, 0);
      } else {
        searchSelectRef.current?.focus?.();
        setSearchOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [collapsed]);

  /* The page finder's list is read off the menu on every render (searchPages,
     searchOptions below). It was copied ONCE, on mount - before the install's
     operation mode, Program Book and Archive settings had arrived - so on a
     fresh browser it offered another mode's pages until the next reload. */
  useEffect(() => {
    getCompanies();
    getFiscalYears();
  }, []);

  async function getCompanies(){
    let companyValue = await Cookies.get('companyId');
    let tempUser = await Cookies.get('username');
    if(companyValue){
      dispatch(companySelect(companyValue));
      setCompany(parseInt(companyValue));
    }
    setUsername(tempUser)
    // Cache the installation's operation mode before the sidebar renders, so
    // setAccesLevels() picks the right terminology (freight vs customs).
    await axiosClient.get('/settings/operationMode')
      .then((x)=>{ Cookies.set('operationMode', x.data.mode, { expires: 3650 }); })
      .catch(()=>{});
    // And whether this customs install keeps a Program Book - the sidebar
    // offers it only when Configuration > Customs has job planning on.
    await axiosClient.get('/settings/customsPlanning')
      .then((x)=>{ rememberPlanning(Boolean(x.data?.result?.enabled)); })
      .catch(()=>{});
    // And whether this install keeps old Climax books - the sidebar offers
    // Reports > Archive only when it does (functions/archive).
    await axiosClient.get('/archive/books')
      .then((x)=>{ rememberArchive(Boolean(x.data?.result?.enabled)); })
      .catch(()=>{});
    // The companies THIS user may work in - every one unless Seanet has
    // restricted them - so the picker, and every company list drawn from the
    // store, offers only those. The server refuses the others regardless.
    await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/companies/mine`)
    .then((x)=>{
      setLoad(false);
      // The route replies HTTP 200 even when the query failed - it sends
      // {status:'error', result:<the Error>}. Without this check, `result` (an
      // Error object) went straight into redux and then into a .forEach that
      // threw inside the promise, so the header simply showed no companies and
      // said nothing at all. An empty list and a broken query looked identical.
      const list = x.data?.result;
      if (x.data?.status !== 'success' || !Array.isArray(list)) {
        console.error('getAllCompanies failed:', x.data?.result);
        notification.error({
          key: 'companies-load-failed',
          message: 'Could not load companies',
          description:
            'The server rejected the company list, so the selector is empty. ' +
            'This is a server-side error, not an empty database - check the backend log.',
          duration: 10,
        });
        return;
      }
      dispatch(addCompanies(list))
      dispatch(setCompaniesRestricted(x.data?.restricted))
      // `short` is what the compact header box shows (COMPANY becomes C).
      // `short` and `logo` make the sidebar's picker - each company's badge.
      setCompanies(list.map((c) => ({ value: c.id, label: c.title, short: c.short || c.title, logo: c.logo || companyLogo(c.id) })))
      // No company, or one that does not exist: select the only one there is,
      // or clear the stale value so the user picks. See functions/defaultCompany.
      const pick = companyToSelect(companyValue, list);
      if (pick !== null && pick !== String(companyValue ?? '')) {
        if (pick) Cookies.set('companyId', pick, { expires: 1000000000 });
        else Cookies.remove('companyId');
        setCompany(pick ? parseInt(pick) : undefined);
        dispatch(companySelect(pick));
      }
    })
    .catch((err)=>{
      // There was no .catch at all before, so a rejected request left the
      // loading flag stuck on and produced no message anywhere.
      setLoad(false);
      console.error('getAllCompanies request failed:', err);
      notification.error({
        key: 'companies-load-failed',
        message: 'Could not reach the server',
        description: 'The company list could not be loaded. Check your connection and the backend.',
        duration: 10,
      });
    });
  }

  const handleChange = (value) => {
    Cookies.set('companyId', value, { expires: 1000000000 });
    setCompany(parseInt(value));
    dispatch(companySelect(value))
    Router.push('/')
  };

  /* CHANGE THE WORKING FISCAL YEAR, from the header.
   *
   * The same three steps the Fiscal Years page takes - cookie, store, a word
   * saying which year you are now in - because they are the same act, and two
   * ways of doing it that drifted apart would leave the app's idea of the
   * working year depending on where it was set.
   *
   * IT GOES HOME AFTERWARDS, exactly as changing the company does. The fiscal
   * year decides what `x-fiscal-year-id` every request carries and which
   * series a new document is numbered in, so every list, report and open
   * record on screen belongs to the year you have just left. Staying put would
   * leave the bar saying one year over a page showing another - the quiet kind
   * of wrong where somebody reconciles a report against the wrong period and
   * has no reason to suspect it.
   */
  const changeFiscalYear = (value) => {
    const picked = fiscalYearOptions.find((y) => String(y.id) === String(value));
    Cookies.set('fiscalYearId', value, { expires: 1000000000 });
    dispatch(fiscalYearSelect(value));
    setFiscalYear(parseInt(value));
    setFiscalYearLabel(picked ? `${picked.label} (${picked.suffix})` : '');
    openNotification('Success', `Now working in ${picked ? picked.label : 'the selected fiscal year'}`, 'green');
    Router.push('/');
  };

  // Reads the current selection to display it, keeps the list this bar can
  // switch between, and picks an initial default when nothing has been
  // selected yet. CEO/CFO/admin can change it from here; everyone else does it
  // on the Fiscal Years page, which is visible to all.
  async function getFiscalYears(){
    let fiscalYearValue = await Cookies.get('fiscalYearId');
    await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/fiscalYears/getAll`, {
      headers: { Authorization: Cookies.get('token') }
    })
    .then((x)=>{
      dispatch(addFiscalYears(x.data.result))
      // Where the reports' From and To start, read against the fiscal year
      // that has today in it - remembered for the screens that work their
      // dates out as the app loads (functions/reportDates).
      axiosClient.get('/settings/reportDates')
        .then((s)=>{ if (s.data?.status === 'success') rememberReportDates(s.data.result, x.data?.result); })
        .catch(()=>{});
      // Only a CEO/CFO/admin gets the picker - see the control itself. Read
      // here rather than at render time so it cannot flicker mid-session.
      setCanEditFiscalYear(isAdminDesignation());
      setFiscalYearOptions(Array.isArray(x.data?.result) ? x.data.result : []);

      let selectedId = fiscalYearValue && x.data?.result?.some((y)=>String(y.id)===String(fiscalYearValue))
        ? fiscalYearValue
        : null;

      if(!selectedId){
        // No stored selection (or it no longer points at a real fiscal
        // year) - default to whichever unlocked fiscal year's period
        // covers today, if any.
        const today = new Date().toISOString().slice(0, 10);
        const current = x.data?.result?.find((y)=> !y.isLocked && y.startDate <= today && today <= y.endDate);
        if(current){
          Cookies.set('fiscalYearId', current.id, { expires: 1000000000 });
          selectedId = current.id;
        }
      }

      if(selectedId){
        dispatch(fiscalYearSelect(selectedId));
        setFiscalYear(parseInt(selectedId));
        const match = x.data?.result?.find((y)=>String(y.id)===String(selectedId));
        setFiscalYearLabel(match ? `${match.label} (${match.suffix})` : '');
      }
    });
  }

  useEffect(() => {
    console.log("Router Path", newRouter.pathname)
    /* The dashboard. Its tab is always open (see redux/tabs/tabSlice), so
       unlike every other entry here there is nothing to create - only the
       highlight to set. Without this the app opens on the dashboard with no
       tab marked, which reads as "you are nowhere". */
    if(newRouter.pathname==="/"){
      setToggleState(HOME_TAB.key);
    }
    // When visiting pages inside folders the initial path in url confilts, so to this is mandatory for resolving it
    if(newRouter.pathname==="/reports/jobBalancing/[id]"){
      setToggleState('5-1-1');
    }
    if(newRouter.pathname==="/reports/jobBalancing"){
      setToggleState('5-1');
    }
    if(newRouter.pathname==="/reports/invoiceBalancing"){
      setToggleState('5-6');
    }
    if(newRouter.pathname==="/reports/invoiceBalancing/[id]"){
      setToggleState('5-8');
    }
    if(newRouter.pathname==="/reports/ledger"){
      setToggleState('5-5');
    }
    if(newRouter.pathname==="/reports/ledgerReport/[id]"){
      setToggleState('5-7');
    }
    if(newRouter.pathname==="/reports/trialBalance"){
      setToggleState('5-9');
    }
    if(newRouter.pathname==="/reports/trialBalance/report"){
      setToggleState('5-10');
    }
    if(newRouter.pathname==="/reports/incomeStatement"){
      setToggleState('5-11');
    }
    if(newRouter.pathname==="/reports/ageingReport"){
      setToggleState('5-13');
    }
    if(newRouter.pathname==="/reports/incomeStatement/report"){
      setToggleState('5-12');
    }
    if(newRouter.pathname==="/reports/incomeStatement/comparitive"){
      setToggleState('5-20');
    }
    if(newRouter.pathname==="/reports/ageingReport/report"){
      setToggleState('5-14');
    }
    if(newRouter.pathname==="/reports/auditLog"){
      setToggleState('5-15');
    }
    if(newRouter.pathname==="/reports/auditLog/report"){
      setToggleState('5-16');
    }
    if(newRouter.pathname==="/reports/climaxReconciliation"){
      setToggleState('5-19');
    }
    if(newRouter.pathname==="/reports/lgVat"){
      setToggleState('5-17');
    }
    if(newRouter.pathname==="/reports/lgVat/report"){
      setToggleState('5-18');
    }
    // if(newRouter.pathname==="/reports/ageingReport/summary"){
    //   setToggleState('5-15');
    // }
    if(newRouter.pathname==="/reports/invoice/[id]"){
      setToggleState('3-17');
    }
    if(newRouter.pathname==="/reports/jobPLReport"){
      setToggleState('5-4');
    }
    if(newRouter.pathname==="/reports/jobPLReport/report"){
      setToggleState('5-4-1');
    }
    if(newRouter.pathname==="/reports/jobPLReport/summary"){
      setToggleState('5-4-2');
    }
    if(newRouter.pathname==="/reports/jobPLReport/comparative"){
      setToggleState('5-4-3');
    }
    if(newRouter.pathname==="/airJobs/manifest/[id]"){
      setToggleState('7-8');
    }
    if(newRouter.pathname==="/airJobs/import/bl/[id]"){
      setToggleState('7-6');
    }
    if(newRouter.pathname==="/airJobs/aiJobList"){
      setToggleState('7-4');
    }
    if(newRouter.pathname==="/airJobs/import/[id]"){
      setToggleState('7-5');
    }
    if(newRouter.pathname==="/airJobs/aeJobList"){
      setToggleState('7-1');
    }
    if(newRouter.pathname==="/airJobs/export/[id]"){
      setToggleState('7-2');
    }
    if(newRouter.pathname==="/airJobs/export/bl/[id]"){
      setToggleState('7-3');
    }
    // Aviation. Without these the tab is created and the page loads, but the
    // sidebar/tab strip never marks it active - so the app looks like it did
    // not switch to what you just opened. Every route that opens a tab needs
    // an entry here.
    if(newRouter.pathname==="/setup/carriers"){
      setToggleState('2-14');
    }
    if(newRouter.pathname==="/setup/aircraft"){
      setToggleState('2-15');
    }
    if(newRouter.pathname==="/setup/awbStock"){
      setToggleState('2-16');
    }
    // Freight's AWB Numbers - not the aviation AWB Stock above.
    if(newRouter.pathname==="/setup/awbl"){
      setToggleState('2-17');
    }
    if(newRouter.pathname==="/reports/aviationMonthly"){
      setToggleState('5-21');
    }
    if(newRouter.pathname==="/reports/flightSummary"){
      setToggleState('5-23');
    }
    if(newRouter.pathname==="/reports/salesReport"){
      setToggleState('5-24');
    }
    if(newRouter.pathname==="/aviationJobs/list"){
      setToggleState('10-1');
    }
    if(newRouter.pathname==="/aviationJobs/[id]"){
      setToggleState('10-2');
    }
    if(newRouter.pathname==="/aviationPfm/list"){
      setToggleState('10-3');
    }
    if(newRouter.pathname==="/aviationPfm/[id]"){
      setToggleState('10-4');
    }
    // Customs clearance. Same gap as the aviation routes above: without these
    // the tab is created and the page loads, but nothing ever marks it active.
    if(newRouter.pathname==="/reports/customsRegister"){
      setToggleState('5-22');
    }
    if(newRouter.pathname==="/reports/vatDetail"){
      setToggleState('5-25');
    }
    if(newRouter.pathname==="/reports/agentStatement"){
      setToggleState('5-26');
    }
    if(newRouter.pathname==="/reports/archive"){
      setToggleState('5-27');
    }
    if(newRouter.pathname==="/customsJobs/list"){
      setToggleState('11-1');
    }
    if(newRouter.pathname==="/customsJobs/[id]"){
      setToggleState('11-2');
    }
    if(newRouter.pathname==="/customsPlans"){
      setToggleState('11-3');
    }
    // Configuration had the same gap - it opens but never highlights.
    if(newRouter.pathname==="/config"){
      setToggleState('9-1');
    }
    if(newRouter.pathname==="/seaJobs/import/[id]"){
      setToggleState('4-6');
    }
    if(newRouter.pathname==="/seaJobs/siJobList"){
      setToggleState('4-5');
    }
    if(newRouter.pathname==="seaJobs/import/bl/[id]"){
      setToggleState('4-7');
    }
    if(newRouter.pathname==="/seaJobs/export/[id]"){
      setToggleState('4-3');
    }
    if(newRouter.pathname==="/accounts/openingInvoices/list"){
      setToggleState('3-11');
    }
    if(newRouter.pathname==="/accounts/openingInvoices/[id]" || newRouter.pathname===("/accounts/openingInvoices/new")){
      setToggleState('3-12');
    }
    if(newRouter.pathname==="/accounts/paymentReceipt/[id]" || newRouter.pathname===("/accounts/paymentReceipt/new")){
      setToggleState('3-4');
    }
    if(newRouter.pathname==="/seaJobs/seJobList"){
      setToggleState('4-1');
    }
    if(newRouter.pathname==="/seaJobs/export/bl/[id]"){
      setToggleState('4-4');
    }
    if(newRouter.pathname==="/accounts/vouchers/[id]" || newRouter.pathname==="/accounts/vouchers/new"){
      setToggleState('3-5');
    }
    if(newRouter.pathname==="/accounts/voucherList"){
      setToggleState('3-6');
    }
    if(newRouter.pathname==="/accounts/directJob/[id]" || newRouter.pathname===("/accounts/directJob/new")){
      setToggleState('3-15');
    }
    if(newRouter.pathname==="/accounts/creditControl"){
      setToggleState('3-18');
    }
    if(newRouter.pathname==="/accounts/directJobList"){
      setToggleState('3-16');
    }
    if(newRouter.pathname==="/accounts/officeVouchers/list"){
      setToggleState('3-7');
    }
    if(!newRouter.pathname==="/accounts/officeVouchers/list" && (newRouter.pathname===("/accounts/officeVouchers/[id]") || newRouter.pathname===("/accounts/officeVouchers/new"))){
      setToggleState('3-8');
    }
    if(newRouter.pathname==="/setup/clientList"){
      setToggleState('2-2');
    }
    if(newRouter.pathname==="/setup/client/[id]"){
      setToggleState('2-7');
    }
    if(newRouter.pathname==="/setup/vendorList"){
      setToggleState('2-5');
    }
    if(newRouter.pathname==="/setup/vendor/[id]"){
      setToggleState('2-8');
    }
    if(newRouter.pathname==="/setup/ports"){
      setToggleState('2-10');
    }
    if(newRouter.pathname==="/setup/destinations"){
      setToggleState('2-11');
    }
    if(newRouter.pathname==="/setup/airports"){
      setToggleState('2-12');
    }
    // Fiscal Years, reachable from the FY chip in the header as well as the
    // sidebar. Missing until now, which is half of why that chip behaved the
    // way it did - see the chip.
    if(newRouter.pathname==="/setup/fiscalYears"){
      setToggleState('2-13');
    }
    if(newRouter.pathname==="setup/voyage"){
      setToggleState('2-4');
    }
    if(newRouter.pathname==="tasks/riders/riderAssign/"){
      setToggleState('6-2');
    }
    // console.log("pathname:",newRouter.pathname)
    // console.log("toggleState",toggleState)
  }, [newRouter])

  const [toggleState, setToggleState] = useState(0);
  const [tabActive, setTabActive] = useState({
    home:false,
    requests:false,
    employee:false,
    clientList:false,
    client:false,
    accounts:false,
    history:false,
    vendorList:false,
    vendor:false,
    commodity:false,
    voyage:false,
    seJobList:false,
    siJobList:false,
    seJob:false,
    siJob:false,
    seBl:false,
    siBl:false,
    charges:false,
    invoiceBills:false,
    paymentReceipt:false,
    jobBalancing:false,
    jobBalancingReport:false,
    accountActivity:false,
    balanceSheet:false,
    balanceSheetReport:false,
    voucherSys:false,
    voucherList:false,
    officeVoucherList:false,
    officeVoucher:false,
    openingBalanceList:false,
    openingBalance:false,
    openingInvoicesList:false,
    openingInvoice:false,
    jobPlReport:false,
    jobPlReportPage:false,
    riders:false,
    riderAssign:false,
    taskList:false,
    ledger:false,
    ledgerReport:false,
    invoiceBalancing:false,
    invoiceBalancingReport:false,

    trialBalance:false,
    trialBalanceReport:false,

    incomeStatement:false,
    incomeStatementReport:false,
    ageingReport:false,
    ageingReportReport:false,
    ageingReportSummary:false,
    ageingReportWeekly:false, 
    auditLog:false,
    auditLogReport:false,
    climaxReconciliation:false,
    lgVat:false,
    lgVatReport:false,
    nonGlParties:false,
    aeJobList:false,
    aeJob:false,
    aeBl:false,
    aiJobList:false,
    aiJob:false,
    aiBl:false,
    manifestList:false,
    manifest:false,

  });
  
  const memoizedAlterTabs = () => {
    if(Object.keys(tabs).length>0){
      let tempTabs = [...tabItems];
      let cancel = false;
      // A tab whose key is already open but pointing at a DIFFERENT record.
      // One key is one slot - '10-2' is "the aviation job tab", not "job 4" -
      // so opening a second job reuses it. It used to be skipped outright,
      // which left the old label and, worse, the old id: the tab still read
      // IFA-AVJ-1/27 and clicking it navigated back to that job rather than
      // the one now on screen. Repoint it instead.
      let repointed = false;
      tempTabs.forEach((x,i) => {
        if(x.key==tabs.key){
          cancel = true;
          if(String(x.id ?? '') !== String(tabs.id ?? '')){
            tempTabs[i] = { ...x, ...tabs };
            repointed = true;
          }
        }
      })
      if(repointed){
        dispatch(setTab(tempTabs));
      }
      if(cancel==false){
        tempTabs.push(tabs);
        let tempTabActive = {...tabActive};
        if(tabs.key=='1-1'){ tempTabActive.home=true }
        else if(tabs.key=='1-2'){ tempTabActive.requests=true }
        else if(tabs.key=='2-1'){ tempTabActive.employee=true }
        else if(tabs.key=='2-2'){ tempTabActive.clientList=true }
        else if(tabs.key=='2-7'){ tempTabActive.client=true }
        else if(tabs.key=='2-3'){ tempTabActive.commodity=true }
        else if(tabs.key=='2-4'){ tempTabActive.voyage=true }
        else if(tabs.key=='2-5'){ tempTabActive.vendorList=true }
        else if(tabs.key=='2-8'){ tempTabActive.vendor=true }
        else if(tabs.key=='2-9'){ tempTabActive.nonGlParties=true }
        else if(tabs.key=='2-6'){ tempTabActive.charges=true }
        else if(tabs.key=='3-1'){ tempTabActive.accounts=true }
        else if(tabs.key=='3-3'){ tempTabActive.invoiceBills=true }
        else if(tabs.key=='3-4'){ tempTabActive.paymentReceipt=true }
        else if(tabs.key=='3-5'){ tempTabActive.voucherSys=true }
        else if(tabs.key=='3-6'){ tempTabActive.voucherList=true }
        else if(tabs.key=='3-7'){ tempTabActive.officeVoucherList=true }
        else if(tabs.key=='3-8'){ tempTabActive.officeVoucher=true }
        else if(tabs.key=='3-9'){ tempTabActive.openingBalanceList=true }
        else if(tabs.key=='3-10'){ tempTabActive.openingBalance=true }
        else if(tabs.key=='3-11'){ tempTabActive.openingInvoicesList=true }
        else if(tabs.key=='3-12'){ tempTabActive.openingInvoice=true }
        else if(tabs.key=='3-15'){ tempTabActive.directJob=true }
        else if(tabs.key=='3-16'){ tempTabActive.directJobList=true }
        else if(tabs.key=='4-1'){ tempTabActive.seJobList=true }
        else if(tabs.key=='4-2'){ tempTabActive.seBl=true }
        else if(tabs.key=='4-3'){ tempTabActive.seJob=true }
        else if(tabs.key=='4-4'){ tempTabActive.seBl=true }
        else if(tabs.key=='4-5'){ tempTabActive.siJobList=true }
        else if(tabs.key=='4-6'){ tempTabActive.siJob=true }
        else if(tabs.key=='4-7'){ tempTabActive.siBl=true }
        else if(tabs.key=='5-1'){ tempTabActive.jobBalancing=true }
        else if(tabs.key=='5-1-1'){ tempTabActive.jobBalancingReport=true }
        else if(tabs.key=='5-2'){ tempTabActive.accountActivity=true }
        else if(tabs.key=='5-3'){ tempTabActive.balanceSheet=true }
        else if(tabs.key=='5-3-1'){ tempTabActive.balanceSheetReport=true }
        else if(tabs.key=='5-4'){ tempTabActive.jobPlReport=true }
        else if(tabs.key=='5-4-1'){ tempTabActive.jobPlReportPage=true }
        else if(tabs.key=='5-4-2'){ tempTabActive.jobPlSummaryPage=true }
        else if(tabs.key=='5-4-3'){ tempTabActive.jobPlComparativePage=true }
        else if(tabs.key=='5-5'){ tempTabActive.ledger=true }
        else if(tabs.key=='5-6'){ tempTabActive.invoiceBalancing=true }
        else if(tabs.key=='5-8'){ tempTabActive.invoiceBalancingReport=true }
        else if(tabs.key=='5-7'){ tempTabActive.ledgerReport=true }
        else if(tabs.key=='5-9'){ tempTabActive.trialBalance=true }
        else if(tabs.key=='5-10'){ tempTabActive.trialBalanceReport=true }
        else if(tabs.key=='5-11'){ tempTabActive.incomeStatement=true }
        else if(tabs.key=='5-13'){ tempTabActive.ageingReport=true }
        else if(tabs.key=='5-12'){ tempTabActive.incomeStatementReport=true }
        else if(tabs.key=='5-14'){ tempTabActive.ageingReportReport=true }
        else if(tabs.key=='5-15'){ tempTabActive.auditLog=true }
        else if(tabs.key=='5-16'){ tempTabActive.auditLogReport=true }
        else if(tabs.key=='5-19'){ tempTabActive.climaxReconciliation=true }
        else if(tabs.key=='5-17'){ tempTabActive.lgVat=true }
        else if(tabs.key=='5-18'){ tempTabActive.lgVatReport=true }
        else if(tabs.key=='6-1'){ tempTabActive.riders=true }
        else if(tabs.key=='6-2'){ tempTabActive.riderAssign=true }
        else if(tabs.key=='6-3'){ tempTabActive.taskList=true }
        else if(tabs.key=='7-1'){ tempTabActive.aeJobList=true }
        else if(tabs.key=='7-2'){ tempTabActive.aeJob=true }
        else if(tabs.key=='7-3'){ tempTabActive.aeBl=true }
        else if(tabs.key=='7-4'){ tempTabActive.aiJobList=true }
        else if(tabs.key=='7-5'){ tempTabActive.aiJob=true }
        else if(tabs.key=='7-6'){ tempTabActive.aiBl=true }
        else if(tabs.key=='7-7'){ tempTabActive.manifestList=true }
        else if(tabs.key=='7-8'){ tempTabActive.manifest=true }
        else if(tabs.key=='10-1'){ tempTabActive.aviationJobList=true }
        else if(tabs.key=='10-2'){ tempTabActive.aviationJob=true }
        else if(tabs.key=='10-3'){ tempTabActive.aviationPfmList=true }
        else if(tabs.key=='10-4'){ tempTabActive.aviationPfm=true }
        else if(tabs.key=='11-1'){ tempTabActive.customsJobList=true }
        else if(tabs.key=='11-2'){ tempTabActive.customsJob=true }
        else if(tabs.key=='11-3'){ tempTabActive.customsPlans=true }
        dispatch(setTab(tempTabs))
        //setTabItems(tempTabs);
        // console.log('active',tempTabActive)
        setTabActive(tempTabActive);
      }
    }
  };

  useEffect(() => memoizedAlterTabs(), [tabs]);

  const setKey = (value) => {
    let result = "";
    let index = 0;
    if(tabs.id!=value.id && tabs.key==value.key){
      let tempTabes = [...tabItems];
      tempTabes.forEach((x, i)=>{
        if(x.key==value.key){
          index = i
        }
      })
      tempTabes = tempTabes.filter((x)=>{
        return x.key!=value.key;
      })
      tempTabes.splice(index,0,tabs);
      dispatch(setTab(tempTabes));
      result = tabs.id
    }else{
      result = value.id
    }
    return result
  }

  const toggleTab = (x) => {
    setToggleState(x.key);
    // The pinned dashboard. '/' renders the right one for this install -
    // aviation counters or freight ones - so one tab serves every operation
    // mode. NOT '/dashboard/home', which is the notifications-and-tasks page
    // ('1-1', below) and a different screen entirely.
    if(isPinnedTab(x)){ Router.push('/') }
    else if(x.key=='1-1'){ Router.push('/dashboard/home') }
    else if(x.key=='1-2'){ Router.push('/dashboard/requests') }
    else if(x.key=='2-1'){ Router.push('/employees') }
    else if(x.key=='2-2'){ Router.push('/setup/clientList') }
    else if(x.key=='2-10'){ Router.push('/setup/ports') }
    else if(x.key=='2-11'){ Router.push('/setup/destinations') }
    else if(x.key=='2-12'){ Router.push('/setup/airports') }
    else if(x.key=='2-14'){ Router.push('/setup/carriers') }
    else if(x.key=='2-15'){ Router.push('/setup/aircraft') }
    else if(x.key=='2-16'){ Router.push('/setup/awbStock') }
    else if(x.key=='2-17'){ Router.push('/setup/awbl') }
    else if(x.key=='2-21'){ Router.push('/setup/chargeGroups') }
    else if(x.key=='2-13'){ Router.push('/setup/fiscalYears') }
    else if(x.key=='2-7'){ Router.push(`/setup/client/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='2-3'){ Router.push('/commodity') }
    else if(x.key=='2-4'){ Router.push('/setup/voyage') }
    else if(x.key=='2-5'){ Router.push('/setup/vendorList') }
    else if(x.key=='2-8'){ Router.push(`/setup/vendor/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='2-9'){ Router.push('/setup/nonGlPartiesList') }
    else if(x.key=='2-6'){ Router.push('/charges') }
    else if(x.key=='3-1'){ Router.push('/accounts/chartOfAccount') }
    else if(x.key=='3-2'){ Router.push('/accounts/accountActivity') }
    else if(x.key=='3-3'){ Router.push('/accounts/invoiceAndBills') }
    else if(x.key=='3-4'){ Router.push(`/accounts/paymentReceipt/${setKey(x)}`) }
    // else if(x.key=='3-13'){ Router.push(`/accounts/paymentReceipt/${setKey(x)}`) }
    else if(x.key=='3-5'){ 
      //console.log(x);
      if(x.id){
        Router.push(`/accounts/vouchers/${setKey(x)}`)
      } else {
        setKey({...x, id:'new'})
        Router.push(`/accounts/vouchers/new`)
      }
    } //these routes are also settled in 2nd useEffect
    else if(x.key=='3-6'){ Router.push('/accounts/voucherList') }
    else if(x.key=='3-7'){ Router.push('/accounts/officeVouchers/list') }
    else if(x.key=='3-8'){ Router.push(`/accounts/officeVouchers/${setKey(x)}`) }
    else if(x.key=='3-9'){ Router.push(`/accounts/openingBalance/list`) }
    else if(x.key=='3-10'){ Router.push(`/accounts/openingBalance/${setKey(x)}`) }
    else if(x.key=='3-11'){ Router.push(`/accounts/openingInvoices/list`) }
    else if(x.key=='3-12'){ Router.push(`/accounts/openingInvoices/${setKey(x)}`) }
    else if(x.key=='3-15'){ 
      //console.log(x);
      if(x.id){
        Router.push(`/accounts/directJob/${setKey(x)}`)
      } else {
        // dispatch(resetDirectJob())
        setKey({...x, id:'new'})
        Router.push(`/accounts/directJob/new`)
      }
    }
    // else if(x.key=='3-15'){ Router.push(`/accounts/directJob`) }
    else if(x.key=='3-16'){ Router.push(`/accounts/directJobList`) }
    else if(x.key=='3-18'){ Router.push(`/accounts/creditControl`) }
    else if(x.key=='4-1'){ Router.push('/seaJobs/seJobList') }
    else if(x.key=='4-2'){ Router.push('/seaJobs/export/blList') }
    else if(x.key=='4-3'){ Router.push(`/seaJobs/export/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='4-4'){ Router.push(`/seaJobs/export/bl/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='4-5'){ Router.push('/seaJobs/siJobList') }
    else if(x.key=='4-6'){ Router.push(`/seaJobs/import/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='4-7'){ Router.push(`/seaJobs/import/bl/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='5-21'){ Router.push('/reports/aviationMonthly') }
    else if(x.key=='5-23'){ Router.push('/reports/flightSummary') }
    else if(x.key=='5-24'){ Router.push('/reports/salesReport') }
    else if(x.key=='5-22'){ Router.push('/reports/customsRegister') }
    else if(x.key=='5-25'){ Router.push('/reports/vatDetail') }
    else if(x.key=='5-26'){ Router.push('/reports/agentStatement') }
    else if(x.key=='5-27'){ Router.push('/reports/archive') }
    else if(x.key=='5-1'){ Router.push('/reports/jobBalancing') }
    else if(x.key=='5-1-1'){ Router.push(`/reports/jobBalancing/${setKey(x)}`) }
    else if(x.key=='5-2'){ Router.push('/reports/accountActivity') }
    else if(x.key=='5-3'){ Router.push('/reports/balanceSheet') }
    else if(x.key=='5-3-1'){ Router.push('/reports/balanceSheet/Report') }
    else if(x.key=='5-4'){ Router.push('/reports/jobPLReport') }
    else if(x.key=='5-4-1'){ Router.push(`/reports/jobPLReport/report${setKey(x)}`) }
    else if(x.key=='5-4-2'){ Router.push(`/reports/jobPLReport/summary${setKey(x)}`) }
    else if(x.key=='5-4-3'){ Router.push(`/reports/jobPLReport/comparative${setKey(x)}`) }
    else if(x.key=='5-5'){ Router.push('/reports/ledger') }
    else if(x.key=='5-6'){ Router.push('/reports/invoiceBalancing') }
    else if(x.key=='5-7'){ Router.push(`/reports/ledgerReport/${setKey(x)}`) }
    else if(x.key=='5-8'){ Router.push(`/reports/invoiceBalancing/${setKey(x)}`) }
    else if(x.key=='5-9'){ Router.push(`/reports/trialBalance`) }
    else if(x.key=='5-10'){ Router.push(`/reports/trialBalance/report/${setKey(x)}`) }
    else if(x.key=='5-11'){ Router.push(`/reports/incomeStatement`) }
    else if(x.key=='5-12'){ Router.push(`/reports/incomeStatement/report/${setKey(x)}`) }
    else if(x.key=='5-20'){ Router.push(`/reports/incomeStatement/comparitive/${setKey(x)}`) }
    else if(x.key=='5-13'){ Router.push(`/reports/ageingReport`) }
    else if(x.key=='5-14'){ Router.push(`/reports/ageingReport/report/${setKey(x)}`) }
    else if(x.key=='5-15'){ Router.push(`/reports/auditLog`) }
    else if(x.key=='5-16'){ Router.push(`/reports/auditLog/report/${setKey(x)}`) }
    else if(x.key=='5-19'){ Router.push(`/reports/climaxReconciliation`) }
    else if(x.key=='5-17'){ Router.push(`/reports/lgVat`) }
    else if(x.key=='5-18'){ Router.push(`/reports/lgVat/report/${setKey(x)}`) }
    /* Invoice details. It used to share key '2-11' with Destinations, twenty
       lines above - so this branch was unreachable and clicking an Invoice
       details tab navigated to the seaport master list. One key is one tab
       slot; two screens cannot have the same one. */
    else if(x.key=='3-17'){ Router.push(`/reports/invoice/${setKey(x)}`) }
    else if(x.key=='6-1'){ Router.push('/tasks/riders') }
    else if(x.key=='6-2'){ Router.push(`/tasks/riders/riderAssign/${setKey(x)}`) }
    else if(x.key=='6-3'){ Router.push(`/tasks/list`) }
    else if(x.key=='6-4'){ Router.push(`/tasks/tracking`) }
    else if(x.key=='7-1'){ Router.push('/airJobs/aeJobList') }
    else if(x.key=='7-2'){ Router.push(`/airJobs/export/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='7-3'){ Router.push(`/airJobs/export/bl/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='7-4'){ Router.push(`/airJobs/aiJobList`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='7-5'){ Router.push(`/airJobs/import/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='7-6'){ Router.push(`/airJobs/import/bl/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='7-7'){ Router.push(`/airJobs/manifestList/`) }
    else if(x.key=='7-8'){ Router.push(`/airJobs/manifest/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='10-1'){ Router.push('/aviationJobs/list') }
    else if(x.key=='10-2'){ Router.push(`/aviationJobs/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='10-3'){ Router.push('/aviationPfm/list') }
    else if(x.key=='10-4'){ Router.push(`/aviationPfm/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='11-1'){ Router.push('/customsJobs/list') }
    else if(x.key=='11-2'){ Router.push(`/customsJobs/${setKey(x)}`) } //these routes are also settled in 2nd useEffect
    else if(x.key=='11-3'){ Router.push('/customsPlans') }
    else if(x.key=='9-1'){ Router.push('/config') }
  };

  /* WHAT THE FISCAL-YEAR PICKER OFFERS.
   *
   * The UNLOCKED years, which is what the Fiscal Years page offers a Select
   * on - a locked year is frozen and nothing may be posted into it.
   *
   * PLUS THE CURRENT ONE, ALWAYS, even when it is locked. A year can be locked
   * while somebody is working in it, and dropping it from the list would leave
   * the picker blank over a session that is still in that year - and the first
   * touch of the control would then save a different year than the one the
   * user had been working in all morning. It is shown, and labelled locked, so
   * the state is visible rather than merely survivable. Same rule as the PFM
   * selector and the AWB cell.
   */
  const fiscalYearOptionList = React.useMemo(() => {
    const list = (fiscalYearOptions || []);
    const options = list
      .filter((y) => !y.isLocked)
      // `text` is what the box shows; `label` the dropdown's row - the
      // suffix as a badge, then the year (the 2026-11-23 sidebar look).
      .map((y) => ({ value: y.id, text: `${y.label} (${y.suffix})`, label: fiscalYearRow(y, false) }));

    const current = list.find((y) => String(y.id) === String(fiscalYear));
    if (current && current.isLocked) {
      options.unshift({ value: current.id, text: `${current.label} (${current.suffix}) — locked`, label: fiscalYearRow(current, true) });
    }
    return options;
  }, [fiscalYearOptions, fiscalYear]);

  // Read by the sidebar - see the note by setAccesLevels above. Assigned on
  // every render so it always points at the current closure.
  toggleTabRef.current = toggleTab;

  const removeTab = (key) => {
  /* The dashboard tab does not close. The X is not rendered for it, so this
     only catches the other way in - Alt+W on the tab strip - but it is the
     path that would otherwise close it silently, without the user having
     aimed at anything. The slice puts it back regardless; refusing here is
     what stops the app from navigating away first. */
  if (isPinnedTab(key)) return

  if (key === '3-4') dispatch(resetState())
  if (key === '5-5') dispatch(ledgerReset())
  if (key === '3-12') dispatch(resetOpeningInvoice())
  if (key === '3-5') dispatch(resetVouchers())
  if (key === '3-15') dispatch(resetDirectJob())
  if (key === '5-14') dispatch(ageingResetState())

  const currentIndex = tabItems.findIndex(tab => tab.key === key)

  /* CLOSING A PARTY TAB DISCARDS ITS DRAFT.
   *
   * The draft exists so that SWITCHING tabs does not throw away a half-filled
   * form - the party page unmounts on every switch, and everything typed into
   * it goes with it. Closing the tab is the opposite intention: the user is
   * either finished or has decided against it, and neither of those should
   * leave something behind that offers to restore itself days later.
   *
   * Keyed by the party id the tab was pointing at, because several party tabs
   * can be open at once and closing one must not discard the others' work.
   * Read from the tab BEFORE it is filtered out. */
  if (key === '2-7') {
    const closing = tabItems[currentIndex]
    dispatch(clearDraft(String(closing?.id ?? 'new')))
  }
  // The same for a customs job tab - closing it is how somebody says they are
  // finished with that file, so the draft goes with it rather than being
  // offered back the next time the job is opened.
  if (key === '11-2') {
    const closing = tabItems[currentIndex]
    dispatch(clearCustomsJobDraft(String(closing?.id ?? 'new')))
  }

  const newTabs = tabItems.filter(tab => tab.key !== key)

  dispatch(setTab(newTabs))

  // No tabs left
  if (newTabs.length === 0) {
    Router.push('/')
    return
  }

  // If removed tab was active → select next logical tab
  if (toggleState === key) {
    const nextTab =
      newTabs[currentIndex] || newTabs[currentIndex - 1]

    setToggleState(nextTab.key)
    toggleTab(nextTab)
  }
  // If removed tab was NOT active → do nothing
}

/* ------------------ a tab that closes from somewhere else ------------------
 * removeTab covers the X and the keyboard shortcut, where the user closed the
 * tab and the code that closed it knows which one it was. A tab can also
 * disappear because the RECORD it was showing did - deleting an invoice closes
 * its own tab, see pages/reports/invoice/[id] - and then nobody has moved the
 * user anywhere: the tab bar loses an entry while the page under it still
 * shows the deleted record, and the next click reloads a 404.
 *
 * So: whenever the ACTIVE tab is no longer in the bar, move to its neighbour.
 * The same choice removeTab makes - whatever took its place, else the one
 * before it - so a tab closing itself and a tab being closed by hand leave the
 * user in the same place.
 *
 * A no-op in the ordinary case: removeTab sets the next active tab in the same
 * handler, so by the time this runs toggleState is already a tab that exists.
 * ------------------------------------------------------------------------- */
const previousTabsRef = useRef(tabItems);
useEffect(() => {
  const before = previousTabsRef.current;
  previousTabsRef.current = tabItems;

  if (!toggleState) return;
  if (tabItems.some((t) => t.key === toggleState)) return;

  if (!tabItems.length) {
    Router.push('/');
    return;
  }

  const wasAt = before.findIndex((t) => t.key === toggleState);
  const next = tabItems[wasAt] || tabItems[wasAt - 1] || tabItems[tabItems.length - 1];
  setToggleState(next.key);
  toggleTab(next);
}, [tabItems]);

/* NEXT / PREVIOUS TAB - Alt + PageDown and Alt + PageUp.
 *
 * NOT Alt+Tab, which was what was asked for and which a web page cannot have:
 * Windows takes it for the task switcher before the browser sees the key, so
 * a handler for it would never run. Ctrl+Tab is the same story one level down
 * - Chrome keeps it for its own tabs. Alt+PageDown / PageUp is what Firefox
 * and VS Code use for exactly this, and it reaches the page.
 *
 * Wraps around at both ends: with a handful of tabs open, stopping dead at
 * the last one reads as a broken key rather than a boundary.
 */
useEffect(() => {
  const onKeyDown = (e) => {
    if (!e.altKey) return;
    const key = e.key;
    const forward = key === 'PageDown';
    const back = key === 'PageUp';
    if (!forward && !back) return;

    // Not while typing: a textarea uses PageUp/PageDown itself, and taking
    // them away mid-sentence is worse than not having the shortcut.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    if (tabItems.length < 2) return;

    const at = tabItems.findIndex((x) => x.key === toggleState);
    // An unknown current tab starts from the first rather than nowhere.
    const from = at === -1 ? 0 : at;
    const to = (from + (forward ? 1 : -1) + tabItems.length) % tabItems.length;

    e.preventDefault();
    e.stopPropagation();
    setToggleState(tabItems[to].key);
    toggleTab(tabItems[to]);
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [tabItems, toggleState]);

/* STRAIGHT TO A TAB - Alt + 1..9 and Alt + 0 for the tenth.
 *
 * The strip is read by position: with six or seven tabs open, stepping to the
 * fifth with Alt+PageDown is four keystrokes and a glance to check where you
 * landed. This is one, and it is the shortcut every browser and editor has
 * trained people to reach for.
 *
 * ALT+1 IS THE DASHBOARD, always - it is the pinned tab and is always first
 * (see redux/tabs/tabSlice), so the position is stable in a way none of the
 * others are.
 *
 * The rule itself - which digit means which position, and when to do nothing -
 * is in functions/tabShortcuts, where it is tested. What is left here is the
 * part that needs the component: reading the current tab list and moving to
 * one.
 */
useEffect(() => {
  const onKeyDown = (e) => {
    if (!isTabJump(e)) return;

    // Not while typing. Alt+digit produces a character on several keyboard
    // layouts, and taking it away mid-word is worse than not having the
    // shortcut - the same rule the PageUp/PageDown handler above applies.
    if (isTypingTarget(e.target)) return;

    const to = tabIndexForDigit(e.key, tabItems.length);
    if (to === -1) return;

    const target = tabItems[to];
    if (!target) return;
    // Already there: swallow the key so it cannot fall through and type a
    // digit somewhere, but do not re-navigate - re-pushing the current route
    // remounts the page and would throw away unsaved edits on it.
    e.preventDefault();
    e.stopPropagation();
    if (target.key === toggleState) return;

    setToggleState(target.key);
    toggleTab(target);
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [tabItems, toggleState]);

// Close current tab on Ctrl + Shift + E
useEffect(() => {
  const onKeyDown = (e) => {
    // Require Ctrl + Shift + E
    const isCtrlShiftE =
      e.altKey &&
      // e.ctrlKey &&
      (e.key || '').toLowerCase() === 'w';

    if (!isCtrlShiftE) return;

    // Avoid triggering while typing in inputs, textareas, or contenteditable
    const target = e.target;
    const isFormField =
      target &&
      (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );

    if (isFormField) return;

    if (toggleState) {
      e.preventDefault();
      e.stopPropagation();
      removeTab(toggleState);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [toggleState, removeTab]);


  const searchPages = (e) => {
    const item = findPage(items, e);
    if (!item) return;
    dispatch(incrementTab({ "label": item.label, "key": item.key }))
    toggleTab(item);
  }

  /* WHERE YOU ARE. The entry for the open tab - or for the list a job or a
     report was opened from - is marked, and its section opened, whichever
     way the tab was reached: the menu, the tab strip, a shortcut, a link.
     The menu kept its own idea of "selected" (the last thing clicked in it),
     and marked it in the colour of everything else. */
  const currentPage = menuKeyFor(toggleState, items);
  useEffect(() => {
    if (currentPage) setOpenKeys((keys) => (keys.includes(sectionOf(currentPage)) ? keys : [sectionOf(currentPage)]));
  }, [currentPage]);
  // Collapsed, a section's pages open beside the rail under its name.
  /* THE TAB STRIP (2026-11-15). One row whatever is open: each tab as wide
     as its name, and when they do not all fit the row scrolls sideways, the
     open tab kept in view, and a list of every tab appears at its end. It was a flex row that
     never scrolled - with a dozen tabs open the labels wrapped onto four and
     five lines, the strip grew 100px tall, and the last tabs ran off the
     edge of the screen with the whole page scrolling sideways after them. */
  const tabScrollerRef = useRef(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  // Which ends have tabs past them - those fade out, so a tab cut by the
  // edge reads as "more this way" rather than as a broken one.
  const [tabEdges, setTabEdges] = useState({ left: false, right: false });
  const readTabEdges = () => {
    const el = tabScrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setTabEdges((was) => (was.left === left && was.right === right ? was : { left, right }));
  };
  useEffect(() => {
    const el = tabScrollerRef.current;
    if (!el) return undefined;
    const measure = () => {
      setTabsOverflow(el.scrollWidth > el.clientWidth + 1);
      // A narrower window must not leave the open tab out of sight.
      el.querySelector('.active-tabs')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      readTabEdges();
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabItems.length, load]);
  useEffect(() => {
    const el = tabScrollerRef.current?.querySelector('.active-tabs');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [toggleState, tabItems.length]);
  // A mouse wheel moves the row sideways - most mice have no other way to.
  const scrollTabs = (e) => {
    const el = tabScrollerRef.current;
    if (el && tabsOverflow && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
  };
  const tabListMenu = {
    items: tabItems.map((t, i) => ({
      key: String(i),
      label: <span className={toggleState === t.key ? 'tab-list-current' : undefined}>{t.label}</span>,
    })),
    onClick: ({ key }) => { const t = tabItems[Number(key)]; if (t) toggleTab(t); },
  };

  const sidebarItems = items.map((section) => ({
    ...section,
    popupClassName: 'sider-popup',
    ...(collapsed ? { children: [{ type: 'group', key: `${section.key}-pages`, label: section.label, children: section.children }] } : {}),
  }));
  const openPageFinder = () => {
    toggleSidebar(false);
    setTimeout(() => { searchSelectRef.current?.focus?.(); setSearchOpen(true); }, 0);
  };

  /* THE SIDEBAR'S PICKERS (2026-11-23, the user's mock): a dark list under a
     SWITCH COMPANY / SWITCH FISCAL YEAR heading, each row with its badge - a
     company's logo, or its short name's letters; a year's suffix - and the
     current one in bold. The box itself shows the plain name (optionLabelProp). */
  const companyOptions = companies.map((c) => ({
    value: c.value,
    name: c.label,
    label: (
      <span className='pick-row'>
        {c.logo
          ? <img className='pick-badge pick-logo' src={c.logo} alt='' />
          : <span className='pick-badge'>{companyMark(c)}</span>}
        <span className='pick-name'>{c.label}</span>
      </span>
    ),
  }));
  const pickerHead = (title) => function PickerMenu(menu) {
    return (<><div className='pick-head'>{title}</div>{menu}</>);
  };
  const companyNow = companies.find((c) => String(c.value) === String(company)) || {};
  const companyName = String(companyNow.label || '');
  // A narrower header on smaller screens: the search box shrinks.
  const compactHeader = useMediaQuery('(max-width: 1366px)');
  const fiscalYearNow = (fiscalYearOptions || []).find((y) => String(y.id) === String(fiscalYear));
  /* THE PAGE YOU ARE ON, named in the header (2026-11-23 layout): the open
     tab's name, with its section's icon - the Dashboard's house, Sea Jobs'
     ship - as the sidebar shows it. */
  const openTab = tabItems.find((t) => t.key === toggleState) || tabItems[0];
  const pageIcon = (!openTab || isPinnedTab(openTab) ? null : sectionIcon(openTab.key)) || <HomeOutlined />;
  const pageTitle = openTab?.label || 'Dashboard';

  /* THE WORKING FISCAL YEAR - at the foot of the sidebar since 2026-11-23.
     A CEO/CFO/admin changes it there; everybody else reads it there and
     changes it on the Fiscal Years page, which is open to all. So it is a
     convenience for the people who switch years often, NOT a restriction -
     selecting a year has no server side at all, and the page still offers
     Select to every user. Anything that genuinely had to be restricted would
     have to be restricted in routes/.
     The other button OPENS A TAB, like every other way into a page: it used
     to Router.push on its own, so the Fiscal Years page appeared inside
     whichever tab was open, and that tab went on calling itself something
     else. Collapsed to the rail: the year's suffix alone. */
  const fiscalYearTip = `${fiscalYearLabel ? `${fiscalYearLabel} — ` : ''}the fiscal year you are working in — it sets the series new documents are numbered in, and the period every report covers`;
  const fiscalYearBox = collapsed ? (
    <button type='button' className='sider-fy sider-fy-rail' title={fiscalYearTip}
      onClick={() => { if (!canEditFiscalYear) { dispatch(incrementTab({ label: 'Fiscal Years', key: '2-13' })); Router.push('/setup/fiscalYears'); } else toggleSidebar(false); }}>
      <RiCalendarLine />
      <span>{fiscalYearNow?.suffix || '—'}</span>
    </button>
  ) : canEditFiscalYear ? (
    <div className='sider-fy' title={fiscalYearTip}>
      <RiCalendarLine className='sider-fy-icon' />
      <span className='sider-fy-label'>FY</span>
      <Select
        bordered={false}
        dropdownMatchSelectWidth={false}
        popupClassName='sider-pick-pop'
        dropdownStyle={{ minWidth: 230 }}
        dropdownRender={pickerHead('Switch fiscal year')}
        optionLabelProp='text'
        style={{ flex: '1 1 auto', minWidth: 0 }}
        value={fiscalYear || undefined}
        onChange={changeFiscalYear}
        placeholder='Not selected'
        options={fiscalYearOptionList}
        aria-label='Fiscal year'
      />
    </div>
  ) : (
    <button type='button' className='sider-fy sider-fy-link'
      onClick={() => {
        dispatch(incrementTab({ label: 'Fiscal Years', key: '2-13' }));
        Router.push('/setup/fiscalYears');
      }}
      title={`${fiscalYearTip} — click to open the Fiscal Years page, where it is changed`}>
      <RiCalendarLine className='sider-fy-icon' />
      <span className='sider-fy-label'>FY</span>
      <span className='sider-fy-value'>{fiscalYearLabel || 'Not selected'}</span>
    </button>
  );

  return (
  /* The provider wraps the whole shell so the bar above the tab content and
     the page inside it are looking at the same registration. */
  <PageActionsProvider>
  <Layout className="main-dashboard-layout">
    {!load && 
    /* THE SIDEBAR (2026-11-15). The company's logo, which takes you to the
       Dashboard; a page finder (Alt+L); the sections, one open at a time, with
       the page you are on marked. Collapsed, it is a rail of the sections'
       icons, each opening its list beside it - it was an empty dark strip
       you had to open again to go anywhere. */
    <Sider 
      trigger={null} 
      collapsible 
      collapsed={collapsed} 
      width={224}
      collapsedWidth={64}
      className='side-menu-styles app-sider'>
      <div className='sider-inner'>
        {/* THE COMPANY'S CARD (2026-11-23 layout): its logo, which opens the
            Dashboard, and under it the company you are working in - it changes
            what almost every screen shows. It was a box in the header.
            Collapsed: the logo's mark alone; open the menu to change company. */}
        <div className='sider-brand-card'>
        <button type='button' className='sider-brand' onClick={() => toggleTab(HOME_TAB)} title={`${companyName ? companyName + ' — ' : ''}open the Dashboard`}>
          {/* On the rail a wordmark logo is too small to read: the company's
              initial instead - or the logo itself, when it is square enough
              to read as an icon. Open, a logo is sized by its shape. */}
          {collapsed
            ? (screenLogo && isSquarish(logoRatio)
              ? <img className='sider-brand-icon' src={screenLogo} alt={companyName || 'Dashboard'} />
              : <span className='sider-brand-mark'>{(companyName || 'D').trim().slice(0, 1).toUpperCase()}</span>)
            : screenLogo
              ? <img src={screenLogo} alt={companyName || 'Dashboard'} style={logoBox(logoRatio)} />
              : <span className='sider-brand-text'>{companyName || 'Dashboard'}</span>}
        </button>
        {!collapsed && (
          <div className='sider-company' title={`${companyName ? `${companyName} — ` : ''}the company you are working in — every list, report and document on screen belongs to it`}>
            <Select
              bordered={false}
              dropdownMatchSelectWidth={false}
              popupClassName='sider-pick-pop'
              dropdownStyle={{ minWidth: 270 }}
              dropdownRender={pickerHead('Switch company')}
              optionLabelProp='name'
              style={{ width: '100%' }}
              onChange={handleChange}
              options={companyOptions}
              value={company}
              aria-label='Company'
            />
          </div>
        )}
        </div>
        {!collapsed && <div className='sider-search'>
          <RiSearchLine className='sider-search-icon' aria-hidden />
          <Select
            ref={searchSelectRef}
            showSearch
            open={searchOpen}
            value={null}
            onDropdownVisibleChange={setSearchOpen}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            style={{ width: '100%' }}
            popupClassName='sider-search-dropdown'
            placeholder='Find a page'
            suffixIcon={<span className='sider-kbd'>Alt L</span>}
            notFoundContent='No page by that name'
            onChange={(value) => {
              setSearchOpen(false);
              searchSelectRef.current?.blur?.();
              searchPages(value);
            }}
            filterOption={matchesSearch}
            options={searchOptions(items)}
          />
        </div>}
        {collapsed && <button type='button' className='sider-search-rail' onClick={openPageFinder} title='Find a page (Alt+L)'>
          <RiSearchLine />
        </button>}
        <div className='sider-menu'>
          <Menu
            mode="inline"
            theme='dark'
            items={sidebarItems}
            selectedKeys={currentPage ? [currentPage] : []}
            openKeys={collapsed ? popupKeys : openKeys}
            onOpenChange={collapsed ? setPopupKeys : (keys) => setOpenKeys((current) => accordion(current, keys))}
            onClick={() => setPopupKeys([])}
          />
        </div>
        {/* WHO IS SIGNED IN, AND LOGOUT - at the foot of the sidebar, the
            full width of it, the user over Logout (the user, 2026-11-23; they
            were the right end of the header). The name opens Change Password.
            Collapsed: the initials, and Logout as its icon. */}
        <div className='sider-foot'>
          {fiscalYearBox}
          {/* The licence, the release, and the keyboard shortcuts - small
              standing facts about the session, each explaining itself on
              hover. They were the header's right end. */}
          {!collapsed && (
            <div className='sider-status'>
              <LicenseStatusChip dark />
              <span className='sider-version'><BuildVersionChip /></span>
              <span className='sider-spacer' />
              <ShortcutsHint />
            </div>
          )}
          <ChangePassword username={username} variant='sider' collapsed={collapsed} />
          <button type='button' className='sider-logout' onClick={()=>logout()} title='Sign out — anything unsaved on an open tab is lost'>
            <SlLogout />{!collapsed && <span>Logout</span>}
          </button>
        </div>
      </div>
    </Sider>
    }
    <Layout className="site-layout">
    <Header className="site-layout-background app-header" style={{padding:0}}>
    {/* THE HEADER (2026-11-23 layout, the user's mock): the menu toggle and
        the page you are on, on the left; the search, Critical and the bell on
        the right. The company, the year, the licence, the release, the
        shortcuts, you and Logout are all in the sidebar now. */}
    <div className='app-header-row'>
      <button type='button' className='hdr-toggle' onClick={() => toggleSidebar(!collapsed)}
        title={collapsed ? 'Show the menu' : 'Hide the menu'} aria-label={collapsed ? 'Show the menu' : 'Hide the menu'}>
        {collapsed ? <AiOutlineRight /> : <AiOutlineLeft />}
      </button>
      <div className='hdr-page' title={pageTitle}>
        <span className='hdr-page-icon' aria-hidden='true'>{pageIcon}</span>
        <span className='hdr-page-title'>{pageTitle}</span>
      </div>
      {/* //admin links  */}
      {username=="Saad" &&<>
        <span className='hdr-quick cur' onClick={()=>Router.push("/seaJobs/seJobList")}>SE</span>
        <span className='hdr-quick cur' onClick={()=>Router.push("/seaJobs/siJobList")}>SI</span>
        <span className='hdr-quick cur' onClick={()=>Router.push("/airJobs/aeJobList")}>AE</span>
        <span className='hdr-quick cur' onClick={()=>Router.push("/airJobs/aiJobList")}>AI</span>
        <span className='hdr-quick cur' onClick={()=>{
          dispatch(incrementTab({ "label": "Ports of Discharge", "key": "2-10" }))
          }}>Ports</span>
      </>}
      <span className='hdr-spacer' />
      {/* Jobs, B/L & AWB, invoices, vouchers and parties by number or name -
          Alt+K (2026-11-23). */}
      <HeaderSearch compact={compactHeader} />
      {/* The Critical button and the bell - one popup, Components/Shared/NotificationBell. */}
      <NotificationBell />
    </div>
    </Header>
    <LicenseBanner />
    {/* Asks once a minute for jobs made since - draws nothing itself. */}
    <NewJobAlerts />
    <Content style={{ margin:'16px 16px 24px', padding:0, minHeight:280}}>
    <div className='dashboard-styles'>
      <div className="bloc-tabs">
      <div className={`tab-scroller${tabEdges.left ? ' fade-left' : ''}${tabEdges.right ? ' fade-right' : ''}`}
        ref={tabScrollerRef} onWheel={scrollTabs} onScroll={readTabEdges} role="tablist">
        {tabItems.map((x, index)=>{
          const active = toggleState === x.key;
          return(
          /* MIDDLE CLICK CLOSES A TAB, the way a browser tab does.
             Two handlers because they do different jobs: mousedown stops the
             browser's autoscroll cursor appearing, auxclick is what actually
             fires for the middle button. Closing on mousedown alone would
             close the tab before the button came back up, which is not what a
             click is.

             The dashboard is exempt - it has no X either, for the same reason:
             it is the tab you come back to, and one that can be closed is one
             that will be.

             The whole tab opens it, not only its label. */
          <div key={x.key}
            className={`${active?"tabs active-tabs":"tabs"}${isPinnedTab(x)?" pinned-tab":""}`}
            onClick={()=>toggleTab(x)}
            onMouseDown={(e)=>{ if(e.button === 1 && !isPinnedTab(x)) e.preventDefault(); }}
            onAuxClick={(e)=>{
              if(e.button !== 1 || isPinnedTab(x)) return;
              e.preventDefault();
              removeTab(x.key);
            }}>
            {/* The shortcut is named on the tab it belongs to. A keystroke
                nobody can discover is half a feature, and the first ten tabs
                are exactly the ones a digit can reach - past that the title is
                just the label, rather than claiming a shortcut that does
                nothing. */}
            <button type="button" className="tab-label" role="tab" aria-selected={active}
              onClick={(e)=>{ e.stopPropagation(); toggleTab(x); }}
              title={index < SHORTCUT_DIGITS.length
                ? `${x.label} — Alt+${SHORTCUT_DIGITS[index]}`
                : x.label}>
              {/* Its section's icon - every tab, a B/L or an invoice opened
                  from anywhere included (the user, 2026-11-23). The
                  Dashboard's is the house. */}
              <span className="tab-icon" aria-hidden="true">
                {isPinnedTab(x) ? <HomeOutlined /> : sectionIcon(x.key)}
              </span>
              <span className="tab-text">{x.label}</span>
            </button>
            {/* No X on the dashboard: it is the tab you come back to, and one
                that can be closed is one that will be, leaving the user with
                the same problem this fixed. The space it would take is left
                out with it rather than reserved, so the tab is as wide as its
                own label. */}
            {!isPinnedTab(x) && (
              <CloseOutlined onClick={(e)=>{ e.stopPropagation(); removeTab(x.key); }} className='clos-btn' title={`Close ${x.label}`}/>
            )}
          </div>
        )})}
      </div>
        {/* Every open tab, for when they do not all fit. */}
        {tabsOverflow && (
          <Dropdown menu={tabListMenu} trigger={['click']} placement="bottomRight" overlayClassName="tab-list-dropdown">
            <button type="button" className="tab-overflow" title="All open tabs">
              <span>{tabItems.length}</span><DownOutlined />
            </button>
          </Dropdown>
        )}
      </div>
      {/* THE PAGE'S ACTIONS, outside the tab and above it.
          Same position on every screen, so Save and Delete are never
          somewhere new. A page that declares none renders no bar at all -
          see Components/Shared/PageActions. */}
      <PageActionBar />
      <div className="content-tabs">
        {children}
      </div>
    </div>
    </Content>
    </Layout>
  </Layout>
  </PageActionsProvider>
)};

export default React.memo(MainLayout);
