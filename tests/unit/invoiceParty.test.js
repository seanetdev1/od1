const { linePartyOf } = require('../../functions/invoiceParty');

describe('linePartyOf', () => {
  it('is the party every line names', () => {
    expect(linePartyOf([{ partyId: 51, name: 'A' }, { partyId: '51', name: 'A' }])).toEqual({ clientId: '51' });
  });

  it('reads Sequelize rows as well as plain objects', () => {
    expect(linePartyOf([{ dataValues: { partyId: 7 } }])).toEqual({ clientId: '7' });
  });

  it('ignores lines with no party', () => {
    expect(linePartyOf([{ partyId: null }, { partyId: '' }, { partyId: 9 }])).toEqual({ clientId: '9' });
    expect(linePartyOf([{ partyId: null }])).toBeNull();
    expect(linePartyOf([])).toBeNull();
  });

  it('says so when the lines disagree, rather than picking one', () => {
    expect(linePartyOf([{ partyId: 1, name: 'A' }, { partyId: 2, name: 'B' }])).toEqual({ mixed: ['A', 'B'] });
  });
});
