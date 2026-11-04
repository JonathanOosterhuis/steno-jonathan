const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSnapshotLibrary } = require('./snapshot-library');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steno-gallery-'));
  const dir = path.join(root, 'screen-snapshots', 'meeting'); fs.mkdirSync(dir, { recursive: true });
  const bytes = Buffer.from([255, 216, 1, 2, 255, 217]);
  fs.writeFileSync(path.join(dir, '0000.jpg'), bytes); fs.writeFileSync(path.join(dir, '0001.jpg'), bytes);
  const manifest = frames => fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ frames }));
  manifest([{ file: '0000.jpg', seconds: 12 }, { file: '0001.jpg', seconds: 75 }]);
  const dialog = { showSaveDialog: async () => ({ canceled: false, filePath: path.join(root, 'saved.jpg') }), showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) };
  const nativeImage = { createFromBuffer: () => ({ isEmpty: () => false, resize() { return this; }, toDataURL: () => 'data:image/jpeg;base64,preview' }) };
  const library = createSnapshotLibrary({ getUserDataDir: () => root, nativeImage, dialog, getWindow: () => null });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir, bytes, library, dialog, manifest };
}
test('gallery reads only manifest entries and exports exact originals individually and together', async t => {
  const s = setup(t); assert.equal((await s.library.list('meeting')).length, 2);
  assert.equal(s.library.view('meeting', '0000.jpg'), 'data:image/jpeg;base64,' + s.bytes.toString('base64'));
  assert.equal((await s.library.save('meeting', '0000.jpg')).count, 1);
  assert.deepEqual(fs.readFileSync(path.join(s.root, 'saved.jpg')), s.bytes);
  assert.equal((await s.library.save('meeting')).count, 2);
  const folder = fs.readdirSync(s.root).find(f => f.startsWith('Steno-snapshots-'));
  assert.deepEqual(fs.readdirSync(path.join(s.root, folder)), ['00-00-12-0000.jpg', '00-01-15-0001.jpg']);
  assert.deepEqual(fs.readFileSync(path.join(s.root, folder, '00-01-15-0001.jpg')), s.bytes);
});
test('canceling either dialog writes nothing; missing image rolls back the whole new export folder', async t => {
  const s = setup(t);
  s.dialog.showSaveDialog = async () => ({ canceled: true });
  assert.deepEqual(await s.library.save('meeting', '0000.jpg'), { canceled: true });
  s.dialog.showOpenDialog = async () => ({ canceled: true });
  assert.deepEqual(await s.library.save('meeting'), { canceled: true });
  assert.deepEqual(fs.readdirSync(s.root), ['screen-snapshots']);
  fs.unlinkSync(path.join(s.dir, '0001.jpg'));
  assert.equal((await s.library.list('meeting'))[1].available, false);
  s.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [s.root] });
  await assert.rejects(s.library.save('meeting'));
  assert.deepEqual(fs.readdirSync(s.root), ['screen-snapshots']);
});
test('rejects traversal, unlisted files, links and oversized manifests', async t => {
  const s = setup(t);
  await assert.rejects(s.library.list('../meeting'));
  assert.throws(() => s.library.view('meeting', '../0000.jpg'));
  assert.throws(() => s.library.view('meeting', '0002.jpg'));
  s.manifest([{ file: '../secret.jpg', seconds: 0 }]); await assert.rejects(s.library.list('meeting'));
  s.manifest([{ file: '0000.jpg', seconds: 0 }]);
  fs.unlinkSync(path.join(s.dir, '0000.jpg')); fs.symlinkSync(path.join(s.dir, '0001.jpg'), path.join(s.dir, '0000.jpg'));
  assert.throws(() => s.library.view('meeting', '0000.jpg'));
  fs.writeFileSync(path.join(s.dir, 'manifest.json'), ' '.repeat(65537)); await assert.rejects(s.library.list('meeting'));
  fs.rmSync(s.dir, { recursive: true }); fs.symlinkSync(s.root, s.dir); await assert.rejects(s.library.list('meeting'));
});
