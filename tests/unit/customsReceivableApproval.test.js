const { newlyApprovedReceivables } = require('../../functions/customsCharge');

/* A receivable may be approved only once the customs job is On Vessel; the
 * route refuses a save that would NEWLY approve one before that. */
describe('newlyApprovedReceivables', () => {
  const rec = (extra = {}) => ({ charge: 41, type: 'Recievable', status: '1', ...extra });

  it('finds a receivable being approved in this save', () => {
    expect(newlyApprovedReceivables([rec()])).toHaveLength(1);
    expect(newlyApprovedReceivables([rec({ id: 7 })], new Set(['8']))).toHaveLength(1);
  });

  it('leaves one that was already approved, an unapproved one, and a payable', () => {
    expect(newlyApprovedReceivables([rec({ id: 7 })], new Set(['7']))).toHaveLength(0);
    expect(newlyApprovedReceivables([rec({ status: '0' })])).toHaveLength(0);
    expect(newlyApprovedReceivables([rec({ type: 'Payble' })])).toHaveLength(0);
  });

  it('leaves a charge already on an invoice, and an empty row', () => {
    expect(newlyApprovedReceivables([rec({ InvoiceId: 3 })])).toHaveLength(0);
    expect(newlyApprovedReceivables([{ type: 'Recievable', status: '1' }])).toHaveLength(0);
  });

  it('reads nothing into a save that sent no charges', () => {
    expect(newlyApprovedReceivables(undefined)).toEqual([]);
  });
});
