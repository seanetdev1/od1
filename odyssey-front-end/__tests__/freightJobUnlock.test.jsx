import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/* UNLOCK ON AN APPROVED FREIGHT JOB - BookingInfo, /seaJob/unlock.
 *
 * An approved job's booking info is locked, and once a charge is approved it
 * cannot be un-approved either. A CEO, CFO or admin may unlock it for one
 * save: the button is theirs alone, it asks the server (which records it),
 * and while unlocked the fields are open and a banner says so. */

jest.mock('next/router', () => ({ push: jest.fn() }))
jest.mock('react-redux', () => ({ useSelector: jest.fn(() => []), useDispatch: jest.fn(() => jest.fn()) }))
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn(), removeTab: jest.fn() }))
jest.mock('redux/BlCreation/blCreationSlice', () => ({ addBlCreationId: jest.fn() }))
jest.mock('apis/pickLists', () => ({
  getAllAirports: jest.fn(() => Promise.resolve([])),
  searchPorts: jest.fn(() => Promise.resolve([])), resolvePort: jest.fn(() => Promise.resolve(null)),
  searchDestinations: jest.fn(() => Promise.resolve([])), resolveDestination: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('apis/jobs', () => ({ getChargeHeads: jest.fn(() => Promise.resolve({ charges: [{ status: '1' }] })) }))
jest.mock('apis/axiosClient', () => ({ post: jest.fn() }))
jest.mock('functions/checkEditAccess', () => ({ checkEditAccess: jest.fn(() => false) }))
jest.mock('functions/adminDesignation', () => ({ isAdminDesignation: jest.fn() }))
jest.mock('Components/Shared/Notification', () => jest.fn())
// Confirmed at once: the dialog itself is not what is under test.
jest.mock('Components/Shared/PopConfirm', () => jest.fn((title, body, onOk) => onOk()))

jest.mock('Components/Layouts/JobsLayout/Jobs/CopyFromJobModal', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/WeightComp', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/BLInfo', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/AddPort', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/Notes', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/Carrier', () => () => null)
jest.mock('Components/Shared/Form/SelectComp', () => () => null)
jest.mock('Components/Shared/Form/SelectSearchComp', () => () => null)
jest.mock('Components/Shared/Form/SelectSearchRemote', () => () => null)
jest.mock('Components/Shared/Form/CheckGroupComp', () => () => null)
jest.mock('Components/Shared/Form/DateComp', () => () => null)
jest.mock('Components/Shared/Form/TimeComp', () => () => null)
jest.mock('Components/Shared/Form/CustomBoxSelect', () => () => null)
// A real input, so whether the field is disabled can be seen.
jest.mock('Components/Shared/Form/InputComp', () => (p) => <input aria-label={p.name} disabled={Boolean(p.disabled)} readOnly />)

import BookingInfo from '../Components/Layouts/JobsLayout/Jobs/BookingInfo'
import axiosClient from 'apis/axiosClient'
import { isAdminDesignation } from 'functions/adminDesignation'

const state = (over = {}) => ({
  edit: true, voyageVisible: false, isModalOpen: false, InvoiceList: [], equipments: [], voyageList: [],
  selectedRecord: { id: 7, jobNo: 'SNS-SEJ-7/27', shippingLineId: 1, Bl: null },
  fields: {
    party: { shipper: [], consignee: [], notify: [], client: [] },
    vendor: { transporter: [], forwarder: [], overseasAgent: [], chaChb: [], airLine: [], sLine: [], localVendor: [] },
    commodity: [], vessel: [], sr: [],
  },
  ...over,
})

const watching = (approved) => ({ name } = {}) => {
  if (!name) return { freightType: 'Prepaid', approved }
  return { approved, canceled: false, transportCheck: [], customCheck: [] }[name] ?? ''
}

const show = ({ approved = ['1'], over = {}, dispatch = jest.fn() } = {}) => render(
  <BookingInfo handleSubmit={(fn) => fn} setValue={jest.fn()} onEdit={jest.fn()} companyId='1'
    register={jest.fn(() => ({}))} control={{}} errors={{}} state={state(over)} useWatch={watching(approved)}
    dispatch={dispatch} reset={jest.fn()} id='7' type='SE' />,
)

beforeEach(() => {
  jest.clearAllMocks()
})

test('an admin sees Unlock on an approved job; nobody else does', () => {
  isAdminDesignation.mockReturnValue(true)
  const { unmount } = show()
  expect(screen.getByText('Unlock')).toBeInTheDocument()
  unmount()

  isAdminDesignation.mockReturnValue(false)
  show()
  expect(screen.queryByText('Unlock')).toBeNull()
})

test('a job that is not approved has nothing to unlock', () => {
  isAdminDesignation.mockReturnValue(true)
  show({ approved: [] })
  expect(screen.queryByText('Unlock')).toBeNull()
})

test('Unlock asks the server, then opens the job', async () => {
  isAdminDesignation.mockReturnValue(true)
  axiosClient.post.mockResolvedValue({ data: { status: 'success', result: { id: 7, jobNo: 'SNS-SEJ-7/27' } } })
  const dispatch = jest.fn()
  show({ dispatch })
  fireEvent.click(screen.getByText('Unlock'))
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: 'set', payload: { unlocked: true } }))
  expect(axiosClient.post.mock.calls[0][0]).toMatch(/\/seaJob\/unlock$/)
  expect(axiosClient.post.mock.calls[0][1]).toMatchObject({ id: 7 })
})

test('a refused unlock leaves the job locked', async () => {
  isAdminDesignation.mockReturnValue(true)
  axiosClient.post.mockResolvedValue({ data: { status: 'error', result: 'nope' } })
  const dispatch = jest.fn()
  show({ dispatch })
  fireEvent.click(screen.getByText('Unlock'))
  await waitFor(() => expect(axiosClient.post).toHaveBeenCalled())
  expect(dispatch).not.toHaveBeenCalledWith({ type: 'set', payload: { unlocked: true } })
})

test('approved: the fields are locked; unlocked: they open, and a banner says so', () => {
  isAdminDesignation.mockReturnValue(true)
  const { unmount } = show()
  expect(screen.getByLabelText('customerRef')).toBeDisabled()
  expect(screen.queryByText(/This approved job is open for one save/)).toBeNull()
  unmount()

  show({ over: { unlocked: true } })
  expect(screen.getByLabelText('customerRef')).not.toBeDisabled()
  expect(screen.getByText(/This approved job is open for one save/)).toBeInTheDocument()
  // Still approved - unlocking changes neither the stamp nor the button.
  expect(screen.queryByText('Unlock')).toBeNull()
})
