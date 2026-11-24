// Associations for the customs clearance module.
//
// Self-contained on purpose: this file only ever links Customs_Job to the
// read-only masters it picks from (Clients, Commodity). It adds NOTHING to
// SE_Job, Bl, Invoice or any other existing table, so loading it cannot change
// the shape of an existing query - which is the whole point of customs being a
// separate module.
//
// The one link it does NOT declare is Customs_Job -> Charge_Head. That lives
// in incoiceAssociations, next to the SE_Job and Aviation_Consignment links to
// the same table, so all three parents of a charge are declared in one place
// rather than three files each quietly adding a column to Charge_Heads.
const { DataTypes } = require('sequelize');
const {
    Customs_Job, Customs_Duty, Customs_Container, Commodity, Customs_Plan,
    Customs_Charge_Group, Customs_Charge_Group_Party, Customs_Charge_Group_Line,
} = require("../../../models");
const { Clients } = require("../clientAssociation");

// A declaration is assessed ITEM BY ITEM, so its duty is a list of lines
// rather than a set of figures on the header - see Customs_Duty, and the
// legacy Log_DutyCalculation it matches.
//
// CASCADE: deleting the GD takes its duty lines with it; a duty line on its
// own is meaningless. Note the route CANCELS a job rather than destroying it,
// so this fires only on a real delete.
Customs_Job.hasMany(Customs_Duty, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    onDelete: 'CASCADE'
});
Customs_Duty.belongsTo(Customs_Job);

// The containers on the declaration. Same CASCADE reasoning as the duty lines:
// a container row on its own is meaningless, and the route cancels a job
// rather than destroying it, so this only fires on a real delete.
Customs_Job.hasMany(Customs_Container, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    onDelete: 'CASCADE'
});
Customs_Container.belongsTo(Customs_Job);

// What was assessed on this line. Duty rates are set against a commodity's
// classification, so this is where the commodity actually belongs - the job
// header's own CommodityId below is the file's headline description, not the
// thing any rate applies to.
Commodity.hasMany(Customs_Duty, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
Customs_Duty.belongsTo(Commodity);

// Who the job is FOR. The importer or exporter the agent is clearing on behalf
// of - and, unless a charge says otherwise, the party the agency fee is billed
// to. Aliased `client` so the column reads as what it holds rather than as a
// bare ClientId that could mean any of the three parties below.
Customs_Job.belongsTo(Clients, { as: 'client',    foreignKey: 'clientId'    });
// The other two names on the transport document. On an import the consignee is
// usually the client and the shipper is the foreign supplier; on an export it
// is the other way round. Both are recorded because the GD names both, and
// because "who is the shipper on this file" is asked far more often than it is
// derivable.
Customs_Job.belongsTo(Clients, { as: 'shipper',   foreignKey: 'shipperId'   });
Customs_Job.belongsTo(Clients, { as: 'consignee', foreignKey: 'consigneeId' });
// The haulier who moved it. A fourth name on the file, populated on 41% of
// CargoLinkers' clearing jobs across 16 distinct vendors - the legacy form has
// it as "Vendor / Transport" and this one had no field for it.
Customs_Job.belongsTo(Clients, { as: 'transporter', foreignKey: 'transporterId' });
// "Local Vendor", "Freight Forwarder (CHA/CHB)" and the carrier, as the GD
// Entry screen names them.
Customs_Job.belongsTo(Clients, { as: 'localVendor',  foreignKey: 'localVendorId'  });
Customs_Job.belongsTo(Clients, { as: 'chaChb',       foreignKey: 'chaChbId'       });
Customs_Job.belongsTo(Clients, { as: 'shippingLine', foreignKey: 'shippingLineId' });

// No matching Clients.hasMany for any of the three: nothing ever asks "which
// customs jobs is this party on", and three unaliased hasMany calls back from
// Clients would collide. Same reasoning as aviationAssociations.

// What was declared. One commodity per GD is the right grain here: a
// declaration covering several HS codes is item-level detail, and this module
// deliberately stops at the declaration's own header and its duty.
Commodity.hasMany(Customs_Job, {
    foreignKey: {
        type: DataTypes.INTEGER,
        allowNull: true
    }
});
Customs_Job.belongsTo(Commodity);

/* THE PROGRAM BOOK - planned jobs, numbered only when they are moved.
 *
 * A plan points at the job it became; the job does not point back, so no
 * column is added to Customs_Jobs for it. SET NULL: a job is never destroyed
 * by the app (Delete cancels it), but if one ever is, its plan goes back to
 * being a plan rather than taking the job with it or blocking the delete.
 */
Customs_Plan.belongsTo(Clients, { as: 'shipper',      foreignKey: 'shipperId' });
Customs_Plan.belongsTo(Clients, { as: 'shippingLine', foreignKey: 'shippingLineId' });
Customs_Plan.belongsTo(Customs_Job, {
    foreignKey: { name: 'CustomsJobId', type: DataTypes.INTEGER, allowNull: true },
    onDelete: 'SET NULL',
});
Customs_Job.hasOne(Customs_Plan, { foreignKey: 'CustomsJobId' });

module.exports = { Customs_Job, Customs_Duty, Customs_Container, Customs_Plan };

/* THE CHARGE GROUPS - a named set of default charges for a kind of client.
 *
 * Both children CASCADE: a group's parties and its default lines have no
 * meaning without the group, and unlike a job there is nothing here to
 * "cancel" instead of deleting. Note that deleting a group does NOT touch the
 * charges it has already put on jobs - those became ordinary Charge_Heads the
 * moment they were imported, which is the point of importing rather than
 * linking.
 */
Customs_Charge_Group.hasMany(Customs_Charge_Group_Party, {
    foreignKey: { type: DataTypes.INTEGER, allowNull: false },
    onDelete: 'CASCADE',
});
Customs_Charge_Group_Party.belongsTo(Customs_Charge_Group);

Customs_Charge_Group.hasMany(Customs_Charge_Group_Line, {
    foreignKey: { type: DataTypes.INTEGER, allowNull: false },
    onDelete: 'CASCADE',
});
Customs_Charge_Group_Line.belongsTo(Customs_Charge_Group);
