/**
 * IATA air waybill numbering.
 *
 * The whole AWB stock register rests on one rule - the check digit is the
 * 7-digit serial modulo 7 - so these tests pin that rule down rather than
 * merely exercising the functions. Get it wrong and the office registers a
 * block of numbers no airline will accept.
 */
const {
  checkDigitFor, buildNumber, formatNumber, parseEntry, generateSeries, MAX_SERIAL,
  planRegistration,
} = require('../../functions/awb');

describe('the check digit', () => {
  test('is the serial modulo 7, so it only ever runs 0-6', () => {
    for (let s = 1000000; s < 1000050; s++) {
      const d = Number(checkDigitFor(s));
      expect(d).toBe(s % 7);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  test('wraps 6 -> 0 while the serial keeps counting normally', () => {
    // The trap this guards against is generating a series by incrementing the
    // LAST digit, which looks right for six numbers and then produces a 7.
    expect([1000005, 1000006, 1000007].map((s) => checkDigitFor(s))).toEqual(['6', '0', '1']);
  });
});

describe('parseEntry', () => {
  test('accepts a correct 8-digit number and returns the numeric serial', () => {
    expect(parseEntry('214', '10000001')).toEqual({ ok: true, prefix: '214', serial: 1000000 });
  });

  test('tolerates the spacing and dashes the number is normally written with', () => {
    expect(parseEntry('214', '1000000-1').ok).toBe(true);
    expect(parseEntry(' 214 ', '1000000 1').ok).toBe(true);
  });

  test('rejects a wrong check digit, and spells out the corrected number', () => {
    // The message lands in front of someone holding the paper AWB, so it has
    // to say which number is actually valid - "invalid check digit" leaves
    // them no better off than before.
    const result = parseEntry('214', '10000009');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/should be 1, not 9/);
    expect(result.error).toContain('214-10000001');
  });

  test('rejects a carrier with no 3-digit prefix', () => {
    // The prefix comes off the carrier record, so this is the carrier being
    // set up wrong rather than the number being typed wrong - and the message
    // says so.
    expect(parseEntry('', '10000001').error).toMatch(/Setup > Carriers/);
    expect(parseEntry('21', '10000001').ok).toBe(false);
    expect(parseEntry('2145', '10000001').ok).toBe(false);
  });

  test('rejects anything that is not exactly 8 digits', () => {
    expect(parseEntry('214', '1000000').ok).toBe(false);
    expect(parseEntry('214', '100000012').ok).toBe(false);
    expect(parseEntry('214', '').ok).toBe(false);
  });
});

describe('generateSeries', () => {
  test('increments the serial and recomputes the check digit, wrapping 6 -> 0', () => {
    expect(generateSeries('214', 1000000, 9).map((r) => r.awbNumber)).toEqual([
      '21410000001',
      '21410000012',
      '21410000023',
      '21410000034',
      '21410000045',
      '21410000056',
      '21410000060', // check digit wraps, serial does not
      '21410000071',
      '21410000082',
    ]);
  });

  test('zero pads a short serial rather than shortening the number', () => {
    const [first] = generateSeries('618', 1, 1);
    expect(first).toMatchObject({ serial: '0000001', checkDigit: '1', awbNumber: '61800000011' });
  });

  test('stops at the 7-digit ceiling instead of rolling over', () => {
    // Rolling over would produce a 12-digit number, which is not an AWB at
    // all - and would be silently written into stock.
    const rows = generateSeries('214', MAX_SERIAL - 1, 5);
    expect(rows).toHaveLength(2);
    expect(rows[rows.length - 1].serial).toBe(String(MAX_SERIAL));
  });

  test('a count of zero or nonsense still yields one number', () => {
    expect(generateSeries('214', 1000000, 0)).toHaveLength(1);
    expect(generateSeries('214', 1000000, 'x')).toHaveLength(1);
  });
});

describe('display', () => {
  test('formatNumber splits the prefix off with a dash', () => {
    expect(formatNumber(buildNumber('214', 1000000))).toBe('214-10000001');
  });
});

/**
 * What a registration request does to the register.
 *
 * The flight screen can register a number and hand it to a master agent in one
 * act, which turned "create these rows" into a three-way decision - create,
 * assign, or refuse the lot. Refusing has to happen BEFORE anything is
 * written, so the rule lives in a pure function and is pinned here rather than
 * only being exercised through a route that needs a database.
 */
describe('planRegistration', () => {
  const asked = (...numbers) => numbers.map((awbNumber) => ({ awbNumber }));
  const onRegister = (awbNumber, masterAgentId = null, id = 1) =>
    ({ id, awbNumber, masterAgentId });

  const A = 7;
  const B = 9;

  describe('as plain stock, with no agent', () => {
    test('everything not already registered is created', () => {
      const plan = planRegistration(asked('21410000001', '21410000012'), [onRegister('21410000001')]);
      expect(plan.fresh.map((x) => x.awbNumber)).toEqual(['21410000012']);
    });

    test('nothing is ever handed over or refused', () => {
      // A block arriving from the airline is given out later - two events.
      const plan = planRegistration(asked('21410000001'), [onRegister('21410000001', B)]);
      expect(plan.toAssign).toEqual([]);
      expect(plan.taken).toEqual([]);
    });
  });

  describe('registering to a master agent', () => {
    test('a new number is created and an existing one handed over', () => {
      const plan = planRegistration(
        asked('21410000001', '21410000012'),
        [onRegister('21410000001')],
        A
      );
      expect(plan.fresh.map((x) => x.awbNumber)).toEqual(['21410000012']);
      expect(plan.toAssign.map((x) => x.awbNumber)).toEqual(['21410000001']);
    });

    test('a number already with this agent is left alone', () => {
      // Re-assigning would restamp assignedAt with today's date and lose when
      // the block actually went out.
      const plan = planRegistration(asked('21410000001'), [onRegister('21410000001', A)], A);
      expect(plan.fresh).toEqual([]);
      expect(plan.toAssign).toEqual([]);
      expect(plan.taken).toEqual([]);
    });

    test("somebody else's number refuses the WHOLE request", () => {
      // Not just that one. Creating the other four and stopping would leave the
      // operator with no idea where the run actually reached.
      const plan = planRegistration(
        asked('21410000001', '21410000012', '21410000023'),
        [onRegister('21410000012', B, 5)],
        A
      );
      expect(plan.taken.map((x) => x.awbNumber)).toEqual(['21410000012']);
      expect(plan.fresh).toEqual([]);
      expect(plan.toAssign).toEqual([]);
    });
  });

  describe('a voided number in the run', () => {
    const voided = (awbNumber, masterAgentId = null, id = 9) =>
      ({ id, awbNumber, masterAgentId, voidedAt: '2026-09-01T00:00:00.000Z' });

    test('is named, and the rest of the block still registers', () => {
      // Re-running a series to fill a gap is ordinary work. One torn AWB in
      // the middle of it must not throw away the ninety-nine good ones.
      const plan = planRegistration(
        asked('21410000001', '21410000012', '21410000023'),
        [voided('21410000012')],
        A
      );
      expect(plan.voided.map((x) => x.awbNumber)).toEqual(['21410000012']);
      expect(plan.fresh.map((x) => x.awbNumber)).toEqual(['21410000001', '21410000023']);
    });

    test('is never re-created, because it is still on the register', () => {
      // It exists - re-creating it would collide with the unique index.
      const plan = planRegistration(asked('21410000012'), [voided('21410000012')]);
      expect(plan.fresh).toEqual([]);
    });

    test('is not handed to the agent', () => {
      const plan = planRegistration(asked('21410000012'), [voided('21410000012')], A);
      expect(plan.toAssign).toEqual([]);
    });

    test("does not count as somebody else's, even when it is", () => {
      // 'taken' refuses the WHOLE batch. Saying that about a document that has
      // been torn up would stop a run that has nothing wrong with it, over a
      // number that is going nowhere either way.
      const plan = planRegistration(
        asked('21410000001', '21410000012'),
        [voided('21410000012', B, 5)],
        A
      );
      expect(plan.taken).toEqual([]);
      expect(plan.voided.map((x) => x.awbNumber)).toEqual(['21410000012']);
      expect(plan.fresh.map((x) => x.awbNumber)).toEqual(['21410000001']);
    });
  });

  test('empty input is not an error', () => {
    expect(planRegistration([], [], A)).toEqual({ fresh: [], taken: [], toAssign: [], voided: [] });
    expect(planRegistration(undefined, undefined)).toEqual({ fresh: [], taken: [], toAssign: [], voided: [] });
  });
});
