/**
 * A customs job screen's layout and labels - Configuration > Customs > Job
 * Screen (Essani, 2026-11-14), functions/customsJobForm. Unset, the screen is
 * the built-in five tabs, exactly as before.
 */
import {
  builtInLayout, completeLayout, visibleTabs, tabOf, sameTab, SECTION_KEYS, withDefaults,
  DEFAULT_CUSTOMS_JOB_FORM, isFreightForwarding,
} from 'functions/customsJobForm';
import { hasJobReference, containerNumbers } from 'functions/customsJobReference';

const titles = (tabs) => tabs.map((t) => t.title);

describe('the built-in layout - an install that sets nothing', () => {
  test('the five tabs, in the order the work happens', () => {
    const tabs = visibleTabs(completeLayout(null));
    expect(titles(tabs)).toEqual(['Job Details', 'Loading Program (CRO)', 'Transport', 'Booking Info', 'Goods Declaration']);
    expect(tabs[2].sections).toEqual(['haulage', 'containers']);
  });

  test('a clearing-only file: no Transport tab, the containers beside the route', () => {
    const tabs = visibleTabs(completeLayout(null), { showHaulage: false });
    expect(titles(tabs)).toEqual(['Job Details', 'Loading Program (CRO)', 'Booking Info', 'Goods Declaration']);
    expect(tabs[1].sections).toEqual(['parties', 'route', 'containers']);
  });

  test('Documents on Goods Declaration: Booking Info goes, Documents tops Goods Declaration', () => {
    const tabs = visibleTabs(completeLayout(null, { documentsOnGd: true }));
    expect(titles(tabs)).not.toContain('Booking Info');
    expect(tabs.find((t) => t.title === 'Goods Declaration').sections[0]).toBe('documents');
  });

  test('every section is on exactly one tab', () => {
    const all = builtInLayout().tabs.flatMap((t) => t.sections);
    expect([...all].sort()).toEqual([...SECTION_KEYS].sort());
  });

  test('the setting unset is the screen as it was', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_CUSTOMS_JOB_FORM);
    expect(DEFAULT_CUSTOMS_JOB_FORM).toMatchObject({ referenceLabel: 'S/R Page #', commodities: true, freightForwarding: false });
  });
});

describe("an arranged layout - Essani's", () => {
  const oneTab = { tabs: [{ key: 'details', title: 'Job Details', sections: [...SECTION_KEYS] }] };

  test('everything on Job Details, and Job Details is the only tab', () => {
    const tabs = visibleTabs(completeLayout(oneTab));
    expect(titles(tabs)).toEqual(['Job Details']);
    expect(tabs[0].sections).toEqual(SECTION_KEYS);
  });

  test('a clearing-only file there loses Haulage alone - the containers stay put', () => {
    const tabs = visibleTabs(completeLayout(oneTab), { showHaulage: false });
    expect(tabs[0].sections).not.toContain('haulage');
    expect(tabs[0].sections).toContain('containers');
  });

  test('sections that share a tab - Client and the Client Invoice # are shown once', () => {
    const tabs = visibleTabs(completeLayout(oneTab));
    expect(sameTab(tabs, 'parties', 'jobDetails')).toBe(true);
    const built = visibleTabs(completeLayout(null));
    expect(sameTab(built, 'parties', 'jobDetails')).toBe(false);
    expect(tabOf(built, 'goods')).toBe('gd');
  });

  test('a stored layout missing sections still shows them all, on the first tab', () => {
    const layout = completeLayout({ tabs: [{ key: 'a', title: 'A', sections: ['goods'] }, { key: 'b', title: 'B', sections: ['goods', 'route'] }] });
    expect(layout.tabs[1].sections).toEqual(['route']);
    expect(layout.tabs.flatMap((t) => t.sections)).toHaveLength(SECTION_KEYS.length);
  });

  test('an empty tab is not shown', () => {
    const tabs = visibleTabs(completeLayout({ tabs: [{ key: 'a', title: 'A', sections: SECTION_KEYS }, { key: 'b', title: 'B', sections: [] }] }));
    expect(titles(tabs)).toEqual(['A']);
  });
});

describe('Freight Forwarding - the HBL # in place of the Client Invoice #', () => {
  test('such a job saves with its HBL #', () => {
    expect(isFreightForwarding({ jobType: 'Freight Forwarding' })).toBe(true);
    expect(hasJobReference({ jobType: 'Freight Forwarding', blNo: 'HBL-1' })).toBe(true);
    // Its Client Invoice # is not on its screen, so it does not count.
    expect(hasJobReference({ jobType: 'Freight Forwarding', clientRef: 'INV-1' })).toBe(false);
  });

  test('any other job, as before: S/R Page #, Client Invoice # or GD #', () => {
    expect(hasJobReference({ jobType: 'Clearing', clientRef: 'INV-1' })).toBe(true);
    expect(hasJobReference({ jobType: 'Clearing', blNo: 'HBL-1' })).toBe(false);
    expect(hasJobReference({ jobRef: '12' })).toBe(true);
    expect(hasJobReference({ gdNumber: 'KPPE-1' })).toBe(true);
  });
});

describe('container numbers for the invoice Note box', () => {
  test('the rows, once each; else the typed list; else nothing', () => {
    expect(containerNumbers({ Customs_Containers: [{ containerNo: 'MSKU1234567' }, { containerNo: 'TCLU7654321' }, { containerNo: 'MSKU1234567' }] }))
      .toBe('MSKU1234567, TCLU7654321');
    expect(containerNumbers({ Customs_Containers: [], containers: 'ABCD1234567' })).toBe('ABCD1234567');
    expect(containerNumbers(null)).toBe('');
  });
});
