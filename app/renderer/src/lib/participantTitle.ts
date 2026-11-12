import type { Meeting } from './ipc';
const normalized = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase();
/** Compose from confirmed and suggested participants on every read, so profile renames stay current. */
export function withParticipantTitle(meeting: Meeting, ownName?: string): Meeting {
  const info = meeting.session_info;
  if (!ownName || !info.name) return meeting;
  const separator = info.name.indexOf(' · ');
  const existingPrefix = separator < 0 ? [] : info.name.slice(0, separator).split(',').map(normalized);
  const names = [
    ...new Set(
      [...(meeting.participants ?? []), ...(meeting.suggested_participants ?? []), ...(info.merged_title_participants ?? [])]
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter(
          (p) =>
            p && normalized(p) !== normalized(ownName) && !existingPrefix.includes(normalized(p)) &&
            !/^(you|speaker \d+|others)$/i.test(p)
        )
    ),
  ];
  if (!names.length) return meeting;
  return {
    ...meeting,
    session_info: { ...info, stored_name: info.name, name: `${names.join(', ')} · ${info.name}` },
  };
}
