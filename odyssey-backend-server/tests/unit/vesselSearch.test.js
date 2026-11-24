// Setup > Vessels' search box - how its text becomes the list's `where`.
// What it finds is in tests/integration/vessel.test.js ("the list").
const { Op } = require('sequelize');
const { vesselSearchWhere, words, escapeLike } = require('../../functions/vesselSearch');

it('filters nothing for an empty box, or something that is not text', () => {
  expect(vesselSearchWhere('')).toEqual({});
  expect(vesselSearchWhere('   ')).toEqual({});
  expect(vesselSearchWhere(['a', 'b'])).toEqual({}); // ?search=a&search=b
});

it('needs every word, at most eight', () => {
  expect(vesselSearchWhere('msc both')[Op.and]).toHaveLength(2);
  expect(words('a b c d e f g h i j')).toHaveLength(8);
});

it('reads active and inactive, as whole words in any case, as the status', () => {
  expect(vesselSearchWhere('INACTIVE')[Op.and]).toEqual([{ active: false }]);
  expect(vesselSearchWhere('active')[Op.and]).toEqual([{ active: true }]);
  expect(vesselSearchWhere('inact')[Op.and][0][Op.or]).toBeDefined();
});

it('makes % _ and \\ plain characters', () => {
  expect(escapeLike('50%_x\\')).toBe('50\\%\\_x\\\\');
});
