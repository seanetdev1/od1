import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import moment from 'moment'
import AuditStamp, { AuditTip } from 'Components/Shared/AuditStamp'
import { auditStamps, personOf, stampText } from 'functions/auditStamp'

/* WHO MADE A RECORD, AND WHO LAST CHANGED IT - functions/auditStamp and
 * Components/Shared/AuditStamp, on jobs, vouchers, invoices and charge lines.
 * The server stamps createdBy / createdOn / editedBy / editedOn; these show
 * them, with a fallback creator for a record saved before the stamps. */

const at = (s) => moment(s, 'YYYY-MM-DD HH:mm').toISOString()

describe('auditStamps', () => {
  it('who and when, for the creation and the last edit', () => {
    expect(auditStamps({
      createdBy: 'Bilal', createdOn: at('2026-10-09 14:05'), editedBy: 'Saim', editedOn: at('2026-10-10 09:30'),
    })).toEqual({
      created: { by: 'Bilal', on: '09-10-2026 14:05' },
      edited: { by: 'Saim', on: '10-10-2026 09:30' },
    })
  })

  it('a record never edited has no edit; one with no stamp at all has neither', () => {
    expect(auditStamps({ createdBy: 'Bilal', createdOn: at('2026-10-09 14:05') }).edited).toBeNull()
    expect(auditStamps({})).toEqual({ created: null, edited: null })
    expect(auditStamps(undefined)).toEqual({ created: null, edited: null })
  })

  it("a record saved before the stamps: the creator the screen already knew, and no time", () => {
    expect(auditStamps({ createdBy: null }, { createdBy: 'Hammad' }).created).toEqual({ by: 'Hammad', on: '' })
    // Its own stamp wins.
    expect(auditStamps({ createdBy: 'Bilal' }, { createdBy: 'Hammad' }).created.by).toBe('Bilal')
  })

  it("a voucher migrated from Climax: the person out of Climax's add log", () => {
    expect(personOf('abbas # SERVER # Administrator # 192.168.50.136')).toBe('abbas')
    expect(personOf('Zain Qazi # 192.168.50.97:60233')).toBe('Zain Qazi')
    expect(personOf(null)).toBe('')
  })

  it('reads as a sentence, with either half missing', () => {
    expect(stampText('Created', { by: 'Bilal', on: '09-10-2026 14:05' })).toBe('Created by Bilal on 09-10-2026 14:05')
    expect(stampText('Created', { by: '', on: '09-10-2026 14:05' })).toBe('Created on 09-10-2026 14:05')
    expect(stampText('Edited', { by: 'Saim', on: '' })).toBe('Edited by Saim')
    expect(stampText('Edited', null)).toBe('')
  })
})

describe('<AuditStamp>', () => {
  const record = { createdBy: 'Bilal', createdOn: at('2026-10-09 14:05'), editedBy: 'Saim', editedOn: at('2026-10-10 09:30') }

  it('one line on a page header', () => {
    render(<AuditStamp record={record} />)
    expect(screen.getByTestId('audit-stamp')).toHaveTextContent(
      'Created by Bilal on 09-10-2026 14:05 · Edited by Saim on 10-10-2026 09:30')
  })

  it('a line each in a narrow column', () => {
    render(<AuditStamp record={record} stacked />)
    expect(screen.getByText('Created by Bilal on 09-10-2026 14:05')).toBeInTheDocument()
    expect(screen.getByText('Edited by Saim on 10-10-2026 09:30')).toBeInTheDocument()
  })

  it('nothing at all for a record with no stamp', () => {
    const { container } = render(<AuditStamp record={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('<AuditTip> - a charge line', () => {
  it('an icon, with who and when on hover', async () => {
    render(<AuditTip record={{ createdBy: 'Bilal', createdOn: at('2026-10-09 14:05') }} />)
    const icon = screen.getByLabelText('Created by Bilal on 09-10-2026 14:05')
    fireEvent.mouseEnter(icon)
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Created by Bilal on 09-10-2026 14:05'))
  })

  it('no icon on a line with no stamp - one entered before them', () => {
    const { container } = render(<AuditTip record={{ createdBy: null }} />)
    expect(container).toBeEmptyDOMElement()
  })
})
