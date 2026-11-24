// The Direct Job list's search box: how its text becomes words and patterns.
// What each word matches is in tests/integration/directJob.test.js.
const { words, escapeLike, directJobSearchWhere } = require('../../functions/directJobSearch');

describe('words', () => {
  it('splits on any run of spaces and drops the ends', () => {
    expect(words('  Saim   Oct-2026 ')).toEqual(['Saim', 'Oct-2026']);
  });

  it('is nothing for an empty box, or for something that is not text', () => {
    expect(words('   ')).toEqual([]);
    expect(words(undefined)).toEqual([]);
    expect(words(['a', 'b'])).toEqual([]); // ?search=a&search=b
  });

  it('keeps at most eight words', () => {
    expect(words('a b c d e f g h i j')).toHaveLength(8);
  });
});

describe('escapeLike', () => {
  it('makes % _ and \\ plain characters for ILIKE', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
  });

  it('leaves everything else alone', () => {
    expect(escapeLike('CL-JER-513/26')).toBe('CL-JER-513/26');
  });
});

describe('directJobSearchWhere', () => {
  const sequelize = { escape: (s) => `'${String(s).replace(/'/g, "''")}'` };

  it('filters nothing for an empty box', () => {
    expect(directJobSearchWhere('', sequelize)).toEqual({});
  });

  it('needs every word, each matching any value', () => {
    const where = directJobSearchWhere('saim oct-2026', sequelize);
    const [and] = Object.getOwnPropertySymbols(where);
    expect(where[and]).toHaveLength(2);
  });

  it("quotes what was typed, so a ' cannot end the string", () => {
    const where = directJobSearchWhere("o'brien", sequelize);
    const [and] = Object.getOwnPropertySymbols(where);
    const [or] = Object.getOwnPropertySymbols(where[and][0]);
    const sql = where[and][0][or].map((l) => l.val).join(' ');
    expect(sql).toContain("'%o''brien%'");
    expect(sql).not.toMatch(/'%o'brien/);
  });

  it('adds the amount only for a word that could be one', () => {
    const count = (s) => {
      const where = directJobSearchWhere(s, sequelize);
      const [and] = Object.getOwnPropertySymbols(where);
      const [or] = Object.getOwnPropertySymbols(where[and][0]);
      return where[and][0][or].length;
    };
    expect(count('1,500.00')).toBe(count('saim') + 1);
    expect(count('CPV-1/27')).toBe(count('saim'));
  });
});
