import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// Booking Info was deliberately changed so that clicking a party label
// (Client, Shipper, Consignee, Forwarder, etc.) does NOT navigate anywhere -
// only the Vessel/Voyage label (owned by Carrier.js, wired through the
// pageLinking prop) should still navigate. These tests exercise the real
// `pageLinking` closure and the real `PartyLabel` markup from BookingInfo.js,
// and the real "Vessel *" label from the (unmocked) Carrier.js.

jest.mock('next/router', () => ({ push: jest.fn() }))

jest.mock('react-redux', () => ({
  useSelector: jest.fn(() => []),
  useDispatch: jest.fn(() => jest.fn()),
}))

jest.mock('redux/tabs/tabSlice', () => ({
  incrementTab: jest.fn((payload) => ({ type: 'tabs/incrementTab', payload })),
  removeTab: jest.fn((payload) => ({ type: 'tabs/removeTab', payload })),
}))

jest.mock('redux/BlCreation/blCreationSlice', () => ({
  addBlCreationId: jest.fn((payload) => ({ type: 'bl/addBlCreationId', payload })),
}))

// Ports and Destinations are no longer fetched whole (157k / 140k rows); the
// job screen searches them on the server as the user types, so the mock has to
// cover the search/resolve pair as well as the remaining full fetch.
jest.mock('apis/pickLists', () => ({
  getAllPorts: jest.fn(() => Promise.resolve([])),
  getAllDestinations: jest.fn(() => Promise.resolve([])),
  getAllAirports: jest.fn(() => Promise.resolve([])),
  searchPorts: jest.fn(() => Promise.resolve([])),
  resolvePort: jest.fn(() => Promise.resolve(null)),
  searchDestinations: jest.fn(() => Promise.resolve([])),
  resolveDestination: jest.fn(() => Promise.resolve(null)),
}))

jest.mock('apis/jobs', () => ({
  getChargeHeads: jest.fn(() => Promise.resolve({ charges: [] })),
}))

jest.mock('functions/checkEditAccess', () => ({ checkEditAccess: jest.fn(() => false) }))

jest.mock('Components/Shared/Notification', () => jest.fn())

// Heavy/irrelevant sub-components - stub to plain no-render components so the
// tree mounts without needing a real react-hook-form context.
jest.mock('Components/Layouts/JobsLayout/Jobs/CopyFromJobModal', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/WeightComp', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/BLInfo', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/AddPort', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/Notes', () => () => null)

// Renders nothing; keeps the options each select was given, by field name.
const mockSelectOptions = {}
jest.mock('Components/Shared/Form/SelectComp', () => (props) => { mockSelectOptions[props.name] = props.options; return null })
jest.mock('Components/Shared/Form/SelectSearchComp', () => () => null)
jest.mock('Components/Shared/Form/SelectSearchRemote', () => () => null)
jest.mock('Components/Shared/Form/CheckGroupComp', () => () => null)
jest.mock('Components/Shared/Form/DateComp', () => () => null)
jest.mock('Components/Shared/Form/TimeComp', () => () => null)
jest.mock('Components/Shared/Form/InputComp', () => () => null)
jest.mock('Components/Shared/Form/CustomBoxSelect', () => () => null)

// NOTE: Carrier.js (and its ./Dates import) are intentionally NOT mocked -
// it owns the real "Vessel *" label wired to the pageLinking prop, which is
// what this test needs to exercise for comparison against the party labels.

const Router = require('next/router')

import BookingInfo from '../Components/Layouts/JobsLayout/Jobs/BookingInfo'

const noop = () => {}

const buildState = () => ({
  edit: true,
  voyageVisible: false,
  isModalOpen: false,
  InvoiceList: [],
  equipments: [],
  voyageList: [],
  selectedRecord: { id: 1, jobNo: 'SE-1', shippingLineId: 1, Bl: null },
  fields: {
    party: { shipper: [], consignee: [], notify: [], client: [] },
    vendor: { transporter: [], forwarder: [], overseasAgent: [], chaChb: [], airLine: [], sLine: [], localVendor: [] },
    commodity: [],
    vessel: [],
    sr: [],
  },
})

const watchMap = {
  transportCheck: [],
  transporterId: '',
  customCheck: [],
  customAgentId: '',
  vesselId: '',
  VoyageId: '',
  ClientId: '',
  shipperId: '',
  consigneeId: '',
  overseasAgentId: '',
  airLineId: '',
  forwarderId: '',
  shippingLineId: '',
  localVendorId: '',
  approved: [],
  canceled: false,
}

const useWatchStub = ({ name } = {}) => {
  if (!name) return { freightType: 'Prepaid', approved: [] }
  return watchMap[name]
}

const renderBookingInfo = (overrides = {}) => {
  const props = {
    handleSubmit: (fn) => fn,
    setValue: jest.fn(),
    onEdit: jest.fn(),
    companyId: '1',
    register: jest.fn(() => ({})),
    control: {},
    errors: {},
    state: buildState(),
    useWatch: useWatchStub,
    dispatch: jest.fn(),
    reset: jest.fn(),
    id: 'new',
    type: 'SE',
    ...overrides,
  }
  return render(<BookingInfo {...props} />)
}

describe('BookingInfo party labels are not clickable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('clicking the Client party label does not call Router.push', async () => {
    renderBookingInfo()
    const label = await screen.findByText('Client *')
    fireEvent.click(label)
    expect(Router.push).not.toHaveBeenCalled()
  })

  test('clicking the Consignee party label does not call Router.push', async () => {
    renderBookingInfo()
    const label = await screen.findByText('Consignee *')
    fireEvent.click(label)
    expect(Router.push).not.toHaveBeenCalled()
  })

  test('clicking the Forwarder/Coloader party label does not call Router.push', async () => {
    renderBookingInfo()
    const label = await screen.findByText('Forwarder/Coloader *')
    fireEvent.click(label)
    expect(Router.push).not.toHaveBeenCalled()
  })

  test('party label renders as plain (non-link) markup with no onClick wiring', async () => {
    renderBookingInfo()
    const label = await screen.findByText('Client *')
    // PartyLabel is a bare <div>; it must not carry the "custom-link" class
    // used elsewhere for genuinely clickable labels (e.g. Vessel).
    expect(label.className).not.toMatch('custom-link')
  })

  test('the Vessel label (owned by Carrier.js) still navigates via Router.push', async () => {
    renderBookingInfo()
    const vesselLabel = await screen.findByText('Vessel *')
    fireEvent.click(vesselLabel)
    await waitFor(() => expect(Router.push).toHaveBeenCalledWith('/setup/voyage/'))
  })
})

/* "The unapprove button on the job screen appears for a split second when the
 * page loads" (the user, 2026-11-02): it showed until the charges had loaded,
 * then went if any were approved. It waits for them now. */
describe('UnApprove waits for the charges', () => {
  const { getChargeHeads } = require('apis/jobs')
  const approvedJob = ({ name } = {}) => {
    if (!name) return { freightType: 'Prepaid', approved: ['1'] }
    return name === 'approved' ? ['1'] : watchMap[name]
  }

  test('approved charges: never shown, not even while they load', async () => {
    let finish
    getChargeHeads.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    renderBookingInfo({ useWatch: approvedJob })
    await screen.findByText('Client *')
    expect(screen.queryByText('UnApprove')).toBeNull()
    await act(async () => { finish({ charges: [{ status: '1' }] }) })
    expect(screen.queryByText('UnApprove')).toBeNull()
  })

  test('no approved charges: shown once they have loaded', async () => {
    getChargeHeads.mockImplementationOnce(() => Promise.resolve({ charges: [{ status: '0' }] }))
    renderBookingInfo({ useWatch: approvedJob })
    expect(await screen.findByText('UnApprove')).toBeTruthy()
  })

  test('an unapproved job offers Approve straight away', async () => {
    getChargeHeads.mockImplementationOnce(() => new Promise(() => {}))
    renderBookingInfo()
    expect(await screen.findByText('Approve')).toBeTruthy()
  })
})

/* Still a flash after that (the user, 2026-11-02): the page's first frame is
 * the blank form, the job's values a moment later - and in that frame an
 * approved job read as unapproved, so the button showed as Approve. It waits
 * until the form holds this job (its id). */
describe('the Approve / UnApprove button waits for the job', () => {
  const { getChargeHeads } = require('apis/jobs')
  const formWith = (values) => ({ name } = {}) => {
    if (!name) return { freightType: 'Prepaid', ...values }
    return name in values ? values[name] : watchMap[name]
  }

  test('not in the first frame, before the job is in the form', async () => {
    getChargeHeads.mockImplementationOnce(() => Promise.resolve({ charges: [] }))
    renderBookingInfo({ id: 1, useWatch: formWith({ id: '', approved: [] }) })
    await screen.findByText('Client *')
    await act(async () => {})
    expect(screen.queryByText('Approve')).toBeNull()
    expect(screen.queryByText('UnApprove')).toBeNull()
  })

  test('once the form holds the job: UnApprove for an approved one with no approved charges', async () => {
    getChargeHeads.mockImplementationOnce(() => Promise.resolve({ charges: [] }))
    renderBookingInfo({ id: 1, useWatch: formWith({ id: 1, approved: ['1'] }) })
    expect(await screen.findByText('UnApprove')).toBeTruthy()
  })

  test('and Approve for an unapproved one', async () => {
    renderBookingInfo({ id: 1, useWatch: formWith({ id: 1, approved: [] }) })
    expect(await screen.findByText('Approve')).toBeTruthy()
  })
})

/* "FCP" stood where FCA belongs: FCA (Free Carrier) could not be picked, and
 * the jobs migrated from Climax with it showed a code the list lacked (the
 * user, 2026-11-04). */
describe('Inco Terms', () => {
  test('offers FCA, and not the FCP that is no Incoterm', async () => {
    renderBookingInfo()
    await screen.findByText('Client *')
    const codes = mockSelectOptions.incoTerms.map((o) => o.id)
    expect(codes).toContain('FCA')
    expect(codes).not.toContain('FCP')
  })

  test('every code Climax has on jobs can be shown', async () => {
    renderBookingInfo()
    await screen.findByText('Client *')
    const codes = mockSelectOptions.incoTerms.map((o) => o.id)
    for (const c of ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CIP', 'CPT', 'DAP', 'DPU', 'DDP', 'DAT', 'DDU', 'CNF']) {
      expect(codes).toContain(c)
    }
  })
})
