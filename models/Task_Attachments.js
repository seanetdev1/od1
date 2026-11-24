// Files attached to a task.
//
// The bytes live on disk (functions/attachmentStore.js), not in this table -
// only the metadata is here. A row without its file on disk is a broken
// download; a file on disk without a row is unreachable. The upload route
// writes the file first and the row second, so a crash between the two leaves
// an orphaned file rather than a broken link.
module.exports = (sequelize, DataTypes) => {
    const Task_Attachments = sequelize.define("Task_Attachments", {
        // What the user called it. Shown in the UI, used for the download name.
        originalName: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: { notEmpty: true },
        },
        // What it is called on disk: a generated id, never the user's filename.
        // A name that came from a client must never reach the filesystem.
        storedName: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: { notEmpty: true },
        },
        mimeType: { type: DataTypes.STRING },
        // Bytes. Kept so the UI can show a size without touching the disk.
        size: { type: DataTypes.INTEGER },
        uploadedBy: { type: DataTypes.STRING },
    });
    return Task_Attachments;
}
