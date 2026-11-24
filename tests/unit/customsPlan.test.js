/**
 * The Program Book's rules - functions/customsPlan.
 *
 * The status cases are the SAME as the frontend's
 * __tests__/customsPlanStatus.test.js: the screen decides which rows can be
 * ticked for a move and the server decides whether it happens, so the two
 * copies of the rule must answer alike.
 */
const {
  PLAN_STATUSES, PLAN_STATES, statusOf, stateOf, moveRefusal, describePlan,
  PlanError, planValues, isBlankPlan, containerNumbers, vehicleNumbers, containerRows, jobFromPlan,
} = require('../../functions/customsPlan');

describe('status', () => {
  test('the sheet\'s Job Status, and Moved, which is not stored', () => {
    expect(PLAN_STATUSES).toEqual(['Pending', 'Confirmed', 'Cancelled']);
    expect(PLAN_STATES).toEqual(['Pending', 'Confirmed', 'Cancelled', 'Moved']);
  });

  test('blank reads as Pending; a moved plan reads as Moved whatever it says', () => {
    expect(statusOf({})).toBe('Pending');
    expect(statusOf({ status: '  ' })).toBe('Pending');
    expect(stateOf({ status: 'Confirmed' })).toBe('Confirmed');
    expect(stateOf({ status: 'Confirmed', CustomsJobId: 9 })).toBe('Moved');
  });

  test.each([
    [{ status: 'Confirmed' }, null],
    [{ status: 'Pending' }, 'it is Pending - set its Job Status to Confirmed first.'],
    [{}, 'it is Pending - set its Job Status to Confirmed first.'],
    [{ status: 'Cancelled' }, 'it is Cancelled - a closed plan is not moved.'],
    [{ status: 'Confirmed', CustomsJobId: 4 }, 'it is already on the jobs list.'],
    [null, 'That plan no longer exists.'],
  ])('moveRefusal(%j)', (plan, why) => {
    expect(moveRefusal(plan)).toBe(why);
  });

  describe('with the statuses Configuration > Customs sets', () => {
    // Renamed, one added that may also be moved, one added that is closed.
    const list = [
      { value: 'Pending', label: 'Awaiting Client', color: 'gold', rules: ['shown'], hidden: false },
      { value: 'Docs Ready', label: 'Docs Ready', color: 'cyan', rules: ['start', 'shown'], hidden: false },
      { value: 'Confirmed', label: 'Booked', color: 'green', rules: ['movable', 'shown'], hidden: false },
      { value: 'Shut Out', label: 'Shut Out', color: 'orange', rules: ['movable'], hidden: false },
      { value: 'Cancelled', label: 'Lost', color: 'red', rules: ['faded'], hidden: false },
    ];

    test('blank reads as the status new rows start at', () => {
      expect(statusOf({}, list)).toBe('Docs Ready');
    });

    test.each([
      [{ status: 'Shut Out' }, null],
      [{ status: 'Confirmed' }, null],
      [{ status: 'Pending' }, 'it is Awaiting Client - set its Job Status to Booked or Shut Out first.'],
      [{ status: 'Cancelled' }, 'it is Lost - a closed plan is not moved.'],
    ])('moveRefusal(%j) by its rules, named by its label', (plan, why) => {
      expect(moveRefusal(plan, null, list)).toBe(why);
    });

    test('a row is saved at a status given by name or by stored value; blank starts where configured', () => {
      expect(planValues({ status: 'booked' }, list).status).toBe('Confirmed');
      expect(planValues({ status: 'Shut Out' }, list).status).toBe('Shut Out');
      expect(planValues({ status: '' }, list).status).toBe('Docs Ready');
      expect(() => planValues({ status: 'Maybe' }, list))
        .toThrow('"Maybe" is not a job status - use Awaiting Client, Docs Ready, Booked, Shut Out, Lost.');
    });
  });

  test('a moved plan names its job when it is known', () => {
    expect(moveRefusal({ status: 'Confirmed', CustomsJobId: 4 }, 'CL-CCJ-91/27'))
      .toBe('it is already on the jobs list as CL-CCJ-91/27.');
  });

  test('a plan is named by its shipper and invoice', () => {
    expect(describePlan({ shipper: { name: 'ABC TEX' }, invoiceNo: 'IN-12' })).toBe('ABC TEX, invoice IN-12');
    expect(describePlan({ invoiceNo: 'IN-12' })).toBe('invoice IN-12');
    expect(describePlan({ id: 7 })).toBe('plan 7');
  });
});

describe('a row from the screen', () => {
  test('writes only the plan\'s own columns, trimmed, containers and size in capitals', () => {
    const v = planValues({
      id: 5, CustomsJobId: 9, companyId: '3', status: 'confirmed', shipperId: '12', shippingLineId: 4,
      qty: '2', size: ' 40hc ', containers: 'msku1234567, tghu7654321', invoiceNo: ' IN-12 ',
      gateInTime: '2026-10-08 14:30', cutOff: '2026-10-09', remarks: '',
    });
    expect(v).toMatchObject({
      status: 'Confirmed', shipperId: 12, shippingLineId: 4, qty: 2, size: '40HC',
      containers: 'MSKU1234567, TGHU7654321', invoiceNo: 'IN-12',
      gateInTime: '2026-10-08 14:30', cutOff: '2026-10-09', remarks: null,
    });
    // Never the link to a job, the company or the id - the route decides those.
    expect(v).not.toHaveProperty('CustomsJobId');
    expect(v).not.toHaveProperty('companyId');
    expect(v).not.toHaveProperty('id');
  });

  test('refuses what no plan can hold', () => {
    expect(() => planValues({ status: 'Booked' })).toThrow(PlanError);
    expect(() => planValues({ status: 'Booked' })).toThrow('"Booked" is not a job status');
    expect(() => planValues({ qty: '2.5' })).toThrow('Qty must be a whole number');
    expect(() => planValues({ qty: -1 })).toThrow(PlanError);
    // A container number is four letters then seven digits (the user's rule, 2026-10-10).
    expect(() => planValues({ containerList: [{ containerNo: 'MSC123' }] }))
      .toThrow('Container No "MSC123" must be 4 letters then 7 digits');
  });

  test('gate-in and cut-off are text, as the program states them', () => {
    expect(planValues({ cutOff: 'tomorrow 1800', gateInTime: 'TBA' })).toMatchObject({ cutOff: 'tomorrow 1800', gateInTime: 'TBA' });
  });

  test("the row's container section: kept lines, closed up and in capitals; the old cells follow it", () => {
    const v = planValues({
      transporterId: '7',
      containerList: [
        { transporterId: 7, size: '40hc', containerNo: 'mscu 123456-7', vehicleDetail: 'JW-1' },
        { containerNo: '', size: '', vehicleDetail: '' },
        { size: '20gp', containerNo: 'TGHU7654321' },
      ],
    });
    expect(v.transporterId).toBe(7);
    expect(JSON.parse(v.containerList)).toEqual([
      { transporterId: 7, size: '40HC', containerNo: 'MSCU1234567', vehicleDetail: 'JW-1' },
      { transporterId: null, size: '20GP', containerNo: 'TGHU7654321', vehicleDetail: null },
    ]);
    expect(v.containers).toBe('MSCU1234567, TGHU7654321');
    expect(v.vehicleDetail).toBe('JW-1');
    // Emptied, it is none.
    expect(planValues({ containerList: [] })).toMatchObject({ containerList: null, containers: null, vehicleDetail: null });
  });

  test('an empty Qty is none, not zero', () => {
    expect(planValues({ qty: '' }).qty).toBeNull();
    expect(planValues({ qty: 0 }).qty).toBe(0);
  });

  test('a row with nothing typed is blank - its status alone is not something', () => {
    expect(isBlankPlan({ status: 'Pending', size: ' ' })).toBe(true);
    expect(isBlankPlan({ shipperId: 3 })).toBe(false);
    expect(isBlankPlan({ qty: 0 })).toBe(false);
    expect(isBlankPlan({ remarks: 'call back' })).toBe(false);
  });
});

describe('the job a plan becomes', () => {
  test('container numbers however they are typed - an owner code and serial with a space is one', () => {
    expect(containerNumbers('MSKU1234567, tghu7654321\nCMAU 1112223 / OOLU4445556'))
      .toEqual(['MSKU1234567', 'TGHU7654321', 'CMAU1112223', 'OOLU4445556']);
    expect(containerNumbers('')).toEqual([]);
  });

  test('trucks split on commas and lines, never on the space in a plate', () => {
    expect(vehicleNumbers('JW 1234, TKA 998\nLES-55')).toEqual(['JW 1234', 'TKA 998', 'LES-55']);
  });

  test('one row per container, each with the size; trucks paired in order', () => {
    const { rows, vehicleLeftOver } = containerRows({
      containers: 'MSKU1234567, TGHU7654321', size: '40hc', qty: 2, vehicleDetail: 'JW 1234, TKA 998',
    });
    expect(rows).toEqual([
      { containerNo: 'MSKU1234567', sizeType: '40HC', truckNo: 'JW 1234', sortOrder: 0 },
      { containerNo: 'TGHU7654321', sizeType: '40HC', truckNo: 'TKA 998', sortOrder: 1 },
    ]);
    expect(vehicleLeftOver).toBeNull();
  });

  test('Qty beyond the numbers typed: rows with the size, waiting for their numbers', () => {
    const { rows } = containerRows({ containers: 'MSKU1234567', size: '20GP', qty: 3 });
    expect(rows.map((r) => [r.containerNo, r.sizeType])).toEqual([
      ['MSKU1234567', '20GP'], ['', '20GP'], ['', '20GP'],
    ]);
  });

  test('a single container takes the whole vehicle detail', () => {
    const { rows, vehicleLeftOver } = containerRows({ qty: 1, size: '40HC', vehicleDetail: 'JW 1234 (Driver Aslam)' });
    expect(rows[0].truckNo).toBe('JW 1234 (Driver Aslam)');
    expect(vehicleLeftOver).toBeNull();
  });

  test('trucks that cannot be matched to containers are kept for the remarks, not dropped', () => {
    const { rows, vehicleLeftOver } = containerRows({ qty: 3, size: '40HC', vehicleDetail: 'JW 1234, TKA 998' });
    expect(rows.every((r) => r.truckNo === null)).toBe(true);
    expect(vehicleLeftOver).toBe('JW 1234, TKA 998');
  });

  test('a mistyped Qty does not make hundreds of rows', () => {
    expect(containerRows({ qty: 400 }).rows).toHaveLength(50);
  });

  test('an export by sea for the shipper, carrying every column the sheet has', () => {
    const { values, containers } = jobFromPlan({
      shipperId: 12, shippingLineId: 4, invoiceNo: 'IN-12', qty: 2, size: '40HC',
      pol: 'MEK', pod: 'AEJEA', containers: 'MSKU1234567', vessel: 'MSC AURORA',
      gateInTime: '2026-10-08 14:30', cutOff: '2026-10-09 18:00', bookingNo: 'BK-778',
      currentStatus: 'Gate In', gdNumber: 'KPEX-SB-1', remarks: 'Fragile', vehicleDetail: 'JW 1, JW 2, JW 3',
    }, { today: '2026-10-07' });
    expect(values).toEqual({
      direction: 'Export', transportMode: 'Sea',
      clientId: 12, shipperId: 12, invoiceNo: 'IN-12', clientRef: 'IN-12',
      pol: 'MEK', pod: 'AEJEA', pofd: 'AEJEA', shippingLineId: 4,
      vesselOrFlight: 'MSC AURORA', carrierBookingNo: 'BK-778',
      gateInTime: '2026-10-08 14:30', cutOff: '2026-10-09 18:00', currentStatus: 'Gate In',
      gdNumber: 'KPEX-SB-1', containers: 'MSKU1234567', containerType: '40HC', cargoType: 'FCL',
      transporterId: null,
      // Three trucks for two containers: kept, on the remarks.
      remarks: 'Fragile\nVehicle: JW 1, JW 2, JW 3',
      jobDate: '2026-10-07', status: 'Incomplete',
    });
    expect(containers).toHaveLength(2);
  });

  test("moved, the section's lines become the job's containers - each with its transporter", () => {
    const { values, containers } = jobFromPlan({
      shipperId: 12, qty: 3, size: '40HC', transporterId: 5,
      containerList: JSON.stringify([
        { transporterId: 9, size: '20GP', containerNo: 'MSCU1234567', vehicleDetail: 'JW-1' },
        { transporterId: null, size: null, containerNo: 'TGHU7654321', vehicleDetail: null },
      ]),
    }, { today: '2026-10-10' });
    expect(containers).toEqual([
      { containerNo: 'MSCU1234567', sizeType: '20GP', truckNo: 'JW-1', transporterId: 9, sortOrder: 0 },
      { containerNo: 'TGHU7654321', sizeType: '40HC', truckNo: null, transporterId: null, sortOrder: 1 },
      // Qty says three: the third, at the plan's size, waits for its number.
      { containerNo: '', sizeType: '40HC', truckNo: null, transporterId: null, sortOrder: 2 },
    ]);
    expect(values.transporterId).toBe(5);
    expect(values.containers).toBe('MSCU1234567, TGHU7654321');
    // No Transport on the plan: the first container's transporter.
    expect(jobFromPlan({ containerList: JSON.stringify([{ transporterId: 9, containerNo: 'MSCU1234567' }]) },
      { today: '2026-10-10' }).values.transporterId).toBe(9);
  });

  test('a plan with no containers makes a job with none, and no shipment type', () => {
    const { values, containers } = jobFromPlan({ shipperId: 3 }, { today: '2026-10-07' });
    expect(containers).toEqual([]);
    expect(values.cargoType).toBeNull();
    expect(values.containers).toBeNull();
    expect(values.remarks).toBeNull();
  });

  test('the job starts at the status Configuration > Customs says new jobs start at', () => {
    expect(jobFromPlan({ shipperId: 3 }, { today: '2026-10-07', jobStatus: 'Docs Awaited' }).values.status)
      .toBe('Docs Awaited');
  });
});
