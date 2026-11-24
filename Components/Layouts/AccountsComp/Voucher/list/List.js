import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import { EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import PopConfirm from 'Components/Shared/PopConfirm';
import Pagination from 'Components/Shared/Pagination';
import Router from 'next/router';
import moment from 'moment';
import axiosClient from 'apis/axiosClient';
import { Input, Spin, Empty } from 'antd';
import Cookies from 'js-cookie';
import openNotification from 'Components/Shared/Notification';
import { checkEmployeeAccess } from 'functions/checkEmployeeAccess';
import { checkEditAccess } from 'functions/checkEditAccess';
const commas = (a) => a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
// The voucher's currency - PKR when it carries none (most migrated vouchers).
export const voucherCurrency = (v) => String(v?.currency || '').trim().toUpperCase() || 'PKR';

const PAGE_SIZE = 20;

/* A figure in the voucher's own currency, with the rupees under a foreign one. */
const Money = ({ voucher, amount, amountPkr }) => (
  <>
    <span className='vl-cur'>{voucherCurrency(voucher) === 'PKR' ? 'Rs. ' : `${voucherCurrency(voucher)} `}</span>
    <span className='dl-strong'>{commas(amount)}</span>
    {voucherCurrency(voucher) !== 'PKR' && (
      <div className='vl-sub'>Rs. {commas(amountPkr)}{voucher.exRate ? ` @ ${voucher.exRate}` : ''}</div>
    )}
  </>
);

/* What each kind of voucher is, for its label: receipts green, payments
 * violet, their adjustments a shade of each, journals cyan, invoices and
 * bills as receipts and payments are, a returned cheque red. */
const KINDS = {
  BRV: ['Bank receipt', 'green'], CRV: ['Cash receipt', 'green'], 'ADJ-R': ['Receipt adjustment', 'emerald'],
  BPV: ['Bank payment', 'violet'], CPV: ['Cash payment', 'violet'], 'ADJ-P': ['Payment adjustment', 'blue'],
  JV: ['Journal voucher', 'cyan'], TV: ['Transfer voucher', 'cyan'],
  SI: ['Sales invoice', 'green'], PI: ['Purchase invoice', 'violet'],
  OP: ['Opening balance', ''], CR: ['Cheque return', 'red'],
};

const ListData = ({ category = 'general', choice = null }) => {
  const [rowData, setRowData] = useState();
  // What the server says this CATEGORY totals, not what is in the browser.
  // The pager is built from this.
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const dispatch = useDispatch();

  const handleDelete = async (id) => {
    PopConfirm("Confirmation", "Are You Sure To Remove This Voucher?",
    async () => {
      try {
        const response = await axiosClient.post(process.env.NEXT_PUBLIC_CLIMAX_POST_DELETE_BASE_VOUCHER, {
          id: id,
          employeeID: Cookies.get("loginId")
        });
        if (response.data.status === "success") {
          openNotification("Success", "Voucher Deleted Successfully!", "green");
          // Drop it from the page in hand and correct the count the pager is
          // built from, rather than re-fetching for one row.
          setRowData(prev => prev.filter(item => item.id !== id));
          setTotal(prev => Math.max(0, prev - 1));
        } else {
          openNotification("Error", response.data.result || "Failed to delete voucher", "red");
        }
      } catch (error) {
        // A voucher another record made - a Direct Job, a receipt, an invoice -
        // is refused, with which record and where to delete it (server's
        // functions/voucherSource). Said as the server says it.
        console.error("Delete error:", error);
        openNotification("Error", error?.response?.data?.result || "An error occurred while deleting the voucher", "red", 8);
      }
    })
  };

  
  const handleEdit = async (voucherId) => {
    await Router.push(`/accounts/vouchers/${voucherId}`);
    dispatch(incrementTab({ "label": "Voucher", "key": "3-5", "id": `${voucherId}` }));
  };

  /* One page of vouchers, as the SERVER filtered them.
   *
   * The list used to hold every voucher and slice twenty out of it, which is
   * why searching had to scan the array in the browser. Both are the server's
   * job now, so this is the only place rows come from - and the page the SSR
   * already rendered is not re-fetched on mount. */
  const load = async (page, search) => {
    setLoading(true);
    try {
      const { data } = await axiosClient.get(
        process.env.NEXT_PUBLIC_CLIMAX_GET_ALL_VOUCHERS,
        {
          headers: { id: `${Cookies.get('companyId')}` },
          params: { page, limit: PAGE_SIZE, category, search: search || undefined },
        },
      );
      if (data?.status !== 'success') {
        openNotification('Error', data?.result || 'Could not load vouchers.', 'red');
        return;
      }
      setData(data.result);
      setTotal(Number(data.count) || 0);
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not load vouchers.', 'red');
    } finally {
      setLoading(false);
    }
  };

  /* Each tab loads its own first page. There is no server-rendered payload to
   * seed from any more: the page used to fetch every voucher in the company so
   * the wrapper could split it three ways in the browser, which is exactly the
   * thing pagination replaced. */
  useEffect(() => {
    load(1, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  /* Debounced, so typing a voucher number is one request rather than eight -
   * and it goes back to page 1, because page 4 of the old result is not page 4
   * of the new one. The first render is skipped; the mount effect above has
   * already asked for page 1. */
  const firstRender = React.useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => {
      setCurrentPage(1);
      load(1, query);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const goToPage = (page) => {
    setCurrentPage(page);
    load(page, query);
  };

  const currentRecords = rowData || [];
  const noOfPages = Math.ceil(total / PAGE_SIZE);
  // What a payment's bank or cash paid out, or a receipt's took in - the
  // Voucher screen's Net Amount (the user's request, 2026-10-26), worked out
  // by the server. SI / PI and opening balances have no bank or cash side, so
  // only General shows it.
  const showNet = category === 'general';

  const setData = async (data) => {
    let tempData = data
    await tempData?.forEach((x, i) => {
      x.no = i + 1;
      // The debit lines' total, in the voucher's own currency - and in rupees,
      // which a foreign-currency voucher shows beneath it. Every amount was
      // labelled "Rs." whatever the currency (the user's report, 2026-10-15).
      x.amount = x.Voucher_Heads?.reduce((x, cur) => x + Number(cur.amount), 0),
        x.amountPkr = x.Voucher_Heads?.reduce((t, cur) => t + Number(cur.defaultAmount || 0), 0),
        x.date = moment(x.createdAt).format("YYYY-MM-DD")
    });
    setRowData(tempData);
  };

  const canEdit = checkEditAccess();
  const canDelete = checkEmployeeAccess();
  const firstRow = (currentPage - 1) * PAGE_SIZE;

  /* THE LIST (2026-11-16 redesign) - the shared list look (styles/
   * dataList): the search, which vouchers, and the count in one row; the
   * table filling the page, its heading fixed; a label for each kind of
   * voucher; the pencil and bin on the row the pointer is on. A click on the
   * row opens the voucher - it took the pencil, in a column of its own. */
  return (
    <>
      <div className='dl-toolbar'>
        {/* Searches the whole book on the server, not the page in hand. */}
        <Input allowClear className='dl-search' prefix={<SearchOutlined />}
          placeholder="Search voucher no, cheque, paid to, type…"
          onChange={e => setQuery(e.target.value)} />
        {choice}
        <span className='dl-total'>
          {loading && <Spin size='small' />}
          {total.toLocaleString()} voucher{total === 1 ? '' : 's'}
        </span>
      </div>
      <div className={`dl-table-wrap${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {!currentRecords.length ? (
          <div className='dl-empty'>
            <Empty description={loading ? 'Loading…' : query ? `No voucher matches “${query}”.` : 'No vouchers yet.'} />
          </div>
        ) : (
        <table className='dl-table vl-table'>
          <thead>
            <tr>
              <th>Voucher No.</th>
              <th>Dated</th>
              <th>Type</th>
              <th>Cheque</th>
              <th>Paid to</th>
              <th>Cur.</th>
              <th className='dl-num'>Amount</th>
              {showNet && <th className='dl-num'>Net Amount</th>}
              <th>Made By</th>
              <th aria-label='Actions' />
            </tr>
          </thead>
          <tbody>
            {/* No client-side filter: these rows ARE the answer to the
                search, so filtering them again could only remove rows the
                server meant to return. */}
            {currentRecords.map((x, index) => {
              const kind = KINDS[String(x.vType || '').toUpperCase()];
              return (
                <tr key={x.id ?? index} className='dl-click' onClick={() => handleEdit(x.id)} title='Open this voucher'>
                  <td className='dl-strong'>{x.voucher_Id}</td>
                  <td className='dl-muted'>{moment(x.createdAt).format("DD MMM YYYY")}</td>
                  <td><span className={`dl-badge${kind?.[1] ? ` tone-${kind[1]}` : ''}`} title={kind?.[0]}>{x.vType}</span></td>
                  <td>
                    {x.chequeNo
                      ? <>{x.chequeNo}{x.chequeDate && <div className='vl-sub'>{moment(x.chequeDate).format("DD MMM YYYY")}</div>}</>
                      : <span className='vl-none'>—</span>}
                  </td>
                  <td><span className='dl-clip' title={x.payTo}>{x.payTo}</span></td>
                  <td>{voucherCurrency(x)}</td>
                  <td className='dl-num'><Money voucher={x} amount={x.amount} amountPkr={x.amountPkr} /></td>
                  {showNet && (
                    <td className='dl-num' data-testid='voucher-list-net'>
                      {x.netAmount == null
                        ? <span className='vl-none' title='No bank or cash side - a journal, transfer or note nets to zero'>—</span>
                        : <Money voucher={x} amount={x.netAmount} amountPkr={x.netAmountPkr} />}
                    </td>
                  )}
                  <td className='dl-muted'>{x.createdBy}</td>
                  <td className='vl-actions' onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <button type='button' className='vl-action' title={`Open ${x.voucher_Id}`} onClick={() => handleEdit(x.id)}>
                        <EditOutlined />
                      </button>
                    )}
                    {canDelete && (
                      <button type='button' className='vl-action is-danger' title={`Delete ${x.voucher_Id}`} onClick={() => handleDelete(x.id)}>
                        <DeleteOutlined />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        )}
      </div>
      {/* Shown while searching too - a search returns pages like anything else. */}
      {currentRecords.length > 0 && (
        <div className='dl-footer'>
          <span>Showing {firstRow + 1}&ndash;{firstRow + currentRecords.length} of {total.toLocaleString()}</span>
          {noOfPages > 1 && <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={goToPage} />}
        </div>
      )}
    </>
  );
};

export default React.memo(ListData)
