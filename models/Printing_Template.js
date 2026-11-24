// A Word file an invoice, a B/L or an Air Waybill prints from -
// Configuration > Printing Templates (named Invoice Templates until 2026-11-01)
// (the user's design, 2026-10-28): the layout is the client's own document,
// with {field} names typed where the data goes (functions/printingTemplate).
//
// One per company and document: companyId null is every company, docType '*'
// every document. The most specific one that exists is used (findTemplate);
// with none, the invoice prints the built-in layout as before.
//
// The file itself is kept here rather than on the uploads volume, so the
// database backup is the whole of it.
module.exports = (sequelize, DataTypes) => {
    const Printing_Template = sequelize.define("Printing_Template", {
        companyId:    { type: DataTypes.INTEGER, allowNull: true },
        docType:      { type: DataTypes.STRING, allowNull: false, defaultValue: '*' },
        fileName:     { type: DataTypes.STRING, allowNull: false },
        content:      { type: DataTypes.BLOB, allowNull: false },
        // The {field} names found in it when it was saved, as a JSON list -
        // so the screen can show them without opening the file.
        tags:         { type: DataTypes.TEXT },
        uploadedById: { type: DataTypes.UUID },
    });
    return Printing_Template;
};
