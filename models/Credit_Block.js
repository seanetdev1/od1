// A party blocked from new jobs for being over its Credit Limit (Amount) -
// functions/creditControl (the user's request, 2026-10-23).
//
// One row per party, kept: the daily check sets it `active` when the party's
// open invoices pass its limit and clears it when they come back under, and an
// approver's unblock sets `approvedUntil`, until which the party can be picked
// although it is still over. The figures are as at the last check.
module.exports = (sequelize, DataTypes) => {
    const Credit_Block = sequelize.define("Credit_Block", {
        ClientId:      { type: DataTypes.INTEGER, allowNull: false, unique: true },
        active:        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        balancePkr:    { type: DataTypes.DECIMAL(18, 2) },
        limitPkr:      { type: DataTypes.DECIMAL(18, 2) },
        blockedAt:     { type: DataTypes.DATE },
        checkedAt:     { type: DataTypes.DATE },
        // An approver let it through until then - unblocked, still flagged.
        approvedUntil: { type: DataTypes.DATE },
        approvedById:  { type: DataTypes.UUID },
        liftedAt:      { type: DataTypes.DATE },
        liftReason:    { type: DataTypes.STRING },
    });
    return Credit_Block;
};
