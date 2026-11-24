import React, { useEffect, useReducer, useCallback } from 'react';
import CreateOrEdit from './CreateOrEdit';
// A CEO/CFO/admin may edit ANY account, including the seeded ones the chart
// flags as not editable. The server enforces the same rule - see
// /editChildAccount - so this decides what is offered, not what is allowed.
import { isAdminDesignation } from 'functions/adminDesignation';
import axiosClient from 'apis/axiosClient';
import Cookies from 'js-cookie';
import ExcelJS from "exceljs";

import { RightOutlined, EditOutlined, DeleteOutlined, ShrinkOutlined } from '@ant-design/icons';
import { Modal, Select } from 'antd';
// Finding an account and opening the tree onto it. The walking lives in the
// module so it can be tested without rendering a recursive tree.
import { flattenAccounts, ancestorIdsOf, visibleRows } from 'functions/coaTree';
import openNotification from 'Components/Shared/Notification';
import { companyLogoBlob, reportCompanyTitle, reportAddress } from 'functions/companyBranding';
import { usePageActions } from 'Components/Shared/PageActions';

/* -------------------- reducer -------------------- */
function recordsReducer(state, action) {
  switch (action.type) {
    case 'toggle': {
      return { ...state, [action.fieldName]: action.payload };
    }
    case 'create': {
      return {
        ...state,
        create: true,
        visible: true,
        // Start every new account from a clean slate so nothing (parent, title,
        // isParent) leaks in from a previous create/edit.
        title: '',
        selectedParentId: '',
        subCategory: 'General',
        isParent: false,
        editable: false,
      };
    }
    case 'edit': {
      return {
        ...state,
        edit: true,
        visible: true,
      };
    }
    case 'modalOff': {
      return {
        ...state,
        visible: false,
        create: false,
        edit: false,
      };
    }
    default:
      return state;
  }
}

const initialState = {
  records: [],
  load: true,
  visible: false,
  create: false,
  edit: false,

  // Creating Records
  selectedMainId: '',
  selectedParentId: '',
  title: '',
  isParent: false,
  subCategory: "General",
  parentRecords: [],

  // Editing Records
  selectedRecordId: '',
  selectedRecord: {},

  /* The account the search box last revealed. Marked in the tree until
     another is picked or the box is cleared - not on a timer: somebody who
     searched for an account is about to do something with it, and a highlight
     that faded while they read the row would have to be searched for again. */
  foundId: null
};

/* -------------------- helpers -------------------- */
// An account type's label colour (the shared .dl-badge tones); the rest grey.
const TYPE_TONES = {
  customer: 'blue', vendor: 'violet', 'customer/vendor': 'cyan', bank: 'emerald', cash: 'green',
};

const getChildrenArray = (node) => {
  // accommodate both data shapes: node.children OR node.Child_Accounts
  if (!node) return [];
  return Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.Child_Accounts)
      ? node.Child_Accounts
      : [];
};

const addCheckRecursively = (nodes) => {
  if (!Array.isArray(nodes)) return [];
  return nodes.map(n => ({
    ...n,
    check: !!n.check,
    children: addCheckRecursively(getChildrenArray(n)) // normalize into .children for internal use
  }));
};

/* -------------------- main component -------------------- */
const ChartOFAccount = ({ accountsData }) => {
  const [state, dispatch] = useReducer(recordsReducer, initialState);
  const { records, visible } = state;

  /* -------------------- load accounts -------------------- */
  const getAccounts = useCallback(async (data) => {
    try {
      if (!data) return;

      // support both top-level shapes: data.result or data (if passed directly)
      const source = data.result ?? data;

      // clone and normalize: ensure each node has .children (converted from Child_Accounts if needed)
      const normalized = addCheckRecursively(source);

      // flatten parent records (second-level) for dropdowns if needed
      const parentRecordsFlat = [];
      normalized.forEach((x) => {
        (x.children || []).forEach((y) => parentRecordsFlat.push(y));
      });

      // update state
      dispatch({ type: 'toggle', fieldName: 'records', payload: normalized });
      dispatch({ type: 'toggle', fieldName: 'parentRecords', payload: parentRecordsFlat });
    } catch (err) {
      console.error('getAccounts error:', err);
    }
  }, []);

  useEffect(() => {
    if (accountsData) getAccounts(accountsData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountsData, getAccounts]);

  // Delete a leaf account: check for transactions/sub-accounts/party links
  // first, confirm, then delete. The backend re-verifies before deleting.
  const handleDelete = async (node) => {
    try {
      const { data } = await axiosClient.get(`/accounts/accountDeleteCheck/${node.id}`);
      if (!data.deletable) {
        openNotification('Cannot delete', `"${node.title}" has ${data.reason}.`, 'red');
        return;
      }
      if (!window.confirm(`Delete account "${node.title}"?\n\nThis cannot be undone.`)) return;
      const del = await axiosClient.post('/accounts/deleteAccount', { id: node.id });
      if (del.data.status === 'success') {
        openNotification('Success', `Account "${node.title}" deleted.`, 'green');
        const refreshed = await axiosClient
          .get(process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_ACCOUNTS, { headers: { id: Cookies.get('companyId') } })
          .then((x) => x.data);
        getAccounts(refreshed);
      } else {
        openNotification('Error', del.data.result || 'Could not delete account.', 'red');
      }
    } catch (err) {
      openNotification('Error', err?.response?.data?.result || 'Could not delete account.', 'red');
    }
  };

  /* -------------------- update codes (kept as-is) -------------------- */
  const updateCodeParents = async () => {
    let tempState = [...state.records];
    let p = 0;
    let c = 0;

    for (let x of tempState) {
      p = parseInt(x.id * 100);
      for (let y of getChildrenArray(x)) {
        p++;
        let codeP = Cookies.get('companyId').toString() + p.toString();
        try {
          await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_CODE_PARENT_ACCOUNT, {
            id: y.id,
            title: y.title,
            AccountId: y.AccountId,
            CompanyId: Cookies.get('companyId'),
            code: codeP.toString()
          });
        } catch (error) {
          console.error("Error updating parent account:", error);
        }

        c = p * 10000;
        for (let z of getChildrenArray(y)) {
          c++;
          let codeC = Cookies.get('companyId').toString() + c.toString();
          try {
            await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_CODE_CHILD_ACCOUNT, {
              id: z.id,
              title: z.title,
              ParentAccountId: y.id,
              CompanyId: Cookies.get('companyId'),
              code: codeC.toString()
            });
          } catch (error) {
            console.error("Error updating child account:", error);
          }
        }

        c = 0;
      }

      p = 0;
    }
  };

  /* -------------------- Image to Blob for Excel header -------------------- */
  const ImageToBlob = (imageUrl) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(resolve);
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  };

  /* -------------------- Export to Excel -------------------- */
  const exportToExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Chart Of Accounts');

      worksheet.columns = [
        { header: 'Code', key: 'code', width: 15 },
        { header: 'Account Title', key: 'title', width: 35 },
        { header: 'Type', key: 'type', width: 15 },
        { header: 'Category', key: 'cat', width: 20 },
        { header: 'Sub Category', key: 'subCat', width: 20 },
      ];

      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'D3D3D3' }
        };
        cell.border = {
          right: { style: 'thin', color: { argb: '000000' } },
          left: { style: 'thin', color: { argb: '000000' } },
          top: { style: 'thin', color: { argb: '000000' } },
          bottom: { style: 'thin', color: { argb: '000000' } },
        };
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      const rows = [];

      // iterate recursively and build rows
      const walk = (node, topTitle = null) => {
        if (!node) return;
        const type = topTitle == null ? 'Group' : node.children?.length ? 'Parent' : 'Child';
        rows.push({
          code: node.code ?? '',
          title: node.title ?? '',
          type,
          cat: topTitle ?? '',
          subCat: node.subCategory ?? ''
        });

        const children = getChildrenArray(node);
        children.forEach(child => walk(child, topTitle == null ? node.title : topTitle));
      };

      records.forEach(group => {
        walk(group, null);
      });

      worksheet.addRows(rows);

      // add some top lines (company header)
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);
      // The header company's own name and address. These were Seanet's and
      // Air Cargo's, fixed to ids 1 and 2, with no name at all for any other.
      worksheet.insertRow(1, ['', '', reportAddress(Cookies.get('companyId'))]);
      worksheet.insertRow(1, ['', '', reportCompanyTitle(Cookies.get('companyId'))]);
      worksheet.insertRow(1, ['']);
      worksheet.insertRow(1, ['']);

      worksheet.getCell('C3').font = { size: 16, bold: true };
      worksheet.getCell('C4').font = { size: 16, bold: true };

      // Logo from the Company record; null when none is uploaded, in which
      // case the sheet gets no image (never another tenant's artwork).
      const imageBlob = await companyLogoBlob(Cookies.get('companyId'));
      if (imageBlob) {
        const imageId = workbook.addImage({
          buffer: await imageBlob.arrayBuffer(),
          extension: 'png',
        });

        worksheet.addImage(imageId, {
          tl: { col: 1, row: 1 },
          ext: { width: 150, height: 100 },
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ChartOfAccounts.xlsx';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export to Excel failed:', e);
    }
  };

  /* -------------------- the tree's open branches -------------------- */
  /* Ids (as strings) of the branches that are open. Kept apart from the
     chart: they were a `check` flag on each account, and every reload of the
     chart - after any create, edit or delete - came back with all of them
     shut, so editing an account five levels down meant opening all five again
     to see what had changed. */
  const [expanded, setExpanded] = React.useState(() => new Set());
  const toggleBranch = (id) => setExpanded((was) => {
    const next = new Set(was);
    const key = String(id);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const rows = React.useMemo(() => visibleRows(records, expanded), [records, expanded]);

  /* Read once, not per node: it comes from a cookie, and a value that could
     change between two nodes of the same tree would show the pencil on some
     rows and not others. */
  const canEditAnyAccount = React.useMemo(() => isAdminDesignation(), []);

  /* ------------------------- find an account -------------------------
   * Every account in the chart as one flat list for the search box. Rebuilt
   * when the chart changes, so the box never offers an account somebody just
   * deleted. Opening and closing branches no longer touches the chart, so it
   * is no longer rebuilt on every click as well.
   * ------------------------------------------------------------------ */
  const searchable = React.useMemo(() => flattenAccounts(records), [records]);

  const treeRef = React.useRef(null);

  /* Open the tree onto the account, mark it, and bring it into view.
   *
   * ONLY OPENS, NEVER CLOSES: branches the user opened on the way stay open.
   * The scroll is done by finding the row in the DOM after the render that
   * creates it - its parents were shut a moment ago. Scoped to the tree's own
   * container so it cannot reach a row on some other screen. */
  const revealAccount = (id) => {
    if (id === undefined || id === null || id === '') {
      dispatch({ type: 'toggle', fieldName: 'foundId', payload: null });
      return;
    }
    const ancestors = ancestorIdsOf(records, id);
    if (ancestors && ancestors.length) {
      setExpanded((was) => new Set([...was, ...ancestors.map(String)]));
    }
    dispatch({ type: 'toggle', fieldName: 'foundId', payload: id });
  };

  React.useEffect(() => {
    if (state.foundId === null || state.foundId === undefined) return;
    // After the render that expanded the branch, so the row exists.
    const row = treeRef.current?.querySelector(`[data-account-id="${state.foundId}"]`);
    // `block: 'center'` rather than the default: a row scrolled to the very
    // top of the box loses the parents that say where it is, which is most of
    // what revealing it was for.
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [state.foundId, rows]);

  const openEdit = (node, hasChildren, childCount) => {
    // isParent: top-level or parent-level (no ChildAccountId means parent/group)
    const isParentFlag = !node.ChildAccountId;
    dispatch({ type: 'toggle', fieldName: 'selectedRecord', payload: node });
    dispatch({ type: 'toggle', fieldName: 'selectedRecordId', payload: node.id });
    dispatch({ type: 'toggle', fieldName: 'selectedParentId', payload: node.ChildAccountId?.toString() || '' });
    dispatch({ type: 'toggle', fieldName: 'subCategory', payload: node.subCategory || 'General' });
    dispatch({ type: 'toggle', fieldName: 'editable', payload: node.editable || false });
    dispatch({ type: 'toggle', fieldName: 'isParent', payload: isParentFlag });
    /* WHETHER IT MAY BE MOVED. Only a leaf may: a code is hierarchical, so
       moving a node with children would mean reissuing every code beneath it,
       and some of those are printed on statements already filed. Read HERE,
       where the tree is, so the form does not have to go looking for the node
       again. */
    dispatch({ type: 'toggle', fieldName: 'selectedHasChildren', payload: hasChildren });
    dispatch({ type: 'toggle', fieldName: 'selectedChildCount', payload: childCount });
    dispatch({ type: 'edit' });
  };

  /* -------------------- one row of the tree -------------------- */
  /* A plain render function, not a component: the recursive component this
     replaced was declared inside the screen, so it was a NEW component type on
     every render and React rebuilt the whole tree from scratch on each click -
     the 1,188 debtors under one parent on CargoLinkers included. */
  const renderRow = ({ node, depth, childCount, open }) => {
    const hasChildren = childCount > 0;
    // The row the search last revealed. Compared as strings: the Select hands
    // back whatever antd is holding, and the tree holds numbers.
    const isFound = String(node.id) === String(state.foundId);
    const type = node.subCategory && node.subCategory !== 'General' ? node.subCategory : null;
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    return (
      <div
        key={node.id}
        // What the scroll looks for after the branch has opened - see
        // revealAccount.
        data-account-id={node.id}
        className={`coa-row lvl-${Math.min(depth, 2)}${hasChildren ? ' is-group' : ' is-leaf'}${open ? ' is-open' : ''}${isFound ? ' coa-found' : ''}`}
        role='treeitem'
        aria-level={depth + 1}
        aria-expanded={hasChildren ? open : undefined}
        tabIndex={hasChildren ? 0 : -1}
        onClick={hasChildren ? () => toggleBranch(node.id) : undefined}
        onKeyDown={hasChildren ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleBranch(node.id); }
        } : undefined}
      >
        <span className='coa-code'>{node.code}</span>
        <span className='coa-account'>
          {/* One guide line per level, so a deep row still says what it
              hangs from. */}
          <span className='coa-indent' style={{ width: depth * 20 }} aria-hidden />
          <span className='coa-toggle' aria-hidden>
            {hasChildren ? <RightOutlined rotate={open ? 90 : 0} /> : <span className='coa-leaf' />}
          </span>
          <span className='coa-name' title={node.title}>{node.title}</span>
        </span>
        <span className='coa-type'>
          {type && <span className={`dl-badge${TYPE_TONES[type.toLowerCase()] ? ` tone-${TYPE_TONES[type.toLowerCase()]}` : ''}`}>{type}</span>}
        </span>
        <span className='coa-count' title={hasChildren ? `${childCount} account${childCount === 1 ? '' : 's'} directly under it` : undefined}>
          {hasChildren ? childCount.toLocaleString() : ''}
        </span>
        <span className='coa-actions'>
          {/* THE PENCIL. An ordinary account shows it to everyone; one the
              chart has flagged as not editable shows it only to a CEO/CFO/admin.
              The server applies the same rule, so this is what is OFFERED rather
              than what is permitted. */}
          {(node.editable == '0' || canEditAnyAccount) && (
            <button
              type='button'
              className='coa-action'
              onClick={stop(() => openEdit(node, hasChildren, childCount))}
              title={node.editable == '0' ? `Edit ${node.title}` : `Edit ${node.title} (a standard account)`}
            >
              <EditOutlined />
            </button>
          )}
          {/* Delete: only for leaf accounts (no sub-accounts). The handler checks
              for transactions/party links and confirms before deleting. */}
          {!hasChildren && (
            <button type='button' className='coa-action is-danger' onClick={stop(() => handleDelete(node))} title={`Delete ${node.title}`}>
              <DeleteOutlined />
            </button>
          )}
        </span>
      </div>
    );
  };

  const disableModal = () => {
    dispatch({ type: 'modalOff' })
  }

  // The title, New and Excel on the toolbar (PageActions); the account
  // finder stays beside the tree.
  usePageActions({
    title: 'Chart of Accounts',
    new: { onClick: () => dispatch({ type: 'create' }), label: 'New Account', title: 'Create an account' },
    excel: { onClick: () => exportToExcel(), title: 'Export the chart of accounts to Excel' },
  }, []);

  /* -------------------- UI -------------------- */
  /* THE CHART AS A TABLE (2026-11-15). Codes in a column of their own, the
     tree indented beside them with a guide line per level, an account's type
     and how many accounts a group holds, and the pencil and bin at the end of
     the row - shown on the row the pointer is on. It was a column of 53px rows
     with the code run into the name and the icons wherever the name ended. */
  return (
    <div className='dashboard-styles'>
      <div className='base-page-layout coa-page'>
        <div className='account-styles'>
          <div className='dl-toolbar'>
            {/* FIND AN ACCOUNT.

                A selector, not a filter. Typing narrows the OPTIONS; choosing
                one opens the tree down to that account and marks it, leaving
                the chart itself whole. Filtering the tree to matches would
                answer a different question: where an account SITS is most of
                what a chart of accounts is for, and a leaf shown without its
                parents has lost the part that matters.

                Searches code, title and the path - somebody hunting an account
                has one of those three in their head, and the two accounts
                called "Bank" are told apart by the third. */}
            <Select
              showSearch
              allowClear
              className='coa-search'
              /* THE LIST IS WIDER THAN THE BOX. Each option is a code, a name
                 and the path that tells two same-named accounts apart. */
              dropdownMatchSelectWidth={480}
              placeholder='Find an account by code, name or group'
              value={state.foundId ?? undefined}
              onChange={revealAccount}
              onClear={() => revealAccount(null)}
              // The box shows the chosen account's code and name; the list
              // shows the path as well.
              optionLabelProp='text'
              filterOption={(input, option) =>
                String(option?.search || '').includes(String(input || '').toLowerCase())}
              options={searchable.map((a) => ({
                value: a.id,
                search: a.search,
                text: [a.code, a.title].filter(Boolean).join('  '),
                label: (
                  <span className='coa-option'>
                    {a.code ? <span className='coa-option-code'>{a.code}</span> : null}
                    <span className='coa-option-title'>{a.title}</span>
                    {/* Where it lives, dimmed - it disambiguates rather than
                        naming, so it must not compete with the title. */}
                    {a.path ? <span className='coa-option-path'>{a.path}</span> : null}
                  </span>
                ),
              }))}
            />
            <button
              type='button'
              className='dl-tool'
              onClick={() => setExpanded(new Set())}
              disabled={expanded.size === 0}
              title='Close every open group'
            >
              <ShrinkOutlined /> Collapse all
            </button>
            <span className='dl-total'>{searchable.length.toLocaleString()} accounts</span>
          </div>

          <div className='coa-table' ref={treeRef} role='tree' aria-label='Chart of accounts'>
            <div className='coa-head' aria-hidden>
              <span className='coa-code'>Code</span>
              <span className='coa-account'>Account</span>
              <span className='coa-type'>Type</span>
              <span className='coa-count'>Accounts</span>
              <span className='coa-actions' />
            </div>
            {rows.length ? rows.map(renderRow) : (
              <div className='coa-empty'>No accounts found.</div>
            )}
          </div>

          <Modal
            open={visible}
            onOk={() => dispatch({ type: 'modalOff' })}
            onCancel={() => dispatch({ type: 'modalOff' })}
            width={1000}
            footer={false}
            centered={false}
          >
            <CreateOrEdit state={state} dispatch={dispatch} getAccounts={getAccounts} disableModal={disableModal} />
          </Modal>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ChartOFAccount);
