const {
  SECTIONS, DEFAULTS, normalizeCustomsJobForm, normalizeLayout, parseCustomsJobForm, CustomsJobFormError,
} = require('../../functions/customsJobForm');

// Configuration > Customs' job screen options (Essani, 2026-11-14) - unset,
// the screen is as it was.
describe('customs job form setting', () => {
  test('unset is the screen as it was', () => {
    expect(parseCustomsJobForm(null)).toEqual(DEFAULTS);
    expect(DEFAULTS).toMatchObject({
      referenceLabel: 'S/R Page #', layout: null, commodities: true,
      addPorts: false, containerSizeList: false, freightForwarding: false,
    });
  });

  test('a garbled stored value reads as the default, never an error', () => {
    expect(parseCustomsJobForm('{not json')).toEqual(DEFAULTS);
    expect(parseCustomsJobForm(JSON.stringify({ layout: 'x' }))).toEqual(DEFAULTS);
  });

  test("the reference's name - trimmed, blank goes back to S/R Page #", () => {
    expect(normalizeCustomsJobForm({ referenceLabel: '  File Job Number ' }).referenceLabel).toBe('File Job Number');
    expect(normalizeCustomsJobForm({ referenceLabel: '   ' }).referenceLabel).toBe('S/R Page #');
    expect(() => normalizeCustomsJobForm({ referenceLabel: 'x'.repeat(41) })).toThrow(CustomsJobFormError);
    expect(() => normalizeCustomsJobForm({ referenceLabel: 5 })).toThrow(CustomsJobFormError);
  });

  test('switches are true or false', () => {
    expect(normalizeCustomsJobForm({ commodities: false, freightForwarding: true })).toMatchObject({
      commodities: false, freightForwarding: true, addPorts: false,
    });
    expect(() => normalizeCustomsJobForm({ addPorts: 'yes' })).toThrow('addPorts must be true or false.');
  });

  test('every section ends up on exactly one tab', () => {
    const layout = normalizeLayout({
      tabs: [
        { key: 'a', title: 'Job Details', sections: ['jobDetails', 'route', 'nonsense', 'route'] },
        { key: 'b', title: 'More', sections: ['route', 'goods'] },
      ],
    });
    // route stays where it was named first; the unnamed go on the first tab.
    expect(layout.tabs[1].sections).toEqual(['goods']);
    const all = layout.tabs.flatMap((t) => t.sections);
    expect([...all].sort()).toEqual([...SECTIONS].sort());
    expect(layout.tabs[0].sections.slice(0, 2)).toEqual(['jobDetails', 'route']);
  });

  test('all on one tab - Essani\'s - is a layout', () => {
    const layout = normalizeLayout({ tabs: [{ title: 'Job Details', sections: [] }] });
    expect(layout.tabs).toHaveLength(1);
    expect(layout.tabs[0].sections).toEqual(SECTIONS);
    expect(layout.tabs[0].key).toBe('t1');
  });

  test('tab keys are kept unique, and "charges" is the charges tab\'s', () => {
    const layout = normalizeLayout({
      tabs: [{ key: 'x', title: 'One' }, { key: 'x', title: 'Two' }, { key: 'charges', title: 'Three' }],
    });
    expect(new Set(layout.tabs.map((t) => t.key)).size).toBe(3);
    expect(layout.tabs.map((t) => t.key)).not.toContain('charges');
    expect(() => normalizeLayout({ tabs: [{ title: 'Charges' }] })).toThrow(CustomsJobFormError);
  });

  test('a tab needs a name, and there is at least one', () => {
    expect(() => normalizeLayout({ tabs: [] })).toThrow('at least one tab');
    expect(() => normalizeLayout({ tabs: [{ title: ' ' }] })).toThrow('Tab 1 needs a name.');
    expect(() => normalizeLayout({ tabs: Array.from({ length: 13 }, (_, i) => ({ title: `T${i}` })) })).toThrow('At most 12 tabs.');
  });
});
