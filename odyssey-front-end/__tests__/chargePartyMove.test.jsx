import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent } from '@testing-library/react'

/* PICKING A PARTY FOR A FREIGHT CHARGE - ChargesComp/PartySearch.
 *
 * On a line whose invoice was un-approved, a new party moves the invoice: it
 * keeps its number and every line on it takes the new party (the server moves
 * the invoice itself on save). Not to a party of another kind - an agent on a
 * Job Invoice would need another document. A line on no invoice just takes
 * the party. */

jest.mock('apis/axiosClient', () => ({ get: jest.fn(() => Promise.resolve({ data: { result: [] } })), post: jest.fn() }))
jest.mock('Components/Shared/Notification', () => jest.fn())
// Confirmed at once: the dialog itself is not what is under test.
jest.mock('Components/Shared/PopConfirm', () => jest.fn((title, body, onOk) => onOk()))

import PartySearch from '../Components/Layouts/JobsLayout/Jobs/ChargesComp/PartySearch'
import PopConfirm from 'Components/Shared/PopConfirm'
import openNotification from 'Components/Shared/Notification'
import axiosClient from 'apis/axiosClient'
import { saveHeads } from '../Components/Layouts/JobsLayout/Jobs/states'

const partyB = { id: 20, code: 'B', name: 'PARTY B', types: 'Client', check: true, Client_Associations: [{ ChildAccountId: 200 }] }
const nonGl = { id: 40, code: 'N', name: 'NON GL PARTY', types: 'Client', check: true, Client_Associations: [] }
const agent = { id: 30, code: 'AG', name: 'OVERSEAS AGENT', types: 'Overseas Agent', check: true }
const onInvoice = (id, extra = {}) => ({
  id, InvoiceId: 5, invoice_id: 'SNS-JI-5/27', partyId: '10', name: 'PARTY A', partyType: 'client', invoiceType: 'Job Invoice', ...extra,
})
const chargeList = [onInvoice(1), onInvoice(2), { id: 3, InvoiceId: null, partyId: '10', name: 'PARTY A', invoiceType: 'Job Invoice' }]

const pick = (party, headIndex) => {
  const reset = jest.fn()
  render(
    <PartySearch
      state={{ clientParties: [party], headIndex, chargesTab: '1' }}
      dispatch={jest.fn()} reset={reset} control={{}} useWatch={() => chargeList}
    />,
  )
  fireEvent.click(screen.getByText(party.name))
  return reset
}

beforeAll(() => {
  // antd's Pagination asks for it; jsdom has none.
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
})

beforeEach(() => jest.clearAllMocks())

test('on an invoice: the whole invoice moves - every line on it - after asking', () => {
  const reset = pick(partyB, 0)
  expect(PopConfirm).toHaveBeenCalledTimes(1)
  expect(PopConfirm.mock.calls[0][0]).toBe('Move SNS-JI-5/27 to PARTY B?')
  expect(PopConfirm.mock.calls[0][1]).toMatch(/keeps its number and moves with all 2 of its lines/)
  const [{ chargeList: saved }] = reset.mock.calls[0]
  expect(saved.map((c) => [c.id, c.partyId, c.name, c.InvoiceId])).toEqual([
    [1, 20, 'PARTY B', 5],
    [2, 20, 'PARTY B', 5],
    // Not on that invoice: left alone.
    [3, '10', 'PARTY A', null],
  ])
})

test('not to a party of another kind - an agent on a Job Invoice', () => {
  const reset = pick(agent, 0)
  expect(reset).not.toHaveBeenCalled()
  expect(PopConfirm).not.toHaveBeenCalled()
  expect(openNotification.mock.calls[0][1]).toMatch(/is a Job Invoice; OVERSEAS AGENT would need an Agent Invoice/)
})

test('on no invoice: just that line takes the party', () => {
  const reset = pick(partyB, 2)
  expect(PopConfirm).not.toHaveBeenCalled()
  const [{ chargeList: saved }] = reset.mock.calls[0]
  expect(saved.map((c) => c.partyId)).toEqual(['10', '10', 20])
})

test('not to a party with no ledger account - said before anything is saved', () => {
  const reset = pick(nonGl, 0)
  expect(reset).not.toHaveBeenCalled()
  expect(PopConfirm).not.toHaveBeenCalled()
  expect(openNotification.mock.calls[0][1]).toMatch(/NON GL PARTY has no ledger account, so SNS-JI-5\/27 cannot move to it/)
})

/* A refused save says why and lets go of the Save button - a 400 used to
   surface as the framework's error page, the charges left "saving". */
test('a refused save shows the reason and releases Save', async () => {
  axiosClient.post.mockRejectedValue({ response: { status: 400, data: { status: 'error', result: 'SNS-JI-5/27 is approved.' } } })
  const dispatch = jest.fn()
  await saveHeads([], { deleteList: [], selectedRecord: { id: 1 }, exRate: '1' }, dispatch, jest.fn())
  expect(openNotification).toHaveBeenCalledWith('Error', 'SNS-JI-5/27 is approved.', 'red', 10)
  expect(dispatch).toHaveBeenCalledWith({ type: 'toggle', fieldName: 'chargeLoad', payload: false })
})
