// AWB stock: the register of air waybill numbers the office holds.
//
// Mounted under /aviationJob/awb by ./index.js, alongside the carrier and
// aircraft masters, because it is the same kind of thing - a Setup list the
// flight screen picks from - and it reads the same two tables.
//
// Two rules run through everything here:
//
//   A NUMBER IS REGISTERED ONCE.  awbNumber is unique on the table, so the
//   register cannot hold the same air waybill twice however it is reached.
//
//   A NUMBER GOES TO ONE MASTER AGENT.  masterAgentId is a single column, so
//   there is nowhere to put a second one. Assigning a series checks the WHOLE
//   range up front and refuses the batch if any of it is spoken for, rather
//   than assigning the first forty and stopping on the forty-first.
//
// "Used" is COUNTED, never stored: it is the number of consignments pointing
// at the row. A stored flag would have to be maintained on every flight save,
// edit, line removal and job delete, and would be wrong the first time one of
// those paths was missed. See the model.
//
// "VOIDED" IS STORED, and is the exception - a torn or misprinted air waybill
// is a fact about a piece of paper that no flight can be asked about. Every
// route below that hands a number out or offers one to be used excludes voided
// rows, and that is deliberately repeated at each of them rather than left to
// one shared scope: a route added later that forgets is a voided number
// reaching an aircraft, so the check is where it is enforced.
const routes = require('express').Router();
const Sequelize = require('sequelize');
const Op = Sequelize.Op;
const { Aviation_Awb, Aviation_Carrier, Aviation_Consignment, Aviation_Job } =
  require('../../functions/Associations/aviationAssociations');
const { Clients } = require('../../functions/Associations/clientAssociation');
const { createHistory } = require('../../functions/history');
const { parseEntry, generateSeries, formatNumber, digitsOnly, planRegistration } = require('../../functions/awb');
// The outstanding-offload rule, shared with the dashboard so the two can never
// disagree about which AWBs still owe cargo.
const { isCancelled, isAwbClosed, byFlightOrder, num } = require('../../functions/aviationPendingLoads');

// Ids arrive from URLs and JSON bodies as strings, so "undefined" and "null"
// are truthy and sail past a plain `if (!id)` into Postgres, which rejects
// them with "invalid input syntax for type integer".
const asId = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return /^[0-9]+$/.test(s) ? Number(s) : null;
};

// How many consignments point at this number, as a scalar subquery.
//
// Counted rather than stored so it can never disagree with the flights: edit a
// flight, remove a line, delete a job, and this answer changes with it for
// free. The alias is the model name, which is what Sequelize puts in the FROM.
const USED_COUNT = Sequelize.literal(
  '(SELECT COUNT(*)::int FROM "Aviation_Consignments" AS auc ' +
  'WHERE auc."AviationAwbId" = "Aviation_Awb"."id")'
);

const carrierInclude = {
  model: Aviation_Carrier,
  attributes: ['id', 'name', 'prefix', 'category'],
  required: false,
};

const agentInclude = {
  model: Clients,
  as: 'masterAgent',
  attributes: ['id', 'name', 'code'],
  required: false,
};

const shape = (row) => ({
  id: row.id,
  awbNumber: row.awbNumber,
  formatted: formatNumber(row.awbNumber),
  prefix: row.prefix,
  serial: row.serial,
  checkDigit: row.checkDigit,
  assignedAt: row.assignedAt,
  remarks: row.remarks,
  AviationCarrierId: row.AviationCarrierId,
  carrier: row.Aviation_Carrier ? row.Aviation_Carrier.name : '',
  carrierCategory: row.Aviation_Carrier ? row.Aviation_Carrier.category : '',
  masterAgentId: row.masterAgentId,
  masterAgent: row.masterAgent ? row.masterAgent.name : '',
  // Null on a usable number. The date IS the flag - see the model.
  voidedAt: row.voidedAt || null,
  voidReason: row.voidReason || '',
  // Present on the list query, absent on the light ones.
  useCount: row.get ? Number(row.get('useCount') || 0) : 0,
});

/* -------------------------------------------------------------------------
 * REGISTER - one number, or a series generated from it.
 *
 * The prefix is NOT typed: it is read off the carrier, which owns it and holds
 * it uniquely. Typing it per registration is how one carrier ends up with two
 * prefixes, and an AWB whose prefix disagrees with its carrier belongs to
 * nobody.
 *
 * `masterAgentId` IS OPTIONAL, and registers-and-hands-over in one act.
 * Setup > AWB Stock does not send it: a block arrives from the airline and is
 * given out later, which is two events on two screens. The flight screen's
 * quick registration does, because there the number is already on a document
 * in front of the operator - it has been handed over, and registering it
 * without saying to whom would leave it invisible to the consignment grid,
 * which offers a row only its own agent's numbers.
 *
 * With an agent named, a number ALREADY on the register is assigned rather
 * than refused: it is the same act, and either way the operator's number ends
 * up registered and theirs. Numbers belonging to a DIFFERENT agent still stop
 * the request outright, and that check runs BEFORE anything is written, so a
 * refusal leaves the register exactly as it was.
 * ---------------------------------------------------------------------- */
routes.post('/register', async (req, res) => {
  try {
    const { code, series, count, remarks, employeeId } = req.body || {};
    const carrierId = asId(req.body?.carrierId);
    const masterAgentId = asId(req.body?.masterAgentId);

    if (!carrierId) {
      return res.status(400).json({ status: 'error', result: 'Select the carrier these numbers belong to.' });
    }
    const carrier = await Aviation_Carrier.findByPk(carrierId);
    if (!carrier) {
      return res.status(404).json({ status: 'error', result: 'That carrier no longer exists.' });
    }

    let agent = null;
    if (masterAgentId) {
      agent = await Clients.findByPk(masterAgentId, { attributes: ['id', 'name'] });
      if (!agent) {
        return res.status(404).json({ status: 'error', result: 'That master agent no longer exists.' });
      }
    }

    const parsed = parseEntry(carrier.prefix, code);
    if (!parsed.ok) {
      return res.status(400).json({ status: 'error', result: parsed.error });
    }

    const howMany = series ? Math.floor(Number(count) || 0) : 1;
    if (series && (howMany < 1 || howMany > 1000)) {
      return res.status(400).json({
        status: 'error',
        result: 'Enter how many numbers to generate, between 1 and 1000.',
      });
    }

    const candidates = generateSeries(parsed.prefix, parsed.serial, howMany);
    if (!candidates.length) {
      return res.status(400).json({
        status: 'error',
        result: 'That serial is already the highest 7-digit number - there is nothing after it.',
      });
    }

    // Numbers already in the register are SKIPPED rather than failing the
    // whole batch. Re-running a series to fill a gap is normal work, and one
    // clash should not throw away the other ninety-nine.
    const existing = await Aviation_Awb.findAll({
      where: { awbNumber: { [Op.in]: candidates.map((x) => x.awbNumber) } },
      // voidedAt is fetched, not just the assignment: planRegistration decides
      // what happens to a number on the register, and a voided one it cannot
      // see would be handed over like any other.
      attributes: ['id', 'awbNumber', 'masterAgentId', 'voidedAt'],
      include: [agentInclude],
    });
    /* What this request actually does to the register - decided in one pure
     * function so the rule can be tested without a database, and so it is
     * settled BEFORE the first row is written. See planRegistration. */
    const plan = planRegistration(candidates, existing, masterAgentId);
    const fresh = plan.fresh;

    // VOIDED NUMBERS ARE NAMED, NOT REFUSED. They are already on the register
    // so nothing is created for them, and they cannot be handed to anybody, so
    // the only thing left to do about them is say so. Refusing the batch would
    // make one torn AWB block the ninety-nine good ones around it - see
    // planRegistration.
    const voidedNote = plan.voided.length
      ? ` ${plan.voided.length} number(s) in that run are voided and were left as they are: ` +
        plan.voided.slice(0, 5).map((r) => formatNumber(r.awbNumber)).join(', ') +
        (plan.voided.length > 5 ? '…' : '') + '.'
      : '';

    // SOMEBODY ELSE'S NUMBER stops the whole request. Handing over half a
    // block and stopping leaves the operator with no idea where the run
    // actually reached, so nothing at all is written.
    if (plan.taken.length) {
      const names = plan.taken.slice(0, 8).map(
        (r) => `${formatNumber(r.awbNumber)} → ${r.masterAgent ? r.masterAgent.name : 'another agent'}`
      );
      return res.status(409).json({
        status: 'error',
        result:
          `${plan.taken.length} of these numbers are already assigned to another master agent, ` +
          `so nothing was changed: ${names.join(', ')}` +
          (plan.taken.length > names.length ? `, and ${plan.taken.length - names.length} more.` : '.'),
      });
    }

    // Without an agent that is the end of it: everything asked for is already
    // on the register, so there is nothing to do and saying so is the answer.
    // WITH one there may still be - those same rows have to be handed over.
    if (!fresh.length && !agent) {
      return res.status(409).json({
        status: 'error',
        result: (candidates.length === 1
          ? `${formatNumber(candidates[0].awbNumber)} is already registered.`
          : `All ${candidates.length} numbers in that series are already registered.`) + voidedNote,
      });
    }

    const assignedAt = new Date().toISOString();
    const created = fresh.length
      ? await Aviation_Awb.bulkCreate(fresh.map((x) => ({
        ...x,
        AviationCarrierId: carrierId,
        remarks: String(remarks || '').trim() || null,
        createdById: employeeId ? String(employeeId) : null,
        // Registered and handed over in one act - see the note above.
        ...(agent ? { masterAgentId, assignedAt } : {}),
      })))
      : [];

    // The ones already on the register but not yet this agent's - see
    // planRegistration for why the ones already theirs are left alone.
    const toAssign = plan.toAssign.map((r) => r.id);
    if (toAssign.length) {
      await Aviation_Awb.update(
        { masterAgentId, assignedAt },
        { where: { id: { [Op.in]: toAssign } } }
      );
    }

    const touched = created.length + toAssign.length;
    if (touched) {
      createHistory(
        employeeId,
        'AWB Stock',
        'Register',
        (created.length === 1 && !toAssign.length
          ? formatNumber(created[0].awbNumber)
          : `${touched} numbers from ${formatNumber(candidates[0].awbNumber)}`) +
        (agent ? ` to ${agent.name}` : '')
      );
    }

    // What to NAME in the answer: the numbers actually registered, or - when
    // they were all on the register already and this was a hand-over - the
    // ones asked for.
    const range = fresh.length ? fresh : candidates;
    res.json({
      status: 'success',
      result: {
        created: created.length,
        skipped: candidates.length - fresh.length,
        // How many went to the master agent, newly registered ones included.
        // 0 with an agent named means every one was already theirs.
        assigned: agent ? touched : 0,
        agent: agent ? agent.name : null,
        from: formatNumber(range[0].awbNumber),
        to: formatNumber(range[range.length - 1].awbNumber),
        // Said out loud: a number silently skipped because it is voided looks
        // exactly like one silently skipped because it was already there, and
        // the two mean very different things to whoever is counting the block.
        voided: plan.voided.length,
        voidedNote: voidedNote.trim() || null,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* -------------------------------------------------------------------------
 * LIST - paginated and filtered on the server, for the Setup page.
 * ---------------------------------------------------------------------- */
routes.get('/list', async (req, res) => {
  try {
    const wantsAll = req.query.all === '1' || req.query.all === 'true';
    const page = wantsAll ? 1 : Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = wantsAll
      ? 20000
      : Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);

    const carrierId = asId(req.query.carrierId);
    const masterAgentId = asId(req.query.masterAgentId);
    const status = String(req.query.status || 'all');
    const search = digitsOnly(req.query.search);

    const and = [];
    if (carrierId) and.push({ AviationCarrierId: carrierId });
    if (masterAgentId) and.push({ masterAgentId });
    // Matching the stripped 11-digit column means the number can be typed with
    // or without the usual 214-1000000 1 spacing and still be found.
    if (search) and.push({ awbNumber: { [Op.like]: `%${search}%` } });

    // The states a number can be in, as filters. 'available' is the one the
    // office actually works from: registered, not given out, not used - and
    // not voided, because a torn AWB is not stock however untouched the rest
    // of its row looks. 'voided' is its own filter rather than a corner of
    // another one: "what happened to the numbers we cannot use" is a question
    // the airline asks directly.
    if (status === 'assigned')   and.push({ masterAgentId: { [Op.ne]: null } });
    if (status === 'unassigned') and.push({ masterAgentId: null });
    if (status === 'used')       and.push(Sequelize.where(USED_COUNT, Op.gt, 0));
    if (status === 'unused')     and.push(Sequelize.where(USED_COUNT, Op.eq, 0));
    if (status === 'voided')     and.push({ voidedAt: { [Op.ne]: null } });
    if (status === 'available')  and.push({ masterAgentId: null, voidedAt: null }, Sequelize.where(USED_COUNT, Op.eq, 0));

    const { count, rows } = await Aviation_Awb.findAndCountAll({
      where: and.length ? { [Op.and]: and } : {},
      attributes: { include: [[USED_COUNT, 'useCount']] },
      include: [carrierInclude, agentInclude],
      order: [['prefix', 'ASC'], ['serial', 'ASC']],
      limit,
      offset: (page - 1) * limit,
      // Both includes are belongsTo, so one row in means one row out - but
      // distinct keeps the pager honest if that ever stops being true.
      distinct: true,
    });

    // The flights a used number is on, fetched for this page only rather than
    // joined: the join would be one-to-many and would need de-duplicating
    // back out of the count above.
    const usedIds = rows.filter((r) => Number(r.get('useCount')) > 0).map((r) => r.id);
    const onFlights = usedIds.length
      ? await Aviation_Consignment.findAll({
          where: { AviationAwbId: { [Op.in]: usedIds } },
          attributes: ['AviationAwbId'],
          include: [{ model: Aviation_Job, attributes: ['id', 'jobNo', 'flightNo'], required: false }],
        })
      : [];
    const flightsByAwb = {};
    for (const line of onFlights) {
      const key = line.AviationAwbId;
      const job = line.Aviation_Job;
      if (!job) continue;
      (flightsByAwb[key] = flightsByAwb[key] || []).push({
        id: job.id, jobNo: job.jobNo, flightNo: job.flightNo,
      });
    }

    res.json({
      status: 'success',
      result: {
        rows: rows.map((row) => ({ ...shape(row), flights: flightsByAwb[row.id] || [] })),
        count,
        page,
        limit,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* -------------------------------------------------------------------------
 * ASSIGN - give numbers to a master agent.
 *
 * Takes EITHER a list of ids (ticked in the list) or a starting number and a
 * count (a block handed over as a run). Either way the whole set is checked
 * BEFORE anything is written: a partial assignment would leave the operator
 * with no idea where the run actually stopped.
 * ---------------------------------------------------------------------- */
routes.post('/assign', async (req, res) => {
  try {
    const { ids, code, count, series, employeeId } = req.body || {};
    const masterAgentId = asId(req.body?.masterAgentId);
    const carrierId = asId(req.body?.carrierId);

    if (!masterAgentId) {
      return res.status(400).json({ status: 'error', result: 'Select the master agent to assign these to.' });
    }
    const agent = await Clients.findByPk(masterAgentId, { attributes: ['id', 'name'] });
    if (!agent) {
      return res.status(404).json({ status: 'error', result: 'That master agent no longer exists.' });
    }

    let rows = [];
    let missing = [];

    if (Array.isArray(ids) && ids.length) {
      const wanted = ids.map(asId).filter(Boolean);
      rows = await Aviation_Awb.findAll({
        where: { id: { [Op.in]: wanted } },
        include: [carrierInclude, agentInclude],
      });
      if (rows.length !== wanted.length) {
        return res.status(404).json({
          status: 'error',
          result: 'Some of those numbers no longer exist. Reload the list and try again.',
        });
      }
    } else {
      // Series form: carrier + starting number + how many.
      if (!carrierId) {
        return res.status(400).json({ status: 'error', result: 'Select the carrier the series belongs to.' });
      }
      const carrier = await Aviation_Carrier.findByPk(carrierId);
      if (!carrier) {
        return res.status(404).json({ status: 'error', result: 'That carrier no longer exists.' });
      }
      const parsed = parseEntry(carrier.prefix, code);
      if (!parsed.ok) {
        return res.status(400).json({ status: 'error', result: parsed.error });
      }
      const howMany = series ? Math.floor(Number(count) || 0) : 1;
      if (series && (howMany < 1 || howMany > 1000)) {
        return res.status(400).json({
          status: 'error',
          result: 'Enter how many numbers to assign, between 1 and 1000.',
        });
      }
      const wanted = generateSeries(parsed.prefix, parsed.serial, howMany);
      rows = await Aviation_Awb.findAll({
        where: { awbNumber: { [Op.in]: wanted.map((x) => x.awbNumber) } },
        include: [carrierInclude, agentInclude],
      });
      // A number in the run that was never registered is named rather than
      // silently skipped - a gap in a block handed over by the airline is
      // exactly the thing worth knowing about.
      const found = new Set(rows.map((x) => x.awbNumber));
      missing = wanted.filter((x) => !found.has(x.awbNumber)).map((x) => formatNumber(x.awbNumber));
    }

    if (!rows.length) {
      return res.status(404).json({
        status: 'error',
        result: missing.length
          ? `None of those ${missing.length} numbers are registered yet. Register them first.`
          : 'No numbers to assign.',
      });
    }

    // A VOIDED NUMBER CANNOT BE HANDED TO ANYONE. Checked before the agent
    // clash below, because "already with another agent" would be a misleading
    // thing to say about a document that has been torn up.
    //
    // Refused rather than skipped, unlike registration: assigning is a
    // deliberate act on a named set, so a voided number in it means the
    // operator is working from a list that is out of date, and quietly
    // handing over the rest of it is how the spoiled one gets forgotten.
    const voided = rows.filter((r) => r.voidedAt);
    if (voided.length) {
      return res.status(409).json({
        status: 'error',
        result:
          `${voided.length} of these numbers are voided and cannot be assigned, ` +
          `so nothing was changed: ` +
          voided.slice(0, 8).map((r) => formatNumber(r.awbNumber)).join(', ') +
          (voided.length > 8 ? `, and ${voided.length - 8} more.` : '.'),
      });
    }

    // THE WHOLE RANGE IS CHECKED FIRST. Already held by this same agent is
    // fine and re-assigning is a no-op; held by anyone else stops the batch.
    const taken = rows.filter((r) => r.masterAgentId && r.masterAgentId !== masterAgentId);
    if (taken.length) {
      const names = taken.slice(0, 8).map(
        (r) => `${formatNumber(r.awbNumber)} → ${r.masterAgent ? r.masterAgent.name : 'another agent'}`
      );
      return res.status(409).json({
        status: 'error',
        result:
          `${taken.length} of these ${rows.length} numbers are already assigned to another master agent, ` +
          `so nothing was changed: ${names.join(', ')}` +
          (taken.length > names.length ? `, and ${taken.length - names.length} more.` : '.'),
      });
    }

    const toAssign = rows.filter((r) => r.masterAgentId !== masterAgentId);
    if (!toAssign.length) {
      return res.json({
        status: 'success',
        result: {
          assigned: 0,
          alreadyTheirs: rows.length,
          missing,
          agent: agent.name,
          from: formatNumber(rows[0].awbNumber),
          to: formatNumber(rows[rows.length - 1].awbNumber),
        },
      });
    }

    await Aviation_Awb.update(
      { masterAgentId, assignedAt: new Date().toISOString() },
      { where: { id: { [Op.in]: toAssign.map((r) => r.id) } } }
    );

    createHistory(
      employeeId,
      'AWB Stock',
      'Assign',
      toAssign.length === 1
        ? `${formatNumber(toAssign[0].awbNumber)} to ${agent.name}`
        : `${toAssign.length} numbers to ${agent.name}`
    );

    res.json({
      status: 'success',
      result: {
        assigned: toAssign.length,
        alreadyTheirs: rows.length - toAssign.length,
        missing,
        agent: agent.name,
        from: formatNumber(toAssign[0].awbNumber),
        to: formatNumber(toAssign[toAssign.length - 1].awbNumber),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* -------------------------------------------------------------------------
 * UNASSIGN - take numbers back off a master agent and return them to stock.
 *
 * A number already used on a flight is NOT released: the consignment names
 * that AWB and the agent it went out to, and unassigning would leave the
 * flight referring to a hand-over that the register says never happened.
 * ---------------------------------------------------------------------- */
routes.post('/unassign', async (req, res) => {
  try {
    const wanted = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id])
      .map(asId).filter(Boolean);
    if (!wanted.length) {
      return res.status(400).json({ status: 'error', result: 'No numbers selected.' });
    }

    const rows = await Aviation_Awb.findAll({
      where: { id: { [Op.in]: wanted } },
      attributes: { include: [[USED_COUNT, 'useCount']] },
    });

    // A VOIDED NUMBER IS FROZEN AS IT WAS VOIDED, agent included. The register
    // is what the airline is shown when it asks what became of a serial, and
    // "voided, and nobody ever had it" is a worse answer than the true one.
    // Restoring it first is the way to move it - one deliberate act that says
    // the document is usable again, rather than a hand-over that quietly
    // rewrites the history of one that is not.
    const voided = rows.filter((r) => r.voidedAt);
    if (voided.length) {
      return res.status(409).json({
        status: 'error',
        result:
          `${voided.length} of these are voided and stay with the agent they were voided under: ` +
          voided.slice(0, 8).map((r) => formatNumber(r.awbNumber)).join(', ') +
          '. Restore them first if they are usable after all.',
      });
    }

    const used = rows.filter((r) => Number(r.get('useCount')) > 0);
    if (used.length) {
      return res.status(409).json({
        status: 'error',
        result:
          `${used.length} of these are already on a flight and cannot be taken back: ` +
          used.slice(0, 8).map((r) => formatNumber(r.awbNumber)).join(', ') + '.',
      });
    }

    const [released] = await Aviation_Awb.update(
      { masterAgentId: null, assignedAt: null },
      { where: { id: { [Op.in]: rows.map((r) => r.id) } } }
    );

    createHistory(req.body?.employeeId, 'AWB Stock', 'Unassign', `${released} number(s)`);
    res.json({ status: 'success', result: { released } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* -------------------------------------------------------------------------
 * DELETE - remove a number that should never have been registered.
 *
 * Only while it is unused. A number on a flight is part of that flight's
 * record - and of any invoice raised from it - so deleting the register row
 * would leave the consignment pointing at nothing.
 * ---------------------------------------------------------------------- */
routes.post('/delete', async (req, res) => {
  try {
    const id = asId(req.body?.id);
    if (!id) return res.status(400).json({ status: 'error', result: 'Which number?' });

    const row = await Aviation_Awb.findOne({
      where: { id },
      attributes: { include: [[USED_COUNT, 'useCount']] },
    });
    if (!row) return res.status(404).json({ status: 'error', result: 'That number is no longer registered.' });

    if (Number(row.get('useCount')) > 0) {
      return res.status(409).json({
        status: 'error',
        result: `${formatNumber(row.awbNumber)} is on a flight. Remove it from the consignment first.`,
      });
    }

    // VOIDING IS THE OPPOSITE OF DELETING, and the two must not undo each
    // other by accident. Delete is for a number that should never have been
    // registered - a typo, somebody else's block - and it leaves no trace,
    // which is exactly what a voided number must not do: the airline issued
    // that serial and will ask what became of it. Restore first if the void
    // itself was the mistake.
    if (row.voidedAt) {
      return res.status(409).json({
        status: 'error',
        result:
          `${formatNumber(row.awbNumber)} is voided, and the register is the record of what ` +
          `became of it. Restore it first if it really should come off.`,
      });
    }

    await row.destroy();
    createHistory(req.body?.employeeId, 'AWB Stock', 'Delete', formatNumber(row.awbNumber));
    res.json({ status: 'success', result: { id } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* -------------------------------------------------------------------------
 * VOID - mark numbers unusable without removing them from the register.
 *
 * WHY THIS IS NOT A DELETE. An air waybill is a physical document, and paper
 * gets torn, misprinted, soaked or lost between the airline and the counter.
 * The number on it is spent either way: no airline will accept a shipment on a
 * serial whose document is destroyed, and no other shipment can ever be given
 * that serial. But the airline allocated it and will ask what became of it, so
 * the register has to keep it and say. A deleted number reads as one that was
 * never received, which is the wrong answer to that question.
 *
 * WHAT IT COSTS THE NUMBER. It stops being offered by /available, so it cannot
 * reach a consignment; it cannot be assigned or unassigned; and it cannot be
 * deleted. The row otherwise stays exactly as it was - the master agent it was
 * with included, because that is who was holding the document when it was
 * spoiled.
 *
 * NOT FOR A USED NUMBER. Once an AWB is on a flight it has flown: the
 * consignment, the manifest and any invoice raised from it all name it, and
 * marking it unusable afterwards would contradict every one of them. What that
 * situation actually needs is the consignment corrected.
 *
 * A REASON IS REQUIRED. Six months later "voided" on its own is not an answer
 * to anything, and the reason is the whole content of what the register is
 * being asked to remember.
 * ---------------------------------------------------------------------- */
routes.post('/void', async (req, res) => {
  try {
    const wanted = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id])
      .map(asId).filter(Boolean);
    if (!wanted.length) {
      return res.status(400).json({ status: 'error', result: 'No numbers selected.' });
    }

    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({
        status: 'error',
        result: 'Say why these are being voided - torn, misprinted, lost. That note is the record.',
      });
    }

    const rows = await Aviation_Awb.findAll({
      where: { id: { [Op.in]: wanted } },
      attributes: { include: [[USED_COUNT, 'useCount']] },
    });
    if (!rows.length) {
      return res.status(404).json({
        status: 'error',
        result: 'Those numbers are no longer registered. Reload the list and try again.',
      });
    }

    // CHECKED BEFORE ANYTHING IS WRITTEN, like every other batch here: voiding
    // half a selection and stopping leaves the operator to work out by hand
    // which half.
    const used = rows.filter((r) => Number(r.get('useCount')) > 0);
    if (used.length) {
      return res.status(409).json({
        status: 'error',
        result:
          `${used.length} of these are already on a flight and cannot be voided, ` +
          `so nothing was changed: ` +
          used.slice(0, 8).map((r) => formatNumber(r.awbNumber)).join(', ') +
          (used.length > 8 ? `, and ${used.length - 8} more.` : '.'),
      });
    }

    // Already voided ones are LEFT ALONE rather than re-stamped: the date and
    // reason belong to when the document was actually spoiled, and voiding a
    // selection that happens to contain one is not a request to rewrite it.
    const toVoid = rows.filter((r) => !r.voidedAt);
    if (!toVoid.length) {
      return res.json({
        status: 'success',
        result: { voided: 0, alreadyVoided: rows.length },
      });
    }

    await Aviation_Awb.update(
      {
        voidedAt: new Date().toISOString(),
        voidReason: reason,
        voidedById: req.body?.employeeId ? String(req.body.employeeId) : null,
      },
      { where: { id: { [Op.in]: toVoid.map((r) => r.id) } } }
    );

    createHistory(
      req.body?.employeeId,
      'AWB Stock',
      'Void',
      (toVoid.length === 1
        ? formatNumber(toVoid[0].awbNumber)
        : `${toVoid.length} numbers, ${formatNumber(toVoid[0].awbNumber)} to ` +
          `${formatNumber(toVoid[toVoid.length - 1].awbNumber)}`) + ` - ${reason}`
    );

    res.json({
      status: 'success',
      result: {
        voided: toVoid.length,
        alreadyVoided: rows.length - toVoid.length,
        from: formatNumber(toVoid[0].awbNumber),
        to: formatNumber(toVoid[toVoid.length - 1].awbNumber),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* -------------------------------------------------------------------------
 * RESTORE - undo a void.
 *
 * Voiding is one click on a row, and the row above it looks identical. Without
 * a way back, a mis-click would cost a number permanently - it cannot be
 * deleted and re-registered either, because voided numbers refuse deletion on
 * purpose - and the register would slowly fill with numbers that are perfectly
 * good and unusable. That is a worse failure than the mis-click.
 *
 * The number comes back exactly as it was: its master agent was never cleared,
 * so restoring it returns it to that agent's stock rather than to the office's.
 * ---------------------------------------------------------------------- */
routes.post('/unvoid', async (req, res) => {
  try {
    const wanted = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.id])
      .map(asId).filter(Boolean);
    if (!wanted.length) {
      return res.status(400).json({ status: 'error', result: 'No numbers selected.' });
    }

    const rows = await Aviation_Awb.findAll({
      where: { id: { [Op.in]: wanted }, voidedAt: { [Op.ne]: null } },
    });
    if (!rows.length) {
      return res.status(404).json({
        status: 'error',
        result: 'None of those numbers are voided.',
      });
    }

    const [restored] = await Aviation_Awb.update(
      { voidedAt: null, voidReason: null, voidedById: null },
      { where: { id: { [Op.in]: rows.map((r) => r.id) } } }
    );

    createHistory(
      req.body?.employeeId,
      'AWB Stock',
      'Restore',
      rows.length === 1 ? formatNumber(rows[0].awbNumber) : `${rows.length} numbers`
    );
    res.json({ status: 'success', result: { restored } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/* -------------------------------------------------------------------------
 * AVAILABLE - the numbers the consignment grid's AWB dropdown picks from.
 *
 * WHICH NUMBERS BELONG IN THAT LIST:
 *
 *   never used            yes - ordinary stock, waiting to be put on a flight
 *   used, load pending    yes - it was offloaded and still owes cargo, so it
 *                               HAS to be selectable to fly the remainder
 *   used, fully carried   NO  - that shipment is finished. Offering it again
 *                               invites a second flight against a completed
 *                               AWB, and on a long-running install the settled
 *                               ones would drown the list.
 *   voided                NO  - the document is spoiled and the airline will
 *                               not accept it. Excluded in the WHERE rather
 *                               than filtered afterwards, so a voided number
 *                               never even reaches this function's reasoning
 *                               about outstanding cargo.
 *
 * A pending row carries the details of the leg it was last left behind on, so
 * the grid can fill the new consignment in from it - same parties, same
 * commodity, same route - with the remaining weight rather than the original.
 * ---------------------------------------------------------------------- */
routes.get('/available', async (req, res) => {
  try {
    const carrierId = asId(req.query.carrierId);
    const masterAgentId = asId(req.query.masterAgentId);

    const where = { voidedAt: null };
    if (carrierId) where.AviationCarrierId = carrierId;
    if (masterAgentId) where.masterAgentId = masterAgentId;

    const rows = await Aviation_Awb.findAll({
      where,
      attributes: { include: [[USED_COUNT, 'useCount']] },
      include: [carrierInclude, agentInclude],
      order: [['prefix', 'ASC'], ['serial', 'ASC']],
      limit: 5000,
    });

    const usedIds = rows.filter((r) => Number(r.get('useCount')) > 0).map((r) => r.id);
    const pendingByAwbId = usedIds.length ? await pendingByStockId(usedIds) : new Map();

    const result = [];
    for (const row of rows) {
      const used = Number(row.get('useCount')) > 0;
      const pending = pendingByAwbId.get(row.id) || null;
      // The only numbers left out: used up and nothing outstanding.
      if (used && !pending) continue;
      result.push({
        ...shape(row),
        pending: pending ? pending.pending : 0,
        // Everything needed to carry the remainder on a new flight. Absent on
        // an unused number - there is no earlier leg to copy from.
        prefill: pending ? pending.prefill : null,
      });
    }

    res.json({ status: 'success', result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 'error', result: error.message || String(error) });
  }
});

/**
 * Outstanding cargo per registered AWB, keyed by stock id.
 *
 * Grouped by AviationAwbId rather than by the awb string that
 * functions/aviationPendingLoads groups on. Two carriers can issue the same
 * 8-digit serial under different prefixes - the consignment stores only those
 * 8 digits, so grouping on them would merge two unrelated air waybills. The
 * stock id cannot collide.
 *
 * The RULE is still that file's: skip cancelled flights, order legs by flight
 * date, and the outstanding amount is the offload on the latest one. Its
 * helpers are reused rather than reimplemented so the dashboard and this
 * dropdown can never disagree about what is outstanding.
 */
const pendingByStockId = async (stockIds) => {
  const legs = await Aviation_Consignment.findAll({
    where: { AviationAwbId: { [Op.in]: stockIds } },
    include: [
      {
        model: Aviation_Job,
        attributes: ['id', 'jobNo', 'flightNo', 'flightDate', 'status', 'canceled'],
        required: true,
      },
    ],
  });

  const byStock = new Map();
  for (const l of legs) {
    const job = l.Aviation_Job;
    if (!job || isCancelled(job)) continue;
    const flat = {
      id: l.id,
      flightDate: job.flightDate || '',
      line: l,
      job,
    };
    if (!byStock.has(l.AviationAwbId)) byStock.set(l.AviationAwbId, []);
    byStock.get(l.AviationAwbId).push(flat);
  }

  const out = new Map();
  for (const [stockId, group] of byStock) {
    group.sort(byFlightOrder);
    const last = group[group.length - 1];
    const pending = num(last.line.offload);
    if (pending <= 0) continue;
    /* CLOSED on the flight that left the cargo behind - it went back to the
     * master agent, was withdrawn, or went out on somebody else's aircraft.
     * Offering the number here as still owing cargo would invite someone to
     * put a shipment that is already finished onto a new flight - and, because
     * an AWB only drops off this list by being fully carried, it would sit in
     * the dropdown for ever. The number instead falls through to the "used up,
     * nothing outstanding" branch in /available and leaves the list, which is
     * what has actually happened to it. */
    if (isAwbClosed(last.line)) continue;

    out.set(stockId, {
      pending,
      prefill: {
        // The descriptive half of the consignment, copied forward. The weights
        // are NOT copied - the new leg carries what is left, not what was
        // originally booked - so the grid sets those from `pending`.
        shipperId:     last.line.shipperId || null,
        consigneeId:   last.line.consigneeId || null,
        masterAgentId: last.line.masterAgentId || null,
        CommodityId:   last.line.CommodityId || null,
        AviationCarrierId: last.line.AviationCarrierId || null,
        // Carried forward with the rest of the description: the remainder of a
        // shipment belongs in the same report column as the part that already
        // flew, and re-deciding that per leg is how one AWB ends up split
        // across two columns of the same month.
        reportingTag:  last.line.reportingTag || null,
        origin:        last.line.origin || '',
        destination:   last.line.destination || '',
        natureOfGoods: last.line.natureOfGoods || '',
        // The shipment's own measurements, copied VERBATIM. They describe the
        // air waybill, not the flight - the AWB still says 1,000 kg however
        // many aircraft it takes to move it. Only the chargeable weight
        // differs on a continuation leg, and the grid sets that from
        // `pending`. The offload figures are NOT copied: they belong to the
        // leg that left the cargo behind, which is why this one exists.
        //
        // Volumetric weight is not among them any more - the grid stopped
        // collecting it in 1.2.2, so there is nothing to carry forward.
        pieces:           last.line.pieces ?? null,
        grossWeight:      last.line.grossWeight ?? null,
        // Rates come forward too: it is the same shipment for the same party,
        // and re-typing them is how the two legs end up priced differently.
        // Both conversions come forward with the rates they belong to.
        buyingExRate:  last.line.buyingExRate ?? last.line.exRate ?? 1,
        sellingExRate: last.line.sellingExRate ?? last.line.exRate ?? 1,
        exRate:      last.line.exRate ?? 1,
        buyingRate:  last.line.buyingRate ?? null,
        sellingRate: last.line.sellingRate ?? null,
        from: {
          jobNo: last.job.jobNo || '',
          flightNo: last.job.flightNo || '',
          flightDate: last.job.flightDate || '',
        },
      },
    });
  }
  return out;
};

module.exports = routes;
