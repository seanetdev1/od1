import React from 'react';
import { render, screen } from '@testing-library/react';
import Cookies from 'js-cookie';
import { isCompanySelected, useSelectedCompany } from '../functions/selectedCompany';

describe('a company counts as picked only when it is an id', () => {
  test.each(['1', '27', ' 3 ', 4])('%p is picked', (v) => expect(isCompanySelected(v)).toBe(true));
  test.each([undefined, null, '', 'NaN', 'undefined', 'null', 'abc'])('%p is not', (v) => expect(isCompanySelected(v)).toBe(false));
});

describe('useSelectedCompany', () => {
  const Probe = ({ fromStore }) => {
    const { ready, companyId } = useSelectedCompany(fromStore);
    return <span>{ready ? `ready:${companyId || 'none'}` : 'waiting'}</span>;
  };
  afterEach(() => Cookies.remove('companyId'));

  test('the store\'s company, once mounted', async () => {
    render(<Probe fromStore='2' />);
    expect(await screen.findByText('ready:2')).toBeTruthy();
  });

  test('the cookie, while the header has not loaded it into the store yet', async () => {
    Cookies.set('companyId', '5');
    render(<Probe fromStore='' />);
    expect(await screen.findByText('ready:5')).toBeTruthy();
  });

  test('none, when neither holds a company', async () => {
    Cookies.set('companyId', 'NaN');
    render(<Probe fromStore='' />);
    expect(await screen.findByText('ready:none')).toBeTruthy();
  });
});
