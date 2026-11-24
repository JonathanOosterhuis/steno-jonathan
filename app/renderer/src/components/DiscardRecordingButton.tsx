import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLiveDraftStore } from '@/hooks/liveDraftStore';
import type { useRecording } from '@/hooks/useRecording';
import { t } from '@/i18n';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { navigate } from '@/lib/router';

export function DiscardRecordingButton({ recording }: { recording: ReturnType<typeof useRecording> }) {
  const [target, setTarget] = React.useState<string | null>(null);
  const client = useQueryClient();
  const label = t('recording.discard');
  async function discard() {
    if (!target) return;
    try {
      const result = unwrap(await ipc().recording.discard(target));
      if (recording.sessionName) useLiveDraftStore.getState().clear(recording.sessionName);
      if (result.summaryFile) navigate('/meetings/' + encodeURIComponent(result.summaryFile));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    } finally {
      setTarget(null);
      await client.invalidateQueries({ queryKey: ['recording', 'queue'] });
    }
  }
  return <>
    <button type="button" title={label} aria-label={label} disabled={!recording.recordingId}
      className="inline-flex size-7 items-center justify-center rounded-full hover:bg-[color:var(--surface-hover)]"
      onClick={() => setTarget(recording.recordingId)}>
      <Trash2 size={14} />
    </button>
    <ConfirmDialog open={target !== null && target === recording.recordingId}
      onOpenChange={open => { if (!open) setTarget(null); }}
      title={t('recording.discardTitle')} confirmLabel={label} cancelLabel={t('recording.keep')}
      description={recording.recordingSummaryFile ? t('recording.discardContinuation') : t('recording.discardNew')}
      destructive onConfirm={discard} />
  </>;
}
