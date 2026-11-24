const { planLocationBatch, keysOf } = require('../../functions/locationMigrationPlan');

describe('planLocationBatch', () => {
  const airport = (code, over = {}) => ({
    airportCode: code, airportName: `${code} AIRPORT`, city: 'CITY', country: 'COUNTRY', ...over,
  });
  const port = (id, over = {}) => ({
    portId: id, portName: `${id} PORT`, portCountry: 'COUNTRY', ...over,
  });

  it('rejects a row with a blank NOT NULL column instead of storing it empty', () => {
    // Every column on these models is NOT NULL with a notEmpty validator, but
    // the import writes through bulkCreate, which does not run validators - so
    // a blank slips in and renders as an empty cell forever.
    const plan = planLocationBatch('airports', [
      airport('LHR'),
      airport('CDG', { city: '' }),
      airport('JFK', { country: '   ' }),
      airport('AMS', { airportName: null }),
    ]);

    expect(plan.toCreate.map((r) => r.airportCode)).toEqual(['LHR']);
    expect(plan.stats.rejected).toBe(3);
    expect(plan.rejected.map((r) => r.reason))
      .toEqual(['city is blank', 'country is blank', 'airportName is blank']);
    expect(plan.canApply).toBe(true);      // a bad row stalls nothing
  });

  it('trims every column it keeps', () => {
    const plan = planLocationBatch('airports', [
      airport(' LHR ', { airportName: 'HEATHROW   ', city: ' LONDON', country: 'UK  ' }),
    ]);
    expect(plan.toCreate[0]).toEqual({
      airportCode: 'LHR', airportName: 'HEATHROW', city: 'LONDON', country: 'UK',
    });
  });

  it('collapses internal whitespace runs too', () => {
    const plan = planLocationBatch('destinations', [{ name: 'NEW    YORK' }]);
    expect(plan.toCreate[0].name).toBe('NEW YORK');
  });

  it('de-duplicates within the batch, case-insensitively', () => {
    // A picker showing both "Paris" and "PARIS" is a duplicate to everyone
    // except the unique index.
    const plan = planLocationBatch('destinations', [
      { name: 'PARIS' }, { name: 'Paris' }, { name: 'paris ' }, { name: 'LYON' },
    ]);
    expect(plan.toCreate.map((r) => r.name)).toEqual(['PARIS', 'LYON']);
    expect(plan.stats.duplicatesInBatch).toBe(2);
  });

  it('skips rows already in the table', () => {
    const plan = planLocationBatch('ports', [port('NLRTM'), port('DEHAM')], ['nlrtm']);
    expect(plan.toCreate.map((r) => r.portId)).toEqual(['DEHAM']);
    expect(plan.stats.alreadyPresent).toBe(1);
  });

  it('counts everything it did, so a batch can be summed into a run', () => {
    const plan = planLocationBatch('ports', [
      port('A'), port('A'), port('B'), port('C', { portCountry: '' }),
    ], ['b']);

    expect(plan.stats).toEqual({
      received: 4, toCreate: 1, duplicatesInBatch: 1, alreadyPresent: 1, rejected: 1,
    });
  });

  it('refuses an unknown kind rather than silently writing nothing', () => {
    expect(() => planLocationBatch('cities', [])).toThrow(/Unknown location kind "cities"/);
  });

  it('survives junk rows', () => {
    const plan = planLocationBatch('destinations', [null, 'string', 42, { name: 'REAL' }]);
    expect(plan.toCreate).toEqual([{ name: 'REAL' }]);
    expect(plan.stats.rejected).toBe(3);
  });

  it('does not throw on an empty batch', () => {
    expect(planLocationBatch('airports', []).stats.received).toBe(0);
    expect(planLocationBatch('airports', undefined).toCreate).toEqual([]);
  });
});

describe('keysOf', () => {
  it('returns the key column so the caller can query existence once', () => {
    expect(keysOf('airports', [{ airportCode: ' LHR ' }, { airportCode: '' }, {}]))
      .toEqual(['LHR']);
    expect(keysOf('ports', [{ portId: 'NLRTM' }])).toEqual(['NLRTM']);
    expect(keysOf('destinations', [{ name: 'PARIS' }])).toEqual(['PARIS']);
  });

  it('returns nothing for an unknown kind', () => {
    expect(keysOf('nope', [{ a: 1 }])).toEqual([]);
  });
});
