import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor } from 'lucide-react';
import { t } from '@/i18n';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function ScreenSnapshotsControl() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const status = useQuery({
    queryKey: ['screenSnapshots'],
    queryFn: async () => unwrap(await ipc().screenSnapshots.status()),
    refetchInterval: 2000,
  });
  const sources = useQuery({
    queryKey: ['screenSnapshotSources'],
    queryFn: async () => unwrap(await ipc().screenSnapshots.list()),
    enabled: open,
    staleTime: 0,
  });
  async function choose(id: string | null) {
    setBusy(true);
    setError('');
    try {
      unwrap(await ipc().screenSnapshots.select(id));
      await queryClient.invalidateQueries({ queryKey: ['screenSnapshots'] });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('snapshots.failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="my-4 rounded-lg border border-[color:var(--border)] p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            <Monitor size={16} />
            {t('snapshots.title')}
          </div>
          <p className="mt-1 text-[color:var(--fg-2)]">
            {status.data?.selected
              ? t('snapshots.selected', { name: status.data.selected, count: status.data.count })
              : t('snapshots.off')}
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t('snapshots.choose')}
        </Button>
        {status.data?.selected && (
          <Button variant="ghost" disabled={busy} onClick={() => void choose(null)}>
            {t('snapshots.stop')}
          </Button>
        )}
      </div>
      {(error || status.data?.error || status.error) && (
        <p role="alert" className="mt-2 text-[color:var(--fg-2)]">
          {error || status.data?.error || t('snapshots.failed')}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('snapshots.choose')}</DialogTitle>
            <DialogDescription>{t('snapshots.description')}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-[color:var(--fg-2)]">{t('snapshots.local')}</p>
          <div className="grid max-h-[55vh] grid-cols-2 gap-3 overflow-y-auto">
            {sources.data?.sources.map((source) => (
              <button
                key={source.id}
                disabled={busy}
                onClick={() => void choose(source.id)}
                className="rounded-lg border border-[color:var(--border)] p-2 text-left hover:bg-[color:var(--surface-hover)]"
              >
                <img
                  src={source.preview}
                  alt={source.name}
                  className="aspect-video w-full object-contain"
                />
                <span className="mt-2 block truncate text-sm">{source.name}</span>
              </button>
            ))}
          </div>
          {sources.isFetching && <p role="status">{t('snapshots.loading')}</p>}
          {sources.error && <p role="alert">{t('snapshots.permission')}</p>}
          {sources.data?.sources.length === 0 && <p>{t('snapshots.empty')}</p>}
          <Button
            variant="outline"
            disabled={sources.isFetching}
            onClick={() => void sources.refetch()}
          >
            {t('snapshots.refresh')}
          </Button>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
