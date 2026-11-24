const {DataTypes} = require("sequelize")
const {Notifications} = require('../../../models')
const {Employees} = require('../../../models')


Notifications.belongsTo(Employees, {as : "createdBy"})

// Who the notification is FOR.
//
// Until now a notification had only a createdBy, and /getAllNotifications
// returned the newest 20 to everybody - a global feed, not an inbox. There was
// no way to tell one user something.
//
// recipientId is nullable on purpose: null keeps the old broadcast behaviour
// (the accounts feed still works untouched), and a value makes it targeted.
Employees.hasMany(Notifications, { as: 'inbox', foreignKey: 'recipientId' });
Notifications.belongsTo(Employees, { as: 'recipient', foreignKey: 'recipientId' });

module.exports = { Notifications }