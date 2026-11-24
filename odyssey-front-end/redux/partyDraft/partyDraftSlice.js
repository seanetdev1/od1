import { createSlice } from '@reduxjs/toolkit';

// In-progress party forms, so switching tabs does not throw away what has been
// typed.
//
// KEYED BY THE PARTY ID from the tab ('new', or the id being edited). More
// than one party tab can be open at once - a new party alongside two being
// edited - and a single slot would let whichever was touched last overwrite
// the others.
//
// Values only, and only plain ones: see functions/partyDraft for the moment
// fields that have to be converted on the way in.
const initialState = {
  drafts: {},
};

export const partyDraftSlice = createSlice({
  name: 'partyDrafts',
  initialState,
  reducers: {
    saveDraft: (state, action) => {
      const { id, values } = action.payload;
      if (!id || !values) return;
      state.drafts[String(id)] = values;
    },
    // Called once the party has actually been saved. The draft has served its
    // purpose then, and leaving it would make the next visit to that party
    // offer to restore what is already in the database.
    clearDraft: (state, action) => {
      delete state.drafts[String(action.payload)];
    },
    clearAllDrafts: (state) => {
      state.drafts = {};
    },
  },
});

export const { saveDraft, clearDraft, clearAllDrafts } = partyDraftSlice.actions;

export default partyDraftSlice.reducer;
