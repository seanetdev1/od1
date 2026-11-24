module.exports = (sequelize, DataTypes) => {
    const Stamps = sequelize.define("Stamps", {
        code : {type : DataTypes.STRING},
        stamps : {type : DataTypes.STRING},
        stamp_group : {type : DataTypes.STRING},
        // Legacy row id, so this table can be verified and re-run like its
        // parent. Without it a repeated stage silently doubles the data and
        // /migration/counts cannot tell migrated rows from any others.
        // Indexed (not unique): a legacy id is unique per source table, but the
        // same Odyssey table can hold rows from more than one legacy table, and
        // rows created in Odyssey carry null.
        climaxId:{
            type:DataTypes.INTEGER,
            allowNull: true,
        },

    }, { indexes: [{ fields: ['climaxId'] }] })
    return Stamps;
}