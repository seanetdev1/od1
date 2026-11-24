// Server-side record of the one token each user is currently allowed to use.
//
// This lives in Postgres rather than in process memory because it has to be
// shared. With an in-process cache, logging out on one cluster worker left the
// token valid on every other worker, and single-session enforcement could be
// defeated just by landing a second login on a worker that had no record of
// the first. A row in the database is the only copy, so every process agrees.
//
// One row per user - userId is the primary key, so a new login for a user
// simply overwrites (upserts) their previous session. That IS the
// single-active-session rule, enforced by the schema rather than by code.

module.exports = (sequelize, DataTypes) => {
  const Session = sequelize.define(
    'Session',
    {
      // STRING rather than INTEGER: ids arrive from the JWT payload and from
      // callers as both numbers and strings, and sessionManager normalises
      // every one of them through String(userId) before it gets here.
      userId: {
        type: DataTypes.STRING(64),
        primaryKey: true,
        allowNull: false,
      },
      // TEXT, not STRING: a signed JWT carrying the access list runs well past
      // Postgres' 255-char varchar default.
      token: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // Mirrors the token's own 12h expiry. Rows are pruned past this point so
      // the table doesn't grow forever, and a row that somehow outlives its
      // token is treated as absent on read.
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      indexes: [{ fields: ['expiresAt'] }],
    }
  );

  return Session;
};
