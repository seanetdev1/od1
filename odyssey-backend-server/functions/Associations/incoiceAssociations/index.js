const { DataTypes } = require('sequelize')
const { Invoice, Charge_Head, Vouchers, Invoice_Losses, Invoice_Transactions, Sales_Tax_Invoice } = require("../../../models");
//const { SE_Job, SE_Equipments } = require("../../functions/Associations/jobAssociations/seaExport");
const { SE_Job } = require("../jobAssociations/seaExport")
const { Aviation_Consignment } = require("../aviationAssociations")
const { Customs_Job } = require("../customsAssociations")

Invoice.hasMany(Charge_Head, {
    foriegnKey:{
        type: DataTypes.INTEGER,
        allowNull:true
    }
});
Charge_Head.belongsTo(Invoice);

Invoice.hasMany(Invoice_Transactions, {
    foriegnKey:{
        type: DataTypes.INTEGER,
        allowNull:false
    }
});
Invoice_Transactions.belongsTo(Invoice);

Vouchers.hasMany(Invoice_Transactions, {
    foriegnKey:{
        type: DataTypes.INTEGER,
        allowNull:false
    }
});
Invoice_Transactions.belongsTo(Vouchers);

SE_Job.hasMany(Invoice, {
    foriegnKey:{
        type: DataTypes.INTEGER,
        allowNull:true
    }
});
Invoice.belongsTo(SE_Job);

// allowNull TRUE, not false. An AVIATION charge is a Charge_Head hanging off a
// consignment, not off an SE_Job, so it has no job to point at. Freight
// charges still always carry one - nothing about the freight path changes -
// but the column has to tolerate a null for the aviation ones to exist at all.
// The database column is nullable to match (scripts/addAviationChargeHeadLink).
SE_Job.hasMany(Charge_Head, {
    foreignKey:{
        type: DataTypes.INTEGER,
        allowNull:true
    }
});
Charge_Head.belongsTo(SE_Job);

// An aviation charge belongs to one AWB. Same table, same invoicing code, same
// ledger - the only difference from a freight charge is which parent it names.
//
// CASCADE: removing an AWB takes its charges with it, matching how the
// consignment already owns them.
Aviation_Consignment.hasMany(Charge_Head, {
    foreignKey:{
        type: DataTypes.INTEGER,
        allowNull:true
    },
    onDelete: 'CASCADE'
});
Charge_Head.belongsTo(Aviation_Consignment);

// A customs charge belongs to one GD. Same table, same invoicing code, same
// ledger - the only difference from a freight charge is which parent it names.
//
// The charge hangs off the JOB rather than off a child line, unlike aviation:
// a flight carries many AWBs for many different customers, so its charges have
// to be per-AWB, whereas a GD is one declaration for one client. Everything on
// a clearance file is billed to the same party, so the job is the right grain
// and there is no child row to hang a charge on.
//
// CASCADE: removing a customs job takes its charges with it, matching how the
// job owns them. A charge against a deleted GD has nothing left to be a charge
// against - though note the job is CANCELLED rather than destroyed by the
// route, so this fires only on a real delete.
Customs_Job.hasMany(Charge_Head, {
    foreignKey:{
        type: DataTypes.INTEGER,
        allowNull:true
    },
    onDelete: 'CASCADE'
});
Charge_Head.belongsTo(Customs_Job);

// The GST invoice number an invoice was issued under - see
// models/Sales_Tax_Invoice. CASCADE: only an unapproved invoice can be deleted,
// and a number that belonged to it goes with it.
Invoice.hasOne(Sales_Tax_Invoice, { foreignKey: 'InvoiceId', onDelete: 'CASCADE' });
Sales_Tax_Invoice.belongsTo(Invoice, { foreignKey: 'InvoiceId' });

module.exports = { Charge_Head, Invoice, Vouchers, Invoice_Losses, Invoice_Transactions, Sales_Tax_Invoice }