const crypto = require('crypto');
const systemAccess = require('../../functions/systemAccess');

// A throwaway key pair stands in for the licence server's: the real private
// key never exists outside Seanet, and these tests must not need it.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' });
const INSTALL = 'odyssey-unit-test';
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

// What Odyssey-License-Server/signer.js signSupportCredential produces.
function credential(overrides = {}, { key = privateKey, domain = systemAccess.SUPPORT_DOMAIN } = {}) {
  const json = JSON.stringify({
    typ: 'support', install_id: INSTALL, name: 'Bilal', iat: NOW - 60000, exp: NOW + 4 * HOUR, ...overrides,
  });
  const sig = crypto.sign(null, Buffer.from(domain + json, 'utf8'), key);
  return `${systemAccess.PREFIX}${Buffer.from(json).toString('base64url')}.${sig.toString('base64url')}`;
}

const verify = (c) => systemAccess.verifySupportCredential(c, { now: NOW });

beforeEach(() => {
  systemAccess._setConfigForTest({ LICENSE_PUBLIC_KEY: PUBLIC_PEM, INSTALL_ID: INSTALL, LICENSE_EXEMPT: false });
});
afterAll(() => systemAccess._setConfigForTest(null));

describe('verifySupportCredential', () => {
  it('accepts a credential signed by the licence key for this install', () => {
    const result = verify(credential());
    expect(result.ok).toBe(true);
    expect(result.payload.name).toBe('Bilal');
  });

  it('rejects one signed by any other key', () => {
    const other = crypto.generateKeyPairSync('ed25519').privateKey;
    expect(verify(credential({}, { key: other }))).toEqual({ ok: false, reason: 'signature does not verify' });
  });

  it('rejects one whose payload was edited after signing', () => {
    const [head, body, sig] = [systemAccess.PREFIX, ...credential().slice(systemAccess.PREFIX.length).split('.')];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    payload.exp += 30 * 24 * HOUR;
    const forged = `${head}${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    expect(verify(forged).ok).toBe(false);
  });

  // Licences are signed by the same key over their bare JSON. The domain
  // prefix is what keeps a licence blob from passing as a credential.
  it('rejects a blob signed without the support domain prefix', () => {
    expect(verify(credential({}, { domain: '' })).ok).toBe(false);
  });

  it('rejects one issued for another install', () => {
    const result = verify(credential({ install_id: 'odyssey-IFA' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/odyssey-IFA/);
  });

  it('rejects an expired credential', () => {
    expect(verify(credential({ iat: NOW - 5 * HOUR, exp: NOW - 1 }))).toEqual({ ok: false, reason: 'credential has expired' });
  });

  it('rejects a lifetime over 24 hours, whatever the signer asked for', () => {
    expect(verify(credential({ iat: NOW - HOUR, exp: NOW + 30 * 24 * HOUR })).ok).toBe(false);
  });

  it('rejects one issued in the future', () => {
    expect(verify(credential({ iat: NOW + 2 * HOUR, exp: NOW + 6 * HOUR })).ok).toBe(false);
  });

  it('rejects anything that is not a support credential', () => {
    expect(verify('').ok).toBe(false);
    expect(verify('password123').ok).toBe(false);
    expect(verify(`${systemAccess.PREFIX}garbage`).ok).toBe(false);
    expect(verify(credential({ typ: 'licence' })).ok).toBe(false);
  });
});

describe('isSystem', () => {
  const req = (user) => ({ user });

  it('is never true for a client admin on a leased install', () => {
    expect(systemAccess.isSystem(req({ designation: 'admin' }))).toBe(false);
  });

  it('is false for a session that only CLAIMS to be system', () => {
    expect(systemAccess.isSystem(req({ designation: 'admin', system: true, supportCredential: null }))).toBe(false);
    expect(systemAccess.isSystem(req({ designation: 'admin', system: true, supportCredential: 'ods1.x.y' }))).toBe(false);
  });

  it('is true for a session carrying a valid credential', () => {
    const c = credential({ iat: Date.now() - 60000, exp: Date.now() + HOUR });
    expect(systemAccess.isSystem(req({ designation: 'admin', system: true, supportCredential: c }))).toBe(true);
  });

  it('is true for the admin of an exempt install, and only the admin', () => {
    systemAccess._setConfigForTest({ LICENSE_PUBLIC_KEY: PUBLIC_PEM, INSTALL_ID: INSTALL, LICENSE_EXEMPT: true });
    expect(systemAccess.isSystem(req({ designation: 'admin' }))).toBe(true);
    expect(systemAccess.isSystem(req({ designation: 'CEO' }))).toBe(false);
  });

  it('is false with no user', () => {
    expect(systemAccess.isSystem({})).toBe(false);
  });
});
