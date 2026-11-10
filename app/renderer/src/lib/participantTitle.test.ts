import { expect, test } from 'vitest';
import type { Meeting } from './ipc';
import { withParticipantTitle } from './participantTitle';
const meeting = (participants: string[], name = 'Project planning', base: string | null = name) => ({
  session_info: { name, auto_title_base: base, summary_file: 'test.md' }, participants,
}) as Meeting;
test('includes confirmed participants except the owner', () => {
  expect(withParticipantTitle(meeting(['Jonathan', 'Panos', 'Arash']), 'Jonathan').session_info.name).toBe('Panos, Arash · Project planning');
});
test('ignores unidentified speakers and preserves the topic when none remain', () => {
  expect(withParticipantTitle(meeting(['Jonathan', 'Speaker 2', 'Others']), 'Jonathan').session_info.name).toBe('Project planning');
});
test('adds participants to fixed and manually edited titles', () => {
  const fixed = withParticipantTitle(meeting(['Jonathan', 'Benjamin'], 'De Heus proposal', null), 'Jonathan');
  expect(fixed.session_info.name).toBe('Benjamin · De Heus proposal');
  expect(fixed.session_info.stored_name).toBe('De Heus proposal');
  expect(withParticipantTitle(meeting(['Panos'], 'My own title', 'Project planning'), 'Jonathan').session_info.name).toBe('Panos · My own title');
});
test('avoids repeating a name that already prefixes a saved title', () => {
  expect(withParticipantTitle(meeting(['Benjamin'], 'Benjamin · De Heus proposal', null), 'Jonathan').session_info.name).toBe('Benjamin · De Heus proposal');
});
test('renamed participants are immediately reflected without editing the base', () => {
  expect(withParticipantTitle(meeting(['Martijn Visscher', 'Martijn Example']), 'Jonathan').session_info.name).toBe('Martijn Visscher, Martijn Example · Project planning');
});
test('does not add a prefix before owner identity is available', () => {
  expect(withParticipantTitle(meeting(['Jonathan', 'Panos'])).session_info.name).toBe('Project planning');
});
test('includes suggested names without changing confirmed participants or the saved title', () => {
  const note = { ...meeting(['Jonathan', 'Arash']), suggested_participants: ['Panos', 'Arash', 'Jonathan'] };
  expect(withParticipantTitle(note, 'Jonathan').session_info.name).toBe('Arash, Panos · Project planning');
  expect(note.participants).toEqual(['Jonathan', 'Arash']);
  expect(note.session_info.name).toBe('Project planning');
});
