import moment from 'moment';
import axiosClient from 'apis/axiosClient';

// What every part of the Archive screen shares: one way to ask the
// server, and one way to show a date and a figure.

/** GET /archive/<book>/<path>, its `result` - or a thrown Error with the server's words. */
export async function archiveGet(book, path, params) {
  try {
    const { data } = await axiosClient.get(
      `${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/archive/${encodeURIComponent(book)}/${path}`,
      { params },
    );
    if (data?.status !== 'success') throw new Error(data?.result || 'The archive could not read that.');
    return data.result;
  } catch (e) {
    throw new Error(e?.response?.data?.result || e?.message || 'The archive could not read that.');
  }
}

export async function archiveBooks() {
  const { data } = await axiosClient.get(`${process.env.NEXT_PUBLIC_CLIMAX_MAIN_URL}/archive/books`);
  return data?.status === 'success' ? data.result : { enabled: false, books: [] };
}

/** The server's 'YYYY-MM-DD' (a wall date - see functions/archive/values) as DD-MMM-YYYY. */
export const showDate = (v) => (v ? moment(v, 'YYYY-MM-DD').format('DD-MMM-YYYY') : '');

export const DAY = 'YYYY-MM-DD';

export const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** A running balance as "1,234.00 Dr" / "56.00 Cr". */
export const drCr = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) < 0.005) return '0.00';
  return `${money(Math.abs(n))} ${n > 0 ? 'Dr' : 'Cr'}`;
};
