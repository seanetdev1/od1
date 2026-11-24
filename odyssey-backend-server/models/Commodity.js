module.exports = (sequelize, DataTypes) => {
    const Commodity = sequelize.define("Commodity", {
        name:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        hs:{
            type:DataTypes.STRING
        },
        cargoType:{
            type:DataTypes.STRING
        },
        commodityGroup:{
            type:DataTypes.STRING
        },
        /* ------------------------- perishable or dry -------------------------
         * How this cargo has to be handled: perishable (flowers, fish, fruit,
         * chilled pharmaceuticals - a broken cold chain ends the shipment) or
         * dry, which is anything else. NULL means dry.
         *
         * DESCRIPTIVE ONLY. It used to decide whether an offloaded AWB was
         * still outstanding: perishable was assumed to have gone back to the
         * master agent, dry to be waiting for the next aircraft. That was
         * wrong in both directions - a perishable shipment offloaded an hour
         * before the next flight is still going, and a withdrawn crate of
         * machine parts is not - and the commodity could say neither. The AWB
         * is now closed by hand on the consignment that left the cargo behind
         * (Aviation_Consignment.awbClosed), and nothing here reads this field
         * to decide it. See functions/aviationPendingLoads.
         * ------------------------------------------------------------------ */
        commodityType:{
            type:DataTypes.STRING
        },
        isHazmat:{
            type:DataTypes.STRING
        },
        packageGroup:{
            type:DataTypes.STRING
        },
        hazmatCode:{
            type:DataTypes.STRING
        },
        hazmatClass:{
            type:DataTypes.STRING
        },
        chemicalName:{
            type:DataTypes.STRING
        },
        unoCode:{
            type:DataTypes.STRING
        },
        active:{
            type:DataTypes.STRING
        },
        climaxId:{
            type:DataTypes.INTEGER
        },
    }, { indexes: [{ fields: ['climaxId'] }] })
    return Commodity;
}