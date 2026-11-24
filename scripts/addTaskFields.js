/**
 * Schema change for the tasks feature.
 *
 *   node scripts/addTaskFields.js            <- report what it would do
 *   node scripts/addTaskFields.js --apply    <- apply it
 *
 * Boot runs with ODYSSEY_DB_SYNC=create, which creates missing tables and
 * never ALTERs an existing one - so a column added to a model does not appear
 * in a database that already has that table. This adds them deliberately,
 * touching only the tasks and notifications tables rather than letting a
 * blanket `alter` sync loose on all 45.
 *
 * WHAT IT DOES
 *
 *   Tasks.description     TEXT
 *   Tasks.softDeadline    TIMESTAMPTZ   when it was wanted
 *   Tasks.hardDeadline    TIMESTAMPTZ   when it is late
 *   Notifications.recipientId  UUID     who it is for; null = broadcast
 *   Task_Attachments      whole table, if missing
 *
 * It also copies the old `due` column into hardDeadline for existing rows
 * where the string parses as a date. `due` is left in place - it is not this
 * script's business to drop a column that might still hold something someone
 * typed.
 *
 * Safe to re-run: every step checks first.
 */

const path = require('path');

const env = process.env.NODE_ENV || 'development';
const cfg = require(path.join(__dirname, '..', 'config', 'config'))[env];
const { Client } = require('pg');

const APPLY = process.argv.includes('--apply');

const COLUMNS = [
  { table: 'Tasks',         column: 'description',   type: 'TEXT' },
  { table: 'Tasks',         column: 'softDeadline',  type: 'TIMESTAMP WITH TIME ZONE' },
  { table: 'Tasks',         column: 'hardDeadline',  type: 'TIMESTAMP WITH TIME ZONE' },
  { table: 'Notifications', column: 'recipientId',   type: 'UUID' },

  // Deadline escalation: stamped when a notification goes out, so an overdue
  // task is announced once rather than on every sweep.
  { table: 'Tasks',         column: 'softNotifiedAt', type: 'TIMESTAMP WITH TIME ZONE' },
  { table: 'Tasks',         column: 'hardNotifiedAt', type: 'TIMESTAMP WITH TIME ZONE' },

  // Recurrence.
  { table: 'Tasks',         column: 'recurrence',      type: 'VARCHAR(255)' },
  { table: 'Tasks',         column: 'recurrenceUntil', type: 'TIMESTAMP WITH TIME ZONE' },
  // INTEGER: Tasks.id is an autoincrement integer, not a UUID.
  { table: 'Tasks',         column: 'parentTaskId',    type: 'INTEGER' },

  // Audit trail. The table exists but only ever had title/status.
  { table: 'Task_Logs',     column: 'action',     type: 'VARCHAR(255)' },
  { table: 'Task_Logs',     column: 'field',      type: 'VARCHAR(255)' },
  { table: 'Task_Logs',     column: 'fromValue',  type: 'TEXT' },
  { table: 'Task_Logs',     column: 'toValue',    type: 'TEXT' },
  { table: 'Task_Logs',     column: 'actorName',  type: 'VARCHAR(255)' },
  { table: 'Task_Logs',     column: 'actorId',    type: 'UUID' },
  { table: 'Task_Logs',     column: 'note',       type: 'TEXT' },

  // The charge master gained a climaxId so the import can tell a re-run from a
  // first run. Without it the old importer had nowhere to record which legacy
  // charge a row came from, so a second run duplicated the whole catalogue.
  // `code` stays INTEGER - /charges/create issues codes with max(code)+1.
  { table: 'Charges',       column: 'climaxId',   type: 'INTEGER' },

  // Foreign keys.
  //
  // These come from the ASSOCIATION, not the model file, so a table created by
  // a boot that ran before its association was declared gets the table without
  // its FK - and ODYSSEY_DB_SYNC=create never ALTERs an existing table, so no
  // later boot can add it. Task_Attachments landed in exactly that window and
  // every query joining it failed with
  //     column Task_Attachments.TaskId does not exist
  //
  // INTEGER, matching Tasks.id.
  { table: 'Task_Attachments', column: 'TaskId', type: 'INTEGER' },
  { table: 'Task_Logs',        column: 'TaskId', type: 'INTEGER' },
];

async function main() {
  const client = new Client({
    host: cfg.host, port: cfg.port, user: cfg.username,
    password: cfg.password, database: cfg.database,
  });
  await client.connect();

  console.log(`\nDatabase: ${cfg.database} on ${cfg.host} (NODE_ENV=${env})`);
  console.log(APPLY ? 'Mode: APPLY\n' : 'Mode: REPORT ONLY (nothing will change)\n');

  const tableExists = async (t) =>
    (await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public."${t}"`])).rows[0].ok;

  const columnExists = async (t, c) =>
    (await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, c]
    )).rowCount > 0;

  const todo = [];

  for (const c of COLUMNS) {
    if (!(await tableExists(c.table))) {
      console.log(`  SKIP    ${c.table}.${c.column}  (table does not exist - it will be created on next boot)`);
      continue;
    }
    if (await columnExists(c.table, c.column)) {
      console.log(`  exists  ${c.table}.${c.column}`);
    } else {
      console.log(`  ADD     ${c.table}.${c.column}  ${c.type}`);
      todo.push(c);
    }
  }

  const attachmentsTable = await tableExists('Task_Attachments');
  console.log(attachmentsTable
    ? '  exists  Task_Attachments'
    : '  CREATE  Task_Attachments  (or let the next boot create it)');

  // How many rows would gain a hardDeadline from the old `due` string.
  let backfill = 0;
  if (await tableExists('Tasks') && await columnExists('Tasks', 'due')) {
    const q = await client.query(`
      SELECT COUNT(*)::int AS n FROM public."Tasks"
       WHERE "due" IS NOT NULL AND "due" <> ''
    `);
    backfill = q.rows[0].n;
    console.log(`  ${backfill} existing task(s) have a "due" string that can be copied into hardDeadline`);
  }

  if (!todo.length && attachmentsTable) {
    console.log('\nSchema is already up to date.\n');
    await client.end();
    return;
  }

  if (!APPLY) {
    console.log('\nRe-run with --apply to make these changes.\n');
    await client.end();
    return;
  }

  // One transaction: a half-applied schema change is the thing that makes an
  // upgrade hard to reason about afterwards.
  await client.query('BEGIN');
  try {
    for (const c of todo) {
      await client.query(`ALTER TABLE public."${c.table}" ADD COLUMN "${c.column}" ${c.type}`);
      console.log(`  added   ${c.table}.${c.column}`);
    }

    if (todo.some((c) => c.column === 'hardDeadline') && backfill) {
      // Only where the string actually parses - a "due" of "next week" is not
      // a date and must not become one. Postgres would abort the whole
      // statement on a bad cast, so this filters first.
      const r = await client.query(`
        UPDATE public."Tasks"
           SET "hardDeadline" = "due"::timestamptz
         WHERE "due" IS NOT NULL AND "due" <> ''
           AND "hardDeadline" IS NULL
           AND "due" ~ '^\\d{4}-\\d{2}-\\d{2}'
      `);
      console.log(`  copied  ${r.rowCount} due -> hardDeadline (rows whose value parsed as a date)`);
    }

    await client.query('COMMIT');
    console.log('\nDone.\n');
    if (!attachmentsTable) {
      console.log('Task_Attachments will be created by the next boot (ODYSSEY_DB_SYNC=create '
        + 'creates missing tables).\n');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nFAILED - rolled back, nothing was changed:\n ', err.message, '\n');
    process.exitCode = 1;
  }

  await client.end();
}

main().catch((err) => {
  console.error('\nScript failed:', err.message, '\n');
  process.exit(1);
});
