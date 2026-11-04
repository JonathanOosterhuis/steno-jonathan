'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { cropSharedContent } = require('./teams-share');

// Auto mode accepts only an affirmative Teams share and crops to its content region.
function createScreenSnapshots({ getUserDataDir, getSources, getRecordingState, getElapsedSeconds, detectTeamsShare = null }) {
  let selected = null;
  let session = null;
  let generation = 0;
  let busy = false;
  let timer = null;
  let error = null;
  let detection = 'idle';
  const settingsPath = () => path.join(getUserDataDir(), 'screen-snapshot-settings.json');
  let automatic = false;
  try { automatic = !!detectTeamsShare && JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).automaticTeams === true; } catch (_) { /* opt in */ }
  function setAutomatic(enabled) {
    if (typeof enabled !== 'boolean' || !detectTeamsShare) throw new Error('Automatic Teams snapshots are unavailable.');
    fs.mkdirSync(getUserDataDir(), { recursive: true });
    fs.writeFileSync(settingsPath() + '.tmp', JSON.stringify({ automaticTeams: enabled }), { mode: 0o600 });
    fs.renameSync(settingsPath() + '.tmp', settingsPath());
    invalidate(); automatic = enabled; selected = null; error = null; detection = 'idle';
    if (session) session.previous = null;
    void tick();
    return status();
  }
  const root = () => path.join(getUserDataDir(), 'screen-snapshots');
  const status = () => ({ selected: selected?.name || null, count: session?.frames.length || 0,
    active: !!session && !!selected && !getRecordingState().isPaused, error, automatic, supported: !!detectTeamsShare, detection });
  const invalidate = () => { generation += 1; };
  const stop = () => { invalidate(); clearInterval(timer); timer = null; selected = null; session = null; error = null; detection = 'idle'; };
  async function sources() {
    const items = await getSources({ types: ['window'], thumbnailSize: { width: 1600, height: 1000 } });
    return items.filter(s => s.id.startsWith('window:'));
  }
  async function list() {
    const items = await sources();
    return items.filter(s => !s.thumbnail.isEmpty()).map(s => ({ id: s.id, name: s.name,
      preview: s.thumbnail.resize({ width: 320 }).toDataURL() }));
  }
  async function select(id) {
    if (automatic) setAutomatic(false);
    if (id === null) { invalidate(); selected = null; error = null; return status(); }
    const token = generation;
    const items = await sources();
    if (generation !== token) throw new Error('Recording changed. Choose the window again.');
    const item = items.find(s => s.id === id && !s.thumbnail.isEmpty());
    if (!item) throw new Error('Window unavailable. Check Screen Recording permission and choose again.');
    invalidate(); selected = { id: item.id, name: item.name }; error = null;
    if (session) session.previous = null;
    void tick();
    return status();
  }
  function start(audioPath, continuationPath = null) {
    invalidate(); clearInterval(timer);
    let stem = path.basename(audioPath, path.extname(audioPath));
    let offset = 0, frames = [];
    if (continuationPath) {
      try {
        stem = path.basename(continuationPath).replace(/_summary\.(md|json)$/, '');
        const content = fs.readFileSync(continuationPath, 'utf8');
        offset = continuationPath.endsWith('.json')
          ? Number(JSON.parse(content).session_info?.duration_seconds || 0)
          : Number(content.match(/^duration_seconds:\s*(\d+)/m)?.[1] || 0);
        if (!Number.isFinite(offset) || offset < 0) throw new Error('Invalid duration');
        const manifest = path.join(root(), stem, 'manifest.json');
        if (fs.existsSync(manifest)) frames = JSON.parse(fs.readFileSync(manifest, 'utf8')).frames;
        if (!Array.isArray(frames) || frames.length > 120) throw new Error('Invalid frames');
      } catch (_) { session = null; selected = null; error = 'Screen snapshots unavailable for this continuation.'; return; }
    }
    session = { stem, frames, offset, initialCount: frames.length, previous: null };
    error = null;
    timer = setInterval(() => { void tick(); }, 10000);
    timer.unref?.();
    void tick();
    return session;
  }
  async function tick() {
    if (busy || !session || (!selected && !automatic) || getRecordingState().isPaused) return;
    if (session.frames.length >= 120) { error = 'Snapshot limit reached (120). Audio recording continues.'; return; }
    busy = true;
    const token = generation, current = session;
    const seconds = current.offset + getElapsedSeconds();
    try {
      let target = null;
      if (automatic) {
        const result = await detectTeamsShare();
        if (generation !== token || session !== current || getRecordingState().isPaused) return;
        detection = result.state;
        if (result.state !== 'sharing') { selected = null; current.previous = null; error = null; return; }
        target = result.target;
      }
      const sourceId = target ? `window:${target.windowId}:0` : selected.id;
      const item = (await sources()).find(s => s.id === sourceId);
      // Recheck after capture: a stopped share or changed layout must not save gallery/chat pixels.
      if (target) {
        const again = await detectTeamsShare();
        if (generation !== token || session !== current || getRecordingState().isPaused) return;
        if (again.state !== 'sharing' || again.target.windowId !== target.windowId || ['x', 'y', 'width', 'height'].some(k => again.target.region[k] !== target.region[k])) {
          selected = null; current.previous = null; detection = again.state; return;
        }
      }
      if (generation !== token || session !== current || getRecordingState().isPaused) return;
      if (!item || item.thumbnail.isEmpty()) {
        if (automatic) { selected = null; detection = 'waiting'; return; }
        invalidate(); selected = null; error = 'Selected window is unavailable. Choose it again to resume snapshots.'; return;
      }
      const thumbnail = target ? cropSharedContent(item.thumbnail, target) : item.thumbnail;
      if (target) selected = { id: sourceId, name: 'Teams' };
      const bitmap = thumbnail.resize({ width: 64, height: 40 }).toBitmap();
      if (current.previous && current.previous.length === bitmap.length) {
        let delta = 0;
        for (let i = 0; i < bitmap.length; i += 4) {
          delta += Math.abs(bitmap[i] - current.previous[i]) + Math.abs(bitmap[i + 1] - current.previous[i + 1]) + Math.abs(bitmap[i + 2] - current.previous[i + 2]);
        }
        if (delta / (bitmap.length / 4 * 3 * 255) < 0.015) return;
      }
      const dir = path.join(root(), current.stem);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const filename = `${String(current.frames.length).padStart(4, '0')}.jpg`;
      const bytes = thumbnail.toJPEG(80);
      if (bytes.length > 4 * 1024 * 1024) throw new Error('Snapshot too large.');
      fs.writeFileSync(path.join(dir, filename), bytes, { mode: 0o600 });
      current.frames.push({ file: filename, seconds });
      fs.writeFileSync(path.join(dir, 'manifest.tmp'), JSON.stringify({ version: 1, frames: current.frames }), { mode: 0o600 });
      fs.renameSync(path.join(dir, 'manifest.tmp'), path.join(dir, 'manifest.json'));
      current.previous = bitmap; error = null;
    } catch (_) { if (generation === token) { if (automatic) { selected = null; detection = 'error'; } error = 'Could not save screen snapshots. Audio recording continues.'; } }
    finally { busy = false; }
  }
  function discard(current) {
    if (!current) return;
    if (current.initialCount === 0) { remove(current.stem); return; }
    const dir = path.join(root(), current.stem);
    const original = current.frames.slice(0, current.initialCount);
    fs.writeFileSync(path.join(dir, 'manifest.tmp'), JSON.stringify({ version: 1, frames: original }), { mode: 0o600 });
    fs.renameSync(path.join(dir, 'manifest.tmp'), path.join(dir, 'manifest.json'));
    for (const frame of current.frames.slice(current.initialCount)) {
      fs.rmSync(path.join(dir, frame.file), { force: true });
    }
  }
  function remove(stem) {
    if (!stem || path.basename(stem) !== stem || stem === '.' || stem === '..') return;
    fs.rmSync(path.join(root(), stem), { recursive: true, force: true });
  }
  return { list, select, setAutomatic, start, stop, invalidate, tick, status, remove, discard };
}
module.exports = { createScreenSnapshots };
