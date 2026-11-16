import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { unwrap } from '@/lib/result';
import { t } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Rule = { original: string; replacement: string };
export function WordCorrections() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['word-corrections'], queryFn: async () => unwrap(await ipc().settings.getWordCorrections()).rules });
  const [draft, setDraft] = React.useState<Rule[] | null>(null);
  const rows = draft ?? query.data ?? [];
  const save = useMutation({
    mutationFn: async () => unwrap(await ipc().settings.setWordCorrections(rows)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['word-corrections'] });
      setDraft(null);
    },
  });
  return <section className="my-6 space-y-3" aria-label={t('words.title')}>
    <h3 className="text-sm font-medium">{t('words.title')}</h3>
    <p className="text-sm text-muted-foreground">{t('words.description')}</p>
    {query.isError && <p role="alert">{t('words.loadError')}</p>}
    {rows.map((row, index) => <div key={index} className="flex gap-2">
      <Input aria-label={t('words.original')} value={row.original} maxLength={120} disabled={save.isPending}
        onChange={event => setDraft(rows.map((item, i) => i === index ? { ...item, original: event.target.value } : item))} />
      <Input aria-label={t('words.replacement')} value={row.replacement} maxLength={120} disabled={save.isPending}
        onChange={event => setDraft(rows.map((item, i) => i === index ? { ...item, replacement: event.target.value } : item))} />
      <Button variant="outline" disabled={save.isPending} onClick={() => setDraft(rows.filter((_, i) => i !== index))}>{t('words.remove')}</Button>
    </div>)}
    <div className="flex gap-2">
      <Button variant="outline" disabled={!query.isSuccess || save.isPending || rows.length >= 200} onClick={() => setDraft([...rows, { original: '', replacement: '' }])}>{t('words.add')}</Button>
      <Button disabled={draft === null || save.isPending || rows.some(row => !row.original.trim() || !row.replacement.trim())} onClick={() => save.mutate()}>{t('words.save')}</Button>
    </div>
    {save.isError && <p role="alert">{save.error.message}</p>}
    {save.isSuccess && draft === null && <p role="status">{t('words.saved')}</p>}
  </section>;
}
