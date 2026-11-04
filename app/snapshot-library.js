'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setImmediate: yieldToUI } = require('node:timers/promises');
const MAX_IMAGE = 4 * 1024 * 1024;
function readRegular(file, limit) {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid snapshot file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error('Invalid snapshot file');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) throw new Error('Snapshot changed while reading');
      offset += n;
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}
function createSnapshotLibrary({ getUserDataDir, nativeImage, dialog, getWindow }) {
  function directory(stem) {
    if (!stem || path.basename(stem) !== stem || stem === '.' || stem === '..') throw new Error('Invalid meeting');
    const root = path.join(getUserDataDir(), 'screen-snapshots');
    const dir = path.join(root, stem);
    for (const p of [root, dir]) {
      if (!fs.existsSync(p)) return null;
      if (!fs.lstatSync(p).isDirectory() || fs.lstatSync(p).isSymbolicLink()) throw new Error('Invalid snapshot directory');
    }
    return dir;
  }
  function frames(stem) {
    const dir = directory(stem);
    if (!dir) return [];
    const manifest = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifest)) return [];
    const data = JSON.parse(readRegular(manifest, 65536));
    if (!Array.isArray(data.frames) || data.frames.length > 120) throw new Error('Invalid snapshot manifest');
    const seen = new Set();
    return data.frames.map(f => {
      if (!/^\d{4}\.jpg$/.test(f.file) || seen.has(f.file) || !Number.isFinite(f.seconds) || f.seconds < 0) throw new Error('Invalid snapshot entry');
      seen.add(f.file);
      return { file: f.file, seconds: f.seconds };
    });
  }
  function image(stem, file) {
    if (!frames(stem).some(f => f.file === file)) throw new Error('Snapshot unavailable');
    const dir = directory(stem);
    if (!dir) throw new Error('Snapshot unavailable');
    const bytes = readRegular(path.join(dir, file), MAX_IMAGE);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || nativeImage.createFromBuffer(bytes).isEmpty()) throw new Error('Invalid snapshot image');
    return bytes;
  }
  async function list(stem) {
    const result = [];
    for (const f of frames(stem)) {
      await yieldToUI();
      try {
        const preview = nativeImage.createFromBuffer(image(stem, f.file)).resize({ width: 320 }).toDataURL();
        result.push({ ...f, preview, available: true });
      } catch (_) { result.push({ ...f, preview: null, available: false }); }
    }
    return result;
  }
  function view(stem, file) { return 'data:image/jpeg;base64,' + image(stem, file).toString('base64'); }
  function exportName(f) {
    const seconds = Math.floor(f.seconds);
    const stamp = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join('-');
    return `${stamp}-${f.file}`;
  }
  async function save(stem, file = null) {
    if (file !== null) {
      const frame = frames(stem).find(f => f.file === file);
      if (!frame) throw new Error('Snapshot unavailable');
      const result = await dialog.showSaveDialog(getWindow(), { defaultPath: exportName(frame), filters: [{ name: 'JPEG image', extensions: ['jpg'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      const bytes = image(stem, file);
      fs.writeFileSync(result.filePath, bytes, { mode: 0o600, flag: fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0) });
      return { canceled: false, count: 1 };
    }
    const entries = frames(stem);
    if (!entries.length) throw new Error('No snapshots available');
    const result = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Save snapshots here' });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    // Always create a new folder, so exports never overwrite unrelated files.
    const folder = fs.mkdtempSync(path.join(result.filePaths[0], 'Steno-snapshots-'));
    try {
      for (const frame of entries) {
        await yieldToUI();
        fs.writeFileSync(path.join(folder, exportName(frame)), image(stem, frame.file), { mode: 0o600, flag: 'wx' });
      }
    } catch (error) { fs.rmSync(folder, { recursive: true, force: true }); throw error; }
    return { canceled: false, count: entries.length };
  }
  return { list, view, save };
}
module.exports = { createSnapshotLibrary };
