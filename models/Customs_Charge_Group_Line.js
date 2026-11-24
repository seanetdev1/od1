// One default charge in a group - a line the import will add to a job.
//
// Deliberately the same SHAPE as the charge sheet's own row (see
// functions/customsCharge.chargeValues), because the import copies it onto a
// job and anything that does not line up here has to be invented there.
//
// WHAT IT DOES NOT CARRY IS THE PARTY. A charge already knows whose it is
// through the master's defaultRecivableParty / defaultPaybleParty role, which
// resolves against the JOB's own client, shipping line or transporter. An
// imported line therefore fills its party exactly as a hand-added one does -
// and a party stored here would be the same fact recorded twice, disagreeing
// the first time a client is changed on a job.
//
// The money fields are all OPTIONAL. A group may be nothing more than "these
// eight heads always apply", leaving the rates to be typed per job; or it may
// be a full agreed tariff. Both are ordinary.
module.exports = (sequelize, DataTypes) => {
    const Customs_Charge_Group_Line = sequelize.define("Customs_Charge_Group_Line", {
        // 'Receivable' or 'Payable' - which side of the sheet it lands on.
        type: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        // Charges master id. A STRING, like Charge_Head.charge, which is a
        // string column pointing at an integer master - see chargeCopyKey on
        // why keying those two differently duplicates every saved line.
        charge: { type: DataTypes.STRING },
        particular: { type: DataTypes.STRING },
        description: { type: DataTypes.STRING },
        // 'Per Unit' or 'P/Shpt', matching the sheet's own vocabulary.
        basis: { type: DataTypes.STRING },
        qty: { type: DataTypes.DOUBLE },
        rate_charge: { type: DataTypes.DOUBLE },
        discount: { type: DataTypes.DOUBLE },
        currency: { type: DataTypes.STRING },
        // The order they were entered in, so an imported sheet reads the way
        // the group was written rather than by whatever the database returns.
        position: { type: DataTypes.INTEGER, defaultValue: 0 },
    }, {
        indexes: [
            { fields: ["type"] },
        ],
    });
    return Customs_Charge_Group_Line;
};
