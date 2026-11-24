// Designations as Setup > Employees names them, for the Configuration sections
// that are set per designation (Dashboard Widgets, New Job Alerts). The list
// itself comes from the server, which checks against it.
const LABELS = {
  ceo: 'CEO', cfo: 'CFO', admin: 'Admin', manager: 'Manager', accountant: 'Accountant',
  'gd operator': 'GD Operator', 'date operator': 'Date Operator', hr: 'HR', rider: 'Rider',
};

export const labelOf = (d) => LABELS[d] || String(d || '').replace(/\b\w/g, (c) => c.toUpperCase());
