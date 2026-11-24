module.exports = (sequelize, DataTypes) => {
  const Clients = sequelize.define("Clients", {
    code: { type:DataTypes.STRING },
    name: { type:DataTypes.STRING },
    city: { type:DataTypes.STRING },
    zip: { type:DataTypes.STRING },
    person1: { type:DataTypes.STRING },
    mobile1: { type:DataTypes.STRING },
    person2: { type:DataTypes.STRING },
    mobile2: { type:DataTypes.STRING },
    telephone1: { type:DataTypes.STRING },
    telephone2: { type:DataTypes.STRING },
    address2: { type:DataTypes.STRING },
    address1: { type:DataTypes.STRING },
    website: { type:DataTypes.STRING },
    accountsMail: { type:DataTypes.STRING },
    infoMail: { type:DataTypes.STRING },
    strn: { type:DataTypes.STRING },
    ntn: { type:DataTypes.STRING },
    registerDate: { type:DataTypes.STRING },
    operations: { type:DataTypes.STRING },
    types: { type:DataTypes.STRING },
    bankAuthorizeDate: { type:DataTypes.STRING },
    bank: { type:DataTypes.STRING },
    branchName: { type:DataTypes.STRING },
    branchCode: { type:DataTypes.STRING },
    accountNo: { type:DataTypes.STRING },
    iban: { type:DataTypes.STRING },
    swiftCode: { type:DataTypes.STRING },
    routingNo: { type:DataTypes.STRING },
    ifscCode: { type:DataTypes.STRING },
    micrCode: { type:DataTypes.STRING },
    currency: { type:DataTypes.STRING },
    createdBy:{ type:DataTypes.STRING },
    nongl:{ type:DataTypes.STRING },
    active:{
      type:DataTypes.BOOLEAN,
    },
    // Credit terms (2026-10-23): how long an invoice to this party may stay
    // unpaid, and how much it may owe. Null means none set - not zero, which
    // is a party given no credit at all. See functions/partyCredit.
    creditLimitDays: { type:DataTypes.INTEGER },
    creditLimitAmount: { type:DataTypes.DECIMAL(18, 2) },
    climaxId: { type:DataTypes.INTEGER },
  }, { indexes: [{ fields: ['climaxId'] }] })
  return Clients;
}