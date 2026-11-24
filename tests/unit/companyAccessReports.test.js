const { refusal, widenAll, reportCompanies } = require('../../functions/companyAccess');

/* "ALL COMPANIES" FOR SOMEONE WHO WORKS IN SOME (2026-10-24): SNS's Job
 * Balancing crashed on Go - the report asks for company 'all', and a user
 * restricted to Sea Net and Air Cargo Services was refused it. Their 'all' is
 * now their own companies, and a report never shows them more. */
describe('a restricted user asking for all companies', () => {
  const mine = new Set(['2', '3']);

  it("has 'all' read as their companies, wherever the request names it", () => {
    const req = { headers: { company: 'all' }, query: { company: 'ALL' }, body: { data: { companyId: 'all' } } };
    widenAll(req, mine);
    expect(req.headers.company).toBe('2,3');
    expect(req.query.company).toBe('2,3');
    expect(req.body.data.companyId).toBe('2,3');
    expect(refusal(req, mine)).toBeNull();
  });

  it('is still refused a list with a company that is not theirs', () => {
    expect(refusal({ headers: { company: '2,1' } }, mine)).toBe('You do not have access to that company.');
    expect(refusal({ headers: { company: '1' } }, mine)).toBe('You do not have access to that company.');
  });

  it('leaves someone who works in every company alone', () => {
    const req = { headers: { company: 'all' } };
    widenAll(req, null);
    expect(req.headers.company).toBe('all');
    expect(refusal(req, null)).toBeNull();
  });
});

describe("a report's companies", () => {
  it('as before for someone who works in every company', () => {
    expect(reportCompanies('all')).toBeNull();
    expect(reportCompanies('')).toBeNull();
    expect(reportCompanies(undefined)).toBeNull();
    expect(reportCompanies('4')).toEqual(['1', '3']); // the legacy Seanet "1 and 3"
    expect(reportCompanies('2')).toEqual(['2']);
    expect(reportCompanies('2,3')).toEqual(['2', '3']);
  });

  it('never more than theirs for a restricted user - nothing named is theirs, not everyone\'s', () => {
    const mine = new Set(['3', '2']);
    expect(reportCompanies(undefined, mine)).toEqual(['2', '3']);
    expect(reportCompanies('all', mine)).toEqual(['2', '3']);
    expect(reportCompanies('2,3', mine)).toEqual(['2', '3']);
    expect(reportCompanies('4', mine)).toEqual(['3']);
    expect(reportCompanies('1', mine)).toEqual([]);
  });
});
