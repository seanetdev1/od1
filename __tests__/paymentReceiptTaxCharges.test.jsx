/**
 * Tax and bank charges on a payment / receipt - the journal Make Transaction
 * builds (Components/Layouts/AccountsComp/PaymentsReceipt/BillComp), and who
 * pays each (functions/paymentReceiptCosts). The party is settled in full.
 *
 *   paid by US      the tax / charges account is debited and the bank carries
 *                   it: a receipt lands that much less, a payment takes that
 *                   much more out (2026-10-21). An ADVANCE payment used to do
 *                   the opposite.
 *   paid by the     not through our bank: the bank moves the settled amount,
 *   PARTY           and the party and the selected account take it between
 *                   them (the user's correction, 2026-10-22):
 *                     payment  Party Dr / account Cr
 *                     receipt  Party Cr / account Dr
 */
import React, { useReducer } from 'react';
import { render, act, screen, fireEvent } from '@testing-library/react';
import reducer from '../redux/paymentReciept/paymentRecieptSlice';
import { paidByFromHeads, bankCarries } from '../functions/paymentReceiptCosts';

const mockGet = jest.fn(() => Promise.resolve({ data: { result: [] } }));
jest.mock('apis/axiosClient', () => ({ get: (...a) => mockGet(...a), post: jest.fn() }));
jest.mock('Components/Shared/Notification', () => jest.fn());
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-redux', () => ({ useSelector: (fn) => fn({ fiscalYear: { value: 1 } }), useDispatch: () => jest.fn() }));
jest.mock('js-cookie', () => ({ get: () => '1' }));

// eslint-disable-next-line import/first
import BillComp from '../Components/Layouts/AccountsComp/PaymentsReceipt/BillComp';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }));
});

const PARTY = 3; const BANK = 5; const TAX = 7; const CHARGES = 8;

let store;
const actionRef = { current: null };
const Harness = ({ init }) => {
  const [state, dispatch] = useReducer(reducer, init);
  store = { state, dispatch };
  return <BillComp back={() => {}} companyId={1} state={state} dispatch={dispatch} actionRef={actionRef} />;
};

const open = (over) => render(<Harness init={{
  ...reducer(undefined, { type: 'init' }),
  transactionMode: 'Cash', currency: 'PKR', exRate: 1,
  selectedAccount: PARTY, receivingAccount: BANK,
  taxAmount: 4500, taxAccount: TAX, bankChargesAmount: 200, bankChargesAccount: CHARGES,
  ...over,
}} />);

/* The journal by role, each [debit, credit]:
 *   party / bank    the settlement and the bank line
 *   tax / charges   the account's line
 *   partyTax / partyCharges   the party's line for them, when it pays them */
const journal = (over) => {
  open(over);
  act(() => { actionRef.current(); });
  const lines = store.state.transactions.filter((x) => x.accountName !== 'Total');
  const pair = (x) => (x ? [x.debit, x.credit] : undefined);
  const costs = (re) => lines.filter((x) => re.test(x.accountType));
  const on = (list, id) => pair(list.find((x) => x.partyId === id));
  const total = store.state.transactions.find((x) => x.accountName === 'Total');
  const tax = costs(/Tax Account/);
  const charges = costs(/Charges Account/);
  return {
    party: pair(lines.find((x) => x.accountType === 'partyAccount')),
    bank: pair(lines.find((x) => x.accountType === 'payAccount')),
    tax: on(tax, TAX),
    partyTax: on(tax, PARTY),
    charges: on(charges, CHARGES),
    partyCharges: on(charges, PARTY),
    balanced: total.debit === total.credit,
  };
};

const payable = { id: 1, party_Id: PARTY, payType: 'Payble', total: '100000', paid: '0', recieved: '0', currency: 'PKR', ex_rate: '1', createdAt: '2026-09-01' };
const receivable = { ...payable, id: 2, payType: 'Recievable' };
// The party's list loaded, so opening it does not start a fresh selection.
const paying = (invoice) => ({
  invoices: [invoice],
  selectedInvoices: { [invoice.id]: { ...invoice, receiving: 100000, picked: true } },
});

const CASES = {
  'an advance payment': { advance: true, payType: 'Payble', totalReceivable: 100000 },
  'an advance receipt': { advance: true, payType: 'Recievable', totalReceivable: 100000 },
  'a payment against invoices': { payType: 'Payble', ...paying(payable) },
  'a receipt against invoices': { payType: 'Recievable', ...paying(receivable) },
};
const isReceipt = (name) => name.includes('receipt');

describe('both paid by us - the default', () => {
  test.each(Object.keys(CASES))('%s: both debited, the bank carries them', (name) => {
    const j = journal(CASES[name]);
    expect(j.bank).toEqual(isReceipt(name) ? [95300, 0] : [0, 104700]);
    expect(j.tax).toEqual([4500, 0]);
    expect(j.charges).toEqual([200, 0]);
    expect(j.partyTax).toBeUndefined();
    expect(j.partyCharges).toBeUndefined();
    expect(j.balanced).toBe(true);
  });
});

describe('the PARTY pays the tax', () => {
  test.each(Object.keys(CASES))('%s: party against the tax account, not through the bank', (name) => {
    const j = journal({ ...CASES[name], taxBy: 'party' });
    expect(j.party).toEqual(isReceipt(name) ? [0, 100000] : [100000, 0]);
    // Only our bank charges move the bank now.
    expect(j.bank).toEqual(isReceipt(name) ? [99800, 0] : [0, 100200]);
    expect(j.partyTax).toEqual(isReceipt(name) ? [0, 4500] : [4500, 0]);
    expect(j.tax).toEqual(isReceipt(name) ? [4500, 0] : [0, 4500]);
    expect(j.balanced).toBe(true);
  });
});

describe('the PARTY pays the bank charges', () => {
  test.each(Object.keys(CASES))('%s: party against the charges account, not through the bank', (name) => {
    const j = journal({ ...CASES[name], bankChargesBy: 'party' });
    expect(j.bank).toEqual(isReceipt(name) ? [95500, 0] : [0, 104500]);
    expect(j.partyCharges).toEqual(isReceipt(name) ? [0, 200] : [200, 0]);
    expect(j.charges).toEqual(isReceipt(name) ? [200, 0] : [0, 200]);
    expect(j.balanced).toBe(true);
  });

  test('the user\'s example: a payment of 300,000 with 1,500 tax and 500 charges, both the party\'s', () => {
    const j = journal({
      advance: true, payType: 'Payble', totalReceivable: 300000,
      taxAmount: 1500, bankChargesAmount: 500, taxBy: 'party', bankChargesBy: 'party',
    });
    expect(j).toEqual({
      party: [300000, 0],
      bank: [0, 300000],
      partyTax: [1500, 0],
      tax: [0, 1500],
      partyCharges: [500, 0],
      charges: [0, 500],
      balanced: true,
    });
  });
});

describe('the toggles', () => {
  test('both start on Us', () => {
    open({});
    expect(store.state.taxBy).toBe('us');
    expect(store.state.bankChargesBy).toBe('us');
  });

  test('Party keeps the account - the party\'s share goes to it', () => {
    open({});
    // The bank charges toggle comes first on the form, then the tax's.
    fireEvent.click(screen.getAllByText('Party')[0]);
    fireEvent.click(screen.getAllByText('Party')[1]);
    expect(store.state).toMatchObject({ bankChargesBy: 'party', taxBy: 'party', bankChargesAccount: CHARGES, taxAccount: TAX });
    expect(screen.getAllByText('Charged to the party - not through our bank.')).toHaveLength(2);
  });
});

describe('reading a saved voucher back', () => {
  const heads = (...extra) => [
    { accountType: 'partyAccount', ChildAccountId: 901, amount: '300000' },
    { accountType: 'payAccount', ChildAccountId: 902, amount: '300000' },
    ...extra,
  ];
  test('a tax or charges line on the party\'s own account: the party paid; the account is the other line', () => {
    const res = paidByFromHeads(heads(
      { accountType: 'Tax Account', ChildAccountId: 901, amount: '1500' },
      { accountType: 'Tax Account', ChildAccountId: 950, amount: '1500' },
      { accountType: 'Adjust Charges Account', ChildAccountId: 901, amount: '500' },
      { accountType: 'Adjust Charges Account', ChildAccountId: 960, amount: '500' },
    ));
    expect(res).toMatchObject({ taxBy: 'party', bankChargesBy: 'party' });
    expect([res.taxHead.ChildAccountId, res.chargesHead.ChildAccountId]).toEqual([950, 960]);
  });
  test('only on the account: ours; none at all: ours, with nothing to read', () => {
    const ours = paidByFromHeads(heads({ accountType: 'Tax Account', ChildAccountId: 950, amount: '1500' }));
    expect(ours).toMatchObject({ taxBy: 'us', bankChargesBy: 'us', chargesHead: null });
    expect(ours.taxHead.ChildAccountId).toBe(950);
    expect(paidByFromHeads(heads())).toMatchObject({ taxBy: 'us', taxHead: null });
  });
});

test('what the bank carries is only what we pay', () => {
  expect(bankCarries({ taxAmount: 4500, bankChargesAmount: 200 })).toBe(4700);
  expect(bankCarries({ taxAmount: 4500, bankChargesAmount: 200, bankChargesBy: 'party' })).toBe(4500);
  expect(bankCarries({ taxAmount: 4500, bankChargesAmount: 200, taxBy: 'party' })).toBe(200);
  expect(bankCarries({ taxAmount: 4500, bankChargesAmount: 200, taxBy: 'party', bankChargesBy: 'party' })).toBe(0);
});

/* The party's own lines are MARKED (onParty) - the server posts them to the
 * party's account by that, not by an id a bank account can share with the
 * party (functions/paymentLines there; v1.2.88's tag run). */
test("the party's lines are marked onParty, every account's line is not", () => {
  open({ ...CASES[Object.keys(CASES)[0]], taxBy: 'party', bankChargesBy: 'party' });
  act(() => { actionRef.current(); });
  const lines = store.state.transactions.filter((x) => x.accountName !== 'Total');
  const marked = lines.filter((x) => x.onParty === true);
  expect(marked.length).toBeGreaterThanOrEqual(3);
  marked.forEach((x) => expect(x.partyId).toBe(PARTY));
  lines.filter((x) => x.onParty !== true).forEach((x) => expect([BANK, TAX, CHARGES]).toContain(x.partyId));
});
