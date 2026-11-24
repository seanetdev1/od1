/**
 * The customs job and Program Book statuses, and the rules each follows -
 * functions/customsStatuses (Configuration > Customs).
 *
 * The defaults are what the code did before there was a setting; the write
 * side refuses what would leave a row at a status nothing knows, or a book
 * where nothing can be billed or moved.
 */
const {
  DEFAULT_STATUSES, normalizeStatuses, validateList, StatusError,
  labelOf, hasRule, valuesWith, startOf, resolveStatus,
} = require('../../functions/customsStatuses');

const clone = (x) => JSON.parse(JSON.stringify(x));
const jobs = () => clone(DEFAULT_STATUSES.job);
const plans = () => clone(DEFAULT_STATUSES.plan);

describe('the defaults - what the code did before', () => {
  const { job, plan } = normalizeStatuses(undefined);

  test('jobs: In Process to start; On Vessel and DrayOff billed; those and Canceled finished', () => {
    expect(job.map((s) => [s.value, s.label])).toEqual([
      ['Incomplete', 'In Process'], ['Complete', 'On Vessel'], ['DrayOff', 'DrayOff'], ['Canceled', 'Canceled'],
    ]);
    expect(startOf(job)).toBe('Incomplete');
    expect(valuesWith(job, 'billable')).toEqual(['Complete', 'DrayOff']);
    expect(valuesWith(job, 'finished')).toEqual(['Complete', 'DrayOff', 'Canceled']);
  });

  test('plans: Pending to start; Confirmed moved; Cancelled closed; the first two shown on opening', () => {
    expect(startOf(plan)).toBe('Pending');
    expect(valuesWith(plan, 'movable')).toEqual(['Confirmed']);
    expect(valuesWith(plan, 'faded')).toEqual(['Cancelled']);
    expect(valuesWith(plan, 'shown')).toEqual(['Pending', 'Confirmed']);
  });
});

describe('reading the setting', () => {
  test('as stored: renamed, recoloured, an added one kept in its place', () => {
    const stored = { job: [
      { value: 'Incomplete', label: 'Under Clearance', color: 'cyan', rules: ['start'] },
      { value: 'Docs Awaited', label: 'Docs Awaited', color: 'orange', rules: [] },
      ...jobs().slice(1),
    ] };
    const { job, plan } = normalizeStatuses(JSON.stringify(stored));
    expect(job.map((s) => s.label)).toEqual(['Under Clearance', 'Docs Awaited', 'On Vessel', 'DrayOff', 'Canceled']);
    expect(job[0].color).toBe('cyan');
    expect(plan).toEqual(DEFAULT_STATUSES.plan);
  });

  test('never loses a built-in status, an unknown rule or colour, or the one to start at', () => {
    const { job } = normalizeStatuses({ job: [
      { value: 'Complete', label: 'On Vessel', color: 'tartan', rules: ['billable', 'teleport'] },
    ] });
    expect(job.map((s) => s.value)).toEqual(['Complete', 'Incomplete', 'DrayOff', 'Canceled']);
    // An unknown colour on a built-in status: its own colour back.
    expect(job[0]).toMatchObject({ color: 'green', rules: ['billable'] });
    expect(startOf(job)).toBe('Incomplete');
  });

  test('two starts: the first; the start is always offered', () => {
    const list = jobs();
    list[1].rules = ['start', 'billable'];
    list[0].hidden = true;
    const { job } = normalizeStatuses({ job: list });
    expect(valuesWith(job, 'start')).toEqual(['Incomplete']);
    expect(job[0].hidden).toBe(false);
    expect(job[1].rules).toEqual(['billable']);
  });

  test('unreadable JSON is the defaults', () => {
    expect(normalizeStatuses('{not json')).toEqual(DEFAULT_STATUSES);
  });
});

describe('saving the setting', () => {
  const previous = () => normalizeStatuses(undefined);
  const save = (kind, list, inUse) => validateList(kind, list, previous()[kind], inUse);
  const refused = (kind, list, message, inUse) => {
    expect(() => save(kind, list, inUse)).toThrow(StatusError);
    expect(() => save(kind, list, inUse)).toThrow(message);
  };

  test('a rename keeps the stored value - the jobs at it stay at it', () => {
    const list = jobs();
    list[1].label = 'Sailed';
    expect(save('job', list)[1]).toMatchObject({ value: 'Complete', label: 'Sailed' });
  });

  test('a new status is stored under the name it is given, made unique', () => {
    const list = [...jobs(), { label: 'Docs Awaited', color: 'orange', rules: [] }];
    expect(save('job', list)[4]).toMatchObject({ value: 'Docs Awaited', label: 'Docs Awaited', hidden: false });
    // A value the client invents is not trusted: it is a new status.
    const forged = [...jobs(), { value: 'Hacked', label: 'Hold', rules: [] }];
    expect(save('job', forged)[4].value).toBe('Hold');
  });

  test('only the rules of its own list, in their order', () => {
    const list = jobs();
    list[3].rules = ['finished', 'movable', 'billable'];
    expect(save('job', list)[3].rules).toEqual(['billable', 'finished']);
  });

  test('a built-in status is never removed; a used one neither; an unused added one may be', () => {
    refused('job', jobs().slice(0, 3), 'Canceled is built in and cannot be removed - untick Offered');
    const before = [...jobs(), { value: 'Docs Awaited', label: 'Docs Awaited', color: 'orange', rules: [], hidden: false }];
    const prev = normalizeStatuses({ job: before }).job;
    expect(() => validateList('job', jobs(), prev, new Map([['Docs Awaited', 3]])))
      .toThrow('Docs Awaited is on 3 jobs - untick Offered instead of removing it.');
    expect(validateList('job', jobs(), prev, new Map())).toHaveLength(4);
  });

  test('one status to start at, and offered', () => {
    const none = jobs();
    none[0].rules = [];
    refused('job', none, 'Pick one status new jobs start at.');
    const two = plans();
    two[1].rules = ['start', 'movable'];
    refused('plan', two, 'Pick one status new Program Book rows start at.');
    const hidden = jobs();
    hidden[0].hidden = true;
    refused('job', hidden, 'In Process is where new jobs start, so it must be offered.');
  });

  test('something can always be billed, and something always moved', () => {
    const list = jobs().map((s) => ({ ...s, rules: s.rules.filter((r) => r !== 'billable') }));
    refused('job', list, 'At least one job status must allow receivable charges to be approved.');
    const book = plans().map((s) => ({ ...s, rules: s.rules.filter((r) => r !== 'movable') }));
    refused('plan', book, 'At least one Program Book status must allow a plan to be moved to the jobs list.');
  });

  test('names: given, unique, short, and not another status\'s stored value', () => {
    const blank = jobs();
    blank[2].label = '  ';
    refused('job', blank, 'Job status 3 needs a name.');
    const twice = jobs();
    twice[2].label = 'on vessel';
    refused('job', twice, 'Two job statuses are called "on vessel".');
    const long = jobs();
    long[2].label = 'X'.repeat(41);
    refused('job', long, 'too long');
    const clash = [...jobs(), { label: 'Complete', rules: [] }];
    refused('job', clash, '"Complete" is how On Vessel is stored - give it another name.');
  });
});

describe('reading a status', () => {
  const list = normalizeStatuses(undefined).job;
  test('by stored value, by name, or by an old spelling', () => {
    expect(resolveStatus(list, 'complete')).toBe('Complete');
    expect(resolveStatus(list, 'On Vessel')).toBe('Complete');
    expect(resolveStatus(list, 'cleared', { cleared: 'Complete' })).toBe('Complete');
    expect(resolveStatus(list, '')).toBeNull();
    expect(resolveStatus(list, 'Teleported')).toBeUndefined();
  });

  test('its name and rules', () => {
    expect(labelOf(list, 'Incomplete')).toBe('In Process');
    expect(labelOf(list, 'Gone')).toBe('Gone');
    expect(hasRule(list, 'DrayOff', 'billable')).toBe(true);
    expect(hasRule(list, 'Incomplete', 'billable')).toBe(false);
  });
});
