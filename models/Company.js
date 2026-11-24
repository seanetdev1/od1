module.exports = (sequelize, DataTypes) => {
    const Company = sequelize.define("Company", {
        title:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        short:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        // --- Identity used on prints / reports / invoices (all optional so
        //     existing companies keep working). Base64 data-URL logos are kept
        //     in the DB so they persist with the data (survive Docker rebuilds).
        logo:{           // main / screen logo (sidebar)
            type:DataTypes.TEXT,
        },
        printLogo:{      // logo used on prints & reports (falls back to `logo`)
            type:DataTypes.TEXT,
        },
        address:{
            type:DataTypes.TEXT,
        },
        phone:{
            type:DataTypes.STRING,
        },
        email:{
            type:DataTypes.STRING,
        },
        web:{
            type:DataTypes.STRING,
        },
        ntn:{
            type:DataTypes.STRING,
        },
        strn:{
            type:DataTypes.STRING,
        },
        // Gen_SubCompanies.Id from the legacy Climax database.
        //
        // Every legacy job, voucher and invoice is scoped by SubCompanyId, and
        // Odyssey company ids are autoincrement values assigned at insert time -
        // so without storing this there is no way to map one to the other. The
        // import receivers used to hardcode the mapping
        // (`job.SubCompanyId == 2 ? 1 : 3`), which quietly attached jobs to the
        // wrong company on any database where those ids meant something else.
        //
        // Null for companies created in Odyssey rather than migrated.
        climaxId:{
            type:DataTypes.INTEGER,
            allowNull: true,
        },
    }, { indexes: [{ fields: ['climaxId'] }] })
    return Company;
}
