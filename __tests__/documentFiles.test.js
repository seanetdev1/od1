import {
  DEFAULT_LIMITS, checkFile, extensionOf, fileKind, formatSize, reasonOf,
} from 'functions/documentFiles';

const file = (name, size) => ({ name, size });

test('10 MB, and the server\'s types, before the server has said', () => {
  expect(DEFAULT_LIMITS.maxBytes).toBe(10 * 1024 * 1024);
  expect(DEFAULT_LIMITS.extensions).toEqual(expect.arrayContaining(['.pdf', '.jpg', '.png', '.docx', '.xlsx', '.tif']));
});

test('a file is checked by its extension, size and emptiness', () => {
  expect(checkFile(file('GD.PDF', 1000))).toBeNull();
  expect(checkFile(file('GD.pdf', 10 * 1024 * 1024))).toBeNull();
  expect(checkFile(file('GD.pdf', 10 * 1024 * 1024 + 1))).toBe('GD.pdf is 10.0 MB - the limit is 10.0 MB.');
  expect(checkFile(file('GD.pdf', 0))).toBe('GD.pdf is empty.');
  expect(checkFile(file('logo.svg', 10))).toMatch(/^logo\.svg: \.svg files cannot be attached/);
  expect(checkFile(file('README', 10))).toMatch(/files without an extension cannot be attached/);
});

test('names, sizes and icons', () => {
  expect(extensionOf('a.b.JPEG')).toBe('.jpeg');
  expect(extensionOf('folder.d/file')).toBe('');
  expect(formatSize(512)).toBe('512 B');
  expect(formatSize(245760)).toBe('240 KB');
  expect(formatSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  expect(formatSize(250 * 1024 ** 3)).toBe('250.0 GB');
  expect(['x.pdf', 'x.tiff', 'x.doc', 'x.xlsx', 'x.zip'].map(fileKind)).toEqual(['pdf', 'image', 'word', 'excel', 'file']);
});

test('the server\'s reason, when it gave one', () => {
  expect(reasonOf({ response: { data: { result: 'Already attached.' } } }, 'x')).toBe('Already attached.');
  expect(reasonOf({ response: { status: 413, data: '' } }, 'x')).toBe('The file is over the size limit.');
  expect(reasonOf(new Error('Network Error'), 'Try again.')).toBe('Try again.');
});
