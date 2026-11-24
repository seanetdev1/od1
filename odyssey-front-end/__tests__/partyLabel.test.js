import { partyLabel } from '../functions/partyLabel';

/* Payments & Receipts listed parties by name alone - with thousands of them,
 * several sharing a name, and the code being what staff search by. */
describe('partyLabel', () => {
  it('puts the party code in front of the name', () => {
    expect(partyLabel({ code: '13050', name: 'Z.K INDUSTRIES' })).toBe('(13050) Z.K INDUSTRIES');
  });

  it('lists a party with no code by name alone', () => {
    expect(partyLabel({ code: null, name: 'CUSTOMER' })).toBe('CUSTOMER');
    expect(partyLabel({ code: '  ', name: 'CUSTOMER' })).toBe('CUSTOMER');
  });

  it('can be found by its code', () => {
    expect(partyLabel({ code: 6, name: 'AZIZ GARMENTS INDUSTRIES' }).toLowerCase()).toContain('(6)');
  });
});
