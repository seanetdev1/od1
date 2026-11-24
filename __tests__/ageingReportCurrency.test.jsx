/**
 * The ageing report by currency - AgeingSummary and AgeingWeekly render a
 * total line per currency (never USD added to PKR), or one converted total
 * when everything is shown in PKR. See functions/ageingCurrency.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import moment from 'moment';
import Summary from '../Components/Layouts/Reports/AgeingReport/AgeingSummary';
import Weekly from '../Components/Layouts/Reports/AgeingReport/AgeingWeekly';

jest.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: {} }) }));
jest.mock('Components/Shared/PrintTopHeader', () => () => null);
jest.mock('functions/companyBranding', () => ({
  companyLogoBlob: jest.fn(), reportCompanyTitle: () => '', reportAddress: () => '',
}));

const today = moment().toISOString();
const result = {
  temp: [{
    partyName: 'ATLAS GLOBAL', partyCode: '0201', salesRep: 'Sara Ahmed',
    invoices: [
      { partyCode: '0201', partyName: 'ATLAS GLOBAL', currency: 'USD', ex_rate: '280', payType: 'Recievable', total: '1000', recieved: '400', paid: '0', updatedAt: today },
      { partyCode: '0201', partyName: 'ATLAS GLOBAL', currency: 'PKR', ex_rate: '282.4', payType: 'Recievable', total: '50000', recieved: '0', paid: '0', updatedAt: today },
    ],
  }],
};
const query = (currency) => ({ from: today, to: today, ageing_currency: currency });
const totalLines = () => [...document.querySelectorAll('tfoot tr')].map((tr) =>
  [...tr.querySelectorAll('td')].map((td) => td.textContent));

describe.each([['Summary', Summary], ['Weekly', Weekly]])('Ageing %s', (_, View) => {
  test('all currencies: one total line per currency, PKR first', () => {
    render(<View query={query('All')} result={result} />);
    const lines = totalLines();
    expect(lines.map((l) => l[3])).toEqual(['PKR', 'USD']);
    expect(lines[0][lines[0].length - 1]).toBe('50,000.00');
    expect(lines[1][lines[1].length - 1]).toBe('600.00');
    expect(screen.getByText('All currencies')).toBeTruthy();
  });

  test('all in PKR: the USD balance converted at its own rate, one total', () => {
    render(<View query={query('All-PKR')} result={result} />);
    const lines = totalLines();
    expect(lines.map((l) => l[3])).toEqual(['PKR']);
    // 600 x 280 + 50,000 (a PKR invoice at 1, not its 282.4)
    expect(lines[0][lines[0].length - 1]).toBe('218,000.00');
    expect(screen.getByText('All, in PKR')).toBeTruthy();
  });

  test('each row names the party\x27s sales rep', () => {
    render(<View query={query('All')} result={result} />);
    const row = [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('ATLAS GLOBAL'));
    expect(row.textContent).toContain('Sara Ahmed');
  });
});

/* Aged as on TODAY, whatever the To date (the user, 2026-11-02): To only
 * picks the invoices. A To a year out put everything "Above 120". */
describe('the To date picks invoices, it does not age them', () => {
  const dated = (createdAt) => ({
    temp: [{ partyName: 'ATLAS GLOBAL', partyCode: '0201', invoices: [
      { partyCode: '0201', partyName: 'ATLAS GLOBAL', currency: 'PKR', ex_rate: '1', payType: 'Recievable', total: '50000', recieved: '0', paid: '0', createdAt },
    ] }],
  });
  const nextYear = moment().add(1, 'year').toISOString();
  // A/C Code, Title, Sales Rep, Curr, Settlement, then Current Inv ... Above 120.
  const row = () => [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes('ATLAS GLOBAL'));
  const buckets = () => [...row().querySelectorAll('td')].slice(5, 11).map((td) => td.textContent);

  test("today's invoice is current with To a year out", () => {
    render(<Summary query={{ from: today, to: nextYear, ageing_currency: 'All' }} result={dated(today)} />);
    expect(buckets()).toEqual(['50,000.00', '0.00', '0.00', '0.00', '0.00', '0.00']);
  });

  test('a forward-dated invoice is current until its date comes', () => {
    render(<Summary query={{ from: today, to: nextYear, ageing_currency: 'All' }} result={dated(moment().add(20, 'days').toISOString())} />);
    expect(buckets()[0]).toBe('50,000.00');
  });

  test('a 45-day-old invoice is 31-60 days, whatever the To date', () => {
    render(<Summary query={{ from: moment().subtract(1, 'year').toISOString(), to: nextYear, ageing_currency: 'All' }}
      result={dated(moment().subtract(45, 'days').toISOString())} />);
    expect(buckets()[2]).toBe('50,000.00');
  });
});
