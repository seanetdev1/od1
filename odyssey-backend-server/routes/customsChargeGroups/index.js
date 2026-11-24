const routes = require('express').Router();
const {
  Customs_Charge_Group, Customs_Charge_Group_Party, Customs_Charge_Group_Line,
} = require('../../models');

/**
 * CHARGE GROUPS - a named set of default charges for a kind of client.
 *
 * A clearing agent bills the same dozen heads to the same client over and
 * over, and a different dozen to a different kind of client. A group writes
 * that pattern down once: the parties it applies to, and the receivable and
 * payable lines it brings. The charge sheet then imports it in a click rather
 * than having it retyped per job, which is where a head gets missed - and a
 * missed payable is profit the file never shows.
 *
 * WHAT A GROUP DOES NOT HOLD IS A PARTY PER LINE. A charge already knows whose
 * it is through the master's defaultRecivableParty / defaultPaybleParty role,
 * resolved against the JOB's own client, shipping line or transporter. The
 * import fills each line's party exactly as adding one by hand does, so a
 * party stored here would be the same fact recorded twice - and would disagree
 * the first time a client changed on a job.
 *
 * A PARTY MAY BE IN SEVERAL GROUPS. The same client genuinely buys two
 * different services. `/forParty` returns every group a party is in and the
 * screen asks which to import when there is more than one, rather than
 * guessing or merging two tariffs into a sheet that matches neither.
 */

const str = (v) => String(v ?? '').trim();
const asId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/* THE APP'S OWN SPELLINGS, not tidied ones.
 *
 * Charge_Head.type holds 'Recievable' and 'Payble' - both misspelled, both
 * load-bearing: functions/customsCharge writes them, the charge sheet filters
 * on them, and every row in the book carries them. A group storing 'Receivable'
 * would import lines onto a side the sheet does not recognise, and they would
 * appear on neither. Same reason 'Per Shipment' is spelled out here rather than
 * shortened to what the column header says. */
const { CH_RECEIVABLE, CH_PAYABLE } = require('../../functions/customsCharge');
const SIDES = [CH_RECEIVABLE, CH_PAYABLE];

// What a line is allowed to carry. A whitelist rather than the request body:
// this is written to the database and then copied onto jobs.
const lineValues = (l, i, groupId) => ({
  CustomsChargeGroupId: groupId,
  type: SIDES.includes(str(l.type)) ? str(l.type) : CH_RECEIVABLE,
  charge: l.charge === null || l.charge === undefined || l.charge === '' ? null : String(l.charge),
  particular: str(l.particular) || null,
  description: str(l.description) || null,
  basis: str(l.basis) || null,
  // Left NULL rather than defaulted to 0: a group that says nothing about the
  // rate is asking for it to be typed per job, and a 0 would read as free.
  qty: l.qty === '' || l.qty === null || l.qty === undefined ? null : Number(l.qty),
  rate_charge: l.rate_charge === '' || l.rate_charge === null || l.rate_charge === undefined
    ? null : Number(l.rate_charge),
  discount: l.discount === '' || l.discount === null || l.discount === undefined
    ? null : Number(l.discount),
  currency: str(l.currency) || null,
  position: i,
});

const withChildren = {
  include: [
    { model: Customs_Charge_Group_Party },
    { model: Customs_Charge_Group_Line },
  ],
};

// Children come back in the order they were written, not the order the
// database felt like - a tariff read out of sequence is hard to check against
// the agreement it came from.
const ordered = (group) => {
  const g = group.toJSON ? group.toJSON() : group;
  return {
    ...g,
    Customs_Charge_Group_Lines: (g.Customs_Charge_Group_Lines || [])
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    Customs_Charge_Group_Parties: (g.Customs_Charge_Group_Parties || [])
      .sort((a, b) => str(a.partyName).localeCompare(str(b.partyName))),
  };
};

const fail = (res, error) => {
  console.error('customsChargeGroups:', error);
  res.status(500).json({ status: 'error', result: error.message || error });
};

/** Every group, with its parties and lines. */
routes.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.companyId) where.companyId = String(req.query.companyId);
    // Inactive ones are still returned: the setup screen shows them so they
    // can be turned back on. Only /forParty filters them out.
    const groups = await Customs_Charge_Group.findAll({ where, ...withChildren });
    res.json({
      status: 'success',
      result: groups.map(ordered).sort((a, b) => str(a.name).localeCompare(str(b.name))),
    });
  } catch (error) { fail(res, error); }
});

/**
 * The groups a party belongs to - what the job's import button asks.
 *
 * Active only: an archived tariff should not be offered on a new job, even
 * though the jobs it was already imported onto keep their charges.
 */
routes.get('/forParty', async (req, res) => {
  try {
    const partyId = str(req.headers.partyid || req.query.partyId);
    if (!partyId) {
      return res.status(400).json({ status: 'error', result: 'A party id is required.' });
    }

    const memberships = await Customs_Charge_Group_Party.findAll({ where: { partyId } });
    const ids = memberships.map((m) => m.CustomsChargeGroupId);
    if (!ids.length) return res.json({ status: 'success', result: [] });

    const groups = await Customs_Charge_Group.findAll({
      where: { id: ids, active: true },
      ...withChildren,
    });
    res.json({
      status: 'success',
      result: groups.map(ordered).sort((a, b) => str(a.name).localeCompare(str(b.name))),
    });
  } catch (error) { fail(res, error); }
});

/**
 * Create or update a group, its parties and its lines in one call.
 *
 * Children are REPLACED, not merged: the screen edits the whole group and
 * sends it whole, so anything absent was deleted there. Merging would make a
 * removal impossible to express.
 */
routes.post('/save', async (req, res) => {
  try {
    const data = req.body?.data || {};
    const name = str(data.name);
    if (!name) {
      return res.status(400).json({ status: 'error', result: 'A group needs a name.' });
    }

    const id = asId(data.id);
    let group;
    if (id) {
      group = await Customs_Charge_Group.findOne({ where: { id } });
      if (!group) return res.status(404).json({ status: 'error', result: 'Group not found.' });
      await group.update({
        name,
        description: str(data.description) || null,
        active: data.active === undefined ? group.active : Boolean(data.active),
        companyId: data.companyId === undefined ? group.companyId : str(data.companyId) || null,
      });
    } else {
      group = await Customs_Charge_Group.create({
        name,
        description: str(data.description) || null,
        active: data.active === undefined ? true : Boolean(data.active),
        companyId: str(data.companyId) || null,
      });
    }

    if (Array.isArray(data.parties)) {
      await Customs_Charge_Group_Party.destroy({ where: { CustomsChargeGroupId: group.id } });
      // De-duplicated: the same party twice in one group would import its
      // lines twice and read as a mistake nobody made twice on purpose.
      const seen = new Set();
      const rows = [];
      for (const p of data.parties) {
        const pid = str(p?.partyId ?? p);
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);
        rows.push({
          CustomsChargeGroupId: group.id,
          partyId: pid,
          partyName: str(p?.partyName) || null,
        });
      }
      if (rows.length) await Customs_Charge_Group_Party.bulkCreate(rows);
    }

    if (Array.isArray(data.lines)) {
      await Customs_Charge_Group_Line.destroy({ where: { CustomsChargeGroupId: group.id } });
      const rows = data.lines
        // A line naming no charge is an empty row somebody tabbed through.
        .filter((l) => l && str(l.charge))
        .map((l, i) => lineValues(l, i, group.id));
      if (rows.length) await Customs_Charge_Group_Line.bulkCreate(rows);
    }

    const saved = await Customs_Charge_Group.findOne({ where: { id: group.id }, ...withChildren });
    res.json({ status: 'success', result: ordered(saved) });
  } catch (error) { fail(res, error); }
});

/**
 * Delete a group.
 *
 * Its parties and lines go with it (CASCADE). The charges it has already put
 * on jobs are NOT touched: they became ordinary charge heads the moment they
 * were imported, which is the point of importing rather than linking - a job's
 * sheet must not change because somebody edited a tariff months later.
 */
routes.post('/delete', async (req, res) => {
  try {
    const id = asId(req.body?.id);
    if (!id) return res.status(400).json({ status: 'error', result: 'Not a valid group id.' });
    const group = await Customs_Charge_Group.findOne({ where: { id } });
    if (!group) return res.status(404).json({ status: 'error', result: 'Group not found.' });
    await group.destroy();
    res.json({ status: 'success', result: 'Group deleted.' });
  } catch (error) { fail(res, error); }
});

module.exports = routes;
