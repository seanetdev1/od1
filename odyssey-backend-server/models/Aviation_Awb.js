// One registered air waybill number.
//
// AWB STOCK. An airline allocates blocks of numbers to the agent, and this is
// the register of them: every number the office holds, which carrier issued
// it, and which master agent it has been given out to.
//
// Two rules the shape of this table enforces on its own, rather than leaving
// them to route code that could be bypassed:
//
//   ONE NUMBER, ONCE.  awbNumber is UNIQUE. An air waybill number identifies
//                      one shipment worldwide - prefix + serial + check digit
//                      - so it can exist in the register exactly once, and a
//                      second attempt to register it is a database-level
//                      failure rather than a duplicate row.
//
//   ONE MASTER AGENT.  masterAgentId is a single column (attached by the
//                      association file). A number cannot be assigned to two
//                      master agents because there is nowhere to put a second
//                      one - not because something remembered to check.
//
// There is deliberately NO status column. Whether a number has been used is
// answered by counting the consignments that point at it (see routes
// aviationJobs/awb.js), so it cannot drift out of step with reality when a
// flight is edited or deleted. Whether it has been assigned is answered by
// masterAgentId being set.
//
// VOIDING IS THE ONE EXCEPTION, and it is stored, because it is the one thing
// about a number that nothing else in the database knows. A paper air waybill
// gets torn, coffee-stained or misprinted, and the airline will not accept it
// however clean the register looks: that is a fact about a document in an
// office, not something derivable from the flights. voidedAt records it.
//
// A voided number is NOT deleted, which is the whole point of having it. The
// airline allocated that serial and will ask what became of it, and a number
// missing from the register reads as one never received. So it stays, marked,
// and stops being offered anywhere a number can be used.
//
// No companyId either: AWB stock is held by the office, not by one of its
// companies. Which company used a number is answered by the flight it is on.
module.exports = (sequelize, DataTypes) => {
    const Aviation_Awb = sequelize.define("Aviation_Awb", {
        // The carrier's IATA prefix, e.g. "214" for PIA. Copied from the
        // carrier at registration and held here as well so a number stays
        // readable - and searchable as one string - even if the carrier
        // record is later renamed. AviationCarrierId is the live link.
        prefix: {
            type: DataTypes.STRING(3),
            allowNull: false,
        },
        // The 7-digit running serial, zero padded and stored as TEXT so a
        // leading zero can never be lost to a numeric conversion.
        serial: {
            type: DataTypes.STRING(7),
            allowNull: false,
        },
        // IATA check digit = serial % 7, so always 0-6. See functions/awb.js.
        checkDigit: {
            type: DataTypes.STRING(1),
            allowNull: false,
        },
        // prefix + serial + checkDigit. Denormalised so that searching and the
        // uniqueness rule are each a single indexed column rather than a
        // three-way composite.
        awbNumber: {
            type: DataTypes.STRING(11),
            allowNull: false,
        },
        // When the number was handed to its master agent. Text, matching how
        // the rest of this module stores dates.
        assignedAt: {
            type: DataTypes.STRING,
        },
        createdById: {
            type: DataTypes.STRING,
        },
        remarks: {
            type: DataTypes.STRING,
        },
        // When the number was voided, or null for a usable one. This column
        // IS the void: a separate boolean could disagree with it, and "when"
        // is the question actually asked when the airline queries a serial.
        // Text, matching assignedAt and the rest of this module.
        voidedAt: {
            type: DataTypes.STRING,
        },
        // Why - torn, misprinted, lost in transit. Free text and required by
        // the route rather than by the column: a void with no reason is
        // useless six months later, but that is a rule about the act, and the
        // column also has to hold rows voided before it was enforced.
        voidReason: {
            type: DataTypes.STRING,
        },
        // Who did it. String, like createdById.
        voidedById: {
            type: DataTypes.STRING,
        },
    }, {
        // Only DECLARED columns may be indexed here.
        //
        // AviationCarrierId and masterAgentId would each be worth an index,
        // but they are attached by the association file, not declared above -
        // so sync() can reach CREATE INDEX on a table that does not have them
        // yet. That throws, and sequelize.sync() runs models SEQUENTIALLY and
        // stops at the first failure, so every model after this one is
        // silently skipped. Same trap documented on Aviation_Consignment.
        //
        // scripts/resetAviationTables.js creates those indexes explicitly,
        // after the columns are known to be present.
        indexes: [
            { name: "aviation_awbs_number_unique", unique: true, fields: ["awbNumber"] },
            { fields: ["prefix", "serial"] },
        ]
    })
    return Aviation_Awb;
}
