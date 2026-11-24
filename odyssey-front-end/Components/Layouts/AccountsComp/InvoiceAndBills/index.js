import React, { useEffect, useRef, useState } from 'react';
import InvoiceCharges from '../../../Shared/InvoiceCharges';
import { Input, Empty, Radio, Modal, Checkbox, DatePicker, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import Pagination from 'Components/Shared/Pagination';
import openNotification from '../../../Shared/Notification';
import { useDispatch, useSelector } from 'react-redux';
import { incrementTab } from 'redux/tabs/tabSlice';
import Router from "next/router"
import axiosClient from 'apis/axiosClient';
import Cookies from 'js-cookie';
import PrintList from './PrintList';
import { usePageActions } from 'Components/Shared/PageActions';
import { addToPrintList, removeFromPrintList, inPrintList } from 'functions/invoicePrintList';
import { isCustomsMode } from 'functions/terminology';

/* The bulk print list survives the tab being closed and reopened, for this
 * browser session - see functions/invoicePrintList. sessionStorage can be
 * unavailable (a private window, blocked site data); the list then lasts as
 * long as the screen does. */
const PRINT_LIST_KEY = 'odyssey.invoicePrintList';
const readPrintList = () => {
  try { return JSON.parse(window.sessionStorage.getItem(PRINT_LIST_KEY)) || []; } catch (_) { return []; }
};
const writePrintList = (list) => {
  try { window.sessionStorage.setItem(PRINT_LIST_KEY, JSON.stringify(list)); } catch (_) { /* session only */ }
};

// Matches the limit the page's getServerSideProps asks for, so the first page
// the server rendered is the same size as every page fetched after it.
const PAGE_SIZE = 20;

/**
 * An amount, as the invoice documents print it: two decimals, thousands
 * grouped.
 *
 * Deliberately the same `commas` helper Shared/InvoiceCharges and
 * Shared/InvoicePrint use, rather than toLocaleString - a figure on this list
 * and the same figure on the invoice it opens must not disagree, and
 * toLocaleString with no locale follows the browser's, so two people looking at
 * one invoice could see 1,250.00 and 1.250,00.
 *
 * `total` is a STRING column. Every row in it parses as a number today, but a
 * blank or a stray character would render as "NaN" against a customer's money,
 * so anything unparseable is shown as it was stored rather than as arithmetic
 * that failed.
 */
const money = (v) => {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return v ?? '';
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/* WHICH LIST. "Old Job Invoice" and "Old Job Bill" are gone from the choice
 * (the user, 2026-11-15): the types the Climax uploader once wrote - no
 * install has a single one (CL and SNS checked that day). */
export const INVOICE_TYPES = ['Job Invoice', 'Job Bill', 'Agent Invoice', 'Agent Bill'];
const plural = (type) => `${type.toLowerCase()}s`;

/* Who it is against, as the list shows it: 'client' -> 'Client'. */
const titleCase = (v) => String(v || '').replace(/\b\w/g, (c) => c.toUpperCase());

/* The rate beside the currency, only when it says something: a PKR invoice
 * at 1 needs none. */
const rateOf = (x) => {
  const n = parseFloat(x.ex_rate);
  return Number.isFinite(n) && n !== 1 ? n : null;
};

const InvoiceAndBills = ({invoiceData}) => {

  const companyId = useSelector((state) => state.company.value);
  const dispatch = useDispatch();
  const [load, setLoad] = useState(false);
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(false);
  const [invoice, setInvoice] = useState({});
  // Seeded from the server-rendered first page rather than fetched again on
  // mount, so the list is on screen immediately and the count the pager is
  // built from is right before the first click.
  const [records, setRecords] = useState(invoiceData?.result || []);
  const [total, setTotal] = useState(Number(invoiceData?.count) || 0);
  const [currentPage, setCurrentPage] = useState(1);
  const [type, setType] = useState("Job Invoice");
  // What the search finds under the OTHER lists - { 'Agent Bill': 1 } - from
  // the server. A number does not always say which list it is on: Climax
  // numbered agent bills "AI" too, so SNS-AI-620/26, an agent bill, was looked
  // for under Agent Invoice and read as missing (2026-11-16). Kept with the
  // search it answers, so text still being typed is not shown beside the
  // last search's counts.
  const [elsewhere, setElsewhere] = useState({ query: '', counts: {} });
  // The invoice-date range, [from, to]; either end may be empty. Applied on
  // the server, like the search - see /invoice/getFilteredInvoices.
  const [dates, setDates] = useState([null, null]);
  // Read after mount, not in the initialiser: the server renders this page
  // too, has no sessionStorage, and a first render that differed between the
  // two would not hydrate.
  const [printList, setPrintList] = useState([]);
  const printListLoaded = React.useRef(false);
  useEffect(() => { setPrintList(readPrintList()); printListLoaded.current = true; }, []);
  useEffect(() => { if (printListLoaded.current) writePrintList(printList); }, [printList]);
  const togglePrint = (row, checked) => {
    setPrintList((list) => (checked ? addToPrintList(list, row, type) : removeFromPrintList(list, row.id)));
  };
  // The header box: the page in view, all on or all off. Rows on other pages
  // and other searches stay as they are.
  const pageOnList = records.filter((x) => inPrintList(printList, x.id)).length;
  const togglePage = (checked) => {
    setPrintList((list) => records.reduce(
      (acc, x) => (checked ? addToPrintList(acc, x, type) : removeFromPrintList(acc, x.id)),
      list,
    ));
  };
  // The row itself opens the invoice; a click on its box must not.
  const stop = (e) => e.stopPropagation();

  /* One page of invoices, as the SERVER filtered them.
   *
   * The screen used to hold every invoice of a type and filter that array in
   * the browser, which meant the search box could only ever find what had
   * already been downloaded - and on an old book that download was the whole
   * table. Both are the server's job now, so this is the only place rows come
   * from. */
  const loadPage = async (page, query, invoiceType, range = dates) => {
    setLoad(true);
    try {
      const { data } = await axiosClient.get(
        process.env.NEXT_PUBLIC_CLIMAX_GET_FILTERED_INVOICES,
        {
          headers: { "type": `${invoiceType}`, companyid: `${Cookies.get('companyId')}` },
          params: {
            page, limit: PAGE_SIZE, search: query || undefined,
            from: range?.[0] ? range[0].format('YYYY-MM-DD') : undefined,
            to: range?.[1] ? range[1].format('YYYY-MM-DD') : undefined,
          },
        },
      );
      if (data?.status !== 'success') {
        openNotification('Error', data?.result || 'Could not load invoices.', 'red');
        return;
      }
      setRecords(data.result || []);
      setTotal(Number(data.count) || 0);
      setElsewhere({ query: query || '', counts: (query && data.elsewhere) || {} });
    } catch (e) {
      openNotification('Error', e?.response?.data?.result || 'Could not load invoices.', 'red');
    } finally {
      setLoad(false);
    }
  };

  // A different type is a different list, so it starts at its own page 1 -
  // page 4 of Job Invoices is not page 4 of Agent Bills.
  const showType = (next) => {
    setType(next);
    setCurrentPage(1);
    loadPage(1, search, next);
  };
  const onChange = (e) => showType(e.target.value);
  const elsewhereTypes = elsewhere.query && elsewhere.query === search
    ? INVOICE_TYPES.filter((t) => t !== type && elsewhere.counts[t] > 0)
    : [];

  /* Debounced, so typing an invoice number is one request rather than eight -
   * and it goes back to page 1, because page 4 of the old result is not page 4
   * of the new one. The first render is skipped: the rows the server already
   * rendered ARE page 1, and re-fetching them would be a request for what is
   * already on screen. */
  const firstRender = React.useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => {
      setCurrentPage(1);
      loadPage(1, search, type);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // A new range is a new list: back to its page 1.
  const onDates = (next) => {
    const range = next || [null, null];
    setDates(range);
    setCurrentPage(1);
    loadPage(1, search, type, range);
  };

  const goToPage = (page) => {
    setCurrentPage(page);
    loadPage(page, search, type);
  };

  /* THE GST INVOICE NUMBER (CL-24295) - given to an invoice approved with
   * sales tax on it, which customs clearance invoices are. A column on a
   * customs install, or wherever the invoices on the page carry one; never on
   * bills, which are not given one. The install is read after mount: the
   * server renders this page too, without the cookie, and a column it did not
   * render would not hydrate. Searchable either way - the server looks in it. */
  const [customs, setCustoms] = useState(false);
  useEffect(() => { setCustoms(isCustomsMode()); }, []);
  const showGst = !/Bill$/.test(type) && (customs || records.some((x) => x.Sales_Tax_Invoice?.taxInvoiceNo));

  /* The title, and Print for the print list, on the toolbar (PageActions).
   * Print opens the print list's Printing Options - see PrintList. */
  const printListRef = useRef(null);
  usePageActions({
    title: 'Invoices / Bills',
    print: {
      onClick: () => printListRef.current?.open(),
      disabled: !printList.length,
      label: printList.length ? `Print all (${printList.length})` : 'Print',
      title: printList.length
        ? `Print the ${printList.length} on the print list`
        : 'Tick invoices or bills to put them on the print list',
    },
  }, [printList.length]);

  const noOfPages = Math.ceil(total / PAGE_SIZE);
  // Continuous across pages: the first row of page 2 is 21, not 1 again.
  const firstSr = (currentPage - 1) * PAGE_SIZE;
  const openInvoice = async (x) => {
    await Router.push(`/reports/invoice/${x.id}`);
    dispatch(incrementTab({ "label": "Invoice details", "key": "3-17", "id": `${x.id}` }));
  };

  /* THE LIST (2026-11-15 redesign) - the shared list look (styles/dataList):
   * the controls in one row with the count at its end, the table filling the
   * page with its heading fixed, labels for who it is against and whether it
   * is approved, the rate beside the currency it applies to, and the pages
   * under it. A new page dims the old one rather than swapping the table for
   * a spinner, so the screen does not jump on every click. */
  return (
    <div className='base-page-layout dl-screen'>
      <div className='dl-toolbar'>
        {/* Searches the whole book on the server, not the page in hand. */}
        <Input
          allowClear
          className='dl-search'
          prefix={<SearchOutlined />}
          onChange={(e) => setSearch(e.target.value)}
          value={search}
          placeholder={customs ? "Search invoice no, GST no, job no, party, amount..." : "Search invoice no, job no, party, amount..."}
        />
        {/* By invoice date - either end can be left open. */}
        <DatePicker.RangePicker value={dates} onChange={onDates} allowEmpty={[true, true]}
          format='DD-MM-YYYY' placeholder={['From', 'To']} style={{ width: 250 }} />
        <Radio.Group className='dl-segmented' onChange={onChange} value={type}>
          {INVOICE_TYPES.map((t) => <Radio.Button key={t} value={t}>{t}</Radio.Button>)}
        </Radio.Group>
        {/* What the SERVER says this type totals - the pager is built from it. */}
        <span className='dl-total'>
          {load && <Spin size='small' />}
          {total.toLocaleString()} {total === 1 ? type.toLowerCase() : plural(type)}
        </span>
      </div>

      {/* Above the results and outside the loading state: it is not the page
          of results, and stays put while a new search runs. */}
      <PrintList ref={printListRef} printFromToolbar list={printList} setList={setPrintList} companyId={companyId} />

      {/* The search's hits under the other lists, one click away. */}
      {elsewhereTypes.length > 0 && (
        <div className='dl-elsewhere'>
          <span>{records.length ? 'Also matching' : 'Matching'} &ldquo;{elsewhere.query}&rdquo; under</span>
          {elsewhereTypes.map((t) => (
            <button key={t} type='button' className='dl-elsewhere-link' onClick={() => showType(t)}>
              {t} <b>{elsewhere.counts[t].toLocaleString()}</b>
            </button>
          ))}
        </div>
      )}

      {Object.keys(invoice).length > 0 &&
        <Modal open={visible} onOk={() => setVisible(false)} onCancel={() => setVisible(false)}
          width={"80%"}
          footer={false}
          centered={true}
          maskClosable={false}
        >
          <InvoiceCharges data={invoice} companyId={companyId} />
        </Modal>
      }

      <div className={`dl-table-wrap${load ? ' is-loading' : ''}`} aria-busy={load}>
        {records.length === 0 ? (
          <div className='dl-empty'>
            <Empty description={load ? 'Loading…' : search ? `No ${plural(type)} match "${search}"` : `No ${plural(type)}`} />
          </div>
        ) : (
          <table className='dl-table'>
            <thead>
              <tr>
                <th className='dl-check' title='Add this page to the print list'>
                  <Checkbox
                    checked={records.length > 0 && pageOnList === records.length}
                    indeterminate={pageOnList > 0 && pageOnList < records.length}
                    onChange={(e) => togglePage(e.target.checked)}
                  />
                </th>
                <th>#</th>
                <th>Invoice No.</th>
                {showGst && <th>GST Inv #</th>}
                <th>Job No.</th>
                <th>Party</th>
                <th>Against</th>
                <th>Status</th>
                {/* Who generated it - the first History 'Create' (see the server). */}
                <th>Created By</th>
                <th>Op.</th>
                <th>Currency</th>
                {/* Money reads down a column, so it is aligned right and the
                    header goes with it. */}
                <th className='dl-num'>Amount</th>
              </tr>
            </thead>
            <tbody>
              {records.map((x, index) => {
                const rate = rateOf(x);
                const approved = x.approved == 1;
                return (
                  <tr key={x.id ?? index} className='dl-click' onClick={() => openInvoice(x)}>
                    <td className='dl-check' onClick={stop} title={inPrintList(printList, x.id) ? 'On the print list' : 'Add to the print list'}>
                      <Checkbox
                        checked={inPrintList(printList, x.id)}
                        onChange={(e) => togglePrint(x, e.target.checked)}
                      />
                    </td>
                    <td className='dl-muted dl-num'>{firstSr + index + 1}</td>
                    <td className='dl-strong'>{x.invoice_No}</td>
                    {showGst && <td>{x.Sales_Tax_Invoice?.taxInvoiceNo || ''}</td>}
                    {/* A freight invoice's job, or for a customs or aviation
                        one its charge lines' - the server works out which. */}
                    <td>{x.jobNo ?? x.SE_Job?.jobNo ?? ''}</td>
                    <td><span className='dl-clip' title={x.party_Name}>{x.party_Name}</span></td>
                    <td>{x.partyType ? <span className='dl-badge'>{titleCase(x.partyType)}</span> : null}</td>
                    <td>
                      <span className={`dl-badge ${approved ? 'tone-green' : 'tone-amber'}`}>{approved ? 'Approved' : 'Unapproved'}</span>
                    </td>
                    <td className='dl-muted'>{x.createdByName || '-'}</td>
                    <td className='dl-muted dl-code'>{x.operation}</td>
                    <td>
                      {x.currency}
                      {rate !== null && <span className='dl-muted' title='Exchange rate'> @ {rate}</span>}
                    </td>
                    <td className='dl-num dl-strong'>{money(x.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {records.length > 0 &&
        <div className='dl-footer'>
          <span>Showing {firstSr + 1}&ndash;{firstSr + records.length} of {total.toLocaleString()}</span>
          {noOfPages > 1 &&
            <Pagination noOfPages={noOfPages} currentPage={currentPage} setCurrentPage={goToPage} />
          }
        </div>
      }
    </div>
  )
}

export default InvoiceAndBills
