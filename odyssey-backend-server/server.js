// Multi-core entrypoint. This is what `npm start` runs.
//
//   npm start   -> node server.js   (primary + N workers)
//   npm run dev -> nodemon index.js (one process, restarts on file change)
//
// `dev` stays single-process on purpose: N workers all restarting on every
// keystroke is slower and noisier than one, and a debugger can only attach to
// one process anyway.
//
// The sealed build does NOT use this file - the Docker image runs
// `node run.js` (build/dist/run.js -> index.jsc's exported start()), which is
// single-process. If you want clustering in the container too, change that
// CMD; everything below works the same way there.
//
// Two things have to be true for clustering to be safe, and both now are:
//   - Session state must be shared, or logout on one worker leaves the token
//     valid on the others. functions/sessionManager.js is Postgres-backed.
//   - Schema sync must happen exactly once, before any worker serves traffic.
//     That is what the await below is for.

const cluster = require('cluster');
const os = require('os');

// Default to one fewer than the core count, leaving a core for Postgres (which
// on a single-box on-prem install is competing with us for the same CPUs).
// On this 8-core machine that is 7. Override with ODYSSEY_WORKERS to pin an
// exact number - useful when the customer's box is sized differently, or to
// drop to 1 while reproducing something.
function workerCount() {
  const override = Number(process.env.ODYSSEY_WORKERS);
  if (Number.isInteger(override) && override > 0) return override;
  return Math.max(os.cpus().length - 1, 1);
}

if (cluster.isPrimary) {
  const count = workerCount();

  // Run the schema sync HERE, in the primary, with no workers alive yet.
  // Requiring ./models is what triggers sequelize.sync({alter:true}); we wait
  // for it to finish before forking so the workers come up against a schema
  // that is already correct and never issue ALTER statements themselves
  // (models/index.js skips the sync outright when cluster.isWorker).
  const db = require('./models');

  let shuttingDown = false;

  // Seed the first admin HERE, once, before any worker exists - for the same
  // reason the schema sync happens here. Every worker used to call this on
  // boot, all of them saw an empty Employees table at the same moment, and a
  // fresh install came up with one admin account per core and a different
  // password printed for each. Six of the seven did not work.
  async function seedOnce() {
    try {
      const { seedAdminUser } = require('./functions/seedAdmin');
      const seed = await seedAdminUser();
      if (seed.created) {
        console.log(`[seed] created initial admin user '${seed.username}'`);
        if (seed.generatedPassword) {
          console.log(
            [
              '[seed] ============================================================',
              `[seed]  Initial admin password: ${seed.generatedPassword}`,
              '[seed]  Shown once. Log in and change it now.',
              '[seed] ============================================================',
            ].join('\n')
          );
        }
      }
    } catch (err) {
      // Never block start-up on seeding - an install with no admin is
      // recoverable, one that will not boot is not.
      console.error('[seed] admin seeding failed:', err.message);
    }
  }

  db.syncPromise
    .then(() => {
      // syncPromise resolves even when the sync FAILED (it deliberately never
      // rejects), so don't claim success from the fact we got here - check
      // db.syncError. This used to print "schema in sync" immediately below
      // the SCHEMA SYNC FAILED banner, which is worse than saying nothing.
      if (db.syncError) {
        console.warn(
          `Primary ${process.pid} running - WARNING: schema is only partially ` +
          `migrated (see the banner above). Starting anyway.`
        );
      } else {
        console.log(`Primary ${process.pid} running - schema in sync`);
      }
      console.log(`Forking ${count} worker(s) on a ${os.cpus().length}-core host`);

      return seedOnce();
    })
    .then(() => {
      for (let i = 0; i < count; i++) {
        // Belt and braces alongside the isWorker check in models/index.js.
        cluster.fork({ ODYSSEY_SKIP_DB_SYNC: '1' });
      }
    })
    .catch((err) => {
      // syncPromise never rejects today, but if that ever changes, coming up
      // with an unmigrated schema would be worse than not coming up at all.
      console.error('Schema sync failed, refusing to fork workers:', err);
      process.exit(1);
    });

  cluster.on('exit', (worker, code, signal) => {
    // Don't fight an intentional shutdown - without this, Ctrl+C kills a
    // worker, we cheerfully replace it, and the process never dies.
    if (shuttingDown) return;

    console.error(
      `Worker ${worker.process.pid} died (code=${code} signal=${signal || 'none'}). Restarting.`
    );
    cluster.fork({ ODYSSEY_SKIP_DB_SYNC: '1' });
  });

  // Ctrl+C / docker stop: stop replacing workers, then ask them to exit.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${sig} received - shutting down ${Object.keys(cluster.workers).length} worker(s)`);
      for (const w of Object.values(cluster.workers)) w.kill();
      // Give them a moment to close connections, then go regardless.
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
} else {
  // Call the exported start() explicitly - do NOT rely on index.js's
  // `if (require.main === module) start()` guard. In a worker, require.main is
  // THIS file (server.js), not index.js, so that guard never fires: the worker
  // would load the whole app, bind nothing, and sit idle forever while the
  // primary happily reported "Forking 7 workers". That is exactly the trap
  // index.js documents for the bytecode launcher, which is why build/dist/
  // run.js also calls start() by hand.
  require('./index.js').start();
}
