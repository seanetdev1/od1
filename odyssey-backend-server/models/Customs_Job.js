const { auditAttributes } = require('../functions/auditStamps');

// A customs job: ONE GOODS DECLARATION.
//
// The declaration IS the job. A clearing agent's unit of work is a GD - it is
// what gets filed, what carries the duty, what the client asks about by
// number, and what the agency fee is charged against. A part shipment or an
// Into-Bond/Ex-Bond pair files a second GD, and that is a second job here,
// repeating the few consignment fields it shares. That duplication is the
// price of the flat shape, and it buys a list, an editor and a charge sheet
// with no child grid in any of them.
//
// Deliberately a separate table from SE_Job rather than a mode flag on it, for
// the same reason Aviation_Job is: a clearance file's header is a different
// document. It has no booking, no vessel schedule, no loading program and no
// B/L of its own - it names someone else's B/L - while every field that
// matters here (GD number, channel, assessed value, duty) has nowhere to live
// on a freight job. Bolting them on would mean every freight screen, report
// and query had to learn about columns that are meaningless to it. A separate
// table costs a little duplication and buys total isolation: nothing here can
// change how a sea or air freight job behaves.
//
// CHARGES ARE NOT HERE. A customs charge is a Charge_Head - the same shared
// table the freight and aviation sides use - hanging off this job via
// Charge_Heads.CustomsJobId. That is what lets invoicing, the ledger, payments
// and ageing work with no customs-specific branch anywhere.
//
// New table, so ODYSSEY_DB_SYNC=create (the default) creates it on boot -
// CREATE TABLE IF NOT EXISTS. There is no migration script to run for the
// table itself; existing databases need scripts/addCustomsChargeHeadLink.js
// for the Charge_Heads column that points at it.
module.exports = (sequelize, DataTypes) => {
    const Customs_Job = sequelize.define("Customs_Job", {
        // Document number, e.g. SNS-CCJ-1/26. Assigned on create.
        jobNo:   { type:DataTypes.STRING },
        jobId:   { type:DataTypes.INTEGER },

        // WHAT KIND OF CLEARANCE THIS IS.
        //
        // direction is Import or Export; transportMode is Sea, Air or Land.
        // Two fields rather than one combined code because they vary
        // independently - an export can move by any of the three - and because
        // the list filters on each separately. Whitelisted in the route, not
        // here: a check constraint would need a migration every time a mode is
        // added, and the route already has to validate the payload anyway.
        direction:     { type:DataTypes.STRING, defaultValue:'Export' },
        transportMode: { type:DataTypes.STRING, defaultValue:'Sea' },

        // THE DECLARATION.
        //
        // gdNumber is the machine number the customs system issues (in
        // Pakistan, WeBOC/PSW - e.g. KAPW-HC-123456-19-08-2026). Stored as
        // typed: the format differs by collectorate and by country, and
        // parsing it would only ever reject a number that is genuinely on a
        // filed document.
        gdNumber:      { type:DataTypes.STRING },
        gdDate:        { type:DataTypes.STRING },
        // Home Consumption / Into-Bond / Ex-Bond / Export / Re-Export /
        // Transhipment. Decides what the duty figures below even mean - an
        // Into-Bond GD defers them - so the list shows it next to the number.
        gdType:        { type:DataTypes.STRING },
        // Green / Yellow / Red / Blue: the assessment channel the declaration
        // was selected into. It is the single best predictor of how long a
        // file will take (Green clears without examination, Red is physical
        // examination), which is why it earns a column of its own.
        channel:       { type:DataTypes.STRING },
        // The customs station / collectorate the GD was filed at. Free text
        // rather than a master table: the list of stations is short, stable
        // and different in every country, and a master nobody maintains is
        // worse than a typed value that at least says what was on the GD.
        collectorate:  { type:DataTypes.STRING },

        // THE CONSIGNMENT THE GD IS AGAINST.
        //
        // Someone else's transport document - the carrier's B/L or the
        // airline's AWB. A clearing agent never issues one, so this is a
        // reference, not a record: there is no Bl row behind it.
        blNo:          { type:DataTypes.STRING },
        blDate:        { type:DataTypes.STRING },
        // Vessel name or flight number, whichever transportMode says. One
        // field, because a job is never both, and two would leave one of them
        // permanently blank on every row.
        vesselOrFlight:{ type:DataTypes.STRING },
        voyageNo:      { type:DataTypes.STRING },
        // Import General Manifest number and the index of this consignment
        // within it. The GD is filed against them, so a clearing agent quotes
        // them as often as the GD number itself.
        igmNo:         { type:DataTypes.STRING },
        indexNo:       { type:DataTypes.STRING },
        // Port codes, the same shape SE_Job stores in pol/pod - a code, not an
        // id - so a clearance file and a freight job describe a route
        // identically and no foreign key is needed.
        pol:           { type:DataTypes.STRING },   // port of loading
        pod:           { type:DataTypes.STRING },   // port of discharge
        // Port of final destination - where the goods are ultimately bound,
        // which is not always where they are discharged. Recorded on 7,414 of
        // CargoLinkers' 15,364 clearing jobs (legacy Log_Job.POFDCode) and had
        // nowhere to land before, so it was dropped on every one of them.
        // Stored as the UN/LOCODE, like pol and pod.
        pofd:          { type:DataTypes.STRING },   // port of final destination

        // ---------------------------------------------------------------
        // FIELDS THE LEGACY DATA CARRIES.
        //
        // This module was designed before anyone had read a real clearing
        // agent's database, so its shape is what we thought a declaration
        // needed rather than what one records. These nine are columns Log_Job
        // populates that had nowhere to land, in order of how much of the book
        // they cover. The model changes to fit the data, not the reverse.
        // ---------------------------------------------------------------

        // The CLIENT'S own reference - what a customer quotes when they ring
        // up about their shipment. 11,468 of 15,364 jobs (75%), and nearly all
        // distinct. The single most-used field that had no home.
        clientRef:     { type:DataTypes.STRING },
        // The agent's own file reference, distinct from jobNo. 58%.
        jobRef:        { type:DataTypes.STRING },
        // The customs house file number, in the agent's own numbering. 15%.
        customFileNo:  { type:DataTypes.STRING },

        // Where the goods were actually delivered. Free text in the source -
        // Log_Job.DeliveryLocationId is populated on 3 rows out of 15,364, so
        // the address is the real record. 79%.
        deliveryLocation: { type:DataTypes.TEXT },
        // The terminal the container was handled at - QICT, SAPT, KICT, AFU.
        // 76%, 15 distinct. Stored as the name, not the legacy id.
        terminal:      { type:DataTypes.STRING },
        // LCL / FCL / General Cargo. 76%.
        cargoType:     { type:DataTypes.STRING },
        // Net weight. grossWeight was already here; this is the other half,
        // and it is what duty is often assessed on. 57%.
        netWeight:     { type:DataTypes.DOUBLE },
        // FOB, CIF, EX WORKS... 30%, and it determines how the customs value
        // is built up, so it belongs on a declaration.
        incoTerms:     { type:DataTypes.STRING },
        // The carrier's booking reference. 24%.
        carrierBookingNo: { type:DataTypes.STRING },

        // WHY a cancelled file was cancelled. 116 jobs carry one, and it is
        // specific - "Duplicate job TP-643/25" - but the migration read it
        // only to decide the `canceled` boolean below and then dropped the
        // text, so the one thing anybody would want to know was lost.
        cancelReason:  { type:DataTypes.STRING },
        // When the declaration was approved. 95% of the book. `approved` was
        // already here as a flag; this is when it happened.
        approvedOn:    { type:DataTypes.STRING },
        // A second reference, distinct from jobRef and clientRef. 7%.
        projectRef:    { type:DataTypes.STRING },
        // A note carried on the file about its invoicing. 5%.
        invoiceRemarks:{ type:DataTypes.TEXT },
        // Gross and net registered tonnage of the carrying vessel. 2.7%, but
        // real: 392 distinct values, and nothing else in the model records it.
        grt:           { type:DataTypes.DOUBLE },
        nrt:           { type:DataTypes.DOUBLE },

        // Which cost centre the file belongs to. Set on all 15,364 legacy jobs,
        // and constant at "HEAD OFFICE" (code HO) because CargoLinkers runs
        // from one - GL_PropertiesLOV holds exactly two rows.
        //
        // Carried even though it never varies HERE: it is a real field on the
        // file, another install will have several, and the alternative is the
        // reports inventing one. functions/customsJobPL.js used to report ''
        // for this with a note saying a clearance file has no equivalent; it
        // does.
        costCenter:    { type:DataTypes.STRING },

        // ---------------------------------------------------------------
        // FIELDS THE LEGACY FORM HAS AND THIS ONE DID NOT.
        //
        // Read off the legacy app's own field definitions and then checked
        // against four real jobs and the whole table. Each is on a meaningful
        // share of the book; percentages are of 15,364 clearing jobs.
        // ---------------------------------------------------------------

        // The MASTER bill of lading, as distinct from the house B/L in blNo.
        // We had one B/L field where the legacy form has two, so on the 4,057
        // jobs carrying both the master had nowhere to go. 26%.
        mblNo:         { type:DataTypes.STRING },
        mblDate:       { type:DataTypes.STRING },

        // The export counterpart of a GD. Already read to infer direction -
        // it is 99.9% predictive of an export - and then thrown away. 12%,
        // nearly all distinct, and a number a clerk searches by.
        shippingBillNo:   { type:DataTypes.STRING },
        shippingBillDate: { type:DataTypes.STRING },

        // Gate pass. 94% of the book and 535 distinct dates - one of the
        // best-covered fields in the whole legacy table, and it had no
        // equivalent here at all.
        gpDate:        { type:DataTypes.STRING },

        // Container type, and the delivery terms the container moves under
        // (CY/CY, CY/DR, DR/CY, DR/DR - Gen_DeliveryType). 85% and 100%.
        containerType: { type:DataTypes.STRING },
        deliveryTerms: { type:DataTypes.STRING },

        // ---------------------------------------------------------------
        // THE FIELDS THE EXISTING GD ENTRY SCREEN HAS.
        //
        // CargoLinkers already ran a version of this (Odyssey-FE-CC, commit
        // "Cargo job") and their director asked for that screen back. These
        // are the four of its fields this table had no column for. Everything
        // else on it already maps onto a column above.
        // ---------------------------------------------------------------

        // "Local Vendor" and "Freight Forwarder (CHA/CHB)" on that screen -
        // two more parties on the file, alongside client and consignee.
        localVendorId: { type:DataTypes.INTEGER },
        chaChbId:      { type:DataTypes.INTEGER },
        // The carrier, and the date it sailed or flew.
        shippingLineId:{ type:DataTypes.INTEGER },
        sailingDate:   { type:DataTypes.STRING },

        // ---------------------------------------------------------------
        // THE PROGRAM BOOK'S FIELDS.
        //
        // A planned job (Customs_Plan) is kept in the client's program book
        // layout, and three of its columns had no home on a job. They arrive
        // with the plan when it is moved, and stay editable on the job, which
        // is the record from then on.
        // ---------------------------------------------------------------

        // When the container went through the port gate, and the carrier's
        // cut-off for the sailing. 'YYYY-MM-DD HH:mm'.
        gateInTime:    { type:DataTypes.STRING },
        cutOff:        { type:DataTypes.STRING },
        // Where the shipment has got to, in the agent's own words - "Gate In",
        // "Loaded". Free text, and NOT `status` below, which is the fixed list
        // the job lists and counts are filed by.
        currentStatus: { type:DataTypes.STRING },

        // Booking Info, as their screen has it.
        jobDate:       { type:DataTypes.STRING },
        // "Booked" / etc - the booking's own state, distinct from `status`
        // which is where the CLEARANCE has got to.
        jobType:       { type:DataTypes.STRING },
        // Shipping register page number.
        regPageNo:     { type:DataTypes.STRING },
        etaDate:       { type:DataTypes.STRING },   // as scheduled
        arrivalDate:   { type:DataTypes.STRING },   // as it actually happened
        deliveryDate:  { type:DataTypes.STRING },   // out of the port

        packages:      { type:DataTypes.INTEGER },
        pkgUnit:       { type:DataTypes.STRING },
        grossWeight:   { type:DataTypes.DOUBLE },
        // Container numbers as typed, e.g. "MSKU1234567, TGHU7654321". Free
        // text rather than rows: a clearance file quotes them, it does not
        // manage them - equipment control belongs to the carrier and to the
        // freight job that has SE_Equipments for exactly this.
        containers:    { type:DataTypes.TEXT },

        // THE COMMERCIAL DOCUMENTS.
        //
        // The supplier's invoice, which is what the customs value is declared
        // from. invoiceValue is in invoiceCurrency; exRate below converts it.
        invoiceNo:       { type:DataTypes.STRING },
        invoiceDate:     { type:DataTypes.STRING },
        invoiceValue:    { type:DataTypes.DOUBLE },
        invoiceCurrency: { type:DataTypes.STRING },
        lcNo:            { type:DataTypes.STRING },
        // Financial instrument reference (Form-E for an export, contract or
        // bank reference for an import). One field: it is quoted, never
        // computed on.
        formENo:         { type:DataTypes.STRING },

        // DUTY AND TAXES ARE NOT HERE. They live on Customs_Duty, one row per
        // item on the declaration, holding the RATES rather than the amounts -
        // which is how a GD is actually assessed and how the legacy system
        // (Log_DutyCalculation) records it. See that model, and
        // functions/customsDuty.js for the cascade that turns a rate into
        // money.
        //
        // This field is the one duty-side figure that belongs on the header:
        // the declaration's total customs value as the FILE states it. Each
        // duty line carries its own assessedValue for the item it covers, and
        // the two are allowed to disagree - the lines are what customs
        // assessed, this is what the file says. Note it is NOT invoiceValue:
        // customs assesses on its own valuation, and the gap between the two
        // is the thing an importer argues about.
        assessedValue:       { type:DataTypes.DOUBLE },

        // PAYMENT OF THE ABOVE.
        //
        // psid is the payment slip ID the duty is paid against. dutyPaidBy is
        // 'Client' or 'Agent' and is the question the accounts department
        // actually asks: duty the agent paid is money to be reimbursed and
        // must appear as a charge on the invoice, duty the client paid
        // directly is not the agent's money at all. Recording it here is what
        // stops the two being confused six weeks later.
        psid:          { type:DataTypes.STRING },
        dutyPaidDate:  { type:DataTypes.STRING },
        dutyPaidBy:    { type:DataTypes.STRING },

        // Open / Cleared / Canceled. Deliberately NOT a milestone chain -
        // filed, assessed, examined, out-of-charge and so on are dates on a
        // GD, and modelling them as states here would mean a status that is
        // wrong whenever the app is a step behind the customs system. This
        // says only whether the file is still being worked on. Distinct from
        // the `canceled` flag below, which is what the Cancel Job button sets.
        status:        { type:DataTypes.STRING, defaultValue:'Open' },
        // WHAT WAS DECLARED, in the filer's own words.
        //
        // Distinct from CommodityId, and not a substitute for it: the FK points
        // at the commodity master, this is the free text on the file. On
        // CargoLinkers it is the ONLY record of the goods - every one of the 33
        // tables referencing Gen_Commodity is empty, so no clearing job there
        // names a commodity, while 9,094 of 15,364 carry a description here
        // ("GARMENTS", "DENIM FABRICS", "ZIPPER").
        //
        // It had nowhere to land before, so the migration folded it into
        // `remarks` as a fallback - which silently dropped it on the 511 jobs
        // that had both.
        goodsDescription: { type:DataTypes.TEXT },

        remarks:       { type:DataTypes.TEXT },

        companyId:     { type:DataTypes.STRING },
        exRate:        { type:DataTypes.STRING,  defaultValue:"1" },
        approved:      { type:DataTypes.STRING,  defaultValue:"0" },
        canceled:      { type:DataTypes.BOOLEAN, defaultValue:false },

        // The legacy Log_Job.Id this declaration came from. Every migrated
        // table carries one - Customs_Duty and Customs_Container already did -
        // and this parent was the one that did not.
        //
        // WITHOUT IT THE MIGRATION CANNOT RUN AT ALL. The receiver asks
        // `SELECT "climaxId" FROM "Customs_Jobs" WHERE "climaxId" IS NOT NULL`
        // to find what is already imported, and Sequelize passes an undeclared
        // attribute straight through to the SELECT - so both /lgJobMigration
        // /plan and /apply failed with 42703 on their first batch, as did the
        // clearing charge lines, which resolves a line's parent the same way.
        // The pure-function tests could not see it: they never touch a
        // database, and this is the seam where the mapping meets one.
        //
        // It is also what makes a re-run idempotent and what the reconciliation
        // against the legacy row counts matches on - /migration/counts reports
        // `withClimaxId` as null for any model lacking it, which quietly turned
        // the customs reconcile into a comparison against total rows.
        climaxId:      { type:DataTypes.BIGINT },
        // Who entered the job and who last changed it - functions/auditStamps.
        ...auditAttributes(DataTypes),
    }, {
        // ClientId, shipperId, consigneeId and CommodityId are worth indexing
        // too, but they are attached by the association file rather than
        // declared above - so naming them here would have sync() reach CREATE
        // INDEX on a table that does not have those columns yet (CREATE TABLE
        // IF NOT EXISTS is a no-op on a table created before the associations
        // existed). That throws, and sequelize.sync() runs models SEQUENTIALLY
        // and stops at the first failure, so every model after this one would
        // be silently skipped - a missing index taking the whole schema down
        // with it. The same trap Aviation_Consignment documents.
        indexes: [
            { fields: ["companyId"] },
            { fields: ["jobNo"] },
            { fields: ["gdNumber"] },
            { fields: ["blNo"] },
            { fields: ["direction"] },
            { fields: ["createdAt"] },
            // NO INDEX ON climaxId, deliberately - and it is tempting, so:
            //
            // The column above is added to an EXISTING database by the
            // CUSTOMS_MODELS alter pass in models/index.js, which runs AFTER
            // the bulk sequelize.sync(). Naming an index here makes that
            // earlier pass reach CREATE INDEX on a table whose climaxId column
            // does not exist yet, which throws - and sync() runs models
            // sequentially and stops at the first failure, so every model
            // after this one is skipped. Exactly the trap described for the
            // association columns above, and it costs the whole schema.
            //
            // It is also not needed. Nothing looks a declaration up BY legacy
            // id: both readers (the migration receiver and the charge-line
            // context builder) select every row once and build a Map in
            // memory, so an index would serve two full scans of 15,364 rows
            // per run and nothing else. If one is ever wanted, add it as
            // CREATE INDEX IF NOT EXISTS in a deploy delta, not here.
        ]
    })
    return Customs_Job;
}
