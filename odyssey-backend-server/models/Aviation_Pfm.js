// A PFM: the PRE-FLIGHT MANIFEST, raised before the aircraft goes.
//
// WHAT IT IS AND WHY IT IS NOT AN Aviation_Job. A PFM is the PLAN - the load
// the flight is being built to carry, agreed with the master agents days
// before anything is weighed. An Aviation_Job is the OUTCOME: what actually
// left, what was offloaded, what is billed. The two were one table for exactly
// as long as it took to notice that the plan has to exist before the flight
// does, has no charges, no invoices and no offloads, and stops changing the
// moment the flight is entered - while the flight goes on being corrected for
// weeks afterwards.
//
// So the flight is created FROM the PFM and points back at it
// (Aviation_Job.AviationPfmId), and neither one can be edited into the other.
// The planned figures stay readable next to what really happened, which is the
// only way anyone can ask why a flight carried 4 tonnes against a 6-tonne
// plan.
//
// NO CONSIGNEE, NO SHIPPER, NO RATES, NO OFFLOAD. A plan names the agent whose
// cargo is expected and what it is; who it is ultimately for and what it costs
// are the flight's business, and duplicating them here would give the office
// two places to correct a consignee and no rule for which one wins.
//
// New table, so the aviation alter-sync creates it on boot - it is listed in
// AVIATION_MODELS in models/index.js. There is no migration script to run.
module.exports = (sequelize, DataTypes) => {
    const Aviation_Pfm = sequelize.define("Aviation_Pfm", {
        // Document number, e.g. IFA-PFM-1/26. Assigned on create, from the
        // same per-company per-fiscal-year sequence machinery that numbers a
        // flight - so a PFM and a job read as documents of one system.
        pfmNo:         { type:DataTypes.STRING },
        pfmId:         { type:DataTypes.INTEGER },

        // The flight this plan is FOR, as the schedule names it. Typed here
        // and nowhere else: this is the one place in the aviation module where
        // a flight number is entered by hand, because the flight screen picks
        // its number off a PFM rather than accepting one. See the selector in
        // the frontend's AviationJobs/CreateOrEdit.
        flightNo:      { type:DataTypes.STRING },

        // The operating AIRLINE is operatingCarrierId, attached by the
        // association file - the same aliased link Aviation_Job carries, and
        // it answers the same question: whose flight this is, NOT whose cargo
        // each AWB on it is.
        //
        // The aircraft is AviationAircraftId, also attached by the
        // association. A registered record rather than typed text, for the
        // reason given on Aviation_Job: the reports split by aircraft, and
        // typed values split one airframe's month across three spellings.
        origin:        { type:DataTypes.STRING },   // airport of departure

        // NO DESTINATION ON THE HEADER, deliberately. One departure serves
        // many destinations - that is what a consolidated flight is - so the
        // destination belongs on each line and asking it here would be asking
        // for one of them to stand for all.
        flightDate:    { type:DataTypes.STRING },

        // Draft / Confirmed / Cancelled - the life of a PLAN, not of a
        // flight. See functions/aviationPfmStatus, which is the one place that
        // knows these and the one place that decides which of them may be
        // picked on a flight.
        //
        // Stored as it is displayed, exactly as Aviation_Job.status is, so a
        // value read off the database is the value on screen.
        status:        { type:DataTypes.STRING, defaultValue:'Draft' },

        remarks:       { type:DataTypes.TEXT },

        companyId:     { type:DataTypes.STRING },
    }, {
        indexes: [
            { fields: ["companyId"] },
            { fields: ["pfmNo"] },
            { fields: ["flightNo"] },
            // The flight selector asks for future, confirmed, unused PFMs, and
            // the date is the most selective half of that.
            { fields: ["flightDate"] },
            { fields: ["createdAt"] },
        ]
    })
    return Aviation_Pfm;
}
