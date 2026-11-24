import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Menu } from 'antd';
import Cookies from 'js-cookie';
import jwt_decode from 'jwt-decode';
import axiosClient from 'apis/axiosClient';
import AccessControl from './AccessControl';
import DashboardWidgets from './DashboardWidgets';
import NewJobAlerts from './NewJobAlerts';
import BellAlerts from './BellAlerts';
import Companies from './Companies';
import CompanySeparation from './CompanySeparation';
import BankAccounts from './BankAccounts';
import OperationMode from './OperationMode';
import DocumentNumbers from './DocumentNumbers';
import Email from './Email';
import WhatsApp from './WhatsApp';
import LedgerAccounts from './LedgerAccounts';
import PartyAccounts from './PartyAccounts';
import CreditControl from './CreditControl';
import ReportColumns from './ReportColumns';
import Invoices from './Invoices';
import PrintingTemplates from './PrintingTemplates';
import AttachedDocuments from './Documents';
import DirectJob from './DirectJob';
import Migration from './Migration';
import Customs from './Customs';
import CustomsStatuses from './CustomsStatuses';
import CustomsJobScreen from './CustomsJobScreen';
import { Section } from './parts';
import { getMode } from 'functions/terminology';
import { usePageActions } from 'Components/Shared/PageActions';

// Admin-only configuration hub. Gated three ways:
//   1. The sidebar entry only renders for the 'admin' designation.
//   2. This component redirects any non-admin who reaches /config directly.
//   3. The backend routes enforce the admin designation too.
//
// GROUPED, IN A SIDE MENU. Sixteen tabs in one row put Bank Accounts beside
// Operation Mode and Migration beside Report Columns, and nothing said which
// were about money, which about documents and which were one-off install
// steps (the user's request, 2026-10-17). Each group is one question an admin
// comes here with.

// Which section was open, so a reload - Operation Mode asks for one - comes
// back to it. A convenience: unread, the page opens on the Overview.
const LAST_SECTION = 'config.section';
const readLast = () => { try { return window.localStorage.getItem(LAST_SECTION); } catch (_) { return null; } };
const writeLast = (key) => { try { window.localStorage.setItem(LAST_SECTION, key); } catch (_) { /* private window */ } };

const Config = () => {
  const router = useRouter();
  const [allowed, setAllowed] = useState(null); // null = still checking
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [active, setActive] = useState('overview');
  // Every section opened so far stays mounted, hidden, so an unsaved edit in
  // one survives a look at another - as the tabs did.
  const [visited, setVisited] = useState(() => new Set(['overview']));

  useEffect(() => {
    const token = Cookies.get('token');
    if (!token || token === 'undefined') { router.replace('/login'); return; }
    let decoded;
    try { decoded = jwt_decode(token); } catch (_) { router.replace('/login'); return; }
    setUsername(decoded.username || '');
    // Seanet's (or an exempt install's admin) - functions/systemSession.
    if (decoded.system !== true) { router.replace('/'); return; }
    setAllowed(true);
  }, [router]);

  useEffect(() => {
    if (!allowed) return;
    axiosClient.get('/license/info')
      .then(({ data }) => setInfo(data))
      .catch((err) => {
        if (err?.response?.status === 403) router.replace('/');
        else setError('Could not load configuration details.');
      });
  }, [allowed, router]);

  const modeColor =
    info?.mode === 'readonly' ? '#b02a37' : info?.mode === 'warn' ? '#c47d00' : '#237804';

  const Overview = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <Section title='Licence & Installation' style={{ flex: '1 1 320px', minWidth: 300 }}>
        {!info ? <p style={{ color: '#888' }}>Loading…</p> : (
          <table style={{ width: '100%', fontSize: 14 }}><tbody>
            <Row label="Install ID" value={info.installId} />
            <Row label="Status" value={<span style={{ color: modeColor, fontWeight: 600, textTransform: 'capitalize' }}>{info.mode}</span>} />
            {info.paidThrough && <Row label="Paid through" value={new Date(info.paidThrough).toISOString().slice(0, 10)} />}
            {info.daysUntilExpiry != null && <Row label="Days left on subscription" value={info.daysUntilExpiry} />}
            {info.daysRemaining != null && <Row label="Days until read-only" value={info.daysRemaining} />}
            <Row label="App version" value={info.appVersion} />
            <Row label="Licence server" value={info.licenseServerUrl} />
            {info.message && <Row label="Notice" value={info.message} />}
          </tbody></table>
        )}
      </Section>
      <Section title='Session' style={{ flex: '1 1 320px', minWidth: 300 }}>
        <table style={{ width: '100%', fontSize: 14 }}><tbody>
          <Row label="Signed in as" value={username} />
          <Row label="Role" value="admin" />
        </tbody></table>
      </Section>
    </div>
  );

  const customs = getMode() === 'customs';

  // Groups, and the sections in each. `render` is called only once a section
  // is first opened, so a section nobody looks at never fetches anything.
  const GROUPS = [
    { title: 'General', items: [
      { key: 'overview', label: 'Overview', render: () => Overview },
      { key: 'mode', label: 'Operation Mode', render: () => <OperationMode /> },
      // The mail server invoices are sent through.
      { key: 'email', label: 'Email', render: () => <Email /> },
      // The daily WhatsApp update - bookings and invoices, job by job.
      { key: 'whatsapp', label: 'WhatsApp', render: () => <WhatsApp /> },
      // Who is told on screen, within a minute, that a job was created (2026-11-23).
      { key: 'newJobAlerts', label: 'New Job Alerts', render: () => <NewJobAlerts /> },
      // Which designation sees which of the bell's alert lists (2026-11-23).
      { key: 'bellAlerts', label: 'Bell Alerts', render: () => <BellAlerts /> },
    ] },
    { title: 'Companies', items: [
      { key: 'companies', label: 'Companies', render: () => <Companies /> },
      { key: 'banks', label: 'Bank Accounts', render: () => <BankAccounts /> },
      // Which master tables (accounts, parties, charges...) are kept per company.
      { key: 'separation', label: 'Per-company data', render: () => <CompanySeparation /> },
    ] },
    { title: 'Accounting', items: [
      { key: 'ledger', label: 'Ledger Accounts', render: () => <LedgerAccounts /> },
      // Where the Customer / Vendor buttons on Setup > Parties create a ledger.
      { key: 'partyAccounts', label: 'Party Accounts', render: () => <PartyAccounts /> },
      // What a new Direct Job E / R entry starts as - revenue or expense.
      { key: 'directJob', label: 'Direct Job', render: () => <DirectJob /> },
      // Overdue and over-limit parties emailed daily, a weekly ageing to each
      // sales rep, and over-limit parties blocked on new jobs. Off until on.
      { key: 'creditControl', label: 'Credit Control', render: () => <CreditControl /> },
    ] },
    { title: 'Documents & Reports', items: [
      { key: 'docNumbers', label: 'Document Numbers', render: () => <DocumentNumbers /> },
      { key: 'invoices', label: 'Invoices', render: () => <Invoices /> },
      // An invoice, a B/L or an Air Waybill printed from the client's own Word file.
      { key: 'printingTemplates', label: 'Printing Templates', render: () => <PrintingTemplates /> },
      // Scans attached to jobs, vouchers, invoices and Direct Jobs: the folder
      // they are kept in (none chosen, none attached) and their types.
      { key: 'attachedDocuments', label: 'Attached Documents', render: () => <AttachedDocuments /> },
      // Where report dates start, Job Balancing's advances, and the columns
      // the grids open with. Was "Report Columns" until it held more (2026-11-11).
      { key: 'reportColumns', label: 'Reports', render: () => <ReportColumns /> },
    ] },
    // A customs install's only - the others have no customs jobs.
    ...(customs ? [{ title: 'Customs', items: [
      { key: 'customs', label: 'Customs Jobs', render: () => <Customs /> },
      // The job screen's tabs and sections, the S/R Page #'s name, and
      // Essani's other options (2026-11-14).
      { key: 'customsJobScreen', label: 'Job Screen', render: () => <CustomsJobScreen /> },
      { key: 'customsStatuses', label: 'Statuses', render: () => <CustomsStatuses /> },
    ] }] : []),
    { title: 'Security', items: [
      { key: 'access', label: 'Access Control', render: () => <AccessControl /> },
      // Which designation sees which widget on the home page (2026-11-23).
      { key: 'dashboardWidgets', label: 'Dashboard Widgets', render: () => <DashboardWidgets /> },
    ] },
    // One-time legacy Climax import - the /migration endpoints are gated on
    // the backend too.
    { title: 'Tools', items: [
      { key: 'migration', label: 'Migration', render: () => <Migration /> },
    ] },
  ];
  const sections = GROUPS.flatMap((g) => g.items);

  const open = (key) => {
    setActive(key);
    setVisited((v) => (v.has(key) ? v : new Set([...v, key])));
    writeLast(key);
  };

  // The section a link asks for - /config?tab=migration, from Upload Backup -
  // or else back to where the admin was. Once, and only to a section this
  // install has.
  useEffect(() => {
    if (!allowed) return;
    const wanted = router.query?.tab || readLast();
    if (wanted && wanted !== 'overview' && sections.some((s) => s.key === wanted)) open(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, router.query?.tab]);

  // The title on the toolbar (PageActions). Each section saves itself, with
  // its own Save - a page of separate settings, not one record.
  usePageActions({ title: 'Configuration', subtitle: 'Administrator settings for this installation' }, []);

  if (allowed === null) return null;

  return (
    <div className="base-page-layout config-page" style={{ padding: 24 }}>
      {error && <div style={{ color: '#b02a37', marginBottom: 16 }}>{error}</div>}

      <div className='cfg-layout'>
        <nav className='cfg-nav' aria-label='Configuration sections'>
          <Menu
            mode='inline'
            selectedKeys={[active]}
            onClick={({ key }) => open(key)}
            items={GROUPS.map((g) => ({
              type: 'group',
              key: `group-${g.title}`,
              label: g.title,
              children: g.items.map(({ key, label }) => ({ key, label })),
            }))}
          />
        </nav>
        <div className='cfg-body'>
          {sections.filter((s) => visited.has(s.key)).map((s) => (
            <div key={s.key} hidden={s.key !== active} data-section={s.key}>{s.render()}</div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .config-page .cfg-layout { display: flex; gap: 20px; align-items: flex-start; }
        .config-page .cfg-nav {
          flex: 0 0 210px; position: sticky; top: 12px;
          background: #fff; border: 1px solid #e9edf2; border-radius: 8px; padding: 4px 0;
        }
        .config-page .cfg-nav .ant-menu { border-inline-end: none; border-right: none; }
        .config-page .cfg-nav .ant-menu-item-group-title {
          font-size: 10.5px; font-weight: 700; color: #8a97a3;
          text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 16px 2px;
        }
        .config-page .cfg-nav .ant-menu-item { height: 34px; line-height: 34px; margin: 0; }
        .config-page .cfg-body { flex: 1 1 auto; min-width: 0; }
        /* Narrow screens: the menu goes above the section rather than squeezing it. */
        @media (max-width: 900px) {
          .config-page .cfg-layout { flex-direction: column; }
          .config-page .cfg-nav { position: static; flex: none; width: 100%; }
        }
      `}</style>
    </div>
  );
};

const Row = ({ label, value }) => (
  <tr>
    <td style={{ padding: '6px 12px 6px 0', color: '#666', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
    <td style={{ padding: '6px 0', wordBreak: 'break-all' }}>{value}</td>
  </tr>
);

export default Config;
