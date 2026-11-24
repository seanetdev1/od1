// Simple global key/value settings for the whole installation (not per-company).
// First use: "operationMode" (freight / customs / aviation). The presence of the
// operationMode row is itself the one-time lock — once it exists it is never
// updated (see routes/settings), so the mode can't be changed after it's set.
module.exports = (sequelize, DataTypes) => {
    const AppSetting = sequelize.define("AppSetting", {
        key: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        value: {
            type: DataTypes.TEXT,
        },
    });
    return AppSetting;
};
