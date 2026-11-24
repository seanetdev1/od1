const { DataTypes } = require('sequelize')
const { Employees } = require("../employeeAssociations/");
const { AssignTask, Sub_Tasks, Task_Logs, Tasks, Task_Attachments } = require("../../../models")

Employees.hasMany(AssignTask, { 
    foriegnKey:{
        type: DataTypes.UUID,
        allowNull:false
    }
})
AssignTask.belongsTo(Employees, {as : "assignedBy"});

Tasks.hasMany(Sub_Tasks,{
    foriegnKey:{
        allowNull:false
    }
})
Sub_Tasks.belongsTo(Tasks);

Employees.hasMany(Tasks,{
    foriegnKey:{
        allowNull:false
    }
})
Tasks.belongsTo(Employees);

Tasks.hasMany(Task_Logs,{
    foriegnKey:{
        allowNull:false
    }
})
Task_Logs.belongsTo(Tasks);

// Attachment metadata. Deleting a task takes its attachment rows with it;
// the files themselves are removed explicitly by the route, because Sequelize
// cascades cannot unlink anything from disk.
Tasks.hasMany(Task_Attachments, { onDelete: 'CASCADE' });
Task_Attachments.belongsTo(Tasks);

// A task's own history goes with it when it is deleted.
Tasks.hasMany(Task_Logs, { onDelete: 'CASCADE' });

module.exports = { Tasks, Sub_Tasks, Task_Logs, AssignTask, Task_Attachments }

