// Database connection config, built from the environment.
//
// This replaces the old config/config.json, which carried a literal password
// ("abc.123") for development, test AND production and was not gitignored.
// There is deliberately no password default here: on a leased on-prem build
// every install has its own database credentials, and a shared fallback in a
// tracked file is exactly the thing that ends up in production untouched.
//
// Two ways to point this at a database, in priority order:
//   1. DATABASE_URL  - a full postgres:// URL. What the Docker deploy uses
//                      (see docker-compose.yml). Overrides everything below.
//   2. DB_USER / DB_PASS / DB_NAME / DB_HOST / DB_PORT - discrete fields, for
//                      running from source against a local Postgres.
//
// Only the credentials are demanded; host/port/database keep dev-friendly
// defaults so a local checkout needs one line in .env, not five.

const path = require('path');

// Defensive: index.js calls dotenv before requiring models, but the one-off
// scripts in scripts/ require models directly with no such bootstrap. Loading
// here (idempotent - dotenv never overwrites an already-set var) means those
// scripts pick up the same .env the server does instead of failing on a
// missing DB_PASS that is in fact sitting right there.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  // dotenv is a normal dependency; if it is genuinely absent we still work
  // fine from real environment variables, so this is not worth failing on.
}

const isTest = process.env.NODE_ENV === 'test';

function requireDbSecret(name, forEnv) {
  const val = process.env[name];
  if (val && val.trim()) return val;
  throw new Error(
    `[config] ${name} is not set, and no DATABASE_URL was provided either. ` +
    `Set ${name} in the backend's .env (or supply DATABASE_URL) before ` +
    `starting in "${forEnv}" mode. See odyssey.env.example for the full list. ` +
    `There is intentionally no built-in default - every install supplies its own.`
  );
}

// Build a config block lazily: the getters mean requiring this file never
// throws on its own. Only the block Sequelize actually reads is validated, so
// running tests doesn't demand production credentials and vice versa.
function build({ database, useEnvVariable }) {
  const base = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    database,
    dialect: 'postgres',
  };

  if (useEnvVariable) {
    base.use_env_variable = useEnvVariable;
  }

  // When DATABASE_URL is present Sequelize parses credentials out of the URL
  // and never touches username/password, so don't demand them.
  const haveUrl = Boolean(useEnvVariable && process.env[useEnvVariable]);

  Object.defineProperties(base, {
    username: {
      enumerable: true,
      get() {
        if (haveUrl) return undefined;
        return process.env.DB_USER || 'postgres';
      },
    },
    password: {
      enumerable: true,
      get() {
        if (haveUrl) return undefined;
        // The test database is expected to be a throwaway local one, but it
        // still gets no hardcoded password - CI and dev both read DB_PASS.
        return requireDbSecret('DB_PASS', isTest ? 'test' : 'development');
      },
    },
  });

  return base;
}

// NOTE on the test block: it deliberately does NOT read DB_NAME. tests/
// setupTestDb.js drops and recreates whatever database this names, so if
// DB_NAME (pointing at the real database) could reach here, running the suite
// with a normal .env loaded would destroy production data. The test database
// is only overridable through its own dedicated DB_NAME_TEST.
module.exports = {
  development: build({ database: process.env.DB_NAME || 'odyssey-test' }),
  test: build({ database: process.env.DB_NAME_TEST || 'odyssey-test' }),
  production: build({ database: process.env.DB_NAME || 'odyssey-prod', useEnvVariable: 'DATABASE_URL' }),
};
