/**
 * Company identity, for a LEASED product.
 *
 * Every function here exists because the same value used to be hardcoded to
 * Seanet's own companies, ids and artwork. The tests are written from that
 * angle: the important assertion is usually not "returns the right thing for
 * company 1", it is "never falls back to another tenant's name, logo or bank
 * account when this install has none".
 */
import {
  currentCompanyId, allCompanies, getCompany, companyTitle, companyLogo,
  companyDetails, companyBankAccounts, bankAccountFields, formatBankAccount,
  companyOptions, reportCompanyOptions, companyShort, companyShorts,
  companyPrefixLength,
  reportCompanyTitle, reportLetterheadId, reportAddress,
  isAgentDocument, defaultBankAccount,
} from 'functions/companyBranding';
import Cookies from 'js-cookie';
import { store } from 'redux/store';

jest.mock('js-cookie', () => ({ get: jest.fn() }));
jest.mock('redux/store', () => ({ store: { getState: jest.fn() } }));

const COMPANIES = [
  {
    id: 1, title: 'IFA AIRLINES', short: 'ifa', address: 'Karachi',
    phone: '021-111', email: 'ops@ifa.test', web: 'ifa.test',
    ntn: 'N1', strn: 'S1', logo: 'data:image/png;base64,SCREEN',
    printLogo: 'data:image/png;base64,PRINT',
    BankAccounts: [
      { id: 9, bankName: 'Bank B', accountNo: '222' },
      { id: 2, bankName: 'Bank A', branch: 'Main', accountTitle: 'IFA', accountNo: '111', swift: 'SW', iban: 'IB' },
    ],
  },
  { id: 3, short: 'acs' },   // no title: falls back to short
];

const withCompanies = (list) => store.getState.mockReturnValue({ company: { companies: list } });

beforeEach(() => {
  jest.clearAllMocks();
  withCompanies(COMPANIES);
});

describe('reading the store', () => {
  test('returns the installation companies', () => {
    expect(allCompanies()).toHaveLength(2);
  });

  test.each([
    ['no state', undefined],
    ['no company slice', {}],
    ['no companies key', { company: {} }],
  ])('%s gives an empty list, not a crash', (_l, state) => {
    store.getState.mockReturnValue(state);
    expect(allCompanies()).toEqual([]);
    expect(companyOptions()).toEqual([]);
  });

  test('a throwing store is tolerated', () => {
    // These are plain functions called from print builders, not components -
    // there is no error boundary underneath them.
    store.getState.mockImplementation(() => { throw new Error('no store yet'); });
    expect(allCompanies()).toEqual([]);
  });
});

describe('looking a company up', () => {
  test('matches across the string/number divide', () => {
    // Ids arrive as numbers from redux, strings from cookies and query params.
    expect(getCompany(1).title).toBe('IFA AIRLINES');
    expect(getCompany('1').title).toBe('IFA AIRLINES');
  });

  test.each([[null], [undefined], ['']])('%p is not a lookup', (v) => {
    expect(getCompany(v)).toBeNull();
  });

  test('an unknown id is null, not the first company', () => {
    expect(getCompany(99)).toBeNull();
  });
});

describe('company name', () => {
  test('prefers title, falls back to short', () => {
    expect(companyTitle(1)).toBe('IFA AIRLINES');
    expect(companyTitle(3)).toBe('acs');
  });

  test('an unknown company gets the caller fallback, never another tenant', () => {
    expect(companyTitle(99)).toBe('');
    expect(companyTitle(99, '-')).toBe('-');
  });
});

describe('logo', () => {
  test('print prefers printLogo, screen prefers logo', () => {
    expect(companyLogo(1, { print: true })).toContain('PRINT');
    expect(companyLogo(1)).toContain('SCREEN');
  });

  test('either falls back to the other when only one is set', () => {
    withCompanies([{ id: 1, logo: 'only-screen' }]);
    expect(companyLogo(1, { print: true })).toBe('only-screen');
    withCompanies([{ id: 1, printLogo: 'only-print' }]);
    expect(companyLogo(1)).toBe('only-print');
  });

  test('no logo returns null so the caller renders NOTHING', () => {
    // Substituting a bundled image here would put someone else's branding on
    // a client's invoice. A text-only header is the correct outcome.
    withCompanies([{ id: 1, title: 'IFA' }]);
    expect(companyLogo(1)).toBeNull();
    expect(companyLogo(99)).toBeNull();
  });
});

describe('address block', () => {
  test('is always an object, with every field a string', () => {
    const d = companyDetails(99);
    expect(Object.values(d).every((v) => v === '')).toBe(true);
    expect(Object.keys(d)).toEqual(
      ['title', 'short', 'address', 'phone', 'email', 'web', 'ntn', 'strn']
    );
  });

  test('fills from the record', () => {
    expect(companyDetails(1)).toMatchObject({ title: 'IFA AIRLINES', ntn: 'N1', web: 'ifa.test' });
  });
});

describe('bank accounts', () => {
  test('come back in the order they were added', () => {
    expect(companyBankAccounts(1).map((a) => a.id)).toEqual([2, 9]);
  });

  test('a company with none gets an empty list', () => {
    expect(companyBankAccounts(3)).toEqual([]);
    expect(companyBankAccounts(99)).toEqual([]);
  });

  test('sorting does not mutate the stored array', () => {
    // allCompanies() hands back the live redux objects.
    companyBankAccounts(1);
    expect(COMPANIES[0].BankAccounts.map((a) => a.id)).toEqual([9, 2]);
  });

  test('fields are labelled in a fixed order, empties dropped', () => {
    expect(bankAccountFields(companyBankAccounts(1)[1])).toEqual([
      ['Bank Name', 'Bank B'],
      ['A/c #', '222'],
    ]);
  });

  test('the printed block is the same fields, one per line', () => {
    // Print output is byte-compared against what shipped before the refactor,
    // so the joining must not drift from the field list.
    expect(formatBankAccount(companyBankAccounts(1)[0])).toBe(
      'Bank Name: Bank A\nBank Branch: Main\nA/c Title: IFA\nA/c #: 111\nSwift Code: SW\nIBAN: IB'
    );
  });

  test('no account prints nothing rather than "undefined"', () => {
    expect(formatBankAccount(null)).toBe('');
    expect(bankAccountFields(undefined)).toEqual([]);
  });
});

describe('the account an invoice prints by default', () => {
  // Config > Bank Accounts: "Make client default" (JI / JB) and "Make agent
  // default" (AI / AB). The server puts the two flags on each account.
  const accounts = [
    { id: 9, label: 'Habib - USD', agentDefault: true },
    { id: 2, label: 'Soneri - Main' },
    { id: 5, label: 'Meezan', clientDefault: true },
  ];

  test('an agent invoice or bill is an agent document', () => {
    expect(isAgentDocument({ type: 'Agent Invoice' })).toBe(true);
    expect(isAgentDocument({ type: 'Agent Bill' })).toBe(true);
    expect(isAgentDocument({ type: 'Old Agent Invoice' })).toBe(true);
    // An agent's opening invoice is typed as an opening, but it is the agent's.
    expect(isAgentDocument({ type: 'Opening Invoice', partyType: 'agent' })).toBe(true);
    expect(isAgentDocument({ type: 'Job Invoice', partyType: 'client' })).toBe(false);
    expect(isAgentDocument({ type: 'Job Bill', partyType: 'vendor' })).toBe(false);
    expect(isAgentDocument(null)).toBe(false);
  });

  test('a job invoice or bill takes the client default', () => {
    expect(defaultBankAccount(accounts, { type: 'Job Invoice' }).label).toBe('Meezan');
    expect(defaultBankAccount(accounts, { type: 'Job Bill' }).label).toBe('Meezan');
  });

  test('an agent invoice or bill takes the agent default', () => {
    expect(defaultBankAccount(accounts, { type: 'Agent Invoice' }).label).toBe('Habib - USD');
    expect(defaultBankAccount(accounts, { type: 'Agent Bill' }).label).toBe('Habib - USD');
  });

  test('with that default unset, the first account added - as it always was', () => {
    const none = accounts.map(({ id, label }) => ({ id, label }));
    expect(defaultBankAccount(none, { type: 'Job Invoice' }).label).toBe('Soneri - Main');
    expect(defaultBankAccount([accounts[0], accounts[1]], { type: 'Job Invoice' }).label).toBe('Soneri - Main');
  });

  test('a company with no accounts prints none', () => {
    expect(defaultBankAccount([], { type: 'Job Invoice' })).toBeNull();
    expect(defaultBankAccount(undefined, { type: 'Agent Invoice' })).toBeNull();
  });
});

describe('company pickers', () => {
  test('are built from the installation, not a hardcoded list', () => {
    expect(companyOptions()).toEqual([
      { value: 1, label: 'IFA AIRLINES' },
      { value: 3, label: 'acs' },
    ]);
  });

  test('a company with no name at all is still selectable', () => {
    withCompanies([{ id: 7 }]);
    expect(companyOptions()).toEqual([{ value: 7, label: 'Company 7' }]);
  });

  test('report filters lead with "All companies"', () => {
    expect(reportCompanyOptions()[0]).toEqual({ value: 'all', label: 'All companies' });
    expect(reportCompanyOptions()).toHaveLength(3);
  });

  test('report filters never offer the legacy hardcoded ids', () => {
    // The reports used to default to value 4 = "SNS & ACS", meaning companies
    // 1 and 3. On any other install that filtered on rows that do not exist,
    // so the report came back empty and read as missing data.
    const values = reportCompanyOptions().map((o) => String(o.value));
    expect(values).not.toContain('4');
    // Every remaining option is a company this installation actually has, so
    // no filter can select rows that are not there.
    const ours = new Set(allCompanies().map((c) => String(c.id)));
    expect(values.filter((v) => v !== 'all').every((v) => ours.has(v))).toBe(true);
  });

  test('an install with no companies still offers "All companies"', () => {
    withCompanies([]);
    expect(reportCompanyOptions()).toEqual([{ value: 'all', label: 'All companies' }]);
  });
});

describe('short codes', () => {
  test('are uppercased and trimmed', () => {
    expect(companyShort(1)).toBe('IFA');
    expect(companyShorts()).toEqual(['IFA', 'ACS']);
  });

  test('an unknown company gives an empty string, not "undefined"', () => {
    expect(companyShort(99)).toBe('');
  });

  test('companies with no short code are dropped from the list', () => {
    withCompanies([{ id: 1, short: '  ' }, { id: 2 }, { id: 3, short: 'x' }]);
    expect(companyShorts()).toEqual(['X']);
  });
});

describe('document number prefixes', () => {
  test('measure the real code length, not a hardcoded 4', () => {
    expect(companyPrefixLength('IFA-AVJ-1/27')).toBe(4);
  });

  test('work for codes that are not three letters', () => {
    // The old code did slice(0, 4), which silently breaks for any other length.
    withCompanies([{ id: 1, short: 'AB' }, { id: 2, short: 'LONGCO' }]);
    expect(companyPrefixLength('AB-123')).toBe(3);
    expect(companyPrefixLength('LONGCO-123')).toBe(7);
  });

  test('are case-insensitive', () => {
    expect(companyPrefixLength('ifa-avj-1/27')).toBe(4);
  });

  test('require the dash', () => {
    expect(companyPrefixLength('IFAX-123')).toBe(0);
  });

  test.each([['no match', 'XYZ-1'], ['empty', ''], ['null', null], ['a number', 12345]])(
    '%s returns 0', (_l, v) => {
      expect(companyPrefixLength(v)).toBe(0);
    }
  );
});

describe('current company', () => {
  test('comes from the cookie the header dropdown writes', () => {
    Cookies.get.mockReturnValue('3');
    expect(currentCompanyId()).toBe('3');
    expect(Cookies.get).toHaveBeenCalledWith('companyId');
  });

  test('is null when unset or unreadable', () => {
    Cookies.get.mockReturnValue(undefined);
    expect(currentCompanyId()).toBeNull();
    Cookies.get.mockImplementation(() => { throw new Error('no document'); });
    expect(currentCompanyId()).toBeNull();
  });
});


/* Names by the install's own ids. On SNS's install the legacy ids are kept -
 * 1 CARGO LINKERS, 2 SEA NET, 3 AIR CARGO SERVICES - so the invoice print's
 * "company 2 is CargoLinkers" and the Excel headers' "2 is Air Cargo
 * Services" both named the wrong company there. */
describe('reportCompanyTitle', () => {
  const SNS_INSTALL = [
    { id: 1, title: 'CARGO LINKERS', short: 'CL' },
    { id: 2, title: 'SEA NET SHIPPING & LOGISTICS', short: 'SNS' },
    { id: 3, title: 'AIR CARGO SERVICES (PVT) LIMITED', short: 'ACS' },
  ];

  test('names the picked company by its own record', () => {
    withCompanies(SNS_INSTALL);
    expect(reportCompanyTitle('2')).toBe('SEA NET SHIPPING & LOGISTICS');
    expect(companyTitle(2)).toBe('SEA NET SHIPPING & LOGISTICS');
  });

  /* "All companies" prints the company selected in the HEADER - it named every
   * company run together, or (for 'all') printed a blank letterhead. */
  test('names the header\'s company when the report covers all of them', () => {
    withCompanies(SNS_INSTALL);
    Cookies.get.mockReturnValue('3');
    expect(reportCompanyTitle('all')).toBe('AIR CARGO SERVICES (PVT) LIMITED');
    expect(reportCompanyTitle('')).toBe('AIR CARGO SERVICES (PVT) LIMITED');
    expect(reportCompanyTitle(undefined)).toBe('AIR CARGO SERVICES (PVT) LIMITED');
  });

  test('a picked company is still the picked company, whatever the header says', () => {
    withCompanies(SNS_INSTALL);
    Cookies.get.mockReturnValue('3');
    expect(reportCompanyTitle('2')).toBe('SEA NET SHIPPING & LOGISTICS');
  });

  test('every name only when the header has no company either', () => {
    withCompanies(SNS_INSTALL);
    Cookies.get.mockReturnValue(undefined);
    expect(reportCompanyTitle('all')).toBe('CARGO LINKERS & SEA NET SHIPPING & LOGISTICS & AIR CARGO SERVICES (PVT) LIMITED');
  });
});

describe('a report\'s letterhead company', () => {
  test('is the picked company, or the header\'s for "All companies"', () => {
    Cookies.get.mockReturnValue('1');
    expect(reportLetterheadId('3')).toBe('3');
    expect(reportLetterheadId('all')).toBe('1');
    expect(reportLetterheadId('')).toBe('1');
    expect(reportLetterheadId(99)).toBe('1');   // not a company on this install
  });

  test('prints that company\'s own address - never the one that was typed in', () => {
    Cookies.get.mockReturnValue('1');
    expect(reportAddress('all')).toBe('Karachi');
    expect(reportAddress('3')).toBe('');      // company 3 has none recorded
  });
});
