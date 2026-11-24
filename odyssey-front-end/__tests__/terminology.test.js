/**
 * Operation mode: wording, and what an installation actually has.
 *
 * The mode is read from a cookie so that synchronous render code can consult
 * it, which makes an unset or junk cookie a real state rather than a
 * hypothetical - a fresh browser, an expired session, a hand-edited value.
 * Every one of those must land on freight, because falling into aviation by
 * accident hides the sea half of a freight installation.
 */
import Cookies from 'js-cookie';
import {
  getMode, term, isCustomsMode, isAviationMode, hasSeaOperations,
  jobTypeOptions, AVIATION_PARTY_TYPES, AVIATION_PARTY_TYPE_OPTIONS,
} from 'functions/terminology';

jest.mock('js-cookie', () => ({ get: jest.fn(), set: jest.fn() }));

const inMode = (m) => Cookies.get.mockReturnValue(m);

beforeEach(() => jest.clearAllMocks());

describe('resolving the mode', () => {
  test('reads the cookie the login flow sets', () => {
    inMode('aviation');
    expect(getMode()).toBe('aviation');
    expect(Cookies.get).toHaveBeenCalledWith('operationMode');
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['unknown', 'shipping'],
    ['wrong case', 'Aviation'],
    ['a prototype key', 'constructor'],   // hasOwnProperty, not `in`
    ['a non-string', 42],
  ])('%s falls back to freight', (_label, value) => {
    inMode(value);
    expect(getMode()).toBe('freight');
    expect(isAviationMode()).toBe(false);
    expect(hasSeaOperations()).toBe(true);
  });
});

describe('wording', () => {
  test('freight is the plain shipping vocabulary', () => {
    inMode('freight');
    expect(term('seaJobs')).toBe('Sea Jobs');
    expect(term('airJobs')).toBe('Air Jobs');
    expect(term('modeName')).toBe('Shipping & Air Freight');
  });

  test('customs has its own name but no job wording', () => {
    // It used to relabel the freight sections 'Sea Clearance' / 'Air
    // Clearance', from when customs mode was wording alone. Customs Job
    // replaces both sections now, so those labels render nowhere - and the
    // freight fallback below is never reached either.
    inMode('customs');
    expect(term('modeName')).toBe('Customs Clearance');
    expect(term('seaJobs')).toBe('Sea Jobs');
    expect(term('airJobs')).toBe('Air Jobs');
  });

  test('aviation has no sea wording, and borrows freight if asked', () => {
    // The label exists only as a fallback; nothing in aviation renders it,
    // because hasSeaOperations() stops the section being built at all.
    inMode('aviation');
    expect(term('seaJobs')).toBe('Sea Jobs');
    expect(term('modeName')).toBe('Aviation');
  });

  test('an unknown key returns itself rather than undefined', () => {
    inMode('freight');
    expect(term('noSuchLabel')).toBe('noSuchLabel');
  });
});

describe('sea operations', () => {
  test('freight and customs have them, aviation does not', () => {
    inMode('freight');  expect(hasSeaOperations()).toBe(true);
    inMode('customs');  expect(hasSeaOperations()).toBe(true);
    inMode('aviation'); expect(hasSeaOperations()).toBe(false);
  });
});

describe('mode predicates', () => {
  test('are mutually exclusive', () => {
    inMode('customs');
    expect([isCustomsMode(), isAviationMode()]).toEqual([true, false]);
    inMode('aviation');
    expect([isCustomsMode(), isAviationMode()]).toEqual([false, true]);
    inMode('freight');
    expect([isCustomsMode(), isAviationMode()]).toEqual([false, false]);
  });
});

describe('report operation-type filters', () => {
  test('freight offers all four freight operations', () => {
    inMode('freight');
    expect(jobTypeOptions().map((t) => t.value)).toEqual(['SE', 'SI', 'AE', 'AI']);
  });

  test('customs keeps the four freight operations and adds CC', () => {
    // KEEPS, unlike aviation, which drops the sea ones. A clearing agent's
    // installation still runs freight jobs - the sidebar keeps those sections
    // - so offering only 'CC' would hide invoices that exist.
    inMode('customs');
    expect(jobTypeOptions().map((t) => t.value)).toEqual(['SE', 'SI', 'AE', 'AI', 'CC']);
  });

  test('customs invoices have somewhere to be filtered to', () => {
    // Same bug as the aviation one below: a customs invoice carries operation
    // 'CC', so without this entry it disappeared the moment anyone ticked a
    // type - reading as missing data rather than as a filter.
    inMode('customs');
    expect(jobTypeOptions().some((t) => t.value === 'CC')).toBe(true);
  });

  test('aviation drops sea and adds AV', () => {
    inMode('aviation');
    expect(jobTypeOptions()).toEqual([
      { label: 'Air Export', value: 'AE' },
      { label: 'Air Import', value: 'AI' },
      { label: 'Aviation', value: 'AV' },
    ]);
  });

  test('aviation invoices have somewhere to be filtered to', () => {
    // The bug this exists for: an aviation invoice carries operation 'AV', so
    // with the old hardcoded four-type list it disappeared the moment anyone
    // ticked a type - reading as missing data rather than as a filter.
    inMode('aviation');
    expect(jobTypeOptions().some((t) => t.value === 'AV')).toBe(true);
  });

  test('the shared list is not mutated between modes', () => {
    inMode('aviation');
    jobTypeOptions().push({ label: 'Junk', value: 'XX' });
    inMode('freight');
    expect(jobTypeOptions().map((t) => t.value)).toEqual(['SE', 'SI', 'AE', 'AI']);
  });

  test('every mode hands back its own array, including freight', () => {
    // Freight used to return the module constant itself, so a caller that
    // appended to it would corrupt the list for every screen - in freight mode
    // and in no other, which is the kind of bug that shows up on exactly one
    // installation.
    for (const mode of ['freight', 'customs', 'aviation']) {
      inMode(mode);
      jobTypeOptions().push({ label: 'Junk', value: 'XX' });
      expect(jobTypeOptions().some((t) => t.value === 'XX')).toBe(false);
    }
  });
});

describe('aviation party types', () => {
  // Three parties an AWB names, plus the airline itself. Carrier is here
  // because the payable side of an AWB is almost always paid TO the airline -
  // it sold the space - so a charge must be able to default to it.
  test('are the three an AWB names, plus the carrier', () => {
    expect(AVIATION_PARTY_TYPES.map((t) => t.value))
      .toEqual(['Shipper', 'Consignee', 'Master Agent', 'Carrier']);
  });

  test('the charge-defaults list is the same four in SelectComp shape', () => {
    // SelectComp reads {id,name}; CheckGroupComp reads {label,value}. Shipping
    // the wrong shape renders blank rows rather than failing.
    expect(AVIATION_PARTY_TYPE_OPTIONS).toEqual([
      { id: 'Shipper', name: 'Shipper' },
      { id: 'Consignee', name: 'Consignee' },
      { id: 'Master Agent', name: 'Master Agent' },
      { id: 'Carrier', name: 'Carrier' },
    ]);
  });

  // Carrier is NOT a field on the consignment, unlike the other three: the
  // line names a carrier, and the carrier names its party. Setting a charge's
  // default to it therefore only works if something resolves that hop - see
  // PARTY_RESOLVERS in functions/aviationParty.js and its tests. Pinned here
  // because offering the option without the resolver would silently fail to
  // auto-fill, which reads as "the default does not work".
  test('Carrier is offered as a charge default', () => {
    expect(AVIATION_PARTY_TYPE_OPTIONS.some((t) => t.id === 'Carrier')).toBe(true);
  });

  test('Master Agent is aviation-only', () => {
    // Nothing in the freight screens consumes it, so it must not leak into the
    // freight party list.
    expect(AVIATION_PARTY_TYPES.some((t) => t.value === 'Master Agent')).toBe(true);
  });
});
