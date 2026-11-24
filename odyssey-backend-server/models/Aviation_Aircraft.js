// An aircraft the airline flies, registered once and picked per flight.
//
// Replaces the free-text Aircraft Type on the flight. The monthly sector
// report splits every sector by aircraft - LHE-DXB 737 and LHE-DXB A330 are
// two separate sheets - so the value has to be one of a known set. Typed by
// hand, "A330", "A-330" and "a330" each became their own row in the rollup.
//
// `name` is what the report groups and labels by, so it is unique: two
// registrations spelled differently would split one aircraft's month in two.
module.exports = (sequelize, DataTypes) => {
    const Aviation_Aircraft = sequelize.define("Aviation_Aircraft", {
        name:        { type:DataTypes.STRING, allowNull:false, unique:true },
        // Free text for the full designation - "Airbus A330-200F" - when the
        // short name above is what everyone actually says.
        description: { type:DataTypes.STRING },
        // Maximum payload in kg. Not used by the report; recorded because it
        // is the figure a load planner checks PFM against.
        maxPayload:  { type:DataTypes.DOUBLE },
        active:      { type:DataTypes.BOOLEAN, defaultValue:true },
    }, {
        indexes: [
            { fields: ["active"] },
        ]
    })
    return Aviation_Aircraft;
}
