// Associations for the aviation jobs module.
//
// Self-contained on purpose: this file only ever links the two Aviation_*
// tables to each other and to the read-only masters they pick from (Clients,
// Commodity). It adds NOTHING to SE_Job, Charge_Head, Invoice or any other
// existing table, so loading it cannot change the shape of an existing query -
// which is the whole point of aviation being a separate module.
const { DataTypes } = require('sequelize');
const { Aviation_Job, Aviation_Consignment, Aviation_Carrier, Aviation_Aircraft, Aviation_Awb, Aviation_Pfm, Aviation_Pfm_Line, Commodity } = require("../../../models");
const { Clients } = require("../clientAssociation");

// A flight carries many consignments. Deleting the flight takes its lines with
// it; a line on its own is meaningless.
Aviation_Job.hasMany(Aviation_Consignment, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    onDelete: 'CASCADE'
});
Aviation_Consignment.belongsTo(Aviation_Job);

// Each line names its own parties. Three separate links to Clients, aliased
// the way SE_Job already aliases its own - shipperId / consigneeId /
// masterAgentId - so the column names say which party they hold rather than a
// bare ClientId that could mean any of them.
//
// No matching Clients.hasMany here on purpose: nothing ever asks "which
// consignments is this party on", and three unaliased hasMany calls back from
// Clients would collide.
Aviation_Consignment.belongsTo(Clients, { as: 'shipper',     foreignKey: 'shipperId'     });
Aviation_Consignment.belongsTo(Clients, { as: 'consignee',   foreignKey: 'consigneeId'   });
Aviation_Consignment.belongsTo(Clients, { as: 'masterAgent', foreignKey: 'masterAgentId' });

Commodity.hasMany(Aviation_Consignment, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
Aviation_Consignment.belongsTo(Commodity);

// Whose cargo this consignment is. The carrier carries the AWB prefix and the
// ER/IFA/Other tag the monthly report counts by, so a consignment names a
// carrier rather than repeating either.
Aviation_Carrier.hasMany(Aviation_Consignment, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
Aviation_Consignment.belongsTo(Aviation_Carrier);

// THE PARTY BEHIND THE CARRIER - who a charge against this carrier is actually
// billed to or paid to.
//
// A charge is never billed to a master. /makeInvoice resolves a charge's
// partyId through Client_Associations to a ledger account, so a charge pointed
// at a carrier id would raise an invoice that posts nowhere. Carrying a party
// id means an aviation payable to an airline is an ORDINARY charge against an
// ORDINARY party - invoicing, the JB series, approveInvoice, the ledger and the
// print template all behave exactly as they do for a freight payable.
//
// Nullable: carriers registered before this existed have none, and one can be
// attached later from Setup > Carriers. A carrier without a party is usable
// everywhere except as a charge default, which is exactly the degradation
// wanted - it does not block a flight from being entered.
//
// No matching Clients.hasMany - same reason as the party links above: nothing
// asks a party for its carriers, and the unaliased direction would collide.
Aviation_Carrier.belongsTo(Clients, { as: 'party', foreignKey: 'partyId' });

// WHOSE FLIGHT IT IS - the operating airline.
//
// Deliberately a SECOND, aliased link to the same master, not a reuse of the
// consignment's one. The two answer different questions, and conflating them
// is the mistake this alias exists to prevent:
//
//   Aviation_Job.operatingCarrierId    who is flying the aircraft
//   Aviation_Consignment.AviationCarrierId    whose cargo this AWB is
//
// They differ constantly and that is the normal case, not the exception: a PIA
// flight carries PIA's own load alongside cargo for other carriers, and the
// monthly report's ER / IFA / Other split is counted off the CONSIGNMENT side
// precisely because the flight's own airline says nothing about who each AWB
// belongs to. Defaulting one from the other would quietly mis-tag a month's
// uplift, so nothing does.
//
// belongsTo only, no matching hasMany - same reason as the party links above:
// nothing asks a carrier for its flights, and the unaliased direction would
// collide with the consignment link it already has.
Aviation_Job.belongsTo(Aviation_Carrier, {
    as: 'operatingCarrier',
    foreignKey: 'operatingCarrierId',
});

// Which aircraft flew it. The report splits every sector by aircraft, so this
// is a registered record rather than typed text - see the model.
Aviation_Aircraft.hasMany(Aviation_Job, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
Aviation_Job.belongsTo(Aviation_Aircraft);

/* -------------------------------------------------------------------------
 * AWB stock.
 * ---------------------------------------------------------------------- */

// Who issued the number. An AWB is prefix + serial, and the prefix belongs to
// the carrier, so a registered number always names one. allowNull:false -
// a number with no carrier could not have a prefix to be built from.
Aviation_Carrier.hasMany(Aviation_Awb, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: false
    }
});
Aviation_Awb.belongsTo(Aviation_Carrier);

// Who the number has been given out to. ONE column, so a number physically
// cannot be assigned to two master agents - the rule is the schema, not a
// check somewhere that could be skipped. Null means still in stock.
//
// Aliased for the same reason the consignment's three party links are: the
// column name says which party it holds. No matching Clients.hasMany - nothing
// asks Clients for its AWBs, and the unaliased direction would collide with
// the other party links.
Aviation_Awb.belongsTo(Clients, { as: 'masterAgent', foreignKey: 'masterAgentId' });

// Which consignments used the number. hasMany, NOT hasOne: the same AWB
// legitimately appears on more than one flight when a shipment is split across
// aircraft - that is what /aviationJob/relatedCharges exists to bill. So
// "used" is a count, not a claim, and freeing it is not a thing that has to
// happen: delete the flight and the rows pointing here go with it.
Aviation_Awb.hasMany(Aviation_Consignment, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
Aviation_Consignment.belongsTo(Aviation_Awb);

/* -------------------------------------------------------------------------
 * The PFM - the pre-flight manifest, and the flight that is built from it.
 * ---------------------------------------------------------------------- */

// A PFM plans many consignments. Deleting the plan takes its lines with it; a
// planned line on its own is meaningless - the same contract the flight has
// with its consignments.
Aviation_Pfm.hasMany(Aviation_Pfm_Line, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    onDelete: 'CASCADE'
});
Aviation_Pfm_Line.belongsTo(Aviation_Pfm);

// Whose flight the plan is for, and what is meant to fly it. Both aliased and
// shaped exactly as Aviation_Job's are, so a PFM and the flight made from it
// name their airline and their aircraft through the same columns - which is
// what lets the import be a straight copy rather than a translation.
Aviation_Pfm.belongsTo(Aviation_Carrier, {
    as: 'operatingCarrier',
    foreignKey: 'operatingCarrierId',
});
Aviation_Pfm.belongsTo(Aviation_Aircraft, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});

// THE FLIGHT THIS PLAN BECAME.
//
// On the JOB rather than on the PFM, and one column rather than a join table:
// a flight is built from at most one plan, and a plan is flown at most once.
// That is what "unused PFMs only" in the flight's selector means - a PFM with
// no job pointing at it - so the rule is a NULL check on this column rather
// than a status somebody has to remember to set.
//
// NULLABLE, and it has to be: every flight entered before the PFM module
// existed has none, and those flights are not wrong. See the selector.
//
// A REAL FOREIGN KEY even though nothing yet reads the flight off the plan.
// Recorded so that anything asking "what was this flight planned to carry"
// later has a join to make instead of a flight number to match on - flight
// numbers repeat every week, and matching on one would pair a flight with the
// plan for the same service a fortnight earlier.
Aviation_Pfm.hasOne(Aviation_Job, {
    foreignKey: {
        name: 'AviationPfmId',
        type: DataTypes.INTEGER,
        allowNull: true
    },
});
Aviation_Job.belongsTo(Aviation_Pfm, { foreignKey: 'AviationPfmId' });

// What a planned line names. The same masters a consignment picks from, so an
// imported line lands on the flight already pointing at the right records -
// no lookup by name, and nothing to re-pick.
Aviation_Pfm_Line.belongsTo(Clients, { as: 'masterAgent', foreignKey: 'masterAgentId' });
Aviation_Pfm_Line.belongsTo(Commodity, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
// Whose cargo the planned AWB is.
Aviation_Pfm_Line.belongsTo(Aviation_Carrier, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
// WHO FLIES IT ONWARD - the second leg. A second, ALIASED link to the same
// carrier master, for the same reason Aviation_Job.operatingCarrier is aliased
// away from the consignment's carrier: the two answer different questions and
// are routinely different airlines. Reusing one link would make "whose cargo"
// and "who carries it next" the same column.
Aviation_Pfm_Line.belongsTo(Aviation_Carrier, { as: 'slCarrier', foreignKey: 'slCarrierId' });
// The registered number, when the planned AWB was taken out of stock. Nullable
// for the same reason it is on a consignment: the register is not
// retrospective. belongsTo only - Aviation_Awb already hasMany the
// consignments, and a second unaliased hasMany from it would collide.
Aviation_Pfm_Line.belongsTo(Aviation_Awb, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});

module.exports = { Aviation_Job, Aviation_Consignment, Aviation_Carrier, Aviation_Aircraft, Aviation_Awb, Aviation_Pfm, Aviation_Pfm_Line };
