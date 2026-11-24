import Router from 'next/router';
import axiosClient from 'apis/axiosClient';
import { incrementTab } from 'redux/tabs/tabSlice';
import { resetDirectJob, updateDirectJobItem } from 'redux/directJob/directJobSlice';
import { jobFields } from 'functions/directJobLines';
import { sourceLink } from 'functions/voucherSource';

/**
 * Opening Accounts > Direct Job E / R from another screen - a customs job's
 * charge Summary (asked 2026-11-17): an entry by its id, or a new one already
 * on the job being looked at. The same tab and route the Direct Job list
 * opens them in.
 */

/** An existing entry, in its Direct Job tab. */
export const openDirectJobEntry = (dispatch, id) => {
  const link = sourceLink({ page: 'directJob', id });
  if (!link) return Promise.resolve(false);
  dispatch(incrementTab(link.tab));
  return Router.push(link.path);
};

/**
 * A NEW entry with its first line already on `job` ({ id, jobNo }) -
 * single-job, so the header's Job # and File # show it. Like the list's New,
 * it replaces whatever the Direct Job tab held.
 *
 * The job comes from the Direct Job screen's own lookup, so its File # is
 * whatever that screen would fill - on customs, the S/R Page # or the
 * migrated file number, as Configuration > Customs > Job Screen says. Not
 * found (or not reachable), the line still gets the job, with no File #.
 */
export const newDirectJobFor = async (dispatch, job) => {
  let row = job;
  try {
    const res = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/voucher/getDirectJobNumbers`, {
      params: { search: job?.jobNo, exact: 1, page: 1, limit: 5 },
    });
    row = (res?.data?.data || []).find((r) => String(r.id) === String(job?.id)) || { id: job?.id, jobNo: job?.jobNo };
  } catch (e) {
    row = { id: job?.id, jobNo: job?.jobNo };
  }
  dispatch(resetDirectJob());
  Object.entries(jobFields(row)).forEach(([field, value]) => dispatch(updateDirectJobItem({ index: 0, field, value })));
  dispatch(incrementTab({ label: 'Direct Job E / R', key: '3-15', id: 'new' }));
  return Router.push('/accounts/directJob/new');
};
