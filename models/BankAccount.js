// A bank account belonging to a Company, shown on that company's invoices.
// A company can have several. `label` is a short name for the admin to tell
// them apart (e.g. "Soneri - Main").
module.exports = (sequelize, DataTypes) => {
    const BankAccount = sequelize.define("BankAccount", {
        label:      { type: DataTypes.STRING },
        bankName:   { type: DataTypes.STRING },
        accountTitle:{ type: DataTypes.STRING },
        accountNo:  { type: DataTypes.STRING },
        iban:       { type: DataTypes.STRING },
        branch:     { type: DataTypes.STRING },
        swift:      { type: DataTypes.STRING },
    });
    return BankAccount;
};
