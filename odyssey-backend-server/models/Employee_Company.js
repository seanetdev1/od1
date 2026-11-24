// Which companies an employee may work in. NO rows = every company - how
// every user worked before this existed, so nothing changes until Seanet
// restricts someone. Rows = only those (functions/companyAccess.js enforces
// it on every request; the header's company picker offers only them).
//
// The legacy Climax system had the same thing: CEAS_User_SubCompanyRight, with
// RestrictedSubCompany on the user.
//
// Plain columns rather than foreign keys, so a row here never stops an
// employee or a company being deleted.
module.exports = (sequelize, DataTypes) => {
  const Employee_Company = sequelize.define('Employee_Company', {
    EmployeeId: { type: DataTypes.UUID, allowNull: false },
    CompanyId: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    indexes: [{ unique: true, fields: ['EmployeeId', 'CompanyId'] }],
  });
  return Employee_Company;
};
