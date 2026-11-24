// Someone asking for a blocked party to be let onto jobs - see Credit_Block
// and functions/creditControl. Decided by an approver (CEO / CFO by default,
// Config > Credit Control).
module.exports = (sequelize, DataTypes) => {
    const Credit_Unblock_Request = sequelize.define("Credit_Unblock_Request", {
        ClientId:      { type: DataTypes.INTEGER, allowNull: false },
        requestedById: { type: DataTypes.UUID },
        note:          { type: DataTypes.TEXT },
        // pending | approved | rejected
        status:        { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
        decidedById:   { type: DataTypes.UUID },
        decidedAt:     { type: DataTypes.DATE },
        decisionNote:  { type: DataTypes.TEXT },
        approvedUntil: { type: DataTypes.DATE },
    }, { indexes: [{ fields: ['ClientId'] }, { fields: ['status'] }] });
    return Credit_Unblock_Request;
};
