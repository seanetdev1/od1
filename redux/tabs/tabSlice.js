import { createSlice } from '@reduxjs/toolkit'

/* ---------------------------- THE DASHBOARD TAB ----------------------------
 * A tab that is always open, always first, and has no close button.
 *
 * WHY IT IS PINNED. The dashboard lives at '/', and until this existed the
 * only way back to it was to close every other tab: the sidebar's Dashboard
 * section is never added to the menu, and nothing else routes there. So a user
 * with six tabs open had to shut all six to look at the day's figures, and
 * then reopen them. That is not a navigation problem, it is a missing tab.
 *
 * PINNED IN THE SLICE, NOT IN THE LAYOUT. Every path that writes the tab list
 * goes through these reducers - the X, the Alt+W shortcut, a record deleting
 * its own tab, and the bulk `setTab` the layout uses whenever it rebuilds the
 * strip. Guaranteeing it here means a new caller cannot lose the dashboard by
 * forgetting a rule it never knew about; guaranteeing it in the layout would
 * mean re-stating that rule at every one of them.
 *
 * The key is deliberately outside the 'section-child' numbering the sidebar
 * uses (1-1, 2-16, 10-2...), because this tab belongs to no sidebar section:
 * nothing creates it, and it cannot be created twice.
 *
 * NOT MODE-SPECIFIC. One pinned tab covers freight, aviation and customs -
 * '/' already renders the right dashboard for the install (see
 * Components/Layouts/Main, which picks its counters off isAviationMode).
 * ------------------------------------------------------------------------ */
export const HOME_TAB = { label: 'Dashboard', key: '0-0', pinned: true };

/** Is this the tab that cannot be closed? */
export const isPinnedTab = (keyOrTab) =>
  (typeof keyOrTab === 'string' ? keyOrTab : keyOrTab?.key) === HOME_TAB.key;

/**
 * The tab list as it is allowed to be: the dashboard first, exactly once,
 * everything else in the order it was given.
 *
 * Applied to every write rather than only to removals, because a list can lose
 * the pinned tab by being REPLACED as easily as by having it filtered out -
 * `setTab` is handed a whole array that was built somewhere else.
 */
const withHome = (tabs) => [
  HOME_TAB,
  ...(Array.isArray(tabs) ? tabs.filter((t) => !isPinnedTab(t)) : []),
];

const initialState = {
  value: {},
  tabs: withHome([]),
}

export const counterSlice = createSlice({
  name: 'tabs',
  initialState,
  reducers: {
    removeTab: (state, action) => {
      state.tabs = withHome(action.payload)
    },
    removeTabNew: (state, action) => {
      const keyToRemove = action.payload; // just pass the tab key
      state.tabs = withHome(state.tabs.filter(tab => tab.key !== keyToRemove));
    },
    incrementTab: (state, action) => {
      state.value = action.payload
    },
    setTab: (state, action) => {
      state.tabs = withHome(action.payload)
    },
  },
})

// Action creators are generated for each case reducer function
export const { incrementTab, setTab, removeTab, removeTabNew } = counterSlice.actions

export default counterSlice.reducer
