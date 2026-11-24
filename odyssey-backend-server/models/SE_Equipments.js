module.exports = (sequelize, DataTypes) => {
    const SE_Equipments = sequelize.define("SE_Equipments", {
        size:{
            type:DataTypes.STRING
        },
        qty:{
            type:DataTypes.STRING
        },
        dg:{
            type:DataTypes.STRING
        },
        gross:{
            type:DataTypes.STRING
        },
        teu:{
            type:DataTypes.STRING
        },
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
    return SE_Equipments;
}