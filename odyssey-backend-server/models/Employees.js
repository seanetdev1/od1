module.exports = (sequelize, DataTypes) => {
    const Employees = sequelize.define("Employees", {
        id:{
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey:true,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        name:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        fatherName:{
            type:DataTypes.STRING,
        },
        email:{
            type:DataTypes.STRING,
        },
        username:{
            type:DataTypes.STRING,
        },
        password:{
            type:DataTypes.STRING,
        },
        contact:{
            type:DataTypes.STRING,
        },
        address:{
            type:DataTypes.STRING,
        },
        cnic:{
            type:DataTypes.STRING,
        },
        designation:{
            type:DataTypes.STRING
        },
        department:{
            type:DataTypes.STRING
        },
        manager:{
            type:DataTypes.STRING
        },
        date:{
            type:DataTypes.STRING
        },
        bank:{
            type:DataTypes.STRING
        },
        account_no:{
            type:DataTypes.STRING
        },
        code:{
            type:DataTypes.STRING,
        },
        active:{
            type:DataTypes.STRING,
        },
        access:{
            type:DataTypes.STRING,
        },
        represent:{
            type:DataTypes.STRING
        },
        defaultCompanyId:{
            type:DataTypes.STRING
        },
        createdBy:{
            type:DataTypes.STRING
        },
        updatedBy:{
            type:DataTypes.STRING
        },
        // TAP_Employee.Id from the legacy Climax database.
        //
        // Needed because jobs reference a sales rep by that legacy id, and
        // Odyssey employee ids are UUIDs generated at insert time - there is no
        // way to resolve one to the other after the fact without storing it.
        // fixSalesRep used to paper over this with a hardcoded switch mapping
        // legacy ids to UUIDs from one specific installation, which silently
        // nulled every sales rep on any other database.
        //
        // Matches the climaxId convention already on Clients, Commodity,
        // Invoice, SE_Job, Vessel, Voucher_Heads, Vouchers and Voyage. Null for
        // anyone created in Odyssey rather than migrated.
        climaxId:{
            type:DataTypes.INTEGER,
            allowNull: true,
        }
    }, {
        indexes: [{ fields: ['climaxId'] }],
        // The password hash is never read unless asked for by name. Lists,
        // pickers and every include of an employee (sales rep on a job, the
        // actor on a history row...) used to carry it to the browser. Code
        // that checks a password uses Employees.unscoped(); an explicit
        // `attributes` list naming 'password' also still gets it.
        defaultScope: { attributes: { exclude: ['password'] } },
    })
    return Employees;
}