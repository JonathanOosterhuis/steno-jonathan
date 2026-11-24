import { test, expect } from '../fixtures/electron';
import { writeUserConfig, writeMeetingSummary } from '../fixtures/user-config';
import { readdirSync, readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

for (const continuation of [false, true]) {
  test('discard ' + (continuation ? 'resumed segment preserves original' : 'fresh recording'), async ({ launchApp, userDataDir }) => {
    test.setTimeout(60000);
    writeUserConfig(userDataDir, { privacy_notice_seen: true, telemetry_enabled: false, transcription_engine: 'whisper', system_audio_enabled: false });
    const original = continuation ? writeMeetingSummary(userDataDir, 'prior', { name: 'Prior', transcript: 'Earlier words' }) : null;
    const before = original && readFileSync(original, 'utf8');
    const snapshots = path.join(userDataDir, 'screen-snapshots');
    const priorDir = path.join(snapshots, 'prior');
    const priorManifest = JSON.stringify({ version: 1, frames: [{ file: '0000.jpg', seconds: 1 }] });
    if (continuation) {
      mkdirSync(priorDir, { recursive: true });
      writeFileSync(path.join(priorDir, '0000.jpg'), 'prior image fixture');
      writeFileSync(path.join(priorDir, 'manifest.json'), priorManifest);
      writeFileSync(path.join(userDataDir, 'output', 'Test_notes.txt'), 'Prior draft');
    }
    const { app, page } = await launchApp({ fakeAudio: true, releaseHighlightsSeen: true });
    await app.evaluate(({ desktopCapturer, nativeImage }) => {
      desktopCapturer.getSources = async () => [{
        id: 'window:42:0', name: 'Test slide', display_id: '', appIcon: null,
        thumbnail: nativeImage.createFromBitmap(Buffer.alloc(1024, 255), { width: 16, height: 16 }),
      }];
    });
    const start = await page.evaluate(file => window.stenoai.recording.start('Test', 'manual', file ?? undefined), original);
    expect(start.success).toBe(true);
    const audioDir = path.join(userDataDir, 'recordings');
    const audio = () => existsSync(audioDir) ? readdirSync(audioDir).filter(f => f.endsWith('.webm')) : [];
    await expect.poll(() => audio().some(f => statSync(path.join(audioDir, f)).size > 0)).toBe(true);
    await page.evaluate(() => window.stenoai.screenSnapshots.select('window:42:0'));
    await expect.poll(() => page.evaluate(async () => (await window.stenoai.screenSnapshots.status()).count)).toBe(continuation ? 2 : 1);
    await page.evaluate(() => window.stenoai.meetings.saveNotes('Test', 'Temporary notes'));
    const discard = page.getByRole('button', { name: 'Discard recording', exact: true });
    await discard.click();
    await page.getByRole('button', { name: 'Keep recording' }).click();
    expect((await page.evaluate(() => window.stenoai.recording.getQueue())).hasRecording).toBe(true);
    await discard.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard recording' }).click();
    await expect.poll(async () => {
      const q = await page.evaluate(() => window.stenoai.recording.getQueue());
      return [q.hasRecording, q.pendingDiscardId, q.queueSize, q.isProcessing];
    }).toEqual([false, null, 0, false]);
    expect(audio()).toEqual([]);
    expect(readdirSync(path.join(userDataDir, 'output')).filter(f => /_notes\.txt$|_summary\.(json|md)$/.test(f)).sort()).toEqual(original ? ['Test_notes.txt', path.basename(original)].sort() : []);
    expect(readdirSync(snapshots)).toEqual(original ? ['prior'] : []);
    if (original) {
      expect(readFileSync(original, 'utf8')).toBe(before);
      expect(readFileSync(path.join(userDataDir, 'output', 'Test_notes.txt'), 'utf8')).toBe('Prior draft');
      expect(readdirSync(priorDir).sort()).toEqual(['0000.jpg', 'manifest.json']);
      expect(readFileSync(path.join(priorDir, 'manifest.json'), 'utf8')).toBe(priorManifest);
      expect(readFileSync(path.join(priorDir, '0000.jpg'), 'utf8')).toBe('prior image fixture');
    }
    expect(readdirSync(path.join(userDataDir, 'recovery'))).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(userDataDir, 'recording-journal.json'), 'utf8')).entries).toEqual({});
  });
}

test('discard while the microphone is opening allows another recording', async ({ launchApp, userDataDir }) => {
  test.setTimeout(60000);
  writeUserConfig(userDataDir, { privacy_notice_seen: true, transcription_engine: 'whisper', system_audio_enabled: false });
  const { page } = await launchApp({ fakeAudio: true, releaseHighlightsSeen: true });
  await page.evaluate(() => {
    const devices = navigator.mediaDevices;
    const acquire = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async options => {
      devices.getUserMedia = acquire;
      document.body.dataset.testMicOpening = 'true';
      await new Promise<void>(resolve => window.addEventListener('release-test-mic', () => resolve(), { once: true }));
      return acquire(options);
    };
    void window.stenoai.recording.start('First');
  });
  await page.waitForSelector('[data-test-mic-opening]', { state: 'attached' });
  const discard = page.getByRole('button', { name: 'Discard recording', exact: true });
  await discard.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard recording' }).click();
  await expect.poll(async () => {
    const q = await page.evaluate(() => window.stenoai.recording.getQueue());
    return [q.hasRecording, q.pendingDiscardId];
  }).toEqual([false, null]);
  const start = await page.evaluate(() => window.stenoai.recording.start('Second'));
  expect(start.success).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('release-test-mic')));
  const dir = path.join(userDataDir, 'recordings');
  await expect.poll(() => existsSync(dir) && readdirSync(dir).some(f => f.endsWith('.webm') && statSync(path.join(dir, f)).size > 0)).toBe(true);
  expect(readdirSync(dir)).toHaveLength(1);
  expect((await page.evaluate(() => window.stenoai.recording.getQueue())).sessionName).toBe('Second');
  await discard.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard recording' }).click();
  await expect.poll(() => readdirSync(dir)).toEqual([]);
});
