/**
 * Whether an invoice has a note to print.
 *
 * The print's Note box is left out when there is none: Hide Note on the
 * invoice page starts ticked for an invoice with no note (and unticks itself
 * the moment one is typed). Bulk print hides it the same way, whatever its own
 * Hide Note says, and so does the emailed / printed copy, which has no box.
 */
export const hasNote = (invoice) => String(invoice?.note ?? '').trim() !== '';

export default hasNote;
