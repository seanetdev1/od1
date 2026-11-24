/**
 * An empty string in an INTEGER column, as null.
 *
 * A form's unset dropdown sends "" - and Postgres refuses it outright for an
 * integer column ("invalid input syntax for type integer"), failing the whole
 * save. The job form converted most of its links by hand, one line each, and
 * missed some: an air job saved with no airline, a job with Transport ticked
 * but no transporter picked (the user's report, 2026-10-15). Done here from the
 * model itself, so a field added later cannot be missed.
 *
 * Changes `data` in place and returns it. Only "" (and whitespace) - a real
 * value, or a value that is not a string, is left for the database to judge.
 */
function blankIntegersToNull(Model, data) {
  if (!data || typeof data !== 'object') return data;
  for (const [name, attr] of Object.entries(Model.rawAttributes || {})) {
    const key = attr?.type?.key;
    if (key !== 'INTEGER' && key !== 'BIGINT' && key !== 'SMALLINT') continue;
    if (typeof data[name] === 'string' && data[name].trim() === '') data[name] = null;
  }
  return data;
}

module.exports = { blankIntegersToNull };
