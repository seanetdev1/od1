/* SEARCH ON SETUP > VESSELS - on the server, for one page at a time.
 *
 * Matches a vessel's name, carrier, code, type (Import / Export / Both), port
 * of loading and destinations, case-insensitively, anywhere in the value.
 * Several words: each must match somewhere ("msc both").
 *
 * "active" and "inactive" are the STATUS, as whole words: "inactive" lists the
 * vessels taken off the job screen's picker (models/Vessel active), "active"
 * the rest. As a plain substring "active" would also match every inactive one.
 *
 * % and _ typed in the box are characters, not wildcards.
 */
const { Op, where: sqlWhere, cast, col } = require('sequelize');

const MAX_WORDS = 8;

const words = (search) =>
  (typeof search === 'string' ? search : '')
    .trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The Sequelize `where` for the box's text; {} when it is empty. */
function vesselSearchWhere(search) {
  const list = words(search);
  if (!list.length) return {};
  return {
    [Op.and]: list.map((word) => {
      const lower = word.toLowerCase();
      if (lower === 'active') return { active: true };
      if (lower === 'inactive') return { active: false };
      const like = { [Op.iLike]: `%${escapeLike(word)}%` };
      return {
        [Op.or]: [
          { name: like },
          { carrier: like },
          { type: like },
          { pol: like },
          { destinations: like },
          sqlWhere(cast(col('Vessel.code'), 'text'), like),
        ],
      };
    }),
  };
}

module.exports = { vesselSearchWhere, words, escapeLike };
