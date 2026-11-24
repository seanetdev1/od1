// A named set of default charges for a kind of client.
//
// A clearing agent bills the same dozen heads to the same client over and over,
// and a different dozen to a different kind of client - an importer clearing
// containers is not billed like an exporter sending groupage. The group is that
// pattern, written down once: the parties it applies to (Customs_Charge_Group_
// Party) and the lines it brings (Customs_Charge_Group_Line).
//
// WHY A GROUP RATHER THAN DEFAULTS ON THE PARTY ITSELF. Two reasons, and the
// second is the one that decided it:
//
//   - a tariff is agreed with a SEGMENT, not a company. Twenty importers on the
//     same terms is one list to maintain, not twenty.
//   - a party can be in more than one group, because the same client genuinely
//     buys two different services. The import asks which set to bring in when
//     that is the case, rather than guessing or merging - see the route.
//
// Named `Customs_` so it is reconciled by the customs alter-sync on every boot
// (CUSTOMS_MODELS in models/index.js). A table outside that list is created
// once and never altered again, so every column added afterwards is missing
// from the database until a query dies in front of a user.
module.exports = (sequelize, DataTypes) => {
    const Customs_Charge_Group = sequelize.define("Customs_Charge_Group", {
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        // What this set is for, in the words of whoever set it up. Shown on the
        // import button's menu, where "Standard Importers" alone may not be
        // enough to choose between two.
        description: { type: DataTypes.STRING },
        // Deactivated rather than deleted once it has been used: a group that
        // is gone cannot explain why a job's charges look the way they do.
        active: { type: DataTypes.BOOLEAN, defaultValue: true },
        companyId: { type: DataTypes.STRING },
    }, {
        indexes: [
            { fields: ["active"] },
        ],
    });
    return Customs_Charge_Group;
};
