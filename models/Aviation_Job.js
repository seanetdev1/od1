const { auditAttributes } = require('../functions/auditStamps');

// An aviation job: one FLIGHT.
//
// Deliberately a separate table from SE_Job rather than a mode flag on it. An
// airline's job is shaped differently at the root - a flight has no single
// client, commodity, weight or volume, because it carries many consignments
// for many customers (see Aviation_Consignment). Bolting that onto SE_Job
// meant every existing screen, report and query had to learn about a job whose
// header fields are meaningless, and the freight installs had to be protected
// from it everywhere. A separate table costs a little duplication and buys
// total isolation: nothing here can change how a sea or air freight job
// behaves.
//
// New table, so ODYSSEY_DB_SYNC=create (the default) creates it on boot -
// CREATE TABLE IF NOT EXISTS. There is no migration script to run.
module.exports = (sequelize, DataTypes) => {
    const Aviation_Job = sequelize.define("Aviation_Job", {
        // Document number, e.g. IFA-AVJ-1/26. Assigned on create.
        jobNo:         { type:DataTypes.STRING },
        jobId:         { type:DataTypes.INTEGER },

        // The flight itself.
        //
        // The operating AIRLINE is operatingCarrierId, attached by the
        // association file - a registered Aviation_Carrier, aliased so it
        // cannot be mistaken for the carrier on a consignment. That one says
        // whose cargo an AWB is; this one says whose flight it is, and one
        // airline's flight regularly carries another's AWBs.
        flightNo:      { type:DataTypes.STRING },
        // The aircraft is AviationAircraftId, attached by the association -
        // a registered record, not the free text this used to be. The report
        // splits every sector by aircraft, and typed values split one
        // aircraft's month across "A330", "A-330" and "a330".
        origin:        { type:DataTypes.STRING },   // airport of departure
        destination:   { type:DataTypes.STRING },   // airport of arrival
        flightDate:    { type:DataTypes.STRING },
        departureDate: { type:DataTypes.STRING },

        // ETD AND ATD - when the flight was scheduled to leave, and when it
        // actually did. Two fields rather than one, because the gap between
        // them is the delay, and a single "departure time" overwritten on the
        // day destroys the only record that there was one.
        //
        // departureTime IS THE ATD, under its old name, and the name is
        // deliberately left alone. This table is reconciled by the aviation
        // alter-sync on every boot, and alter DROPS a column no model
        // declares - so renaming the attribute to `atd` would land as "add
        // atd, drop departureTime" and take every past flight's departure time
        // with it. What people read is the label on the screen; what the data
        // lives in is the column name, and only the first of those was worth
        // changing. Same trap as the five legacy load figures below.
        etd:           { type:DataTypes.STRING },
        departureTime: { type:DataTypes.STRING },   // the ATD

        // Operated / Canceled / Nill. Distinct from the `canceled` flag below,
        // which is what the Cancel Flight button sets - see the note there.
        //
        // OPERATED WAS SPELLED 'Active' UNTIL 1.2.2. Only 'Canceled' is ever
        // branched on, so the rename touches nothing here - but the value is
        // stored as it is displayed, so flights saved before the change still
        // hold 'Active'. The screens read that as Operated (see the frontend's
        // functions/aviationStatus), which is why no migration is required;
        // ifa-deploy/1.2.2-operated-status.sql tidies the stored values if you
        // would rather they all agreed.
        status:        { type:DataTypes.STRING, defaultValue:'Operated' },

        // LOAD FIGURES.
        //
        // Only PFM is still written. It is a PLAN - the figure the flight was
        // scheduled to carry - so there is nothing on the flight to derive it
        // from, which is exactly why the others no longer live here:
        //
        //   erUplift / ifaLoads / otherCarrier   counted off the consignments
        //       by each carrier's ER/IFA/Other tag. A flight's uplift IS its
        //       AWBs, so a typed total could disagree with them.
        //
        //   erOffload / otherOffload             moved to the AWB. An offload
        //       happens to a particular consignment, and as two figures here
        //       they named no cargo and reconciled against nothing. See
        //       Aviation_Consignment.offload.
        //
        // THE FIVE COLUMNS ARE KEPT, not dropped. ODYSSEY_AVIATION_SYNC alters
        // these tables on every boot and alter DROPS what the model stops
        // declaring - so removing them here would delete the figures already
        // recorded against past flights. Nothing writes them any more; they
        // are history, and reading one is reading what someone typed before
        // the figures moved.
        pfm:           { type:DataTypes.DOUBLE },

        // PLA - the payload AVAILABLE for this flight, in kg.
        //
        // Typed per flight rather than read off the aircraft, even though
        // Aviation_Aircraft.maxPayload exists: max payload is what the airframe
        // can lift, while the payload available on the day is what is left
        // after fuel for the route, the temperature and any restriction - the
        // same aircraft leaves with a different figure on different sectors.
        // Recording the aircraft's maximum against every flight would make
        // PLA - PFM read as spare capacity that was never really there.
        //
        // Blank on every flight entered before this release, and blank is
        // honest: nobody typed it. It is not backfilled from maxPayload for
        // the reason above.
        pla:           { type:DataTypes.DOUBLE },

        erUplift:      { type:DataTypes.DOUBLE },
        erOffload:     { type:DataTypes.DOUBLE },
        ifaLoads:      { type:DataTypes.DOUBLE },
        otherCarrier:  { type:DataTypes.DOUBLE },
        otherOffload:  { type:DataTypes.DOUBLE },

        remarks:       { type:DataTypes.TEXT },

        companyId:     { type:DataTypes.STRING },
        exRate:        { type:DataTypes.STRING,  defaultValue:"1" },

        /* ----------------------------- CHARTER -----------------------------
         * The whole aircraft sold as one deal, rather than AWB by AWB.
         *
         * On an ordinary flight each consignment is priced on its own. On a
         * charter one buying rate, one selling rate and one conversion govern
         * the load - so they are recorded here, on the flight, and copied down
         * onto the AWBs they reach.
         *
         * WHICH AWBs THEY REACH: only those whose carrier is this flight's
         * operatingCarrierId. A chartered aircraft still carries other
         * carriers' AWBs alongside the chartered load, and those are separate
         * deals at their own rates.
         *
         * PRE-FILLED, NOT IMPOSED. The figures are copied onto the matching
         * consignments, which remain editable - a rebate or a short-shipped
         * leg has to stay expressible without turning the charter off. So the
         * consignment's own rate is always what prices its charges; these four
         * are where that rate came from, not a second source of truth the
         * pricing has to consult.
         *
         * ONE EX-RATE PER SIDE, exactly as a consignment carries. Chartering
         * an aircraft and selling the space on it are two transactions: the
         * aircraft is very often bought in dollars and the space sold in
         * rupees, and even in one currency the two are struck on different
         * days. A single conversion for both would put the difference between
         * those two rates straight into the reported margin - which is the
         * same fault the per-AWB pair was split to fix, and it would matter
         * more here because a charter's figures reach every AWB on the load.
         * ------------------------------------------------------------------ */
        charter:              { type:DataTypes.BOOLEAN, defaultValue:false },
        charterBuyingRate:    { type:DataTypes.DOUBLE },
        charterSellingRate:   { type:DataTypes.DOUBLE },
        charterBuyingExRate:  { type:DataTypes.DOUBLE, defaultValue: 1 },
        charterSellingExRate: { type:DataTypes.DOUBLE, defaultValue: 1 },
        approved:      { type:DataTypes.STRING,  defaultValue:"0" },
        canceled:      { type:DataTypes.BOOLEAN, defaultValue:false },
        // Who entered the job and who last changed it - functions/auditStamps.
        ...auditAttributes(DataTypes),
    }, {
        indexes: [
            { fields: ["companyId"] },
            { fields: ["jobNo"] },
            { fields: ["flightNo"] },
            { fields: ["createdAt"] },
        ]
    })
    return Aviation_Job;
}
