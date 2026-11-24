/**
 * Half-filled customs jobs surviving a tab switch - the draft slice.
 *
 * A goods declaration is sixty fields over five pages, and switching tabs is a
 * Router.push that unmounts the whole form. The slice itself is small; what is
 * worth pinning is that it is keyed PER JOB, because more than one job tab can
 * be open at once and a single slot would let whichever was touched last
 * silently overwrite the others - the exact failure that would be reported as
 * "it put the wrong client on my job".
 */
import reducer, {
  saveCustomsJobDraft, clearCustomsJobDraft, clearAllCustomsJobDrafts,
} from 'redux/customsJobDraft/customsJobDraftSlice';

const initial = { drafts: {} };
const draft = (job, containerRows = []) => ({ job, containerRows });

describe('keeping a draft', () => {
  test('holds it under the job it belongs to', () => {
    const state = reducer(initial, saveCustomsJobDraft({
      id: '41', values: draft({ gdNumber: 'KAPE-1' }),
    }));
    expect(state.drafts['41'].job.gdNumber).toBe('KAPE-1');
  });

  test('keeps several open jobs apart', () => {
    let state = reducer(initial, saveCustomsJobDraft({ id: '41', values: draft({ clientId: 7 }) }));
    state = reducer(state, saveCustomsJobDraft({ id: 'new', values: draft({ clientId: 9 }) }));
    state = reducer(state, saveCustomsJobDraft({ id: '52', values: draft({ clientId: 11 }) }));
    expect(state.drafts['41'].job.clientId).toBe(7);
    expect(state.drafts.new.job.clientId).toBe(9);
    expect(state.drafts['52'].job.clientId).toBe(11);
  });

  test('a numeric id and its string are the same job', () => {
    // The form keys off the tab's id, which arrives as a string from the URL
    // and as a number from the row that was clicked.
    let state = reducer(initial, saveCustomsJobDraft({ id: 41, values: draft({ clientId: 7 }) }));
    state = reducer(state, saveCustomsJobDraft({ id: '41', values: draft({ clientId: 8 }) }));
    expect(Object.keys(state.drafts)).toEqual(['41']);
    expect(state.drafts['41'].job.clientId).toBe(8);
  });

  test('the newest typing replaces the last, rather than merging into it', () => {
    // A merge would resurrect a field that had just been CLEARED, which is
    // indistinguishable from the app refusing to let you delete something.
    let state = reducer(initial, saveCustomsJobDraft({
      id: '41', values: draft({ gdNumber: 'KAPE-1', remarks: 'held' }),
    }));
    state = reducer(state, saveCustomsJobDraft({
      id: '41', values: draft({ gdNumber: 'KAPE-1' }),
    }));
    expect(state.drafts['41'].job.remarks).toBeUndefined();
  });

  test('ignores a save with no job to key it on', () => {
    expect(reducer(initial, saveCustomsJobDraft({ values: draft({}) })).drafts).toEqual({});
    expect(reducer(initial, saveCustomsJobDraft({ id: '41' })).drafts).toEqual({});
    expect(reducer(initial, saveCustomsJobDraft({})).drafts).toEqual({});
  });

  test('carries the container rows, which are typed on the same form', () => {
    const rows = [{ containerNo: 'MSKU1234567', size: '40HC' }];
    const state = reducer(initial, saveCustomsJobDraft({ id: '41', values: draft({}, rows) }));
    expect(state.drafts['41'].containerRows).toEqual(rows);
  });
});

describe('letting one go', () => {
  test('clears just that job', () => {
    let state = reducer(initial, saveCustomsJobDraft({ id: '41', values: draft({ clientId: 7 }) }));
    state = reducer(state, saveCustomsJobDraft({ id: '52', values: draft({ clientId: 11 }) }));
    state = reducer(state, clearCustomsJobDraft('41'));
    expect(state.drafts['41']).toBeUndefined();
    expect(state.drafts['52'].job.clientId).toBe(11);
  });

  test('clearing one that was never there is not an error', () => {
    expect(reducer(initial, clearCustomsJobDraft('nope')).drafts).toEqual({});
  });

  test('and everything can be dropped at once', () => {
    let state = reducer(initial, saveCustomsJobDraft({ id: '41', values: draft({}) }));
    state = reducer(state, clearAllCustomsJobDrafts());
    expect(state.drafts).toEqual({});
  });
});
