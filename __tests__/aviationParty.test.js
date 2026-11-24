import { carrierPartyId, carrierPartyFor, PARTY_RESOLVERS } from 'functions/aviationParty';

// Who an aviation charge falls to. The interesting case throughout is CARRIER:
// unlike the other three roles it is not a field on the consignment, it is
// read through the carrier the consignment names.

const CARRIERS = [
  { id: 1, name: '214 - PIA', prefix: '214', partyId: 55 },
  { id: 2, name: '618 - SriLankan', prefix: '618', partyId: null },
  // The shape /carriers returns - a nested party rather than a flat id.
  { id: 3, name: '176 - Emirates', prefix: '176', party: { id: 77, name: 'Emirates' } },
];

const PARTIES = [
  { id: 55, name: 'Pakistan International Airlines (1041)' },
  { id: 77, name: 'Emirates (1042)' },
  { id: 90, name: 'Some Shipper (1043)' },
];

describe('carrierPartyId', () => {
  test('resolves the party behind the line’s carrier', () => {
    expect(carrierPartyId({ AviationCarrierId: 1 }, CARRIERS)).toBe(55);
  });

  test('accepts the nested party shape /carriers returns', () => {
    expect(carrierPartyId({ AviationCarrierId: 3 }, CARRIERS)).toBe(77);
  });

  test('is null when the carrier has no party attached', () => {
    expect(carrierPartyId({ AviationCarrierId: 2 }, CARRIERS)).toBeNull();
  });

  test('is null when the line names no carrier', () => {
    expect(carrierPartyId({ AviationCarrierId: null }, CARRIERS)).toBeNull();
    expect(carrierPartyId({}, CARRIERS)).toBeNull();
  });

  test('is null when the carrier is not in the list', () => {
    expect(carrierPartyId({ AviationCarrierId: 999 }, CARRIERS)).toBeNull();
  });

  test('survives a missing line or carrier list', () => {
    expect(carrierPartyId(null, CARRIERS)).toBeNull();
    expect(carrierPartyId({ AviationCarrierId: 1 }, null)).toBeNull();
    expect(carrierPartyId({ AviationCarrierId: 1 }, undefined)).toBeNull();
  });
});

describe('PARTY_RESOLVERS', () => {
  const line = {
    shipperId: 10, consigneeId: 11, masterAgentId: 12, AviationCarrierId: 1,
  };

  test('the three consignment roles read their own field', () => {
    expect(PARTY_RESOLVERS['Shipper'](line)).toBe(10);
    expect(PARTY_RESOLVERS['Consignee'](line)).toBe(11);
    expect(PARTY_RESOLVERS['Master Agent'](line)).toBe(12);
  });

  test('Carrier reads through the carrier, not off the line', () => {
    expect(PARTY_RESOLVERS['Carrier'](line, CARRIERS)).toBe(55);
    // Proving the indirection: the SAME line resolves differently when the
    // carrier's party changes, with nothing on the consignment touched.
    const relinked = CARRIERS.map((c) => (c.id === 1 ? { ...c, partyId: 90 } : c));
    expect(PARTY_RESOLVERS['Carrier'](line, relinked)).toBe(90);
  });

  test('a freight party type has no resolver, so nothing auto-fills', () => {
    expect(PARTY_RESOLVERS['Shipping Line']).toBeUndefined();
    expect(PARTY_RESOLVERS['Custom Agent']).toBeUndefined();
  });

  test('an unset role on the line resolves to null, never undefined', () => {
    expect(PARTY_RESOLVERS['Shipper']({})).toBeNull();
    expect(PARTY_RESOLVERS['Consignee'](null)).toBeNull();
  });
});

describe('carrierPartyFor', () => {
  test('shapes the carrier’s party for a charge row', () => {
    expect(carrierPartyFor({ AviationCarrierId: 1 }, CARRIERS, PARTIES)).toEqual({
      partyId: 55,
      name: 'Pakistan International Airlines (1041)',
      partyType: 'Carrier',
    });
  });

  // THE ONE THAT MATTERS. values.party holds only billable parties - a non-GL
  // one is excluded because it has no ledger account. Defaulting a charge to a
  // party /makeInvoice will refuse just moves the failure to a worse moment.
  test('gives no default when the carrier’s party is not billable', () => {
    const unbillable = [{ id: 4, name: 'X', partyId: 12345 }];
    expect(carrierPartyFor({ AviationCarrierId: 4 }, unbillable, PARTIES)).toBeNull();
  });

  test('gives no default when the carrier has no party', () => {
    expect(carrierPartyFor({ AviationCarrierId: 2 }, CARRIERS, PARTIES)).toBeNull();
  });

  test('gives no default when the line has no carrier yet', () => {
    expect(carrierPartyFor({}, CARRIERS, PARTIES)).toBeNull();
  });

  test('survives a missing party list', () => {
    expect(carrierPartyFor({ AviationCarrierId: 1 }, CARRIERS, null)).toBeNull();
  });
});
