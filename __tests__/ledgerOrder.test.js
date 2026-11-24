import moment from 'moment';
import { inLedgerOrder } from '../functions/ledgerOrder';

// Local times, so the day is the same in any time zone the suite runs in.
const at = (day, hour = 12, minute = 0) => moment(`${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, 'YYYY-MM-DD HH:mm').toISOString();
// A ledger line: its ledger date (createdAt) and, optionally, when its voucher
// was entered (Voucher.createdOn).
const row = (id, createdAt, createdOn) => ({ id, createdAt, ...(createdOn !== undefined ? { 'Voucher.createdOn': createdOn } : {}) });
const ids = (rows) => inLedgerOrder(rows).map((r) => r.id);

describe('the order of a ledger\'s entries', () => {
  test('the day first, whenever the entries were made', () => {
    expect(ids([
      row('b', at('2026-09-02', 9), at('2026-09-01', 8)),
      row('a', at('2026-09-01', 12), at('2026-09-03', 8)),
    ])).toEqual(['a', 'b']);
  });

  test('then the order they were made, by the voucher\'s entry stamp', () => {
    expect(ids([
      row('second', at('2026-09-01', 5), at('2026-09-01', 15)),
      row('first', at('2026-09-01', 5), at('2026-09-01', 10)),
      row('third', at('2026-09-01', 5), at('2026-09-01', 16, 30)),
    ])).toEqual(['first', 'second', 'third']);
  });

  test('an invoice\'s voucher (on its date, no time) sits where it was made, not at the top of the day', () => {
    // The invoice's voucher stands on 1 Sep with no time of day; the receipt
    // was keyed at 10:00 and the invoice approved at 15:00.
    expect(ids([
      row('invoice', at('2026-09-01', 0), at('2026-09-01', 15)),
      row('receipt', at('2026-09-01', 10), at('2026-09-01', 10)),
    ])).toEqual(['receipt', 'invoice']);
  });

  test('a back-dated entry comes after what was made on that day', () => {
    expect(ids([
      row('backdated', at('2026-09-01', 0), at('2026-09-20', 9)),
      row('ontime', at('2026-09-01', 17), at('2026-09-01', 17)),
    ])).toEqual(['ontime', 'backdated']);
  });

  test('a voucher with no entry stamp goes by its ledger time', () => {
    expect(ids([
      row('stamped', at('2026-09-01', 12), at('2026-09-01', 12)),
      row('unstamped', at('2026-09-01', 11), null),
      row('noField', at('2026-09-01', 13)),
    ])).toEqual(['unstamped', 'stamped', 'noField']);
  });

  test('ties keep the server\'s order - a voucher\'s lines stay together', () => {
    const t = at('2026-09-01', 10);
    expect(ids([row('l1', t, t), row('l2', t, t), row('l3', t, t)])).toEqual(['l1', 'l2', 'l3']);
  });

  test('nothing to order', () => {
    expect(inLedgerOrder(undefined)).toEqual([]);
  });
});
