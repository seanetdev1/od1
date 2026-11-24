import React from 'react'
import '@testing-library/jest-dom'
import { render, fireEvent, act } from '@testing-library/react'
import { useForm } from 'react-hook-form'

/* A PARTY'S SALES REP ON A JOB, AND ITS CREDIT LIMITS (the user's request,
 * 2026-10-23).
 *
 *  - Picking a client on a freight job picks the sales rep set on the party
 *    (functions/partySalesRep) - on the user's pick only.
 *  - Credit Limit (Days) and Credit Limit (Amount) on the party form, and in
 *    its edit history. */

jest.mock('next/router', () => ({ push: jest.fn() }))
jest.mock('react-redux', () => ({ useSelector: jest.fn(() => []), useDispatch: jest.fn(() => jest.fn()) }))
jest.mock('redux/tabs/tabSlice', () => ({ incrementTab: jest.fn(), removeTab: jest.fn() }))
jest.mock('redux/BlCreation/blCreationSlice', () => ({ addBlCreationId: jest.fn() }))
jest.mock('apis/pickLists', () => ({
  getAllAirports: jest.fn(() => Promise.resolve([])),
  searchPorts: jest.fn(() => Promise.resolve([])), resolvePort: jest.fn(() => Promise.resolve(null)),
  searchDestinations: jest.fn(() => Promise.resolve([])), resolveDestination: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('apis/jobs', () => ({ getChargeHeads: jest.fn(() => Promise.resolve({ charges: [] })) }))
jest.mock('functions/checkEditAccess', () => ({ checkEditAccess: jest.fn(() => false) }))
jest.mock('Components/Shared/Notification', () => jest.fn())
jest.mock('Components/Layouts/JobsLayout/Jobs/CopyFromJobModal', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/WeightComp', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/BLInfo', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/AddPort', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/Notes', () => () => null)
jest.mock('Components/Layouts/JobsLayout/Jobs/Carrier', () => () => null)
jest.mock('Components/Shared/Form/SelectComp', () => () => null)
jest.mock('Components/Shared/Form/SelectSearchRemote', () => () => null)
jest.mock('Components/Shared/Form/CheckGroupComp', () => () => null)
jest.mock('Components/Shared/Form/DateComp', () => () => null)
jest.mock('Components/Shared/Form/TimeComp', () => () => null)
jest.mock('Components/Shared/Form/InputComp', () => () => null)
jest.mock('Components/Shared/Form/CustomBoxSelect', () => () => null)
// The job's boxes, by name, so a test can make the pick the user would.
const boxes = {}
jest.mock('Components/Shared/Form/SelectSearchComp', () => (props) => { boxes[props.name] = props; return null })

import { repAfterClientPick } from 'functions/partySalesRep'
import BookingInfo from 'Components/Layouts/JobsLayout/Jobs/BookingInfo'
import { createHistory } from 'Components/Layouts/Setup/Client/historyCreation'

const SelectSearchComp = jest.requireActual('Components/Shared/Form/SelectSearchComp').default

const reps = [{ id: 7, name: 'SARA' }, { id: 8, name: 'ALI' }]
const clients = [
  { id: 1, name: 'ACME (101)', salesRepresentatorId: 7 },
  { id: 2, name: 'GLOBEX (102)', salesRepresentatorId: 8 },
  { id: 3, name: 'INITECH (103)', salesRepresentatorId: null },
  { id: 4, name: 'UMBRELLA (104)', salesRepresentatorId: 99 }, // no longer a sales rep
]

describe('the sales rep a picked client brings', () => {
  const pick = (previousClientId, clientId, currentRep) => repAfterClientPick({ clients, reps, previousClientId, clientId, currentRep })

  test("the party's own rep, over whoever was in the box", () => {
    expect(pick('', 1, '')).toBe(7)
    expect(pick(1, 2, 7)).toBe(8)
    expect(pick(3, 2, 7)).toBe(8)
  })

  test('a client with no rep takes away the rep the last client brought', () => {
    expect(pick(1, 3, 7)).toBe('')
    expect(pick(1, undefined, 7)).toBe('') // the client box cleared
  })

  test('but leaves a rep the user chose for themselves', () => {
    expect(pick(1, 3, 8)).toBe(8)
    expect(pick('', 3, 8)).toBe(8)
  })

  test('a rep who is no longer a sales rep is not picked', () => {
    expect(pick('', 4, '')).toBe('')
    expect(pick(1, 4, 7)).toBe('')
  })
})

describe('the job form', () => {
  const renderJob = ({ ClientId = '', salesRepresentatorId = '' } = {}) => {
    const setValue = jest.fn()
    const useWatch = ({ name } = {}) => {
      if (!name) return { freightType: 'Prepaid', approved: [], ClientId, salesRepresentatorId }
      return { ClientId, approved: [] }[name] ?? ''
    }
    render(<BookingInfo handleSubmit={(fn) => fn} setValue={setValue} onEdit={jest.fn()} companyId='1'
      register={jest.fn(() => ({}))} control={{}} errors={{}} useWatch={useWatch} dispatch={jest.fn()} reset={jest.fn()}
      id='new' type='SE'
      state={{
        edit: false, selectedRecord: { id: 1, Bl: null },
        fields: { party: { shipper: [], consignee: [], notify: [], client: clients }, vendor: { forwarder: [], overseasAgent: [], localVendor: [], airLine: [], sLine: [] }, sr: reps },
      }} />)
    return setValue
  }

  test("picking the client fills in the party's sales rep", () => {
    const setValue = renderJob()
    act(() => { boxes.ClientId.onPicked(2) })
    expect(setValue).toHaveBeenCalledWith('salesRepresentatorId', 8, { shouldDirty: true })
  })

  test('changing to a client with no rep empties the rep the last one brought', () => {
    const setValue = renderJob({ ClientId: 1, salesRepresentatorId: 7 })
    act(() => { boxes.ClientId.onPicked(3) })
    expect(setValue).toHaveBeenCalledWith('salesRepresentatorId', '', { shouldDirty: true })
  })

  test('and touches nothing when the rep would not change', () => {
    const setValue = renderJob({ ClientId: 3, salesRepresentatorId: 8 })
    act(() => { boxes.ClientId.onPicked(3) })
    expect(setValue).not.toHaveBeenCalledWith('salesRepresentatorId', expect.anything(), expect.anything())
  })
})

describe("the picker's onPicked", () => {
  const Harness = ({ onPicked }) => {
    const { control, reset } = useForm({ defaultValues: { ClientId: '' } })
    return (
      <>
        <SelectSearchComp control={control} name='ClientId' label='Client' options={clients} onPicked={onPicked} />
        <button type='button' onClick={() => reset({ ClientId: 2 })}>load</button>
      </>
    )
  }

  test('is told of what the user picks, and not of a value the form was loaded with', async () => {
    const onPicked = jest.fn()
    const { container, getByText } = render(<Harness onPicked={onPicked} />)

    await act(async () => { fireEvent.click(getByText('load')) })
    expect(onPicked).not.toHaveBeenCalled()

    await act(async () => { fireEvent.mouseDown(container.querySelector('.ant-select-selector')) })
    const option = [...document.querySelectorAll('.ant-select-item-option')].find((o) => o.textContent === 'ACME (101)')
    await act(async () => { fireEvent.click(option) })
    expect(onPicked).toHaveBeenCalledTimes(1)
    expect(onPicked.mock.calls[0][0]).toBe(1)
  })
})

describe("the party's edit history", () => {
  const representatives = [{ records: [] }, { records: [] }, { records: [] }]
  const history = (before, after) => createHistory(representatives, { types: [], operations: [], companies: [], ...before }, { types: [], operations: [], companies: [], ...after }, [])

  test('records a changed credit limit', () => {
    const html = history({ creditLimitDays: 30, creditLimitAmount: '250000.00' }, { creditLimitDays: 45, creditLimitAmount: 300000 })
    expect(html).toContain('Credit Limit (Days)')
    expect(html).toContain('Credit Limit (Amount)')
  })

  test('not one that only came back from the server spelled differently', () => {
    expect(history({ creditLimitDays: null, creditLimitAmount: '250000.00' }, { creditLimitDays: '', creditLimitAmount: 250000 })).toBe('')
  })

  test('and 0 is a change from none set', () => {
    expect(history({ creditLimitDays: null }, { creditLimitDays: 0 })).toContain('Credit Limit (Days)')
  })
})
