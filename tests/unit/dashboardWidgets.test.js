const {
  WIDGET_KEYS, DEFAULTS, withDefaults, validate, widgetsFor,
} = require('../../functions/dashboardWidgets');

/* WHICH DESIGNATION SEES WHICH HOME-PAGE WIDGET (Configuration > Dashboard
 * Widgets; the user, 2026-11-23). The rules without a database. */
describe('dashboard widgets - the grid', () => {
  it('has the five widgets, in the order the page lays them out', () => {
    expect(WIDGET_KEYS).toEqual(['jobCounters', 'incomeExpense', 'cashFlow', 'pendingInvoices', 'auditLog']);
  });

  it('starts every widget at CEO, CFO and admin - the user\'s default', () => {
    const grid = withDefaults(null);
    for (const k of WIDGET_KEYS) expect(grid[k]).toEqual(['ceo', 'cfo', 'admin']);
    expect(withDefaults('not an object')).toEqual(grid);
    expect(DEFAULTS.auditLog).toEqual(['ceo', 'cfo', 'admin']);
  });

  it('reads what was saved over the defaults, a widget not saved keeping its default', () => {
    const grid = withDefaults({ jobCounters: [' GD Operator ', 'manager'], cashFlow: [] });
    expect(grid.jobCounters).toEqual(['manager', 'gd operator']); // list order, lower case
    expect(grid.cashFlow).toEqual([]); // nobody, as saved
    expect(grid.auditLog).toEqual(['ceo', 'cfo', 'admin']);
  });

  it('drops designations it does not know - the System row\'s among them', () => {
    expect(withDefaults({ auditLog: ['system', 'peon', 'cfo'] }).auditLog).toEqual(['cfo']);
  });

  it('refuses what the screen could not have sent', () => {
    expect(() => validate(null)).toThrow(/widget: \[designations\]/);
    expect(() => validate({ weather: ['ceo'] })).toThrow('Unknown widget: weather.');
    expect(() => validate({ cashFlow: 'ceo' })).toThrow('cashFlow must be a list of designations.');
    expect(() => validate({ cashFlow: ['ceo', 'janitor', 'janitor'] })).toThrow('Unknown designation: janitor.');
    try { validate({ weather: [] }); } catch (e) { expect(e.status).toBe(400); }
  });

  it('tidies a good grid', () => {
    expect(validate({ pendingInvoices: ['Accountant', 'CFO'] }).pendingInvoices).toEqual(['cfo', 'accountant']);
  });
});

describe('dashboard widgets - a designation\'s', () => {
  const grid = withDefaults({ jobCounters: ['gd operator', 'ceo'], auditLog: ['admin'] });

  it('are the widgets it is ticked for, in page order, whatever its case', () => {
    expect(widgetsFor('CEO', grid)).toEqual(['jobCounters', 'incomeExpense', 'cashFlow', 'pendingInvoices']);
    expect(widgetsFor('gd operator', grid)).toEqual(['jobCounters']);
    expect(widgetsFor('admin', grid)).toEqual(['incomeExpense', 'cashFlow', 'pendingInvoices', 'auditLog']);
  });

  it('are none for no designation, or one ticked nowhere', () => {
    expect(widgetsFor(null, grid)).toEqual([]);
    expect(widgetsFor('  ', grid)).toEqual([]);
    expect(widgetsFor('rider', grid)).toEqual([]);
  });
});
