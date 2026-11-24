/**
 * The install's outgoing mail settings - functions/emailConfig.
 *
 * Two failures are worth guarding against here, and neither is cosmetic. The
 * first is an install losing its mail because somebody opened the settings
 * page and saved a half-filled form over a working .env. The second is a
 * stored password being wiped by an admin who only meant to change the port,
 * or handed back to the browser of everyone who opens the page.
 */

// Read through the AppSetting model, mocked so this needs no database - the
// reason the settings live in their own module rather than in the routes.
// Named `mockFindOne` because jest.mock's factory is hoisted above everything
// else and may only reach variables whose name says they are mocks.
const mockFindOne = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../models', () => ({
  AppSetting: {
    findOne: (...a) => mockFindOne(...a),
    create: (...a) => mockCreate(...a),
  },
}));

const {
  readEmailConfig, describeEmailConfig, writeEmailConfig, resetEmailConfig,
  isComplete, fromEnv,
} = require('../../functions/emailConfig');

const ENV = { ...process.env };

const savedRow = (o) => ({ value: JSON.stringify(o), update: jest.fn() });

const FULL = {
  host: 'mail.example.com', port: 465, secure: true,
  user: 'billing@example.com', pass: 's3cret',
  fromName: 'Example Co', fromEmail: 'billing@example.com',
};

beforeEach(() => {
  mockFindOne.mockReset();
  mockCreate.mockReset();
  resetEmailConfig();
  process.env = { ...ENV };
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

afterAll(() => { process.env = ENV; });

describe('which settings win', () => {
  test('saved settings are used when they are complete', async () => {
    mockFindOne.mockResolvedValue(savedRow(FULL));
    const cfg = await readEmailConfig();
    expect(cfg.host).toBe('mail.example.com');
    expect(cfg.source).toBe('settings');
  });

  test('an unconfigured install still sends through the environment', async () => {
    // Every install running today is configured this way. The release that
    // introduced the settings page must not change how any of them behave.
    process.env.SMTP_HOST = 'smtp.office365.com';
    process.env.SMTP_USER = 'ops@seanet.example';
    process.env.SMTP_PASS = 'env-secret';
    mockFindOne.mockResolvedValue(null);

    const cfg = await readEmailConfig();
    expect(cfg.host).toBe('smtp.office365.com');
    expect(cfg.pass).toBe('env-secret');
    expect(cfg.source).toBe('environment');
  });

  test('a HALF-FILLED form does not take the install off the air', async () => {
    // The failure this rule exists for: somebody opens the page, types a host,
    // saves, and every invoice email stops going out because a partial row now
    // outranks a working environment.
    process.env.SMTP_HOST = 'smtp.office365.com';
    process.env.SMTP_USER = 'ops@seanet.example';
    process.env.SMTP_PASS = 'env-secret';
    mockFindOne.mockResolvedValue(savedRow({ host: 'mail.example.com', user: '', pass: '' }));

    const cfg = await readEmailConfig();
    expect(cfg.source).toBe('environment');
    expect(cfg.host).toBe('smtp.office365.com');
  });

  test('a database blip falls back rather than failing, and is not cached', async () => {
    process.env.SMTP_HOST = 'smtp.office365.com';
    process.env.SMTP_USER = 'ops@seanet.example';
    process.env.SMTP_PASS = 'env-secret';
    mockFindOne.mockRejectedValueOnce(new Error('connection terminated'));

    expect((await readEmailConfig()).source).toBe('environment');

    // The next read must try the database again - a blip should not pin the
    // fallback in memory for the life of the process.
    mockFindOne.mockResolvedValue(savedRow(FULL));
    expect((await readEmailConfig()).source).toBe('settings');
  });

  test('nothing anywhere is reported as nothing, not as a broken config', async () => {
    mockFindOne.mockResolvedValue(null);
    const described = await describeEmailConfig();
    expect(described.active).toBe('none');
    expect(described.envConfigured).toBe(false);
  });
});

describe('what the settings screen may see', () => {
  test('never the password - only whether one is stored', async () => {
    // A field that round-trips the secret to every admin who opens the page
    // has a much larger audience than the person who typed it.
    mockFindOne.mockResolvedValue(savedRow(FULL));
    const described = await describeEmailConfig();
    expect(described.hasPassword).toBe(true);
    expect(described).not.toHaveProperty('pass');
    expect(JSON.stringify(described)).not.toContain('s3cret');
  });

  test('says which source is actually sending', async () => {
    // "Saved, but the environment is what is really being used" is a state an
    // admin has to be told about rather than left to deduce.
    process.env.SMTP_HOST = 'smtp.office365.com';
    process.env.SMTP_USER = 'ops@seanet.example';
    process.env.SMTP_PASS = 'env-secret';
    mockFindOne.mockResolvedValue(savedRow({ host: 'mail.example.com', user: 'x', pass: '' }));

    const described = await describeEmailConfig();
    expect(described.active).toBe('environment');
    expect(described.envConfigured).toBe(true);
    expect(described.host).toBe('mail.example.com');  // what was typed is still shown
  });
});

describe('saving', () => {
  test('a blank password leaves the stored one alone', async () => {
    // The screen never receives the password, so it cannot send it back.
    // Without this rule, changing the port would silently wipe it.
    const row = savedRow(FULL);
    mockFindOne.mockResolvedValue(row);

    await writeEmailConfig({ ...FULL, pass: '', port: 587 });

    const written = JSON.parse(row.update.mock.calls[0][0].value);
    expect(written.pass).toBe('s3cret');
    expect(written.port).toBe(587);
  });

  test('a supplied password replaces it', async () => {
    const row = savedRow(FULL);
    mockFindOne.mockResolvedValue(row);
    await writeEmailConfig({ ...FULL, pass: 'new-secret' });
    expect(JSON.parse(row.update.mock.calls[0][0].value).pass).toBe('new-secret');
  });

  test('the first save creates the row', async () => {
    mockFindOne.mockResolvedValue(null);
    await writeEmailConfig(FULL);
    expect(mockCreate).toHaveBeenCalled();
    expect(JSON.parse(mockCreate.mock.calls[0][0].value).host).toBe('mail.example.com');
  });

  test('publishes the change instead of waiting for a restart', async () => {
    // Every email read this; a save that only takes effect on the next deploy
    // is a setting nobody trusts.
    mockFindOne.mockResolvedValue(savedRow(FULL));
    expect((await readEmailConfig()).host).toBe('mail.example.com');

    const row = savedRow({ ...FULL, host: 'mail2.example.com' });
    mockFindOne.mockResolvedValue(row);
    await writeEmailConfig({ ...FULL, host: 'mail2.example.com', pass: '' });

    expect((await readEmailConfig()).host).toBe('mail2.example.com');
  });
});

describe('what counts as usable', () => {
  test('host, user and password - the same three the mailer always needed', () => {
    expect(isComplete({ host: 'h', user: 'u', pass: 'p' })).toBe(true);
    expect(isComplete({ host: 'h', user: 'u', pass: '' })).toBe(false);
    expect(isComplete({ host: '', user: 'u', pass: 'p' })).toBe(false);
    expect(isComplete(null)).toBe(false);
  });

  test('the environment defaults to port 587 and explicit TLS off', () => {
    process.env.SMTP_HOST = 'h';
    const env = fromEnv();
    expect(env.port).toBe(587);
    expect(env.secure).toBe(false);
  });
});
