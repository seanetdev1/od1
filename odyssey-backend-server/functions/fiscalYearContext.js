const { AsyncLocalStorage } = require('async_hooks');

// Carries "which fiscal year does the current request's user have selected"
// through the whole request without every route/Sequelize call having to
// pass it explicitly - the frontend attaches it as a header on every
// request (see apis/axiosClient.js), and the fiscalYearAssociations hooks
// read it from here to decide whether an update/destroy is allowed to
// touch a record from a fiscal year other than the one currently selected.
const storage = new AsyncLocalStorage();

//
// It also carries WHO is making the request (req.user, set by the auth
// middleware that runs before this one), for the same reason: the audit log
// (functions/history.js) is written from 80-odd places, nearly all of which
// were handed the actor as req.body.employeeId - a value the browser sends,
// and so whatever the browser says.
const fiscalYearContextMiddleware = (req, res, next) => {
    const fiscalYearId = req.headers['x-fiscal-year-id'] || null;
    const userId = req.user?.id || null;
    // scopeCompany is filled in by the permissions middleware once it knows
    // which companies this user may use (functions/companySeparation.js).
    storage.run({ fiscalYearId, userId, scopeCompany: null }, next);
};

const getSelectedFiscalYearId = () => storage.getStore()?.fiscalYearId || null;

/** The signed-in user behind the current request, or null outside one. */
const getRequestUserId = () => storage.getStore()?.userId || null;

/** The company the current request's master lists are scoped to, or null. */
const getScopeCompany = () => storage.getStore()?.scopeCompany ?? null;
const setScopeCompany = (companyId) => {
    const store = storage.getStore();
    if (store) store.scopeCompany = companyId ?? null;
};

module.exports = {
    fiscalYearContextMiddleware, getSelectedFiscalYearId, getRequestUserId,
    getScopeCompany, setScopeCompany,
};
