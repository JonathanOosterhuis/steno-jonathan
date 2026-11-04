const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validTarget, cropSharedContent, createTeamsShareDetector } = require('./teams-share');
test('crop converts normalized region to thumbnail pixels without extending bounds', () => {
  const target = { windowId: 42, region: { x: .1, y: .2, width: .8, height: .7 } };
  let crop;
  cropSharedContent({ getSize: () => ({ width: 1600, height: 1000 }), crop: r => { crop = r; } }, target);
  assert.deepEqual(crop, { x: 160, y: 200, width: 1280, height: 699 });
  assert.equal(validTarget({ ...target, region: { ...target.region, x: -.1 } }), false);
  assert.equal(validTarget({ ...target, windowId: '42' }), false);
});
test('other platforms never launch the native helper', async () => {
  assert.deepEqual(await createTeamsShareDetector({ platform: 'win32', helperPath: '/nonexistent' })(), { state: 'unsupported' });
});
