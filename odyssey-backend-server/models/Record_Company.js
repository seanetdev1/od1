// Which companies see a master record - an account, party, charge, charge
// group, commodity or vessel - when Seanet has switched that table to
// per-company (functions/companySeparation.js). NO rows = every company, so
// switching a table on hides nothing until records are restricted; a record
// created in a company once the table is on starts with that company's row.
//
// One table for all of them, keyed by the model name: the legacy Climax system
// kept one per table (Gen_Parties_SubCompanyRight, Gen_Charges_SubCompanyRight,
// GL_COA_Company); this is the same idea without six copies of it.
//
// Plain columns, no foreign keys: a visibility row never blocks deleting the
// record or the company it names.
module.exports = (sequelize, DataTypes) => {
  const Record_Company = sequelize.define('Record_Company', {
    entity: { type: DataTypes.STRING(40), allowNull: false },
    recordId: { type: DataTypes.STRING(64), allowNull: false },
    CompanyId: { type: DataTypes.INTEGER, allowNull: false },
  }, {
    indexes: [
      { unique: true, fields: ['entity', 'recordId', 'CompanyId'] },
      { fields: ['entity', 'CompanyId'] },
    ],
  });
  return Record_Company;
};
