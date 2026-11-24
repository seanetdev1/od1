// A document attached to a record - a scan on a job, a voucher, an invoice
// (the user's request, 2026-11-13). Every kind of record shares this one
// table, as Record_Company does: `entity` is the record's model name and
// `recordId` its id, and functions/documents/kinds.js says which kinds may
// have documents and who may see and change them.
//
// The file itself is on disk (functions/documents/store.js); storedName is
// where INSIDE the documents folder - never the folder itself, which
// Configuration can move. Plain columns, no foreign keys: a document never
// blocks deleting the record it is on.
//
// DELETING ONE ONLY MARKS IT (paranoid: deletedAt, and who) - the file stays
// on disk, so a document removed by mistake can be put back by clearing
// deletedAt.
module.exports = (sequelize, DataTypes) => {
  const Document = sequelize.define('Document', {
    entity: { type: DataTypes.STRING(40), allowNull: false },
    recordId: { type: DataTypes.STRING(64), allowNull: false },
    // The file's own name, as it was picked: scan020.pdf. Its extension says
    // what kind of file it is.
    originalName: { type: DataTypes.STRING(255), allowNull: false },
    // The name the user gave it - "Invoice JI-123/27" - shown in place of the
    // file's, and what it downloads as (the user's request, 2026-11-13).
    // Empty: the file's name is shown.
    title: { type: DataTypes.STRING(200) },
    // Where it is in the store: 2026/11/<uuid>.pdf. Never the user's name.
    storedName: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    mimeType: { type: DataTypes.STRING(100) },
    size: { type: DataTypes.INTEGER },
    // The same file twice on one record is refused; this is how it is known.
    sha256: { type: DataTypes.STRING(64) },
    // What it is - Invoice, Bill of Lading... - by the number of its type in
    // Configuration > Documents (functions/documents/settings.js), so a type
    // renamed there is renamed on every document that has it.
    typeId: { type: DataTypes.INTEGER },
    uploadedById: { type: DataTypes.UUID },
    uploadedBy: { type: DataTypes.STRING },
    deletedById: { type: DataTypes.UUID },
    deletedBy: { type: DataTypes.STRING },
  }, {
    paranoid: true,
    indexes: [
      { fields: ['entity', 'recordId'] },
      { fields: ['sha256'] },
    ],
  });
  return Document;
};
