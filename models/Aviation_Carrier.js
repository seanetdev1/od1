// A carrier whose cargo can be on a flight.
//
// Registered once (Setup > Carriers) and then picked per consignment. Two
// things hang off it, which is why it is a record rather than free text:
//
//   prefix    the airline's 3-digit AWB prefix - 214 PIA, 618 SriLankan.
//             An AWB is prefix + serial, so the prefix belongs to the carrier
//             and should never be retyped per consignment.
//
//   partyId   the Clients row this carrier bills and is paid as. Attached by
//             the association, not declared here. A charge is billed to a
//             PARTY - that is what the ledger hangs off - so without one a
//             charge against this carrier could not be invoiced. Setup >
//             Carriers creates or links it; see functions/carrierParty.js.
//
//   category  'GAM' | 'IFA' | 'Other'. THE REPORTING TAG. The monthly sector
//             report splits every flight's uplift into GAM Uplift / IFA Loads
//             / Other Carrier, and this is what decides which bucket a
//             consignment falls into. Those three figures were being typed by
//             hand on the flight; tagging the carrier lets them be counted
//             instead.
//
//             'ER' WAS THE OLD SPELLING OF 'GAM', renamed in 1.2.3. The column
//             is free text, so carriers registered before then still hold it
//             and are read as GAM - see functions/carrierCategory.js, which is
//             the only place that knows either name.
module.exports = (sequelize, DataTypes) => {
    const Aviation_Carrier = sequelize.define("Aviation_Carrier", {
        name:     { type:DataTypes.STRING, allowNull:false },
        // The IATA numeric prefix, which IS the carrier's code here - there
        // is no separate one. A STRING, not an integer: it is an identifier
        // that can carry a leading zero, and arithmetic on it is meaningless.
        // UNIQUE. A prefix identifies the carrier on every AWB it issues, so
        // two carriers sharing one would make an AWB ambiguous and split a
        // month's uplift across the wrong reporting tags.
        //
        // Nullable AND unique is deliberate: Postgres allows many NULLs under
        // a unique constraint, so carriers registered without a prefix do not
        // collide with each other.
        prefix:   { type:DataTypes.STRING, unique: true },
        category: { type:DataTypes.STRING, allowNull:false, defaultValue:'Other' },
        active:   { type:DataTypes.BOOLEAN, defaultValue:true },
    }, {
        indexes: [
            { fields: ["category"] },
            { fields: ["active"] },
        ]
    })
    return Aviation_Carrier;
}
