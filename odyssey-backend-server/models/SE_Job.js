const { auditAttributes } = require('../functions/auditStamps');

module.exports = (sequelize, DataTypes) => {
    const SE_Job = sequelize.define("SE_Job", {
        jobNo: { type:DataTypes.STRING },
        jobId: { type:DataTypes.INTEGER },
        title:{ type:DataTypes.STRING },
        customerRef:{ type:DataTypes.STRING },
        fileNo:{ type:DataTypes.STRING },
        shipStatus:{ type:DataTypes.STRING },
        teu: { type:DataTypes.STRING },
        bkg: { type:DataTypes.STRING },
        pcs: { type:DataTypes.STRING },
        vol: { type:DataTypes.STRING },
        volWeight: { type:DataTypes.STRING },
        por: { type:DataTypes.STRING },
        pol: { type:DataTypes.STRING },
        pod: { type:DataTypes.STRING },
        fd: { type:DataTypes.STRING },
        dg: { type:DataTypes.STRING },
        subType: { type:DataTypes.STRING },
        billVol: { type:DataTypes.STRING },
        shpVol: { type:DataTypes.STRING },
        weight: { type:DataTypes.STRING },
        weightUnit: { type:DataTypes.STRING },
        costCenter: { type:DataTypes.STRING },
        jobType: { type:DataTypes.STRING },
        jobKind: { type:DataTypes.STRING },
        container: { type:DataTypes.STRING },
        carrier: { type:DataTypes.STRING },
        freightType: { type:DataTypes.STRING },
        nomination: { type:DataTypes.STRING },
        transportCheck: { type:DataTypes.STRING },
        customCheck: { type:DataTypes.STRING },
        etd: { type:DataTypes.STRING },
        eta: { type:DataTypes.STRING },
        cbkg: { type:DataTypes.STRING },
        aesDate: { type:DataTypes.STRING },
        aesTime: { type:DataTypes.STRING },
        eRcDate: { type:DataTypes.STRING },
        eRcTime: { type:DataTypes.STRING },
        eRlDate: { type:DataTypes.STRING },
        eRlTime: { type:DataTypes.STRING },
        jobDate: { type:DataTypes.STRING },
        shipDate: { type:DataTypes.STRING },
        doorMove: { type:DataTypes.STRING },
        cutOffDate: { type:DataTypes.STRING },
        cutOffTime: { type:DataTypes.STRING },
        siCutOffDate: { type:DataTypes.STRING },
        siCutOffTime: { type:DataTypes.STRING },
        vgmCutOffDate: { type:DataTypes.STRING },
        vgmCutOffTime: { type:DataTypes.STRING },
        freightPaybleAt: { type:DataTypes.STRING },
        terminal: { type:DataTypes.STRING },
        delivery: { type:DataTypes.STRING },
        companyId: { type:DataTypes.STRING },
        pkgUnit: { type:DataTypes.STRING },
        incoTerms: { type:DataTypes.STRING },
        exRate: { 
            type:DataTypes.STRING,
            defaultValue: "1"
        },
        // The job's USD BUYING rate - payable USD charges take it; exRate above
        // is the SELLING one (the Charges tab's Ex.Rate USD section, as Climax
        // kept ExRateSelling / ExRateBuying). Not set: the selling rate.
        // Added by job-buying-rate.sql - SE_Jobs is never altered at boot.
        exRateBuying: { type:DataTypes.STRING },
        approved: { 
            type:DataTypes.STRING,
            defaultValue: "0"
        },
        canceled: { 
            type:DataTypes.BOOLEAN,
            defaultValue: false
        },
        climaxId: { type:DataTypes.INTEGER },
        // Who entered the job and who last changed it - functions/auditStamps.
        // createdBy is the name; createdById (the created_by association) is
        // older, and the only creator a job made before these columns has.
        ...auditAttributes(DataTypes),
        flightNo:{ type:DataTypes.STRING },
        cwtLine:{ type:DataTypes.STRING },
        cwtClient:{ type:DataTypes.STRING },
        operation:{ type:DataTypes.STRING },

        arrivalDate  :{ type:DataTypes.STRING },
        arrivalTime  :{ type:DataTypes.STRING },
        departureDate:{ type:DataTypes.STRING },
        departureTime:{ type:DataTypes.STRING },
    }, {
        indexes: [
            { fields: ["companyId", "operation"] },
            { fields: ["companyId", "operation", "jobNo"] },
            { fields: ["createdAt"] },
            { fields: ["jobNo"] },
            // climaxId used to be declared in a THIRD options object passed to
            // sequelize.define, which only takes two - so it was silently
            // dropped and never created. Every job import looks up existing
            // jobs by climaxId to stay idempotent, and did it without an index.
            { fields: ["climaxId"] }
        ]
    })
    return SE_Job;
}