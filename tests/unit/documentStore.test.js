/**
 * The attached documents' disk store (functions/documents/store.js): what it
 * takes, what it refuses, where it puts things, and the marker that keeps it
 * off an unmounted drive.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const store = require('../../functions/documents/store');

const PDF = (extra = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n${extra}\ntrailer<<>>\n%%EOF\n`);
const from = (buf) => Readable.from([buf]);
// A stream that sends `total` bytes in 1 MB pieces, with no length said up front.
const flood = (head, total) => Readable.from((function* () {
  yield head;
  for (let sent = head.length; sent < total; sent += 1024 * 1024) yield Buffer.alloc(Math.min(1024 * 1024, total - sent), 0x20);
}()));

let dir;
const files = (d = dir) => fs.readdirSync(d, { recursive: true }).filter((f) => fs.statSync(path.join(d, f)).isFile());
const take = (bytes, name, more = {}) => store.receive(from(bytes), { dir, name, ...more });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odyssey-docs-'));
  process.env.ODYSSEY_DOCUMENTS_MIN_FREE_MB = '0';
  jest.spyOn(console, 'error').mockImplementation(() => {}); // the refusals log for the server's owner
});
afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ODYSSEY_DOCUMENTS_MIN_FREE_MB;
});

describe('taking a file', () => {
  test('a PDF goes in a month folder under a name of its own, with its size and hash', async () => {
    const bytes = PDF('a');
    const saved = await take(bytes, 'GD scan.pdf', { declaredLength: bytes.length });
    expect(saved.storedName).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(saved).toMatchObject({ originalName: 'GD scan.pdf', mimeType: 'application/pdf', view: 'pdf', size: bytes.length });
    expect(saved.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    // Only the part inside the folder is the document's name: the folder can move.
    expect(fs.readFileSync(path.join(dir, saved.storedName))).toEqual(bytes);
    expect(files().filter((f) => f.includes('.incoming'))).toEqual([]);
  });

  test('images are shown, Word, Excel and TIFF are downloaded', async () => {
    const cases = [
      ['photo.JPG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]), 'image'],
      ['page.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), 'image'],
      ['shot.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]), 'image'],
      ['scan.tif', Buffer.from('II*\0rest'), 'download'],
      ['letter.docx', Buffer.from('PK\x03\x04rest', 'latin1'), 'download'],
      ['sheet.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1]), 'download'],
    ];
    for (const [name, bytes, view] of cases) {
      const saved = await take(bytes, name);
      expect([name, saved.view]).toEqual([name, view]);
      expect(store.viewOf(name)).toBe(view);
    }
  });

  test('a page renamed to look like a picture is refused, and nothing is left behind', async () => {
    await expect(take(Buffer.from('<html><script>alert(1)</script></html>'), 'scan.jpg'))
      .rejects.toMatchObject({ status: 415, message: expect.stringMatching(/not a real JPG/) });
    expect(files()).toEqual([]);
  });

  test.each(['setup.exe', 'logo.svg', 'notes.html', 'README'])('%s is not a document type', async (name) => {
    await expect(take(Buffer.from('x'), name)).rejects.toMatchObject({ status: 415 });
    expect(files()).toEqual([]);
  });

  test('over 10 MB is refused - said up front, or found out on the way', async () => {
    expect(store.MAX_BYTES).toBe(10 * 1024 * 1024);
    await expect(take(PDF(), 'big.pdf', { declaredLength: store.MAX_BYTES + 1 })).rejects.toMatchObject({ status: 413 });
    await expect(store.receive(flood(PDF(), store.MAX_BYTES + 1), { dir, name: 'big.pdf' }))
      .rejects.toMatchObject({ status: 413, message: expect.stringMatching(/over the 10\.0 MB limit/) });
    expect(files()).toEqual([]);
    // Exactly the limit is fine.
    const saved = await store.receive(flood(PDF(), store.MAX_BYTES), { dir, name: 'just.pdf' });
    expect(saved.size).toBe(store.MAX_BYTES);
  });

  test('an empty file is refused', async () => {
    await expect(take(Buffer.alloc(0), 'empty.pdf')).rejects.toMatchObject({ status: 400 });
  });

  test('a nearly full drive refuses it rather than fill up', async () => {
    process.env.ODYSSEY_DOCUMENTS_MIN_FREE_MB = String(1024 * 1024 * 1024); // a petabyte free, please
    await expect(take(PDF(), 'a.pdf')).rejects.toMatchObject({ status: 507 });
  });
});

describe('names', () => {
  test('the shown name loses folders, quotes and control characters', () => {
    expect(store.displayName('C:\\Users\\me\\..\\GD "final".pdf')).toBe('GD final.pdf');
    expect(store.displayName('../../etc/passwd')).toBe('passwd');
    expect(store.displayName('a\r\nb.pdf')).toBe('ab.pdf');
  });

  test('a long one is cut from the middle, keeping its extension', () => {
    const name = store.displayName(`${'x'.repeat(300)}.pdf`);
    expect(name).toHaveLength(200);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  test('only a name the store made reaches the disk, and only inside the folder', () => {
    expect(store.resolve('2026/11/0b6f6d0e-1f0c-4c44-9a55-0d4f6a1b2c3d.pdf', dir))
      .toBe(path.join(dir, '2026', '11', '0b6f6d0e-1f0c-4c44-9a55-0d4f6a1b2c3d.pdf'));
    for (const bad of ['../x.pdf', '2026/11/../../x.pdf', '/etc/passwd', '.odyssey-documents', '', null]) {
      expect(() => store.resolve(bad, dir)).toThrow(store.DocumentError);
    }
    expect(() => store.resolve('2026/11/0b6f6d0e-1f0c-4c44-9a55-0d4f6a1b2c3d.pdf', null)).toThrow(store.DocumentError);
  });
});

describe("a document's own name", () => {
  test('tidied: one space between words, no control characters, 200 at most', () => {
    expect(store.cleanTitle('  Invoice   JI-123/27\r\n ')).toBe('Invoice JI-123/27');
    expect(store.cleanTitle(null)).toBe('');
    expect(store.cleanTitle('x'.repeat(300))).toHaveLength(200);
  });

  test("it downloads as that name, made a file name, with the file's own extension", () => {
    expect(store.downloadName('Invoice JI-123/27', 'scan020.pdf')).toBe('Invoice JI-123-27.pdf');
    expect(store.downloadName('B/L: "HBL 77"?', 'scan.JPG')).toBe('B-L- -HBL 77--.JPG');
    expect(store.downloadName('Already named.pdf', 'scan020.pdf')).toBe('Already named.pdf');
    expect(store.downloadName('Ends with dots...', 'a.xlsx')).toBe('Ends with dots.xlsx');
    expect(store.downloadName(null, 'scan020.pdf')).toBe('scan020.pdf');
    expect(store.downloadName('///', 'scan020.pdf')).toBe('---.pdf');
  });
});

describe('the folder - chosen, there, and the right one', () => {
  test('none chosen: nothing can be attached', async () => {
    await expect(store.ready(null)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/Configuration > Documents/) });
  });

  test('chosen, it is made, proved writable and marked', async () => {
    const chosen = path.join(dir, 'docs', 'here');
    await store.prepare(chosen);
    expect(fs.existsSync(path.join(chosen, store.MARKER))).toBe(true);
    expect(fs.readdirSync(chosen)).toEqual([store.MARKER]); // the write test cleaned up
    await expect(store.ready(chosen)).resolves.toBeUndefined();
    await store.prepare(chosen); // again: the marker stays as it was
  });

  test('another install\'s folder is not this one\'s to choose', async () => {
    const shared = path.join(dir, 'shared');
    process.env.INSTALL_ID = 'odyssey-HO-ENT';
    try {
      await store.prepare(shared);
      process.env.INSTALL_ID = 'odyssey-ESSANI';
      await expect(store.prepare(shared)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/another install \(odyssey-HO-ENT\)/) });
      process.env.INSTALL_ID = 'odyssey-HO-ENT';
      await expect(store.prepare(shared)).resolves.toBeUndefined();
    } finally {
      delete process.env.INSTALL_ID;
    }
  });

  test('not there - a drive not mounted - takes nothing', async () => {
    await expect(store.ready(path.join(dir, 'gone'))).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/not there/) });
  });

  test('there but unmarked - an empty folder in the drive\'s place - takes nothing', async () => {
    await expect(store.ready(dir)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/not the one that was set up/) });
    expect(fs.existsSync(path.join(dir, store.MARKER))).toBe(false);
  });

  test('how much room its drive has', async () => {
    const room = await store.space(dir);
    expect(room.total).toBeGreaterThan(0);
    expect(room.free).toBeGreaterThan(0);
  });
});
