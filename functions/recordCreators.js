/**
 * Who created a document, read from History.
 *
 * Invoices and customs jobs carry no creator of their own, but every one made
 * in Odyssey writes a History row when it is created - the signed-in user,
 * the form, 'Create' and the document's number. The FIRST such row is the
 * creator; later edits have their own types. A document migrated from Climax
 * has no row, and so no creator: shown blank, not guessed.
 *
 * One query for a whole page of documents, then one for the names.
 */
async function creatorsOf(db, formName, docNos) {
  const numbers = [...new Set((docNos || []).filter(Boolean).map(String))];
  if (!numbers.length) return new Map();
  const rows = await db.History.findAll({
    where: { formName, type: 'Create', docNo: numbers },
    attributes: ['docNo', 'EmployeeId', 'createdAt'],
    order: [['createdAt', 'ASC']],
    raw: true,
  });
  const firstBy = new Map();
  for (const r of rows) if (!firstBy.has(r.docNo)) firstBy.set(r.docNo, r.EmployeeId);
  const ids = [...new Set([...firstBy.values()].filter(Boolean).map(String))];
  const people = ids.length
    ? await db.Employees.findAll({ where: { id: ids }, attributes: ['id', 'name'], raw: true })
    : [];
  const nameById = new Map(people.map((p) => [String(p.id), p.name]));
  return new Map([...firstBy].map(([no, id]) => [no, nameById.get(String(id)) || null]));
}

module.exports = { creatorsOf };
