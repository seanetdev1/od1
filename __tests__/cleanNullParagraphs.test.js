/**
 * @jest-environment jsdom
 */
import { cleanNullParagraphs } from '../Components/Layouts/JobsLayout/BlComp/states'

// The B/L detail page white-screened with "Cannot read properties of null
// (reading 'replace')" because a content column was null. Every one of those
// columns is nullable and rows reach the table from more than one path, so
// the editor cannot assume it is given a string.

describe('cleanNullParagraphs', () => {
  test('returns a string instead of throwing on a null column', () => {
    for (const input of [null, undefined]) {
      expect(() => cleanNullParagraphs(input)).not.toThrow()
      expect(cleanNullParagraphs(input)).toBe('')
    }
  })

  test('does not throw on a non-string value', () => {
    expect(() => cleanNullParagraphs(42)).not.toThrow()
    expect(typeof cleanNullParagraphs(42)).toBe('string')
  })

  test('keeps real paragraphs and rebuilds them for the editor', () => {
    const out = cleanNullParagraphs('<p>ACME LTD</p><p>12 DOCK RD</p>')
    expect(out).toContain('ACME LTD')
    expect(out).toContain('12 DOCK RD')
    expect(out.match(/<p/g)).toHaveLength(2)
  })

  test('strips the placeholder paragraphs the importer pads with', () => {
    // The importer pads every address to ten lines with "null" and adds
    // "TEL null" twice when the source has no TEL line - this is the code
    // that removes them again.
    const out = cleanNullParagraphs(
      '<p>ACME LTD</p><p>TEL null</p><p>TEL null</p><p>null</p><p>null</p>'
    )
    expect(out).toBe('<p class="my-custom-paragraph">ACME LTD</p>')
  })

  test('handles an address that is nothing but placeholders', () => {
    const padded = '<p>TEL null</p><p>TEL null</p>' + '<p>null</p>'.repeat(8)
    expect(cleanNullParagraphs(padded)).toBe('')
  })

  test('converts &nbsp; to a space', () => {
    expect(cleanNullParagraphs('<p>ACME&nbsp;LTD</p>')).toContain('ACME LTD')
  })
})
