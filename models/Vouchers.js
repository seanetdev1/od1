const { auditAttributes } = require('../functions/auditStamps');

module.exports = (sequelize, DataTypes) => {
    const Vouchers = sequelize.define("Vouchers", {
        voucher_No:{
            type:DataTypes.INTEGER,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        voucher_Id:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        type:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        vType:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        currency:{
            type:DataTypes.STRING,
        },
        exRate:{
            type:DataTypes.STRING,
        },
        settleExRate:{
            type:DataTypes.STRING,
        },
        chequeNo:{
            type:DataTypes.STRING,
        },
        chequeDate:{
            type:DataTypes.STRING,
        },
        payTo:{
            type:DataTypes.STRING,
        },
        voucherNarration:{
            type:DataTypes.TEXT
        },
        costCenter:{
            type:DataTypes.STRING,
        },
        invoice_Voucher:{
            type:DataTypes.STRING,
        },
        invoice_Id:{
            type:DataTypes.STRING,
        },
        invoices:{
            type:DataTypes.TEXT,
        },
        drawnAt:{
            type:DataTypes.STRING,
        },
        onAccount:{
            type:DataTypes.STRING,
        },
        partyId:{
            type:DataTypes.STRING,
        },
        partyName:{
            type:DataTypes.STRING,
        },
        partyType:{
            type:DataTypes.STRING,
        },
        tranDate:{
            type:DataTypes.STRING,
        },
        subType:{
            type:DataTypes.STRING,
        },

        // Who entered the voucher and who last changed it - functions/
        // auditStamps. Not createdAt: that is the voucher's date. createdBy
        // was here first: on a voucher migrated from Climax it holds Climax's
        // add log ("abbas # SERVER # Administrator # 192.168.50.136").
        ...auditAttributes(DataTypes),

        climaxId:{
            type:DataTypes.INTEGER,
            allowNull: true,
        },

        // On a cheque return (vType CR): the payment or receipt whose cheque
        // came back - functions/chequeReturn. Null on every other voucher; a
        // voucher with a return pointing at it can no longer be edited or
        // deleted. Added by upgrade-1.2.63.sql, with its index - Vouchers is
        // never altered at boot.
        returnOfId:{
            type:DataTypes.INTEGER,
            allowNull: true,
        },
    }, { indexes: [{ fields: ['climaxId'] }] })
    return Vouchers;
}