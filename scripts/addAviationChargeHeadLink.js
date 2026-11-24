#!/usr/bin/env node
/*
 * Aviation charges move onto Charge_Heads.
 *
 * Aviation charges were their own table (Aviation_Charges) with columns that
 * duplicated Charge_Head almost one for one - basis, qty, rate, discount,
 * net_amount, ex_rate, local_amount, status, approved_by. Using Charge_Head
 * directly means an aviation charge is invoiced by the SAME code that invoices
 * a freight charge, and every downstream screen - invoice print, ledger,
 * payments, ageing, statements - works with no aviation-specific branch.
 *
 * TWO changes to a SHARED table, both additive:
 *
 *   1. Charge_Heads.AviationConsignmentId - which AWB the charge belongs to.
 *      NULL on every freight charge, which is all of them today.
 *
 *   2. Charge_Heads.SEJobId must allow NULL. An aviation charge hangs off a
 *      consignment, not an SE_Job. The column was created nullable by
 *      scripts/addChargeHeadForeignKeys.js, but a database where sync() made
 *      it first may have it NOT NULL - this checks and relaxes it.
 *
 * Nothing is dropped and no existing row is rewritten. Freight charges keep
 * their SEJobId and gain a NULL AviationConsignmentId.
 *
 * RUN THIS BEFORE RESTARTING THE BACKEND with the new code. Until the column
 * exists, any query touching Charge_Heads will fail with 42703.
 *
 *   node scripts/addAviationChargeHeadLink.js            # dry run
 *   node scripts/addAviationChargeHeadLink.js --apply
 */
const db = require('../models');
const { sequelize, Sequelize } = db;

const APPLY = process.argv.includes('--apply');

async function main() {
    await sequelize.authenticate();
    // The boot sync runs in the background when ../models is required. Waiting
    // for it before touching anything - and before close() - stops it failing
    // mid-table and printing a bogus "schema not fully migrated" banner.
    await db.ready;

    const qi = sequelize.getQueryInterface();
    const cols = await qi.describeTable('Charge_Heads');
    let pending = 0;

    console.log(APPLY ? 'Applying changes:' : 'DRY RUN - nothing will be changed.');
    console.log('');

    // 1. The link to an aviation consignment.
    if (cols.AviationConsignmentId) {
        console.log('  = Charge_Heads.AviationConsignmentId already exists.');
    } else if (!APPLY) {
        console.log('  + Charge_Heads.AviationConsignmentId would be added.');
        pending++;
    } else {
        await qi.addColumn('Charge_Heads', 'AviationConsignmentId', {
            type: Sequelize.DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'Aviation_Consignments', key: 'id' },
            onDelete: 'CASCADE',
        });
        console.log('  + Added Charge_Heads.AviationConsignmentId.');
        pending++;
    }

    // 2. SEJobId has to tolerate an aviation charge, which has no SE_Job.
    if (!cols.SEJobId) {
        console.log('  ! Charge_Heads.SEJobId is missing entirely - run');
        console.log('    scripts/addChargeHeadForeignKeys.js first.');
        process.exitCode = 1;
    } else if (cols.SEJobId.allowNull) {
        console.log('  = Charge_Heads.SEJobId is already nullable.');
    } else if (!APPLY) {
        console.log('  + Charge_Heads.SEJobId would be relaxed to nullable.');
        pending++;
    } else {
        await sequelize.query('ALTER TABLE "Charge_Heads" ALTER COLUMN "SEJobId" DROP NOT NULL');
        console.log('  + Charge_Heads.SEJobId relaxed to nullable.');
        pending++;
    }

    // 3. Index it - a flight loads its charges by this column on every open.
    if (APPLY) {
        const [idx] = await sequelize.query(
            `SELECT 1 FROM pg_indexes WHERE tablename = 'Charge_Heads'
             AND indexname = 'charge_heads_aviation_consignment'`
        );
        if (!idx.length) {
            await sequelize.query(
                `CREATE INDEX "charge_heads_aviation_consignment"
                 ON "Charge_Heads"("AviationConsignmentId")`
            );
            console.log('  + Created index charge_heads_aviation_consignment.');
        } else {
            console.log('  = index charge_heads_aviation_consignment already exists.');
        }
    }

    if (APPLY) {
        // Report rather than assume: a wrong answer here is a broken screen.
        const after = await sequelize.getQueryInterface().describeTable('Charge_Heads');
        const ok = Boolean(after.AviationConsignmentId) && after.SEJobId?.allowNull;
        console.log('');
        console.log(ok
            ? 'Verified: AviationConsignmentId present, SEJobId nullable. Restart the backend.'
            : 'FAILED: the table still does not look right - see above.');
        if (!ok) process.exitCode = 1;
    } else {
        console.log('');
        console.log(pending
            ? `${pending} change(s) pending. Re-run with --apply.`
            : 'Nothing to do - the database is already up to date.');
    }

    // The old table is left in place: it may still hold test charges, and
    // dropping data is not this script's job. Once you are satisfied nothing
    // is lost it can go:  DROP TABLE "Aviation_Charges";
    await sequelize.close();
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
