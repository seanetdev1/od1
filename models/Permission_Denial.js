// Requests the permission rules refused - or, in audit mode, WOULD have
// refused while letting them through (functions/permissions/middleware.js).
// One row per user + route, counted, so a busy screen is one row and not ten
// thousand. Config > Access shows them: in audit mode they are the list of
// grants to add before switching to enforce.
//
// EmployeeId is a plain column, not a foreign key: this is a log, and a log
// row must never stop an employee being deleted.
module.exports = (sequelize, DataTypes) => {
  const Permission_Denial = sequelize.define('Permission_Denial', {
    EmployeeId: { type: DataTypes.UUID, allowNull: false },
    method: { type: DataTypes.STRING(8), allowNull: false },
    path: { type: DataTypes.STRING, allowNull: false },
    // The alternatives the route accepts, as the rule table states them.
    required: { type: DataTypes.TEXT },
    // 'audit' - let through; 'enforce' - refused.
    mode: { type: DataTypes.STRING(8) },
    count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    lastAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    indexes: [{ unique: true, fields: ['EmployeeId', 'method', 'path'] }],
  });
  return Permission_Denial;
};
