// WHEN A CUSTOMS JOB'S STATUS CHANGED, and to what - one row per change.
//
// The job holds only its status now, never since when. The bell's Critical
// alert needs exactly that (the user, 2026-11-23): a job with no charges 7
// days after it went On Vessel. Written by the hooks in
// functions/customsStatusLog on every save that sets a status, whichever route
// it came through. Jobs that changed before this table existed have no rows;
// readers fall back to the job's creation.
//
// New table, so ODYSSEY_DB_SYNC=create creates it on boot - no upgrade SQL.
module.exports = (sequelize, DataTypes) => {
  const Customs_Job_Status = sequelize.define('Customs_Job_Status', {
    CustomsJobId: { type: DataTypes.INTEGER, allowNull: false },
    // The stored value (functions/customsStatuses): 'Complete' is On Vessel.
    status: { type: DataTypes.STRING },
    changedOn: { type: DataTypes.DATE, allowNull: false },
    // The name of whoever saved it, as functions/auditStamps stamps names.
    changedBy: { type: DataTypes.STRING },
  }, {
    timestamps: false,
    indexes: [{ name: 'customs_job_statuses_job_status', fields: ['CustomsJobId', 'status'] }],
  });
  return Customs_Job_Status;
};
