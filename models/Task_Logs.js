// What happened to a task, and who did it.
//
// The model existed with only `title` and `status` and was never written to -
// nothing recorded task history at all. "Who moved this to Done, and when" is
// the first question anyone asks of a task system, and it cannot be answered
// retrospectively: history has to be written as it happens.
//
// One row per change. Append-only by convention - nothing updates or deletes
// these except the cascade when the task itself goes.
module.exports = (sequelize, DataTypes) => {
    const Task_Logs = sequelize.define("Task_Logs", {
        // created | status | reassigned | edited | attachment | recurrence
        action: { type: DataTypes.STRING },
        // Which field changed, for `edited`.
        field: { type: DataTypes.STRING },
        fromValue: { type: DataTypes.TEXT },
        toValue: { type: DataTypes.TEXT },
        // Name captured at the time. The employee row may be renamed or
        // deleted later; the history should still read correctly.
        actorName: { type: DataTypes.STRING },
        actorId: { type: DataTypes.UUID },
        note: { type: DataTypes.TEXT },

        // Original columns, unused but kept so nothing that reads them breaks.
        title: { type: DataTypes.STRING },
        status: { type: DataTypes.INTEGER },
    })
    return Task_Logs;
}
