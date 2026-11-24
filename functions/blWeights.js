/**
 * A B/L's GROSS WEIGHT - every container's gross, added up.
 *
 * The B/L detail page always added them up (Gross WT); the print took the
 * FIRST container's alone, so a two-container B/L of 9,936 kg printed 4,968
 * (the user's report, 2026-10-13). One rule for both now. Net weight is the
 * B/L's own Net WT field, on the page and on the print alike.
 *
 * A container with no gross yet counts as none - the page's second copy of
 * this sum read it as NaN and blanked the total.
 *
 * No React - unit tested.
 */
export function totalGross(containers) {
  return (Array.isArray(containers) ? containers : [])
    .reduce((t, c) => {
      const n = parseFloat(c?.gross);
      return t + (Number.isFinite(n) ? n : 0);
    }, 0);
}

/**
 * WHICH CONTAINERS a B/L print totals: the ones on the screen (the B/L
 * screen's state - what Container Info edits and the save replies into), the
 * same the B/L Detail page and the print's own container rows read. The form's
 * Container_Infos is a copy taken when the B/L opened and never follows an
 * edit: a gross changed and saved still printed the old total until the B/L
 * was opened again (the user, 2026-11-04). The form's copy only where there
 * is no state to read.
 */
export function blContainers(state, allValues) {
  if (Array.isArray(state?.Container_Infos)) return state.Container_Infos;
  return Array.isArray(allValues?.Container_Infos) ? allValues.Container_Infos : [];
}

/**
 * A sea job's WEIGHT, from its B/L's Container Info (the user, 2026-11-02):
 * the containers' gross added up, to the gram - or null while the B/L has no
 * container with a gross, when the job's Weight is typed in as before. Saving
 * the B/L has always written this total onto the job; the job screen showed
 * the number it loaded with, and saving the job wrote that back.
 */
export function blContainerGross(job) {
  const containers = job?.Bl?.Container_Infos;
  if (!Array.isArray(containers) || !containers.some((c) => Number.isFinite(parseFloat(c?.gross)))) return null;
  return Math.round(totalGross(containers) * 1000) / 1000;
}

export default totalGross;
