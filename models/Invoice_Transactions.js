module.exports = (sequelize, DataTypes) => {
    const Invoice_Transactions = sequelize.define("Invoice_Transactions", {
        gainLoss:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        amount:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        // Legacy GL_InvAdjustments row id, so settlement can be re-run without
        // doubling it. Nullable: transactions raised inside Odyssey have no
        // legacy row behind them. Indexed, not unique - rows created here carry
        // null. Existing databases need scripts/addInvoiceTransactionClimaxId.js;
        // ODYSSEY_DB_SYNC=create never alters a table that already exists.
        climaxId:{
            type:DataTypes.INTEGER,
            allowNull: true,
        },
    }, { indexes: [{ fields: ['climaxId'] }] })
    return Invoice_Transactions;
}