const { Company, BankAccount } = require('../../../models');

// A company has many bank accounts; deleting a company removes its accounts.
Company.hasMany(BankAccount, { onDelete: 'CASCADE' });
BankAccount.belongsTo(Company);

module.exports = { Company, BankAccount };
