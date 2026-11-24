/**
 * The freight job screen's Vessel picker: the vessels it offers.
 *
 * Inactive vessels (Setup > Vessels - what a vessel becomes when a job uses
 * it and it cannot be deleted) are left out, except the one already on the
 * job: without it the picker would show a bare id where the vessel's name
 * was. `active` missing - a server from before 1.2.96 - counts as active.
 *
 * @param {Array}  list      every vessel, as /seaJob/getValues sends them
 * @param {*}      selected  the job's vesselId
 */
export function vesselOptions(list = [], selected) {
  return (list || [])
    .filter((x) => x.active !== false || (selected != null && selected !== '' && String(x.id) === String(selected)))
    .map((x) => ({
      id: x.id,
      name: `${x.name} ~ ${x.code}${x.active === false ? ' (inactive)' : ''}`,
      code: x.code,
    }));
}
