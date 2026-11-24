const { auditAttributes } = require('../functions/auditStamps');

module.exports = (sequelize, DataTypes) => {
    const Invoice = sequelize.define("Invoice", {
        invoice_No:{
            type:DataTypes.STRING
        },
        invoice_Id:{
            type:DataTypes.INTEGER
        },
        type:{
            type:DataTypes.STRING
        },
        payType:{
            type:DataTypes.STRING
        },
        status:{
            type:DataTypes.STRING
        },
        operation:{
            type:DataTypes.STRING
        },
        currency:{
            type:DataTypes.STRING
        },
        ex_rate:{
            type:DataTypes.STRING
        },
        party_Id:{
            type:DataTypes.STRING
        },
        party_Name:{
            type:DataTypes.STRING
        },
        paid:{
            type:DataTypes.STRING,
            defaultValue: "0",
        },
        recieved:{
            type:DataTypes.STRING,
            defaultValue: "0",
        },
        roundOff:{
            type:DataTypes.STRING,
            defaultValue: "0",
        },
        total:{
            type:DataTypes.STRING,
            defaultValue: "0",
        },
        approved:{
            type:DataTypes.STRING,
            defaultValue: "0",
        },
        companyId:{
            type:DataTypes.STRING,
        },
        partyType:{
            type:DataTypes.STRING,
        },
        climaxId:{
            type:DataTypes.STRING,
        },
        note:{
            type:DataTypes.TEXT
        },
        // The VENDOR'S own tax invoice number for a bill, entered on the
        // invoice page once their tax invoice arrives - after the bill was
        // raised. Added by hand on existing installs (Invoices is never
        // altered at boot): invoice-vendor-tax-invoice.sql.
        vendorTaxInvoiceNo:{
            type:DataTypes.STRING
        },
        // Who entered the invoice and who last changed it - functions/
        // auditStamps. Not createdAt: that is the invoice's date.
        ...auditAttributes(DataTypes),
    }, {
        indexes: [
            { fields: ['createdAt'] },
            { fields: ['type'] },
            { fields: ['payType'] },
            { fields: ['party_Id'] },
            { fields: ['companyId'] },
            { fields: ['currency'] },
            { fields: ['operation'] },
            { fields: ['approved'] },
            // Legacy id lookups during migration were sequential scans over the
            // whole invoice table, once per charge line.
            { fields: ['climaxId'] },
        ]
    }
)
    return Invoice;
}