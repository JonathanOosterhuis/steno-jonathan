import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { meetingsKeys } from '@/hooks/meetingKeys';
import { t } from '@/i18n';
import { ipc, type Meeting } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { navigate } from '@/lib/router';

export function MergeNotesDialog({ source, meetings, onClose }: {
  source: string;
  meetings: Meeting[];
  onClose: () => void;
}) {
  const [other, setOther] = React.useState('');
  const queryClient = useQueryClient();
  const merge = useMutation({
    mutationFn: async () => unwrap(await ipc().meetings.merge(source, other)),
    onSuccess: ({ summaryFile }) => {
      void queryClient.invalidateQueries({ queryKey: meetingsKeys.all });
      onClose();
      navigate(`/meetings/${encodeURIComponent(summaryFile)}`);
    },
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !merge.isPending) onClose(); }}>
      <DialogContent closeDisabled={merge.isPending}>
        <DialogHeader>
          <DialogTitle>{t('meeting.merge.title')}</DialogTitle>
          <DialogDescription>{t('meeting.merge.description')}</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-2 text-sm">
          {t('meeting.merge.choose')}
          <select
            className="w-full rounded-md border border-border bg-background p-2"
            value={other}
            onChange={(event) => setOther(event.target.value)}
            disabled={merge.isPending}
          >
            <option value="">{t('meeting.merge.placeholder')}</option>
            {meetings.filter(({ session_info }) => session_info.summary_file !== source).map(({ session_info }) => (
              <option key={session_info.summary_file} value={session_info.summary_file}>
                {session_info.name}
                {session_info.processed_at && ` · ${new Date(session_info.processed_at).toLocaleString()}`}
              </option>
            ))}
          </select>
        </label>
        {merge.isError && <p role="alert">{merge.error.message || t('meeting.merge.error')}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merge.isPending}>
            {t('meeting.merge.cancel')}
          </Button>
          <Button onClick={() => merge.mutate()} disabled={!other || merge.isPending}>
            {t('meeting.merge.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
