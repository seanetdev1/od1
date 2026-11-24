// An invoice an approver took out of credit control - the user's rule
// (2026-10-23): the backlog stays in the reminders "until a CFO or CEO omits
// it". An omitted invoice is in no credit email and does not count towards its
// party's credit limit. Deleting the row puts it back.
module.exports = (sequelize, DataTypes) => {
    const Credit_Omission = sequelize.define("Credit_Omission", {
        InvoiceId:   { type: DataTypes.INTEGER, allowNull: false, unique: true },
        omittedById: { type: DataTypes.UUID },
        reason:      { type: DataTypes.TEXT },
    });
    return Credit_Omission;
};
