import { test, expect } from '../fixtures/electron';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

test('chosen window is saved through real IPC, stops, and is not reused', async ({ launchApp, userDataDir }, testInfo) => {
  const { app, page } = await launchApp({ releaseHighlightsSeen: true });
  await app.evaluate(({ desktopCapturer, nativeImage }) => {
    desktopCapturer.getSources = async () => [{
      id: 'window:42:0', name: 'Snapshot test slides', display_id: '', appIcon: null,
      thumbnail: nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 255), { width: 16, height: 16 }),
    }];
  });
  await page.evaluate(() => { location.hash = '#/settings?tab=general'; });
  await page.getByRole('button', { name: 'Choose a window' }).waitFor();
  await page.screenshot({ path: testInfo.outputPath('settings.png') });
  await page.getByRole('button', { name: 'Choose a window' }).click();
  await page.getByRole('button', { name: 'Snapshot test slides' }).waitFor();
  await page.screenshot({ path: testInfo.outputPath('picker.png') });
  await page.getByRole('button', { name: 'Snapshot test slides' }).click();
  await expect(page.getByText(/Snapshot test slides · 0 snapshots/)).toBeVisible();
  const file = await page.evaluate(async () => {
    const result = await window.stenoai.recording.openSystemAudioFile('Snapshot test');
    if (!result.success) throw new Error(result.error);
    return result.filePath;
  });
  const folder = path.join(userDataDir, 'screen-snapshots', path.basename(file, '.webm'));
  await expect.poll(() => existsSync(path.join(folder, 'manifest.json'))).toBe(true);
  const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  expect(manifest.frames).toHaveLength(1);
  expect(existsSync(path.join(folder, manifest.frames[0].file))).toBe(true);
  await page.evaluate(() => window.stenoai.recording.closeSystemAudioFile());
  expect(existsSync(folder)).toBe(false);
  await expect.poll(async () => (await page.evaluate(() => window.stenoai.screenSnapshots.status()))).toMatchObject({ success: true, selected: null, active: false });
});

test('@native real selected window capture', async ({ launchApp, userDataDir }) => {
  test.skip(process.env.STENOAI_E2E_NATIVE_SNAPSHOTS !== '1', 'Opt-in native capture check');
  const { app, page } = await launchApp({ releaseHighlightsSeen: true });
  const permission = await app.evaluate(({ systemPreferences }) => process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted');
  test.skip(permission !== 'granted', `Screen Recording permission: ${permission}`);
  await app.evaluate(async ({ BrowserWindow }) => {
    const slides = new BrowserWindow({ width: 1000, height: 700, show: true, title: 'Steno snapshot verification' });
    await slides.loadURL('data:text/html,' + encodeURIComponent('<html><head><title>Steno snapshot verification</title></head><body style="background:white;color:black;font:36px sans-serif;padding:50px"><h1>PROJECT ORION</h1><p>Launch: 12 December 2026</p><p>Budget: EUR 25,000</p><p>Status: awaiting approval</p></body></html>'));
  });
  const selected = await page.evaluate(async () => {
    const result = await window.stenoai.screenSnapshots.list();
    if (!result.success) throw new Error(result.error);
    const source = result.sources.find(s => s.name === 'Steno snapshot verification');
    if (!source) throw new Error('Synthetic presentation window not capturable');
    return window.stenoai.screenSnapshots.select(source.id);
  });
  expect(selected.success).toBe(true);
  const file = await page.evaluate(async () => {
    const result = await window.stenoai.recording.openSystemAudioFile('Native snapshot test');
    if (!result.success) throw new Error(result.error);
    return result.filePath;
  });
  const folder = path.join(userDataDir, 'screen-snapshots', path.basename(file, '.webm'));
  await expect.poll(() => existsSync(path.join(folder, 'manifest.json'))).toBe(true);
  expect(readFileSync(path.join(folder, '0000.jpg')).length).toBeGreaterThan(5000);
  await page.evaluate(() => window.stenoai.recording.closeSystemAudioFile());
  expect(existsSync(folder)).toBe(false);
});
