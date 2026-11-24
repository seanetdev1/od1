import reducer, { setDJField, resetDirectJob, setDefaultType } from 'redux/directJob/directJobSlice';

/* Resetting a Direct Job clears the ENTRY and keeps the lookup lists.
 *
 * It used to return initialState, which also emptied the jobs, charges and
 * accounts the screen had fetched. The screen resets when it is opened from the
 * sidebar and when it loads an existing entry, so the job picker came up empty
 * - or showed a search's results for an instant and then lost them. */
describe('resetDirectJob', () => {
  const loaded = () => [
    setDJField({ field: 'directJob_Jobs', value: [{ id: 7, jobNo: 'CL-CCJ-7/27' }] }),
    setDJField({ field: 'directJob_Total', value: 1 }),
    setDJField({ field: 'directJob_Charges', value: [{ id: 1, name: 'AGENCY' }] }),
    setDJField({ field: 'directJob_CAccounts', value: [{ id: 5307 }] }),
    setDJField({ field: 'directJob_SettlementAccounts', value: [{ id: 4879 }] }),
    setDJField({ field: 'directJob_Reference', value: 'REF-1' }),
    setDJField({ field: 'directJob_Id', value: '42' }),
  ].reduce(reducer, reducer(undefined, { type: '@@init' }));

  it('keeps the jobs, charges and accounts', () => {
    const s = reducer(loaded(), resetDirectJob());
    expect(s.directJob_Jobs).toEqual([{ id: 7, jobNo: 'CL-CCJ-7/27' }]);
    expect(s.directJob_Total).toBe(1);
    expect(s.directJob_Charges).toHaveLength(1);
    expect(s.directJob_CAccounts).toHaveLength(1);
    expect(s.directJob_SettlementAccounts).toHaveLength(1);
  });

  it('clears the entry itself', () => {
    const s = reducer(loaded(), resetDirectJob());
    expect(s.directJob_Reference).toBe('');
    expect(s.directJob_Id).toBe('');
    expect(s.directJob).toHaveLength(1);
    expect(s.directJob[0].JobId).toBe(0);
  });
});

/* What a NEW entry starts as - Configuration > Direct Job. */
describe('the default type', () => {
  const fresh = () => reducer(undefined, { type: '@@init' });

  // Expense unless the install says revenue (the user's call, 2026-10-20).
  it('is expense until the setting says otherwise', () => {
    expect(fresh().directJob_Type).toBe('expense');
    expect(reducer(fresh(), resetDirectJob()).directJob_Type).toBe('expense');
  });

  it('a reset starts the entry on the configured default', () => {
    const s = [setDefaultType('revenue'), setDJField({ field: 'directJob_Type', value: 'expense' }), resetDirectJob()]
      .reduce(reducer, fresh());
    expect(s.directJob_Type).toBe('revenue');
    expect(s.directJob_DefaultType).toBe('revenue');
  });

  it('arriving late, it moves a new entry still on the old default', () => {
    // The first time the screen opens, the reset runs before the setting lands.
    const s = reducer(reducer(fresh(), resetDirectJob()), setDefaultType('revenue'));
    expect(s.directJob_Type).toBe('revenue');
  });

  it('but not a type somebody picked', () => {
    const s = [setDefaultType('revenue'), setDJField({ field: 'directJob_Type', value: 'expense' }), setDefaultType('revenue')]
      .reduce(reducer, fresh());
    expect(s.directJob_Type).toBe('expense');
  });

  it('nor a saved entry', () => {
    const s = [setDJField({ field: 'directJob_Id', value: '42' }), setDJField({ field: 'directJob_Type', value: 'expense' }), setDefaultType('revenue')]
      .reduce(reducer, fresh());
    expect(s.directJob_Type).toBe('expense');
  });

  it('anything unrecognised is expense', () => {
    expect(reducer(fresh(), setDefaultType(undefined)).directJob_DefaultType).toBe('expense');
    expect(reducer(fresh(), setDefaultType('garbage')).directJob_DefaultType).toBe('expense');
  });
});
