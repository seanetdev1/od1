/**
 * THE CUSTOMS PORTS OF LOADING - which ports a clearing agent files exports
 * FROM, the Port Of Loading list on a customs job and in the Program Book.
 *
 * Set in Setup > Ports, as an option on the port ("Customs port of loading"),
 * not in the code (the user's request, 2026-10-12: each client files from its
 * own points - one from QFS, Badruddin, ICT, Pak Shaheen...; CargoLinkers from
 * the three MCC desks). Ports with the option ticked ARE the list; with none
 * ticked an install keeps the built-in list it always had, so nothing changes
 * for one that never touches it.
 *
 * KEPT AS A SETTING, not a column on Ports: the option is per install, and
 * Ports is a shared table that boot never alters - a column would have meant a
 * SQL step on every install before deploying. The setting holds the ports'
 * row ids, so renaming a port, or changing its code, carries through; a port
 * deleted is simply no longer listed.
 *
 * A job stores the port's CODE (portId), as Port Of Discharge does.
 */
const KEY = 'customsLoadingPorts';

async function loadingPortIds(db) {
  const row = await db.AppSetting.findOne({ where: { key: KEY } });
  try {
    const list = JSON.parse(row?.value || '[]');
    return new Set((Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger));
  } catch (_) {
    return new Set();
  }
}

/** Tick or untick one port (its row id). */
async function setLoadingPort(db, portPk, on) {
  const id = Number(portPk);
  if (!Number.isInteger(id)) return;
  const ids = await loadingPortIds(db);
  if (on) ids.add(id); else ids.delete(id);
  const value = JSON.stringify([...ids].sort((a, b) => a - b));
  const [row, created] = await db.AppSetting.findOrCreate({ where: { key: KEY }, defaults: { value } });
  if (!created) await row.update({ value });
}

/**
 * The Port Of Loading list for sea: the ticked ports, by name - or
 * `builtIn` when none is ticked. As [{ id, name }], id being the port's code.
 */
async function customsPolSea(db, builtIn) {
  const ids = await loadingPortIds(db);
  if (!ids.size) return builtIn;
  const ports = await db.Ports.findAll({
    where: { id: [...ids] }, attributes: ['portId', 'portName'], order: [['portName', 'ASC']], raw: true,
  });
  return ports.length ? ports.map((p) => ({ id: p.portId, name: plainName(p) })) : builtIn;
}

/* Setup > Ports stores a name with its code on the end - "Badruddin (BDR)".
   The list reads as the desk is called; the job still stores the code. */
const plainName = (p) => {
  const tail = ` (${p.portId})`;
  return String(p.portName || '').endsWith(tail) ? p.portName.slice(0, -tail.length) : p.portName;
};

module.exports = { loadingPortIds, setLoadingPort, customsPolSea, KEY };
