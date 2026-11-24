#!/usr/bin/env node
/*
 * Customs charges hang off Charge_Heads.
 *
 * A customs charge is a Charge_Head - the same table the freight and aviation
 * sides use - so it is invoiced by the SAME code that invoices a freight
 * charge, and every downstream screen (invoice print, ledger, payments,
 * ageing, statements) works with no customs-specific branch. The only thing
 * that distinguishes it is which parent it names.
 *
 * ONE change to a SHARED table, and it is additive:
 *
 *   Charge_Heads.CustomsJobId - which goods declaration the charge belongs to.
 *   NULL on every freight and aviation charge, which is all of them today.
 *
 * SEJobId is not touched here: aviation already relaxed it to nullable
 * (scripts/addAviationChargeHeadLink.js), and a customs charge needs exactly
 * the same tolerance. This script CHECKS it and tells you to run that one if
 * it is still NOT NULL, rather than relaxing it a second time from two places.
 *
 * Nothing is dropped and no existing row is rewritten.
 *
 * RUN THIS BEFORE RESTARTING THE BACKEND with the new code. Until the column
 * exists, any query touching Charge_Heads will fail with 42703 - which shows
 * up somewhere unrelated, like the invoice list, rather than on the customs
 * screens.
 *
 *   node scripts/addCustomsChargeHeadLink.js            # dry run
 *   node scripts/addCustomsChargeHeadLink.js --apply
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

    // The parent table has to exist before a foreign key can reference it. It
    // is created by the boot sync above, so this only fails if that sync did
    // not get that far - in which case saying so is far more useful than a
    // foreign-key error naming a table nobody expected to be missing.
    const tables = await qi.showAllTables();
    const hasJobs = tables.map((t) => (typeof t === 'string' ? t : t.tableName))
        .includes('Customs_Jobs');
    if (!hasJobs) {
        console.error('Customs_Jobs does not exist yet. Start the backend once so the');
        console.error('boot sync creates it, then re-run this script.');
        process.exit(1);
    }

    const cols = await qi.describeTable('Charge_Heads');
    let pending = 0;

    console.log(APPLY ? 'Applying changes:' : 'DRY RUN - nothing will be changed.');
    console.log('');

    // 1. The link to a customs job.
    if (cols.CustomsJobId) {
        console.log('  = Charge_Heads.CustomsJobId already exists.');
    } else if (!APPLY) {
        console.log('  + Charge_Heads.CustomsJobId would be added.');
        pending++;
    } else {
        await qi.addColumn('Charge_Heads', 'CustomsJobId', {
            type: Sequelize.DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'Customs_Jobs', key: 'id' },
            onDelete: 'CASCADE',
        });
        console.log('  + Added Charge_Heads.CustomsJobId.');
        pending++;
    }

    // 2. SEJobId has to tolerate a customs charge, which has no SE_Job.
    if (!cols.SEJobId) {
        console.log('  ! Charge_Heads.SEJobId is missing entirely - run');
        console.log('    scripts/addChargeHeadForeignKeys.js first.');
        process.exitCode = 1;
    } else if (cols.SEJobId.allowNull) {
        console.log('  = Charge_Heads.SEJobId is already nullable.');
    } else {
        console.log('  ! Charge_Heads.SEJobId is NOT NULL. Run');
        console.log('    scripts/addAviationChargeHeadLink.js --apply first - it owns that');
        console.log('    change, and doing it from two scripts is how they drift.');
        process.exitCode = 1;
    }

    // 3. Index it - a job loads its charges by this column on every open, and
    //    the invoice screens look them up the same way.
    if (APPLY) {
        const [idx] = await sequelize.query(
            `SELECT 1 FROM pg_indexes WHERE tablename = 'Charge_Heads'
             AND indexname = 'charge_heads_customs_job'`
        );
        if (!idx.length) {
            await sequelize.query(
                `CREATE INDEX "charge_heads_customs_job"
                 ON "Charge_Heads"("CustomsJobId")`
            );
            console.log('  + Created index charge_heads_customs_job.');
        } else {
            console.log('  = index charge_heads_customs_job already exists.');
        }
    }

    if (APPLY) {
        // Report rather than assume: a wrong answer here is a broken screen.
        const after = await qi.describeTable('Charge_Heads');
        const ok = Boolean(after.CustomsJobId) && after.SEJobId?.allowNull;
        console.log('');
        console.log(ok
            ? 'Verified: CustomsJobId present, SEJobId nullable. Restart the backend.'
            : 'FAILED: the table still does not look right - see above.');
        if (!ok) process.exitCode = 1;
    } else {
        console.log('');
        console.log(pending
            ? `${pending} change(s) pending. Re-run with --apply.`
            : 'Nothing to do - the database is already up to date.');
    }

    await sequelize.close();
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
