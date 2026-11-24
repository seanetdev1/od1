module.exports = (sequelize, DataTypes) => {
    const Charges = sequelize.define("Charges", {
        code:{
            type:DataTypes.INTEGER,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        currency:{
            type:DataTypes.STRING,
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
        short:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        calculationType:{
            type:DataTypes.STRING,
            allowNull: false,
            validate:{
                notEmpty: true
            }
        },
        /* ---------------- who a charge normally falls to ------------------
         * OPTIONAL, both of them.
         *
         * They are a CONVENIENCE: picking this charge on a job pre-fills the
         * party from the role named here. Plenty of charges have no such
         * answer - a disbursement recharged to whoever the job is for, a
         * one-off that lands on a different party every time - and requiring
         * a role there meant choosing a wrong one, which then quietly
         * pre-filled the wrong party on every job that used the charge.
         *
         * Left blank, the charge simply does not pre-fill and the party is
         * picked by hand. Both charge screens already behave that way: the
         * role is looked up in PARTY_RESOLVERS and an absent one resolves to
         * undefined, which fills in nothing.
         *
         * The live columns were created NOT NULL. Relaxing them is a hand
         * migration - Charges is a shared master and models/index.js syncs
         * those with CREATE TABLE IF NOT EXISTS, which never issues ALTER:
         *   ALTER TABLE "Charges" ALTER COLUMN "defaultPaybleParty" DROP NOT NULL;
         *   ALTER TABLE "Charges" ALTER COLUMN "defaultRecivableParty" DROP NOT NULL;
         * Shipped as ifa-deploy/1.2.2-optional-charge-parties.sql.
         * -------------------------------------------------------------- */
        defaultPaybleParty:{
            type:DataTypes.STRING,
            allowNull: true,
        },
        defaultRecivableParty:{
            type:DataTypes.STRING,
            allowNull: true,
        },
        taxApply:{
            type:DataTypes.STRING,
            allowNull: false,
        },
        taxPerc:{
            type:DataTypes.STRING,
            allowNull: false,
        },
        fixAmount:{
            type:DataTypes.DOUBLE,  
            defaultValue:0.0
        },
        // The legacy Gen_Charges.Id.
        //
        // Without it the import had nowhere to record which legacy charge a row
        // came from, so it put that id in `code` instead - discarding
        // ChargesCode, which is the code staff actually recognise - and had no
        // way to tell a re-run from a first run, duplicating every charge.
        climaxId: { type: DataTypes.INTEGER },

        // Is this charge a PASS-THROUGH DISBURSEMENT rather than revenue?
        //
        // A clearing agent pays duty, sales tax, income tax, port and terminal
        // charges on the client's behalf and recharges them at cost. Those are
        // not income - they are a recoverable asset - and on a goods
        // declaration they dwarf the agency fee. Posting them to a revenue
        // account overstates turnover by roughly the size of the duty and
        // misstates the sales-tax position.
        //
        // Migrated from the legacy Gen_Charges.IsReimbursment, which Climax has
        // carried all along and the first version of the charges import
        // dropped.
        //
        // Read at posting time by routes/invoice approveInvoice(), which sends
        // these lines to the bucket's `disbursement` account instead of its
        // income/expense pair.
        reimbursable:{
            type:DataTypes.BOOLEAN,
            defaultValue: false
        },

        status:{
            type:DataTypes.BOOLEAN,
            defaultValue: true
        },
    })
    return Charges;
}