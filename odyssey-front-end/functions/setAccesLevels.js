import Cookies from "js-cookie";
import { incrementTab } from 'redux/tabs/tabSlice';
// Each section's icon - one map, shared with the tab strip (functions/sectionIcons).
import { sectionIcon } from 'functions/sectionIcons';
import jwt_decode from 'jwt-decode';
import Router from "next/router";
import logout from 'functions/logout';
import { term, hasSeaOperations, isCustomsMode, isAviationMode } from 'functions/terminology';
import { isPlanningOn } from 'functions/customsPlanning';
import { isArchiveOn } from 'functions/archive';
import { isSystemSession } from 'functions/systemSession';
let firstCall = true;
let tempToken;

export const setTempToken = (token, call) => {
  tempToken = token;
  firstCall = call;
};


/**
 * The sidebar.
 *
 * `openTab` is what actually OPENS what was clicked - it sets the active tab
 * and navigates. Clicking a sidebar entry used to only dispatch incrementTab,
 * which appends a tab to the bar and nothing else: the tab appeared but the
 * page under it did not change, so every sidebar click took two - one to make
 * the tab and one to click it. (The search box above the menu always did both;
 * see searchPages in MainLayout, which is the behaviour this now matches.)
 *
 * Passed in rather than imported because it is MainLayout's toggleTab, which
 * owns the active-tab state and every route in the app.
 */
function setAccesLevels(dispatch, collapsed, openTab){
  let items = [];
  let temp = Cookies.get("token")
  if(firstCall && temp != null && temp != "" && temp != "undefined"){
    tempToken = temp;
    firstCall = false;
  }

  
  //getting the token from cookies and decoding it to get the access level array.
  let token = null;
  if(temp != null && temp != "" && temp != "undefined"){
    if(tempToken == temp){
      token = jwt_decode(temp); 
    }else{
      alert('Your session has expired or you have logged in from another device. You will be redirected to the login page.');
      logout();
    }
  }else if(!firstCall){
    logout();
  }

  // Designations are stored lowercase (e.g. 'ceo', 'cfo', 'admin') - compare case-insensitively.
  const designation = (token?.designation || '').toLowerCase();
  // Seanet, or the admin of an exempt install - see functions/systemSession.
  const isSystem = isSystemSession(token);
  const isAdminDesignation = designation === 'admin';
  const isCeoOrCfo = designation === 'ceo' || designation === 'cfo' || isAdminDesignation;
  /* WHAT THE USER MAY OPEN. The session's `access` is ONE STRING of names
     ("ExSea, ImSea, perm:jobCharges:view, ..." - routes/auth makeAccessList),
     and every entry below asked it `.includes(name)` while it was still that
     string - a SUBSTRING test. So "perm:jobCharges:view" put Setup > Charges in
     front of people without the charges right (SNS, 2026-11-15), and "Airports"
     would show Ports. Split into names first, and matched whole.
     The admin designation is everything, as on the server (grants.expand). */
  const access = accessNames(token?.access);
  const isAdmin = isAdminDesignation || access.includes('admin');
  const has = (...names) => isAdmin || names.some((name) => access.includes(name));
  // False in the 'aviation' mode - an airline has no sea operation, so the
  // sea-only parts of the sidebar are not built at all.
  const hasSea = hasSeaOperations();
  // True in the 'customs' mode. Like aviation, it replaces the two freight job
  // sections with one of its own - see where it is used, at the end.
  const isCustoms = isCustomsMode();
  // True in the 'aviation' mode only. Narrower than !hasSea, which is also
  // true under customs: the sales report reads AWBs and their buying/selling
  // rates, which no other mode has.
  const isAviation = isAviationMode();

//getParentItem only returns the section data as objects to store in items array.
  const dashboard = getParentItem('Dashboard', '1', sectionIcon('1'),[

    //getItem only returns the subsection data as objects to store in parents children array.
    getItem('Home', '1-1',<></>, null, {
      label: `Home`,
      key: '1-1',
      children: `Content of Tab Pane 2`,
    }),
    getItem('Requests', '1-2',<></>, null, {
      label: `Requests`,
      key: '1-2',
      children: `Content of Tab Pane 2`,
    }),
  ])
  
  const setup = getParentItem('Setup', '2', sectionIcon('2'),
  [
    //checks whether the given strings are part of the access level array or not, and includes the subsection into the children array of the parent section.
    // Employees page is restricted to CEO/CFO/admin designations, not access levels.
    isCeoOrCfo?getItem('Employees', '2-1', <></>, null, {
      label: 'Employees',
      key: '2-1',
      children: 'Content of Tab Pane 2',
    }):null,
    // Parties is open to every user (they can create name-only / non-GL
    // parties). Only CEO/CFO/admin can attach a ledger, enforced in the form
    // and on the backend (routes/clients createClient/editClient).
    getItem('Parties', '2-2',<></>, null, {
      label: `Parties`,
      key: '2-2',
      children: `Content of Tab Pane 2`,
    }),
    // (levels?.includes("Parties")||levels?.includes("admin"))?getItem('Parties', '2-20',<></>, null, {
    //   label: `Parties`,
    //   key: '2-20',
    //   children: `Content of Tab Pane 2`,
    // }):null,
    // (levels?.includes("VendorList")||levels?.includes("admin"))?getItem('Vendor List', '2-5',<></>, null, {
    //   label: `Vendor List`,
    //   key: '2-5',
    //   children: `Content of Tab Pane 2`,
    // }):null,
    // (levels?.includes("NonGLParties")||levels?.includes("admin"))?getItem('Non-GL Parties', '2-9',<></>, null, {
    //   label: `Non-GL Parties`,
    //   key: '2-9',
    //   children: `Content of Tab Pane 2`,
    // }):null,
    has("Commodity")?getItem('Commodity', '2-3',<></>, null, {
      label: `Commodity`,
      key: '2-3',
      children: `Content of Tab Pane 2`,
    }):null,
    // Vessels and their voyages - a ship's sailing. An airline has no use for
    // it, so it goes with Ports and Destinations in aviation mode.
    (hasSea && has("Voyage"))?getItem('Voyage', '2-4',<></>, null, {
      label: `Voyage`,
      key: '2-4',
      children: `Content of Tab Pane 2`,
    }):null,
    has("Charges")?getItem('Charges', '2-6',<></>, null, {
      label: `Charges`,
      key: '2-6',
      children: `Content of Tab Pane 2`,
    }):null,
    /* Charge Groups - default charge sets per kind of client. Customs only:
       it is the clearance charge sheet that imports them, and a freight or
       aviation install has no button to do it from. */
    (isCustoms && has("Charges"))
      ? getItem('Charge Groups', '2-21',<></>, null, {
        label: `Charge Groups`,
        key: '2-21',
        children: `Content of Tab Pane 2`,
      }):null,
    // Ports and Destinations are the seaport master lists. An aviation install
    // keeps Airports below and drops both of these.
    (hasSea && has("Ports"))?getItem('Ports', '2-10',<></>, null, {
      label: `Ports`,
      key: '2-10',
      children: `Content of Tab Pane 2`,
    }):null,
    (hasSea && has("Destinations"))?getItem('Destinations', '2-11',<></>, null, {
      label: `Destinations`,
      key: '2-11',
      children: `Content of Tab Pane 2`,
    }):null,
    has("Airports")?getItem('Airports', '2-12',<></>, null, {
      label: `Airports`,
      key: '2-12',
      children: `Content of Tab Pane 2`,
    }):null,
    // AWB Numbers - freight only. The air waybill stock the freight air-export
    // jobs draw their MAWB from, held against airline PARTIES. Not the
    // aviation register below (AWB Stock, 2-16), which belongs to carriers and
    // master agents. Key 2-17 because 2-14 - the key this page had on the
    // install it came from - is Carriers here.
    (hasSea && has("AWBL"))?getItem('AWB Numbers', '2-17',<></>, null, {
      label: `AWB Numbers`,
      key: '2-17',
      children: `Content of Tab Pane 2`,
    }):null,
    // Carriers - aviation only. Each holds its AWB prefix and the ER/IFA/Other
    // tag the monthly sector report counts uplift by, so it has no meaning in
    // a freight or customs install.
    (!hasSea && has("Airports"))?getItem('Carriers', '2-14',<></>, null, {
      label: `Carriers`,
      key: '2-14',
      children: `Content of Tab Pane 2`,
    }):null,
    // Aircraft - aviation only. The report splits each sector by aircraft, so
    // a flight picks one of these rather than carrying typed text.
    (!hasSea && has("Airports"))?getItem('Aircraft', '2-15',<></>, null, {
      label: `Aircraft`,
      key: '2-15',
      children: `Content of Tab Pane 2`,
    }):null,
    // AWB Stock - aviation only. The register of air waybill numbers the
    // office holds and which master agent each was given to. An AWB number is
    // an airline document, so it has no meaning in a freight or customs
    // install; it sits with Carriers because the carrier owns the prefix every
    // number is built from.
    (!hasSea && has("Airports"))?getItem('AWB Stock', '2-16',<></>, null, {
      label: `AWB Stock`,
      key: '2-16',
      children: `Content of Tab Pane 2`,
    }):null,
    // Visible to everyone - every user selects their own working fiscal
    // year here; only CEO/CFO/admin see the create/edit/lock controls
    // once on the page (enforced in the page itself + the backend routes).
    getItem('Fiscal Years', '2-13',<></>, null, {
      label: `Fiscal Years`,
      key: '2-13',
      children: `Content of Tab Pane 2`,
    }),
  ]
  )
  const accounts = getParentItem('Accounts', '3', sectionIcon('3'),
  [
    has("ChartOfAccount")?getItem('Chart Of Account', '3-1',<></>, null, {
      label: `Chart Of Account`,
      key: '3-1',
      children: `Content of Tab Pane 2`,
    }):null,
    has("Invoice/Bills")?getItem('Invoice / Bills', '3-3',<></>, null, {
      label: `Invoice / Bills`,
      key: '3-3',
      children: `Content of Tab Pane 2`,
    }):null,
    has("Payment/Reciept")?getItem('Payment / Receipt', '3-4',<></>, null, {
      label: `Payment / Receipt`,
      key: '3-4',
      children: `Content of Tab Pane 2`,
    }):null,
    has("Voucher")?getItem('Voucher', '3-5',<></>, null, {
      label: `Voucher`,
      key: '3-5',
      children: `Content of Tab Pane 2`,
    }):null,
    has("VoucherList")?getItem('Voucher List', '3-6',<></>, null, {
      label: `Voucher List`,
      key: '3-6',
      children: `Content of Tab Pane 2`,
    }):null,
    has("DirectJobList")?getItem('Direct Job E / R', '3-15',<></>, null, {
      label: `Direct Job E / R`,
      key: '3-15',
      children: `Content of Tab Pane 2`,
    }):null,
    has("DirectJobList")?getItem('Direct Job List', '3-16',<></>, null, {
      label: `Direct Job List`,
      key: '3-16',
      children: `Content of Tab Pane 2`,
    }):null,
    // Approving blocked parties and omitting invoices - the approvers are set
    // in Config > Credit Control (CEO / CFO by default); the server checks.
    isCeoOrCfo?getItem('Credit Control', '3-18',<></>, null, {
      label: `Credit Control`,
      key: '3-18',
      children: `Content of Tab Pane 2`,
    }):null,
    // (levels?.includes("OfficeVoucherList")||levels?.includes("admin"))?getItem('Office Voucher List', '3-7',<></>, null, {
    //   label: `Office Voucher List`,
    //   key: '3-7',
    //   children: `Content of Tab Pane 3-7`,
    // }):null,
    has("OpeningBalances")?getItem('Opening Balances', '3-9',<></>, null, {
      label: `Opening Balances`,
      key: '3-9',
      children: `Content of Tab Pane 3-7`,
    }):null,
    has("OpeningInvoises")?getItem('Opening Invoices', '3-11',<></>, null, {
      label: `Opening Invoices`,
      key: '3-11',
      children: `Content of Tab Pane 3-11`,
    }):null   
  ]
  )
  const reports = getParentItem('Reports', '5', sectionIcon('5'),
  [
    // Aviation only: the monthly sector report, shaped after the workbook the
    // department already keeps.
    (!hasSea && has("JobBalancing"))?getItem('Aviation Monthly', '5-21',<></>, null, {
      label: `Aviation Monthly`,
      key: '5-21',
      children: `Content of Tab Pane 2`,
    }):null,
    // Aviation only: the per-flight summary. Sits BESIDE the sector report
    // rather than replacing it - that one is shaped after the department's
    // workbook, this one answers what happened on each flight and what did
    // not fly.
    (!hasSea && has("JobBalancing"))?getItem('Flight Summary', '5-23',<></>, null, {
      label: `Flight Summary`,
      key: '5-23',
      children: `Content of Tab Pane 2`,
    }):null,
    // Aviation only: one row per approved AWB, what it was bought at against
    // what it was sold at. The two reports above are about weight moved; this
    // is the money made on it.
    (isAviation && has("JobBalancing"))?getItem('Sales Report', '5-24',<></>, null, {
      label: `Sales Report`,
      key: '5-24',
      children: `Content of Tab Pane 2`,
    }):null,
    // Customs only: the duty register - every GD filed in a month, its duty by
    // head, and what the agent is owed back. Meaningless anywhere else, since
    // no other mode files declarations.
    (isCustoms && has("JobBalancing"))?getItem('Customs Register', '5-22',<></>, null, {
      label: `Customs Register`,
      key: '5-22',
      children: `Content of Tab Pane 2`,
    }):null,
    // Customs only: the VAT Detail - every Sale Tax Invoice in a period, for
    // the sales tax return. Sale Tax Invoices are raised on customs invoices;
    // an accounts report, so it goes with the Trial Balance's access.
    (isCustoms && has("TrialBalance"))?getItem('VAT Detail', '5-25',<></>, null, {
      label: `VAT Detail`,
      key: '5-25',
      children: `Content of Tab Pane 2`,
    }):null,
    has("JobBalancing")?getItem('Job Balancing', '5-1',<></>, null, {
      label: `Job Balancing`,
      key: '5-1',
      children: `Content of Tab Pane 2`,
    }):null,
    has("AccountActivity")?getItem('Account Activity', '5-2',<></>, null, {
      label: `Account Activity`,
      key: '5-2',
      children: `Content of Tab Pane 2`,
    }):null,
    has("BalanceSheet")?getItem('Balance Sheet', '5-3',<></>, null, {
      label: `Balance Sheet`,
      key: '5-3',
      children: `Content of Tab Pane 3`,
    }):null,
    has("JobProfit/Loss")?getItem('Job Profit/Loss', '5-4',<></>, null, {
      label: `Job Profit/Loss`,
      key: '5-4',
      children: `Content of Tab Pane 3`,
    }):null,
    has("Ledger")?getItem('Ledger', '5-5',<></>, null, {
      label: `Ledger`,
      key: '5-5',
      children: `Content of Tab Pane 3`,
    }):null,
    has("AgentInvBalance")?getItem('Agent Inv. Balance', '5-6',<></>, null, {
      label: `Agent Invoice Balancing`,
      key: '5-6',
      children: `Content of Tab Pane 3`,
    }):null,
    // The accounts team's "International Report": what each overseas agent
    // owes us and we owe it, in US dollars, as on a date - with Agent Invoice
    // Balancing's access, the report it was put together from.
    has("AgentInvBalance")?getItem('International Report', '5-26',<></>, null, {
      label: `International Report`,
      key: '5-26',
      children: `Content of Tab Pane 3`,
    }):null,
    has("TrialBalance")?getItem('Trial Balance', '5-9',<></>, null, {
      label: `Trial Balance`,
      key: '5-9',
      children: `Content of Tab Pane 3`,
    }):null,
    has("IncomeStatement")?getItem('Income statement', '5-11',<></>, null, {
      label: `Income statement`,
      key: '5-11',
      children: `Content of Tab Pane 3`,
    }):null,  
    has("ageingReport")?getItem('Ageing Report', '5-13',<></>, null, {
      label: `Ageing`,
      key: '5-13',
      children: `Content of Tab Pane 3`,
    }):null,
    has("auditLog")?getItem('Audit Log', '5-15',<></>, null, {
      label: `Audit Log`,
      key: '5-15',
      children: `Content of Tab Pane 3`,
    }):null,
    has("climaxReconciliation")?getItem('Climax Reconciliation', '5-19',<></>, null, {
      label: `Climax Reconciliation`,
      key: '5-19',
      children: `Content of Tab Pane 3`,
    }):null,
    // The old Climax books, read-only - only on an install that has them
    // (functions/archive), to whoever has the Archive right.
    (isArchiveOn() && has("Archive"))?getItem('Archive', '5-27',<></>, null, {
      label: `Archive`,
      key: '5-27',
      children: `Content of Tab Pane 3`,
    }):null,
    // (levels?.includes("lgVat")||levels?.includes("admin"))?getItem('LG VAT', '5-17',<></>, null, {
    //   label: `LG VAT`,
    //   key: '5-17',
    //   children: `Content of Tab Pane 3`,
    // }):null
          
  ]
  )
  const tasks = getParentItem('Tasks', '6', sectionIcon('6'),
    [
      getItem('Riders List', '6-1',<></>, null, {
        label: `Riders List`,
        key: '6-1',
        children: `Content of Tab Pane 2`,
      }),
      getItem('Task List', '6-3',<></>, null, {
        label: `Task List`,
        key: '6-3',
        children: `Content of Tab Pane 2`,
      }),
      // getItem('Tracking', '6-4',<></>, null, {
      //   label: `Tracking`,
      //   key: '6-4',
      //   children: `Content of Tab Pane 2`,
      // }),
    ]
  )
  const SeaJobs = getParentItem(term('seaJobs'), '4', sectionIcon('4'),
    [
      has("ExSea")?getItem('Sea Export Jobs List', '4-1',<></>, null, {
        label: `Sea Export Jobs List`,
        key: '4-1',
        children: `Content of Tab Pane 2`,
      }):null, 
      has("ImSea")?getItem('Sea Import Jobs List', '4-5',<></>, null, {
        label: `Sea Import Jobs List`,
        key: '4-5',
        children: `Content of Tab Pane 2`,
      }):null
    ]
  )
  const importJobs = getParentItem(term('airJobs'), '7', sectionIcon('7'),
    [
      has("ExAir")?getItem('Air Export Jobs List', '7-1',<></>, null, {
        label: `Air Export Jobs List`,
        key: '7-1',
        children: `Content of Tab Pane 2`,
      }):null, 
      has("ImAir")?getItem('Air Import Jobs List', '7-4',<></>, null, {
        label: `Air Import Jobs List`,
        key: '7-4',
        children: `Content of Tab Pane 2`,
      }):null,
      has("manifest")?getItem('Manifest List', '7-7',<></>, null, {
        label: `Manifest List`,
        key: '7-7',
        children: `Content of Tab Pane 2`,
      }):null,
    ]
  )
  // Aviation Job: the airline's own job type - a flight and the consignments
  // on it. Its own section rather than a tab inside Air Jobs, because it is a
  // separate module end to end (own tables, own routes, own screens) and
  // shares nothing with the freight air job above.
  //
  // Shown only where the sea sections are hidden, i.e. only in the 'aviation'
  // operation mode. Gated on the air access levels, which are the ones an
  // airline's operations staff already hold.
  const aviationJobs = getParentItem('Aviation Job', '10', sectionIcon('10'),
    [
      has("ExAir", "ImAir")?getItem('Aviation Job List', '10-1',<></>, null, {
        label: `Aviation Job List`,
        key: '10-1',
        children: `Content of Tab Pane 2`,
      }):null,
      // PFM - the pre-flight manifest a flight is built from. UNDER the job
      // list rather than above it, although a PFM comes first in time: the
      // flight list is what this section is opened for every day, and the
      // plans are where a flight STARTS, which is a less frequent errand.
      // Gated on the same access levels as the flight list - the operations
      // staff who build plans are the ones who fly them.
      has("ExAir", "ImAir")?getItem('PFM', '10-3',<></>, null, {
        label: `PFM`,
        key: '10-3',
        children: `Content of Tab Pane 2`,
      }):null,
    ]
  )
  // Customs Job: the clearing agent's own job type - one goods declaration,
  // its duty, and the charges against it. Its own section rather than a tab
  // inside Sea or Air Jobs, because it is a separate module end to end (own
  // table, own routes, own screens) and shares nothing with a freight job.
  //
  // Shown only in the 'customs' operation mode, and INSTEAD OF the two freight
  // sections rather than alongside them - see where isCustoms is used, last.
  // Gated on the import/export access levels, which are the ones a clearing
  // agent's operations staff already hold.
  const customsJobs = getParentItem('Customs Job', '11', sectionIcon('11'),
    [
      has("ImSea", "ImAir", "ExSea", "ExAir")?getItem('Customs Job List', '11-1',<></>, null, {
        label: `Customs Job List`,
        key: '11-1',
        children: `Content of Tab Pane 2`,
      }):null,
      // The Program Book - planned jobs, numbered when they are moved to the
      // list above. Only where Configuration > Customs has job planning on;
      // the same access levels as the job list, whose jobs these become.
      (isPlanningOn() && has("ImSea", "ImAir", "ExSea", "ExAir"))?getItem('Program Book', '11-3',<></>, null, {
        label: `Program Book`,
        key: '11-3',
        children: `Content of Tab Pane 2`,
      }):null,
    ]
  )
  // System-only Configuration section: Seanet on a leased install, the admin
  // on an exempt one (functions/systemSession). A client's admin does not see
  // it - Config is Seanet's. The leaf navigates directly (Router.push) in
  // addition to opening a tab, so a first click always lands on the page. The
  // backend enforces the same on every Config write (requireSystem); the
  // sidebar being hidden is not a security boundary on its own.
  const config = getParentItem('Configuration', '9', sectionIcon('9'),
  [
    {
      key: '9-1',
      icon: <></>,
      children: null,
      label: 'Settings',
      onClick: () => {
        dispatch(incrementTab({ label: 'Settings', key: '9-1' }));
        Router.push('/config');
      },
    },
  ]
  )

  const testReport = getParentItem('Test Report', '8', sectionIcon('8'),[

    // getItem('Test Reports', '8-1',<></>, null, {
    //   label: `Home`,
    //   key: '8-1',
    //   children: `Content of Tab Pane 2`,
    // }),
    // getItem('Requests', '8-2',<></>, null, {
    //   label: `Requests`,
    //   key: '8-2',
    //   children: `Content of Tab Pane 2`,
    // }),
  ])

  //functions to generate objects from the parent and children data and rearranging the data within the object.
  // The entries this user may not open are null above; they are dropped here,
  // so a section's children are only what it shows.
  function getParentItem(label, key, icon, children) {
    return { key, icon, children: (children || []).filter(Boolean), label}
  }
  function getItem(label, key, icon, children, tab) {
    return { key, icon, children, label,
    onClick:()=>{
      // Make the tab, THEN open it. Either one alone is half the action:
      // without the dispatch there is no tab, without openTab the tab is
      // made but the user is left on whatever page they were already on.
      dispatch(incrementTab(tab));
      openTab?.(tab);
    }
  }}

  /* WHICH SECTIONS: THE ONES WITH SOMETHING IN THEM, in this order.
     It was a switch on each access name, kept apart from the entries'
     own checks, and the two had drifted (found 2026-11-15):
       - ImSea or ImAir added AIR Jobs - from when that section held the
         import lists - so a sea-only user had an empty Air Jobs (SNS), and
         one with ImSea alone had no way to Sea Import at all;
       - ageingReport, auditLog and climaxReconciliation were spelt
         differently there or missing, so a user with only those reports had
         no Reports section; the same for Direct Job and Accounts.
     Now a section is shown exactly when it has an entry this user may open,
     so it can be neither empty nor missing. Setup always has one (Parties,
     Fiscal Years). */
  const hasPages = (section) => section.children.length > 0;
  items = [SeaJobs, importJobs, setup, accounts, reports].filter(hasPages);

  // Tasks.
  //
  // The section was defined above but never added to `items`, so it was
  // unreachable - MainLayout routed key '6-3' to /tasks/list and nothing could
  // ever produce that key. You had to know the URL.
  //
  // Shown to the designations that can actually use the page: creating and
  // reassigning tasks is manager/CEO/CFO/admin on the API side
  // (routes/assignTasks), so anyone else would get a screen whose buttons all
  // return 403. Employees reach their own tasks through the dashboard tab
  // instead, which is the half that is useful to them.
  const canManageTasks = designation === 'manager' || isCeoOrCfo;
  if(canManageTasks){
    items.push(tasks);
  }

  // Configuration is Seanet's: a system session's admin only.
  if(isAdminDesignation && isSystem){
    items.push(config);
  }

  // Aviation installations are airlines - they run aircraft, not ships - so
  // the sea section isn't relabelled, it isn't built at all. Dropping it here,
  // last, is what makes that true for every branch above, including the two
  // that rebuild `items` wholesale for admins.
  if(!hasSea){
    // An aviation install has exactly ONE jobs section: Aviation Job. Both of
    // the freight sections go - Sea Jobs because an airline has no ships, and
    // Air Jobs because Aviation Job replaces it outright rather than sitting
    // alongside it. They are dropped here, last, so this holds for every
    // branch above including the two that rebuild `items` wholesale.
    items = items.filter((x) => x !== SeaJobs && x !== importJobs);

    // Only with an entry in it, so someone with no air access gets no
    // section rather than an empty one they cannot open.
    if(hasPages(aviationJobs) && items.indexOf(aviationJobs) === -1){
      // First: it is the section this install actually works in.
      items.unshift(aviationJobs);
    }
  }

  // Customs installations are clearing agents: they file declarations, they do
  // not run freight jobs. Customs Job REPLACES the two freight sections rather
  // than sitting alongside them, the same way Aviation Job does - so both go,
  // and the "Sea Clearance" / "Air Clearance" relabelling of them is gone with
  // them (see functions/terminology.js).
  //
  // Dropped here, last, so this holds for every branch above including the two
  // that rebuild `items` wholesale for admins.
  //
  // NOTE this is not hasSeaOperations(). That flag ALSO decides whether the
  // aviation section appears and whether Setup keeps Ports, Destinations and
  // Voyage - a customs install still needs the port masters, because the GD
  // form's POL/POD pickers are fed from them. Only the two job sections go.
  if(isCustoms){
    items = items.filter((x) => x !== SeaJobs && x !== importJobs);

    // Only with an entry in it, so someone with no job access gets no
    // section rather than an empty one they cannot open.
    if(hasPages(customsJobs) && items.indexOf(customsJobs) === -1){
      // First: it is the section this install actually works in.
      items.unshift(customsJobs);
    }
  }

  // console.log(items)
  return items
}

/** The session's access names as a list - it carries them as one string. */
export function accessNames(access) {
  if (Array.isArray(access)) return access.map((x) => String(x).trim()).filter(Boolean);
  return String(access || '').split(',').map((x) => x.trim()).filter(Boolean);
}

export { setAccesLevels }
