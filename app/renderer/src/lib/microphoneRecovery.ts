export type MicrophoneNotice = {
  kind: 'recovering' | 'recovered' | 'failed';
  message: string;
} | null;
type Options = {
  devices: Pick<
    MediaDevices,
    'getUserMedia' | 'enumerateDevices' | 'addEventListener' | 'removeEventListener'
  >;
  current: () => MediaStream;
  replace: (stream: MediaStream) => void;
  preferredDeviceId?: string;
  signalPresent?: () => boolean;
  isPaused?: () => boolean;
  notify: (notice: MicrophoneNotice) => void;
};

/** Reconnect only the microphone branch, leaving the recorder and system audio intact. */
export function watchMicrophone(options: Options): () => void {
  let closed = false;
  let busy = false;
  let pending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watched: MediaStreamTrack | undefined;
  let mutedSince = 0;
  let failed = false;
  let checkSignalSince = 0;
  let flatRetries = 0;
  let flatSince = Date.now();
  let signalWarning = false;
  const stop = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());
  const schedule = (delay: number) => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void recover();
    }, delay);
  };
  const ended = () => schedule(0);
  const mute = () => {
    mutedSince = Date.now();
  };
  const unmute = () => {
    mutedSince = 0;
  };
  const attach = () => {
    watched?.removeEventListener('ended', ended);
    watched?.removeEventListener('mute', mute);
    watched?.removeEventListener('unmute', unmute);
    watched = options.current().getAudioTracks()[0];
    watched?.addEventListener('ended', ended);
    watched?.addEventListener('mute', mute);
    watched?.addEventListener('unmute', unmute);
    mutedSince = watched?.muted ? Date.now() : 0;
  };
  const acquire = async (deviceId?: string): Promise<MediaStream> => {
    let expired = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const request = options.devices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      })
      .then((stream) => {
        if (closed || expired) {
          stop(stream);
          throw new Error('Microphone request cancelled');
        }
        return stream;
      });
    try {
      return await Promise.race([
        request,
        new Promise<MediaStream>((_, reject) => {
          deadline = setTimeout(() => {
            expired = true;
            reject(new Error('Microphone request timed out'));
          }, 10000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  };
  async function recover() {
    if (closed) return;
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    options.notify({
      kind: 'recovering',
      message: 'Microphone changed. Reconnecting automatically…',
    });
    let replacement: MediaStream | undefined;
    try {
      const available = await options.devices.enumerateDevices();
      if (closed) return;
      const preferred =
        options.preferredDeviceId &&
        available.some((d) => d.kind === 'audioinput' && d.deviceId === options.preferredDeviceId)
          ? options.preferredDeviceId
          : undefined;
      try {
        replacement = await acquire(preferred);
      } catch (error) {
        if (
          !preferred ||
          !['NotFoundError', 'OverconstrainedError'].includes((error as Error).name)
        )
          throw error;
        replacement = await acquire();
      }
      if (closed) {
        stop(replacement);
        return;
      }
      const track = replacement.getAudioTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted)
        throw new Error('Microphone is unavailable');
      const previous = options.current();
      options.replace(replacement);
      attach();
      stop(previous);
      replacement = undefined;
      failures = 0;
      failed = false;
      checkSignalSince = Date.now();
      options.notify({
        kind: 'recovering',
        message: 'Microphone reconnected. Checking audio signal…',
      });
    } catch {
      if (replacement) stop(replacement);
      if (!closed) {
        failed = true;
        failures++;
        options.notify({
          kind: 'failed',
          message:
            'Microphone disconnected. Your voice may not be recorded. Reconnecting automatically; existing audio is safe.',
        });
        schedule(Math.min(15000, 1000 * 2 ** Math.min(failures, 4)));
      }
    } finally {
      busy = false;
      if (pending && !closed) {
        pending = false;
        schedule(300);
      }
    }
  }
  const changed = () => {
    if (closed) return;
    // A devicechange can be output-only. Check the actual input identity first.
    void options.devices
      .enumerateDevices()
      .then((devices) => {
        if (closed) return;
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        const settings = watched?.getSettings();
        const missing =
          !!settings?.deviceId && !inputs.some((d) => d.deviceId === settings.deviceId);
        const preferred = inputs.find((d) => d.deviceId === options.preferredDeviceId);
        const defaultInput = inputs.find((d) => d.deviceId === 'default');
        const target = preferred || defaultInput;
        const different =
          target?.groupId && settings?.groupId && target.groupId !== settings.groupId;
        if (
          missing ||
          different ||
          !watched ||
          watched.readyState === 'ended' ||
          failed ||
          (!options.preferredDeviceId && !target?.groupId)
        )
          schedule(500);
      })
      .catch(() => {
        if (!closed) schedule(500);
      });
  };
  attach();
  options.devices.addEventListener('devicechange', changed);
  const watchdog = setInterval(() => {
    if (closed || busy || failed) return;
    const paused = options.isPaused?.() ?? false;
    if (paused) {
      flatSince = Date.now();
      if (checkSignalSince) checkSignalSince = Date.now();
      return;
    }
    const signal = options.signalPresent?.() ?? true;
    if (signal) flatSince = Date.now();
    if ((checkSignalSince || signalWarning) && signal) {
      checkSignalSince = 0;
      flatRetries = 0;
      signalWarning = false;
      options.notify({
        kind: 'recovered',
        message:
          'Microphone signal restored. Recording continues. Audio during the interruption may be missing.',
      });
    } else if (checkSignalSince && Date.now() - checkSignalSince >= 20000) {
      checkSignalSince = 0;
      signalWarning = true;
      if (++flatRetries <= 2) schedule(0);
      options.notify({
        kind: 'failed',
        message:
          'No microphone sound detected after reconnecting. Your voice may be missing; existing audio is safe.',
      });
    }
    if (!signal && !checkSignalSince && !signalWarning && Date.now() - flatSince >= 30000) {
      signalWarning = true;
      flatRetries++;
      options.notify({
        kind: 'failed',
        message:
          'No microphone signal detected. Reconnecting automatically; existing audio is safe.',
      });
      schedule(0);
    }
    if (
      !watched ||
      watched.readyState === 'ended' ||
      (mutedSince && Date.now() - mutedSince >= 3000)
    )
      schedule(0);
  }, 1000);
  return () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(watchdog);
    options.devices.removeEventListener('devicechange', changed);
    watched?.removeEventListener('ended', ended);
    watched?.removeEventListener('mute', mute);
    watched?.removeEventListener('unmute', unmute);
    options.notify(null);
  };
}
