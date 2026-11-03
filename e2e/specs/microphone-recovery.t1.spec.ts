import { test, expect } from '../fixtures/electron';

test('microphone disconnect replaces only the microphone while the same recording continues', async ({ launchApp }) => {
  const { page } = await launchApp({ mockIpc: true, fakeAudio: true, env: {
    STENOAI_E2E_RENDERER_PLATFORM: 'darwin', STENOAI_E2E_MOCK_PARAKEET_INSTALLED: '1',
  } });
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.evaluate(() => {
    const ctx = new AudioContext();
    const first = ctx.createMediaStreamDestination();
    const next = ctx.createMediaStreamDestination();
    const system = ctx.createMediaStreamDestination();
    let calls = 0;
    const state = { first, next, calls, before: 0, activeMic: first.stream, recorders: 0 };
    Object.assign(window, { __micRecovery: state });
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...args) { state.recorders++; return start.apply(this, args); };
    navigator.mediaDevices.getUserMedia = async () => {
      state.calls = ++calls;
      const mic = ctx.createMediaStreamDestination();
      state.activeMic = mic.stream;
      return mic.stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => system.stream;
    navigator.mediaDevices.enumerateDevices = async () => [];
    AnalyserNode.prototype.getFloatTimeDomainData = function (buffer) { buffer.fill(.01); };
  });
  await page.evaluate(() => window.stenoai.recording.start('Microphone recovery test'));
  await page.getByRole('button', { name: 'Open recording in progress' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__micRecovery.recorders)).toBe(1);
  await page.evaluate(() => {
    const state = (window as any).__micRecovery; state.before = state.calls;
    const track = state.activeMic.getAudioTracks()[0];
    track.stop(); track.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByTestId('microphone-recovery')).toContainText('Microphone signal restored', { timeout: 10000 });
  expect(await page.evaluate(() => (window as any).__micRecovery.recorders)).toBe(1);
  expect(await page.evaluate(() => (window as any).__micRecovery.calls - (window as any).__micRecovery.before)).toBe(1);
  expect(await page.evaluate(() => (window as any).__micRecovery.activeMic.getAudioTracks()[0].readyState)).toBe('live');
});
