const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createScreenSnapshots } = require('./screen-snapshots');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steno-snapshots-'));
  const state = { isPaused: false };
  let pixel = 10;
  const thumbnail = { isEmpty: () => false, resize() { return this; }, toDataURL: () => 'data:image/jpeg;base64,AA==', toBitmap: () => Buffer.alloc(64 * 40 * 4, pixel), toJPEG: () => Buffer.from('jpeg') };
  let getSources = async () => [{ id: 'window:1:0', name: 'Slides', thumbnail }];
  const controller = createScreenSnapshots({ getUserDataDir: () => dir, getRecordingState: () => state, getElapsedSeconds: () => 12, getSources: args => getSources(args) });
  t.after(() => { controller.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { controller, dir, state, change: () => { pixel = 200; }, sources: fn => { getSources = fn; } };
}
test('captures selected window, deduplicates, timestamps, pause and deletion', async t => {
  const s = setup(t); await s.controller.select('window:1:0'); s.controller.start('/recording/meeting.webm');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.controller.status().count, 1);
  await s.controller.tick(); assert.equal(s.controller.status().count, 1);
  s.change(); s.state.isPaused = true; await s.controller.tick(); assert.equal(s.controller.status().count, 1);
  s.state.isPaused = false; await s.controller.tick(); assert.equal(s.controller.status().count, 2);
  const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'screen-snapshots/meeting/manifest.json')));
  assert.equal(saved.frames[1].seconds, 12);
  s.controller.stop(); assert.equal(s.controller.status().selected, null);
  s.controller.remove('meeting'); assert.equal(fs.existsSync(path.join(s.dir, 'screen-snapshots/meeting')), false);
});
test('stop discards an in-flight capture', async t => {
  const s = setup(t); await s.controller.select('window:1:0');
  let release; s.sources(() => new Promise(resolve => { release = resolve; }));
  s.controller.start('/recording/stopped.webm'); s.controller.stop(); release([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fs.existsSync(path.join(s.dir, 'screen-snapshots/stopped')), false);
});
test('never substitutes another window or screen after source disappears', async t => {
  const s = setup(t); await s.controller.select('window:1:0');
  s.sources(async () => [{ id: 'screen:1:0' }]); s.controller.start('/recording/missing.webm');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.controller.status().selected, null);
  assert.match(s.controller.status().error, /unavailable/);
});
test('pause invalidates a capture even if resumed before it resolves', async t => {
  const s = setup(t); await s.controller.select('window:1:0');
  let release; s.sources(() => new Promise(resolve => { release = resolve; }));
  s.controller.start('/recording/paused.webm'); s.controller.invalidate(); s.state.isPaused = true;
  s.state.isPaused = false; release([]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.controller.status().count, 0); assert.equal(s.controller.status().error, null);
});
test('continuing a note appends to the original manifest with an audio offset', async t => {
  const s = setup(t); await s.controller.select('window:1:0'); s.controller.start('/recording/original.webm');
  await new Promise(resolve => setImmediate(resolve)); s.controller.stop();
  const note = path.join(s.dir, 'original_summary.md'); fs.writeFileSync(note, '---\nduration_seconds: 90\n---\n');
  await s.controller.select('window:1:0'); s.controller.start('/recording/continuation.webm', note);
  await new Promise(resolve => setImmediate(resolve));
  const saved = JSON.parse(fs.readFileSync(path.join(s.dir, 'screen-snapshots/original/manifest.json')));
  assert.equal(saved.frames.length, 2); assert.equal(saved.frames[1].seconds, 102);
  assert.equal(fs.existsSync(path.join(s.dir, 'screen-snapshots/continuation')), false);
});
test('discard of an empty continuation preserves original snapshots', async t => {
  const s = setup(t); await s.controller.select('window:1:0'); s.controller.start('/recording/original.webm');
  await new Promise(resolve => setImmediate(resolve)); s.controller.stop();
  const note = path.join(s.dir, 'original_summary.md'); fs.writeFileSync(note, '---\nduration_seconds: 90\n---\n');
  await s.controller.select('window:1:0'); const capture = s.controller.start('/recording/empty.webm', note);
  await new Promise(resolve => setImmediate(resolve)); s.controller.stop(); s.controller.discard(capture);
  const dir = path.join(s.dir, 'screen-snapshots/original');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))).frames.length, 1);
  assert.equal(fs.existsSync(path.join(dir, '0001.jpg')), false);
  assert.equal(fs.existsSync(path.join(dir, '0000.jpg')), true);
});
