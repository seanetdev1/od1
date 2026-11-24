// One consignment on a flight: an AWB, whose it is, and what it weighs.
//
// This is the repeating part of an aviation job. A flight carries many of
// these - each for a different client, with its own commodity, weight and
// volume - which is exactly what the single-client SE_Job header could not
// express.
//
// ClientId and CommodityId are attached by the association file, not declared
// here, so they stay consistent with how the rest of the codebase links to
// Clients and Commodity.
module.exports = (sequelize, DataTypes) => {
    const Aviation_Consignment = sequelize.define("Aviation_Consignment", {
        awb:              { type:DataTypes.STRING },
        // Ordering within the flight, so the list reads the way it was entered
        // rather than by insertion id.
        sortOrder:        { type:DataTypes.INTEGER, defaultValue:0 },

        pieces:           { type:DataTypes.INTEGER },
        grossWeight:      { type:DataTypes.DOUBLE },
        // LEGACY, no longer collected. The consignment grid dropped the Volume
        // column - an airline prices off weight, and the cubic figure was one
        // more box that nothing downstream read. Vol. WT went the same way in
        // 1.2.2; see volumetricWeight below.
        //
        // Still DECLARED, deliberately. These tables are reconciled with
        // sync({alter:true}) on every boot (see models/index.js), and alter
        // DROPS a column the model stops declaring - which would take the
        // figures already recorded against live flights with it. The save path
        // no longer writes it, so existing rows keep what they have and new
        // ones get null.
        volume:           { type:DataTypes.DOUBLE },
        // LEGACY TOO, from 1.2.2. The grid dropped Vol. WT for the same reason
        // it had dropped Volume: an airline prices off weight, chargeable
        // weight is derived from gross and offload, and the volumetric figure
        // was a box nothing downstream read. Still DECLARED for the same
        // reason as `volume` above - alter-sync would DROP an undeclared
        // column and take the figures on live flights with it - and no longer
        // written, so existing rows keep what they have.
        volumetricWeight: { type:DataTypes.DOUBLE },
        chargeableWeight: { type:DataTypes.DOUBLE },

        // Cargo on this AWB that did NOT make the flight.
        //
        // Recorded per AWB rather than on the flight, where it used to be two
        // typed figures (ER Offload / Other Offload). An offload happens to a
        // consignment - a specific AWB gets left behind - so the flight was
        // the wrong level to hold it: the two figures there could not say
        // whose cargo it was, and nothing tied them to the AWBs they were
        // supposedly about.
        //
        // THE WEIGHTS, and how they relate:
        //
        //   grossWeight       the AWB's DOCUMENTED total. The same figure on
        //                     every leg of a split shipment, because it is what
        //                     the air waybill says - it is not "what this
        //                     flight took".
        //   carriedForward    what THIS leg was asked to carry, when that is
        //                     less than the whole AWB. Null on a first leg,
        //                     where the answer is grossWeight. See below.
        //   offload           the part of that which stayed on the ground.
        //   offloadPieces     the same event counted in packages. Recorded
        //                     because a manifest is reconciled in boxes as
        //                     well as kilos, and "300 kg left behind" does not
        //                     say how many pieces the warehouse still holds.
        //                     It prices NOTHING - only the weight feeds
        //                     chargeableWeight - so it is not part of the
        //                     arithmetic below.
        //   chargeableWeight  (carriedForward ?? grossWeight) - offload: what
        //                     flew, and so what is billed. Filled in by the
        //                     consignment grid whenever a driver changes.
        //
        // WHY carriedForward EXISTS. A 1,000 kg AWB is offloaded 300 kg. The
        // next flight carries that 300, and the grid copies the AWB's gross,
        // volume and volumetric weight forward, because they describe the
        // shipment and have not changed. Without somewhere to record the 300,
        // every sum over that second leg reads 1,000 - so the AWB reports
        // 1,700 kg carried out of 1,000, and a further offload on the second
        // leg would price against the wrong base.
        //
        // It is also what keeps Manifest and Uplift honest on the monthly
        // report: manifest sums what each flight was asked to take
        // (carriedForward ?? gross), uplift sums what actually left with it.
        offload:          { type:DataTypes.DOUBLE },
        offloadPieces:    { type:DataTypes.INTEGER },
        carriedForward:   { type:DataTypes.DOUBLE },

        /* ------------------------ closing the AWB ------------------------
         * This AWB is FINISHED, even though it was offloaded.
         *
         * The default reading of an offload is that the cargo is waiting for
         * the next aircraft, so the AWB stays on the outstanding-loads list
         * until a later leg carries it. That is right for most of them, and
         * wrong for the rest: perishables go back to the master agent once the
         * cold chain is broken, a shipper withdraws a booking, a shipment is
         * re-booked on another airline. Nothing is waiting, and the AWB would
         * otherwise sit on the list for ever - it only leaves it by being
         * fully carried.
         *
         * Ticked BY HAND, on the leg that left the cargo behind, because it
         * is a judgement about that shipment. It replaced an automatic rule
         * that closed every perishable commodity, which could say neither
         * "this perishable is still going" nor "these machine parts are not".
         *
         * It changes nothing about the money: the offload is still recorded,
         * the chargeable weight is still what flew, and the charges are
         * untouched. All it decides is whether anything is still expected to
         * fly. See functions/aviationPendingLoads.
         * -------------------------------------------------------------- */
        awbClosed:        { type:DataTypes.BOOLEAN, defaultValue:false },

        /* ----------------------- approving the AWB -----------------------
         * The consignment has been checked against the air waybill, and its
         * AIR FREIGHT charge has been raised on both sides - what the airline
         * is paid to fly the cargo, and what the customer is billed to have it
         * flown.
         *
         * That charge is on every AWB, it is the reason the AWB exists, and it
         * is priced entirely off figures this row already holds: chargeable
         * weight times the buying rate on the payable side and the selling
         * rate on the receivable one. Typing it twice onto every consignment
         * was work with no decision in it, and the pairs that got missed were
         * only found when the flight would not reconcile.
         *
         * THE CHARGES ARE THE SUBSTANCE; THIS IS THE STATE. Un-approving
         * deletes them and re-approving raises them again from the AWB's
         * current figures, which is how a mispriced AWB is put right. The
         * screen is what raises and removes them (see the frontend's
         * functions/aviationChargeRow, so an automatic row and a hand-picked
         * one are built by one piece of code); they arrive here in the payload
         * as ordinary charge rows and are saved by saveCharges like any other.
         *
         * A DIRECT consignment is never approved - it is someone else's load
         * on someone else's air waybill, so there is nothing of ours to bill
         * and saveCharges clears anything left on it.
         * -------------------------------------------------------------- */
        awbApproved:      { type:DataTypes.BOOLEAN, defaultValue:false },

        // A DIRECT consignment: the airline was approached from outside to fly
        // someone else's load, on someone else's air waybill.
        //
        // It is on the flight, so it belongs in the manifest and the uplift -
        // the aircraft carried the weight, whoever sold it. But it is not our
        // business:
        //
        //   - the AWB is NOT ours, so it is typed rather than picked from
        //     Setup > AWB Stock, and no register row is claimed for it. The
        //     grid opens the field up when this is ticked.
        //   - there is nothing to bill, so the AWB never appears on the
        //     Charges tab, and the server clears any uninvoiced charge left on
        //     it rather than leaving one hidden but live.
        direct:           { type:DataTypes.BOOLEAN, defaultValue:false },

        // Pricing for this AWB. Charges are priced per kg, so the rate lives
        // here rather than on each charge line: every receivable on this AWB
        // is billed at sellingRate, every payable is costed at buyingRate, and
        // the margin is the spread between them.
        //
        // ONE EX-RATE PER SIDE. The space an AWB sells is not always bought in
        // the currency it is sold in, and even when it is, the rate it was
        // bought at and the rate it was sold at are struck on different days.
        // A single conversion for both reported a margin that was partly an
        // artefact of the exchange rate rather than of the deal - so a
        // receivable converts at sellingExRate and a payable at buyingExRate.
        //
        // Default 1 so a same-currency AWB needs no thought.
        buyingExRate:     { type:DataTypes.DOUBLE, defaultValue: 1 },
        sellingExRate:    { type:DataTypes.DOUBLE, defaultValue: 1 },
        // LEGACY: the single ex-rate that governed both sides before the
        // split. Still DECLARED so alter-sync does not drop it (see the note
        // on `volume` above), and still READ as the fallback when a
        // consignment entered before the split has neither of the two above -
        // that keeps every historic AWB pricing exactly as it did. The flight
        // form seeds the pair from it on load, so a row migrates itself the
        // first time it is saved.
        exRate:           { type:DataTypes.DOUBLE, defaultValue: 1 },
        buyingRate:       { type:DataTypes.DOUBLE },
        sellingRate:      { type:DataTypes.DOUBLE },

        /* --------------------- the reporting tag -------------------------
         * Which column of the monthly sector report THIS AWB counts toward -
         * GAM Uplift, IFA Loads or Other Carrier.
         *
         * AN OVERRIDE, AND NULL MEANS INHERIT. The tag normally comes from the
         * carrier (Aviation_Carrier.category), which is right for almost every
         * consignment: whose cargo it is answers which column it belongs in.
         * This column exists for the flights where it does not - a carrier
         * tagged GAM occasionally flying a load that belongs under Other, or a
         * consignment carrying somebody's cargo on a carrier that has not been
         * tagged at all.
         *
         * NULL rather than a copy of the carrier's tag, deliberately. Copying
         * it down at save time would freeze it: retagging a carrier in Setup
         * would then leave every AWB already flown still counting under the old
         * column, and the two would disagree with no way to tell which was
         * meant. Inheritance is computed at report time instead - see
         * functions/carrierCategory.tagFor, which is the one place that decides.
         *
         * Every consignment saved before this column existed is NULL, so they
         * all keep inheriting exactly as they did.
         * -------------------------------------------------------------- */
        reportingTag:     { type:DataTypes.STRING },

        origin:           { type:DataTypes.STRING },
        destination:      { type:DataTypes.STRING },
        natureOfGoods:    { type:DataTypes.STRING },
        remarks:          { type:DataTypes.TEXT },
    }, {
        // Only DECLARED columns may be indexed here.
        //
        // AviationJobId/ClientId/CommodityId would each be worth an index, but
        // they are attached by the association file, not declared above - so
        // sync() can reach CREATE INDEX on a table that does not have them yet
        // (CREATE TABLE IF NOT EXISTS is a no-op on a table created before the
        // associations existed). That throws, and sequelize.sync() runs models
        // SEQUENTIALLY and stops at the first failure, so every model after
        // this one is silently skipped - a missing index taking the whole
        // schema down with it.
        //
        // scripts/resetAviationTables.js creates those indexes explicitly,
        // after the table is known to have the columns.
        indexes: [
            { fields: ["awb"] },
        ]
    })
    return Aviation_Consignment;
}
