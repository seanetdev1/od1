import Cookies from 'js-cookie';

// Installation-wide wording, per operation mode. 'freight' is the default
// (shipping & air freight); 'customs' relabels the app for a customs-clearance
// installation; 'aviation' is an airline running its own aircraft. To rebrand
// more of the app, add keys here and use term('key') wherever that label is
// rendered.
const TERMS = {
  freight: {
    seaJobs: 'Sea Jobs',
    airJobs: 'Air Jobs',
    modeName: 'Shipping & Air Freight',
  },
  customs: {
    // No seaJobs/airJobs keys on purpose. They used to relabel the freight
    // sections 'Sea Clearance' / 'Air Clearance', from when customs mode was
    // wording alone. It has its own module now, and Customs Job replaces both
    // of those sections rather than renaming them - so a clearing agent has
    // one place to work rather than three, two of which were freight screens
    // wearing a customs label. See functions/setAccesLevels.js.
    modeName: 'Customs Clearance',
  },
  aviation: {
    // No seaJobs key on purpose: an aviation installation doesn't rename the
    // sea side, it doesn't have one. See hasSeaOperations() below.
    airJobs: 'Air Jobs',
    modeName: 'Aviation',
  },
};

const DEFAULT_MODE = 'freight';

// Which modes actually run a sea operation. An airline has aircraft, not
// ships, so in 'aviation' the sea sections are not shown at all - callers ask
// this before building them (see functions/setAccesLevels.js).
const SEA_OPERATIONS = {
  freight: true,
  customs: true,
  aviation: false,
};

// The mode is fetched once after login and cached in a cookie so synchronous
// render code (e.g. functions/setAccesLevels.js) can read it without awaiting.
// The only party types an aviation installation offers on Setup > Parties.
//
// An airline's consignment has a shipper, a consignee and a master agent. The
// two dozen freight-forwarding roles the full list carries (shipping lines,
// depots, stevedores, cartage, drayage...) are roles it never fills, and a
// type nobody picks is just noise on the form.
//
// "Master Agent" is aviation-only and deliberately absent from the freight
// list - nothing in the freight screens consumes it.
// "Carrier" is the airline itself. It is here because the payable side of an
// AWB is almost always paid TO the airline - it sold the space - so a charge
// needs to be able to default to it. Unlike the other three it is not a field
// on the consignment: the consignment names a carrier, and the carrier names
// its party (Setup > Carriers). See PARTY_RESOLVERS in AviationJobs/Charges.
export const AVIATION_PARTY_TYPES = [
  { label: 'Shipper', value: 'Shipper' },
  { label: 'Consignee', value: 'Consignee' },
  { label: 'Master Agent', value: 'Master Agent' },
  { label: 'Carrier', value: 'Carrier' },
];

// The same three, shaped for SelectComp ({id,name}) rather than
// CheckGroupComp ({label,value}). Used for a charge's default payable and
// receivable party type in Setup > Charges: an aviation charge can only fall
// to one of the three parties an AWB actually names, so offering the freight
// roles (shipping line, custom agent, forwarding agent...) would let someone
// default a charge to a party that can never be on the consignment.
export const AVIATION_PARTY_TYPE_OPTIONS = AVIATION_PARTY_TYPES.map(
  (t) => ({ id: t.value, name: t.label })
);

/**
 * The operation types a report can filter by, for THIS installation.
 *
 * These were hardcoded as the four freight operations in three separate report
 * filters. An aviation invoice carries operation 'AV', so it vanished the
 * moment anyone ticked a type - which reads as "aviation invoices are missing"
 * rather than "they are filtered out".
 *
 * In aviation mode the sea operations are dropped for the same reason the
 * sidebar drops Sea Jobs: an airline has none, and offering a filter that can
 * only ever return nothing is noise.
 */
const FREIGHT_JOB_TYPES = [
  { label: 'Sea Export', value: 'SE' },
  { label: 'Sea Import', value: 'SI' },
  { label: 'Air Export', value: 'AE' },
  { label: 'Air Import', value: 'AI' },
];

export function jobTypeOptions() {
  if (isAviationMode()) {
    return [
      ...FREIGHT_JOB_TYPES.filter((t) => t.value === 'AE' || t.value === 'AI'),
      { label: 'Aviation', value: 'AV' },
    ];
  }
  // In customs mode the four freight types are KEPT and clearance is ADDED,
  // unlike aviation where the sea ones are dropped. A clearing agent's
  // installation still runs freight jobs - the sidebar keeps those sections -
  // so a filter that offered only 'CC' would hide invoices that exist. A
  // customs invoice carries operation 'CC'; without this entry it vanished the
  // moment anyone ticked a type, which reads as missing data rather than as a
  // filter doing its job.
  if (isCustomsMode()) {
    return [...FREIGHT_JOB_TYPES, { label: 'Customs Clearance', value: 'CC' }];
  }
  // A COPY, not the constant itself. The other two branches already build a
  // new array, so a caller that appends to what it is given would corrupt the
  // list for every screen in freight mode and in no other - the kind of bug
  // that only shows up on one installation.
  return [...FREIGHT_JOB_TYPES];
}

export function getMode() {
  const m = Cookies.get('operationMode');
  return Object.prototype.hasOwnProperty.call(TERMS, m) ? m : DEFAULT_MODE;
}

// Look up a label for the current mode, falling back to the freight wording
// and finally the key itself.
export function term(key) {
  const mode = getMode();
  return (TERMS[mode] && TERMS[mode][key]) || TERMS[DEFAULT_MODE][key] || key;
}

export function isCustomsMode() {
  return getMode() === 'customs';
}

export function isAviationMode() {
  return getMode() === 'aviation';
}

export function hasSeaOperations() {
  return SEA_OPERATIONS[getMode()] !== false;
}
