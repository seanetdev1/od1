// A PLANNED customs job - one row of the program book.
//
// A clearing agent's client sends its shipping program before any of it is
// real: shipper, invoice, containers, line, vessel, cut-off. The agent keeps
// it as a sheet (H.O. Enterprises' "PROGRAM BOOK 2026") and opens a job only
// once a shipment is confirmed. This table is that sheet, row for row, so the
// program can be kept here without spending job numbers on shipments that may
// never happen.
//
// A PLAN HAS NO JOB NUMBER. It gets one by being MOVED: /customsJob/plans/move
// creates a Customs_Job from it, numbered then, and points CustomsJobId at it.
// From that moment the plan is frozen - the job is the record to keep
// updating, and two editable copies would disagree with nothing to say which
// is right.
//
// Behind a switch: Configuration > Customs > Job planning (AppSetting
// 'customsPlanning'). Off, the routes refuse and the menu entry is hidden; the
// rows stay where they are.
//
// shipperId, shippingLineId and CustomsJobId are added by the association file
// - see functions/Associations/customsAssociations. NOT indexed here, for the
// reason Customs_Job gives: an index on a column the association adds makes
// sync() fail on a table created before the association existed.
module.exports = (sequelize, DataTypes) => {
    const Customs_Plan = sequelize.define("Customs_Plan", {
        // Pending / Confirmed / Cancelled - the sheet's JOB STATUS. Only a
        // Confirmed plan may be moved. "Moved" is NOT a status: it is a plan
        // with a CustomsJobId, so the two can never disagree. See
        // functions/customsPlan.
        status:        { type:DataTypes.STRING, defaultValue:'Pending' },

        // The sheet's columns, in its order. Free text where the sheet is
        // typed by hand; the parties are picked (association file).
        invoiceNo:     { type:DataTypes.STRING },   // INV NO - the client's invoice
        qty:           { type:DataTypes.INTEGER },  // QTY - how many containers
        size:          { type:DataTypes.STRING },   // SIZE - 20GP, 40HC...
        pol:           { type:DataTypes.STRING },   // POL - a code, as Customs_Job.pol
        pod:           { type:DataTypes.STRING },   // POD - a code, as Customs_Job.pod
        // CONTAINER NO - the numbers as typed, one or several. They become the
        // job's container rows when it is moved.
        containers:    { type:DataTypes.TEXT },
        // GATE IN TIME and CUT OFF, 'YYYY-MM-DD HH:mm'. Text, as every date on
        // a customs job is - and text compares as time in that format.
        gateInTime:    { type:DataTypes.STRING },
        vessel:        { type:DataTypes.STRING },
        cutOff:        { type:DataTypes.STRING },
        bookingNo:     { type:DataTypes.STRING },
        // CURRENT STATUS - where the shipment has got to, in the agent's words
        // ("Gate In", "Loaded"). Not the plan's status above.
        currentStatus: { type:DataTypes.STRING },
        gdNumber:      { type:DataTypes.STRING },
        remarks:       { type:DataTypes.TEXT },
        // VEH DETAIL - the truck(s). Becomes the containers' Truck # on the move.
        vehicleDetail: { type:DataTypes.TEXT },
        // The row's container section: [{ transporterId, size, containerNo,
        // vehicleDetail }] as JSON - see functions/customsPlan asContainerList.
        // containers and vehicleDetail above are worked out from it.
        containerList: { type:DataTypes.TEXT },
        // TRANSPORT - who hauls it; the job's transporterId once moved.
        transporterId: { type:DataTypes.INTEGER },

        companyId:     { type:DataTypes.STRING },
        // When it was moved to the jobs list - the job's own createdAt says
        // the same, but a plan should not need the job to answer it.
        movedAt:       { type:DataTypes.DATE },
    }, {
        indexes: [
            { fields: ["companyId"] },
            { fields: ["status"] },
            { fields: ["createdAt"] },
        ]
    })
    return Customs_Plan;
}
