/**
 * /health says which RELEASE is running - the tag CI stamps into the image as
 * ODYSSEY_APP_VERSION - not package.json's version, which is never bumped and
 * showed every install's header "v1.0.0" (2026-11-15).
 */
process.env.ODYSSEY_APP_VERSION = '9.9.99-test';
const request = require('supertest');
const app = require('../../index');
const { appVersion } = require('../../functions/appVersion');

describe('/health', () => {
  afterAll(() => { delete process.env.ODYSSEY_APP_VERSION; });

  it('reports the release the image was built from', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('9.9.99-test');
  });
});

describe('appVersion', () => {
  const stamped = process.env.ODYSSEY_APP_VERSION;
  afterEach(() => { process.env.ODYSSEY_APP_VERSION = stamped; });

  it('is the stamp, trimmed', () => {
    process.env.ODYSSEY_APP_VERSION = ' 1.2.100 ';
    expect(appVersion()).toBe('1.2.100');
  });

  it("is 'dev' with no stamp - never package.json's 1.0.0", () => {
    delete process.env.ODYSSEY_APP_VERSION;
    expect(appVersion()).toBe('dev');
    process.env.ODYSSEY_APP_VERSION = '  ';
    expect(appVersion()).toBe('dev');
  });
});
