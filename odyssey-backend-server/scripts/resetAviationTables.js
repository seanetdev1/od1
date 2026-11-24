#!/usr/bin/env node
/*
 * Drop and recreate the two Aviation_* tables.
 *
 * WHY THIS IS NEEDED
 *
 * Aviation_Consignments was created by an earlier boot WITHOUT its foreign key
 * columns - AviationJobId, ClientId, CommodityId. Symptom:
 *
 *   column Aviation_Consignments.AviationJobId does not exist   (Postgres 42703)
 *
 * Those three columns are not declared in models/Aviation_Consignment.js. They
 * are attached as a side effect of the hasMany/belongsTo calls in
 * functions/Associations/aviationAssociations. If the server boots with the
 * model present but that association file not yet loaded - which is what
 * happens when nodemon restarts midway through the files being added - then
 * sync() creates the table from the declared columns alone.
 *
 * ODYSSEY_DB_SYNC defaults to 'create', i.e. CREATE TABLE IF NOT EXISTS, so
 * every later restart sees a table that already exists and leaves it alone.
 * The table never catches up on its own. Same trap the comments in
 * models/index.js describe for association-only columns.
 *
 * SAFE TO RUN because these two tables are new to this install and nothing
 * else references them - no SE_Job, Charge_Head or Invoice row points at an
 * aviation job. It DOES delete any aviation jobs already entered, so it counts
 * them first and makes you pass --apply.
 *
 *   node scripts/resetAviationTables.js            # dry run: counts only
 *   node scripts/resetAviationTables.js --apply
 */
const db = require('../models');
const { sequelize } = db;
const { Aviation_Job, Aviation_Consignment } = require('../functions/Associations/aviationAssociations');

const APPLY = process.argv.includes('--apply');

// Child first when dropping (it points at the parent), parent first when
// creating (the child's foreign key needs something to reference).
const qi = () => sequelize.getQueryInterface();

async function tableExists(name) {
    const tables = await qi().showAllTables();
    return tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes(name);
}

async function countOrNull(model) {
    try { return await model.count(); } catch (_) { return null; }
}

async function main() {
    await sequelize.authenticate();

    // Requiring ../models starts the boot sync in the background. Wait for it
    // to finish before touching anything - and above all before close(), since
    // closing the connection manager underneath a running sync makes it fail
    // mid-table and print a "SCHEMA SYNC FAILED - the database is not fully
    // migrated" banner that has nothing to do with the real schema.
    // syncPromise never rejects and resolves immediately when sync is skipped.
    await db.ready;

    const jobsExist = await tableExists('Aviation_Jobs');
    const linesExist = await tableExists('Aviation_Consignments');
    const jobCount = jobsExist ? await countOrNull(Aviation_Job) : null;
    const lineCount = linesExist ? await countOrNull(Aviation_Consignment) : null;

    console.log('Current state:');
    console.log(`  Aviation_Jobs         : ${jobsExist ? `${jobCount ?? '?'} row(s)` : 'missing'}`);
    console.log(`  Aviation_Consignments : ${linesExist ? `${lineCount ?? '?'} row(s)` : 'missing'}`);

    if (!APPLY) {
        console.log('\nDRY RUN - nothing changed.');
        console.log('Re-run with --apply to drop and recreate both tables.');
        if (jobCount) console.log(`WARNING: this will delete ${jobCount} aviation job(s).`);
        await sequelize.close();
        return;
    }

    console.log('\nDropping:');
    if (linesExist) { await qi().dropTable('Aviation_Consignments'); console.log('  - Aviation_Consignments'); }
    if (jobsExist)  { await qi().dropTable('Aviation_Jobs');         console.log('  - Aviation_Jobs'); }

    console.log('\nRecreating from the models (associations are loaded, so the');
    console.log('foreign key columns come with them this time):');
    await Aviation_Job.sync();
    console.log('  + Aviation_Jobs');
    await Aviation_Consignment.sync();
    console.log('  + Aviation_Consignments');

    // Prove the columns that were missing are actually there now, rather than
    // reporting success and leaving you to find out from the next 500.
    const cols = await qi().describeTable('Aviation_Consignments');
    // AviationAwbId is the registered number the AWB was taken out of stock
    // as. Like the others it exists only because the association file adds it,
    // so it belongs in this list rather than in the model's `indexes`.
    const required = ['AviationJobId', 'shipperId', 'consigneeId', 'masterAgentId', 'CommodityId', 'AviationAwbId'];
    const missing = required.filter((c) => !cols[c]);

    // Index the foreign keys here rather than in the model's `indexes` option.
    // Declaring an index on an association-added column there makes sync()
    // throw if the column is not present, and sync() stops at the first
    // failure - so a missing index would skip every model after it. Doing it
    // here, once the columns are verified, keeps boot unable to fail this way.
    if (!missing.length) {
        for (const col of required) {
            const name = `aviation_consignments_${col.toLowerCase()}`;
            const [existing] = await sequelize.query(
                `SELECT 1 FROM pg_indexes WHERE tablename = 'Aviation_Consignments' AND indexname = :name`,
                { replacements: { name } }
            );
            if (existing.length) continue;
            await sequelize.query(`CREATE INDEX "${name}" ON "Aviation_Consignments"("${col}")`);
            console.log(`  + index ${name}`);
        }
    }

    if (missing.length) {
        console.error(`\nFAILED: still missing ${missing.join(', ')}.`);
        console.error('The association file did not load. Check that models/index.js requires');
        console.error("'../functions/Associations/aviationAssociations' BEFORE sync().");
        process.exitCode = 1;
    } else {
        console.log(`\nVerified: ${required.join(', ')} all present.`);
        console.log('Done. Restart the backend.');
    }

    await sequelize.close();
}

main().catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
});
