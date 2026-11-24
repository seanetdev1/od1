module.exports = (sequelize, DataTypes) => {
    const Airports = sequelize.define("Airports", {
        airportCode: {
            type: DataTypes.STRING,
            allowNull: false,
            // NOT `unique: true` here on purpose - see the indexes block below.
            validate: {
                notEmpty: true
            }
        },
        airportName: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: {
                notEmpty: true
            }
        },
        // OPTIONAL, and not asked for at all in an aviation install: an
        // airport is identified by its code and its country, and the city was
        // one more box to fill in that nothing reads. Kept declared (rather
        // than dropped) so the freight and customs screens keep recording it
        // and the rows that already have one keep it.
        //
        // The live column was created NOT NULL. Making it nullable is a hand
        // migration - the shared tables are synced with CREATE TABLE IF NOT
        // EXISTS, which never issues ALTER (see models/index.js):
        //   ALTER TABLE "Airports" ALTER COLUMN "city" DROP NOT NULL;
        city: {
            type: DataTypes.STRING,
            allowNull: true
        },
        country: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: {
                notEmpty: true
            }
        }
    }, {
        // Named index rather than an inline `unique: true` on airportCode.
        // sync({alter:true}) cannot match an inline unique constraint against
        // the database, so it added another one on every run -
        // Airports_airportCode_key1 .. _key79 on the live freight install, one
        // per altering start. Sequelize matches entries in `indexes` by name,
        // so this is recognised and left alone. scripts/fixPickListIndexes.js
        // drops the duplicates.
        indexes: [
            { name: "Airports_airportCode_key", unique: true, fields: ["airportCode"] },
        ]
    })
    return Airports
}
