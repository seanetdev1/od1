module.exports = (sequelize, DataTypes) => {
    const Tasks = sequelize.define("Tasks", {
        title: { type:DataTypes.STRING },
        description: { type:DataTypes.TEXT },
        category: { type:DataTypes.STRING },
        status: { type:DataTypes.STRING },
        priority:{ type:DataTypes.STRING },

        // Two deadlines, deliberately.
        //   softDeadline - when it was wanted. Passing it is a nudge, not a
        //                  failure, and it is what the dashboard sorts by.
        //   hardDeadline - the real one. Passing it is late.
        // DATE, not STRING: `due` below is a string, which cannot be sorted,
        // compared or filtered by the database. It is kept only so existing
        // rows are not lost - scripts/addTaskFields.js copies it into
        // hardDeadline where it parses.
        softDeadline: { type:DataTypes.DATE },
        hardDeadline: { type:DataTypes.DATE },

        // When each deadline was escalated, so a sweep notifies once rather
        // than every time it runs. Null means "not yet warned".
        softNotifiedAt: { type:DataTypes.DATE },
        hardNotifiedAt: { type:DataTypes.DATE },

        // Recurrence. `none` (or null) is a one-off. When a recurring task is
        // completed the next instance is created from it, rather than a
        // scheduler generating them ahead of time - a year of unfinished
        // monthly tasks sitting in someone's list is noise, not planning.
        recurrence: { type:DataTypes.STRING },        // none|daily|weekly|monthly|quarterly
        recurrenceUntil: { type:DataTypes.DATE },     // stop generating after this
        // INTEGER, matching Tasks.id - which is an autoincrement integer, not
        // a UUID like Employees.id. Getting this wrong fails at insert with
        // 'invalid input syntax for type uuid'.
        parentTaskId: { type:DataTypes.INTEGER },     // the instance this came from

        due:{ type:DataTypes.STRING },
        requestedBy:{ type:DataTypes.STRING },
        assignedBy:{ type:DataTypes.STRING },
    })
    return Tasks;
}