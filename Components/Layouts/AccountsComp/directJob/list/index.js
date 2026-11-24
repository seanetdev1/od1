import { DeleteOutlined, EditOutlined, SearchOutlined } from "@ant-design/icons";
import { Input, Spin, Empty } from "antd";
import Pagination from 'Components/Shared/Pagination';
import { incrementTab } from 'redux/tabs/tabSlice';
import RowAction from 'Components/Shared/RowAction';
import { usePageActions } from 'Components/Shared/PageActions';
import Router from 'next/router';
import moment from "moment";
import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { resetDirectJob } from "../../../../../redux/directJob/directJobSlice";
import axios from "axios";
import openNotification from "../../../../Shared/Notification";
import axiosClient from 'apis/axiosClient';
import { entryDateOf } from 'functions/directJobEntry';
import { personOf } from 'functions/auditStamp';

/* What an entry is, and how it was paid - its labels. */
const KINDS = { expense: ['Expense', 'red'], revenue: ['Revenue', 'green'] };
const MODES = { Bank: ['Bank', 'blue'], Cash: ['Cash', 'cyan'], Adjust: ['Adjustment', 'amber'] };

const commas = (a) => a == 0 ? '0' : parseFloat(a).toFixed(2).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const DirectJobList = ({ voucherData }) => {

    const dispatch = useDispatch();
    const [total, setTotal] = useState(0);
    const [refresh, setRefresh] = useState(false);

    const [ search, setSearch ] = useState("");
    // What the server is asked for: the box's text once typing pauses, so a
    // word typed is one request, not one per letter.
    const [ query, setQuery ] = useState("");
    const latest = useRef(0);

    const [allRecords, setAllRecords ] = useState([]); // this page's rows
    const [currentPage, setCurrentPage] = useState(1);
    // Rows a page - a table row each, where it was a card each at ten.
    const pageSize = 25;
    const [loading, setLoading] = useState(false);

    /* PAGINATED ONCE, BY THE SERVER. /getDirectJobList takes page and pageSize
     * and returns that page - ten rows - plus the total. This then sliced the
     * ten rows AGAIN by the same page number, so page 2 asked the array for
     * rows 11 to 20 of a ten-row array and got nothing: the list was blank
     * from page 2 on, with the pager still showing the right total. */
    const currentRecords = allRecords;

    /* The row's Delete asks before it calls this - the same question, in the
     * same dialog, as every other list in the app. A second confirmation here
     * would be two dialogs for one press. */
    const deleteData = async (id) => {
        try {
            await axiosClient.post(
                `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/deleteDirectJob`,
                {}, // body
                { headers: { id: id } } // the id goes in the headers
            );

            dispatch(resetDirectJob());
            setRefresh(prev => !prev)
            openNotification('Success', `Direct Job Deleted`, 'green');
        } catch (e) {
            console.log(e);
            openNotification('Error', e?.response?.data?.message || 'Could not delete this entry.', 'red');
        }
    };

    const openEntry = async (item) => {
        dispatch(incrementTab({ "label": "Edit Direct Job E / R", "key": "3-15", "id": item.id }))
        await Router.push(`/accounts/directJob/${item.id}`)
    };

    const newEntry = async () => {
        dispatch(incrementTab({ "label": "Direct Job E / R", "key": "3-15", "id": "new" }))
        dispatch(resetDirectJob())
        await Router.push(`/accounts/directJob/new`)
    };

// Back to page 1 together with the new search, so it is one request.
useEffect(() => {
  const next = search.trim();
  if (next === query) return;
  const t = setTimeout(() => { setQuery(next); setCurrentPage(1); }, 300);
  return () => clearTimeout(t);
}, [search, query]);

/* ONE REQUEST PER PAGE. The whole chart of accounts used to be fetched here
 * too, on every page change and every keystroke, only to turn ten Account_No
 * ids into names - the server now sends each entry's accountTitle. And only
 * the newest request's answer is shown: a slow page 2 arriving after page 3
 * no longer replaces it. */
useEffect(() => {
  const mine = ++latest.current;
  const fetchData = async () => {
    setLoading(true);
    try {
      const jobs = await axiosClient.get(
        `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/getDirectJobList`,
        {
          params: {
            page: currentPage,
            pageSize,
            search: query
          }
        }
      );
      if (mine !== latest.current) return;

      setAllRecords(jobs.data.result);
      setTotal(jobs.data.total);

    } catch (err) {
      console.error(err);
      if (mine === latest.current) {
        openNotification('Error', err?.response?.data?.error || 'Could not load the direct job entries.', 'red');
      }
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  };

  fetchData();
}, [currentPage, query, refresh]);



    /* The title and New live in the page header now, with every other screen's.
     *
     * What this replaces: an <h2> of its own, and a dark filled circle holding
     * a + that appeared nowhere else in the app. The + was the only way to
     * start an entry and it looked like a floating action button borrowed from
     * a phone; New is the first slot of the toolbar on every converted page,
     * which is where somebody who has used any other screen will look. */
    usePageActions({
        title: 'Direct Job Expense / Revenue',
        new: { onClick: newEntry, label: 'New entry', title: 'Start a new direct job entry' },
    }, []);

    /* THE LIST (2026-11-16 redesign) - the shared list look (styles/
     * dataList), as Invoices / Bills and the vouchers. It was a card per entry
     * - three rows of label-over-value pairs, ten to a page, a Cost Center of
     * "KHI" printed on every one of them whatever it was, and the pager above
     * the cards. Now a row each: what it is and how it was paid as labels, the
     * jobs it covers, the amount right-aligned; the pencil and bin on the row
     * the pointer is on, and a click on the row opens it. */
    const firstRow = (currentPage - 1) * pageSize;
    const noOfPages = Math.ceil(total / pageSize);
    return (
        <div className='base-page-layout dl-screen'>
            {/* THE SEARCH BOX - searched on the server, over every value the
                list shows (job numbers, dates as shown, an amount). */}
            <div className='dl-toolbar'>
                <Input
                    allowClear
                    className='dl-search'
                    prefix={<SearchOutlined />}
                    placeholder="Search entries…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <span className='dl-total'>
                    {loading && <Spin size='small' />}
                    {Number(total || 0).toLocaleString()} entr{total === 1 ? 'y' : 'ies'}
                </span>
            </div>
            <div className={`dl-table-wrap${loading ? ' is-loading' : ''}`} aria-busy={loading}>
                {!currentRecords.length ? (
                    <div className='dl-empty'>
                        <Empty description={loading ? 'Loading…' : query ? `No entry matches “${query}”.` : 'No direct job entries yet.'} />
                    </div>
                ) : (
                <table className='dl-table dj-table'>
                    <thead>
                        <tr>
                            <th>Entry #</th>
                            <th>Date</th>
                            <th>Kind</th>
                            <th>Mode</th>
                            <th>Job #</th>
                            <th>Account</th>
                            <th>Reference #</th>
                            <th>Cheque</th>
                            <th>Voucher #</th>
                            <th>Cur.</th>
                            <th className='dl-num'>Amount</th>
                            <th>Created By</th>
                            <th aria-label='Actions' />
                        </tr>
                    </thead>
                    <tbody>
                        {currentRecords.map((item, index) => {
                            const jobs = (item.Associations || []).map((a) => a.Job_No).filter(Boolean);
                            const mode = MODES[item.Tran_Mode];
                            const kind = KINDS[String(item.Type || '').toLowerCase()];
                            return (
                            <tr key={item.id ?? index} className='dl-click' onClick={() => openEntry(item)} title='Open this entry'>
                                <td className='dl-strong'>{item.Entry_No}</td>
                                <td className='dl-muted'>{moment(entryDateOf(item)).format("DD MMM YYYY")}</td>
                                <td>{kind ? <span className={`dl-badge tone-${kind[1]}`}>{kind[0]}</span> : null}</td>
                                <td>{mode ? <span className={`dl-badge tone-${mode[1]}`}>{mode[0]}</span> : <span className='dj-none'>—</span>}</td>
                                <td>
                                    {jobs[0] || <span className='dj-none'>—</span>}
                                    {/* A multiple-job entry: how many more, the rest on hover. */}
                                    {jobs.length > 1 && (
                                        <span className='dl-badge dj-more' title={jobs.join(', ')}>+{jobs.length - 1}</span>
                                    )}
                                    {item.Operation && <div className='dj-sub'>{String(item.Operation).toUpperCase()}</div>}
                                </td>
                                <td><span className='dl-clip' title={item.accountTitle}>{item.accountTitle}</span></td>
                                <td className='dl-muted'>{item.Reference_No || <span className='dj-none'>—</span>}</td>
                                <td>
                                    {item.Cheque_No
                                        ? <>{item.Cheque_No}{item.Cheque_Date && <div className='dj-sub'>{moment(item.Cheque_Date).format("DD MMM YYYY")}</div>}</>
                                        : <span className='dj-none'>—</span>}
                                </td>
                                <td className='dl-muted'>{item.Associations?.[0]?.Voucher?.voucher_Id}</td>
                                <td>{item.Currency}</td>
                                <td className='dl-num dl-strong'>{commas((item.Associations || []).reduce((sum, assoc) => sum + Number(assoc.Amount), 0))}</td>
                                {/* The person only: a voucher migrated from Climax
                                    carries its add log, "DIRECTOR 1 #
                                    192.168.50.213:51582". */}
                                <td className='dl-muted'>{personOf(item.Associations?.[0]?.Voucher?.createdBy)}</td>
                                <td className='dj-actions' onClick={(e) => e.stopPropagation()}>
                                    <RowAction Icon={EditOutlined} label='Edit' kind='primary' onClick={() => openEntry(item)} />
                                    <RowAction
                                        Icon={DeleteOutlined}
                                        label='Delete'
                                        kind='danger'
                                        onClick={() => deleteData(item.id)}
                                        confirm={{
                                            what: 'direct job entry',
                                            name: item.Entry_No,
                                            body: 'Its voucher and every line on it go with it.',
                                        }}
                                    />
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
                )}
            </div>
            {currentRecords.length > 0 && (
                <div className='dl-footer'>
                    <span>Showing {firstRow + 1}&ndash;{firstRow + currentRecords.length} of {Number(total || 0).toLocaleString()}</span>
                    {noOfPages > 1 && <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={setCurrentPage} />}
                </div>
            )}
        </div>
    );
};

export default DirectJobList
