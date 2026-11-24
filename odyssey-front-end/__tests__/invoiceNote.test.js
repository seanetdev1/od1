import { hasNote } from '../functions/invoiceNote';

describe('an invoice with a note to print', () => {
  test('a note with words in it', () => expect(hasNote({ note: 'Payment within 15 days' })).toBe(true));
  test.each([undefined, null, '', '   ', '\n'])('a note of %p is none - Hide Note starts ticked', (note) => {
    expect(hasNote({ note })).toBe(false);
  });
  test('no invoice yet', () => expect(hasNote(undefined)).toBe(false));
});
