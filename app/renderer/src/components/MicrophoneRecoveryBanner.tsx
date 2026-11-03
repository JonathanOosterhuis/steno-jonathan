import * as React from 'react';
import { useMicrophoneNotice } from '@/hooks/microphoneNoticeStore';
export function MicrophoneRecoveryBanner() {
  const notice = useMicrophoneNotice((s) => s.notice);
  React.useEffect(() => {
    if (notice?.kind !== 'recovered') return;
    const timer = setTimeout(() => useMicrophoneNotice.getState().set(null), 10000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div
      role={notice.kind === 'failed' ? 'alert' : 'status'}
      aria-live="polite"
      data-testid="microphone-recovery"
      className="fixed bottom-6 left-1/2 z-50 w-[min(90vw,560px)] -translate-x-1/2 rounded-xl border p-4 text-sm shadow-lg"
      style={{
        background: 'var(--bg-raised, #262621)',
        color: 'var(--text-primary, #f0efe9)',
        borderColor: notice.kind === 'failed' ? '#c98740' : 'var(--border, #55554b)',
      }}
    >
      {notice.message}
    </div>
  );
}
