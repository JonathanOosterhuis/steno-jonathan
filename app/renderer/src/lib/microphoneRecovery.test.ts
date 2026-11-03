import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { watchMicrophone } from './microphoneRecovery';

function stream(deviceId = 'old', groupId = 'old') {
  const track = Object.assign(new EventTarget(), {
    readyState: 'live',
    muted: false,
    getSettings: () => ({ deviceId, groupId }),
    stop: vi.fn(),
  });
  return {
    track,
    stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream,
  };
}
let cleanups: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.forEach((f) => f());
  cleanups = [];
  vi.useRealTimers();
});
function setup(preferredDeviceId?: string) {
  const old = stream();
  const next = stream('new', 'new');
  let current = old.stream;
  const events = new EventTarget();
  const getUserMedia = vi.fn(async () => next.stream);
  const enumerateDevices = vi.fn(
    async () =>
      [
        { kind: 'audioinput', deviceId: 'new', groupId: 'new' },
        { kind: 'audioinput', deviceId: 'default', groupId: 'new' },
      ] as MediaDeviceInfo[]
  );
  const notify = vi.fn();
  const signalPresent = vi.fn(() => true);
  const isPaused = vi.fn(() => false);
  const replace = vi.fn((s: MediaStream) => {
    current = s;
  });
  const cleanup = watchMicrophone({
    devices: {
      getUserMedia,
      enumerateDevices,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    },
    current: () => current,
    replace,
    preferredDeviceId,
    notify,
    signalPresent,
    isPaused,
  });
  cleanups.push(cleanup);
  return {
    old,
    next,
    events,
    getUserMedia,
    enumerateDevices,
    notify,
    replace,
    cleanup,
    signalPresent,
    isPaused,
  };
}
test('ended microphone reconnects while retaining the recording graph', async () => {
  const s = setup();
  s.old.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(1001);
  expect(s.replace).toHaveBeenCalledWith(s.next.stream);
  expect(s.old.track.stop).toHaveBeenCalledOnce();
  expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'recovered' }));
});
test('default input changes reconnect even if old track remains live', async () => {
  const s = setup();
  s.events.dispatchEvent(new Event('devicechange'));
  await vi.advanceTimersByTimeAsync(600);
  expect(s.replace).toHaveBeenCalledOnce();
});
test('lost pinned device falls back to the available default', async () => {
  const s = setup('old');
  s.old.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(1);
  expect(s.getUserMedia.mock.calls[0]).toEqual([
    { audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } },
  ]);
});
test('ordinary silence does not trigger reconnect', async () => {
  const s = setup();
  await vi.advanceTimersByTimeAsync(30000);
  expect(s.getUserMedia).not.toHaveBeenCalled();
});
test('a persistent muted track reconnects, a brief mute does not', async () => {
  const s = setup();
  s.old.track.dispatchEvent(new Event('mute'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(s.getUserMedia).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1100);
  expect(s.replace).toHaveBeenCalledOnce();
});
test('failed reconnect warns and retries instead of silently recording', async () => {
  const s = setup();
  s.getUserMedia.mockRejectedValueOnce(new Error('busy'));
  s.old.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(1);
  expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'failed' }));
  await vi.advanceTimersByTimeAsync(2100);
  expect(s.replace).toHaveBeenCalledOnce();
});
test('late permission result after stop is disposed and cannot replace the next recording', async () => {
  const s = setup();
  let resolve!: (value: MediaStream) => void;
  s.getUserMedia.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  s.old.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(1);
  s.cleanup();
  resolve(s.next.stream);
  await vi.advanceTimersByTimeAsync(1);
  expect(s.replace).not.toHaveBeenCalled();
  expect(s.next.track.stop).toHaveBeenCalledOnce();
});
test('timed out device requests cannot later take over a recording', async () => {
  const s = setup();
  let resolve!: (value: MediaStream) => void;
  s.getUserMedia.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  s.old.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(10001);
  expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'failed' }));
  resolve(s.next.stream);
  await vi.advanceTimersByTimeAsync(1);
  expect(s.replace).not.toHaveBeenCalled();
  expect(s.next.track.stop).toHaveBeenCalledOnce();
});

test('flat audio after switching is retried and never declared restored', async () => {
  const s = setup();
  s.signalPresent.mockReturnValue(false);
  s.old.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(21001);
  expect(s.notify.mock.calls.some(([notice]) => notice?.kind === 'recovered')).toBe(false);
  expect(s.getUserMedia.mock.calls.length).toBeGreaterThan(1);
  await vi.advanceTimersByTimeAsync(70000);
  expect(s.getUserMedia.mock.calls.length).toBeLessThanOrEqual(3);
  expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'failed' }));
});
test('device changes after cleanup cannot open the microphone', async () => {
  const s = setup();
  s.cleanup();
  s.events.dispatchEvent(new Event('devicechange'));
  await vi.advanceTimersByTimeAsync(40000);
  expect(s.getUserMedia).not.toHaveBeenCalled();
});

test('pause cannot falsely confirm audio restoration', async () => {
  const s = setup();
  s.signalPresent.mockReturnValue(false);
  s.old.track.dispatchEvent(new Event('ended'));
  await vi.advanceTimersByTimeAsync(1);
  s.isPaused.mockReturnValue(true);
  s.signalPresent.mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(30000);
  expect(s.notify.mock.calls.some(([notice]) => notice?.kind === 'recovered')).toBe(false);
  s.isPaused.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'recovered' }));
});
