/**
 * The quantity a charge starts with when it is picked on a freight job's
 * charge sheet (Jobs/ChargesComp/Charges).
 *
 *   Per Shipment       1
 *   Per Unit, sea      the job's Bill Vol (SE / SI)
 *   Per Unit, air      the job's CWT (Client), as it always was
 *
 * Sea used to read CWT (Client) too - an air-freight figure a sea job does not
 * fill in - so every P/Unit charge on a sea job started at 1 and was typed in
 * by hand. A figure that is missing or zero still starts the line at 1.
 *
 * No React - unit tested.
 */
const SEA = ['SE', 'SI'];

export function startingQty(calculationType, operationType, job) {
  if (calculationType !== 'Per Unit') return 1;
  const source = SEA.includes(operationType) ? job?.billVol : job?.cwtClient;
  const n = parseFloat(source);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
