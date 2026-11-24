import { createSlice } from '@reduxjs/toolkit';

// In-progress customs jobs, so switching tabs does not throw away what has
// been typed.
//
// The same problem the party form has - see redux/partyDraft, which this
// mirrors deliberately - and a worse one here, because a goods declaration is
// a sixty-field form spread over five pages. Switching to another tab is a
// Router.push: the page unmounts and every useState in it goes with it. Half a
// file entered, one glance at the job list, all gone.
//
// KEYED BY THE JOB from the tab ('new', or the id being edited), because more
// than one job tab can be open at once and a single slot would let whichever
// was touched last overwrite the others.
//
// WHAT IS DRAFTED, and what is not:
//
//   - the job's own fields, and the container rows. Both are typed into this
//     form and exist nowhere else until Save.
//   - NOT the charges. A charge is approved, invoiced and frozen by the
//     server, and carries the Invoice it sits on; holding a copy in the store
//     would let a stale one be restored over the top of what the books say -
//     re-offering a charge that has since been billed, or resurrecting one
//     that was deleted. Charges are reloaded from the server, always.
//   - NOT the duty lines. This screen does not mount that grid at all.
//
// Everything drafted is a plain string, number or array of plain objects -
// dates on this form are stored as 'YYYY-MM-DD' strings, not moments - so
// nothing needs converting on the way in or out, and redux-toolkit's
// serializableCheck has nothing to complain about.
const initialState = {
  drafts: {},
};

export const customsJobDraftSlice = createSlice({
  name: 'customsJobDrafts',
  initialState,
  reducers: {
    saveCustomsJobDraft: (state, action) => {
      const { id, values } = action.payload || {};
      if (!id || !values) return;
      state.drafts[String(id)] = values;
    },
    // Called once the job has actually been saved, and when its tab is closed.
    // The draft has served its purpose then, and leaving it would make the next
    // visit to that job offer to restore what is already in the database.
    clearCustomsJobDraft: (state, action) => {
      delete state.drafts[String(action.payload)];
    },
    clearAllCustomsJobDrafts: (state) => {
      state.drafts = {};
    },
  },
});

export const {
  saveCustomsJobDraft, clearCustomsJobDraft, clearAllCustomsJobDrafts,
} = customsJobDraftSlice.actions;

export default customsJobDraftSlice.reducer;
