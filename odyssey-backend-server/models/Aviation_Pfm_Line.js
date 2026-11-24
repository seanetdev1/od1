// One planned consignment on a PFM.
//
// A DELIBERATELY SHORTER Aviation_Consignment. The flight's consignment row
// carries twenty-odd columns because it has to price and invoice the AWB; a
// plan carries eleven, because the questions a plan answers are only: whose
// cargo, on which air waybill, going where, roughly how much, and how it is to
// be loaded.
//
// WHAT IS NOT HERE, AND WHY:
//
//   shipper / consignee     the flight names them. A plan is agreed with the
//                           MASTER AGENT, who is the party the airline deals
//                           with; the parties behind the agent are known by
//                           the time the AWB is made out, not before.
//   rates, ex-rates         a plan does not price anything.
//   offload, carriedForward a plan describes cargo that has not flown, so
//                           there is nothing it can have failed to carry.
//   approved, closed, direct all of them are states of a REAL consignment.
//
// WHAT IS HERE THAT THE FLIGHT HAS NOT: the SECOND LEG. slCarrierId and
// slFlightNo record the onward carriage this cargo is booked onto after it
// lands - which is planning information, settled before departure, and the
// reason a piece of cargo is on this aircraft at all. It stays on the plan:
// the flight's consignment grid is not given these two columns, so the import
// does not carry them across, and the flight screen's View PFM button is how
// the onward booking is read back. Recording it in both places would give the
// office two second legs to keep in step and no rule for which one is right.
module.exports = (sequelize, DataTypes) => {
    const Aviation_Pfm_Line = sequelize.define("Aviation_Pfm_Line", {
        // Ordering within the PFM, so the list reads the way it was built
        // rather than by insertion id. Same contract as
        // Aviation_Consignment.sortOrder, and the import relies on it: a
        // flight's lines come out in the order the plan put them in.
        sortOrder:        { type:DataTypes.INTEGER, defaultValue:0 },

        // The 8 digits printed on the document - serial plus check digit. The
        // 3-digit prefix is NOT stored per line: it belongs to the carrier,
        // exactly as on Aviation_Consignment, so the two tables spell an AWB
        // the same way and a number can be matched across them.
        //
        // AviationAwbId (the register row it came out of) and
        // AviationCarrierId (whose cargo it is) are attached by the
        // association file.
        awb:              { type:DataTypes.STRING },

        // Where this cargo is going. The header has no destination - see the
        // note on the PFM model - so this is the only place a route is
        // recorded, as the airport CODE rather than a foreign key, matching
        // how Aviation_Consignment and the freight air jobs store one.
        destination:      { type:DataTypes.STRING },

        /* ------------------------- the second leg -------------------------
         * Who carries this cargo onward, and on what flight.
         *
         * slCarrierId is a registered Aviation_Carrier - the same master the
         * line's own carrier is picked from, aliased so the two cannot be
         * confused. AviationCarrierId is whose cargo this is; slCarrier is who
         * flies it after we do, and they are routinely different airlines.
         *
         * slFlightNo is free text on purpose. It is ANOTHER airline's flight
         * number, off their schedule - there is nothing in this system for it
         * to be picked from, and inventing a master of other carriers'
         * flights would be a list nobody maintains.
         * --------------------------------------------------------------- */
        slFlightNo:       { type:DataTypes.STRING },

        // THE PLANNED FIGURES. What the agent says is coming, before anything
        // is weighed on the day.
        //
        // These are the three the import deliberately does NOT carry onto the
        // flight. A plan's weights are an expectation and a flight's are a
        // measurement, and copying the first into the second would put a
        // figure nobody weighed onto a document that gets invoiced. The
        // TOTAL chargeable weight does cross over, into the flight's PFM
        // field, which is precisely what that field has always been: the
        // planned figure for the flight.
        pieces:           { type:DataTypes.INTEGER },
        grossWeight:      { type:DataTypes.DOUBLE },
        chargeableWeight: { type:DataTypes.DOUBLE },

        // How this consignment is to be loaded - build-up, pallet positions,
        // "tail first", "keep dry". The operational note the loading team
        // reads off the plan. Labelled Load Plan on screen; stored under its
        // own name rather than `remarks` because it is an instruction, and the
        // import puts it into the flight consignment's Remarks where the
        // flight has nowhere else for it to go.
        loadPlan:         { type:DataTypes.TEXT },
    }, {
        // Only DECLARED columns may be indexed here - AviationPfmId,
        // AviationCarrierId, masterAgentId and the rest are attached by the
        // association file, and indexing an undeclared column can reach
        // CREATE INDEX on a table that does not have it yet. sync() runs
        // models sequentially and stops at the first failure, so one bad index
        // silently skips every model after it. Same trap, and the same
        // comment, as Aviation_Consignment.
        indexes: [
            { fields: ["awb"] },
        ]
    })
    return Aviation_Pfm_Line;
}
