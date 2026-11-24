/* The sales rep a freight job gets when its client is picked (the user's
 * request, 2026-10-23): the party's own Sales Representative, set on Setup >
 * Parties > Account Info.
 *
 * Only ever run on a pick the user made in the Client box - never on loading
 * a job, restoring a draft or Copy From Existing Job - so a saved job keeps
 * the rep it was saved with, and the rep stays an ordinary field the user can
 * change after the pick.
 *
 *  - The picked client has a rep: that rep.
 *  - It has none: the rep that came with the previous client goes with it;
 *    a rep the user chose for themselves stays.
 *
 * `clients` are the job's client options ({id, salesRepresentatorId}); `reps`
 * the Sales Representator options. A party's rep who is no longer a sales
 * rep is not picked - the box would show a bare id.
 */
const same = (a, b) => a !== undefined && a !== null && a !== '' && String(a) === String(b);

export const repAfterClientPick = ({ clients = [], reps = [], previousClientId, clientId, currentRep }) => {
  const repOf = (id) => {
    const rep = clients.find((c) => same(c.id, id))?.salesRepresentatorId;
    return reps.some((r) => same(r.id, rep)) ? rep : null;
  };

  const picked = repOf(clientId);
  if (picked) return picked;

  const previous = repOf(previousClientId);
  if (previous && same(currentRep, previous)) return '';
  return currentRep;
};
