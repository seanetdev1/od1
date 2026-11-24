/**
 * The Payments & Receipts selection - functions/paymentReceiptSelection.
 *
 * The amounts a receipt pays used to live on the rows of a paged, searchable
 * list, and vanished whenever the list changed. They now live in a selection
 * that the list only displays. These pin the rules that decide what a receipt
 * posts: what counts as chosen, what an edited receipt must still send, how
 * auto knock-off spreads an amount, and what the totals are made of.
 */
import {
  setAllocation, setAllocations, withSelection, selectedEntries,
  entriesToSubmit, seedFromSaved, knockOff, knockOffPool, hasPicked, receiptTotals,
  allowedAmount, isOverpaid, balanceAfter, isSettledHere, fullAmount,
} from '../functions/paymentReceiptSelection';
import { groupThousands, ungroupThousands } from '../functions/amountInput';

// Open invoices as the list returns them: recieved/paid is what already stands
// settled, and constReceiving mirrors it on a new receipt.
const inv = (id, createdAt, total, extra = {}) => ({
  id, createdAt, total: String(total), payType: 'Recievable',
  recieved: '0', paid: '0', constReceiving: 0, currency: 'PKR', ex_rate: '1', ...extra,
});

const OLD = inv(1, '2026-01-10', 100);
const MID = inv(2, '2026-03-10', 200);
const NEW = inv(3, '2026-06-10', 300);
// The list's own order is newest first.
const LIST = [NEW, MID, OLD];

describe('choosing invoices', () => {
  test('an amount picks an invoice, and zero takes it back out', () => {
    let sel = setAllocation({}, MID, 150);
    expect(sel['2']).toMatchObject({ receiving: 150, picked: true, byKnockOff: false, saved: false });
    sel = setAllocation(sel, MID, 0);
    expect(sel['2']).toBeUndefined();
  });

  test('a choice survives the list changing - the point of all this', () => {
    const sel = setAllocation({}, OLD, 100);
    // A search now shows only MID and NEW; OLD is off screen but still paid.
    expect(withSelection([NEW, MID], sel).map((r) => r.receiving)).toEqual([0, 0]);
    expect(entriesToSubmit(sel).map((e) => e.id)).toEqual([1]);
  });

  test('the list shows what the selection pays, and nothing for the rest', () => {
    const sel = setAllocation({}, MID, 50);
    expect(withSelection(LIST, sel).map((r) => r.receiving)).toEqual([0, 50, 0]);
  });

  test('select-all is the same rule applied to each row', () => {
    const sel = setAllocations({}, LIST.map((invoice) => ({ invoice, amount: invoice.total })));
    expect(selectedEntries(sel)).toHaveLength(3);
    const cleared = setAllocations(sel, LIST.map((invoice) => ({ invoice, amount: 0 })));
    expect(cleared).toEqual({});
  });
});

describe('editing a saved receipt', () => {
  const paidByThisReceipt = { ...MID, receiving: 120, constReceiving: 120 };
  const untouched = { ...OLD, receiving: 0 };

  test('starts from the invoices the receipt paid, at the amounts it paid', () => {
    const sel = seedFromSaved([paidByThisReceipt, untouched]);
    expect(Object.keys(sel)).toEqual(['2']);
    expect(sel['2']).toMatchObject({ receiving: 120, picked: true, saved: true });
  });

  test('taking one off keeps it, at zero, so the save can remove its old settlement', () => {
    const sel = setAllocation(seedFromSaved([paidByThisReceipt]), paidByThisReceipt, 0);
    expect(entriesToSubmit(sel)).toEqual([expect.objectContaining({ id: 2, receiving: 0 })]);
    // ...but it is no longer shown as chosen.
    expect(selectedEntries(sel)).toEqual([]);
  });
});

describe('auto knock-off', () => {
  test('with nothing picked it pays the list, OLDEST first', () => {
    const sel = knockOff({}, LIST, 250);
    expect(sel['1']).toMatchObject({ receiving: 100, byKnockOff: true, picked: false });
    expect(sel['2']).toMatchObject({ receiving: 150, byKnockOff: true });
    expect(sel['3']).toBeUndefined();
  });

  test('with invoices picked it pays ONLY those, oldest first, and leaves the list alone', () => {
    let sel = setAllocation({}, NEW, 1);
    sel = setAllocation(sel, OLD, 1);
    sel = knockOff(sel, LIST, 120);
    expect(sel['1'].receiving).toBe(100);   // OLD, first, in full
    expect(sel['3'].receiving).toBe(20);    // NEW, what is left
    expect(sel['2']).toBeUndefined();       // on screen, not picked: untouched
  });

  test('a picked invoice the amount did not reach stays chosen, at zero', () => {
    let sel = setAllocation({}, OLD, 1);
    sel = setAllocation(sel, MID, 1);
    sel = setAllocation(sel, NEW, 1);
    sel = knockOff(sel, LIST, 50);
    expect(selectedEntries(sel).map((e) => [e.id, e.receiving]))
      .toEqual([[1, 50], [2, 0], [3, 0]]);
  });

  test('typing the amount digit by digit ends where typing it at once does', () => {
    // Without clearing earlier knock-off additions, "8" would pay OLD and
    // "80" would then treat OLD as the user's choice and pay only that.
    let sel = {};
    for (const typed of [2, 25, 250]) sel = knockOff(sel, LIST, typed);
    expect(sel).toEqual(knockOff({}, LIST, 250));
  });

  test('the last invoice takes whatever is left, as it always did', () => {
    const sel = knockOff({}, LIST, 1000);
    expect([sel['1'].receiving, sel['2'].receiving, sel['3'].receiving]).toEqual([100, 200, 700]);
  });

  test('changing a knocked-off amount by hand makes it a choice', () => {
    let sel = knockOff({}, LIST, 250);
    sel = setAllocation(sel, OLD, 40);
    expect(sel['1']).toMatchObject({ picked: true, byKnockOff: false });
    // The next knock-off now pays only what was chosen.
    sel = knockOff(sel, LIST, 90);
    expect(sel['1'].receiving).toBe(90);
    expect(sel['2']).toBeUndefined();
  });

  test('counts what is already settled against an invoice', () => {
    const partPaid = inv(9, '2025-12-01', 100, { recieved: '70', constReceiving: 70 });
    const sel = knockOff({}, [NEW, partPaid], 50);
    expect(sel['9'].receiving).toBe(30);
    expect(sel['3'].receiving).toBe(20);
  });

  test('when editing, this receipt\'s own earlier payment counts as open again', () => {
    // recieved 100 includes 60 from the receipt being edited.
    const edited = inv(9, '2025-12-01', 100, { recieved: '100', constReceiving: 60 });
    expect(knockOff({}, [NEW, edited], 80, true)['9'].receiving).toBe(60);
  });

  test('float dust left by one invoice does not ride on to the next', () => {
    // 300.3 - 100.1 is 200.20000000000002, not 200.2.
    const a = inv(11, '2026-01-01', 100.1);
    const b = inv(12, '2026-01-02', 200.2);
    const c = inv(13, '2026-01-03', 50);
    const sel = knockOff({}, [a, b, c], 300.3);
    expect(sel['11'].receiving).toBeCloseTo(100.1, 10);
    expect(sel['12'].receiving).toBeCloseTo(200.2, 10);
    expect(sel['13']).toBeUndefined();
  });
});

/* Reported 2026-10-20: an amount bigger than the page on screen put all the
 * rest on that page's last invoice, with the party's other pages untouched. */
describe('auto knock-off across pages', () => {
  // Pages of two, five invoices of 100 each - oldest on page 1, as served.
  const PAGES = {
    1: [inv(1, '2026-01-01', 100), inv(2, '2026-01-02', 100)],
    2: [inv(3, '2026-01-03', 100), inv(4, '2026-01-04', 100)],
    3: [inv(5, '2026-01-05', 100)],
  };
  const pool = (amount, extra = {}) => {
    const loadPage = jest.fn((n) => Promise.resolve(PAGES[n] || []));
    const run = knockOffPool({
      rows: PAGES[extra.page || 1], amount, page: 1, pageSize: 2, count: 5, loadPage, ...extra,
    });
    return { run, loadPage };
  };

  test('an amount the page covers loads nothing more', async () => {
    const { run, loadPage } = pool(150);
    expect((await run).map((i) => i.id)).toEqual([1, 2]);
    expect(loadPage).not.toHaveBeenCalled();
  });

  test('loads the next pages only as far as the amount needs', async () => {
    const { run, loadPage } = pool(350);
    const rows = await run;
    expect(loadPage.mock.calls.map(([n]) => n)).toEqual([2]);
    const sel = knockOff({}, rows, 350);
    expect([1, 2, 3, 4].map((id) => sel[id].receiving)).toEqual([100, 100, 100, 50]);
  });

  test('an amount the page exactly settles loads nothing more', async () => {
    const { run, loadPage } = pool(200);
    await run;
    expect(loadPage).not.toHaveBeenCalled();
  });

  test('more than everything open: every page is read and the newest takes the rest', async () => {
    const { run, loadPage } = pool(1000);
    const rows = await run;
    expect(loadPage.mock.calls.map(([n]) => n)).toEqual([2, 3]);
    const sel = knockOff({}, rows, 1000);
    expect([1, 2, 3, 4, 5].map((id) => sel[id].receiving)).toEqual([100, 100, 100, 100, 600]);
  });

  test('carries on from the page on screen', async () => {
    const { run, loadPage } = pool(250, { page: 2 });
    expect((await run).map((i) => i.id)).toEqual([3, 4, 5]);
    expect(loadPage.mock.calls.map(([n]) => n)).toEqual([3]);
  });

  test('a page that comes back empty does not end it early', async () => {
    const loadPage = jest.fn((n) => Promise.resolve(n === 2 ? [] : PAGES[n]));
    const rows = await knockOffPool({ rows: PAGES[1], amount: 300, page: 1, pageSize: 2, count: 5, loadPage });
    expect(rows.map((i) => i.id)).toEqual([1, 2, 5]);
  });

  test('an invoice that moved between pages is taken once', async () => {
    // Someone settled invoice 2 meanwhile, so it all shifted up one.
    const loadPage = jest.fn(() => Promise.resolve([PAGES[1][1], PAGES[2][0]]));
    const rows = await knockOffPool({ rows: PAGES[1], amount: 250, page: 1, pageSize: 2, count: 5, loadPage });
    expect(rows.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  test('what is already settled on an invoice is not counted as open', async () => {
    const partPaid = [inv(1, '2026-01-01', 100, { recieved: '80', constReceiving: 80 }), PAGES[1][1]];
    const { run, loadPage } = pool(150, { rows: partPaid });
    await run;
    // 20 + 100 open on page 1, short of 150.
    expect(loadPage.mock.calls.map(([n]) => n)).toEqual([2]);
  });

  test('only a choice counts as picked - not what a knock-off added', () => {
    expect(hasPicked(knockOff({}, LIST, 250))).toBe(false);
    expect(hasPicked(setAllocation({}, OLD, 10))).toBe(true);
  });
});

describe('the totals the journal is built from', () => {
  test('receivables add, payables subtract', () => {
    const bill = inv(4, '2026-02-01', 500, { payType: 'Payble' });
    const sel = setAllocation(setAllocation({}, OLD, 100), bill, 30);
    expect(receiptTotals(entriesToSubmit(sel), 1).total).toBe(70);
  });

  test('gain/loss on a foreign invoice is on what THIS receipt pays', () => {
    const usd = inv(5, '2026-02-01', 1000, { currency: 'USD', ex_rate: '280' });
    const sel = setAllocation({}, usd, 10);
    expect(receiptTotals(entriesToSubmit(sel), 285).gainLoss).toBe(50);
  });

  test('an invoice with nothing against it adds no gain/loss', () => {
    // The old reading fell back to recieved for a row with nothing typed
    // against it, charging gain/loss on earlier receipts.
    const partPaidUsd = inv(6, '2026-02-01', 1000, { currency: 'USD', ex_rate: '280', recieved: '400' });
    expect(receiptTotals([{ ...partPaidUsd, receiving: 0 }], 285)).toEqual({ total: 0, gainLoss: 0 });
  });
});

/* An invoice of 1,120.50 received at 1,121 stands at -0.50. The box turned
 * -0.50 into 0.50, so it could not be adjusted to bad debts (the user's
 * report, 2026-10-26). */
describe('an invoice paid over', () => {
  const OVER = inv(9, '2026-02-10', 1120.5, { recieved: '1121', constReceiving: '1121' });

  test('takes a minus, as far as bringing it back to zero', () => {
    expect(isOverpaid(OVER)).toBe(true);
    expect(allowedAmount(OVER, -0.5)).toBe(-0.5);
    expect(allowedAmount(OVER, -0.3)).toBe(-0.3);
    expect(allowedAmount(OVER, -5)).toBe(-0.5); // no further than zero
    expect(allowedAmount(OVER, 2)).toBe(2);
  });

  test('anywhere else a minus is a slip and is dropped, as before - and not on an edit', () => {
    expect(isOverpaid(MID)).toBe(false);
    expect(allowedAmount(MID, -50)).toBe(50);
    expect(allowedAmount(OVER, -0.5, true)).toBe(0.5);
    expect(allowedAmount(MID, null)).toBe(0);
  });

  test('a minus stays chosen, and takes the receipt total below zero', () => {
    const sel = setAllocation({}, OVER, -0.5);
    expect(selectedEntries(sel).map((e) => [e.id, e.receiving])).toEqual([[9, -0.5]]);
    expect(entriesToSubmit(sel)[0]).toMatchObject({ receiving: -0.5, picked: true });
    expect(receiptTotals(entriesToSubmit(sel), 1).total).toBe(-0.5);
  });

  test("auto knock-off pays it nothing, and its overpayment is not handed to the next", () => {
    // It used to come out at -0.50 - not kept, but taken off what was left, so
    // the next invoice got 0.50 more than the amount.
    const sel = knockOff({}, [OVER, OLD, MID], 150);
    expect(Object.values(sel).map((e) => [e.id, e.receiving])).toEqual([[1, 100], [2, 50]]);
  });
});

/* To the paisa: 566,674.52 received at 566,675 is -0.4799999999 open in
 * floating point. -0.48 against it stayed green and unticked, and the tick put
 * "-0.47,999,999,9" in the box (the user's report, 2026-10-26). */
describe('to the paisa', () => {
  const ODD = inv(10, '2026-08-05', 566674.52, { recieved: '566675', constReceiving: '566675' });

  test('-0.48 against it leaves exactly nothing - settled, and ticked', () => {
    expect(fullAmount(ODD)).toBe(-0.48);
    const row = { ...ODD, receiving: -0.48 };
    expect(balanceAfter(row)).toBe(0);
    expect(isSettledHere(row)).toBe(true);
  });

  test('half a rupee is NOT settled - only what is under a paisa', () => {
    expect(balanceAfter({ ...ODD, receiving: 0 })).toBe(-0.48);
    expect(isSettledHere({ ...ODD, receiving: 0 })).toBe(false);
    expect(isSettledHere({ ...ODD, receiving: -0.47 })).toBe(false);
    expect(balanceAfter({ ...ODD, receiving: -0.47 })).toBe(-0.01);
  });

  test('what goes into the selection is to the paisa, whatever arithmetic made it', () => {
    const sel = setAllocation({}, ODD, 566674.52 - 566675);
    expect(sel[10].receiving).toBe(-0.48);
    expect(setAllocation({}, MID, 0.1 + 0.2)[2].receiving).toBe(0.3);
  });

  test("editing: this receipt's earlier amount counts as open again", () => {
    const saved = { ...MID, recieved: '150', constReceiving: 150, receiving: 150 };
    expect(balanceAfter(saved, true)).toBe(50);
    expect(fullAmount(saved, true)).toBe(200);
  });

  /* The tick on an opened or settled voucher puts what is open plus its own
   * earlier share - not the whole total, which (the server now ADDING the
   * difference) paid over what other receipts had: ACS-JI-1303/26 ticked
   * against an advance showed -8,173.75 (the user's screenshot, 2026-11-06). */
  test("editing: the tick leaves every other receipt's share where it is", () => {
    // 150 received: 50 by this receipt, 100 by another.
    const shared = { ...MID, recieved: '150', constReceiving: 50, receiving: 0 };
    expect(fullAmount(shared, true)).toBe(100);
    expect(balanceAfter({ ...shared, receiving: 100 }, true)).toBe(0);
    // Settling an advance that had nothing on it: what is open, no more.
    expect(fullAmount({ ...MID, recieved: '150', constReceiving: 0 }, true)).toBe(50);
  });

  /* What is settled is read from the invoice's knock-offs - Invoice_Transactions -
   * not its received figure, which an edited receipt used to overwrite (the
   * user, 2026-11-06). ACS-JI-605/27: 718,706.75 received, 959,664.40 knocked off. */
  test('settled is the knock-offs added up; the received figure only when there are none', () => {
    const jI605 = {
      payType: 'Recievable', total: '1376253', recieved: '718706.75', constReceiving: 0, receiving: 0,
      Invoice_Transactions: [{ amount: '718706.75' }, { amount: '193582.65' }, { amount: '47375' }],
    };
    expect(fullAmount(jI605)).toBe(416588.6);
    expect(balanceAfter(jI605)).toBe(416588.6);
    expect(fullAmount({ ...jI605, Invoice_Transactions: [] })).toBe(657546.25);
    expect(fullAmount({ payType: 'Payble', total: '500', paid: '200' })).toBe(300);
  });

  test("the amount boxes put commas in the whole part only", () => {
    expect(groupThousands('-0.4799999999')).toBe('-0.4799999999');
    expect(groupThousands(1234567.891)).toBe('1,234,567.891');
    expect(groupThousands(-1120.5)).toBe('-1,120.5');
    expect(groupThousands('')).toBe('');
    expect(ungroupThousands('1,234,567.891')).toBe('1234567.891');
  });
});

/* An opened voucher's own invoice, paid off - ACS-BRV-00660/25's
 * ACS-JI-1440/25: 881,691, of which this voucher paid 9,187 and others the
 * rest. It stood unticked (the tick read the row as not editing) and ticking
 * it changed nothing (the user's screenshot, 2026-11-06). */
describe("an opened voucher's own invoice, paid off", () => {
  const ji1440 = {
    id: 10137, payType: 'Recievable', total: '881691', recieved: '881691',
    Invoice_Transactions: [{ amount: '872504' }, { amount: '9187' }],
    constReceiving: 9187, receiving: 9187,
  };

  test('shows ticked, as its Balance of 0 says', () => {
    expect(balanceAfter(ji1440, true)).toBe(0);
    expect(isSettledHere(ji1440, true)).toBe(true);
  });

  test('ticking it puts back its own share - unticking gives the share up', () => {
    expect(fullAmount(ji1440, true)).toBe(9187);
    expect(isSettledHere({ ...ji1440, receiving: 0 }, true)).toBe(false);
  });

  test('paid off by others, with nothing on it from this receipt: not ticked', () => {
    expect(isSettledHere({ ...ji1440, constReceiving: 0, receiving: 0 }, true)).toBe(false);
  });
});
