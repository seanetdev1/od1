/**
 * A party as a picker lists it: its party code, then its name -
 * "(13050) Z.K INDUSTRIES". The code is the Climax PartyCode staff know a
 * party by (Clients.code), and with thousands of parties - several of them
 * sharing a name - it is what tells them apart and what people type to find
 * one. A party with no code is listed by name alone.
 */
export const partyLabel = (party = {}) => {
  const code = String(party.code ?? '').trim();
  const name = String(party.name ?? '').trim();
  return code ? `(${code}) ${name}` : name;
};

export default partyLabel;
