import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, within } from '@testing-library/react'

jest.mock('apis/axiosClient', () => ({ get: jest.fn(), post: jest.fn() }))
jest.mock('js-cookie', () => ({ get: jest.fn(() => 'tester') }))

import Charges from '../Components/Layouts/Setup/Charges'

// The charge master is ~400 rows and arrives whole from getServerSideProps, so
// the list pages client-side. The things that break on a paged list are the
// ones that are invisible until real data fills more than one page: the page
// slice, and the page you are standing on when the row count shrinks under you.

// jsdom implements no media queries, and antd's Row/Col ask for them on mount.
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
})

const PAGE_SIZE = 50

const chargeData = (n) => ({
  result: Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    code: i + 1,
    name: `CHARGE ${i + 1}`,
    short: `C${i + 1}`,
    currency: i === 0 ? 'EUR' : 'USD',
    calculationType: 'Per Shipment',
    defaultPaybleParty: 'Local-Agent',
    defaultRecivableParty: 'Client',
    status: true,
  })),
})

const bodyRows = () => {
  const table = document.querySelector('table')
  return within(table).getAllByRole('row').slice(1)   // drop the header row
}

const searchBox = () => document.querySelector('input.ant-input')

describe('Charges list pagination', () => {
  test('renders only the first page, not the whole charge master', () => {
    render(<Charges chargeData={chargeData(120)} />)

    expect(bodyRows()).toHaveLength(PAGE_SIZE)
    expect(screen.getByText('CHARGE 1')).toBeInTheDocument()
    expect(screen.queryByText(`CHARGE ${PAGE_SIZE + 1}`)).not.toBeInTheDocument()
  })

  test('shows the range and total across the whole filtered list', () => {
    render(<Charges chargeData={chargeData(120)} />)
    expect(screen.getByText('Showing 1-50 of 120')).toBeInTheDocument()
  })

  test('paging forward shows the next slice', () => {
    render(<Charges chargeData={chargeData(120)} />)

    fireEvent.click(screen.getByTitle('2'))

    expect(screen.getByText(`CHARGE ${PAGE_SIZE + 1}`)).toBeInTheDocument()
    expect(screen.queryByText('CHARGE 1')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 51-100 of 120')).toBeInTheDocument()
  })

  test('the last page holds the remainder, not a full page', () => {
    render(<Charges chargeData={chargeData(120)} />)

    fireEvent.click(screen.getByTitle('3'))

    expect(bodyRows()).toHaveLength(20)
    expect(screen.getByText('CHARGE 120')).toBeInTheDocument()
  })

  test('searching filters the whole catalogue, not just the visible page', () => {
    // The match is on the last page, so a filter applied to the page slice
    // instead of the full list would find nothing.
    render(<Charges chargeData={chargeData(120)} />)

    fireEvent.change(searchBox(), { target: { value: 'charge 118' } })

    expect(screen.getByText('CHARGE 118')).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(1)
  })

  test('searching from a later page does not leave you on an empty page', () => {
    // The classic paged-list bug: stand on page 3, search down to one result,
    // and the table renders nothing because page 3 of 1 page is empty.
    render(<Charges chargeData={chargeData(120)} />)

    fireEvent.click(screen.getByTitle('3'))
    fireEvent.change(searchBox(), { target: { value: 'EUR' } })

    expect(bodyRows()).toHaveLength(1)
    expect(screen.getByText('CHARGE 1')).toBeInTheDocument()
    expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument()
  })

  test('clearing the search returns to a full first page', () => {
    render(<Charges chargeData={chargeData(120)} />)

    fireEvent.change(searchBox(), { target: { value: 'EUR' } })
    fireEvent.change(searchBox(), { target: { value: '' } })

    expect(bodyRows()).toHaveLength(PAGE_SIZE)
    expect(screen.getByText('Showing 1-50 of 120')).toBeInTheDocument()
  })

  test('a catalogue that fits on one page renders no extra pages', () => {
    render(<Charges chargeData={chargeData(12)} />)

    expect(bodyRows()).toHaveLength(12)
    expect(screen.queryByTitle('2')).not.toBeInTheDocument()
  })

  test('an empty charge master does not crash the page', () => {
    render(<Charges chargeData={{ result: [] }} />)

    expect(bodyRows()).toHaveLength(0)
    // The page is there - its title is on the toolbar now (PageActions), so
    // its search box is what is looked for.
    expect(screen.getByPlaceholderText('search')).toBeInTheDocument()
  })
})
