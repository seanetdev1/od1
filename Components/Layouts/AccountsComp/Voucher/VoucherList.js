import React, { useState } from 'react';
import { Radio } from 'antd';
import Router from 'next/router';
import { useDispatch } from 'react-redux';
import ListData from './list/List';
import { incrementTab } from 'redux/tabs/tabSlice';
import { resetState } from 'redux/vouchers/voucherSlice';
import { usePageActions } from 'Components/Shared/PageActions';

/* WHICH VOUCHERS - a server filter, not a client one.
 *
 * This used to hold every voucher in the company and slice it three ways in
 * the browser. That cannot survive pagination - page one of twenty rows may
 * contain no SI/PI at all - so each list asks for its own page of its own
 * category, and the split lives in ONE place, the backend's VOUCHER_TABS.
 *
 * A choice in the list's own toolbar (2026-11-16 redesign), as Invoices /
 * Bills chooses its kind; it was a row of tabs above it. Keyed by category,
 * so a list chosen again starts afresh rather than showing a page from
 * before an edit - what the tabs' destroyInactiveTabPane did.
 */
export const VOUCHER_CATEGORIES = [
  ['general', 'General'],
  ['sipi', 'SI / PI'],
  ['opening', 'Opening'],
];

const VoucherList = () => {
  const dispatch = useDispatch();
  const [category, setCategory] = useState('general');
  // The title and New on the toolbar (PageActions) - New was each tab's own
  // Create button.
  usePageActions({
    title: 'Vouchers',
    new: {
      onClick: async () => {
        dispatch(incrementTab({ "label": "Voucher", "key": "3-5", "id": "new" }))
        dispatch(resetState())
        await Router.push(`/accounts/vouchers/new`)
      },
      label: 'New Voucher',
      title: 'Create a new voucher',
    },
  }, []);
  const choice = (
    <Radio.Group className='dl-segmented' value={category} onChange={(e) => setCategory(e.target.value)}>
      {VOUCHER_CATEGORIES.map(([key, label]) => <Radio.Button key={key} value={key}>{label}</Radio.Button>)}
    </Radio.Group>
  );
  return (
    <div className='base-page-layout dl-screen'>
      <ListData key={category} category={category} choice={choice} />
    </div>
  );
};

export default VoucherList
