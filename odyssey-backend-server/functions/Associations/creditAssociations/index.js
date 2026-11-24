// Credit control - functions/creditControl. Every foreign key is declared on
// its model already, so these only name the joins; they add no columns.
const { Credit_Block, Credit_Unblock_Request, Credit_Omission, Clients, Employees, Invoice } = require('../../../models');

const noConstraints = { constraints: false };

Credit_Block.belongsTo(Clients, { foreignKey: 'ClientId', ...noConstraints });
Credit_Block.belongsTo(Employees, { as: 'approvedBy', foreignKey: 'approvedById', ...noConstraints });

Credit_Unblock_Request.belongsTo(Clients, { foreignKey: 'ClientId', ...noConstraints });
Credit_Unblock_Request.belongsTo(Employees, { as: 'requestedBy', foreignKey: 'requestedById', ...noConstraints });
Credit_Unblock_Request.belongsTo(Employees, { as: 'decidedBy', foreignKey: 'decidedById', ...noConstraints });

Credit_Omission.belongsTo(Invoice, { foreignKey: 'InvoiceId', ...noConstraints });
Credit_Omission.belongsTo(Employees, { as: 'omittedBy', foreignKey: 'omittedById', ...noConstraints });

module.exports = { Credit_Block, Credit_Unblock_Request, Credit_Omission };
