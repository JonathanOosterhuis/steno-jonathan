import type { Meeting } from './ipc';
const normalized = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase();
/** Compose from confirmed and suggested participants on every read, so profile renames stay current. */
export function withParticipantTitle(meeting: Meeting, ownName?: string): Meeting {
  const info = meeting.session_info;
  if (!ownName || !info.auto_title_base || info.name !== info.auto_title_base) return meeting;
  const names = [
    ...new Set(
      [...(meeting.participants ?? []), ...(meeting.suggested_participants ?? [])]
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter(
          (p) =>
            p && normalized(p) !== normalized(ownName) && !/^(you|speaker \d+|others)$/i.test(p)
        )
    ),
  ];
  if (!names.length) return meeting;
  return {
    ...meeting,
    session_info: { ...info, name: `${names.join(', ')} · ${info.auto_title_base}` },
  };
}
