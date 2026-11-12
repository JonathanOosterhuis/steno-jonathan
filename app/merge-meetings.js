'use strict';

const timestampPattern = /^\[(\d{1,3}:\d{2}(?::\d{2})?(?:\.\d+)?)\](?=\s+\[[^\]]+\])/gm;
const transcriptOf = note => (note.diarised_text || note.transcript || '').trim();
const dateOf = note => Date.parse(note.session_info.processed_at);
const items = (first, second, field) =>
  [...(Array.isArray(first[field]) ? first[field] : []), ...(Array.isArray(second[field]) ? second[field] : [])];

function adjustTimestamps(transcript, offset) {
  let last = -1;
  const text = transcript.replace(timestampPattern, (marker, timestamp) => {
    const seconds = timestamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    last = Math.max(last, seconds);
    if (!offset) return marker;
    const shifted = Math.round((seconds + offset) * 1000);
    const hours = Math.floor(shifted / 3600000);
    const minutes = String(Math.floor(shifted / 60000) % 60).padStart(2, '0');
    const secs = String(Math.floor(shifted / 1000) % 60).padStart(2, '0');
    const ms = shifted % 1000;
    return `[${hours ? hours + ':' : ''}${minutes}:${secs}${ms ? '.' + String(ms).padStart(3, '0') : ''}]`;
  });
  return { text, last };
}

function duration(note, lastTimestamp) {
  const seconds = Number(note.session_info.duration_seconds);
  return Math.max(Number.isFinite(seconds) ? seconds : 0, Math.floor(lastTimestamp) + 1);
}

function mergeMeetings([first, second]) {
  // Use the earlier note as the title and start date, regardless of which
  // note opened the picker. Keep the caller’s deterministic order if a date is missing.
  if (dateOf(second) < dateOf(first)) [first, second] = [second, first];
  const firstText = transcriptOf(first);
  const secondText = transcriptOf(second);
  if (!firstText || !secondText || [first, second].some(note => note.session_info.transcription_failed)) {
    return null;
  }

  const initial = adjustTimestamps(firstText, 0);
  const firstDuration = duration(first, initial.last);
  const continuation = adjustTimestamps(secondText, firstDuration);
  const transcript = [initial.text, continuation.text].join('\n\n--- Merged ---\n\n');
  const diarised = Boolean(first.is_diarised || second.is_diarised || initial.last >= 0 || continuation.last >= 0);
  const joinText = field => [first[field], second[field]]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n\n---\n\n');

  return {
    session_info: {
      name: `${first.session_info.name} (merged)`,
      processed_at: first.session_info.processed_at || second.session_info.processed_at,
      duration_seconds: firstDuration + duration(second, continuation.last),
      notes_stale: true,
      // Preserve display hints without promoting unconfirmed identities.
      merged_title_participants: [...new Set([
        ...items(first, second, 'suggested_participants'),
        ...(first.session_info.merged_title_participants || []),
        ...(second.session_info.merged_title_participants || []),
      ])],
    },
    transcript,
    is_diarised: diarised,
    diarised_text: diarised ? transcript : null,
    summary: joinText('summary'),
    user_notes: joinText('user_notes'),
    participants: [...new Set(items(first, second, 'participants'))],
    folders: [...new Set(items(first, second, 'folders'))],
    discussion_areas: items(first, second, 'discussion_areas'),
    key_points: items(first, second, 'key_points'),
    action_items: items(first, second, 'action_items'),
  };
}

module.exports = { mergeMeetings };
