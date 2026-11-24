/* THE NAMES A WORD TEMPLATE CAN USE, for one kind of document - an invoice
 * (functions/invoiceTemplateFields) or a B/L or Air Waybill
 * (functions/blTemplateFields). Configuration > Printing Templates shows them,
 * and warns on upload about a name that is not one of them: it prints nothing.
 *
 *   fields      [{ group, fields: [[name, what it is, example]] }]
 *   lists       [{ name, about, fields: [[name, what it is, example]] }]
 *   conditions  [[name, prints it when]]
 *
 * No React - unit tested. */
export function templateCatalogue({ fields, lists, conditions }) {
  const top = new Set([
    ...fields.flatMap((g) => g.fields.map(([n]) => n)),
    ...lists.map((l) => l.name),
    ...conditions.map(([n]) => n),
  ]);
  const listNames = new Map(lists.map((l) => [l.name, new Set(l.fields.map(([n]) => n))]));

  /* From the tree the server reads out of the file ({ invoiceNo: {},
   * expenses: { sr: {} } }). Inside a list its own names count, and the
   * document's too: a value from outside the list can print in its rows.
   * Returned as "expenses > srNo" so the author can find it. */
  const unknownNames = (tree, inList = null, at = '') => {
    const out = [];
    Object.entries(tree || {}).forEach(([name, children]) => {
      const known = top.has(name) || (inList && inList.has(name));
      const where = at ? `${at} > ${name}` : name;
      if (!known) out.push(where);
      if (children && Object.keys(children).length) {
        const list = listNames.get(name);
        out.push(...unknownNames(children, list || inList, where));
      }
    });
    return out;
  };

  return { fields, lists, conditions, unknownNames };
}

export default templateCatalogue;
