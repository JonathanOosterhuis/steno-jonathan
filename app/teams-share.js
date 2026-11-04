'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
function validTarget(target) {
  const r = target?.region;
  return Number.isInteger(target?.windowId) && target.windowId > 0 && r &&
    ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) &&
    r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 &&
    r.x + r.width <= 1.001 && r.y + r.height <= 1.001;
}
function createTeamsShareDetector({ platform, helperPath }) {
  return async () => {
    if (platform !== 'darwin') return { state: 'unsupported' };
    const { stdout } = await run(helperPath, [], { timeout: 8000, maxBuffer: 4096 });
    const result = JSON.parse(stdout);
    if (result.state === 'sharing' && validTarget(result.target)) return result;
    if (['waiting', 'ambiguous', 'access-required'].includes(result.state)) return { state: result.state };
    throw new Error('Invalid Teams share detection result');
  };
}
function cropSharedContent(thumbnail, target) {
  if (!validTarget(target)) throw new Error('Invalid shared content region');
  const { width, height } = thumbnail.getSize(), r = target.region;
  const x = Math.ceil(r.x * width), y = Math.ceil(r.y * height);
  const right = Math.min(width, Math.floor((r.x + r.width) * width));
  const bottom = Math.min(height, Math.floor((r.y + r.height) * height));
  if (right - x < 100 || bottom - y < 100) throw new Error('Shared content too small');
  return thumbnail.crop({ x, y, width: right - x, height: bottom - y });
}
module.exports = { createTeamsShareDetector, cropSharedContent, validTarget };
