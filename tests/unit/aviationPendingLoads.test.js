/**
 * Outstanding offloads - cargo that was left behind and never put on a later
 * flight.
 *
 * The rule under test is that an AWB's outstanding amount is the offload on
 * its LATEST leg, not the sum of its offloads. Getting that wrong inflates
 * every partially-settled AWB, which is the case these tests spend most of
 * their time on.
 *
 * THE WEIGHTS, throughout: a leg carries `carriedForward ?? grossWeight` and
 * `offload` is the part of that which stayed on the ground, so what flew - and
 * what `carried` sums - is the difference. carriedForward only appears on a
 * continuation leg, where gross has been copied from the air waybill and is no
 * longer what that particular flight was asked to take; see the last describe
 * block.
 */
const {
  pendingLoads, carryIn, flownWeight, isAwbClosed, bookedFromOffload,
} = require('../../functions/aviationPendingLoads');

// One leg of an AWB. Defaults to a flown, non-cancelled flight.
const leg = (o) => ({
  awb: '10000012', grossWeight: 0, offload: 0,
  flightDate: '2026-08-01', status: 'Active', canceled: false,
  id: 1, jobNo: 'IFA-AVJ-1/26', flightNo: 'PK-301',
  ...o,
});

describe('the situation this exists for', () => {
  test('an AWB offloaded once and never flown again is outstanding', () => {
    const { rows, totalPending, count } = pendingLoads([
      leg({ grossWeight: 1000, offload: 300 }),
    ]);
    expect(count).toBe(1);
    expect(totalPending).toBe(300);
    expect(rows[0]).toMatchObject({ awb: '10000012', pending: 300, carried: 700, legs: 1 });
  });

  test('names the flight it was last left behind by', () => {
    // The row has to say where to start asking, not just that something is
    // missing.
    const { rows } = pendingLoads([
      leg({ id: 1, grossWeight: 1000, offload: 300, jobNo: 'IFA-AVJ-1/26', flightNo: 'PK-301' }),
    ]);
    expect(rows[0].lastFlight).toMatchObject({ jobNo: 'IFA-AVJ-1/26', flightNo: 'PK-301' });
  });
});

describe('closing an AWB', () => {
  // An offload normally means the cargo is waiting for the next aircraft. When
  // it is not - perishables gone back to the master agent, a withdrawn
  // booking, a shipment re-booked on another airline - the AWB is closed on
  // the leg that left it, and stops being outstanding. It used to be decided
  // by the commodity being perishable, which could say neither "this
  // perishable is still going" nor "these machine parts are not".
  test('a closed AWB is not outstanding, however much was left behind', () => {
    const { rows, count, totalPending } = pendingLoads([
      leg({ grossWeight: 1000, offload: 300, awbClosed: true }),
    ]);
    expect(count).toBe(0);
    expect(totalPending).toBe(0);
    expect(rows).toEqual([]);
  });

  test('an open AWB with the same offload IS outstanding', () => {
    // The pair is the point: nothing but the tick separates them.
    expect(pendingLoads([leg({ grossWeight: 1000, offload: 300 })]).count).toBe(1);
  });

  test('only the LATEST leg decides it', () => {
    // Closing leg 1 said "that offload is finished with". Leg 2 then left 100
    // kg of the same AWB behind and nobody has closed that, so it is owed.
    const { rows, totalPending } = pendingLoads([
      leg({ id: 1, flightDate: '2026-08-01', grossWeight: 1000, offload: 300, awbClosed: true }),
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 1000, carriedForward: 300, offload: 100 }),
    ]);
    expect(totalPending).toBe(100);
    expect(rows[0]).toMatchObject({ pending: 100, legs: 2 });
  });

  test('unticked, absent and false all mean open', () => {
    // Every consignment stored before the flag existed has no value at all,
    // and reading a blank as closed would silently empty this list.
    expect(isAwbClosed({})).toBe(false);
    expect(isAwbClosed({ awbClosed: null })).toBe(false);
    expect(isAwbClosed({ awbClosed: false })).toBe(false);
    expect(isAwbClosed({ awbClosed: true })).toBe(true);
  });
});

describe('settling an offload on a later flight', () => {
  test('a second leg carrying the rest clears it', () => {
    const { rows, count } = pendingLoads([
      leg({ id: 1, flightDate: '2026-08-01', grossWeight: 1000, offload: 300 }),
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 300, offload: 0 }),
    ]);
    expect(count).toBe(0);
    expect(rows).toEqual([]);
  });

  test('a partial settlement leaves only what is STILL outstanding', () => {
    // THE DOUBLE-COUNTING TRAP. Summing the offloads gives 400; the real
    // answer is 100, because leg 2's offload is what remains of leg 1's, not
    // a second 100 kg left behind on top of it.
    const { rows, totalPending } = pendingLoads([
      leg({ id: 1, flightDate: '2026-08-01', grossWeight: 1000, offload: 300 }),
      // Leg 2 is booked at the 300 that was left behind, and manages 200 of it.
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 300, offload: 100 }),
    ]);
    expect(totalPending).toBe(100);
    // 700 flew on leg 1, 200 on leg 2.
    expect(rows[0]).toMatchObject({ pending: 100, carried: 900, legs: 2 });
  });

  test('"latest" is by flight date, not the order the rows arrive in', () => {
    // Legs come back in whatever order the query produced. Reading the last
    // ROW rather than the last FLIGHT would report 300 as still outstanding
    // when it was settled five days later.
    const { count } = pendingLoads([
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 300, offload: 0 }),
      leg({ id: 1, flightDate: '2026-08-01', grossWeight: 1000, offload: 300 }),
    ]);
    expect(count).toBe(0);
  });

  test('two legs on one date fall back to id for which is latest', () => {
    const { totalPending } = pendingLoads([
      leg({ id: 9, flightDate: '2026-08-01', grossWeight: 300, offload: 0 }),
      leg({ id: 4, flightDate: '2026-08-01', grossWeight: 1000, offload: 300 }),
    ]);
    expect(totalPending).toBe(0);
  });
});

describe('flights that did not go', () => {
  test('a not-operated flight leaves nothing behind, like a cancelled one', () => {
    // The AWB was never carried, so there is no offload sitting on the ground
    // from it - the cargo is simply still waiting for a flight.
    expect(pendingLoads([
      leg({ grossWeight: 1000, offload: 300, status: 'Not-Operated' }),
    ]).count).toBe(0);
  });

  test('a not-operated later leg does not settle an earlier offload', () => {
    // The follow-up flight did not go, so the 300 kg is still outstanding.
    const out = pendingLoads([
      leg({ id: 1, grossWeight: 1000, offload: 300 }),
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 300, offload: 0, status: 'Not-Operated' }),
    ]);
    expect(out.count).toBe(1);
    expect(out.totalPending).toBe(300);
  });
});

describe('cancelled flights', () => {
  test('an offload on a cancelled flight is not outstanding cargo', () => {
    // A cancelled flight carried nothing, so nothing was left behind by it.
    expect(pendingLoads([leg({ grossWeight: 1000, offload: 300, canceled: true })]).count).toBe(0);
    expect(pendingLoads([leg({ grossWeight: 1000, offload: 300, status: 'Canceled' })]).count).toBe(0);
  });

  test('a cancelled later leg does not settle an earlier offload', () => {
    // The follow-up flight was cancelled, so the 300 kg is still sitting
    // there - this must stay on the list.
    const { totalPending } = pendingLoads([
      leg({ id: 1, flightDate: '2026-08-01', grossWeight: 1000, offload: 300 }),
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 300, offload: 0, canceled: true }),
    ]);
    expect(totalPending).toBe(300);
  });
});

describe('grouping and ordering', () => {
  test('groups by AWB number, not by consignment', () => {
    const { rows, count } = pendingLoads([
      leg({ awb: '10000012', id: 1, grossWeight: 1000, offload: 300 }),
      leg({ awb: '10000023', id: 2, grossWeight: 500, offload: 50 }),
    ]);
    expect(count).toBe(2);
    expect(rows.map((r) => r.awb)).toEqual(['10000012', '10000023']);
  });

  test('heaviest outstanding first', () => {
    // The biggest problem is the one worth looking at.
    const { rows } = pendingLoads([
      leg({ awb: 'A', id: 1, offload: 50 }),
      leg({ awb: 'B', id: 2, offload: 900 }),
      leg({ awb: 'C', id: 3, offload: 400 }),
    ]);
    expect(rows.map((r) => r.pending)).toEqual([900, 400, 50]);
  });

  test('a consignment with no AWB number is skipped', () => {
    // Nothing to match a later flight against.
    expect(pendingLoads([leg({ awb: '', offload: 300 })]).count).toBe(0);
    expect(pendingLoads([leg({ awb: null, offload: 300 })]).count).toBe(0);
  });

  test('an AWB with no offload at all never appears', () => {
    expect(pendingLoads([leg({ grossWeight: 1000, offload: 0 })]).count).toBe(0);
    expect(pendingLoads([leg({ grossWeight: 1000, offload: null })]).count).toBe(0);
  });

  test('empty and rubbish input produce an empty result rather than throwing', () => {
    expect(pendingLoads([])).toEqual({ rows: [], totalPending: 0, count: 0 });
    expect(pendingLoads(null).count).toBe(0);
    expect(pendingLoads([null, undefined]).count).toBe(0);
  });
});

/**
 * A continuation leg copies the AWB's documented figures forward.
 *
 * The air waybill still says 1,000 kg however many aircraft it takes to move
 * it, so grossWeight is repeated verbatim on the second leg and what that leg
 * is actually taking goes in carriedForward. Every sum has to read the latter,
 * or a 1,000 kg AWB reports 1,700 kg carried.
 */
describe('carriedForward on a continuation leg', () => {
  test('carried counts what each leg took, not the repeated gross', () => {
    const { rows, count } = pendingLoads([
      // Leg 1: the whole AWB, 300 kg left behind.
      leg({ id: 1, flightDate: '2026-08-01', grossWeight: 1000, offload: 300 }),
      // Leg 2: same document, carrying the outstanding 300.
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 1000, carriedForward: 300, offload: 0 }),
    ]);
    // Fully settled, so it drops off the list entirely.
    expect(count).toBe(0);
    expect(rows).toEqual([]);
  });

  test('a partly settled continuation reports the right carried total', () => {
    const { rows, totalPending } = pendingLoads([
      leg({ id: 1, flightDate: '2026-08-01', grossWeight: 1000, offload: 300 }),
      leg({ id: 2, flightDate: '2026-08-05', grossWeight: 1000, carriedForward: 300, offload: 100 }),
    ]);
    expect(totalPending).toBe(100);
    // 700 on leg 1 + 200 on leg 2. Reading gross would give 700 + 900 = 1,600
    // carried out of a 1,000 kg air waybill.
    expect(rows[0]).toMatchObject({ pending: 100, carried: 900, legs: 2 });
  });

  test('carryIn falls back to gross only when carriedForward is absent', () => {
    expect(carryIn({ grossWeight: 1000 })).toBe(1000);
    expect(carryIn({ grossWeight: 1000, carriedForward: null })).toBe(1000);
    // Explicitly zero is a real answer - a leg asked to carry nothing - and
    // must not fall back to the document's 1,000.
    expect(carryIn({ grossWeight: 1000, carriedForward: 0 })).toBe(0);
    expect(carryIn({ grossWeight: 1000, carriedForward: 300 })).toBe(300);
  });

  test('flownWeight never goes negative', () => {
    expect(flownWeight({ grossWeight: 1000, carriedForward: 300, offload: 500 })).toBe(0);
  });
});

describe('a booking that flew none of its cargo', () => {
  // Pieces and Gross WT are what the AWB was ASKED to carry. On a leg where
  // every kilo was offloaded, the operator types the offload and leaves those
  // blank - and blank reads as an AWB that was never booked at all.
  const leg = (x) => ({ pieces: null, grossWeight: null, offloadPieces: null, offload: null, ...x });

  test('books the leg from what it left behind', () => {
    expect(bookedFromOffload(leg({ offloadPieces: 5, offload: 500 })))
      .toEqual({ pieces: 5, grossWeight: 500 });
  });

  test('leaves a partly offloaded leg alone', () => {
    // 300 of 1000 stayed behind: 700 flew, and the booking is already right.
    expect(bookedFromOffload(leg({ pieces: 10, grossWeight: 1000, offloadPieces: 3, offload: 300 })))
      .toBeNull();
  });

  test('does not shrink a booking when only some pieces were left behind', () => {
    // Pieces recorded, weight not. Copying 5 into Pieces would rewrite a
    // 10-piece booking as a 5-piece one.
    expect(bookedFromOffload(leg({ pieces: 10, offloadPieces: 5, offload: 500 }))).toBeNull();
  });

  test('does not fire on a weight that was booked but not counted in pieces', () => {
    expect(bookedFromOffload(leg({ grossWeight: 1000, offloadPieces: 5, offload: 500 }))).toBeNull();
  });

  test('needs BOTH offload figures, so it cannot half-fill a row', () => {
    // This is also what lets the grid run it on every keystroke: typing the
    // offload pair in either order only completes the rule on the second one.
    expect(bookedFromOffload(leg({ offload: 500 }))).toBeNull();
    expect(bookedFromOffload(leg({ offloadPieces: 5 }))).toBeNull();
  });

  test('an empty row is not a fully offloaded one', () => {
    expect(bookedFromOffload(leg({}))).toBeNull();
    expect(bookedFromOffload(null)).toBeNull();
  });

  test('fires once - the fields it writes are what stop it matching again', () => {
    const first = leg({ offloadPieces: 5, offload: 500 });
    const filled = { ...first, ...bookedFromOffload(first) };
    // Editing the offload afterwards now means what it says: some of it flew.
    expect(bookedFromOffload({ ...filled, offload: 400 })).toBeNull();
  });

  test('skips a continuation leg', () => {
    // carriedForward already records what this leg was asked to take, and its
    // gross is the whole shipment's rather than this flight's share of it.
    expect(bookedFromOffload(leg({ carriedForward: 300, offloadPieces: 5, offload: 300 })))
      .toBeNull();
    // Including a carriedForward of 0 - that is a recorded answer too.
    expect(bookedFromOffload(leg({ carriedForward: 0, offloadPieces: 5, offload: 300 })))
      .toBeNull();
  });

  test('nothing is chargeable on a leg that carried nothing', () => {
    // The point of filling the booking in: gross less offload is 0, so the
    // AWB prices at nothing rather than off a booking of nothing.
    const filled = { ...leg({ offloadPieces: 5, offload: 500 }) };
    Object.assign(filled, bookedFromOffload(filled));
    expect(Math.max(0, carryIn(filled) - filled.offload)).toBe(0);
    expect(flownWeight(filled)).toBe(0);
  });
});

/**
 * CARRY-IN RESOLVED ACROSS AN AWB'S LEGS.
 *
 * What a leg was asked to carry used to be read off the row it was stored on -
 * `carriedForward ?? grossWeight`. That field is a snapshot written once, when
 * a pending AWB is picked onto a new flight, and it is not shown as a column,
 * so nothing recomputes it and nobody can see it. These tests pin the rule that
 * replaced it: a leg is read against the leg BEFORE it on the same air waybill.
 *
 * The re-cut case is the one that prompted all this - an AWB offloaded in full
 * and the number reused for a bigger shipment, which went on reporting the old
 * weight on every screen that totalled it.
 */
describe('resolving carry-in across legs', () => {
  const { resolveCarryIn, carryInByLeg, carryInOf, flownWeightOf, prevLegByLeg } =
    require('../../functions/aviationPendingLoads');

  const at = (id, date, o) => leg({ id, flightDate: date, ...o });

  test('a first leg carries its gross weight - it IS the shipment', () => {
    expect(resolveCarryIn({ grossWeight: 1000 }, null)).toBe(1000);
  });

  test('a continuation leg carries what the leg before it left behind', () => {
    // Gross is unchanged between the two, which is what makes it a split
    // rather than a reuse: the air waybill still describes one 1,000 kg
    // shipment however many aircraft move it.
    const prev = { grossWeight: 1000, offload: 300 };
    expect(resolveCarryIn({ grossWeight: 1000 }, prev)).toBe(300);
  });

  test('a RE-CUT AWB carries its own gross, not the old offload', () => {
    // The number was offloaded in full and then reused for a bigger shipment.
    // Reading the predecessor's offload here reports the cargo that was left
    // behind - the exact bug this rule exists to stop.
    const prev = { grossWeight: 500, offload: 500 };
    expect(resolveCarryIn({ grossWeight: 2000 }, prev)).toBe(2000);
  });

  test('a snapshot with nothing behind it carries nothing', () => {
    // The earlier leg flew the lot, so there was never anything to pick up -
    // whatever carriedForward on this row still says.
    const prev = { grossWeight: 1000, offload: null };
    expect(resolveCarryIn({ grossWeight: 1000, carriedForward: 300 }, prev)).toBe(0);
  });

  test('legs are grouped by AWB and walked in flight order', () => {
    const a1 = at(1, '2026-08-01', { awb: 'A', grossWeight: 1000, offload: 300 });
    const a2 = at(2, '2026-08-05', { awb: 'A', grossWeight: 1000, offload: 0 });
    const b1 = at(3, '2026-08-03', { awb: 'B', grossWeight: 700, offload: 0 });

    const resolved = carryInByLeg([a2, b1, a1]);   // deliberately out of order
    expect(resolved.get(1)).toBe(1000);   // first leg of A
    expect(resolved.get(2)).toBe(300);    // continuation of A
    expect(resolved.get(3)).toBe(700);    // first leg of B - a different AWB
  });

  test('a grounded flight is not a predecessor', () => {
    // It carried nothing, so it neither leaves cargo behind nor settles an
    // earlier offload. The leg after it reads through to the one before.
    const first   = at(1, '2026-08-01', { grossWeight: 1000, offload: 400 });
    const grounded = at(2, '2026-08-02', { grossWeight: 1000, offload: 0, canceled: true });
    const third   = at(3, '2026-08-03', { grossWeight: 1000, offload: 0 });

    const resolved = carryInByLeg([first, grounded, third]);
    expect(resolved.has(2)).toBe(false);
    expect(resolved.get(3)).toBe(400);   // reads the offload of leg 1, not leg 2
    expect(prevLegByLeg([first, grounded, third]).get(3).id).toBe(1);
  });

  test('a leg handed over twice is not its own predecessor', () => {
    // Callers pass the period's legs and then every leg of those AWBs, which
    // overlap by construction. Counted twice, leg 2 would settle its own
    // offload and report 0.
    const one = at(1, '2026-08-01', { grossWeight: 1000, offload: 300 });
    const two = at(2, '2026-08-05', { grossWeight: 1000, offload: 0 });

    expect(carryInByLeg([one, two, one, two]).get(2)).toBe(300);
  });

  test('a predecessor outside the reported period still counts', () => {
    // The whole reason the routes fetch siblings with no date bound.
    const july   = at(1, '2026-07-28', { grossWeight: 1000, offload: 300 });
    const august = at(2, '2026-08-02', { grossWeight: 1000, offload: 0 });

    expect(carryInByLeg([august]).get(2)).toBe(1000);          // predecessor missing
    expect(carryInByLeg([july, august]).get(2)).toBe(300);     // predecessor supplied
  });

  test('an unresolved leg falls back to its stored snapshot', () => {
    // A leg with no AWB number is in no group, so it is in no map. Reading the
    // row beats reporting nought.
    const orphan = leg({ id: 9, awb: '', grossWeight: 1000, carriedForward: 250 });
    const resolved = carryInByLeg([orphan]);
    expect(resolved.has(9)).toBe(false);
    expect(carryInOf(resolved, orphan)).toBe(250);
    expect(carryInOf(null, orphan)).toBe(250);
  });

  test('flownWeightOf is the resolved carry-in less the offload, clamped', () => {
    const one = at(1, '2026-08-01', { grossWeight: 1000, offload: 300 });
    const two = at(2, '2026-08-05', { grossWeight: 1000, offload: 100 });
    const resolved = carryInByLeg([one, two]);

    expect(flownWeightOf(resolved, one)).toBe(700);
    expect(flownWeightOf(resolved, two)).toBe(200);   // 300 picked up, 100 left again
    // An offload bigger than the load is a typo, not negative cargo.
    const over = at(3, '2026-08-06', { awb: 'Z', grossWeight: 100, offload: 500 });
    expect(flownWeightOf(carryInByLeg([over]), over)).toBe(0);
  });

  test('`carried` on the outstanding list uses the resolved figure', () => {
    // A re-cut AWB used to report the weight it was offloaded by rather than
    // the weight it actually carried afterwards.
    const one = at(1, '2026-09-21', { grossWeight: 500, offload: 500 });
    const two = at(2, '2026-09-22', { grossWeight: 2000, offload: 0, carriedForward: 500 });

    const { rows, count } = pendingLoads([one, two]);
    expect(count).toBe(0);                    // leg 2 left nothing behind
    expect(rows).toEqual([]);

    const { rows: still } = pendingLoads([one, { ...two, offload: 250 }]);
    expect(still[0]).toMatchObject({ pending: 250, carried: 1750 });   // 0 + (2000-250)
  });
});
