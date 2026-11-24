// One duty line on a goods declaration: one item, and how it is assessed.
//
// WHY THIS TABLE EXISTS
// The customs module first held duty as eight AMOUNT columns on Customs_Job -
// one figure per head, for the whole declaration. The legacy Climax system
// (Log_DutyCalculation) does neither of those things: it holds duty as RATES
// against the values they apply to, and it holds one row PER ITEM on the GD.
//
// Migrating rates into amounts means deriving figures the source never stored,
// and collapsing items into one row means throwing away which item was
// assessed at what. Both are lossy in a direction that cannot be undone, so
// this table matches the source instead: rates, per item.
//
// Amounts are DERIVED - see functions/customsDuty.js, which is the one place
// that turns a rate into money. Nothing here stores a computed figure, for the
// same reason a flight stores no total uplift: a stored total is free to drift
// from its own parts the moment one of them is corrected.
//
// FIELD NAMES are Odyssey's, not Climax's - readable camelCase rather than
// ASSValue/CDPerc/DOLOLOCharges. The legacy name each one came from is in the
// comment beside it, so the mapping lives here rather than only in the
// migration that populated it.
//
// New table, so ODYSSEY_DB_SYNC=create creates it on boot, and the customs
// alter-sync in models/index.js keeps it in step while the module is young.
module.exports = (sequelize, DataTypes) => {
    const Customs_Duty = sequelize.define("Customs_Duty", {
        // Ordering within the declaration, so the lines read the way the GD
        // lists them rather than by insertion id.
        sortOrder:   { type:DataTypes.INTEGER, defaultValue:0 },

        // WHICH ITEM THIS IS.
        //
        // itemNo is the line number as the declaration prints it - a STRING,
        // because it is an identifier and arithmetic on it is meaningless.
        // CommodityId is attached by the association file.
        itemNo:      { type:DataTypes.STRING },        // Log_DutyCalculation.ItemNo
        modelNo:     { type:DataTypes.STRING },        // ModelNo
        quantity:    { type:DataTypes.DOUBLE },        // Quantity
        // The SRO (Statutory Regulatory Order) claimed on this line. It is what
        // justifies a concessionary rate, so a line with an unusual rate and no
        // SRO is exactly the thing an audit asks about.
        sroNumber:   { type:DataTypes.STRING },        // SRONumber
        // Origin of the goods on this line, as a UN/LOCODE. Duty rates vary by
        // origin under trade agreements, which is why it sits on the line and
        // not on the job.
        originCode:  { type:DataTypes.STRING },        // PortOfOriginCode

        // THE VALUES DUTY IS CALCULATED ON.
        //
        // assessedValue is the customs value for THIS line - the base almost
        // every rate below applies to. Distinct from Customs_Job.assessedValue,
        // which is the declaration's total as the legacy job header recorded
        // it: the lines are what customs assessed, the header is what the file
        // says, and they are allowed to disagree.
        assessedValue:  { type:DataTypes.DOUBLE },     // ASSValue
        fobValue:       { type:DataTypes.DOUBLE },     // FOBValue
        cnfValue:       { type:DataTypes.DOUBLE },     // CNFValue
        freight:        { type:DataTypes.DOUBLE },     // Freight
        insuranceValue: { type:DataTypes.DOUBLE },     // InsuranceValue
        exchangeRate:   { type:DataTypes.DOUBLE },     // ExchangeRate
        // Landing charges, as a percentage added to CNF to reach the assessable
        // value. Carried as the rate it is stored as; it is not one of the duty
        // heads and is never billed.
        landingInsPerc: { type:DataTypes.DOUBLE },     // LandingInsPerc

        // The four Total* columns Climax keeps alongside the per-line values.
        //
        // CARRIED VERBATIM AND USED BY NOTHING HERE. Whether they are the
        // declaration's totals repeated on every line or this line's value
        // times its quantity is not established, and a figure whose meaning is
        // a guess must not feed a calculation. They are kept so the data is not
        // lost, and so the question can be settled later against a real GD.
        totalFob:       { type:DataTypes.DOUBLE },     // TotalFOB
        totalCnf:       { type:DataTypes.DOUBLE },     // TotalCNF
        totalFreight:   { type:DataTypes.DOUBLE },     // TotalFreight
        totalInsurance: { type:DataTypes.DOUBLE },     // TotalInsurance

        // Whether freight is included in the declared value, and whether the
        // assessment is provisional (subject to revision).
        isFreight:   { type:DataTypes.BOOLEAN },       // IsFreight
        isProvision: { type:DataTypes.BOOLEAN },       // IsProvision

        // THE RATES. Percentages, exactly as the declaration states them.
        //
        // The order is the order an assessment applies them in, and the cascade
        // that turns them into money lives in functions/customsDuty.js. Each
        // head's base differs - sales tax is charged on the value PLUS the
        // duties above it - which is precisely why storing amounts and calling
        // them "the duty" hid the calculation instead of recording it.
        customDutyPerc:         { type:DataTypes.DOUBLE },   // CDPerc
        additionalCustomDutyPerc:{ type:DataTypes.DOUBLE },  // AdditionalCDPerc
        regulatoryDutyPerc:     { type:DataTypes.DOUBLE },   // RDPerc
        federalExcisePerc:      { type:DataTypes.DOUBLE },   // FEDPerc
        salesTaxPerc:           { type:DataTypes.DOUBLE },   // SalesTaxPerc
        additionalSalesTaxPerc: { type:DataTypes.DOUBLE },   // AdditionalSTaxPerc
        incomeTaxPerc:          { type:DataTypes.DOUBLE },   // IncomeTaxPerc
        whSurchargePerc:        { type:DataTypes.DOUBLE },   // WHSurchargePerc
        salesTaxOnServicesPerc: { type:DataTypes.DOUBLE },   // SITaxPerc
        excisePerc:             { type:DataTypes.DOUBLE },   // ExcisePerc

        // FLAT AMOUNTS, not rates.
        //
        // Everything below is entered as money on the declaration rather than
        // derived from a rate - terminal and delivery-order charges, penalties,
        // and the two time-based ones. They are still duty-side figures the
        // client is answerable for, which is why they live here and not among
        // the agent's own Charge_Heads: those are what the agent bills, these
        // are what customs and the terminal charged.
        deliveryOrder:        { type:DataTypes.DOUBLE },   // DO
        doLoloCharges:        { type:DataTypes.DOUBLE },   // DOLOLOCharges
        doInsurance:          { type:DataTypes.DOUBLE },   // DOInsurance
        doEndorsementCharges: { type:DataTypes.DOUBLE },   // DOEndorsmentCharges
        doThc:                { type:DataTypes.DOUBLE },   // DOTHC
        doBankCharges:        { type:DataTypes.DOUBLE },   // DOBankCharges
        doBlSplitting:        { type:DataTypes.DOUBLE },   // DOBLSpliting
        doAgencyCharges:      { type:DataTypes.DOUBLE },   // DOAgencyCharges
        doLclCharges:         { type:DataTypes.DOUBLE },   // DOLCLCharges
        eto:                  { type:DataTypes.DOUBLE },   // ETO
        otherSecurity:        { type:DataTypes.DOUBLE },   // OtherSecurity
        otherWharfage:        { type:DataTypes.DOUBLE },   // OtherWharfage
        stampDuty:            { type:DataTypes.DOUBLE },   // StampDuty
        fine:                 { type:DataTypes.DOUBLE },   // Fine
        fineSection82:        { type:DataTypes.DOUBLE },   // FineSection82
        fineInvoiceNotFound:  { type:DataTypes.DOUBLE },   // FineInvoiceNotFound
        detention:            { type:DataTypes.DOUBLE },   // Detention
        demurrage:            { type:DataTypes.DOUBLE },   // Demurrage

        // Why an unusual figure above is what it is. Kept per-head rather than
        // as one notes field because that is how they were recorded, and a fine
        // explained under "remarks" next to a stamp-duty note is no explanation
        // at all.
        exciseRemarks:    { type:DataTypes.STRING },   // ExciseRemarks
        stampDutyRemarks: { type:DataTypes.STRING },   // StampDutyRemarks
        fineRemarks:      { type:DataTypes.STRING },   // FineRemarks
        loloRemarks:      { type:DataTypes.STRING },   // LOLORemarks

        // The legacy Log_DutyCalculation.Id this row came from. Every migrated
        // table carries one: it is what lets the import be re-run without
        // doubling the rows, and what a reconciliation matches on.
        climaxId: { type:DataTypes.BIGINT },
    }, {
        // CustomsJobId and CommodityId are worth indexing too, but they are
        // attached by the association file rather than declared above - naming
        // them here would have sync() reach CREATE INDEX on a table that does
        // not have those columns yet, which throws and takes every model after
        // it down with it. The same trap Aviation_Consignment documents.
        indexes: [
            { fields: ["climaxId"] },
            { fields: ["sortOrder"] },
        ]
    })
    return Customs_Duty;
}
