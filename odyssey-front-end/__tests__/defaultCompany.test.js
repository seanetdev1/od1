import { companyToSelect } from '../functions/defaultCompany';

describe('the company selected once the list has loaded', () => {
  const one = [{ id: 1, title: 'CARGO LINKERS.' }];
  const two = [{ id: 1, title: 'SEA NET' }, { id: 2, title: 'AIR CARGO' }];

  test('a real company already selected is left alone', () => {
    expect(companyToSelect('1', one)).toBeNull();
    expect(companyToSelect('2', two)).toBeNull();
  });

  test('none selected, one company on the install: that one', () => {
    for (const current of [undefined, null, '', 'NaN', 'undefined', 'null']) {
      expect(companyToSelect(current, one)).toBe('1');
    }
  });

  test('a company that no longer exists is replaced too', () => {
    expect(companyToSelect('7', one)).toBe('1');
  });

  test('several companies and none selected: cleared, the user picks', () => {
    expect(companyToSelect('NaN', two)).toBe('');
    expect(companyToSelect(undefined, two)).toBe('');
  });

  test('no list yet: nothing to choose from', () => {
    expect(companyToSelect(undefined, [])).toBe('');
  });
});
