import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Images } from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

function timestamp(seconds: number) {
  const total = Math.floor(seconds);
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
export function MeetingSnapshots({ summaryFile }: { summaryFile: string }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const snapshots = useQuery({
    queryKey: ['meetingSnapshots', summaryFile],
    queryFn: async () => unwrap(await ipc().screenSnapshots.meeting(summaryFile)),
  });
  const preview = useQuery({
    queryKey: ['meetingSnapshotImage', summaryFile, selected],
    queryFn: async () => unwrap(await ipc().screenSnapshots.view(summaryFile, selected!)),
    enabled: selected !== null,
    gcTime: 0,
  });
  const frames = snapshots.data?.frames ?? [];
  const frame = frames.find((f) => f.file === selected);
  async function save(file?: string) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = unwrap(await ipc().screenSnapshots.save(summaryFile, file));
      if (!result.canceled) setMessage(t('snapshots.saved', { count: result.count ?? 0 }));
    } catch {
      setError(t('snapshots.saveFailed'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      className="my-6 rounded-lg border border-[color:var(--border)] p-4"
      aria-label={t('snapshots.gallery')}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Images size={16} />
          {t('snapshots.gallery')}
        </h2>
        {frames.length > 0 && (
          <Button variant="outline" disabled={saving} onClick={() => void save()}>
            <Download size={14} />
            {t('snapshots.downloadAll')}
          </Button>
        )}
      </div>
      {snapshots.isPending ? (
        <p role="status" className="mt-3 text-sm">
          {t('snapshots.loadingGallery')}
        </p>
      ) : snapshots.error ? (
        <p role="alert" className="mt-3 text-sm">
          {t('snapshots.galleryFailed')}
        </p>
      ) : !frames.length ? (
        <p className="mt-3 text-sm text-[color:var(--fg-2)]">{t('snapshots.noImages')}</p>
      ) : (
        <>
          <p className="my-3 text-xs text-[color:var(--fg-2)]">{t('snapshots.exportHelp')}</p>
          <div className="grid max-h-[30rem] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {frames.map((f) => (
              <div key={f.file} className="rounded-lg border border-[color:var(--border)] p-2">
                <button
                  className="block w-full rounded text-left focus-visible:outline focus-visible:outline-2"
                  disabled={!f.available}
                  onClick={() => setSelected(f.file)}
                  aria-label={t('snapshots.openAt', { time: timestamp(f.seconds) })}
                >
                  {f.preview ? (
                    <img
                      loading="lazy"
                      src={f.preview}
                      alt={t('snapshots.imageAt', { time: timestamp(f.seconds) })}
                      className="aspect-video w-full rounded object-contain"
                    />
                  ) : (
                    <p className="flex aspect-video items-center text-xs">
                      {t('snapshots.unavailable')}
                    </p>
                  )}
                  <span className="mt-2 block text-xs tabular-nums">{timestamp(f.seconds)}</span>
                </button>
                <Button
                  variant="ghost"
                  className="mt-1 w-full"
                  disabled={saving || !f.available}
                  onClick={() => void save(f.file)}
                  aria-label={t('snapshots.downloadAt', { time: timestamp(f.seconds) })}
                >
                  <Download size={14} />
                  {t('snapshots.download')}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('snapshots.imageAt', { time: timestamp(frame?.seconds ?? 0) })}
            </DialogTitle>
            <DialogDescription>{t('snapshots.previewHelp')}</DialogDescription>
          </DialogHeader>
          {preview.isPending ? (
            <p role="status">{t('snapshots.loadingGallery')}</p>
          ) : preview.error ? (
            <p role="alert">{t('snapshots.unavailable')}</p>
          ) : (
            <img
              src={preview.data?.image}
              alt={t('snapshots.imageAt', { time: timestamp(frame?.seconds ?? 0) })}
              className="max-h-[70vh] w-full object-contain"
            />
          )}
          <Button
            variant="outline"
            disabled={saving || !preview.data}
            onClick={() => selected && void save(selected)}
          >
            <Download size={14} />
            {t('snapshots.download')}
          </Button>
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
