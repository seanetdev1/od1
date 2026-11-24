const { blankIntegersToNull } = require('../../functions/blankIntegers');

/* An unset dropdown's "" in an integer column, as null - functions/blankIntegers. */
describe('blank integer links', () => {
  const Model = {
    rawAttributes: {
      airLineId: { type: { key: 'INTEGER' } },
      jobId: { type: { key: 'INTEGER' } },
      exRate: { type: { key: 'STRING' } },
      title: { type: { key: 'STRING' } },
    },
  };

  test('"" and whitespace in an integer column become null', () => {
    expect(blankIntegersToNull(Model, { airLineId: '', jobId: '  ' })).toEqual({ airLineId: null, jobId: null });
  });

  test('a value, and every text column, are left as they are', () => {
    const data = { airLineId: 12, jobId: '7', exRate: '', title: '' };
    expect(blankIntegersToNull(Model, data)).toEqual({ airLineId: 12, jobId: '7', exRate: '', title: '' });
    expect(blankIntegersToNull(Model, null)).toBeNull();
  });
});
