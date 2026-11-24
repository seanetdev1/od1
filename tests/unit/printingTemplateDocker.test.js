const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

/* SOFFICE_DOCKER_IMAGE - a printing template's PDF made by LibreOffice in
 * Docker, on a PC without it installed (functions/printingTemplate). The
 * conversion itself is LibreOffice's; this pins the command it is given and
 * that its PDFs are read back in order. */
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({ execFile: (...a) => mockExecFile(...a) }));
const { toPdf, toOnePdf, ConversionUnavailable } = require('../../functions/printingTemplate');

let before;
beforeEach(() => {
  before = process.env.SOFFICE_DOCKER_IMAGE;
  process.env.SOFFICE_DOCKER_IMAGE = 'odyssey-libreoffice';
  mockExecFile.mockReset();
});
afterEach(() => {
  if (before === undefined) delete process.env.SOFFICE_DOCKER_IMAGE; else process.env.SOFFICE_DOCKER_IMAGE = before;
});

// Docker's LibreOffice, as far as the files go: a PDF beside each document.
const converts = () => mockExecFile.mockImplementation((file, args, opts, done) => {
  const dir = args[args.indexOf('-v') + 1].replace(/:\/work$/, '');
  args.filter((a) => a.startsWith('/work/invoice-')).forEach((a) => {
    const name = path.basename(a, '.docx');
    fs.writeFileSync(path.join(dir, `${name}.pdf`), `%PDF ${name}`);
  });
  done(null, '', '');
});

test('runs LibreOffice in the image, on the documents in a folder it is given', async () => {
  converts();
  expect(String(await toPdf(Buffer.from('docx')))).toBe('%PDF invoice-1');
  const [file, args] = mockExecFile.mock.calls[0];
  expect(file).toBe('docker');
  expect(args.slice(0, 2)).toEqual(['run', '--rm']);
  expect(args[args.indexOf('-v') + 1]).toMatch(/odyssey-invoice-.*:\/work$/);
  expect(args).toEqual(expect.arrayContaining(['odyssey-libreoffice', 'soffice', '--headless', '--convert-to', 'pdf', '--outdir', '/work', '/work/invoice-1.docx']));
});

test('a bulk print\'s documents in one run, read back in their order', async () => {
  // A one-page PDF per document, invoice-N one 600+N points wide.
  mockExecFile.mockImplementation((file, args, opts, done) => {
    const dir = args[args.indexOf('-v') + 1].replace(/:\/work$/, '');
    Promise.all(args.filter((a) => a.startsWith('/work/invoice-')).map(async (a) => {
      const name = path.basename(a, '.docx');
      const doc = await PDFDocument.create();
      doc.addPage([600 + Number(name.split('-')[1]), 842]);
      fs.writeFileSync(path.join(dir, `${name}.pdf`), await doc.save());
    })).then(() => done(null, '', ''));
  });
  const merged = await PDFDocument.load(await toOnePdf([Buffer.from('a'), Buffer.from('b'), Buffer.from('c')]));
  expect(mockExecFile).toHaveBeenCalledTimes(1);
  expect(merged.getPages().map((p) => Math.round(p.getWidth()))).toEqual([601, 602, 603]);
});

test('Docker not running: says to start it', async () => {
  mockExecFile.mockImplementation((file, args, opts, done) => done(Object.assign(new Error('exit 1'), { code: 1 }), '', 'error during connect: the docker daemon is not running'));
  await expect(toPdf(Buffer.from('docx'))).rejects.toThrow(ConversionUnavailable);
  await expect(toPdf(Buffer.from('docx'))).rejects.toThrow(/start Docker Desktop/);
});

test('no Docker at all: says so', async () => {
  mockExecFile.mockImplementation((file, args, opts, done) => done(Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' })));
  await expect(toPdf(Buffer.from('docx'))).rejects.toThrow(/Docker is not installed/);
});
