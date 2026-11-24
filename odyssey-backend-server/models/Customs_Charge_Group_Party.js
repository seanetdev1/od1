// One party's membership of a charge group.
//
// A join row rather than a column on the party: a party can be in several
// groups (the same client buying two different services), and a group holds
// many parties. See Customs_Charge_Group.
//
// `partyId` is a STRING to match Charge_Head.partyId and Customs_Job's own
// party columns, which are strings throughout this module. Keyed the same way
// everywhere means a comparison never has to guess which side was the number.
module.exports = (sequelize, DataTypes) => {
    const Customs_Charge_Group_Party = sequelize.define("Customs_Charge_Group_Party", {
        partyId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        // Denormalised so a group can be listed, and an import explained,
        // without joining out to whichever party table this id lives in.
        // Refreshed whenever the membership is saved.
        partyName: { type: DataTypes.STRING },
    }, {
        indexes: [
            { fields: ["partyId"] },
        ],
    });
    return Customs_Charge_Group_Party;
};
