module.exports = (sequelize, DataTypes) => {
    /**
     * A container on a goods declaration.
     *
     * WHY THIS EXISTS AS A TABLE
     *
     * Customs_Job.containers is a flat string - "MSKU1234567, TGHU7654321" -
     * on the reasoning that a clearance file QUOTES container numbers rather
     * than managing them. That is still true, but it turns out the legacy
     * system keeps them as rows, and 6,164 of them across 5,744 clearing jobs.
     * Held as one string, nothing can search by container number, and the size
     * type is lost entirely.
     *
     * The string field is KEPT. It is what a clerk types when they have a list
     * off a document and no interest in rows, and it is what already exists on
     * every job created in Odyssey so far.
     *
     * WHY SO FEW COLUMNS
     *
     * The legacy table has 26. Measured across all 6,164 rows, exactly two are
     * populated: ContainerNo and EquipCode. Weights appear on 241, CBM on 3,
     * packages on 5, and seal numbers, temperature, load type and the DG flag
     * on none at all. So this holds what the data holds, plus weights for the
     * 241 that carry them - not a copy of a schema nobody filled in.
     */
    const Customs_Container = sequelize.define("Customs_Container", {
        // The container number itself. 5,915 distinct across the legacy book,
        // which is what makes a per-row table worth having: this is the thing
        // people search by.
        containerNo:  { type:DataTypes.STRING, allowNull: false },
        // 40HC, 20SD, 40 FR, 45HC... eight values in the legacy data. Free text
        // rather than a lookup: the legacy set is not a controlled vocabulary
        // and a new size would otherwise be unenterable.
        sizeType:     { type:DataTypes.STRING },

        grossWeight:  { type:DataTypes.DOUBLE },
        netWeight:    { type:DataTypes.DOUBLE },
        packages:     { type:DataTypes.INTEGER },
        // The truck carrying it. On their Booking Info grid the three columns
        // are Size, Container # and Truck # - so the haulage is recorded per
        // container, not per job.
        truckNo:      { type:DataTypes.STRING },
        // Who hauls this box - from the Program Book's container section.
        transporterId: { type:DataTypes.INTEGER, allowNull: true },
        remarks:      { type:DataTypes.STRING },

        // Keeps the grid in the order it was entered, the same way
        // Customs_Duty does - the legacy Sno is populated on 7 rows of 6,164,
        // so it cannot be relied on for this.
        sortOrder:    { type:DataTypes.INTEGER, defaultValue: 0 },

        // The legacy row id, so the stage can tell a re-run from a first run.
        climaxId:     { type:DataTypes.INTEGER, allowNull: true },
    }, { indexes: [{ fields: ['climaxId'] }, { fields: ['containerNo'] }] })
    return Customs_Container;
}
