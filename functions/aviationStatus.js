// What state a flight is in.
//
// FOUR values, two of which the reports branch on: 'Canceled' and
// 'Not-Operated'. Both mean the aircraft did not go, and they are kept apart
// because an airline is asked how many of its scheduled flights it CANCELLED -
// a number that is wrong the moment a flight that simply did not operate is
// counted into it. NIL is the opposite case and is easily confused with them:
// a NIL flight OPERATED, it just carried nothing.
//
// Kept in its own module because the flight form and the flight list both
// offer this list and colour by it. Two copies would drift, and a filter tag
// coloured differently from the rows it selects is worse than no filter.

/**
 * OPERATED WAS CALLED 'Active' UNTIL 1.2.2.
 *
 * It is stored as the string it is displayed as, so renaming it left every
 * flight entered before the change holding a value that is no longer in the
 * list - which an antd Select renders as a blank rather than as the thing it
 * says. So the old spelling is READ as the new one, everywhere the status is
 * displayed or filtered.
 *
 * That is deliberately a read-time rule rather than a migration anyone has to
 * remember to run. A flight re-saved after this release writes 'Operated' and
 * has migrated itself; one nobody touches again keeps 'Active' and still reads
 * correctly for ever. `ifa-deploy/1.2.2-operated-status.sql` tidies the stored
 * values if you would rather they all agreed, but nothing needs it.
 */
const LEGACY_OPERATED = 'Active';

export const OPERATED = 'Operated';
export const CANCELED = 'Canceled';
export const NILL = 'Nill';
export const NOT_OPERATED = 'Not-Operated';

// Order is the order of the dropdown: the common answer first, then the two
// ways a flight fails to go, then NIL.
export const STATUSES = [OPERATED, CANCELED, NOT_OPERATED, NILL];

/**
 * A stored status as it should be shown.
 *
 * A blank reads as Operated, which is what the model's default has always
 * meant - a flight with nothing said about it is one that flew.
 */
export const statusLabel = (status) => {
  const s = String(status ?? '').trim();
  if (!s || s === LEGACY_OPERATED) return OPERATED;
  return s;
};

/**
 * The status of a flight ROW, which is not quite the same question.
 *
 * `canceled` is the flag the Cancel Flight button sets, and it wins over the
 * status field - the two are not kept in step, and a flight somebody cancelled
 * is cancelled whatever its status column still says. Matches isCancelled on
 * the backend, which takes the union for the same reason.
 */
export const statusOf = (row) =>
  (row?.canceled ? CANCELED : statusLabel(row?.status));

// Amber for Not-Operated: it belongs with cancelled as "did not go", but the
// red is reserved for the deliberate act so the two can be told apart at a
// glance down a list of flights.
export const statusColor = (status) =>
  (status === CANCELED ? 'red'
    : status === NOT_OPERATED ? 'orange'
      : status === NILL ? 'default' : 'blue');

/**
 * Did this flight go?
 *
 * The question every count on the reports turns on, in one place so the screen
 * and the server cannot come to different answers - it mirrors isCancelled /
 * isNotOperated in the backend's functions/aviationPendingLoads.
 */
export const didNotFly = (row) =>
  [CANCELED, NOT_OPERATED].includes(statusOf(row));
