module.exports = (sequelize, DataTypes) => {
    const Vessel = sequelize.define("Vessel", {
        code:{
            type:DataTypes.INTEGER,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        carrier:{
            type:DataTypes.STRING
        },
        name:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        type:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        pol:{
            type:DataTypes.STRING,
        },
        destinations:{
            type:DataTypes.STRING,
        },
        climaxId:{
            type:DataTypes.INTEGER,
        },
        /* INACTIVE = no longer offered on the job screen's Vessel picker. It
         * stays on every job that already has it, and in every list that
         * looks a vessel up by id (Delivery Order, Loading Program, the job
         * list's filter). What a vessel becomes when it cannot be deleted
         * because a job uses it - see routes/vessel /delete. Added in 1.2.96:
         * existing databases get it from upgrade-1.2.96.sql. */
        active:{
            type:DataTypes.BOOLEAN,
            allowNull:false,
            defaultValue:true,
        },
    }, { indexes: [{ fields: ['climaxId'] }] })
    return Vessel;
}